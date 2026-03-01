import crypto from "node:crypto";
import { createReadStream } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generateVideoPhash } from "./phash";
import { getDb } from "./db";
import { eq } from "drizzle-orm";
import { hero, round, resource } from "./db/schema";
import { generateRoundPreviewImageDataUri } from "./roundPreview";
import {
  assertValidRoundCutRanges,
  stringifyRoundCutRanges,
  type RoundCutRange,
} from "../../src/utils/roundCuts";
export type RoundType = "Normal" | "Interjection" | "Cum";
type TransactionClient = Parameters<Parameters<ReturnType<typeof getDb>['transaction']>[0]>[0];

export type ConverterSegmentInput = {
  startTimeMs: number;
  endTimeMs: number;
  type: RoundType;
  customName?: string | null;
  bpm?: number | null;
  difficulty?: number | null;
  cutRanges?: RoundCutRange[] | null;
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
    sourceRoundIds?: string[] | null;
    removeSourceRound?: boolean;
  };
  allowOverlaps?: boolean;
  segments: ConverterSegmentInput[];
};

export type SaveConvertedRoundsResult = {
  heroId: string;
  removedSourceRound: boolean;
  stats: {
    created: number;
    updated: number;
    removedSources: number;
  };
  removedSourceRoundIds: string[];
  rounds: Array<{
    id: string;
    name: string;
    startTime: number;
    endTime: number;
    type: RoundType;
    phash: string | null;
    cutRanges: RoundCutRange[];
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

export function validateAndNormalizeSegments(
  input: ConverterSegmentInput[],
  options: { allowOverlaps?: boolean } = {},
): ConverterSegmentInput[] {
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
      cutRanges: assertValidRoundCutRanges(
        segment.cutRanges ?? [],
        start,
        end,
        `Segment ${index + 1} cut range`,
      ),
    } satisfies ConverterSegmentInput;
  });

  normalized.sort((a, b) => {
    if (a.startTimeMs !== b.startTimeMs) return a.startTimeMs - b.startTimeMs;
    return a.endTimeMs - b.endTimeMs;
  });

  if (!options.allowOverlaps) {
    for (let i = 1; i < normalized.length; i += 1) {
      const prev = normalized[i - 1];
      const current = normalized[i];
      if (!prev || !current) continue;
      if (current.startTimeMs < prev.endTimeMs) {
        throw new Error("Segments must not overlap.");
      }
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
  cutRanges?: RoundCutRange[] | null;
  segmentOrdinal?: number | null;
}): string {
  const payloadParts = [
    typeof input.segmentOrdinal === "number" ? "converter:v3" : "converter:v2",
    input.heroName.trim().toLowerCase(),
    input.videoUri.trim(),
    input.funscriptUri?.trim() ?? "",
    `${input.startTimeMs}`,
    `${input.endTimeMs}`,
    JSON.stringify(input.cutRanges ?? []),
  ];
  if (typeof input.segmentOrdinal === "number") {
    payloadParts.push(`${input.segmentOrdinal}`);
  }
  const payload = payloadParts.join("|");
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
  const hash = crypto.createHash("sha256");
  const stream = createReadStream(filePath);

  return await new Promise<string>((resolve, reject) => {
    stream.on("data", (chunk) => {
      hash.update(chunk);
    });
    stream.on("error", reject);
    stream.on("end", () => {
      resolve(hash.digest("hex"));
    });
  });
}

async function computeRoundPhash(
  localVideoPath: string,
  startTimeMs: number,
  endTimeMs: number,
  fullFileHashCache: Map<string, Promise<string>>,
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
  let fileHashPromise = fullFileHashCache.get(normalizedPath);
  if (!fileHashPromise) {
    fileHashPromise = computeFileSha256(normalizedPath);
    fullFileHashCache.set(normalizedPath, fileHashPromise);
  }
  const fileHash = await fileHashPromise;

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

function normalizeSourceRoundIds(input: SaveConvertedRoundsInput["source"]): string[] {
  const sourceRoundIds = Array.isArray(input.sourceRoundIds)
    ? input.sourceRoundIds
    : [];
  const candidates = sourceRoundIds.length > 0 ? sourceRoundIds : [input.sourceRoundId];
  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const candidate of candidates) {
    const id = normalizeNullableText(candidate);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    normalized.push(id);
  }

  return normalized;
}

export async function saveConvertedRounds(input: SaveConvertedRoundsInput): Promise<SaveConvertedRoundsResult> {
  const heroName = normalizeRequiredText(input.hero.name, "Hero name");
  const heroAuthor = normalizeNullableText(input.hero.author);
  const heroDescription = normalizeNullableText(input.hero.description);

  const videoUri = normalizeRequiredText(input.source.videoUri, "Video URI");
  const funscriptUri = normalizeNullableText(input.source.funscriptUri);
  const sourceRoundIds = normalizeSourceRoundIds(input.source);
  const removeSourceRounds = Boolean(input.source.removeSourceRound && sourceRoundIds.length > 0);

  const normalizedSegments = validateAndNormalizeSegments(input.segments, {
    allowOverlaps: input.allowOverlaps,
  });

  const localVideoPath = fromUriToLocalPath(videoUri);
  let phashes: Array<string | null>;
  if (localVideoPath) {
    const fileHashCache = new Map<string, Promise<string>>();
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
    const heroId = await ensureHero(tx, {
      name: heroName,
      author: heroAuthor,
      description: heroDescription,
    });

    let created = 0;
    let updated = 0;
    const savedRoundIds = new Set<string>();
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
        cutRanges: segment.cutRanges ?? [],
        segmentOrdinal: input.allowOverlaps ? index : null,
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
        cutRangesJson: stringifyRoundCutRanges(segment.cutRanges ?? []),
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
        savedRoundIds.add(savedRoundId);
        updated += 1;
      } else {
        const [createdRow] = await tx.insert(round).values({ ...roundPayload, installSourceKey })
          .returning({ id: round.id });
        savedRoundId = createdRow.id;
        savedRoundIds.add(savedRoundId);
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
        cutRanges: segment.cutRanges ?? [],
      });
    }

    const removedSourceRoundIds: string[] = [];
    if (removeSourceRounds) {
      const staleSourceRoundIds = sourceRoundIds.filter((id) => !savedRoundIds.has(id));
      for (const staleSourceRoundId of staleSourceRoundIds) {
        await tx.delete(resource).where(eq(resource.roundId, staleSourceRoundId));
        const removed = await tx.delete(round).where(eq(round.id, staleSourceRoundId)).returning({
          id: round.id,
        });
        if (removed[0]?.id) {
          removedSourceRoundIds.push(removed[0].id);
        }
      }
    }

    return {
      heroId,
      removedSourceRound: removedSourceRoundIds.length > 0,
      removedSourceRoundIds,
      stats: { created, updated, removedSources: removedSourceRoundIds.length },
      rounds: persistedRounds,
    } satisfies SaveConvertedRoundsResult;
  });

  return result;
}
