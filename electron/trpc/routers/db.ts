import { TRPCError } from "@trpc/server";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import { shell } from "electron";
import * as z from "zod";
import { resolveInstallExportBaseDir } from "../../services/appPaths";
import { getDb, repairInstalledLibrarySchema } from "../../services/db";
import { exportInstalledDatabase } from "../../services/installExport";
import {
  analyzeLibraryExportPackage,
  exportLibraryPackage,
  getLibraryExportPackageStatus,
  requestLibraryExportPackageAbort,
} from "../../services/libraryExportPackage";
import { resolveDatabaseBackupDir, runDatabaseBackup } from "../../services/databaseBackup";
import {
  createPlaintextSettingsFile,
  resolveSettingsBackupDir,
  runSettingsBackup,
} from "../../services/settingsBackup";
import {
  createResourceUriResolver,
  getDisabledRoundIdSet,
  resolveResourceUris,
} from "../../services/integrations";
import { getStore, initStore } from "../../services/store";
import { resolveVideoDurationMsForUri } from "../../services/videoDuration";
import {
  calculateFunscriptDifficultyFromUri,
  convertFunscriptUriToManagedHardMode,
  getHardModeAttachmentRevert,
  recordHardModeAttachmentReverts,
} from "../../services/funscript";
import {
  addAutoScanFolder,
  addAutoScanFolderAndScan,
  getAutoScanFolders,
  getInstallScanStatus,
  inspectInstallSidecarFile,
  importInstallSidecarFile,
  importLegacyVideoFileAsRound,
  repairTemplateHero,
  repairTemplateRound,
  importLegacyFolderWithPlan,
  inspectInstallFolder,
  removeAutoScanFolder,
  requestInstallScanAbort,
  scanInstallFolderOnceWithLegacySupport,
  scanInstallSources,
  retryTemplateLinking,
} from "../../services/installer";
import {
  getPhashScanStatus,
  startPhashScan,
  startPhashScanManual,
  requestPhashScanAbort,
} from "../../services/phashScanService";
import {
  getWebsiteVideoScanStatus,
  queueWebsiteVideoCacheImmediately,
  requestWebsiteVideoScanAbort,
  startWebsiteVideoScan,
  startWebsiteVideoScanManual,
} from "../../services/webVideoScanService";
import { generateRoundPreviewImageDataUri } from "../../services/roundPreview";
import { clearPlayableVideoCache } from "../../services/playableVideo";
import {
  clearWebsiteVideoCache,
  ensureWebsiteVideoCached,
  getAllWebsiteVideoDownloadProgresses,
  getWebsiteVideoCacheState,
  getWebsiteVideoDownloadProgress,
  getWebsiteVideoTargetUrl,
  removeCachedWebsiteVideo,
  resolveWebsiteVideoCacheRoot,
  resolveWebsiteVideoStream,
} from "../../services/webVideo";
import { clearMusicCache, resolveMusicCacheRoot } from "../../services/musicDownload";
import { clearFpackExtractionCache, getFpackExtractionRoot } from "../../services/fpack";
import { clearEroScriptsCache, resolveEroScriptsCacheRoot } from "../../services/eroscripts";
import { publicProcedure, router } from "../trpc";
import { and, eq, desc, asc, inArray } from "drizzle-orm";
import {
  gameProfile,
  singlePlayerRunHistory,
  singlePlayerRunSave,
  multiplayerMatchCache,
  resultSyncQueue,
  hero,
  round,
  resource,
  playlistTrackPlay,
  playlist,
  gameplaySession,
  gameplayRoundPlay,
} from "../../services/db/schema";
import { ZSinglePlayerRunSaveSnapshot } from "../../../src/game/saveSchema";
import { THEHANDY_OFFSET_MAX_MS, THEHANDY_OFFSET_MIN_MS } from "../../../src/constants/theHandy";

const ZNullableText = z.string().optional().nullable();
const ZRoundType = z.enum(["Normal", "Interjection", "Cum"]);
const ZPersistablePlaylistSaveMode = z.enum(["checkpoint", "everywhere"]);
const ZGameplayMode = z.enum(["single_player", "multiplayer"]);
const ZGameplaySessionStatus = z.enum(["in_progress", "completed", "abandoned"]);
const ZRoundPlayStatus = z.enum(["playing", "completed", "skipped", "abandoned"]);
const ZRoundPhaseKind = z.enum(["normal", "cum", "cumPoint", "interjection"]);
const ZRoundCumOutcome = z.enum([
  "manual_loss",
  "failed_instruction",
  "came_as_told",
  "did_not_cum",
]);
const ZTagList = z.array(z.string()).optional();
const ROUND_DELETE_CHUNK_SIZE = 500;

function normalizeTextMetadata(input: string | null | undefined): string | null {
  const trimmed = input?.trim();
  return trimmed ? trimmed : null;
}

function normalizeTags(input: string[] | null | undefined): string[] {
  if (!input) return [];
  return [...new Set(input.map((entry) => entry.trim().toLowerCase()).filter(Boolean))].sort();
}

function parseTagsJson(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? normalizeTags(parsed.filter((entry): entry is string => typeof entry === "string"))
      : [];
  } catch {
    return [];
  }
}

function chunkArray<T>(values: T[], chunkSize: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += chunkSize) {
    chunks.push(values.slice(index, index + chunkSize));
  }
  return chunks;
}

async function cleanupDeletedRoundWebsiteCache(deletedRoundWebsiteUrls: string[]): Promise<void> {
  if (deletedRoundWebsiteUrls.length === 0) {
    return;
  }

  const db = getDb();
  const remainingResources = await db.query.resource.findMany({
    columns: {
      videoUri: true,
    },
  });
  const remainingWebsiteUrls = new Set(
    collectWebsiteVideoTargetUrls(remainingResources.map((entry) => entry.videoUri))
  );
  await Promise.all(
    [...new Set(deletedRoundWebsiteUrls)]
      .filter((targetUrl) => !remainingWebsiteUrls.has(targetUrl))
      .map((targetUrl) => removeCachedWebsiteVideo(targetUrl))
  );
}

function isMissingInstalledLibraryColumnError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return /no such column: .*(durationMs|funscriptOffsetMs|cutRangesJson|excludeFromRandom|excludeFromNumbering|tagsJson|libraryLabel)/i.test(
    error.message
  );
}

async function withInstalledLibrarySchemaRepair<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (!isMissingInstalledLibraryColumnError(error)) throw error;
    const db = getDb();
    await repairInstalledLibrarySchema(db);
    return await operation();
  }
}

function normalizeHttpUrl(input: string): string {
  let parsed: URL;
  try {
    parsed = new URL(input.trim());
  } catch {
    throw new Error("Website URLs must be valid public http(s) URLs.");
  }
  if (!(parsed.protocol === "http:" || parsed.protocol === "https:")) {
    throw new Error("Website URLs must be valid public http(s) URLs.");
  }
  return parsed.toString();
}

function normalizeFunscriptOffsetMs(value: number | null | undefined): number | null {
  if (value == null) return null;
  if (!Number.isFinite(value) || !Number.isInteger(value)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Funscript offset must be a finite integer.",
    });
  }
  if (value < THEHANDY_OFFSET_MIN_MS || value > THEHANDY_OFFSET_MAX_MS) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Funscript offset must be between ${THEHANDY_OFFSET_MIN_MS}ms and ${THEHANDY_OFFSET_MAX_MS}ms.`,
    });
  }
  return value;
}

function toWebsiteRoundInstallSourceKey(input: {
  name: string;
  videoUri: string;
  funscriptUri: string | null;
}): string {
  const payload = [
    "website-round:v1",
    input.name.trim().toLowerCase(),
    input.videoUri.trim(),
    input.funscriptUri?.trim() ?? "",
  ].join("|");
  const digest = crypto.createHash("sha256").update(payload).digest("hex");
  return `website:${digest}`;
}

function toMediaRoundInstallSourceKey(input: {
  name: string;
  videoUri: string;
  funscriptUri: string | null;
  sourceKey?: string | null;
}): string {
  const payload = [
    "media-round:v1",
    input.sourceKey?.trim() || "",
    input.name.trim().toLowerCase(),
    input.videoUri.trim(),
    input.funscriptUri?.trim() ?? "",
  ].join("|");
  const digest = crypto.createHash("sha256").update(payload).digest("hex");
  return `media:${digest}`;
}

function queueWebsiteVideoCaching(): void {
  void startWebsiteVideoScan().catch((error) => {
    console.error("Failed to queue website video caching", error);
  });
}

function queueWebsiteVideoCachingImmediately(input: {
  resourceId: string;
  roundId: string;
  roundName: string;
  url: string;
}): void {
  void queueWebsiteVideoCacheImmediately(input).catch((error) => {
    console.error("Failed to queue website video caching", error);
  });
}

function collectWebsiteVideoTargetUrls(videoUris: string[]): string[] {
  const targetUrls = new Set<string>();
  for (const videoUri of videoUris) {
    const targetUrl = getWebsiteVideoTargetUrl(videoUri);
    if (targetUrl) {
      targetUrls.add(targetUrl);
    }
  }
  return [...targetUrls];
}

async function hydrateResourceDurationMs(
  db: ReturnType<typeof getDb>,
  resources: Array<{ id: string; videoUri: string; durationMs: number | null }>
): Promise<void> {
  for (const entry of resources) {
    if (typeof entry.durationMs === "number" && entry.durationMs > 0) continue;
    try {
      const durationMs = await resolveVideoDurationMsForUri(entry.videoUri);
      if (durationMs === null) continue;
      entry.durationMs = durationMs;
      await db.update(resource).set({ durationMs }).where(eq(resource.id, entry.id));
    } catch (error) {
      console.warn("Failed to hydrate resource duration", entry.videoUri, error);
    }
  }
}

type InstalledRoundQueryEntry = {
  id: string;
  resources: Array<{
    id: string;
    disabled: boolean;
  }>;
};

type WebsiteVideoCacheStatus = Awaited<ReturnType<typeof getWebsiteVideoCacheState>>;

function getVisibleResources<T extends { disabled: boolean }>(
  resources: T[],
  includeDisabled: boolean
): T[] {
  return includeDisabled ? resources : resources.filter((entry) => !entry.disabled);
}

function shouldIncludeInstalledRound(
  entry: InstalledRoundQueryEntry,
  options: {
    includeDisabled: boolean;
    includeTemplates: boolean;
    disabledRoundIds: Set<string>;
  }
): boolean {
  const { includeDisabled, includeTemplates, disabledRoundIds } = options;
  const visibleResources = getVisibleResources(entry.resources, includeDisabled);

  if (!includeDisabled && disabledRoundIds.has(entry.id)) {
    return false;
  }

  if (!includeTemplates && visibleResources.length === 0) {
    return false;
  }

  return true;
}

function createWebsiteVideoCacheStatusLoader(): (
  videoUri: string
) => Promise<WebsiteVideoCacheStatus> {
  const websiteVideoCacheStateByUri = new Map<string, Promise<WebsiteVideoCacheStatus>>();

  return (videoUri: string) => {
    const existing = websiteVideoCacheStateByUri.get(videoUri);
    if (existing) return existing;
    const pending = getWebsiteVideoCacheState(videoUri);
    websiteVideoCacheStateByUri.set(videoUri, pending);
    return pending;
  };
}

type CatalogRoundResource = {
  id: string;
  disabled: boolean;
  phash: string | null;
  durationMs: number | null;
  funscriptUri: string | null;
  funscriptOffsetMs: number | null;
  invertFunscript: boolean;
};

type InstalledRoundCardAssetEntry = {
  roundId: string;
  previewImage: string | null;
  previewVideoUri: string | null;
  websiteVideoCacheStatus: WebsiteVideoCacheStatus;
  primaryResourceId: string | null;
};

function toInstalledRoundRuntimeCatalogEntry(entry: {
  id: string;
  name: string;
  author: string | null;
  description: string | null;
  tagsJson: string;
  bpm: number | null;
  difficulty: number | null;
  phash: string | null;
  startTime: number | null;
  endTime: number | null;
  cutRangesJson?: string | null;
  createdAt: Date;
  updatedAt: Date;
  type: "Normal" | "Interjection" | "Cum";
  installSourceKey: string | null;
  libraryLabel: string | null;
  heroId: string | null;
  excludeFromRandom: boolean;
  hero: {
    id: string;
    name: string;
    author: string | null;
    description: string | null;
    tagsJson: string;
  } | null;
  resources: Array<{
    id: string;
    disabled: boolean;
    phash: string | null;
    durationMs: number | null;
    videoUri: string;
    funscriptUri: string | null;
    funscriptOffsetMs: number | null;
    invertFunscript: boolean;
  }>;
  isDisabled?: boolean;
}) {
  return {
    id: entry.id,
    name: entry.name,
    author: entry.author,
    description: entry.description,
    tags: parseTagsJson(entry.tagsJson),
    bpm: entry.bpm,
    difficulty: entry.difficulty,
    phash: entry.phash,
    startTime: entry.startTime,
    endTime: entry.endTime,
    cutRangesJson: entry.cutRangesJson ?? null,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
    type: entry.type ?? null,
    installSourceKey: entry.installSourceKey,
    libraryLabel: entry.libraryLabel,
    heroId: entry.heroId,
    excludeFromRandom: entry.excludeFromRandom,
    hero: entry.hero
      ? {
          ...entry.hero,
          tags: parseTagsJson(entry.hero.tagsJson),
        }
      : null,
    isDisabled: entry.isDisabled === true,
    resources: entry.resources.map((resourceEntry) => ({
      id: resourceEntry.id,
      disabled: resourceEntry.disabled,
      phash: resourceEntry.phash,
      durationMs: resourceEntry.durationMs,
      videoUri: resourceEntry.videoUri,
      funscriptUri: resourceEntry.funscriptUri,
      funscriptOffsetMs: resourceEntry.funscriptOffsetMs,
      hasFunscript: Boolean(resourceEntry.funscriptUri),
      invertFunscript: resourceEntry.invertFunscript,
    })),
  };
}

function toInstalledRoundCatalogEntry(entry: {
  id: string;
  name: string;
  author: string | null;
  description: string | null;
  tagsJson: string;
  bpm: number | null;
  difficulty: number | null;
  phash: string | null;
  startTime: number | null;
  endTime: number | null;
  createdAt: Date;
  updatedAt: Date;
  type: "Normal" | "Interjection" | "Cum";
  installSourceKey: string | null;
  libraryLabel: string | null;
  heroId: string | null;
  excludeFromRandom: boolean;
  hero: {
    id: string;
    name: string;
    author: string | null;
    description: string | null;
    tagsJson: string;
  } | null;
  resources: CatalogRoundResource[];
  isDisabled?: boolean;
}): {
  id: string;
  name: string;
  author: string | null;
  description: string | null;
  tags: string[];
  bpm: number | null;
  difficulty: number | null;
  phash: string | null;
  startTime: number | null;
  endTime: number | null;
  createdAt: Date;
  updatedAt: Date;
  type: "Normal" | "Interjection" | "Cum" | null;
  installSourceKey: string | null;
  libraryLabel: string | null;
  heroId: string | null;
  excludeFromRandom: boolean;
  hero: {
    id: string;
    name: string;
    author: string | null;
    description: string | null;
    tags: string[];
  } | null;
  isDisabled: boolean;
  resources: Array<{
    id: string;
    disabled: boolean;
    phash: string | null;
    durationMs: number | null;
    funscriptOffsetMs: number | null;
    hasFunscript: boolean;
    invertFunscript: boolean;
  }>;
} {
  return {
    id: entry.id,
    name: entry.name,
    author: entry.author,
    description: entry.description,
    tags: parseTagsJson(entry.tagsJson),
    bpm: entry.bpm,
    difficulty: entry.difficulty,
    phash: entry.phash,
    startTime: entry.startTime,
    endTime: entry.endTime,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
    type: entry.type ?? null,
    installSourceKey: entry.installSourceKey,
    libraryLabel: entry.libraryLabel,
    heroId: entry.heroId,
    excludeFromRandom: entry.excludeFromRandom,
    hero: entry.hero
      ? {
          ...entry.hero,
          tags: parseTagsJson(entry.hero.tagsJson),
        }
      : null,
    isDisabled: entry.isDisabled === true,
    resources: entry.resources.map((resourceEntry) => ({
      id: resourceEntry.id,
      disabled: resourceEntry.disabled,
      phash: resourceEntry.phash,
      durationMs: resourceEntry.durationMs,
      funscriptOffsetMs: resourceEntry.funscriptOffsetMs,
      hasFunscript: Boolean(resourceEntry.funscriptUri),
      invertFunscript: resourceEntry.invertFunscript,
    })),
  };
}

export const dbRouter = router({
  getLocalHighscore: publicProcedure.query(async () => {
    const db = getDb();
    const profile = await db.select().from(gameProfile).where(eq(gameProfile.id, "local")).get();
    return {
      highscore: Math.max(0, profile?.highscore ?? 0),
      highscoreCheatMode: profile?.highscoreCheatMode ?? false,
      highscoreAssisted: profile?.highscoreAssisted ?? false,
      highscoreAssistedSaveMode: profile?.highscoreAssistedSaveMode ?? null,
    };
  }),

  setLocalHighscore: publicProcedure
    .input(
      z.object({
        highscore: z.number().int().min(0),
        cheatMode: z.boolean().optional(),
        assisted: z.boolean().optional(),
        assistedSaveMode: ZPersistablePlaylistSaveMode.nullable().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const db = getDb();
      const clamped = Math.max(0, Math.floor(input.highscore));
      const existing = await db.select().from(gameProfile).where(eq(gameProfile.id, "local")).get();
      const existingHighscore = existing?.highscore ?? 0;
      const nextHighscore = Math.max(existingHighscore, clamped);
      const matchesExistingHighscore = clamped > 0 && clamped === existingHighscore;
      const nextCheatMode =
        clamped > existingHighscore
          ? (input.cheatMode ?? false)
          : matchesExistingHighscore
            ? (existing?.highscoreCheatMode ?? false) || (input.cheatMode ?? false)
            : (existing?.highscoreCheatMode ?? false);
      const nextAssisted =
        clamped > existingHighscore
          ? (input.assisted ?? false)
          : matchesExistingHighscore
            ? (existing?.highscoreAssisted ?? false) || (input.assisted ?? false)
            : (existing?.highscoreAssisted ?? false);
      const mergedAssistedSaveMode =
        clamped > existingHighscore
          ? input.assisted
            ? (input.assistedSaveMode ?? null)
            : null
          : matchesExistingHighscore
            ? existing?.highscoreAssistedSaveMode === "everywhere" ||
              input.assistedSaveMode === "everywhere"
              ? "everywhere"
              : existing?.highscoreAssistedSaveMode === "checkpoint" ||
                  input.assistedSaveMode === "checkpoint"
                ? "checkpoint"
                : null
            : (existing?.highscoreAssistedSaveMode ?? null);
      const nextAssistedSaveMode = nextAssisted ? mergedAssistedSaveMode : null;
      await db
        .insert(gameProfile)
        .values({
          id: "local",
          highscore: nextHighscore,
          highscoreCheatMode: nextCheatMode,
          highscoreAssisted: nextAssisted,
          highscoreAssistedSaveMode: nextAssistedSaveMode,
        })
        .onConflictDoUpdate({
          target: gameProfile.id,
          set: {
            highscore: nextHighscore,
            highscoreCheatMode: nextCheatMode,
            highscoreAssisted: nextAssisted,
            highscoreAssistedSaveMode: nextAssistedSaveMode,
          },
        });
      return {
        highscore: nextHighscore,
        highscoreCheatMode: nextCheatMode,
        highscoreAssisted: nextAssisted,
        highscoreAssistedSaveMode: nextAssistedSaveMode,
      };
    }),

  recordSinglePlayerRun: publicProcedure
    .input(
      z.object({
        finishedAtIso: z.string().min(1).optional(),
        score: z.number().int().min(0),
        survivedDurationSec: z.number().int().min(0).optional().nullable(),
        highscoreBefore: z.number().int().min(0),
        highscoreAfter: z.number().int().min(0),
        wasNewHighscore: z.boolean(),
        completionReason: z.string().min(1),
        playlistId: z.string().min(1).nullable().optional(),
        playlistName: z.string().min(1),
        playlistFormatVersion: z.number().int().min(1).nullable().optional(),
        endingPosition: z.number().int().min(0),
        turn: z.number().int().min(0),
        cheatModeActive: z.boolean().optional(),
        assistedActive: z.boolean().optional(),
        assistedSaveMode: ZPersistablePlaylistSaveMode.nullable().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const db = getDb();
      const [created] = await db
        .insert(singlePlayerRunHistory)
        .values({
          finishedAt: input.finishedAtIso ? new Date(input.finishedAtIso) : new Date(),
          score: input.score,
          survivedDurationSec: input.survivedDurationSec ?? null,
          highscoreBefore: input.highscoreBefore,
          highscoreAfter: input.highscoreAfter,
          wasNewHighscore: input.wasNewHighscore,
          completionReason: input.completionReason,
          playlistId: input.playlistId ?? null,
          playlistName: input.playlistName.trim(),
          playlistFormatVersion: input.playlistFormatVersion ?? null,
          endingPosition: input.endingPosition,
          turn: input.turn,
          cheatModeActive: input.cheatModeActive ?? false,
          assistedActive: input.assistedActive ?? false,
          assistedSaveMode: input.assistedActive ? (input.assistedSaveMode ?? null) : null,
        })
        .returning();
      return created;
    }),

  listSinglePlayerRuns: publicProcedure
    .input(z.object({ limit: z.number().int().min(1).max(200).default(50) }).optional())
    .query(({ input }) => {
      const db = getDb();
      const limit = input?.limit ?? 50;
      return db.query.singlePlayerRunHistory.findMany({
        orderBy: [desc(singlePlayerRunHistory.finishedAt)],
        limit,
      });
    }),

  getSinglePlayerCumLoadCount: publicProcedure.query(async () => {
    const db = getDb();
    const runs = await db.query.singlePlayerRunHistory.findMany();
    return runs.filter(
      (run) =>
        run.completionReason === "self_reported_cum" ||
        run.completionReason === "cum_instruction_failed"
    ).length;
  }),

  beginGameplaySession: publicProcedure
    .input(
      z.object({
        id: z.string().min(1),
        mode: ZGameplayMode,
        sourceId: z.string().min(1),
        playlistId: z.string().min(1).nullable().optional(),
        playlistName: z.string().min(1),
        startedAtIso: z.string().min(1),
        cheatModeActive: z.boolean().optional(),
        assistedActive: z.boolean().optional(),
        assistedSaveMode: ZPersistablePlaylistSaveMode.nullable().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const db = getDb();
      const now = new Date();
      const startedAt = new Date(input.startedAtIso);
      const existing = await db.query.gameplaySession.findFirst({
        where: eq(gameplaySession.sourceId, input.sourceId),
      });
      if (existing) {
        const [updated] = await db
          .update(gameplaySession)
          .set({
            status: "in_progress",
            endedAt: null,
            lastActiveAt: now,
            updatedAt: now,
          })
          .where(eq(gameplaySession.id, existing.id))
          .returning();
        return updated;
      }
      const openSessions = await db.query.gameplaySession.findMany({
        where: eq(gameplaySession.status, "in_progress"),
      });
      for (const open of openSessions) {
        await db
          .update(gameplaySession)
          .set({ status: "abandoned", endedAt: open.lastActiveAt, updatedAt: now })
          .where(eq(gameplaySession.id, open.id));
        await db
          .update(gameplayRoundPlay)
          .set({ status: "abandoned", finishedAt: open.lastActiveAt, updatedAt: now })
          .where(
            and(eq(gameplayRoundPlay.sessionId, open.id), eq(gameplayRoundPlay.status, "playing"))
          );
      }
      const [created] = await db
        .insert(gameplaySession)
        .values({
          id: input.id,
          mode: input.mode,
          sourceId: input.sourceId,
          playlistId: input.playlistId ?? null,
          playlistName: input.playlistName.trim(),
          startedAt,
          lastActiveAt: now,
          cheatModeActive: input.cheatModeActive ?? false,
          assistedActive: input.assistedActive ?? false,
          assistedSaveMode: input.assistedActive ? (input.assistedSaveMode ?? null) : null,
        })
        .returning();
      return created;
    }),

  updateGameplaySessionActivity: publicProcedure
    .input(
      z.object({
        id: z.string().min(1),
        activePlayMs: z.number().int().min(0),
        lastActiveAtIso: z.string().min(1).optional(),
      })
    )
    .mutation(async ({ input }) => {
      const db = getDb();
      const existing = await db.query.gameplaySession.findFirst({
        where: eq(gameplaySession.id, input.id),
      });
      if (!existing) return null;
      const [updated] = await db
        .update(gameplaySession)
        .set({
          activePlayMs: Math.max(existing.activePlayMs, input.activePlayMs),
          lastActiveAt: input.lastActiveAtIso ? new Date(input.lastActiveAtIso) : new Date(),
          updatedAt: new Date(),
        })
        .where(eq(gameplaySession.id, input.id))
        .returning();
      return updated ?? null;
    }),

  finishGameplaySession: publicProcedure
    .input(
      z.object({
        id: z.string().min(1),
        activePlayMs: z.number().int().min(0),
        status: ZGameplaySessionStatus.exclude(["in_progress"]),
        completionReason: z.string().nullable().optional(),
        score: z.number().int().min(0).nullable().optional(),
        completedRounds: z.number().int().min(0).optional(),
        singlePlayerRunId: z.string().min(1).nullable().optional(),
        endedAtIso: z.string().min(1).optional(),
      })
    )
    .mutation(async ({ input }) => {
      const db = getDb();
      const existing = await db.query.gameplaySession.findFirst({
        where: eq(gameplaySession.id, input.id),
      });
      if (!existing) return null;
      const endedAt = input.endedAtIso ? new Date(input.endedAtIso) : new Date();
      const [updated] = await db
        .update(gameplaySession)
        .set({
          activePlayMs: Math.max(existing.activePlayMs, input.activePlayMs),
          lastActiveAt: endedAt,
          endedAt,
          status: input.status,
          completionReason: input.completionReason ?? null,
          score: input.score ?? null,
          completedRounds: input.completedRounds ?? existing.completedRounds,
          singlePlayerRunId: input.singlePlayerRunId ?? existing.singlePlayerRunId,
          updatedAt: new Date(),
        })
        .where(eq(gameplaySession.id, input.id))
        .returning();
      await db
        .update(gameplayRoundPlay)
        .set({ status: "abandoned", finishedAt: endedAt, updatedAt: new Date() })
        .where(
          and(eq(gameplayRoundPlay.sessionId, input.id), eq(gameplayRoundPlay.status, "playing"))
        );
      return updated ?? null;
    }),

  upsertGameplayRoundPlay: publicProcedure
    .input(
      z.object({
        id: z.string().min(1),
        sessionId: z.string().min(1),
        mode: ZGameplayMode,
        playlistId: z.string().min(1).nullable().optional(),
        playlistName: z.string().min(1),
        roundId: z.string().min(1),
        roundName: z.string().min(1),
        roundType: ZRoundType,
        phaseKind: ZRoundPhaseKind,
        nodeId: z.string().nullable().optional(),
        poolId: z.string().nullable().optional(),
        startedAtIso: z.string().min(1),
        finishedAtIso: z.string().min(1).nullable().optional(),
        scheduledDurationMs: z.number().int().min(0).nullable().optional(),
        watchedDurationMs: z.number().int().min(0),
        status: ZRoundPlayStatus,
        cumOutcome: ZRoundCumOutcome.nullable().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const db = getDb();
      const existing = await db.query.gameplayRoundPlay.findFirst({
        where: eq(gameplayRoundPlay.id, input.id),
      });
      const session = await db.query.gameplaySession.findFirst({
        where: eq(gameplaySession.id, input.sessionId),
        columns: { status: true, endedAt: true },
      });
      if (!session) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Gameplay session not found." });
      }
      const watchedDurationMs = Math.max(existing?.watchedDurationMs ?? 0, input.watchedDurationMs);
      const values = {
        sessionId: input.sessionId,
        mode: input.mode,
        playlistId: input.playlistId ?? null,
        playlistName: input.playlistName.trim(),
        roundId: input.roundId,
        roundName: input.roundName.trim(),
        roundType: input.roundType,
        phaseKind: input.phaseKind,
        nodeId: input.nodeId ?? null,
        poolId: input.poolId ?? null,
        startedAt: new Date(input.startedAtIso),
        finishedAt: input.finishedAtIso
          ? new Date(input.finishedAtIso)
          : session.status === "in_progress"
            ? null
            : session.endedAt,
        scheduledDurationMs: input.scheduledDurationMs ?? null,
        watchedDurationMs,
        status:
          session.status !== "in_progress" && input.status === "playing"
            ? "abandoned"
            : input.status,
        cumOutcome: input.cumOutcome ?? null,
        updatedAt: new Date(),
      } as const;
      const [row] = await db
        .insert(gameplayRoundPlay)
        .values({ id: input.id, ...values })
        .onConflictDoUpdate({ target: gameplayRoundPlay.id, set: values })
        .returning();
      return row;
    }),

  getGameplayStats: publicProcedure
    .input(z.object({ mode: ZGameplayMode.optional() }).optional())
    .query(async ({ input }) => {
      const db = getDb();
      const sessions = await db.query.gameplaySession.findMany({
        orderBy: [desc(gameplaySession.startedAt)],
      });
      const plays = await db.query.gameplayRoundPlay.findMany({
        orderBy: [desc(gameplayRoundPlay.startedAt)],
      });
      const selectedSessions = input?.mode
        ? sessions.filter((session) => session.mode === input.mode)
        : sessions;
      const selectedPlays = input?.mode ? plays.filter((play) => play.mode === input.mode) : plays;
      const roundMap = new Map<
        string,
        {
          roundId: string;
          roundName: string;
          roundType: "Normal" | "Interjection" | "Cum";
          modes: Set<"single_player" | "multiplayer">;
          playCount: number;
          watchedDurationMs: number;
          scheduledDurationMs: number;
          watchedCoverageCount: number;
          scheduledCoverageCount: number;
          cumLosses: number;
          cameAsTold: number;
          didNotCum: number;
          lastPlayedAt: Date;
        }
      >();
      for (const play of selectedPlays) {
        const current = roundMap.get(play.roundId) ?? {
          roundId: play.roundId,
          roundName: play.roundName,
          roundType: play.roundType,
          modes: new Set<"single_player" | "multiplayer">(),
          playCount: 0,
          watchedDurationMs: 0,
          scheduledDurationMs: 0,
          watchedCoverageCount: 0,
          scheduledCoverageCount: 0,
          cumLosses: 0,
          cameAsTold: 0,
          didNotCum: 0,
          lastPlayedAt: play.startedAt,
        };
        current.roundName = play.roundName;
        current.roundType = play.roundType;
        current.modes.add(play.mode);
        current.playCount += 1;
        if (!play.isLegacy) {
          current.watchedDurationMs += play.watchedDurationMs;
          current.watchedCoverageCount += 1;
        }
        if (play.scheduledDurationMs !== null) {
          current.scheduledDurationMs += play.scheduledDurationMs;
          current.scheduledCoverageCount += 1;
        }
        if (play.cumOutcome === "manual_loss" || play.cumOutcome === "failed_instruction")
          current.cumLosses += 1;
        if (play.cumOutcome === "came_as_told") current.cameAsTold += 1;
        if (play.cumOutcome === "did_not_cum") current.didNotCum += 1;
        if (play.startedAt > current.lastPlayedAt) current.lastPlayedAt = play.startedAt;
        roundMap.set(play.roundId, current);
      }
      const unassignedLegacyOutcomes = selectedSessions.filter(
        (session) =>
          session.isLegacy &&
          (session.completionReason === "self_reported_cum" ||
            session.completionReason === "cum_instruction_failed" ||
            session.completionReason === "cum_point_instruction_failed")
      ).length;
      return {
        summary: {
          activePlayMs: selectedSessions.reduce((total, row) => total + row.activePlayMs, 0),
          watchedDurationMs: selectedPlays.reduce(
            (total, row) => total + (row.isLegacy ? 0 : row.watchedDurationMs),
            0
          ),
          scheduledDurationMs: selectedPlays.reduce(
            (total, row) => total + (row.scheduledDurationMs ?? 0),
            0
          ),
          sessionCount: selectedSessions.length,
          roundPlayCount: selectedPlays.filter((row) => row.roundType !== "Interjection").length,
          interjectionPlayCount: selectedPlays.filter((row) => row.roundType === "Interjection")
            .length,
          cumLosses: selectedPlays.filter(
            (row) => row.cumOutcome === "manual_loss" || row.cumOutcome === "failed_instruction"
          ).length,
          cameAsTold: selectedPlays.filter((row) => row.cumOutcome === "came_as_told").length,
        },
        coverage: {
          hasLegacyData:
            selectedSessions.some((row) => row.isLegacy) ||
            selectedPlays.some((row) => row.isLegacy),
          watchedPlayCount: selectedPlays.filter((row) => !row.isLegacy).length,
          scheduledPlayCount: selectedPlays.filter((row) => row.scheduledDurationMs !== null)
            .length,
          totalPlayCount: selectedPlays.length,
        },
        unassignedLegacyOutcomes,
        rounds: [...roundMap.values()].map((row) => ({ ...row, modes: [...row.modes] })),
      };
    }),

  listGameplaySessions: publicProcedure
    .input(
      z
        .object({
          mode: ZGameplayMode.optional(),
          limit: z.number().int().min(1).max(100).default(25),
          beforeIso: z.string().min(1).optional(),
        })
        .optional()
    )
    .query(async ({ input }) => {
      const db = getDb();
      const rows = await db.query.gameplaySession.findMany({
        orderBy: [desc(gameplaySession.startedAt)],
        limit: 500,
      });
      const filtered = rows
        .filter((row) => !input?.mode || row.mode === input.mode)
        .filter((row) => !input?.beforeIso || row.startedAt < new Date(input.beforeIso));
      const limit = input?.limit ?? 25;
      const page = filtered.slice(0, limit);
      const sessions = await Promise.all(
        page.map(async (session) => ({
          ...session,
          rounds: await db.query.gameplayRoundPlay.findMany({
            where: eq(gameplayRoundPlay.sessionId, session.id),
            orderBy: [asc(gameplayRoundPlay.startedAt)],
          }),
        }))
      );
      return {
        sessions,
        nextCursor:
          filtered.length > limit ? (page[page.length - 1]?.startedAt.toISOString() ?? null) : null,
      };
    }),

  upsertSinglePlayerRunSave: publicProcedure
    .input(
      z.object({
        playlistId: z.string().min(1),
        playlistName: z.string().min(1),
        playlistFormatVersion: z.number().int().min(1).nullable().optional(),
        saveMode: ZPersistablePlaylistSaveMode,
        snapshot: ZSinglePlayerRunSaveSnapshot,
      })
    )
    .mutation(async ({ input }) => {
      const db = getDb();
      const snapshot = ZSinglePlayerRunSaveSnapshot.parse(input.snapshot);
      const [saved] = await db
        .insert(singlePlayerRunSave)
        .values({
          playlistId: input.playlistId,
          playlistName: input.playlistName.trim(),
          playlistFormatVersion: input.playlistFormatVersion ?? null,
          saveMode: input.saveMode,
          snapshotJson: snapshot,
          savedAt: new Date(snapshot.savedAtMs),
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: singlePlayerRunSave.playlistId,
          set: {
            playlistName: input.playlistName.trim(),
            playlistFormatVersion: input.playlistFormatVersion ?? null,
            saveMode: input.saveMode,
            snapshotJson: snapshot,
            savedAt: new Date(snapshot.savedAtMs),
            updatedAt: new Date(),
          },
        })
        .returning();
      return saved;
    }),

  getSinglePlayerRunSave: publicProcedure
    .input(z.object({ playlistId: z.string().min(1) }))
    .query(async ({ input }) => {
      const db = getDb();
      const row = await db.query.singlePlayerRunSave.findFirst({
        where: eq(singlePlayerRunSave.playlistId, input.playlistId),
      });
      if (!row) return null;
      const rawSnapshot =
        typeof row.snapshotJson === "string" ? JSON.parse(row.snapshotJson) : row.snapshotJson;
      return {
        ...row,
        snapshotJson: ZSinglePlayerRunSaveSnapshot.parse(rawSnapshot),
      };
    }),

  listSinglePlayerRunSaves: publicProcedure.query(async () => {
    const db = getDb();
    return db.query.singlePlayerRunSave.findMany({
      orderBy: [desc(singlePlayerRunSave.savedAt)],
    });
  }),

  deleteSinglePlayerRunSaveByPlaylist: publicProcedure
    .input(z.object({ playlistId: z.string().min(1) }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const [deleted] = await db
        .delete(singlePlayerRunSave)
        .where(eq(singlePlayerRunSave.playlistId, input.playlistId))
        .returning();
      return deleted ?? null;
    }),

  deleteSinglePlayerRun: publicProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const gameplaySessionQuery = (
        db.query as typeof db.query & {
          gameplaySession?: typeof db.query.gameplaySession;
        }
      ).gameplaySession;
      const linkedSessions = gameplaySessionQuery
        ? await gameplaySessionQuery.findMany({
            where: eq(gameplaySession.singlePlayerRunId, input.id),
            columns: { id: true },
          })
        : [];
      const [deleted] = await db
        .delete(singlePlayerRunHistory)
        .where(eq(singlePlayerRunHistory.id, input.id))
        .returning();

      if (!deleted) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Single-player run not found.",
        });
      }

      for (const session of linkedSessions) {
        await db.delete(gameplaySession).where(eq(gameplaySession.id, session.id));
      }

      const remainingRuns = await db.query.singlePlayerRunHistory.findMany({
        orderBy: [desc(singlePlayerRunHistory.finishedAt)],
        limit: 10_000,
      });
      const nextHighscore = remainingRuns.reduce((best, run) => Math.max(best, run.score), 0);
      const topRuns =
        nextHighscore > 0 ? remainingRuns.filter((run) => run.score === nextHighscore) : [];
      const nextHighscoreCheatMode = topRuns.some((run) => run.cheatModeActive);
      const nextHighscoreAssisted = topRuns.some((run) => run.assistedActive);
      const nextHighscoreAssistedSaveMode = nextHighscoreAssisted
        ? topRuns.some((run) => run.assistedSaveMode === "everywhere")
          ? "everywhere"
          : "checkpoint"
        : null;

      await db
        .insert(gameProfile)
        .values({
          id: "local",
          highscore: nextHighscore,
          highscoreCheatMode: nextHighscoreCheatMode,
          highscoreAssisted: nextHighscoreAssisted,
          highscoreAssistedSaveMode: nextHighscoreAssistedSaveMode,
        })
        .onConflictDoUpdate({
          target: gameProfile.id,
          set: {
            highscore: nextHighscore,
            highscoreCheatMode: nextHighscoreCheatMode,
            highscoreAssisted: nextHighscoreAssisted,
            highscoreAssistedSaveMode: nextHighscoreAssistedSaveMode,
          },
        });

      return {
        deleted,
        highscore: nextHighscore,
        highscoreCheatMode: nextHighscoreCheatMode,
        highscoreAssisted: nextHighscoreAssisted,
        highscoreAssistedSaveMode: nextHighscoreAssistedSaveMode,
      };
    }),

  upsertMultiplayerMatchCache: publicProcedure
    .input(
      z.object({
        lobbyId: z.string().min(1),
        finishedAtIso: z.string().min(1),
        isFinal: z.boolean().default(false),
        resultsJson: z.unknown(),
      })
    )
    .mutation(async ({ input }) => {
      const db = getDb();
      const [created] = await db
        .insert(multiplayerMatchCache)
        .values({
          lobbyId: input.lobbyId,
          finishedAt: new Date(input.finishedAtIso),
          isFinal: input.isFinal,
          resultsJson: input.resultsJson,
        })
        .onConflictDoUpdate({
          target: multiplayerMatchCache.lobbyId,
          set: {
            finishedAt: new Date(input.finishedAtIso),
            isFinal: input.isFinal,
            resultsJson: input.resultsJson,
            updatedAt: new Date(),
          },
        })
        .returning();
      return created;
    }),

  getMultiplayerMatchCache: publicProcedure
    .input(z.object({ lobbyId: z.string().min(1) }))
    .query(({ input }) => {
      const db = getDb();
      return db.query.multiplayerMatchCache.findFirst({
        where: eq(multiplayerMatchCache.lobbyId, input.lobbyId),
      });
    }),

  listMultiplayerMatchCache: publicProcedure
    .input(z.object({ limit: z.number().int().min(1).max(200).default(50) }).optional())
    .query(({ input }) => {
      const db = getDb();
      const limit = input?.limit ?? 50;
      return db.query.multiplayerMatchCache.findMany({
        orderBy: [desc(multiplayerMatchCache.finishedAt)],
        limit,
      });
    }),

  enqueueResultSyncLobby: publicProcedure
    .input(z.object({ lobbyId: z.string().min(1) }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const [created] = await db
        .insert(resultSyncQueue)
        .values({
          lobbyId: input.lobbyId,
        })
        .onConflictDoNothing({ target: resultSyncQueue.lobbyId })
        .returning();
      return created;
    }),

  touchResultSyncLobby: publicProcedure
    .input(z.object({ lobbyId: z.string().min(1) }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const now = new Date();
      const [created] = await db
        .insert(resultSyncQueue)
        .values({
          lobbyId: input.lobbyId,
          lastAttemptAt: now,
        })
        .onConflictDoUpdate({
          target: resultSyncQueue.lobbyId,
          set: { lastAttemptAt: now },
        })
        .returning();
      return created;
    }),

  listResultSyncLobbies: publicProcedure.query(() => {
    const db = getDb();
    return db.query.resultSyncQueue.findMany({
      orderBy: [asc(resultSyncQueue.createdAt)],
    });
  }),

  removeResultSyncLobby: publicProcedure
    .input(z.object({ lobbyId: z.string().min(1) }))
    .mutation(async ({ input }) => {
      const db = getDb();
      return db
        .delete(resultSyncQueue)
        .where(eq(resultSyncQueue.lobbyId, input.lobbyId))
        .returning();
    }),

  getHeroes: publicProcedure.query(() => {
    const db = getDb();
    return db.query.hero.findMany().then((entries) =>
      entries.map((entry) => ({
        ...entry,
        tags: parseTagsJson(entry.tagsJson),
      }))
    );
  }),

  abortInstallScan: publicProcedure.mutation(() => {
    return requestInstallScanAbort();
  }),

  updateHero: publicProcedure
    .input(
      z.object({
        id: z.string().min(1),
        name: z.string().trim().min(1),
        author: ZNullableText,
        description: ZNullableText,
        tags: ZTagList,
      })
    )
    .mutation(async ({ input }) => {
      const db = getDb();
      const existing = await db.query.hero.findFirst({
        where: eq(hero.id, input.id),
      });
      if (!existing) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Hero not found.",
        });
      }

      const trimmedName = input.name.trim();
      const conflict = await db.query.hero.findFirst({
        where: eq(hero.name, trimmedName),
      });
      if (conflict && conflict.id !== input.id) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Another hero already uses that name.",
        });
      }

      const [updated] = await db
        .update(hero)
        .set({
          name: trimmedName,
          author: normalizeTextMetadata(input.author),
          description: normalizeTextMetadata(input.description),
          tagsJson: JSON.stringify(normalizeTags(input.tags)),
          updatedAt: new Date(),
        })
        .where(eq(hero.id, input.id))
        .returning();
      return { ...updated, tags: parseTagsJson(updated.tagsJson) };
    }),

  updateHeroFunscript: publicProcedure
    .input(
      z.object({
        heroId: z.string().min(1),
        funscriptUri: z.string().trim().min(1).nullable(),
      })
    )
    .mutation(async ({ input }) => {
      const db = getDb();
      const existing = await db.query.hero.findFirst({
        where: eq(hero.id, input.heroId),
        columns: { id: true },
      });
      if (!existing) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Hero not found.",
        });
      }

      const attachedRounds = await db.query.round.findMany({
        where: eq(round.heroId, input.heroId),
        columns: { id: true },
        with: {
          resources: {
            orderBy: [asc(resource.createdAt), asc(resource.id)],
            columns: { id: true },
          },
        },
      });

      const normalizedFunscriptUri = input.funscriptUri?.trim() || null;
      let updatedResources = 0;
      let skippedRounds = 0;

      for (const attachedRound of attachedRounds) {
        const primaryResource = attachedRound.resources[0];
        if (!primaryResource) {
          skippedRounds += 1;
          continue;
        }

        await db
          .update(resource)
          .set({
            funscriptUri: normalizedFunscriptUri,
            updatedAt: new Date(),
          })
          .where(eq(resource.id, primaryResource.id));
        updatedResources += 1;
      }

      return {
        heroId: input.heroId,
        funscriptUri: normalizedFunscriptUri,
        updatedResources,
        skippedRounds,
      };
    }),

  updateHeroFunscriptOffset: publicProcedure
    .input(
      z.object({
        heroId: z.string().min(1),
        offsetMs: z.number().int().nullable(),
      })
    )
    .mutation(async ({ input }) => {
      const db = getDb();
      const existing = await db.query.hero.findFirst({
        where: eq(hero.id, input.heroId),
        columns: { id: true },
      });
      if (!existing) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Hero not found.",
        });
      }

      const funscriptOffsetMs = normalizeFunscriptOffsetMs(input.offsetMs);
      const attachedRounds = await db.query.round.findMany({
        where: eq(round.heroId, input.heroId),
        columns: { id: true },
        with: {
          resources: {
            orderBy: [asc(resource.createdAt), asc(resource.id)],
            columns: { id: true },
          },
        },
      });

      let updatedResources = 0;
      let skippedRounds = 0;
      await db.transaction(async (tx) => {
        for (const attachedRound of attachedRounds) {
          const primaryResource = attachedRound.resources[0];
          if (!primaryResource) {
            skippedRounds += 1;
            continue;
          }
          await tx
            .update(resource)
            .set({ funscriptOffsetMs, updatedAt: new Date() })
            .where(eq(resource.id, primaryResource.id));
          updatedResources += 1;
        }
      });

      return {
        heroId: input.heroId,
        funscriptOffsetMs,
        updatedResources,
        skippedRounds,
      };
    }),

  convertFunscriptToHardMode: publicProcedure
    .input(z.object({ funscriptUri: z.string().trim().min(1) }))
    .mutation(async ({ input }) => {
      try {
        return await convertFunscriptUriToManagedHardMode(input.funscriptUri);
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: error instanceof Error ? error.message : "Failed to convert the funscript.",
        });
      }
    }),

  convertHeroFunscriptToHardMode: publicProcedure
    .input(
      z.object({
        heroId: z.string().min(1),
        recalculateDifficulty: z.boolean().optional().default(false),
      })
    )
    .mutation(async ({ input }) => {
      const db = getDb();
      const existing = await db.query.hero.findFirst({
        where: eq(hero.id, input.heroId),
        columns: { id: true },
      });
      if (!existing) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Hero not found.",
        });
      }

      const attachedRounds = await db.query.round.findMany({
        where: eq(round.heroId, input.heroId),
        columns: { id: true },
        with: {
          resources: {
            orderBy: [asc(resource.createdAt), asc(resource.id)],
            columns: { id: true, videoUri: true, funscriptUri: true },
          },
        },
      });
      const primaryResourceIds = attachedRounds
        .map((attachedRound) => attachedRound.resources[0]?.id ?? null)
        .filter((id): id is string => id !== null);
      const skippedRounds = attachedRounds.length - primaryResourceIds.length;

      if (primaryResourceIds.length === 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "This hero has no resource-backed rounds to update.",
        });
      }
      const sourceResource = attachedRounds
        .map((attachedRound) => attachedRound.resources[0])
        .find((entry) => Boolean(entry?.funscriptUri));
      if (!sourceResource?.funscriptUri) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "This hero has no funscript attached to a primary round resource.",
        });
      }

      const resolvedSource = createResourceUriResolver()(sourceResource).funscriptUri;
      let converted: Awaited<ReturnType<typeof convertFunscriptUriToManagedHardMode>>;
      try {
        converted = await convertFunscriptUriToManagedHardMode(resolvedSource!);
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: error instanceof Error ? error.message : "Failed to convert the funscript.",
        });
      }
      const recalculatedDifficulty = input.recalculateDifficulty
        ? await calculateFunscriptDifficultyFromUri(converted.funscriptUri)
        : null;
      if (input.recalculateDifficulty && recalculatedDifficulty === null) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Could not recalculate difficulty from the converted hard-mode script.",
        });
      }

      await recordHardModeAttachmentReverts(
        attachedRounds.flatMap((attachedRound) => {
          const primaryResource = attachedRound.resources[0];
          return primaryResource
            ? [
                {
                  resourceId: primaryResource.id,
                  hardModeFunscriptUri: converted.funscriptUri,
                  previousFunscriptUri: primaryResource.funscriptUri,
                },
              ]
            : [];
        })
      );

      await db.transaction(async (tx) => {
        for (const primaryResourceId of primaryResourceIds) {
          await tx
            .update(resource)
            .set({
              funscriptUri: converted.funscriptUri,
              updatedAt: new Date(),
            })
            .where(eq(resource.id, primaryResourceId));
        }
        if (recalculatedDifficulty !== null) {
          for (const attachedRound of attachedRounds) {
            if (!attachedRound.resources[0]) continue;
            await tx
              .update(round)
              .set({ difficulty: recalculatedDifficulty, updatedAt: new Date() })
              .where(eq(round.id, attachedRound.id));
          }
        }
      });

      return {
        heroId: input.heroId,
        funscriptUri: converted.funscriptUri,
        updatedResources: primaryResourceIds.length,
        skippedRounds,
        sourceActions: converted.sourceActions,
        outputActions: converted.outputActions,
        recalculatedDifficulty,
      };
    }),

  convertRoundFunscriptToHardMode: publicProcedure
    .input(
      z.object({
        roundId: z.string().min(1),
        recalculateDifficulty: z.boolean().optional().default(false),
      })
    )
    .mutation(async ({ input }) => {
      const db = getDb();
      const selectedRound = await db.query.round.findFirst({
        where: eq(round.id, input.roundId),
        columns: { id: true, heroId: true },
        with: {
          resources: {
            orderBy: [asc(resource.createdAt), asc(resource.id)],
            columns: { id: true, videoUri: true, funscriptUri: true },
          },
        },
      });
      if (!selectedRound) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Round not found." });
      }

      const sourceResource = selectedRound.resources[0];
      if (!sourceResource) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "This round has no media resource.",
        });
      }
      if (!sourceResource.funscriptUri) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "This round has no funscript attached.",
        });
      }

      const targetRounds = selectedRound.heroId
        ? await db.query.round.findMany({
            where: eq(round.heroId, selectedRound.heroId),
            columns: { id: true },
            with: {
              resources: {
                orderBy: [asc(resource.createdAt), asc(resource.id)],
                columns: { id: true, funscriptUri: true },
              },
            },
          })
        : [selectedRound];
      const primaryResourceIds = targetRounds
        .map((entry) => entry.resources[0]?.id ?? null)
        .filter((id): id is string => id !== null);
      const skippedRounds = targetRounds.length - primaryResourceIds.length;

      const resolvedSource = createResourceUriResolver()(sourceResource).funscriptUri;
      let converted: Awaited<ReturnType<typeof convertFunscriptUriToManagedHardMode>>;
      try {
        converted = await convertFunscriptUriToManagedHardMode(resolvedSource!);
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: error instanceof Error ? error.message : "Failed to convert the funscript.",
        });
      }
      const recalculatedDifficulty = input.recalculateDifficulty
        ? await calculateFunscriptDifficultyFromUri(converted.funscriptUri)
        : null;
      if (input.recalculateDifficulty && recalculatedDifficulty === null) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Could not recalculate difficulty from the converted hard-mode script.",
        });
      }

      await recordHardModeAttachmentReverts(
        targetRounds.flatMap((entry) => {
          const primaryResource = entry.resources[0];
          return primaryResource
            ? [
                {
                  resourceId: primaryResource.id,
                  hardModeFunscriptUri: converted.funscriptUri,
                  previousFunscriptUri: primaryResource.funscriptUri,
                },
              ]
            : [];
        })
      );

      await db.transaction(async (tx) => {
        for (const primaryResourceId of primaryResourceIds) {
          await tx
            .update(resource)
            .set({ funscriptUri: converted.funscriptUri, updatedAt: new Date() })
            .where(eq(resource.id, primaryResourceId));
        }
        if (recalculatedDifficulty !== null) {
          for (const targetRound of targetRounds) {
            if (!targetRound.resources[0]) continue;
            await tx
              .update(round)
              .set({ difficulty: recalculatedDifficulty, updatedAt: new Date() })
              .where(eq(round.id, targetRound.id));
          }
        }
      });

      return {
        scope: selectedRound.heroId ? ("hero" as const) : ("round" as const),
        heroId: selectedRound.heroId,
        roundId: selectedRound.id,
        funscriptUri: converted.funscriptUri,
        updatedResources: primaryResourceIds.length,
        skippedRounds,
        sourceActions: converted.sourceActions,
        outputActions: converted.outputActions,
        recalculatedDifficulty,
      };
    }),

  revertRoundHardModeFunscript: publicProcedure
    .input(z.object({ roundId: z.string().min(1) }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const selectedRound = await db.query.round.findFirst({
        where: eq(round.id, input.roundId),
        columns: { id: true, heroId: true },
        with: {
          resources: {
            orderBy: [asc(resource.createdAt), asc(resource.id)],
            columns: { id: true, funscriptUri: true },
          },
        },
      });
      if (!selectedRound) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Round not found." });
      }

      const targetRounds = selectedRound.heroId
        ? await db.query.round.findMany({
            where: eq(round.heroId, selectedRound.heroId),
            columns: { id: true },
            with: {
              resources: {
                orderBy: [asc(resource.createdAt), asc(resource.id)],
                columns: { id: true, funscriptUri: true },
              },
            },
          })
        : [selectedRound];
      const skippedRounds = targetRounds.filter((entry) => !entry.resources[0]).length;
      const resourceBackedRounds = targetRounds.filter((entry) => Boolean(entry.resources[0]));
      const restores: Array<{ resourceId: string; funscriptUri: string | null }> = [];

      for (const targetRound of targetRounds) {
        const primaryResource = targetRound.resources[0];
        if (!primaryResource?.funscriptUri) continue;
        const record = await getHardModeAttachmentRevert(
          primaryResource.id,
          primaryResource.funscriptUri
        );
        if (record) {
          restores.push({
            resourceId: primaryResource.id,
            funscriptUri: record.previousFunscriptUri,
          });
        }
      }

      if (restores.length !== resourceBackedRounds.length) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: selectedRound.heroId
            ? "A previous funscript attachment is not available for every round in this hero."
            : "No previous funscript attachment is available for this round.",
        });
      }

      await db.transaction(async (tx) => {
        for (const restore of restores) {
          await tx
            .update(resource)
            .set({ funscriptUri: restore.funscriptUri, updatedAt: new Date() })
            .where(eq(resource.id, restore.resourceId));
        }
      });

      const selectedRestore = restores.find(
        (entry) => entry.resourceId === selectedRound.resources[0]?.id
      );
      return {
        scope: selectedRound.heroId ? ("hero" as const) : ("round" as const),
        heroId: selectedRound.heroId,
        roundId: selectedRound.id,
        funscriptUri: selectedRestore?.funscriptUri ?? null,
        updatedResources: restores.length,
        skippedRounds,
      };
    }),

  getRoundHardModeFunscriptStatus: publicProcedure
    .input(z.object({ roundId: z.string().min(1) }))
    .query(async ({ input }) => {
      const db = getDb();
      const selectedRound = await db.query.round.findFirst({
        where: eq(round.id, input.roundId),
        columns: { id: true },
        with: {
          resources: {
            orderBy: [asc(resource.createdAt), asc(resource.id)],
            columns: { id: true, funscriptUri: true },
          },
        },
      });
      const primaryResource = selectedRound?.resources[0];
      if (!primaryResource?.funscriptUri) return { converted: false };

      const revert = await getHardModeAttachmentRevert(
        primaryResource.id,
        primaryResource.funscriptUri
      );
      return { converted: Boolean(revert) };
    }),

  deleteHero: publicProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const existing = await db.query.hero.findFirst({
        where: eq(hero.id, input.id),
        columns: { id: true },
      });
      if (!existing) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Hero not found.",
        });
      }

      await db.transaction(async (tx) => {
        const attachedRounds = await tx
          .select({ id: round.id })
          .from(round)
          .where(eq(round.heroId, input.id));
        const attachedRoundIds = attachedRounds.map((entry) => entry.id);

        if (attachedRoundIds.length > 0) {
          await tx.delete(round).where(inArray(round.id, attachedRoundIds));
        }

        await tx.delete(hero).where(eq(hero.id, input.id));
      });
      return { deleted: true };
    }),

  getHeroRounds: publicProcedure.input(z.object({ heroId: z.string() })).query(({ input }) => {
    const db = getDb();
    return withInstalledLibrarySchemaRepair(() =>
      db.query.round.findMany({
        where: eq(round.heroId, input.heroId),
      })
    );
  }),

  updateRound: publicProcedure
    .input(
      z.object({
        id: z.string().min(1),
        name: z.string().trim().min(1),
        author: ZNullableText,
        description: ZNullableText,
        tags: ZTagList,
        bpm: z.number().finite().min(1).max(400).optional().nullable(),
        difficulty: z.number().int().min(1).max(5).optional().nullable(),
        startTime: z.number().int().min(0).optional().nullable(),
        endTime: z.number().int().min(0).optional().nullable(),
        funscriptUri: z.string().trim().min(1).optional().nullable(),
        funscriptOffsetMs: z.number().int().optional().nullable(),
        invertFunscript: z.boolean().optional(),
        type: ZRoundType,
        excludeFromRandom: z.boolean().optional(),
        libraryLabel: ZNullableText,
      })
    )
    .mutation(async ({ input }) => {
      const db = getDb();
      const existing = await db.query.round.findFirst({
        where: eq(round.id, input.id),
        columns: { id: true, startTime: true, endTime: true, previewImage: true },
        with: {
          resources: {
            orderBy: [asc(resource.createdAt), asc(resource.id)],
            columns: { id: true },
          },
        },
      });
      if (!existing) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Round not found.",
        });
      }

      const startTime = input.startTime ?? null;
      const endTime = input.endTime ?? null;
      if (startTime !== null && endTime !== null && endTime <= startTime) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Round end time must be greater than start time.",
        });
      }

      if (input.funscriptUri !== undefined) {
        const primaryResource = existing.resources[0];
        if (!primaryResource) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "This round has no attached resource to update.",
          });
        }

        await db
          .update(resource)
          .set({
            funscriptUri: input.funscriptUri?.trim() || null,
            updatedAt: new Date(),
          })
          .where(eq(resource.id, primaryResource.id));
      }

      if (input.funscriptOffsetMs !== undefined) {
        const primaryResource = existing.resources[0];
        if (!primaryResource) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "This round has no attached resource to update.",
          });
        }

        await db
          .update(resource)
          .set({
            funscriptOffsetMs: normalizeFunscriptOffsetMs(input.funscriptOffsetMs),
            updatedAt: new Date(),
          })
          .where(eq(resource.id, primaryResource.id));
      }

      if (input.invertFunscript !== undefined) {
        const primaryResource = existing.resources[0];
        if (!primaryResource) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "This round has no attached resource to update.",
          });
        }

        await db
          .update(resource)
          .set({
            invertFunscript: input.invertFunscript,
            updatedAt: new Date(),
          })
          .where(eq(resource.id, primaryResource.id));
      }

      const needsNewPreview =
        startTime !== (existing?.startTime ?? null) || endTime !== (existing?.endTime ?? null);

      let previewImage = existing?.previewImage ?? null;
      if (needsNewPreview && existing.resources[0]) {
        const r = await db.query.resource.findFirst({
          where: (res, { eq }) => eq(res.roundId, input.id),
        });
        if (r) {
          previewImage = await generateRoundPreviewImageDataUri({
            videoUri: r.videoUri,
            startTimeMs: startTime,
            endTimeMs: endTime,
          });
        }
      }

      const [updated] = await db
        .update(round)
        .set({
          name: input.name.trim(),
          author: normalizeTextMetadata(input.author),
          description: normalizeTextMetadata(input.description),
          tagsJson: JSON.stringify(normalizeTags(input.tags)),
          bpm: input.bpm ?? null,
          difficulty: input.difficulty ?? null,
          startTime,
          endTime,
          libraryLabel: normalizeTextMetadata(input.libraryLabel),
          previewImage,
          type: input.type,
          ...(input.excludeFromRandom !== undefined
            ? { excludeFromRandom: input.excludeFromRandom }
            : {}),
          updatedAt: new Date(),
        })
        .where(eq(round.id, input.id))
        .returning();
      return { ...updated, tags: parseTagsJson(updated.tagsJson) };
    }),

  bulkUpdateRoundTags: publicProcedure
    .input(
      z.object({
        roundIds: z.array(z.string().min(1)).min(1),
        mode: z.enum(["replace", "add", "remove"]),
        tags: ZTagList,
      })
    )
    .mutation(async ({ input }) => {
      const db = getDb();
      const roundIds = [...new Set(input.roundIds.map((id) => id.trim()).filter(Boolean))];
      const tags = normalizeTags(input.tags);
      if (roundIds.length === 0) return { updatedCount: 0 };

      const entries = await withInstalledLibrarySchemaRepair(() =>
        db.query.round.findMany({
          where: inArray(round.id, roundIds),
          columns: { id: true, tagsJson: true },
        })
      );

      let updatedCount = 0;
      await db.transaction(async (tx) => {
        for (const entry of entries) {
          const existingTags = parseTagsJson(entry.tagsJson);
          const nextTags =
            input.mode === "replace"
              ? tags
              : input.mode === "add"
                ? normalizeTags([...existingTags, ...tags])
                : normalizeTags(existingTags.filter((tag) => !tags.includes(tag)));

          await tx
            .update(round)
            .set({
              tagsJson: JSON.stringify(nextTags),
              updatedAt: new Date(),
            })
            .where(eq(round.id, entry.id));
          updatedCount += 1;
        }
      });

      return { updatedCount };
    }),

  calculateDifficultyFromFunscript: publicProcedure
    .input(z.object({ funscriptUri: z.string() }))
    .query(async ({ input }) => {
      return calculateFunscriptDifficultyFromUri(input.funscriptUri);
    }),

  recalculateInstalledRoundDifficulties: publicProcedure.mutation(async () => {
    const db = getDb();
    const resolveResourceUrisForRequest = createResourceUriResolver();
    const libraryRounds = await withInstalledLibrarySchemaRepair(() =>
      db.query.round.findMany({
        columns: { id: true },
        with: {
          resources: {
            orderBy: [asc(resource.createdAt), asc(resource.id)],
            columns: {
              id: true,
              videoUri: true,
              funscriptUri: true,
            },
          },
        },
      })
    );
    const installedRounds = libraryRounds.filter((entry) => entry.resources.length > 0);

    let updatedCount = 0;
    let skippedCount = 0;

    for (const installedRound of installedRounds) {
      const primaryResource = installedRound.resources[0];
      if (!primaryResource?.funscriptUri) {
        skippedCount += 1;
        continue;
      }

      try {
        const hardModeRevert = await getHardModeAttachmentRevert(
          primaryResource.id,
          primaryResource.funscriptUri
        );
        const funscriptUri = hardModeRevert
          ? hardModeRevert.hardModeFunscriptUri
          : resolveResourceUrisForRequest(primaryResource).funscriptUri;
        const difficulty = await calculateFunscriptDifficultyFromUri(funscriptUri);
        if (difficulty === null) {
          skippedCount += 1;
          continue;
        }

        await db
          .update(round)
          .set({ difficulty, updatedAt: new Date() })
          .where(eq(round.id, installedRound.id));
        updatedCount += 1;
      } catch {
        skippedCount += 1;
      }
    }

    return {
      totalCount: installedRounds.length,
      updatedCount,
      skippedCount,
    };
  }),

  updateResourceFunscriptOffset: publicProcedure
    .input(
      z.object({
        resourceId: z.string().min(1),
        offsetMs: z.union([z.number().int(), z.literal(Infinity), z.literal(-Infinity)]),
      })
    )
    .mutation(async ({ input }) => {
      const db = getDb();
      const funscriptOffsetMs = normalizeFunscriptOffsetMs(input.offsetMs);
      const existing = await db.query.resource.findFirst({
        where: eq(resource.id, input.resourceId),
        columns: { id: true },
      });
      if (!existing) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Resource not found.",
        });
      }

      await db
        .update(resource)
        .set({ funscriptOffsetMs, updatedAt: new Date() })
        .where(eq(resource.id, input.resourceId));

      return { resourceId: input.resourceId, funscriptOffsetMs };
    }),

  deleteRound: publicProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const existing = await db.query.round.findFirst({
        where: eq(round.id, input.id),
        columns: { id: true },
        with: {
          resources: {
            columns: {
              videoUri: true,
            },
          },
        },
      });
      if (!existing) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Round not found.",
        });
      }

      const deletedRoundWebsiteUrls = collectWebsiteVideoTargetUrls(
        existing.resources.map((entry) => entry.videoUri)
      );
      await db.delete(round).where(eq(round.id, input.id));
      await cleanupDeletedRoundWebsiteCache(deletedRoundWebsiteUrls);

      return { deleted: true };
    }),

  deleteRounds: publicProcedure
    .input(z.object({ ids: z.array(z.string().min(1)).min(1) }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const requestedIds = [...new Set(input.ids)];
      const existingRounds = (
        await Promise.all(
          chunkArray(requestedIds, ROUND_DELETE_CHUNK_SIZE).map((idChunk) =>
            db.query.round.findMany({
              where: inArray(round.id, idChunk),
              columns: {
                id: true,
              },
              with: {
                resources: {
                  columns: {
                    videoUri: true,
                  },
                },
              },
            })
          )
        )
      ).flat();

      const existingIds = new Set(existingRounds.map((entry) => entry.id));
      const missingIds = requestedIds.filter((id) => !existingIds.has(id));
      const existingIdList = [...existingIds];
      const deletedRoundWebsiteUrls = collectWebsiteVideoTargetUrls(
        existingRounds.flatMap((entry) =>
          entry.resources.map((resourceEntry) => resourceEntry.videoUri)
        )
      );

      for (const idChunk of chunkArray(existingIdList, ROUND_DELETE_CHUNK_SIZE)) {
        await db.delete(round).where(inArray(round.id, idChunk));
      }
      await cleanupDeletedRoundWebsiteCache(deletedRoundWebsiteUrls);

      return {
        deleted: true,
        deletedCount: existingIdList.length,
        requestedCount: requestedIds.length,
        missingIds,
      };
    }),

  createWebsiteRound: publicProcedure
    .input(
      z.object({
        name: z.string().trim().min(1),
        videoUri: z.string().trim().min(1),
        funscriptUri: z.string().trim().min(1).optional().nullable(),
      })
    )
    .mutation(async ({ input }) => {
      const db = getDb();
      let normalizedVideoUri: string;
      let normalizedFunscriptUri: string | null = null;

      try {
        normalizedVideoUri = normalizeHttpUrl(input.videoUri);
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            error instanceof Error ? error.message : "Website video URLs must use public http(s).",
        });
      }

      if (input.funscriptUri?.trim()) {
        try {
          normalizedFunscriptUri = normalizeHttpUrl(input.funscriptUri);
        } catch {
          normalizedFunscriptUri = input.funscriptUri.trim();
        }
      }

      const calculatedDifficulty =
        await calculateFunscriptDifficultyFromUri(normalizedFunscriptUri);

      try {
        const created = await db.transaction(async (tx) => {
          const [createdRound] = await tx
            .insert(round)
            .values({
              name: input.name.trim(),
              author: null,
              description: null,
              tagsJson: "[]",
              bpm: null,
              difficulty: calculatedDifficulty,
              phash: null,
              startTime: null,
              endTime: null,
              type: "Normal",
              installSourceKey: toWebsiteRoundInstallSourceKey({
                name: input.name,
                videoUri: normalizedVideoUri,
                funscriptUri: normalizedFunscriptUri,
              }),
              libraryLabel: "website",
              previewImage: null,
              heroId: null,
              updatedAt: new Date(),
            })
            .returning();

          if (!createdRound) {
            throw new Error("Failed to create the website round entry.");
          }

          const [createdResource] = await tx
            .insert(resource)
            .values({
              videoUri: normalizedVideoUri,
              funscriptUri: normalizedFunscriptUri,
              funscriptOffsetMs: null,
              phash: null,
              durationMs: null,
              disabled: false,
              roundId: createdRound.id,
              updatedAt: new Date(),
            })
            .returning();

          if (!createdResource) {
            throw new Error("Failed to attach website media to the installed round.");
          }

          return {
            roundId: createdRound.id,
            resourceId: createdResource.id,
          };
        });

        queueWebsiteVideoCachingImmediately({
          ...created,
          roundName: input.name.trim(),
          url: normalizedVideoUri,
        });
        return created;
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            error instanceof Error ? error.message : "Failed to create the website round entry.",
        });
      }
    }),

  createMediaRound: publicProcedure
    .input(
      z.object({
        name: z.string().trim().min(1),
        videoUri: z.string().trim().min(1),
        funscriptUri: z.string().trim().min(1).optional().nullable(),
        sourceKey: z.string().trim().min(1).optional().nullable(),
      })
    )
    .mutation(async ({ input }) => {
      const db = getDb();
      const normalizedVideoUri = input.videoUri.trim();
      const normalizedFunscriptUri = input.funscriptUri?.trim() || null;
      const calculatedDifficulty =
        await calculateFunscriptDifficultyFromUri(normalizedFunscriptUri);
      const previewImage = await generateRoundPreviewImageDataUri({
        videoUri: normalizedVideoUri,
        startTimeMs: null,
        endTimeMs: null,
      });

      try {
        const created = await db.transaction(async (tx) => {
          const [createdRound] = await tx
            .insert(round)
            .values({
              name: input.name.trim(),
              author: null,
              description: null,
              tagsJson: "[]",
              bpm: null,
              difficulty: calculatedDifficulty,
              phash: null,
              startTime: null,
              endTime: null,
              type: "Normal",
              installSourceKey: toMediaRoundInstallSourceKey({
                name: input.name,
                videoUri: normalizedVideoUri,
                funscriptUri: normalizedFunscriptUri,
                sourceKey: input.sourceKey ?? null,
              }),
              libraryLabel: "manual",
              previewImage,
              heroId: null,
              updatedAt: new Date(),
            })
            .returning();

          if (!createdRound) {
            throw new Error("Failed to create the media round entry.");
          }

          const [createdResource] = await tx
            .insert(resource)
            .values({
              videoUri: normalizedVideoUri,
              funscriptUri: normalizedFunscriptUri,
              funscriptOffsetMs: null,
              phash: null,
              durationMs: null,
              disabled: false,
              roundId: createdRound.id,
              updatedAt: new Date(),
            })
            .returning();

          if (!createdResource) {
            throw new Error("Failed to attach media to the installed round.");
          }

          return {
            roundId: createdRound.id,
            resourceId: createdResource.id,
          };
        });

        return created;
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: error instanceof Error ? error.message : "Failed to create the media round.",
        });
      }
    }),

  checkWebsiteRoundVideoSupport: publicProcedure
    .input(
      z.object({
        videoUri: z.string().trim().min(1),
      })
    )
    .query(async ({ input }) => {
      let normalizedVideoUri: string;

      try {
        normalizedVideoUri = normalizeHttpUrl(input.videoUri);
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            error instanceof Error ? error.message : "Website video URLs must use public http(s).",
        });
      }

      try {
        const resolution = await resolveWebsiteVideoStream(normalizedVideoUri);
        return {
          supported: true,
          normalizedVideoUri,
          extractor: resolution.extractor ?? null,
          title: resolution.title ?? null,
        };
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            error instanceof Error ? error.message : "This website video URL is not supported.",
        });
      }
    }),

  getResource: publicProcedure
    .input(
      z.object({
        roundId: z.string().min(1),
      })
    )
    .query(async ({ input }) => {
      const db = getDb();
      const r = await db.query.resource.findFirst({
        where: eq(resource.roundId, input.roundId),
      });
      if (!r) return null;
      await hydrateResourceDurationMs(db, [r]);
      return {
        ...r,
        ...resolveResourceUris({
          videoUri: r.videoUri,
          funscriptUri: r.funscriptUri,
        }),
        websiteVideoCacheStatus: await getWebsiteVideoCacheState(r.videoUri),
      };
    }),

  getResources: publicProcedure.query(async () => {
    const disabledRoundIds = [...getDisabledRoundIdSet()];
    const db = getDb();

    const resources = await db.query.resource.findMany({
      where: (res, { notInArray }) =>
        disabledRoundIds.length > 0 ? notInArray(res.roundId, disabledRoundIds) : undefined,
    });

    const withStatus = await Promise.all(
      resources.map(async (r) => ({
        resource: r,
        status: await getWebsiteVideoCacheState(r.videoUri),
      }))
    );

    // Only include resources that are fully cached or not applicable (local/stash)
    const filtered = withStatus
      .filter((entry) => entry.status !== "pending")
      .map((entry) => entry.resource);

    await hydrateResourceDurationMs(db, filtered);
    return filtered.map((r) => ({
      ...r,
      ...resolveResourceUris({
        videoUri: r.videoUri,
        funscriptUri: r.funscriptUri,
      }),
    }));
  }),

  getBackgroundVideoUris: publicProcedure
    .input(
      z
        .object({
          limit: z.number().int().min(1).max(24).optional(),
        })
        .optional()
    )
    .query(async ({ input }) => {
      const limit = input?.limit ?? 6;
      const disabledRoundIds = [...getDisabledRoundIdSet()];
      const db = getDb();

      const resources = await db.query.resource.findMany({
        where: (res, operators) => {
          const clauses = [operators.eq(res.disabled, false)];
          if (disabledRoundIds.length > 0) {
            clauses.push(operators.notInArray(res.roundId, disabledRoundIds));
          }
          return clauses.length === 1 ? clauses[0] : and(...clauses);
        },
        orderBy: [desc(resource.createdAt), asc(resource.id)],
      });

      const playableUris: string[] = [];
      for (const entry of resources) {
        const status = await getWebsiteVideoCacheState(entry.videoUri);
        if (status === "pending") {
          continue;
        }

        playableUris.push(
          resolveResourceUris({
            videoUri: entry.videoUri,
            funscriptUri: entry.funscriptUri,
          }).videoUri
        );

        if (playableUris.length >= limit) {
          break;
        }
      }

      return playableUris;
    }),

  getInstalledRoundCount: publicProcedure
    .input(
      z
        .object({
          includeDisabled: z.boolean().optional(),
          includeTemplates: z.boolean().optional(),
        })
        .optional()
    )
    .query(async ({ input }) => {
      const db = getDb();
      const includeDisabled = input?.includeDisabled ?? false;
      const includeTemplates = input?.includeTemplates ?? false;
      const disabledRoundIds = getDisabledRoundIdSet();

      const rounds = await db.query.round.findMany({
        columns: {
          id: true,
        },
        with: {
          resources: {
            columns: {
              id: true,
              disabled: true,
            },
          },
        },
        orderBy: [desc(round.createdAt)],
      });

      return rounds.filter((entry) =>
        shouldIncludeInstalledRound(entry, {
          includeDisabled,
          includeTemplates,
          disabledRoundIds,
        })
      ).length;
    }),

  getInstalledRounds: publicProcedure
    .input(
      z
        .object({
          includeDisabled: z.boolean().optional(),
          includeTemplates: z.boolean().optional(),
        })
        .optional()
    )
    .query(async ({ input }) => {
      const db = getDb();
      const includeDisabled = input?.includeDisabled ?? false;
      const includeTemplates = input?.includeTemplates ?? false;
      const disabledRoundIds = getDisabledRoundIdSet();
      const getCachedStateForUri = createWebsiteVideoCacheStatusLoader();
      const resolveResourceUrisForRequest = createResourceUriResolver();

      const rounds = await withInstalledLibrarySchemaRepair(() =>
        db.query.round.findMany({
          with: {
            hero: true,
            resources: true,
          },
          orderBy: [desc(round.createdAt)],
        })
      );

      const filteredRounds = rounds
        .map((entry) => ({
          ...entry,
          resources: getVisibleResources(entry.resources, includeDisabled),
          isDisabled: disabledRoundIds.has(entry.id),
        }))
        .filter((entry) =>
          shouldIncludeInstalledRound(entry, {
            includeDisabled,
            includeTemplates,
            disabledRoundIds,
          })
        );

      await hydrateResourceDurationMs(
        db,
        filteredRounds.flatMap((entry) => entry.resources)
      );

      return await Promise.all(
        filteredRounds.map(async (entry) => ({
          ...entry,
          tags: parseTagsJson(entry.tagsJson),
          hero: entry.hero
            ? {
                ...entry.hero,
                tags: parseTagsJson(entry.hero.tagsJson),
              }
            : null,
          resources: await Promise.all(
            entry.resources.map(async (res) => ({
              ...res,
              invertFunscript: res.invertFunscript,
              ...resolveResourceUrisForRequest({
                videoUri: res.videoUri,
                funscriptUri: res.funscriptUri,
              }),
              websiteVideoCacheStatus: await getCachedStateForUri(res.videoUri),
            }))
          ),
        }))
      );
    }),

  getInstalledRoundCatalog: publicProcedure
    .input(
      z
        .object({
          includeDisabled: z.boolean().optional(),
          includeTemplates: z.boolean().optional(),
        })
        .optional()
    )
    .query(async ({ input }) => {
      const db = getDb();
      const includeDisabled = input?.includeDisabled ?? false;
      const includeTemplates = input?.includeTemplates ?? false;
      const disabledRoundIds = getDisabledRoundIdSet();

      const rounds = await withInstalledLibrarySchemaRepair(() =>
        db.query.round.findMany({
          columns: {
            id: true,
            name: true,
            author: true,
            description: true,
            tagsJson: true,
            bpm: true,
            difficulty: true,
            phash: true,
            startTime: true,
            endTime: true,
            createdAt: true,
            updatedAt: true,
            type: true,
            installSourceKey: true,
            libraryLabel: true,
            heroId: true,
            excludeFromRandom: true,
          },
          with: {
            hero: {
              columns: {
                id: true,
                name: true,
                author: true,
                description: true,
                tagsJson: true,
              },
            },
            resources: {
              columns: {
                id: true,
                disabled: true,
                phash: true,
                durationMs: true,
                funscriptUri: true,
                funscriptOffsetMs: true,
                invertFunscript: true,
              },
            },
          },
          orderBy: [desc(round.createdAt)],
        })
      );

      const filteredRounds = rounds
        .map((entry) => ({
          ...entry,
          resources: getVisibleResources(entry.resources, includeDisabled),
        }))
        .filter((entry) =>
          shouldIncludeInstalledRound(entry, {
            includeDisabled,
            includeTemplates,
            disabledRoundIds,
          })
        );

      return await Promise.all(
        filteredRounds.map(async (entry) => {
          const primaryResource = entry.resources[0];
          const hardModeRevert =
            primaryResource?.funscriptUri &&
            (await getHardModeAttachmentRevert(primaryResource.id, primaryResource.funscriptUri));

          return {
            ...toInstalledRoundCatalogEntry(entry),
            isHardModeConverted: Boolean(hardModeRevert),
          };
        })
      );
    }),

  getInstalledRoundRuntimeCatalog: publicProcedure
    .input(
      z
        .object({
          includeDisabled: z.boolean().optional(),
          includeTemplates: z.boolean().optional(),
        })
        .optional()
    )
    .query(async ({ input }) => {
      const db = getDb();
      const includeDisabled = input?.includeDisabled ?? false;
      const includeTemplates = input?.includeTemplates ?? false;
      const disabledRoundIds = getDisabledRoundIdSet();

      const rounds = await withInstalledLibrarySchemaRepair(() =>
        db.query.round.findMany({
          columns: {
            id: true,
            name: true,
            author: true,
            description: true,
            tagsJson: true,
            bpm: true,
            difficulty: true,
            phash: true,
            startTime: true,
            endTime: true,
            cutRangesJson: true,
            createdAt: true,
            updatedAt: true,
            type: true,
            installSourceKey: true,
            libraryLabel: true,
            heroId: true,
            excludeFromRandom: true,
          },
          with: {
            hero: {
              columns: {
                id: true,
                name: true,
                author: true,
                description: true,
                tagsJson: true,
              },
            },
            resources: {
              columns: {
                id: true,
                disabled: true,
                phash: true,
                durationMs: true,
                videoUri: true,
                funscriptUri: true,
                funscriptOffsetMs: true,
                invertFunscript: true,
              },
            },
          },
          orderBy: [desc(round.createdAt)],
        })
      );

      const filteredRounds = rounds
        .map((entry) => ({
          ...entry,
          resources: getVisibleResources(entry.resources, includeDisabled),
          isDisabled: disabledRoundIds.has(entry.id),
        }))
        .filter((entry) =>
          shouldIncludeInstalledRound(entry, {
            includeDisabled,
            includeTemplates,
            disabledRoundIds,
          })
        );

      return filteredRounds.map((entry) => toInstalledRoundRuntimeCatalogEntry(entry));
    }),

  getInstalledRoundPlaybackEntry: publicProcedure
    .input(
      z.object({
        roundId: z.string().min(1),
        includeDisabled: z.boolean().optional(),
      })
    )
    .query(async ({ input }) => {
      const db = getDb();
      const includeDisabled = input.includeDisabled ?? false;
      const disabledRoundIds = getDisabledRoundIdSet();
      const getCachedStateForUri = createWebsiteVideoCacheStatusLoader();
      const resolveResourceUrisForRequest = createResourceUriResolver();

      const roundEntry = await db.query.round.findFirst({
        where: eq(round.id, input.roundId),
        with: {
          hero: true,
          resources: true,
        },
      });

      if (!roundEntry) {
        return null;
      }

      const nextEntry = {
        ...roundEntry,
        resources: getVisibleResources(roundEntry.resources, includeDisabled),
      };

      if (
        !shouldIncludeInstalledRound(nextEntry, {
          includeDisabled,
          includeTemplates: true,
          disabledRoundIds,
        })
      ) {
        return null;
      }

      await hydrateResourceDurationMs(db, nextEntry.resources);

      return {
        ...nextEntry,
        isDisabled: disabledRoundIds.has(nextEntry.id),
        tags: parseTagsJson(nextEntry.tagsJson),
        hero: nextEntry.hero
          ? {
              ...nextEntry.hero,
              tags: parseTagsJson(nextEntry.hero.tagsJson),
            }
          : null,
        resources: await Promise.all(
          nextEntry.resources.map(async (res) => ({
            ...res,
            ...resolveResourceUrisForRequest({
              videoUri: res.videoUri,
              funscriptUri: res.funscriptUri,
            }),
            websiteVideoCacheStatus: await getCachedStateForUri(res.videoUri),
          }))
        ),
      };
    }),

  getInstalledRoundPlaybackEntries: publicProcedure
    .input(
      z.object({
        roundIds: z.array(z.string().min(1)),
        includeDisabled: z.boolean().optional(),
      })
    )
    .query(async ({ input }) => {
      const uniqueRoundIds = [...new Set(input.roundIds)];
      if (uniqueRoundIds.length === 0) return [];

      const db = getDb();
      const includeDisabled = input.includeDisabled ?? false;
      const disabledRoundIds = getDisabledRoundIdSet();
      const getCachedStateForUri = createWebsiteVideoCacheStatusLoader();
      const resolveResourceUrisForRequest = createResourceUriResolver();

      const rounds = await db.query.round.findMany({
        where: inArray(round.id, uniqueRoundIds),
        with: {
          hero: true,
          resources: true,
        },
      });

      const entries = await Promise.all(
        rounds.map(async (roundEntry) => {
          const nextEntry = {
            ...roundEntry,
            resources: getVisibleResources(roundEntry.resources, includeDisabled),
          };

          if (
            !shouldIncludeInstalledRound(nextEntry, {
              includeDisabled,
              includeTemplates: true,
              disabledRoundIds,
            })
          ) {
            return null;
          }

          await hydrateResourceDurationMs(db, nextEntry.resources);

          return {
            ...nextEntry,
            isDisabled: disabledRoundIds.has(nextEntry.id),
            tags: parseTagsJson(nextEntry.tagsJson),
            hero: nextEntry.hero
              ? {
                  ...nextEntry.hero,
                  tags: parseTagsJson(nextEntry.hero.tagsJson),
                }
              : null,
            resources: await Promise.all(
              nextEntry.resources.map(async (res) => ({
                ...res,
                ...resolveResourceUrisForRequest({
                  videoUri: res.videoUri,
                  funscriptUri: res.funscriptUri,
                }),
                websiteVideoCacheStatus: await getCachedStateForUri(res.videoUri),
              }))
            ),
          };
        })
      );

      const entriesByRoundId = new Map(
        entries
          .filter((entry): entry is NonNullable<typeof entry> => entry != null)
          .map((entry) => [entry.id, entry] as const)
      );

      return uniqueRoundIds
        .map((roundId) => entriesByRoundId.get(roundId))
        .filter((entry): entry is NonNullable<typeof entry> => entry != null);
    }),

  getInstalledRoundCardAssets: publicProcedure
    .input(
      z.object({
        roundIds: z.array(z.string().min(1)),
        includeDisabled: z.boolean().optional(),
      })
    )
    .query(async ({ input }) => {
      if (input.roundIds.length === 0) {
        return [];
      }

      const db = getDb();
      const includeDisabled = input.includeDisabled ?? false;
      const disabledRoundIds = getDisabledRoundIdSet();
      const getCachedStateForUri = createWebsiteVideoCacheStatusLoader();
      const resolveResourceUrisForRequest = createResourceUriResolver();
      const uniqueRoundIds = [...new Set(input.roundIds)];

      const rounds = await db.query.round.findMany({
        where: inArray(round.id, uniqueRoundIds),
        columns: {
          id: true,
          installSourceKey: true,
          previewImage: true,
        },
        with: {
          resources: {
            columns: {
              id: true,
              disabled: true,
              videoUri: true,
            },
          },
        },
      });

      const assetsByRoundId = new Map<string, InstalledRoundCardAssetEntry>(
        await Promise.all(
          rounds.map(async (entry) => {
            if (!includeDisabled && disabledRoundIds.has(entry.id)) {
              return [
                entry.id,
                {
                  roundId: entry.id,
                  previewImage: entry.previewImage ?? null,
                  previewVideoUri: null,
                  websiteVideoCacheStatus: "not_applicable" as WebsiteVideoCacheStatus,
                  primaryResourceId: null,
                } satisfies InstalledRoundCardAssetEntry,
              ] as const;
            }

            const visibleResources = getVisibleResources(entry.resources, includeDisabled);
            const primaryResource = visibleResources[0] ?? null;
            const previewVideoUri = primaryResource
              ? resolveResourceUrisForRequest({
                  videoUri: primaryResource.videoUri,
                  funscriptUri: null,
                }).videoUri
              : null;
            const websiteVideoCacheStatus =
              primaryResource && entry.installSourceKey?.startsWith("website:")
                ? await getCachedStateForUri(primaryResource.videoUri)
                : ("not_applicable" as WebsiteVideoCacheStatus);

            return [
              entry.id,
              {
                roundId: entry.id,
                previewImage: entry.previewImage ?? null,
                previewVideoUri,
                websiteVideoCacheStatus,
                primaryResourceId: primaryResource?.id ?? null,
              } satisfies InstalledRoundCardAssetEntry,
            ] as const;
          })
        )
      );

      return uniqueRoundIds
        .map((roundId) => assetsByRoundId.get(roundId))
        .filter((entry): entry is NonNullable<typeof entry> => entry != null);
    }),

  getRoundMediaResources: publicProcedure
    .input(
      z.object({
        roundId: z.string().min(1),
        includeDisabled: z.boolean().optional(),
      })
    )
    .query(async ({ input }) => {
      const db = getDb();
      const includeDisabled = input.includeDisabled ?? false;
      const disabledRoundIds = getDisabledRoundIdSet();
      const getCachedStateForUri = createWebsiteVideoCacheStatusLoader();
      const resolveResourceUrisForRequest = createResourceUriResolver();
      const roundEntry = await db.query.round.findFirst({
        where: eq(round.id, input.roundId),
        columns: {
          id: true,
        },
        with: {
          resources: true,
        },
      });

      if (!roundEntry) {
        return null;
      }
      if (!includeDisabled && disabledRoundIds.has(roundEntry.id)) {
        return null;
      }

      const visibleResources = getVisibleResources(roundEntry.resources, includeDisabled);
      await hydrateResourceDurationMs(db, visibleResources);

      return {
        roundId: roundEntry.id,
        resources: await Promise.all(
          visibleResources.map(async (resourceEntry) => ({
            id: resourceEntry.id,
            disabled: resourceEntry.disabled,
            phash: resourceEntry.phash,
            durationMs: resourceEntry.durationMs,
            funscriptOffsetMs: resourceEntry.funscriptOffsetMs,
            invertFunscript: resourceEntry.invertFunscript,
            ...resolveResourceUrisForRequest({
              videoUri: resourceEntry.videoUri,
              funscriptUri: resourceEntry.funscriptUri,
            }),
            websiteVideoCacheStatus: await getCachedStateForUri(resourceEntry.videoUri),
          }))
        ),
      };
    }),

  getDisabledRoundIds: publicProcedure.query(async () => {
    const db = getDb();
    const fromStore = getDisabledRoundIdSet();

    // Find rounds where all resources are disabled and it has at least one resource
    const roundsWithResources = await withInstalledLibrarySchemaRepair(() =>
      db.query.round.findMany({
        columns: {
          id: true,
        },
        with: {
          resources: {
            columns: {
              disabled: true,
            },
          },
        },
      })
    );

    for (const r of roundsWithResources) {
      if (r.resources.length > 0 && r.resources.every((res) => res.disabled)) {
        fromStore.add(r.id);
      }
    }

    return [...fromStore];
  }),

  getInstallScanStatus: publicProcedure.query(() => {
    return getInstallScanStatus();
  }),

  inspectInstallFolder: publicProcedure
    .input(
      z.object({
        folderPath: z.string().min(1),
      })
    )
    .query(async ({ input }) => {
      try {
        return await inspectInstallFolder(input.folderPath);
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: error instanceof Error ? error.message : "Failed to inspect selected folder.",
        });
      }
    }),

  scanInstallSources: publicProcedure.mutation(async () => {
    const result = await scanInstallSources("manual");
    queueWebsiteVideoCaching();
    return result;
  }),

  scanInstallFolderOnce: publicProcedure
    .input(
      z.object({
        folderPath: z.string().min(1),
        omitCheckpointRounds: z.boolean().optional(),
        deferPhash: z.boolean().optional(),
        deferPreview: z.boolean().optional(),
        deferDuration: z.boolean().optional(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const result = await scanInstallFolderOnceWithLegacySupport(input.folderPath, {
          omitCheckpointRounds: input.omitCheckpointRounds ?? true,
          deferPhash: input.deferPhash,
          deferPreview: input.deferPreview,
          deferDuration: input.deferDuration,
        });
        queueWebsiteVideoCaching();
        return result;
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            error instanceof Error ? error.message : "Failed to install from selected folder.",
        });
      }
    }),

  importLegacyVideoFileAsRound: publicProcedure
    .input(
      z.object({
        filePath: z.string().min(1),
        deferPhash: z.boolean().optional(),
        deferPreview: z.boolean().optional(),
        deferDuration: z.boolean().optional(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const result = await importLegacyVideoFileAsRound(input.filePath, {
          deferPhash: input.deferPhash ?? true,
          deferPreview: input.deferPreview ?? true,
          deferDuration: input.deferDuration ?? true,
        });
        queueWebsiteVideoCaching();
        return result;
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: error instanceof Error ? error.message : "Failed to install selected video.",
        });
      }
    }),

  importInstallSidecarFile: publicProcedure
    .input(
      z.object({
        filePath: z.string().min(1),
        allowedBaseDomains: z.array(z.string().trim().min(1)).optional(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const result = await importInstallSidecarFile(
          input.filePath,
          input.allowedBaseDomains ?? []
        );
        queueWebsiteVideoCaching();
        return result;
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            error instanceof Error ? error.message : "Failed to import selected sidecar file.",
        });
      }
    }),

  inspectInstallSidecarFile: publicProcedure
    .input(
      z.object({
        filePath: z.string().min(1),
      })
    )
    .query(async ({ input }) => {
      try {
        return await inspectInstallSidecarFile(input.filePath);
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            error instanceof Error ? error.message : "Failed to inspect selected sidecar file.",
        });
      }
    }),

  retryTemplateLinking: publicProcedure
    .input(
      z
        .object({
          roundId: z.string().min(1).optional(),
          heroId: z.string().min(1).optional(),
        })
        .optional()
    )
    .mutation(async ({ input }) => {
      try {
        return await retryTemplateLinking({
          roundId: input?.roundId,
          heroId: input?.heroId,
        });
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: error instanceof Error ? error.message : "Failed to retry template linking.",
        });
      }
    }),

  repairTemplateRound: publicProcedure
    .input(
      z.object({
        roundId: z.string().min(1),
        installedRoundId: z.string().min(1),
      })
    )
    .mutation(async ({ input }) => {
      try {
        return await repairTemplateRound(input.roundId, input.installedRoundId);
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: error instanceof Error ? error.message : "Failed to repair template round.",
        });
      }
    }),

  repairTemplateHero: publicProcedure
    .input(
      z.object({
        heroId: z.string().min(1),
        sourceHeroId: z.string().min(1),
        assignments: z
          .array(
            z.object({
              roundId: z.string().min(1),
              installedRoundId: z.string().min(1),
            })
          )
          .optional(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        return await repairTemplateHero(input.heroId, input.sourceHeroId, input.assignments);
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: error instanceof Error ? error.message : "Failed to repair template hero.",
        });
      }
    }),

  importLegacyFolderWithPlan: publicProcedure
    .input(
      z.object({
        folderPath: z.string().min(1),
        reviewedSlots: z.array(
          z.object({
            id: z.string().min(1),
            sourcePath: z.string().min(1),
            originalOrder: z.number().int().min(0),
            selectedAsCheckpoint: z.boolean(),
            excludedFromImport: z.boolean(),
          })
        ),
        deferPhash: z.boolean().optional(),
        deferPreview: z.boolean().optional(),
        deferDuration: z.boolean().optional(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const result = await importLegacyFolderWithPlan(input.folderPath, input.reviewedSlots, {
          deferPhash: input.deferPhash,
          deferPreview: input.deferPreview,
          deferDuration: input.deferDuration,
        });
        queueWebsiteVideoCaching();
        return result;
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            error instanceof Error ? error.message : "Failed to import reviewed legacy folder.",
        });
      }
    }),

  getAutoScanFolders: publicProcedure.query(() => {
    return getAutoScanFolders();
  }),

  addAutoScanFolder: publicProcedure
    .input(z.object({ folderPath: z.string().min(1) }))
    .mutation(async ({ input }) => {
      try {
        return await addAutoScanFolder(input.folderPath);
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: error instanceof Error ? error.message : "Failed to add auto-scan folder.",
        });
      }
    }),

  addAutoScanFolderAndScan: publicProcedure
    .input(z.object({ folderPath: z.string().min(1) }))
    .mutation(async ({ input }) => {
      try {
        const result = await addAutoScanFolderAndScan(input.folderPath);
        queueWebsiteVideoCaching();
        return result;
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            error instanceof Error ? error.message : "Failed to add and import auto-scan folder.",
        });
      }
    }),

  removeAutoScanFolder: publicProcedure
    .input(z.object({ folderPath: z.string().min(1) }))
    .mutation(({ input }) => {
      return removeAutoScanFolder(input.folderPath);
    }),

  exportInstalledDatabase: publicProcedure
    .input(z.object({ includeResourceUris: z.boolean().optional() }).optional())
    .mutation(async ({ input }) => {
      try {
        return await exportInstalledDatabase({
          includeResourceUris: input?.includeResourceUris ?? false,
        });
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: error instanceof Error ? error.message : "Failed to export installed database.",
        });
      }
    }),

  exportLibraryPackage: publicProcedure
    .input(
      z.object({
        roundIds: z.array(z.string()).optional(),
        heroIds: z.array(z.string()).optional(),
        includeMedia: z.boolean().optional(),
        directoryPath: z.string().optional(),
        asFpack: z.boolean().optional(),
        compressionMode: z.enum(["copy", "av1"]).optional(),
        compressionStrength: z.number().optional(),
        audioBitrateKbps: z.union([z.literal(128), z.literal(192), z.literal(256)]).optional(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        return await exportLibraryPackage({
          roundIds: input.roundIds,
          heroIds: input.heroIds,
          includeMedia: input.includeMedia ?? true,
          directoryPath: input.directoryPath,
          asFpack: input.asFpack ?? false,
          compressionMode: input.compressionMode,
          compressionStrength: input.compressionStrength,
          audioBitrateKbps: input.audioBitrateKbps,
        });
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: error instanceof Error ? error.message : "Failed to export library package.",
        });
      }
    }),

  analyzeLibraryExportPackage: publicProcedure
    .input(
      z.object({
        roundIds: z.array(z.string()).optional(),
        heroIds: z.array(z.string()).optional(),
        includeMedia: z.boolean().optional(),
        compressionMode: z.enum(["copy", "av1"]).optional(),
        compressionStrength: z.number().optional(),
        audioBitrateKbps: z.union([z.literal(128), z.literal(192), z.literal(256)]).optional(),
      })
    )
    .query(async ({ input }) => {
      try {
        return await analyzeLibraryExportPackage({
          roundIds: input.roundIds,
          heroIds: input.heroIds,
          includeMedia: input.includeMedia ?? true,
          compressionMode: input.compressionMode,
          compressionStrength: input.compressionStrength,
          audioBitrateKbps: input.audioBitrateKbps,
        });
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: error instanceof Error ? error.message : "Failed to analyze library package.",
        });
      }
    }),

  getLibraryExportPackageStatus: publicProcedure.query(() => {
    return getLibraryExportPackageStatus();
  }),

  abortLibraryExportPackage: publicProcedure.mutation(() => {
    return requestLibraryExportPackageAbort();
  }),

  openInstallExportFolder: publicProcedure.mutation(async () => {
    const exportBaseDir = resolveInstallExportBaseDir();
    await fs.mkdir(exportBaseDir, { recursive: true });
    const openError = await shell.openPath(exportBaseDir);
    if (openError) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: openError,
      });
    }
    return { path: exportBaseDir };
  }),

  backupDatabaseNow: publicProcedure.mutation(async () => {
    try {
      const result = await runDatabaseBackup();
      if (!result) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Automatic database backups require a local file SQLite database.",
        });
      }
      return result;
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: error instanceof Error ? error.message : "Failed to back up database.",
      });
    }
  }),

  openDatabaseBackupFolder: publicProcedure.mutation(async () => {
    const backupDir = resolveDatabaseBackupDir();
    await fs.mkdir(backupDir, { recursive: true });
    const openError = await shell.openPath(backupDir);
    if (openError) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: openError,
      });
    }
    return { path: backupDir };
  }),

  backupSettingsNow: publicProcedure.mutation(async () => {
    try {
      const result = await runSettingsBackup();
      if (!result) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Settings backup could not be created because the settings file is unavailable.",
        });
      }
      return result;
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: error instanceof Error ? error.message : "Failed to back up settings.",
      });
    }
  }),

  createPlaintextSettingsFile: publicProcedure.mutation(async () => {
    try {
      const result = await createPlaintextSettingsFile();
      shell.showItemInFolder(result.plaintextPath);
      return result;
    } catch (error) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message:
          error instanceof Error ? error.message : "Failed to create plaintext settings file.",
      });
    }
  }),

  openSettingsBackupFolder: publicProcedure.mutation(async () => {
    const backupDir = resolveSettingsBackupDir();
    await fs.mkdir(backupDir, { recursive: true });
    const openError = await shell.openPath(backupDir);
    if (openError) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: openError,
      });
    }
    return { path: backupDir };
  }),

  openConfiguredPath: publicProcedure
    .input(
      z.object({
        target: z.enum([
          "website-video-cache",
          "music-cache",
          "fpack-extraction",
          "eroscripts-cache",
        ]),
      })
    )
    .mutation(async ({ input }) => {
      const resolvedPath =
        input.target === "website-video-cache"
          ? resolveWebsiteVideoCacheRoot()
          : input.target === "music-cache"
            ? resolveMusicCacheRoot()
            : input.target === "eroscripts-cache"
              ? resolveEroScriptsCacheRoot()
              : await getFpackExtractionRoot();
      await fs.mkdir(resolvedPath, { recursive: true });
      const openError = await shell.openPath(resolvedPath);
      if (openError) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: openError,
        });
      }
      return { path: resolvedPath };
    }),

  clearAllData: publicProcedure
    .input(
      z
        .object({
          rounds: z.boolean().optional(),
          playlists: z.boolean().optional(),
          stats: z.boolean().optional(),
          history: z.boolean().optional(),
          cache: z.boolean().optional(),
          videoCache: z.boolean().optional(),
          musicCache: z.boolean().optional(),
          fpackExtraction: z.boolean().optional(),
          eroscriptsCache: z.boolean().optional(),
          settings: z.boolean().optional(),
        })
        .optional()
    )
    .mutation(async ({ input }) => {
      const db = getDb();
      const backupResult = await runDatabaseBackup();
      if (!backupResult) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Cannot clear data because a local database backup could not be created.",
        });
      }
      const {
        rounds = true,
        playlists = true,
        stats = true,
        history = true,
        cache = true,
        videoCache = true,
        musicCache = true,
        fpackExtraction = true,
        eroscriptsCache = true,
        settings = true,
      } = input ?? {};

      if (settings) {
        const settingsBackupResult = await runSettingsBackup();
        if (!settingsBackupResult) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Cannot clear settings because a settings backup could not be created.",
          });
        }
      }

      const websiteVideoCacheRoot = videoCache ? resolveWebsiteVideoCacheRoot() : null;
      const musicCacheRoot = musicCache ? resolveMusicCacheRoot() : null;
      const fpackExtractionRoot = fpackExtraction ? await getFpackExtractionRoot() : null;

      await db.transaction(async (tx) => {
        if (cache) {
          await tx.delete(multiplayerMatchCache);
          await tx.delete(resultSyncQueue);
        }
        if (history) {
          await tx.delete(gameplayRoundPlay);
          await tx.delete(gameplaySession);
          await tx.delete(singlePlayerRunHistory);
          await tx.delete(singlePlayerRunSave);
        }
        if (playlists) {
          await tx.delete(playlistTrackPlay);
          await tx.delete(playlist);
        }
        if (rounds) {
          await tx.delete(resource);
          await tx.delete(round);
          await tx.delete(hero);
        }
        if (stats) {
          await tx.delete(gameProfile);
        }
      });

      const cacheClearTasks: Array<Promise<void>> = [];
      if (videoCache && websiteVideoCacheRoot) {
        cacheClearTasks.push(
          clearWebsiteVideoCache(websiteVideoCacheRoot),
          clearPlayableVideoCache()
        );
      }
      if (musicCache && musicCacheRoot) {
        cacheClearTasks.push(clearMusicCache(musicCacheRoot));
      }
      if (fpackExtraction && fpackExtractionRoot) {
        cacheClearTasks.push(clearFpackExtractionCache(fpackExtractionRoot));
      }
      if (eroscriptsCache) {
        cacheClearTasks.push(clearEroScriptsCache());
      }
      await Promise.all(cacheClearTasks);

      if (settings) {
        await initStore();
        getStore().clear();
      }
      return { cleared: true };
    }),

  convertHeroGroupToRound: publicProcedure
    .input(
      z.object({
        keepRoundId: z.string().min(1),
        roundIds: z.array(z.string().min(1)).min(1),
        heroId: z.string().min(1).optional().nullable(),
        roundName: z.string().trim().min(1),
      })
    )
    .mutation(async ({ input }) => {
      if (!input.roundIds.includes(input.keepRoundId)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "The selected round to keep must be part of the hero group.",
        });
      }

      const db = getDb();

      return db.transaction(async (tx) => {
        const rounds = await tx.query.round.findMany({
          where: inArray(round.id, input.roundIds),
          columns: { id: true, heroId: true, previewImage: true },
        });
        if (rounds.length !== input.roundIds.length) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Some rounds in this hero group could not be found.",
          });
        }

        const roundById = new Map(rounds.map((r) => [r.id, r]));
        const keepRound = roundById.get(input.keepRoundId);
        if (!keepRound) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "The selected round to keep no longer exists.",
          });
        }

        const keepRoundHeroId = keepRound.heroId ?? null;
        const targetHeroId = input.heroId ?? keepRoundHeroId;
        if (input.heroId && keepRoundHeroId !== input.heroId) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "The selected round does not belong to the provided hero.",
          });
        }

        const deleteRoundIds = input.roundIds.filter((id) => id !== input.keepRoundId);
        if (deleteRoundIds.length > 0) {
          await tx.delete(resource).where(inArray(resource.roundId, deleteRoundIds));
          await tx.delete(round).where(inArray(round.id, deleteRoundIds));
        }

        const primaryResource = await tx.query.resource.findFirst({
          where: (res, { eq }) => eq(res.roundId, input.keepRoundId),
        });

        let previewImage = keepRound?.previewImage ?? null;
        if (primaryResource) {
          previewImage = await generateRoundPreviewImageDataUri({
            videoUri: primaryResource.videoUri,
            startTimeMs: null,
            endTimeMs: null,
          });
        }

        await tx
          .update(round)
          .set({
            heroId: null,
            name: input.roundName,
            startTime: null,
            endTime: null,
            previewImage,
          })
          .where(eq(round.id, input.keepRoundId));

        let deletedHero = false;
        if (targetHeroId) {
          // count properly
          const groupRemaining = await tx
            .select({ id: round.id })
            .from(round)
            .where(eq(round.heroId, targetHeroId));
          if (groupRemaining.length === 0) {
            await tx.delete(hero).where(eq(hero.id, targetHeroId));
            deletedHero = true;
          }
        }

        return {
          keptRoundId: input.keepRoundId,
          removedRoundCount: deleteRoundIds.length,
          deletedHero,
        };
      });
    }),

  getPhashScanStatus: publicProcedure.query(() => {
    return getPhashScanStatus();
  }),

  startPhashScan: publicProcedure.mutation(async () => {
    return startPhashScan();
  }),

  startPhashScanManual: publicProcedure.mutation(async () => {
    return startPhashScanManual();
  }),

  abortPhashScan: publicProcedure.mutation(() => {
    return requestPhashScanAbort();
  }),

  getWebsiteVideoScanStatus: publicProcedure.query(() => {
    return getWebsiteVideoScanStatus();
  }),

  startWebsiteVideoScan: publicProcedure.mutation(async () => {
    return startWebsiteVideoScan();
  }),

  startWebsiteVideoScanManual: publicProcedure.mutation(async () => {
    return startWebsiteVideoScanManual();
  }),

  abortWebsiteVideoScan: publicProcedure.mutation(() => {
    return requestWebsiteVideoScanAbort();
  }),

  getWebsiteVideoDownloadProgresses: publicProcedure.query(() => {
    return getAllWebsiteVideoDownloadProgresses();
  }),

  ensureWebsiteVideoCachedForConverter: publicProcedure
    .input(
      z.object({
        url: z.string().trim().min(1),
      })
    )
    .mutation(async ({ input }) => {
      const result = await ensureWebsiteVideoCached(input.url);
      return {
        finalFilePath: result.finalFilePath,
        title: result.title,
        durationMs: result.durationMs,
        extractor: result.extractor,
      };
    }),

  getWebsiteVideoDownloadProgressForUrl: publicProcedure
    .input(
      z.object({
        url: z.string().trim().min(1),
      })
    )
    .query(({ input }) => {
      return getWebsiteVideoDownloadProgress(input.url);
    }),

  cancelWebsiteVideoCache: publicProcedure
    .input(
      z.object({
        url: z.string().trim().min(1),
      })
    )
    .mutation(async ({ input }) => {
      await removeCachedWebsiteVideo(input.url);
    }),
});
