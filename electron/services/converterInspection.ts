import fs from "node:fs/promises";
import path from "node:path";
import { nativeImage } from "electron";
import { z } from "zod";
import { fromLocalMediaUri, resolveExistingLocalMediaPath, toLocalMediaUri } from "./localMedia";
import { getCachedWebsiteVideoLocalPath } from "./webVideo";
import { resolvePhashBinaries } from "./phash/binaries";
import { runCommand } from "./phash/extract";
import { readFunscriptForInspection } from "./funscript";
import {
  buildDetectedSegments,
  findAdaptiveDetectionSettings,
  findDetectionSettingsForTargetCount,
} from "../../src/features/converter/detection";
import { computeAutoMetadataForSegment } from "../../src/features/converter/metadata";
import {
  DEFAULT_MIN_ROUND_MS,
  DEFAULT_PAUSE_GAP_MS,
  DEFAULT_TRIM_ALLOWANCE_MS,
} from "../../src/features/converter/types";

const time = z.number().int().nonnegative();
export const ZInspectFrames = z
  .object({
    videoUri: z
      .string()
      .trim()
      .min(1)
      .describe("Local video path/URI or an already cached website video URI."),
    startTimeMs: time.default(0),
    endTimeMs: time
      .optional()
      .describe(
        "Exclusive end of the selected source time range; required unless timestampsMs is provided."
      ),
    frameCount: z.number().int().min(1).max(16).default(6),
    timestampsMs: z
      .array(time)
      .min(1)
      .max(16)
      .optional()
      .describe("Exact source times, instead of a sampled range."),
    width: z.number().int().min(160).max(1280).default(640),
  })
  .superRefine((input, ctx) => {
    if (input.timestampsMs && input.endTimeMs !== undefined)
      ctx.addIssue({ code: "custom", message: "Choose timestampsMs or a time range, not both." });
    if (
      !input.timestampsMs &&
      (input.endTimeMs === undefined || input.endTimeMs <= input.startTimeMs)
    )
      ctx.addIssue({ code: "custom", message: "endTimeMs must be greater than startTimeMs." });
  });
export const ZInspectFunscript = z
  .object({
    funscriptUri: z.string().trim().min(1),
    startTimeMs: time.default(0),
    endTimeMs: time.optional(),
    offset: z
      .number()
      .int()
      .nonnegative()
      .default(0)
      .describe("Action offset within the selected range, for lossless pagination."),
    limit: z.number().int().min(1).max(10000).default(500),
    normalized: z
      .boolean()
      .default(true)
      .describe(
        "Apply the same range/inversion/autofix and time-zero anchor as playback. False returns original action positions/times."
      ),
    includePlot: z.boolean().default(true),
  })
  .refine(
    (value) => value.endTimeMs === undefined || value.endTimeMs > value.startTimeMs,
    "endTimeMs must be greater than startTimeMs."
  );
export const ZAutoDetect = z
  .object({
    funscriptUri: z.string().trim().min(1),
    durationMs: z
      .number()
      .int()
      .positive()
      .describe("Full source video duration in milliseconds, not just the inspected range."),
    mode: z.enum(["standard", "adaptive", "targetCount"]).default("standard"),
    pauseGapMs: z.number().int().min(100).default(DEFAULT_PAUSE_GAP_MS),
    minRoundMs: z.number().int().min(500).default(DEFAULT_MIN_ROUND_MS),
    autoTrimRounds: z.boolean().default(false),
    trimAllowanceMs: time.default(DEFAULT_TRIM_ALLOWANCE_MS),
    defaultType: z.enum(["Normal", "Interjection", "Cum"]).default("Normal"),
    targetCount: z.number().int().min(1).max(1000).optional(),
  })
  .refine(
    (value) => value.mode !== "targetCount" || value.targetCount !== undefined,
    "targetCount is required for targetCount mode."
  );

async function localVideoPath(uri: string) {
  const local =
    fromLocalMediaUri(uri) ??
    (path.isAbsolute(uri)
      ? resolveExistingLocalMediaPath(uri)
      : await getCachedWebsiteVideoLocalPath(uri));
  if (!local)
    throw new Error(
      "Video inspection needs a local file or cached video. Cache the website video with db.ensureWebsiteVideoCachedForConverter first."
    );
  if (!(await fs.stat(local)).isFile()) throw new Error("The source must be a video file.");
  return local;
}

export async function inspectVideoFrames(raw: z.input<typeof ZInspectFrames>) {
  const input = ZInspectFrames.parse(raw);
  const videoPath = await localVideoPath(input.videoUri);
  const binaries = await resolvePhashBinaries();
  const probe = await runCommand(
    binaries.ffprobePath,
    [
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_entries",
      "format=duration:stream=width,height,duration,avg_frame_rate",
      "-of",
      "json",
      videoPath,
    ],
    { timeoutMs: 30000 }
  );
  const metadata = JSON.parse(probe.stdout.toString("utf8"));
  const stream = metadata.streams?.[0];
  const streamDuration = Number(stream?.duration);
  const durationMs = Math.floor(
    (Number.isFinite(streamDuration) && streamDuration > 0
      ? streamDuration
      : Number(metadata.format?.duration)) * 1000
  );
  if (
    !stream ||
    !Number.isFinite(durationMs) ||
    durationMs <= 0 ||
    !Number.isFinite(stream.width) ||
    stream.width <= 0
  )
    throw new Error("Could not determine the video's duration and dimensions.");
  if (!input.timestampsMs && input.endTimeMs! > durationMs)
    throw new Error(`Selected range exceeds video duration (${durationMs} ms).`);
  // Sample the center of each time bin, rather than seeking exactly to EOF.
  const timestampsMs =
    input.timestampsMs ??
    Array.from({ length: input.frameCount }, (_, index) =>
      Math.floor(
        input.startTimeMs +
          ((input.endTimeMs! - input.startTimeMs) * (index + 0.5)) / input.frameCount
      )
    );
  if (timestampsMs.some((value) => value >= durationMs))
    throw new Error(`Frame timestamps must be less than video duration (${durationMs} ms).`);
  const width = Math.min(input.width, stream.width);
  const [rateNumerator, rateDenominator] = String(stream.avg_frame_rate ?? "")
    .split("/")
    .map(Number);
  const fps = rateNumerator / rateDenominator;
  const lastSeekMs = Math.max(
    0,
    durationMs - (Number.isFinite(fps) && fps > 0 ? Math.ceil(1000 / fps) : 100)
  );
  const frames = [];
  for (const timestampMs of timestampsMs) {
    const seekTimeMs = Math.min(timestampMs, lastSeekMs);
    const { stdout } = await runCommand(
      binaries.ffmpegPath,
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-nostdin",
        "-threads",
        "1",
        "-ss",
        (seekTimeMs / 1000).toFixed(6),
        "-i",
        videoPath,
        "-map",
        "0:v:0",
        "-frames:v",
        "1",
        "-vf",
        `scale=${width}:1280:force_original_aspect_ratio=decrease`,
        "-q:v",
        "4",
        "-f",
        "image2pipe",
        "-vcodec",
        "mjpeg",
        "-",
      ],
      { timeoutMs: 10000 }
    );
    if (!stdout.length)
      throw new Error(`No frame decoded at ${timestampMs} ms. Try an earlier timestamp.`);
    frames.push({
      timestampMs,
      seekTimeMs,
      mimeType: "image/jpeg" as const,
      data: stdout.toString("base64"),
    });
  }
  return {
    videoUri: path.isAbsolute(input.videoUri) ? toLocalMediaUri(videoPath) : input.videoUri,
    durationMs,
    sourceWidth: stream.width as number,
    sourceHeight: stream.height as number,
    frameRate: stream.avg_frame_rate as string | undefined,
    timestampBasis: "source video milliseconds; requested seek times, nearest decodable frame",
    frames,
  };
}

/** Grayscale bitmap works with Electron's platform-dependent native pixel order. */
export function plotFunscript(
  actions: Array<{ at: number; pos: number }>,
  startTimeMs: number,
  endTimeMs: number
) {
  const width = 960,
    height = 240,
    padding = 12;
  const pixels = Buffer.alloc(width * height * 4);
  const pixel = (x: number, y: number, brightness: number) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const offset = (y * width + x) * 4;
    pixels[offset] = pixels[offset + 1] = pixels[offset + 2] = brightness;
    pixels[offset + 3] = 255;
  };
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) pixel(x, y, 20);
  for (let row = 0; row <= 4; row++)
    for (let x = padding; x < width - padding; x++)
      pixel(x, padding + Math.round((row * (height - 2 * padding)) / 4), 65);
  const project = (action: { at: number; pos: number }) => ({
    x:
      padding +
      Math.round(
        ((action.at - startTimeMs) / Math.max(1, endTimeMs - startTimeMs)) *
          (width - 2 * padding - 1)
      ),
    y:
      padding +
      Math.round((1 - Math.max(0, Math.min(100, action.pos)) / 100) * (height - 2 * padding)),
  });
  let previous: ReturnType<typeof project> | undefined;
  for (const action of actions) {
    const point = project(action);
    if (previous) {
      const steps = Math.max(Math.abs(point.x - previous.x), Math.abs(point.y - previous.y), 1);
      for (let step = 0; step <= steps; step++)
        pixel(
          Math.round(previous.x + ((point.x - previous.x) * step) / steps),
          Math.round(previous.y + ((point.y - previous.y) * step) / steps),
          240
        );
    } else pixel(point.x, point.y, 240);
    previous = point;
  }
  return {
    mimeType: "image/png" as const,
    data: nativeImage.createFromBitmap(pixels, { width, height }).toPNG().toString("base64"),
    width,
    height,
    axes: {
      x: "source time in ms, left to right",
      y: "position 0 at bottom, 100 at top",
      startTimeMs,
      endTimeMs,
    },
  };
}

function scriptUri(uri: string) {
  return path.isAbsolute(uri) ? toLocalMediaUri(uri) : uri;
}

export async function inspectFunscript(raw: z.input<typeof ZInspectFunscript>) {
  const input = ZInspectFunscript.parse(raw);
  const document = await readFunscriptForInspection(scriptUri(input.funscriptUri));
  const all = input.normalized ? document.actions : document.rawActions;
  const endTimeMs = input.endTimeMs ?? Math.max(input.startTimeMs + 1, all.at(-1)?.at ?? 0);
  const selected = all.filter((action) => action.at >= input.startTimeMs && action.at <= endTimeMs);
  // Include interpolated boundaries even when no action lands inside a narrow
  // selection. Paging raw actions must not turn a moving/held signal into a blank plot.
  const positionAt = (at: number) => {
    let previous = all[0];
    for (const action of all) {
      if (action.at > at) {
        if (!previous || action.at === previous.at) return action.pos;
        const progress = Math.max(0, Math.min(1, (at - previous.at) / (action.at - previous.at)));
        return previous.pos + (action.pos - previous.pos) * progress;
      }
      previous = action;
    }
    return previous?.pos ?? 0;
  };
  const plotActions = all.length
    ? [
        { at: input.startTimeMs, pos: positionAt(input.startTimeMs) },
        ...selected,
        { at: endTimeMs, pos: positionAt(endTimeMs) },
      ]
    : [];
  const actions = selected.slice(input.offset, input.offset + input.limit);
  const nextOffset =
    input.offset + actions.length < selected.length ? input.offset + actions.length : null;
  return {
    funscriptUri: scriptUri(input.funscriptUri),
    metadata: document.metadata,
    normalized: input.normalized,
    timestampBasis: "absolute source milliseconds; not rebased to selection",
    totalActions: all.length,
    selectedActionCount: selected.length,
    startTimeMs: input.startTimeMs,
    endTimeMs,
    offset: input.offset,
    nextOffset,
    actions,
    plot: input.includePlot ? plotFunscript(plotActions, input.startTimeMs, endTimeMs) : undefined,
  };
}

export async function autoDetectRounds(raw: z.input<typeof ZAutoDetect>) {
  const input = ZAutoDetect.parse(raw);
  const { actions } = await readFunscriptForInspection(scriptUri(input.funscriptUri));
  if (!actions.length) throw new Error("The funscript contains no valid actions.");
  const common = { ...input, actions };
  const result =
    input.mode === "targetCount"
      ? findDetectionSettingsForTargetCount({
          ...common,
          targetCount: input.targetCount!,
          currentPauseGapMs: input.pauseGapMs,
          currentMinRoundMs: input.minRoundMs,
        })
      : input.mode === "adaptive"
        ? {
            status: "success" as const,
            ...findAdaptiveDetectionSettings({
              ...common,
              currentPauseGapMs: input.pauseGapMs,
              currentMinRoundMs: input.minRoundMs,
            }),
          }
        : {
            status: "success" as const,
            pauseGapMs: input.pauseGapMs,
            minRoundMs: input.minRoundMs,
            evaluations: 1,
            segments: buildDetectedSegments(common),
          };
  if (result.status === "failure")
    return { ...result, mode: input.mode, durationMs: input.durationMs, saved: false as const };
  return {
    ...result,
    segments: result.segments.map((segment) => ({
      ...segment,
      ...computeAutoMetadataForSegment(actions, segment),
      cutRanges: [],
    })),
    mode: input.mode,
    durationMs: input.durationMs,
    saved: false as const,
  };
}
