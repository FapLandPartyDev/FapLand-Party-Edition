import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { app } from "electron";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "./db";
import { resource, round } from "./db/schema";
import { fromLocalMediaUri, toLocalMediaUri } from "./localMedia";
import { resolveVideoDurationMsForUri } from "./videoDuration";
import { generateRoundPreviewImageDataUri } from "./roundPreview";

export const ZReplaceRoundMedia = z
  .object({
    roundId: z.string().min(1),
    resourceId: z.string().min(1).optional(),
    videoUri: z.string().trim().min(1).optional(),
    funscriptUri: z.string().trim().min(1).nullable().optional(),
    resetTrim: z.boolean().default(false),
  })
  .strict()
  .refine(
    (value) => value.videoUri !== undefined || value.funscriptUri !== undefined,
    "Supply videoUri and/or funscriptUri (null detaches the script)."
  );

export async function replaceRoundMedia(input: z.infer<typeof ZReplaceRoundMedia>) {
  const db = getDb();
  const existingRound = await db.query.round.findFirst({ where: eq(round.id, input.roundId) });
  if (!existingRound) throw new Error("Round not found.");
  const existing = await db.query.resource.findFirst({
    where: input.resourceId
      ? and(eq(resource.roundId, input.roundId), eq(resource.id, input.resourceId))
      : eq(resource.roundId, input.roundId),
    orderBy: [asc(resource.createdAt), asc(resource.id)],
  });
  if (!existing) throw new Error("The round has no matching resource to replace.");
  const directory = path.join(app.getPath("userData"), "round-media", randomUUID());
  await fs.mkdir(directory, { recursive: true });
  try {
    const copy = async (uri: string, kind: "video" | "funscript") => {
      const source = fromLocalMediaUri(uri) ?? (path.isAbsolute(uri) ? uri : null);
      if (!source)
        throw new Error(
          "Replacement media must be a downloaded local file, file:// or app://media URI."
        );
      const stat = await fs.stat(source);
      if (!stat.isFile() || stat.size === 0)
        throw new Error("Replacement media is empty or is not a file.");
      const destination = path.join(
        directory,
        kind + (kind === "funscript" ? ".funscript" : path.extname(source) || ".mp4")
      );
      await fs.copyFile(source, destination);
      if (kind === "funscript") {
        const document: unknown = JSON.parse(await fs.readFile(destination, "utf8"));
        z.object({
          actions: z.array(
            z.object({ at: z.number().finite().nonnegative(), pos: z.number().finite() })
          ),
        }).parse(document);
      }
      return toLocalMediaUri(destination);
    };
    const videoUri =
      input.videoUri === undefined ? existing.videoUri : await copy(input.videoUri, "video");
    const funscriptUri =
      input.funscriptUri === undefined
        ? existing.funscriptUri
        : input.funscriptUri === null
          ? null
          : await copy(input.funscriptUri, "funscript");
    const durationMs =
      input.videoUri === undefined
        ? existing.durationMs
        : await resolveVideoDurationMsForUri(videoUri);
    if (input.videoUri !== undefined && durationMs === null)
      throw new Error(
        "Could not read the replacement video's duration. Verify the media file and FFprobe installation."
      );
    const startTime = input.resetTrim ? null : existingRound.startTime;
    const endTime = input.resetTrim ? null : existingRound.endTime;
    if (
      input.videoUri !== undefined &&
      durationMs !== null &&
      ((startTime !== null && startTime >= durationMs) ||
        (endTime !== null && endTime > durationMs))
    ) {
      throw new Error(
        "The replacement video is shorter than the round's trim. Adjust the trim first or use resetTrim: true."
      );
    }
    const previewImage =
      input.videoUri !== undefined || input.resetTrim
        ? await generateRoundPreviewImageDataUri({
            videoUri,
            startTimeMs: startTime,
            endTimeMs: endTime,
          })
        : existingRound.previewImage;
    const updated = await db.transaction(async (tx) => {
      const current = await tx.query.resource.findFirst({ where: eq(resource.id, existing.id) });
      const currentRound = await tx.query.round.findFirst({ where: eq(round.id, input.roundId) });
      if (
        !current ||
        !currentRound ||
        JSON.stringify(current) !== JSON.stringify(existing) ||
        JSON.stringify(currentRound) !== JSON.stringify(existingRound)
      ) {
        throw new Error("The round changed while preparing media. Inspect it before retrying.");
      }
      const [replacement] = await tx
        .update(resource)
        .set({
          videoUri,
          funscriptUri,
          durationMs,
          phash: input.videoUri === undefined ? existing.phash : null,
          updatedAt: new Date(),
        })
        .where(eq(resource.id, existing.id))
        .returning();
      await tx
        .update(round)
        .set({ startTime, endTime, previewImage, updatedAt: new Date() })
        .where(eq(round.id, input.roundId));
      return replacement;
    });
    return { roundId: input.roundId, resource: updated, previous: existing, startTime, endTime };
  } catch (error) {
    await fs.rm(directory, { recursive: true, force: true });
    throw error;
  }
}
