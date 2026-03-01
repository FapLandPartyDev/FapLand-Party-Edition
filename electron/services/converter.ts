import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generateVideoPhash } from "./phash";
import { getDb } from "./db";
import { eq } from "drizzle-orm";
import { hero, round, resource } from "./db/schema";
import { generateRoundPreviewImageDataUri } from "./roundPreview";
export type RoundType = "Normal" | "Interjection" | "Cum";
type TransactionClient = Parameters<Parameters<ReturnType<typeof getDb>['transaction']>[0]>[0];

export type ConverterSegmentInput = {
  startTimeMs: number;
  endTimeMs: number;
  type: RoundType;
  customName?: string | null;
  bpm?: number | null;
  difficulty?: number | null;
};

export type SaveConvertedRoundsInput = {
  hero: {
    name: string;
    author?: string | null;
    description?: string | null;
  };
  source: {
    videoUri: string;
    funscriptUri?: string | null;
    sourceRoundId?: string | null;
    removeSourceRound?: boolean;
  };
  segments: ConverterSegmentInput[];
};

export type SaveConvertedRoundsResult = {
  heroId: string;
  removedSourceRound: boolean;
  stats: {
    created: number;
    updated: number;
  };
  rounds: Array<{
    id: string;
    name: string;
    startTime: number;
    endTime: number;
    type: RoundType;
    phash: string | null;
  }>;
};

const MAX_SEGMENTS = 300;

function normalizeNullableText(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeRequiredText(value: string, fieldName: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new Error(`${fieldName} is required.`);
  }
  return trimmed;
}

function normalizeOptionalBpm(value: number | null | undefined, segmentNumber: number): number | null {
  if (value === null || value === undefined) return null;
  if (!Number.isFinite(value)) {
    throw new Error(`Segment ${segmentNumber} has an invalid BPM.`);
  }

  const normalized = Math.round(value);
  if (normalized < 1 || normalized > 400) {
    throw new Error(`Segment ${segmentNumber} BPM must be between 1 and 400.`);
  }

  return normalized;
}

function normalizeOptionalDifficulty(value: number | null | undefined, segmentNumber: number): number | null {
  if (value === null || value === undefined) return null;
  if (!Number.isFinite(value) || !Number.isInteger(value)) {
    throw new Error(`Segment ${segmentNumber} has an invalid difficulty.`);
  }

  if (value < 1 || value > 5) {
    throw new Error(`Segment ${segmentNumber} difficulty must be between 1 and 5.`);
  }

  return value;
}

function toRoundType(input: string): RoundType {
  if (input === "Interjection") return "Interjection";
  if (input === "Cum") return "Cum";
  return "Normal";
}

export function validateAndNormalizeSegments(input: ConverterSegmentInput[]): ConverterSegmentInput[] {
  if (!Array.isArray(input) || input.length === 0) {
    throw new Error("At least one segment is required.");
  }
  if (input.length > MAX_SEGMENTS) {
    throw new Error(`Too many segments. Max allowed: ${MAX_SEGMENTS}.`);
  }

  const normalized = input.map((segment, index) => {
    const start = Math.floor(segment.startTimeMs);
    const end = Math.floor(segment.endTimeMs);

    if (!Number.isFinite(start) || !Number.isFinite(end)) {
      throw new Error(`Segment ${index + 1} has an invalid time range.`);
    }
    if (start < 0 || end < 0) {
      throw new Error(`Segment ${index + 1} cannot have negative timestamps.`);
    }
    if (start >= end) {
      throw new Error(`Segment ${index + 1} start time must be before end time.`);
    }

    return {
      startTimeMs: start,
      endTimeMs: end,
      type: toRoundType(segment.type),
      customName: normalizeNullableText(segment.customName),
      bpm: normalizeOptionalBpm(segment.bpm, index + 1),
      difficulty: normalizeOptionalDifficulty(segment.difficulty, index + 1),
    } satisfies ConverterSegmentInput;
  });

  normalized.sort((a, b) => {
    if (a.startTimeMs !== b.startTimeMs) return a.startTimeMs - b.startTimeMs;
    return a.endTimeMs - b.endTimeMs;
  });

  for (let i = 1; i < normalized.length; i += 1) {
    const prev = normalized[i - 1];
    const current = normalized[i];
    if (!prev || !current) continue;
    if (current.startTimeMs < prev.endTimeMs) {
      throw new Error("Segments must not overlap.");
    }
  }

  return normalized;
}

export function toDeterministicInstallSourceKey(input: {
  heroName: string;
  videoUri: string;
  funscriptUri: string | null;
  startTimeMs: number;
  endTimeMs: number;
}): string {
  const payload = [
    "converter:v1",
    input.heroName.trim().toLowerCase(),
    input.videoUri.trim(),
    input.funscriptUri?.trim() ?? "",
    `${input.startTimeMs}`,
    `${input.endTimeMs}`,
  ].join("|");
  const digest = crypto.createHash("sha256").update(payload).digest("hex");
  return `converter:${digest}`;
}

export function fromUriToLocalPath(uri: string): string | null {
  try {
    const parsed = new URL(uri);
    if (parsed.protocol === "app:" && parsed.hostname === "media") {
      const decoded = decodeURIComponent(parsed.pathname.slice(1));
      if (!decoded) return null;
      if (process.platform === "win32" && /^\/[A-Za-z]:/.test(decoded)) {
        return path.normalize(decoded.slice(1));
      }
      return path.normalize(decoded);
    }

    if (parsed.protocol === "file:") {
      return fileURLToPath(parsed);
    }

    return null;
  } catch {
    return null;
  }
}

async function computeFileSha256(filePath: string): Promise<string> {
  const bytes = await fs.readFile(filePath);
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

async function computeRoundPhash(
  localVideoPath: string,
  startTimeMs: number,
  endTimeMs: number,
  fullFileHashCache: Map<string, string>,
): Promise<string> {
  try {
    const result = await generateVideoPhash(localVideoPath, startTimeMs, endTimeMs);
    const trimmed = typeof result === "string" ? result.trim() : "";
    if (trimmed.length > 0) {
      return trimmed;
    }
  } catch {
    // Fallback below.
  }

  const normalizedPath = path.normalize(localVideoPath);
  let fileHash = fullFileHashCache.get(normalizedPath);
  if (!fileHash) {
    fileHash = await computeFileSha256(normalizedPath);
    fullFileHashCache.set(normalizedPath, fileHash);
  }

  return `sha256:${fileHash}@${startTimeMs}-${endTimeMs}`;
}

async function ensureHero(
  tx: TransactionClient,
  heroInput: { name: string; author: string | null; description: string | null },
): Promise<string> {
  const existing = await tx.query.hero.findFirst({ where: eq(hero.name, heroInput.name) });
  if (!existing) {
    const [created] = await tx.insert(hero).values({
      name: heroInput.name,
      author: heroInput.author,
      description: heroInput.description,
    }).returning({ id: hero.id });
    return created.id;
  }

  const nextData: Partial<typeof hero.$inferInsert> = {};
  if (!normalizeNullableText(existing.author) && heroInput.author) {
    nextData.author = heroInput.author;
  }
  if (!normalizeNullableText(existing.description) && heroInput.description) {
    nextData.description = heroInput.description;
  }
  if (Object.keys(nextData).length > 0) {
    await tx.update(hero).set(nextData).where(eq(hero.id, existing.id));
  }

  return existing.id;
}

export async function saveConvertedRounds(input: SaveConvertedRoundsInput): Promise<SaveConvertedRoundsResult> {
  const heroName = normalizeRequiredText(input.hero.name, "Hero name");
  const heroAuthor = normalizeNullableText(input.hero.author);
  const heroDescription = normalizeNullableText(input.hero.description);

  const videoUri = normalizeRequiredText(input.source.videoUri, "Video URI");
  const funscriptUri = normalizeNullableText(input.source.funscriptUri);
  const sourceRoundId = normalizeNullableText(input.source.sourceRoundId);
  const removeSourceRound = Boolean(input.source.removeSourceRound && sourceRoundId);

  const normalizedSegments = validateAndNormalizeSegments(input.segments);

  const localVideoPath = fromUriToLocalPath(videoUri);
  let phashes: Array<string | null>;
  if (localVideoPath) {
    const fileHashCache = new Map<string, string>();
    phashes = await Promise.all(
      normalizedSegments.map((segment) =>
        computeRoundPhash(localVideoPath, segment.startTimeMs, segment.endTimeMs, fileHashCache),
      ),
    );
  } else {
    phashes = normalizedSegments.map(() => null);
  }
  const previewImages = await Promise.all(
    normalizedSegments.map((segment) =>
      generateRoundPreviewImageDataUri({
        videoUri,
        startTimeMs: segment.startTimeMs,
        endTimeMs: segment.endTimeMs,
      }),
    ),
  );

  const result = await getDb().transaction(async (tx) => {
    let removedSourceRound = false;
    if (removeSourceRound && sourceRoundId) {
      await tx.delete(resource).where(eq(resource.roundId, sourceRoundId));
      const removed = await tx.delete(round).where(eq(round.id, sourceRoundId)).returning();
      removedSourceRound = removed.length > 0;
    }

    const heroId = await ensureHero(tx, {
      name: heroName,
      author: heroAuthor,
      description: heroDescription,
    });

    let created = 0;
    let updated = 0;
    const persistedRounds: SaveConvertedRoundsResult["rounds"] = [];

    for (let index = 0; index < normalizedSegments.length; index += 1) {
      const segment = normalizedSegments[index];
      const phash = phashes[index] ?? null;
      const previewImage = previewImages[index] ?? null;
      if (!segment) continue;

      const roundName = segment.customName ?? `${heroName} - round ${index + 1}`;
      const installSourceKey = toDeterministicInstallSourceKey({
        heroName,
        videoUri,
        funscriptUri,
        startTimeMs: segment.startTimeMs,
        endTimeMs: segment.endTimeMs,
      });

      const existing = await tx.query.round.findFirst({
        where: eq(round.installSourceKey, installSourceKey),
        columns: { id: true },
      });

      const roundPayload = {
        name: roundName,
        type: segment.type,
        startTime: segment.startTimeMs,
        endTime: segment.endTimeMs,
        bpm: segment.bpm ?? null,
        difficulty: segment.difficulty ?? null,
        phash,
        previewImage,
        author: heroAuthor,
        description: heroDescription,
        heroId,
      };

      let savedRoundId = "";
      if (existing) {
        const [updatedRow] = await tx.update(round).set({ ...roundPayload, updatedAt: new Date() })
          .where(eq(round.id, existing.id)).returning({ id: round.id });
        savedRoundId = updatedRow.id;
        updated += 1;
      } else {
        const [createdRow] = await tx.insert(round).values({ ...roundPayload, installSourceKey })
          .returning({ id: round.id });
        savedRoundId = createdRow.id;
        created += 1;
      }

      await tx.delete(resource).where(eq(resource.roundId, savedRoundId));

      await tx.insert(resource).values({
        roundId: savedRoundId,
        videoUri,
        funscriptUri,
        phash,
        disabled: false,
      });

      persistedRounds.push({
        id: savedRoundId,
        name: roundName,
        startTime: segment.startTimeMs,
        endTime: segment.endTimeMs,
        type: segment.type,
        phash,
      });
    }

    return {
      heroId,
      removedSourceRound,
      stats: { created, updated },
      rounds: persistedRounds,
    } satisfies SaveConvertedRoundsResult;
  });

  return result;
}
