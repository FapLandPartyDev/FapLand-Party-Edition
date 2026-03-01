import { TRPCError } from "@trpc/server";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { shell } from "electron";
import * as z from "zod";
import { resolveInstallExportBaseDir } from "../../services/appPaths";
import { getDb } from "../../services/db";
import { exportInstalledDatabase } from "../../services/installExport";
import {
  analyzeLibraryExportPackage,
  exportLibraryPackage,
  getLibraryExportPackageStatus,
  requestLibraryExportPackageAbort,
} from "../../services/libraryExportPackage";
import {
  createResourceUriResolver,
  getDisabledRoundIdSet,
  resolveResourceUris,
} from "../../services/integrations";
import { getStore } from "../../services/store";
import { resolveVideoDurationMsForUri } from "../../services/videoDuration";
import { calculateFunscriptDifficultyFromUri } from "../../services/funscript";
import {
  addAutoScanFolder,
  addAutoScanFolderAndScan,
  getAutoScanFolders,
  getInstallScanStatus,
  inspectInstallSidecarFile,
  importInstallSidecarFile,
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
import { resolveMusicCacheRoot } from "../../services/musicDownload";
import { getFpackExtractionRoot } from "../../services/fpack";
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
} from "../../services/db/schema";
import { ZSinglePlayerRunSaveSnapshot } from "../../../src/game/saveSchema";

const ZNullableText = z.string().optional().nullable();
const ZRoundType = z.enum(["Normal", "Interjection", "Cum"]);
const ZPersistablePlaylistSaveMode = z.enum(["checkpoint", "everywhere"]);

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

function queueWebsiteVideoCaching(): void {
  void startWebsiteVideoScan().catch((error) => {
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
  await Promise.all(
    resources.map(async (entry) => {
      if (typeof entry.durationMs === "number" && entry.durationMs > 0) return;
      const durationMs = await resolveVideoDurationMsForUri(entry.videoUri);
      if (durationMs === null) return;
      entry.durationMs = durationMs;
      await db.update(resource).set({ durationMs }).where(eq(resource.id, entry.id));
    })
  );
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

function createWebsiteVideoCacheStatusLoader(): (videoUri: string) => Promise<WebsiteVideoCacheStatus> {
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
  videoUri: string;
};

async function toInstalledRoundCatalogEntry(
  entry: {
    id: string;
    name: string;
    author: string | null;
    description: string | null;
    bpm: number | null;
    difficulty: number | null;
    phash: string | null;
    startTime: number | null;
    endTime: number | null;
    type: "Normal" | "Interjection" | "Cum";
    installSourceKey: string | null;
    previewImage: string | null;
    heroId: string | null;
    hero: {
      id: string;
      name: string;
      author: string | null;
      description: string | null;
    } | null;
    resources: CatalogRoundResource[];
  },
  getCachedStateForUri: (videoUri: string) => Promise<WebsiteVideoCacheStatus>
): Promise<{
  id: string;
  name: string;
  author: string | null;
  description: string | null;
  bpm: number | null;
  difficulty: number | null;
  phash: string | null;
  startTime: number | null;
  endTime: number | null;
  type: "Normal" | "Interjection" | "Cum" | null;
  installSourceKey: string | null;
  previewImage: string | null;
  heroId: string | null;
  hero: {
    id: string;
    name: string;
    author: string | null;
    description: string | null;
  } | null;
  resources: Array<{
    id: string;
    disabled: boolean;
    phash: string | null;
    durationMs: number | null;
    websiteVideoCacheStatus: WebsiteVideoCacheStatus;
  }>;
}> {
  return {
    id: entry.id,
    name: entry.name,
    author: entry.author,
    description: entry.description,
    bpm: entry.bpm,
    difficulty: entry.difficulty,
    phash: entry.phash,
    startTime: entry.startTime,
    endTime: entry.endTime,
    type: entry.type ?? null,
    installSourceKey: entry.installSourceKey,
    previewImage: entry.previewImage,
    heroId: entry.heroId,
    hero: entry.hero,
    resources: await Promise.all(
      entry.resources.map(async (resourceEntry) => ({
        id: resourceEntry.id,
        disabled: resourceEntry.disabled,
        phash: resourceEntry.phash,
        durationMs: resourceEntry.durationMs,
        websiteVideoCacheStatus: await getCachedStateForUri(resourceEntry.videoUri),
      }))
    ),
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
    return db.query.hero.findMany();
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
          author: input.author?.trim() || null,
          description: input.description?.trim() || null,
          updatedAt: new Date(),
        })
        .where(eq(hero.id, input.id))
        .returning();
      return updated;
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
    return db.query.round.findMany({
      where: eq(round.heroId, input.heroId),
    });
  }),

  updateRound: publicProcedure
    .input(
      z.object({
        id: z.string().min(1),
        name: z.string().trim().min(1),
        author: ZNullableText,
        description: ZNullableText,
        bpm: z.number().finite().min(1).max(400).optional().nullable(),
        difficulty: z.number().int().min(1).max(5).optional().nullable(),
        startTime: z.number().int().min(0).optional().nullable(),
        endTime: z.number().int().min(0).optional().nullable(),
        funscriptUri: z.string().trim().min(1).optional().nullable(),
        type: ZRoundType,
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
          author: input.author?.trim() || null,
          description: input.description?.trim() || null,
          bpm: input.bpm ?? null,
          difficulty: input.difficulty ?? null,
          startTime,
          endTime,
          previewImage,
          type: input.type,
          updatedAt: new Date(),
        })
        .where(eq(round.id, input.id))
        .returning();
      return updated;
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

      if (deletedRoundWebsiteUrls.length > 0) {
        const remainingResources = await db.query.resource.findMany({
          columns: {
            videoUri: true,
          },
        });
        const remainingWebsiteUrls = new Set(
          collectWebsiteVideoTargetUrls(remainingResources.map((entry) => entry.videoUri))
        );
        await Promise.all(
          deletedRoundWebsiteUrls
            .filter((targetUrl) => !remainingWebsiteUrls.has(targetUrl))
            .map((targetUrl) => removeCachedWebsiteVideo(targetUrl))
        );
      }

      return { deleted: true };
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

        queueWebsiteVideoCaching();
        return created;
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            error instanceof Error ? error.message : "Failed to create the website round entry.",
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

      const rounds = await db.query.round.findMany({
        with: {
          hero: true,
          resources: true,
        },
        orderBy: [desc(round.createdAt)],
      });

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

      await hydrateResourceDurationMs(
        db,
        filteredRounds.flatMap((entry) => entry.resources)
      );

      return await Promise.all(
        filteredRounds.map(async (entry) => ({
          ...entry,
          resources: await Promise.all(
            entry.resources.map(async (res) => ({
              ...res,
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
      const getCachedStateForUri = createWebsiteVideoCacheStatusLoader();

      const rounds = await db.query.round.findMany({
        columns: {
          id: true,
          name: true,
          author: true,
          description: true,
          bpm: true,
          difficulty: true,
          phash: true,
          startTime: true,
          endTime: true,
          type: true,
          installSourceKey: true,
          previewImage: true,
          heroId: true,
        },
        with: {
          hero: {
            columns: {
              id: true,
              name: true,
              author: true,
              description: true,
            },
          },
          resources: {
            columns: {
              id: true,
              disabled: true,
              phash: true,
              durationMs: true,
              videoUri: true,
            },
          },
        },
        orderBy: [desc(round.createdAt)],
      });

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
        filteredRounds.map((entry) => toInstalledRoundCatalogEntry(entry, getCachedStateForUri))
      );
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
    const roundsWithResources = await db.query.round.findMany({
      with: { resources: true },
    });

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
      })
    )
    .mutation(async ({ input }) => {
      try {
        const result = await scanInstallFolderOnceWithLegacySupport(input.folderPath, {
          omitCheckpointRounds: input.omitCheckpointRounds ?? true,
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
      })
    )
    .mutation(async ({ input }) => {
      try {
        const result = await importLegacyFolderWithPlan(input.folderPath, input.reviewedSlots, {
          deferPhash: input.deferPhash,
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

  openConfiguredPath: publicProcedure
    .input(
      z.object({
        target: z.enum(["website-video-cache", "music-cache", "fpack-extraction"]),
      })
    )
    .mutation(async ({ input }) => {
      const resolvedPath =
        input.target === "website-video-cache"
          ? resolveWebsiteVideoCacheRoot()
          : input.target === "music-cache"
            ? resolveMusicCacheRoot()
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
          settings: z.boolean().optional(),
        })
        .optional()
    )
    .mutation(async ({ input }) => {
      const db = getDb();
      const {
        rounds = true,
        playlists = true,
        stats = true,
        history = true,
        cache = true,
        videoCache = true,
        settings = true,
      } = input ?? {};

      await db.transaction(async (tx) => {
        if (cache) {
          await tx.delete(multiplayerMatchCache);
          await tx.delete(resultSyncQueue);
        }
        if (history) {
          await tx.delete(singlePlayerRunHistory);
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

      if (settings) {
        getStore().clear();
      }
      if (videoCache) {
        await Promise.all([clearWebsiteVideoCache(), clearPlayableVideoCache()]);
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
