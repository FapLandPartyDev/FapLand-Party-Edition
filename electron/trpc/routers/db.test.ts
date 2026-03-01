// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const { getDbMock } = vi.hoisted(() => ({
  getDbMock: vi.fn(),
}));

const { queueWebsiteVideoCacheImmediatelyMock } = vi.hoisted(() => ({
  queueWebsiteVideoCacheImmediatelyMock: vi.fn(async () => {}),
}));

const { exportInstalledDatabaseMock } = vi.hoisted(() => ({
  exportInstalledDatabaseMock: vi.fn(),
}));

const {
  exportLibraryPackageMock,
  analyzeLibraryExportPackageMock,
  getLibraryExportPackageStatusMock,
  requestLibraryExportPackageAbortMock,
} = vi.hoisted(() => ({
  exportLibraryPackageMock: vi.fn(),
  analyzeLibraryExportPackageMock: vi.fn(),
  getLibraryExportPackageStatusMock: vi.fn(),
  requestLibraryExportPackageAbortMock: vi.fn(),
}));

const { runDatabaseBackupMock, resolveDatabaseBackupDirMock } = vi.hoisted(() => ({
  runDatabaseBackupMock: vi.fn(),
  resolveDatabaseBackupDirMock: vi.fn(() => "/tmp/database-backups"),
}));

const { createPlaintextSettingsFileMock, runSettingsBackupMock, resolveSettingsBackupDirMock } =
  vi.hoisted(() => ({
    createPlaintextSettingsFileMock: vi.fn(async () => ({
      plaintextPath:
        "/tmp/settings-backups/f-land-settings-plaintext-2026-04-21T12-00-00.000Z.json",
    })),
    runSettingsBackupMock: vi.fn(),
    resolveSettingsBackupDirMock: vi.fn(() => "/tmp/settings-backups"),
  }));

const { shellOpenPathMock, shellShowItemInFolderMock } = vi.hoisted(() => ({
  shellOpenPathMock: vi.fn(),
  shellShowItemInFolderMock: vi.fn(),
}));

const { getStoreMock, initStoreMock } = vi.hoisted(() => ({
  getStoreMock: vi.fn(),
  initStoreMock: vi.fn(async () => {}),
}));

const { clearWebsiteVideoCacheMock, clearPlayableVideoCacheMock } = vi.hoisted(() => ({
  clearWebsiteVideoCacheMock: vi.fn(),
  clearPlayableVideoCacheMock: vi.fn(),
}));

const { clearMusicCacheMock, resolveMusicCacheRootMock } = vi.hoisted(() => ({
  clearMusicCacheMock: vi.fn(),
  resolveMusicCacheRootMock: vi.fn(() => "/tmp/music-cache"),
}));

const { clearFpackExtractionCacheMock, getFpackExtractionRootMock } = vi.hoisted(() => ({
  clearFpackExtractionCacheMock: vi.fn(),
  getFpackExtractionRootMock: vi.fn(async () => "/tmp/fpacks"),
}));

const { getWebsiteVideoCacheStateMock } = vi.hoisted(() => ({
  getWebsiteVideoCacheStateMock: vi.fn<
    (uri: string) => Promise<"not_applicable" | "cached" | "pending">
  >(async () => "not_applicable"),
}));

const {
  calculateFunscriptDifficultyFromUriMock,
  convertLocalFunscriptToManagedHardModeMock,
  getHardModeAttachmentRevertMock,
  recordHardModeAttachmentRevertsMock,
} = vi.hoisted(() => ({
  calculateFunscriptDifficultyFromUriMock: vi.fn<(funscriptUri: string) => Promise<number | null>>(
    async () => null
  ),
  convertLocalFunscriptToManagedHardModeMock: vi.fn(),
  getHardModeAttachmentRevertMock: vi.fn(),
  recordHardModeAttachmentRevertsMock: vi.fn(async () => undefined),
}));

const { createResourceUriResolverMock, getDisabledRoundIdSetMock, resolveResourceUrisMock } =
  vi.hoisted(() => {
    type ResourceUriInput = { videoUri: string; funscriptUri: string | null };
    type ResourceUriResolver = (input: ResourceUriInput) => ResourceUriInput;
    const resolveResourceUrisMock = vi.fn<ResourceUriResolver>((input) => input);

    return {
      createResourceUriResolverMock: vi.fn<() => ResourceUriResolver>(
        () => resolveResourceUrisMock
      ),
      getDisabledRoundIdSetMock: vi.fn(() => new Set<string>()),
      resolveResourceUrisMock,
    };
  });

vi.mock("../../services/db", () => ({
  getDb: getDbMock,
}));

vi.mock("../../services/webVideoScanService", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../services/webVideoScanService")>()),
  queueWebsiteVideoCacheImmediately: queueWebsiteVideoCacheImmediatelyMock,
}));

vi.mock("../../services/installExport", () => ({
  exportInstalledDatabase: exportInstalledDatabaseMock,
}));

vi.mock("../../services/libraryExportPackage", () => ({
  exportLibraryPackage: exportLibraryPackageMock,
  analyzeLibraryExportPackage: analyzeLibraryExportPackageMock,
  getLibraryExportPackageStatus: getLibraryExportPackageStatusMock,
  requestLibraryExportPackageAbort: requestLibraryExportPackageAbortMock,
}));

vi.mock("../../services/databaseBackup", () => ({
  runDatabaseBackup: runDatabaseBackupMock,
  resolveDatabaseBackupDir: resolveDatabaseBackupDirMock,
}));

vi.mock("../../services/settingsBackup", () => ({
  createPlaintextSettingsFile: createPlaintextSettingsFileMock,
  runSettingsBackup: runSettingsBackupMock,
  resolveSettingsBackupDir: resolveSettingsBackupDirMock,
}));

vi.mock("electron", () => ({
  shell: {
    openPath: shellOpenPathMock,
    showItemInFolder: shellShowItemInFolderMock,
  },
}));

vi.mock("../../services/store", () => ({
  getStore: getStoreMock,
  initStore: initStoreMock,
}));

vi.mock("../../services/webVideo", () => ({
  clearWebsiteVideoCache: clearWebsiteVideoCacheMock,
  getWebsiteVideoCacheState: getWebsiteVideoCacheStateMock,
  getWebsiteVideoTargetUrl: vi.fn((uri: string) => {
    const trimmed = uri.trim();
    if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
      return trimmed;
    }
    return null;
  }),
  removeCachedWebsiteVideo: vi.fn(),
  resolveWebsiteVideoCacheRoot: vi.fn(() => "/tmp/web-video-cache"),
  resolveWebsiteVideoStream: vi.fn(),
}));

vi.mock("../../services/playableVideo", () => ({
  clearPlayableVideoCache: clearPlayableVideoCacheMock,
}));

vi.mock("../../services/musicDownload", () => ({
  clearMusicCache: clearMusicCacheMock,
  resolveMusicCacheRoot: resolveMusicCacheRootMock,
}));

vi.mock("../../services/fpack", () => ({
  clearFpackExtractionCache: clearFpackExtractionCacheMock,
  getFpackExtractionRoot: getFpackExtractionRootMock,
}));

vi.mock("../../services/funscript", () => ({
  calculateFunscriptDifficultyFromUri: calculateFunscriptDifficultyFromUriMock,
  convertLocalFunscriptToManagedHardMode: convertLocalFunscriptToManagedHardModeMock,
  convertFunscriptUriToManagedHardMode: convertLocalFunscriptToManagedHardModeMock,
  getHardModeAttachmentRevert: getHardModeAttachmentRevertMock,
  recordHardModeAttachmentReverts: recordHardModeAttachmentRevertsMock,
}));

vi.mock("../../services/integrations", () => ({
  createResourceUriResolver: createResourceUriResolverMock,
  getDisabledRoundIdSet: getDisabledRoundIdSetMock,
  resolveResourceUris: resolveResourceUrisMock,
}));

import { dbRouter } from "./db";

function createRendererCaller() {
  return dbRouter.createCaller({
    event: {
      sender: {},
    },
  } as never);
}

function createSinglePlayerRunSaveInput() {
  const playlistConfig = {
    playlistVersion: 1,
    boardConfig: {
      mode: "linear" as const,
      totalIndices: 10,
      safePointIndices: [],
      safePointRestMsByIndex: {},
      normalRoundRefsByIndex: {},
      normalRoundOrder: [],
      cumRoundRefs: [],
    },
    saveMode: "checkpoint" as const,
    roundStartDelayMs: 0,
    dice: { min: 1, max: 6 },
    perkSelection: { optionsPerPick: 3, triggerChancePerCompletedRound: 0.35 },
    perkPool: { enabledPerkIds: [], enabledAntiPerkIds: [] },
    probabilityScaling: {
      initialIntermediaryProbability: 0,
      initialAntiPerkProbability: 0,
      intermediaryIncreasePerRound: 0,
      antiPerkIncreasePerRound: 0,
      maxIntermediaryProbability: 1,
      maxAntiPerkProbability: 1,
    },
    economy: {
      startingMoney: 0,
      moneyPerCompletedRound: 0,
      startingScore: 0,
      scorePerCompletedRound: 0,
      scorePerIntermediary: 0,
      scorePerActiveAntiPerk: 0,
      scorePerCumRoundSuccess: 0,
    },
  };

  const gameConfig = {
    board: [{ id: "start", name: "Start", kind: "start" as const }],
    runtimeGraph: {
      startNodeId: "start",
      pathChoiceTimeoutMs: 12000,
      edges: [],
      edgesById: {},
      outgoingEdgeIdsByNodeId: {},
      randomRoundPoolsById: {},
      nodeIndexById: { start: 0 },
    },
    dice: { min: 1, max: 6 },
    perkSelection: {
      optionsPerPick: 3,
      triggerChancePerCompletedRound: 0.35,
      includeAntiPerksInChoices: false,
    },
    perkPool: { enabledPerkIds: [], enabledAntiPerkIds: [] },
    probabilityScaling: {
      initialIntermediaryProbability: 0,
      initialAntiPerkProbability: 0,
      intermediaryIncreasePerRound: 0,
      antiPerkIncreasePerRound: 0,
      maxIntermediaryProbability: 1,
      maxAntiPerkProbability: 1,
    },
    singlePlayer: {
      totalIndices: 10,
      safePointIndices: [],
      normalRoundIdsByIndex: {},
      cumRoundIds: [],
    },
    economy: {
      startingMoney: 0,
      moneyPerCompletedRound: 0,
      startingScore: 0,
      scorePerCompletedRound: 0,
      scorePerIntermediary: 0,
      scorePerActiveAntiPerk: 0,
      scorePerCumRoundSuccess: 0,
    },
    roundStartDelayMs: 0,
  };

  return {
    playlistId: "playlist-1",
    playlistName: "Default Playlist",
    playlistFormatVersion: 1,
    saveMode: "checkpoint" as const,
    snapshot: {
      version: 1 as const,
      playlistId: "playlist-1",
      playlistFormatVersion: 1,
      playlistConfig,
      saveMode: "checkpoint" as const,
      gameState: {
        config: gameConfig,
        players: [
          {
            id: "player-1",
            name: "Player",
            currentNodeId: "start",
            position: 0,
            stats: {
              diceMin: 1,
              diceMax: 6,
              roundPauseMs: 0,
              perkFrequency: 0,
              perkLuck: 0,
            },
            money: 0,
            score: 0,
            perks: [],
            antiPerks: [],
            inventory: [],
            activePerkEffects: [],
            roundControl: { pauseCharges: 0, skipCharges: 0 },
          },
        ],
        currentPlayerIndex: 0,
        turn: 1,
        sessionPhase: "normal" as const,
        bonusRolls: 0,
        nextCumRoundIndex: 0,
        highscore: 0,
        intermediaryProbability: 0,
        antiPerkProbability: 0,
        queuedRound: null,
        activeRound: null,
        queuedRoundAudioEffect: null,
        activeRoundAudioEffect: null,
        pendingPathChoice: null,
        pendingPerkSelection: null,
        lastTraversalPathNodeIds: [],
        playedRoundIdsByPool: {},
        log: [],
        lastRoll: null,
        completionReason: null,
      },
      sessionStartedAtMs: 1,
      savedAtMs: 2,
    },
  };
}

type CacheRow = {
  lobbyId: string;
  finishedAt: Date;
  isFinal: boolean;
  resultsJson: unknown;
  createdAt: Date;
  updatedAt: Date;
};

type QueueRow = {
  lobbyId: string;
  createdAt: Date;
  lastAttemptAt: Date | null;
};

type SinglePlayerRunRow = {
  id: string;
  finishedAt: Date;
  score: number;
  survivedDurationSec: number | null;
  highscoreBefore: number;
  highscoreAfter: number;
  wasNewHighscore: boolean;
  completionReason: string;
  playlistId: string | null;
  playlistName: string;
  playlistFormatVersion: number | null;
  endingPosition: number;
  turn: number;
  cheatModeActive?: boolean;
  assistedActive?: boolean;
  assistedSaveMode?: "checkpoint" | "everywhere" | null;
  createdAt: Date;
};

type SinglePlayerRunSaveRow = {
  id: string;
  playlistId: string;
  playlistName: string;
  playlistFormatVersion: number | null;
  saveMode: "checkpoint" | "everywhere";
  snapshotJson: unknown;
  savedAt: Date;
  createdAt: Date;
  updatedAt: Date;
};

type HeroRow = {
  id: string;
  name: string;
  author: string | null;
  description: string | null;
  createdAt: Date;
  updatedAt: Date;
};

type RoundRow = {
  id: string;
  name: string;
  author: string | null;
  description: string | null;
  bpm: number | null;
  difficulty: number | null;
  startTime: number | null;
  endTime: number | null;
  type: "Normal" | "Interjection" | "Cum";
  heroId?: string | null;
  installSourceKey?: string | null;
  previewImage?: string | null;
  phash?: string | null;
  excludeFromRandom?: boolean;
  createdAt?: Date;
  updatedAt?: Date;
};

type ResourceRow = {
  id: string;
  roundId: string;
  videoUri: string;
  funscriptUri: string | null;
  funscriptOffsetMs?: number | null;
  phash: string | null;
  durationMs: number | null;
  disabled: boolean;
  createdAt: Date;
  updatedAt: Date;
};

describe("dbRouter local highscore and multiplayer cache", () => {
  let dbMockRef: ReturnType<typeof getDbMock>;
  let storeMockRef: ReturnType<typeof getStoreMock>;
  let heroesByIdRef: Map<string, HeroRow>;
  let roundsByIdRef: Map<string, RoundRow>;
  let resourcesByIdRef: Map<string, ResourceRow>;

  beforeEach(() => {
    vi.clearAllMocks();
    clearWebsiteVideoCacheMock.mockResolvedValue(undefined);
    clearPlayableVideoCacheMock.mockResolvedValue(undefined);
    clearMusicCacheMock.mockResolvedValue(undefined);
    clearFpackExtractionCacheMock.mockResolvedValue(undefined);
    resolveMusicCacheRootMock.mockReturnValue("/tmp/music-cache");
    getFpackExtractionRootMock.mockResolvedValue("/tmp/fpacks");
    getWebsiteVideoCacheStateMock.mockResolvedValue("not_applicable");
    calculateFunscriptDifficultyFromUriMock.mockResolvedValue(null);
    getHardModeAttachmentRevertMock.mockResolvedValue(null);
    convertLocalFunscriptToManagedHardModeMock.mockResolvedValue({
      funscriptUri: "app://media/managed-hard-mode.funscript",
      sourceActions: 3,
      outputActions: 5,
    });
    exportInstalledDatabaseMock.mockResolvedValue({
      exportDir: "/tmp/f-land/export/2026-03-05T20-00-00.000Z",
      heroFiles: 1,
      roundFiles: 1,
      exportedRounds: 2,
      includeResourceUris: false,
    });
    exportLibraryPackageMock.mockResolvedValue({
      exportDir: "/tmp/f-land/export/library",
      heroFiles: 1,
      roundFiles: 1,
      videoFiles: 1,
      funscriptFiles: 1,
      exportedRounds: 2,
      includeMedia: true,
      compression: {
        enabled: true,
        encoderName: "av1_nvenc",
        encoderKind: "hardware",
        strength: 80,
        reencodedVideos: 1,
        alreadyAv1Copied: 0,
        actualVideoBytes: 1024,
      },
    });
    analyzeLibraryExportPackageMock.mockResolvedValue({
      videoTotals: {
        uniqueVideos: 1,
        localVideos: 1,
        remoteVideos: 0,
        alreadyAv1Videos: 0,
        estimatedReencodeVideos: 1,
      },
      compression: {
        supported: true,
        defaultMode: "av1",
        encoderName: "av1_nvenc",
        encoderKind: "hardware",
        warning: null,
        strength: 80,
        estimate: {
          sourceVideoBytes: 1024,
          expectedVideoBytes: 768,
          savingsBytes: 256,
          estimatedCompressionSeconds: 60,
          approximate: false,
        },
      },
      settings: {
        outputContainer: "mp4",
        audioCodec: "aac",
        audioBitrateKbps: 128,
        lowPriority: true,
        parallelJobs: 1,
      },
      estimate: {
        sourceVideoBytes: 1024,
        expectedVideoBytes: 768,
        savingsBytes: 256,
        estimatedCompressionSeconds: 60,
        approximate: false,
      },
    });
    getLibraryExportPackageStatusMock.mockReturnValue({
      state: "idle",
      phase: "idle",
      startedAt: null,
      finishedAt: null,
      lastMessage: null,
      progress: { completed: 0, total: 0 },
      stats: { heroFiles: 0, roundFiles: 0, videoFiles: 0, funscriptFiles: 0 },
      compression: null,
    });
    requestLibraryExportPackageAbortMock.mockReturnValue({
      state: "running",
      phase: "copying",
      startedAt: "2026-03-05T20:00:00.000Z",
      finishedAt: null,
      lastMessage: "Abort requested. Waiting for the current export step to finish...",
      progress: { completed: 1, total: 2 },
      stats: { heroFiles: 0, roundFiles: 0, videoFiles: 1, funscriptFiles: 0 },
      compression: null,
    });
    runDatabaseBackupMock.mockResolvedValue({
      backupPath: "/tmp/database-backups/f-land-db-backup-2026-04-21T12-00-00.000Z.db",
      deletedBackups: 0,
    });
    runSettingsBackupMock.mockResolvedValue({
      backupPath: "/tmp/settings-backups/f-land-settings-backup-2026-04-21T12-00-00.000Z.json",
      deletedBackups: 0,
    });
    createPlaintextSettingsFileMock.mockResolvedValue({
      plaintextPath:
        "/tmp/settings-backups/f-land-settings-plaintext-2026-04-21T12-00-00.000Z.json",
    });
    shellOpenPathMock.mockResolvedValue("");

    const cacheByLobby = new Map<string, CacheRow>();
    const queueByLobby = new Map<string, QueueRow>();
    const singleRuns: SinglePlayerRunRow[] = [];
    const singleRunSaves = new Map<string, SinglePlayerRunSaveRow>();
    heroesByIdRef = new Map<string, HeroRow>([
      [
        "hero-1",
        {
          id: "hero-1",
          name: "Hero One",
          author: "Author One",
          description: "Original hero",
          createdAt: new Date("2026-03-05T00:00:00.000Z"),
          updatedAt: new Date("2026-03-05T00:00:00.000Z"),
        },
      ],
    ]);
    roundsByIdRef = new Map<string, RoundRow>([
      [
        "round-1",
        {
          id: "round-1",
          name: "Round One",
          author: "Round Author",
          description: "Original round",
          bpm: 120,
          difficulty: 2,
          startTime: 1000,
          endTime: 5000,
          type: "Normal",
          installSourceKey: null,
          previewImage: null,
          phash: null,
          excludeFromRandom: false,
          createdAt: new Date("2026-03-05T00:00:00.000Z"),
          updatedAt: new Date("2026-03-05T00:00:00.000Z"),
        },
      ],
    ]);
    resourcesByIdRef = new Map<string, ResourceRow>([
      [
        "resource-1",
        {
          id: "resource-1",
          roundId: "round-1",
          videoUri: "file:///tmp/round-1.mp4",
          funscriptUri: null,
          phash: null,
          durationMs: null,
          disabled: false,
          createdAt: new Date("2026-03-05T00:00:00.000Z"),
          updatedAt: new Date("2026-03-05T00:00:00.000Z"),
        },
      ],
    ]);
    let highscore = 0;
    let highscoreCheatMode = false;
    let highscoreAssisted = false;
    let highscoreAssistedSaveMode: "checkpoint" | "everywhere" | null = null;
    const storeMock = {
      clear: vi.fn(),
    };

    const getTableName = (table: unknown): string | null => {
      if (!table || typeof table !== "object") return null;
      for (const symbol of Object.getOwnPropertySymbols(table)) {
        const value = (table as Record<symbol, unknown>)[symbol];
        if (typeof value === "string") {
          return value;
        }
      }
      return null;
    };

    const extractSqlParams = (input: unknown): unknown[] => {
      const values: unknown[] = [];
      const visit = (node: unknown) => {
        if (!node) return;
        if (Array.isArray(node)) {
          for (const item of node) visit(item);
          return;
        }
        if (typeof node !== "object") return;
        if ("value" in node) values.push((node as { value: unknown }).value);
        if (
          "queryChunks" in node &&
          Array.isArray((node as { queryChunks?: unknown[] }).queryChunks)
        ) {
          for (const chunk of (node as { queryChunks: unknown[] }).queryChunks) visit(chunk);
        }
      };
      visit(input);
      return values;
    };

    const dbMock = {
      query: {
        singlePlayerRunHistory: {
          findMany: vi.fn(async (input?: { limit?: number }) => {
            const runs = [...singleRuns].sort(
              (a, b) => b.finishedAt.getTime() - a.finishedAt.getTime()
            );
            return typeof input?.limit === "number" ? runs.slice(0, input.limit) : runs;
          }),
        },
        singlePlayerRunSave: {
          findFirst: vi.fn(async (input: { where: unknown }) => {
            const [playlistId] = extractSqlParams(input.where);
            return typeof playlistId === "string" ? (singleRunSaves.get(playlistId) ?? null) : null;
          }),
          findMany: vi.fn(async () =>
            [...singleRunSaves.values()].sort((a, b) => b.savedAt.getTime() - a.savedAt.getTime())
          ),
        },
        multiplayerMatchCache: {
          findFirst: vi.fn(async (input: { where: unknown }) => {
            const [lobbyId] = extractSqlParams(input.where);
            if (typeof lobbyId === "string") {
              return cacheByLobby.get(lobbyId) ?? null;
            }
            return cacheByLobby.values().next().value ?? null;
          }),
          findMany: vi.fn(async (input: { limit: number }) =>
            [...cacheByLobby.values()]
              .sort((a, b) => b.finishedAt.getTime() - a.finishedAt.getTime())
              .slice(0, input.limit)
          ),
        },
        resultSyncQueue: {
          findMany: vi.fn(async () =>
            [...queueByLobby.values()].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
          ),
        },
        hero: {
          findFirst: vi.fn(async (input: { where: unknown }) => {
            const values = extractSqlParams(input.where).filter(
              (value): value is string => typeof value === "string"
            );
            if (values.length > 0) {
              return (
                values
                  .map(
                    (value) =>
                      heroesByIdRef.get(value) ??
                      [...heroesByIdRef.values()].find((entry) => entry.name === value) ??
                      null
                  )
                  .find((entry): entry is HeroRow => entry !== null) ?? null
              );
            }
            return heroesByIdRef.values().next().value ?? null;
          }),
        },
        round: {
          findFirst: vi.fn(async (input: { where: unknown; with?: { resources?: unknown } }) => {
            const values = extractSqlParams(input.where).filter(
              (value): value is string => typeof value === "string"
            );
            const matchingId = values.find((value) => roundsByIdRef.has(value));
            if (matchingId) {
              const existing = roundsByIdRef.get(matchingId) ?? null;
              if (!existing) return null;
              if (input.with?.resources) {
                return {
                  ...existing,
                  resources: [...resourcesByIdRef.values()]
                    .filter((entry) => entry.roundId === matchingId)
                    .map((entry) => ({ ...entry })),
                };
              }
              return existing;
            }
            if (values.length > 0) return null;
            const fallback = roundsByIdRef.values().next().value ?? null;
            if (!fallback) return null;
            if (input.with?.resources) {
              return {
                ...fallback,
                resources: [...resourcesByIdRef.values()]
                  .filter((entry) => entry.roundId === fallback.id)
                  .map((entry) => ({ ...entry })),
              };
            }
            return fallback;
          }),
          findMany: vi.fn(
            async (input: {
              where?: unknown;
              with?: { resources?: unknown; hero?: unknown };
              columns?: Record<string, boolean>;
            }) => {
              const ids = extractSqlParams(input.where).filter(
                (value): value is string => typeof value === "string"
              );
              const baseRows =
                ids.length === 0
                  ? [...roundsByIdRef.values()]
                  : ids.some((id) => roundsByIdRef.has(id))
                    ? ids
                        .map((id) => roundsByIdRef.get(id))
                        .filter((entry): entry is RoundRow => entry !== undefined)
                    : [...roundsByIdRef.values()].filter((entry) =>
                        ids.includes(entry.heroId ?? "")
                      );

              if (!input.with?.resources) {
                return baseRows;
              }

              return baseRows.map((entry) => ({
                ...entry,
                resources: [...resourcesByIdRef.values()]
                  .filter((resourceEntry) => resourceEntry.roundId === entry.id)
                  .sort((a, b) => {
                    const createdDelta = a.createdAt.getTime() - b.createdAt.getTime();
                    if (createdDelta !== 0) return createdDelta;
                    return a.id.localeCompare(b.id);
                  })
                  .map((resourceEntry) => ({ ...resourceEntry })),
              }));
            }
          ),
        },
        resource: {
          findFirst: vi.fn(async (input: { where: unknown }) => {
            const values = extractSqlParams(input.where).filter(
              (value): value is string => typeof value === "string"
            );
            const [firstValue] = values;
            return (
              [...resourcesByIdRef.values()].find(
                (entry) =>
                  entry.id === firstValue || (entry.roundId === firstValue && !entry.disabled)
              ) ?? null
            );
          }),
          findMany: vi.fn(async () =>
            [...resourcesByIdRef.values()].sort((a, b) => {
              const createdDelta = b.createdAt.getTime() - a.createdAt.getTime();
              if (createdDelta !== 0) return createdDelta;
              return a.id.localeCompare(b.id);
            })
          ),
        },
      },
      select: vi.fn(() => ({
        from: (table: unknown) => ({
          where: (whereClause: unknown) => {
            if (getTableName(table) === "GameProfile") {
              return {
                get: async () =>
                  highscore > 0
                    ? {
                        id: "local",
                        highscore,
                        highscoreCheatMode,
                        highscoreAssisted,
                        highscoreAssistedSaveMode,
                        createdAt: new Date("2026-03-05T00:00:00.000Z"),
                        updatedAt: new Date("2026-03-05T00:00:00.000Z"),
                      }
                    : null,
              };
            }

            if (getTableName(table) === "Round") {
              const [heroIdValue] = extractSqlParams(whereClause);
              return Promise.resolve(
                [...roundsByIdRef.values()]
                  .filter((entry) => entry.heroId === heroIdValue)
                  .map((entry) => ({ id: entry.id }))
              );
            }

            return Promise.resolve([]);
          },
        }),
      })),
      insert: vi.fn((table: unknown) => ({
        values: (data: unknown) => ({
          onConflictDoUpdate: ({ set }: { set: Record<string, unknown> }) => ({
            returning: async () => {
              if (getTableName(table) === "GameProfile") {
                highscore = Number(
                  set.highscore ?? (data as { highscore?: number }).highscore ?? 0
                );
                highscoreCheatMode = Boolean(
                  set.highscoreCheatMode ??
                  (data as { highscoreCheatMode?: boolean }).highscoreCheatMode ??
                  false
                );
                highscoreAssisted = Boolean(
                  set.highscoreAssisted ??
                  (data as { highscoreAssisted?: boolean }).highscoreAssisted ??
                  false
                );
                highscoreAssistedSaveMode =
                  (set.highscoreAssistedSaveMode as "checkpoint" | "everywhere" | undefined) ??
                  (data as { highscoreAssistedSaveMode?: "checkpoint" | "everywhere" | null })
                    .highscoreAssistedSaveMode ??
                  null;
                return [];
              }

              if (getTableName(table) === "MultiplayerMatchCache") {
                const input = data as CacheRow;
                const existing = cacheByLobby.get(input.lobbyId);
                const now = new Date();
                const next: CacheRow = existing
                  ? { ...existing, ...input, updatedAt: (set.updatedAt as Date) ?? now }
                  : { ...input, createdAt: now, updatedAt: now };
                cacheByLobby.set(next.lobbyId, next);
                return [next];
              }

              if (getTableName(table) === "ResultSyncQueue") {
                const input = data as { lobbyId: string; lastAttemptAt?: Date };
                const existing = queueByLobby.get(input.lobbyId);
                const next: QueueRow = existing
                  ? {
                      ...existing,
                      lastAttemptAt:
                        (set.lastAttemptAt as Date | undefined) ?? existing.lastAttemptAt,
                    }
                  : {
                      lobbyId: input.lobbyId,
                      createdAt: new Date(),
                      lastAttemptAt: input.lastAttemptAt ?? null,
                    };
                queueByLobby.set(next.lobbyId, next);
                return [next];
              }

              if (getTableName(table) === "SinglePlayerRunSave") {
                const input = data as Omit<SinglePlayerRunSaveRow, "id" | "createdAt">;
                const existing = singleRunSaves.get(input.playlistId);
                const now = new Date("2026-03-06T00:00:00.000Z");
                const next: SinglePlayerRunSaveRow = existing
                  ? {
                      ...existing,
                      ...input,
                      ...set,
                      updatedAt: (set.updatedAt as Date | undefined) ?? now,
                    }
                  : {
                      id: `save-${singleRunSaves.size + 1}`,
                      createdAt: now,
                      ...input,
                      updatedAt: input.updatedAt ?? now,
                    };
                singleRunSaves.set(next.playlistId, next);
                return [next];
              }

              return [];
            },
            then: async (resolve: (value: unknown) => unknown) => {
              if (getTableName(table) !== "GameProfile") return resolve([]);
              highscore = Number(set.highscore ?? (data as { highscore?: number }).highscore ?? 0);
              highscoreCheatMode = Boolean(
                set.highscoreCheatMode ??
                (data as { highscoreCheatMode?: boolean }).highscoreCheatMode ??
                false
              );
              highscoreAssisted = Boolean(
                set.highscoreAssisted ??
                (data as { highscoreAssisted?: boolean }).highscoreAssisted ??
                false
              );
              highscoreAssistedSaveMode =
                (set.highscoreAssistedSaveMode as "checkpoint" | "everywhere" | undefined) ??
                (data as { highscoreAssistedSaveMode?: "checkpoint" | "everywhere" | null })
                  .highscoreAssistedSaveMode ??
                null;
              return resolve([]);
            },
          }),
          then: async (resolve: (value: unknown) => unknown) => {
            if (getTableName(table) !== "GameProfile") return resolve([]);
            highscore = Number((data as { highscore?: number }).highscore ?? 0);
            highscoreCheatMode = Boolean(
              (data as { highscoreCheatMode?: boolean }).highscoreCheatMode ?? false
            );
            highscoreAssisted = Boolean(
              (data as { highscoreAssisted?: boolean }).highscoreAssisted ?? false
            );
            highscoreAssistedSaveMode =
              (data as { highscoreAssistedSaveMode?: "checkpoint" | "everywhere" | null })
                .highscoreAssistedSaveMode ?? null;
            return resolve([]);
          },
          onConflictDoNothing: () => ({
            returning: async () => {
              if (getTableName(table) !== "ResultSyncQueue") return [];
              const input = data as { lobbyId: string };
              if (queueByLobby.has(input.lobbyId)) return [];
              const next: QueueRow = {
                lobbyId: input.lobbyId,
                createdAt: new Date(),
                lastAttemptAt: null,
              };
              queueByLobby.set(next.lobbyId, next);
              return [next];
            },
          }),
          returning: async () => {
            if (getTableName(table) === "SinglePlayerRunHistory") {
              const row: SinglePlayerRunRow = {
                id: `run-${singleRuns.length + 1}`,
                createdAt: new Date(),
                ...(data as Omit<SinglePlayerRunRow, "id" | "createdAt">),
              };
              singleRuns.push(row);
              return [row];
            }
            if (getTableName(table) === "Round") {
              const input = data as Omit<RoundRow, "id"> & Partial<Pick<RoundRow, "id">>;
              const row: RoundRow = {
                id: input.id ?? `round-${roundsByIdRef.size + 1}`,
                name: input.name,
                author: input.author ?? null,
                description: input.description ?? null,
                bpm: input.bpm ?? null,
                difficulty: input.difficulty ?? null,
                startTime: input.startTime ?? null,
                endTime: input.endTime ?? null,
                type: input.type,
                heroId: input.heroId ?? null,
                installSourceKey: input.installSourceKey ?? null,
                previewImage: input.previewImage ?? null,
                phash: input.phash ?? null,
                excludeFromRandom: input.excludeFromRandom ?? false,
                createdAt: new Date("2026-03-06T00:00:00.000Z"),
                updatedAt: new Date("2026-03-06T00:00:00.000Z"),
              };
              roundsByIdRef.set(row.id, row);
              return [row];
            }
            if (getTableName(table) === "Resource") {
              const input = data as Omit<ResourceRow, "id" | "createdAt" | "updatedAt"> &
                Partial<Pick<ResourceRow, "id" | "createdAt" | "updatedAt">>;
              const row: ResourceRow = {
                id: input.id ?? `resource-${resourcesByIdRef.size + 1}`,
                roundId: input.roundId,
                videoUri: input.videoUri,
                funscriptUri: input.funscriptUri ?? null,
                phash: input.phash ?? null,
                durationMs: input.durationMs ?? null,
                disabled: input.disabled ?? false,
                createdAt: input.createdAt ?? new Date("2026-03-06T00:00:00.000Z"),
                updatedAt: input.updatedAt ?? new Date("2026-03-06T00:00:00.000Z"),
              };
              resourcesByIdRef.set(row.id, row);
              return [row];
            }
            return [];
          },
        }),
      })),
      update: vi.fn((table: unknown) => ({
        set: (data: Record<string, unknown>) => ({
          where: (whereClause: unknown) => ({
            then: async (resolve: (value: unknown) => unknown) => {
              const values = extractSqlParams(whereClause).filter(
                (value): value is string => typeof value === "string"
              );
              if (getTableName(table) === "Hero") {
                const heroId = values.find((value) => heroesByIdRef.has(value));
                const existing = heroId
                  ? heroesByIdRef.get(heroId)
                  : (heroesByIdRef.values().next().value ?? null);
                if (existing) {
                  heroesByIdRef.set(existing.id, {
                    ...existing,
                    ...data,
                    updatedAt: new Date("2026-03-06T00:00:00.000Z"),
                  });
                }
              }

              if (getTableName(table) === "Round") {
                const roundId = values.find((value) => roundsByIdRef.has(value));
                const existing = roundId
                  ? roundsByIdRef.get(roundId)
                  : (roundsByIdRef.values().next().value ?? null);
                if (existing) {
                  roundsByIdRef.set(existing.id, { ...existing, ...data });
                }
              }

              if (getTableName(table) === "Resource") {
                const resourceId = values.find((value) => resourcesByIdRef.has(value));
                const existing = resourceId
                  ? resourcesByIdRef.get(resourceId)
                  : (resourcesByIdRef.values().next().value ?? null);
                if (existing) {
                  resourcesByIdRef.set(existing.id, {
                    ...existing,
                    ...data,
                    updatedAt: new Date("2026-03-06T00:00:00.000Z"),
                  } as ResourceRow);
                }
              }

              return resolve([]);
            },
            returning: async () => {
              const values = extractSqlParams(whereClause).filter(
                (value): value is string => typeof value === "string"
              );
              if (getTableName(table) === "Hero") {
                const heroId = values.find((value) => heroesByIdRef.has(value));
                const existing = heroId
                  ? heroesByIdRef.get(heroId)
                  : (heroesByIdRef.values().next().value ?? null);
                if (!existing) throw new Error("Hero not found");
                const next = {
                  ...existing,
                  ...data,
                  updatedAt: new Date("2026-03-06T00:00:00.000Z"),
                };
                heroesByIdRef.set(existing.id, next);
                return [next];
              }

              if (getTableName(table) === "Round") {
                const roundId = values.find((value) => roundsByIdRef.has(value));
                const existing = roundId
                  ? roundsByIdRef.get(roundId)
                  : (roundsByIdRef.values().next().value ?? null);
                if (!existing) throw new Error("Round not found");
                const next = { ...existing, ...data };
                roundsByIdRef.set(existing.id, next);
                return [next];
              }

              if (getTableName(table) === "Resource") {
                const resourceId = values.find((value) => resourcesByIdRef.has(value));
                const existing = resourceId
                  ? resourcesByIdRef.get(resourceId)
                  : (resourcesByIdRef.values().next().value ?? null);
                if (!existing) throw new Error("Resource not found");
                const next = {
                  ...existing,
                  ...data,
                  updatedAt: new Date("2026-03-06T00:00:00.000Z"),
                };
                resourcesByIdRef.set(existing.id, next as ResourceRow);
                return [next];
              }

              return [];
            },
          }),
        }),
      })),
      delete: vi.fn((table: unknown) => ({
        where: (whereClause: unknown) => ({
          returning: async () => {
            const [value] = extractSqlParams(whereClause);
            if (getTableName(table) === "ResultSyncQueue") {
              const lobbyId = typeof value === "string" ? value : queueByLobby.keys().next().value;
              if (typeof lobbyId !== "string") return [];
              const existing = queueByLobby.get(lobbyId);
              if (!existing) return [];
              queueByLobby.delete(lobbyId);
              return [existing];
            }
            if (getTableName(table) === "SinglePlayerRunHistory") {
              const runId = typeof value === "string" ? value : singleRuns[0]?.id;
              if (typeof runId !== "string") return [];
              const index = singleRuns.findIndex((entry) => entry.id === runId);
              if (index < 0) return [];
              const [deleted] = singleRuns.splice(index, 1);
              return deleted ? [deleted] : [];
            }
            if (getTableName(table) === "SinglePlayerRunSave") {
              const playlistId =
                typeof value === "string" ? value : singleRunSaves.keys().next().value;
              if (typeof playlistId !== "string") return [];
              const existing = singleRunSaves.get(playlistId);
              if (!existing) return [];
              singleRunSaves.delete(playlistId);
              return [existing];
            }
            return [];
          },
          then: async (resolve: (value: unknown) => unknown) => {
            const tableName = getTableName(table);
            const values = extractSqlParams(whereClause).filter(
              (value): value is string => typeof value === "string"
            );
            if (tableName === "Round") {
              const roundIds =
                values.length > 0
                  ? values
                  : [roundsByIdRef.keys().next().value].filter(
                      (value): value is string => typeof value === "string"
                    );
              for (const roundId of roundIds) {
                roundsByIdRef.delete(roundId);
                for (const [resourceId, entry] of resourcesByIdRef.entries()) {
                  if (entry.roundId === roundId) {
                    resourcesByIdRef.delete(resourceId);
                  }
                }
              }
            }
            if (tableName === "Hero") {
              if (values.length === 0) {
                const heroIds = Array.from(heroesByIdRef.keys());
                heroesByIdRef.clear();
                for (const heroId of heroIds) {
                  for (const [roundId, entry] of roundsByIdRef.entries()) {
                    if (entry.heroId !== heroId) continue;
                    roundsByIdRef.delete(roundId);
                    for (const [resourceId, resourceEntry] of resourcesByIdRef.entries()) {
                      if (resourceEntry.roundId === roundId) {
                        resourcesByIdRef.delete(resourceId);
                      }
                    }
                  }
                }
              } else {
                for (const heroId of values) {
                  heroesByIdRef.delete(heroId);
                  for (const [roundId, entry] of roundsByIdRef.entries()) {
                    if (entry.heroId !== heroId) continue;
                    roundsByIdRef.delete(roundId);
                    for (const [resourceId, resourceEntry] of resourcesByIdRef.entries()) {
                      if (resourceEntry.roundId === roundId) {
                        resourcesByIdRef.delete(resourceId);
                      }
                    }
                  }
                }
              }
            }
            if (tableName === "ResultSyncQueue") {
              const lobbyIds = values.length > 0 ? values : Array.from(queueByLobby.keys());
              for (const lobbyId of lobbyIds) {
                queueByLobby.delete(lobbyId);
              }
            }
            if (tableName === "MultiplayerMatchCache") cacheByLobby.clear();
            if (tableName === "SinglePlayerRunHistory") singleRuns.length = 0;
            if (tableName === "SinglePlayerRunSave") singleRunSaves.clear();
            if (tableName === "GameProfile") {
              highscore = 0;
              highscoreCheatMode = false;
              highscoreAssisted = false;
              highscoreAssistedSaveMode = null;
            }
            if (
              tableName === "Resource" ||
              tableName === "PlaylistTrackPlay" ||
              tableName === "Playlist" ||
              tableName === "MultiplayerMatchCache" ||
              tableName === "SinglePlayerRunHistory" ||
              tableName === "SinglePlayerRunSave" ||
              tableName === "GameProfile" ||
              tableName === "Hero" ||
              tableName === "Round" ||
              tableName === "ResultSyncQueue"
            ) {
              return resolve([]);
            }
            return resolve([]);
          },
        }),
        then: async (resolve: (value: unknown) => unknown) => {
          const tableName = getTableName(table);
          if (tableName === "MultiplayerMatchCache") cacheByLobby.clear();
          if (tableName === "ResultSyncQueue") queueByLobby.clear();
          if (tableName === "SinglePlayerRunHistory") singleRuns.length = 0;
          if (tableName === "SinglePlayerRunSave") singleRunSaves.clear();
          if (tableName === "GameProfile") {
            highscore = 0;
            highscoreCheatMode = false;
            highscoreAssisted = false;
            highscoreAssistedSaveMode = null;
          }
          if (tableName === "Hero") {
            heroesByIdRef.clear();
            for (const entry of roundsByIdRef.values()) {
              entry.heroId = null;
            }
          }
          if (tableName === "Round") roundsByIdRef.clear();
          if (
            tableName === "Resource" ||
            tableName === "PlaylistTrackPlay" ||
            tableName === "Playlist" ||
            tableName === "MultiplayerMatchCache" ||
            tableName === "SinglePlayerRunHistory" ||
            tableName === "SinglePlayerRunSave" ||
            tableName === "GameProfile" ||
            tableName === "Hero" ||
            tableName === "Round" ||
            tableName === "ResultSyncQueue"
          ) {
            return resolve([]);
          }
          return resolve([]);
        },
      })),
      transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback(dbMock)),
    };

    dbMockRef = dbMock;
    storeMockRef = storeMock;
    getDbMock.mockReturnValue(dbMockRef);
    getStoreMock.mockReturnValue(storeMockRef);
  });

  it("stores and returns max local highscore", async () => {
    const caller = createRendererCaller();

    expect(await caller.getLocalHighscore()).toMatchObject({
      highscore: 0,
      highscoreCheatMode: false,
    });
    expect(await caller.setLocalHighscore({ highscore: 120 })).toMatchObject({
      highscore: 120,
      highscoreCheatMode: false,
    });
    expect(await caller.setLocalHighscore({ highscore: 75 })).toMatchObject({
      highscore: 120,
      highscoreCheatMode: false,
    });
    expect(await caller.getLocalHighscore()).toMatchObject({
      highscore: 120,
      highscoreCheatMode: false,
    });
  });

  it("supports multiplayer match cache CRUD and sync queue lifecycle", async () => {
    const caller = createRendererCaller();

    await caller.upsertMultiplayerMatchCache({
      lobbyId: "lobby-1",
      finishedAtIso: "2026-03-05T12:00:00.000Z",
      isFinal: false,
      resultsJson: [{ player_id: "p1" }],
    });
    await caller.upsertMultiplayerMatchCache({
      lobbyId: "lobby-2",
      finishedAtIso: "2026-03-05T13:00:00.000Z",
      isFinal: true,
      resultsJson: [{ player_id: "p2" }],
    });

    const single = await caller.getMultiplayerMatchCache({ lobbyId: "lobby-1" });
    expect(single?.lobbyId).toBe("lobby-1");
    expect(single?.isFinal).toBe(false);

    const list = await caller.listMultiplayerMatchCache({ limit: 10 });
    expect(list.map((entry) => entry.lobbyId)).toEqual(["lobby-2", "lobby-1"]);

    await caller.enqueueResultSyncLobby({ lobbyId: "lobby-1" });
    await caller.touchResultSyncLobby({ lobbyId: "lobby-1" });
    await caller.enqueueResultSyncLobby({ lobbyId: "lobby-3" });
    const queued = await caller.listResultSyncLobbies();
    expect(queued.map((entry) => entry.lobbyId)).toEqual(["lobby-1", "lobby-3"]);
    expect(queued[0]?.lastAttemptAt).toBeInstanceOf(Date);

    const deleted = await caller.removeResultSyncLobby({ lobbyId: "lobby-1" });
    expect(deleted).toHaveLength(1);
    const remaining = await caller.listResultSyncLobbies();
    expect(remaining.map((entry) => entry.lobbyId)).toEqual(["lobby-3"]);
  });

  it("stores and lists single-player run history with playlist metadata", async () => {
    const caller = createRendererCaller();

    await caller.recordSinglePlayerRun({
      finishedAtIso: "2026-03-05T10:00:00.000Z",
      score: 540,
      survivedDurationSec: 812,
      highscoreBefore: 500,
      highscoreAfter: 540,
      wasNewHighscore: true,
      completionReason: "finished",
      playlistId: "playlist-1",
      playlistName: "Default Playlist",
      playlistFormatVersion: 1,
      endingPosition: 100,
      turn: 42,
    });
    await caller.recordSinglePlayerRun({
      finishedAtIso: "2026-03-05T09:00:00.000Z",
      score: 320,
      highscoreBefore: 540,
      highscoreAfter: 540,
      wasNewHighscore: false,
      completionReason: "self_reported_cum",
      playlistId: "playlist-2",
      playlistName: "Alt Playlist",
      playlistFormatVersion: 1,
      endingPosition: 74,
      turn: 28,
    });

    const runs = await caller.listSinglePlayerRuns({ limit: 10 });
    expect(runs).toHaveLength(2);
    expect(runs[0]?.playlistName).toBe("Default Playlist");
    expect(runs[0]?.score).toBe(540);
    expect(runs[0]?.survivedDurationSec).toBe(812);
    expect(runs[0]?.wasNewHighscore).toBe(true);
    expect(runs[1]?.survivedDurationSec).toBeNull();
    expect(runs[1]?.completionReason).toBe("self_reported_cum");
  });

  it("counts extracted cum loads from single-player run history", async () => {
    const caller = createRendererCaller();

    await caller.recordSinglePlayerRun({
      finishedAtIso: "2026-03-05T10:00:00.000Z",
      score: 540,
      highscoreBefore: 500,
      highscoreAfter: 540,
      wasNewHighscore: true,
      completionReason: "finished",
      playlistId: "playlist-1",
      playlistName: "Default Playlist",
      playlistFormatVersion: 1,
      endingPosition: 100,
      turn: 42,
    });
    await caller.recordSinglePlayerRun({
      finishedAtIso: "2026-03-05T09:00:00.000Z",
      score: 320,
      highscoreBefore: 540,
      highscoreAfter: 540,
      wasNewHighscore: false,
      completionReason: "self_reported_cum",
      playlistId: "playlist-2",
      playlistName: "Alt Playlist",
      playlistFormatVersion: 1,
      endingPosition: 74,
      turn: 28,
    });
    await caller.recordSinglePlayerRun({
      finishedAtIso: "2026-03-05T08:00:00.000Z",
      score: 280,
      highscoreBefore: 540,
      highscoreAfter: 540,
      wasNewHighscore: false,
      completionReason: "cum_instruction_failed",
      playlistId: "playlist-3",
      playlistName: "Chaos Playlist",
      playlistFormatVersion: 1,
      endingPosition: 53,
      turn: 19,
    });

    await expect(caller.getSinglePlayerCumLoadCount()).resolves.toBe(2);
  });

  it("deletes a single-player run and recomputes local highscore", async () => {
    const caller = createRendererCaller();

    await caller.recordSinglePlayerRun({
      finishedAtIso: "2026-03-05T10:00:00.000Z",
      score: 540,
      highscoreBefore: 500,
      highscoreAfter: 540,
      wasNewHighscore: true,
      completionReason: "finished",
      playlistId: "playlist-1",
      playlistName: "Default Playlist",
      playlistFormatVersion: 1,
      endingPosition: 100,
      turn: 42,
      cheatModeActive: true,
    });
    await caller.recordSinglePlayerRun({
      finishedAtIso: "2026-03-05T09:00:00.000Z",
      score: 320,
      highscoreBefore: 540,
      highscoreAfter: 540,
      wasNewHighscore: false,
      completionReason: "self_reported_cum",
      playlistId: "playlist-2",
      playlistName: "Alt Playlist",
      playlistFormatVersion: 1,
      endingPosition: 74,
      turn: 28,
      cheatModeActive: false,
    });

    const runsBeforeDelete = await caller.listSinglePlayerRuns({ limit: 10 });
    const deleted = await caller.deleteSinglePlayerRun({ id: runsBeforeDelete[0]!.id });

    expect(deleted.deleted.id).toBe(runsBeforeDelete[0]!.id);
    expect(deleted.highscore).toBe(320);
    expect(deleted.highscoreCheatMode).toBe(false);
    await expect(caller.getLocalHighscore()).resolves.toMatchObject({
      highscore: 320,
      highscoreCheatMode: false,
    });
    await expect(caller.listSinglePlayerRuns({ limit: 10 })).resolves.toHaveLength(1);
  });

  it("updates hero metadata with unique-name protection", async () => {
    const caller = createRendererCaller();

    await expect(
      caller.updateHero({
        id: "hero-1",
        name: "Hero Prime",
        author: "New Author",
        description: "Updated hero",
      })
    ).resolves.toMatchObject({
      id: "hero-1",
      name: "Hero Prime",
      author: "New Author",
      description: "Updated hero",
    });
  });

  it("updates hero funscript primary resources for all attached hero rounds", async () => {
    const caller = createRendererCaller();

    roundsByIdRef.set("hero-round-1", {
      id: "hero-round-1",
      name: "Hero Round 1",
      author: null,
      description: null,
      bpm: null,
      difficulty: null,
      startTime: 0,
      endTime: 1000,
      type: "Normal",
      heroId: "hero-1",
    });
    roundsByIdRef.set("hero-round-2", {
      id: "hero-round-2",
      name: "Hero Round 2",
      author: null,
      description: null,
      bpm: null,
      difficulty: null,
      startTime: 1000,
      endTime: 2000,
      type: "Normal",
      heroId: "hero-1",
    });
    resourcesByIdRef.set("resource-late", {
      id: "resource-late",
      roundId: "hero-round-1",
      videoUri: "file:///tmp/late.mp4",
      funscriptUri: "file:///tmp/old-late.funscript",
      phash: null,
      durationMs: 1000,
      disabled: false,
      createdAt: new Date("2026-03-06T00:00:02.000Z"),
      updatedAt: new Date("2026-03-06T00:00:02.000Z"),
    });
    resourcesByIdRef.set("resource-primary", {
      id: "resource-primary",
      roundId: "hero-round-1",
      videoUri: "file:///tmp/primary.mp4",
      funscriptUri: "file:///tmp/old-primary.funscript",
      phash: null,
      durationMs: 1000,
      disabled: false,
      createdAt: new Date("2026-03-06T00:00:01.000Z"),
      updatedAt: new Date("2026-03-06T00:00:01.000Z"),
    });
    resourcesByIdRef.set("resource-second", {
      id: "resource-second",
      roundId: "hero-round-2",
      videoUri: "file:///tmp/second.mp4",
      funscriptUri: null,
      phash: null,
      durationMs: 1000,
      disabled: false,
      createdAt: new Date("2026-03-06T00:00:01.000Z"),
      updatedAt: new Date("2026-03-06T00:00:01.000Z"),
    });

    await expect(
      caller.updateHeroFunscript({
        heroId: "hero-1",
        funscriptUri: "file:///tmp/new.funscript",
      })
    ).resolves.toMatchObject({
      heroId: "hero-1",
      funscriptUri: "file:///tmp/new.funscript",
      updatedResources: 2,
      skippedRounds: 0,
    });

    expect(resourcesByIdRef.get("resource-primary")?.funscriptUri).toBe(
      "file:///tmp/new.funscript"
    );
    expect(resourcesByIdRef.get("resource-second")?.funscriptUri).toBe("file:///tmp/new.funscript");
    expect(resourcesByIdRef.get("resource-late")?.funscriptUri).toBe(
      "file:///tmp/old-late.funscript"
    );
  });

  it("detaches hero funscripts with null", async () => {
    const caller = createRendererCaller();

    roundsByIdRef.set("hero-round-1", {
      id: "hero-round-1",
      name: "Hero Round 1",
      author: null,
      description: null,
      bpm: null,
      difficulty: null,
      startTime: 0,
      endTime: 1000,
      type: "Normal",
      heroId: "hero-1",
    });
    resourcesByIdRef.set("resource-hero-1", {
      id: "resource-hero-1",
      roundId: "hero-round-1",
      videoUri: "file:///tmp/hero.mp4",
      funscriptUri: "file:///tmp/old.funscript",
      phash: null,
      durationMs: 1000,
      disabled: false,
      createdAt: new Date("2026-03-06T00:00:01.000Z"),
      updatedAt: new Date("2026-03-06T00:00:01.000Z"),
    });

    await expect(
      caller.updateHeroFunscript({ heroId: "hero-1", funscriptUri: null })
    ).resolves.toMatchObject({
      updatedResources: 1,
      skippedRounds: 0,
      funscriptUri: null,
    });

    expect(resourcesByIdRef.get("resource-hero-1")?.funscriptUri).toBeNull();
  });

  it("skips hero rounds without resources when updating hero funscript", async () => {
    const caller = createRendererCaller();

    roundsByIdRef.set("hero-round-with-resource", {
      id: "hero-round-with-resource",
      name: "Hero Round With Resource",
      author: null,
      description: null,
      bpm: null,
      difficulty: null,
      startTime: 0,
      endTime: 1000,
      type: "Normal",
      heroId: "hero-1",
    });
    roundsByIdRef.set("hero-round-template", {
      id: "hero-round-template",
      name: "Hero Round Template",
      author: null,
      description: null,
      bpm: null,
      difficulty: null,
      startTime: 1000,
      endTime: 2000,
      type: "Normal",
      heroId: "hero-1",
    });
    resourcesByIdRef.set("resource-with-resource", {
      id: "resource-with-resource",
      roundId: "hero-round-with-resource",
      videoUri: "file:///tmp/hero.mp4",
      funscriptUri: null,
      phash: null,
      durationMs: 1000,
      disabled: false,
      createdAt: new Date("2026-03-06T00:00:01.000Z"),
      updatedAt: new Date("2026-03-06T00:00:01.000Z"),
    });

    await expect(
      caller.updateHeroFunscript({
        heroId: "hero-1",
        funscriptUri: "file:///tmp/new.funscript",
      })
    ).resolves.toMatchObject({
      updatedResources: 1,
      skippedRounds: 1,
    });
  });

  it("recalculates installed difficulty from the converted hard-mode script", async () => {
    const caller = createRendererCaller();
    const hardModeFunscriptUri = "app://media/converted-hard-mode.funscript";

    resourcesByIdRef.set("resource-1", {
      ...resourcesByIdRef.get("resource-1")!,
      funscriptUri: hardModeFunscriptUri,
    });
    getHardModeAttachmentRevertMock.mockResolvedValueOnce({
      resourceId: "resource-1",
      hardModeFunscriptUri,
      previousFunscriptUri: "stash://scene/1/legacy.funscript",
      converterVersion: 2,
    });
    calculateFunscriptDifficultyFromUriMock.mockResolvedValueOnce(4);

    await expect(caller.recalculateInstalledRoundDifficulties()).resolves.toEqual({
      totalCount: 1,
      updatedCount: 1,
      skippedCount: 0,
    });

    expect(getHardModeAttachmentRevertMock).toHaveBeenCalledWith(
      "resource-1",
      hardModeFunscriptUri
    );
    expect(resolveResourceUrisMock).not.toHaveBeenCalled();
    expect(calculateFunscriptDifficultyFromUriMock).toHaveBeenCalledWith(hardModeFunscriptUri);
    expect(roundsByIdRef.get("round-1")?.difficulty).toBe(4);
  });

  it("converts one legacy script and transactionally attaches it to hero primary resources", async () => {
    const caller = createRendererCaller();

    roundsByIdRef.set("hardmode-round-1", {
      id: "hardmode-round-1",
      name: "Hardmode Round 1",
      author: null,
      description: null,
      bpm: null,
      difficulty: null,
      startTime: 0,
      endTime: 1000,
      type: "Normal",
      heroId: "hero-1",
    });
    roundsByIdRef.set("hardmode-round-template", {
      id: "hardmode-round-template",
      name: "Hardmode Template",
      author: null,
      description: null,
      bpm: null,
      difficulty: null,
      startTime: 1000,
      endTime: 2000,
      type: "Normal",
      heroId: "hero-1",
    });
    resourcesByIdRef.set("hardmode-primary", {
      id: "hardmode-primary",
      roundId: "hardmode-round-1",
      videoUri: "file:///tmp/primary.mp4",
      funscriptUri: "file:///tmp/old-primary.funscript",
      funscriptOffsetMs: 175,
      phash: null,
      durationMs: 1000,
      disabled: false,
      createdAt: new Date("2026-03-06T00:00:01.000Z"),
      updatedAt: new Date("2026-03-06T00:00:01.000Z"),
    });
    resourcesByIdRef.set("hardmode-secondary", {
      id: "hardmode-secondary",
      roundId: "hardmode-round-1",
      videoUri: "file:///tmp/secondary.mp4",
      funscriptUri: "file:///tmp/old-secondary.funscript",
      funscriptOffsetMs: -75,
      phash: null,
      durationMs: 1000,
      disabled: false,
      createdAt: new Date("2026-03-06T00:00:02.000Z"),
      updatedAt: new Date("2026-03-06T00:00:02.000Z"),
    });

    await expect(
      caller.convertHeroFunscriptToHardMode({
        heroId: "hero-1",
      })
    ).resolves.toEqual({
      heroId: "hero-1",
      funscriptUri: "app://media/managed-hard-mode.funscript",
      updatedResources: 1,
      skippedRounds: 1,
      sourceActions: 3,
      outputActions: 5,
      recalculatedDifficulty: null,
    });

    expect(convertLocalFunscriptToManagedHardModeMock).toHaveBeenCalledWith(
      "file:///tmp/old-primary.funscript"
    );
    expect(dbMockRef.transaction).toHaveBeenCalledTimes(1);
    expect(resourcesByIdRef.get("hardmode-primary")).toMatchObject({
      funscriptUri: "app://media/managed-hard-mode.funscript",
      funscriptOffsetMs: 175,
    });
    expect(resourcesByIdRef.get("hardmode-secondary")).toMatchObject({
      funscriptUri: "file:///tmp/old-secondary.funscript",
      funscriptOffsetMs: -75,
    });
  });

  it("does not change hero attachments when hard-mode conversion fails", async () => {
    const caller = createRendererCaller();
    roundsByIdRef.set("hardmode-round", {
      id: "hardmode-round",
      name: "Hardmode Round",
      author: null,
      description: null,
      bpm: null,
      difficulty: null,
      startTime: 0,
      endTime: 1000,
      type: "Normal",
      heroId: "hero-1",
    });
    resourcesByIdRef.set("hardmode-resource", {
      id: "hardmode-resource",
      roundId: "hardmode-round",
      videoUri: "file:///tmp/video.mp4",
      funscriptUri: "file:///tmp/original.funscript",
      phash: null,
      durationMs: 1000,
      disabled: false,
      createdAt: new Date("2026-03-06T00:00:01.000Z"),
      updatedAt: new Date("2026-03-06T00:00:01.000Z"),
    });
    convertLocalFunscriptToManagedHardModeMock.mockRejectedValueOnce(
      new Error("This funscript was already converted to hard mode by F-Land.")
    );

    await expect(
      caller.convertHeroFunscriptToHardMode({
        heroId: "hero-1",
      })
    ).rejects.toThrow("already converted");

    expect(resourcesByIdRef.get("hardmode-resource")?.funscriptUri).toBe(
      "file:///tmp/original.funscript"
    );
    expect(dbMockRef.transaction).not.toHaveBeenCalled();
  });

  it("converts a standalone round from its current primary attachment", async () => {
    const caller = createRendererCaller();
    roundsByIdRef.set("standalone-hardmode", {
      id: "standalone-hardmode",
      name: "Standalone legacy",
      author: null,
      description: null,
      bpm: null,
      difficulty: null,
      startTime: 0,
      endTime: 1000,
      type: "Normal",
      heroId: null,
    });
    resourcesByIdRef.set("standalone-hardmode-resource", {
      id: "standalone-hardmode-resource",
      roundId: "standalone-hardmode",
      videoUri: "file:///tmp/standalone.mp4",
      funscriptUri: "https://media.example/standalone.funscript",
      funscriptOffsetMs: 125,
      phash: null,
      durationMs: 1000,
      disabled: false,
      createdAt: new Date("2026-03-06T00:00:01.000Z"),
      updatedAt: new Date("2026-03-06T00:00:01.000Z"),
    });

    await expect(
      caller.convertRoundFunscriptToHardMode({ roundId: "standalone-hardmode" })
    ).resolves.toMatchObject({
      scope: "round",
      heroId: null,
      roundId: "standalone-hardmode",
      updatedResources: 1,
      skippedRounds: 0,
      sourceActions: 3,
      outputActions: 5,
    });
    expect(convertLocalFunscriptToManagedHardModeMock).toHaveBeenCalledWith(
      "https://media.example/standalone.funscript"
    );
    expect(resourcesByIdRef.get("standalone-hardmode-resource")).toMatchObject({
      funscriptUri: "app://media/managed-hard-mode.funscript",
      funscriptOffsetMs: 125,
    });
  });

  it("recalculates difficulty from the converted hard-mode script when requested", async () => {
    const caller = createRendererCaller();
    roundsByIdRef.set("hardmode-difficulty", {
      id: "hardmode-difficulty",
      name: "Legacy difficulty",
      author: null,
      description: null,
      bpm: null,
      difficulty: 2,
      startTime: 0,
      endTime: 1000,
      type: "Normal",
      heroId: null,
    });
    resourcesByIdRef.set("hardmode-difficulty-resource", {
      id: "hardmode-difficulty-resource",
      roundId: "hardmode-difficulty",
      videoUri: "file:///tmp/difficulty.mp4",
      funscriptUri: "file:///tmp/difficulty.funscript",
      phash: null,
      durationMs: 1000,
      disabled: false,
      createdAt: new Date("2026-03-06T00:00:01.000Z"),
      updatedAt: new Date("2026-03-06T00:00:01.000Z"),
    });
    calculateFunscriptDifficultyFromUriMock.mockResolvedValueOnce(4);

    const result = await caller.convertRoundFunscriptToHardMode({
      roundId: "hardmode-difficulty",
      recalculateDifficulty: true,
    });

    expect(calculateFunscriptDifficultyFromUriMock).toHaveBeenCalledWith(
      "app://media/managed-hard-mode.funscript"
    );
    expect(roundsByIdRef.get("hardmode-difficulty")?.difficulty).toBe(4);
    expect(result.recalculatedDifficulty).toBe(4);
  });

  it("uses the selected hero round as source and applies its conversion hero-wide", async () => {
    const caller = createRendererCaller();
    for (const [id, script, createdAt] of [
      ["hero-selected", "https://stash.example/selected.funscript", "2026-03-06T00:00:01.000Z"],
      ["hero-sibling", "file:///tmp/different.funscript", "2026-03-06T00:00:02.000Z"],
    ] as const) {
      roundsByIdRef.set(id, {
        id,
        name: id,
        author: null,
        description: null,
        bpm: null,
        difficulty: null,
        startTime: 0,
        endTime: 1000,
        type: "Normal",
        heroId: "hero-1",
      });
      resourcesByIdRef.set(`${id}-resource`, {
        id: `${id}-resource`,
        roundId: id,
        videoUri: `file:///tmp/${id}.mp4`,
        funscriptUri: script,
        phash: null,
        durationMs: 1000,
        disabled: false,
        createdAt: new Date(createdAt),
        updatedAt: new Date(createdAt),
      });
    }

    const result = await caller.convertRoundFunscriptToHardMode({ roundId: "hero-selected" });

    expect(result).toMatchObject({ scope: "hero", heroId: "hero-1", updatedResources: 2 });
    expect(convertLocalFunscriptToManagedHardModeMock).toHaveBeenCalledWith(
      "https://stash.example/selected.funscript"
    );
    expect(resourcesByIdRef.get("hero-selected-resource")?.funscriptUri).toBe(
      "app://media/managed-hard-mode.funscript"
    );
    expect(resourcesByIdRef.get("hero-sibling-resource")?.funscriptUri).toBe(
      "app://media/managed-hard-mode.funscript"
    );
  });

  it("restores each hero resource's exact previous attachment", async () => {
    const caller = createRendererCaller();
    for (const id of ["restore-a", "restore-b"] as const) {
      roundsByIdRef.set(id, {
        id,
        name: id,
        author: null,
        description: null,
        bpm: null,
        difficulty: null,
        startTime: 0,
        endTime: 1000,
        type: "Normal",
        heroId: "hero-1",
      });
      resourcesByIdRef.set(`${id}-resource`, {
        id: `${id}-resource`,
        roundId: id,
        videoUri: `file:///tmp/${id}.mp4`,
        funscriptUri: "app://media/managed-hard-mode.funscript",
        phash: null,
        durationMs: 1000,
        disabled: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }
    getHardModeAttachmentRevertMock.mockImplementation(
      async (resourceId: string, hardModeFunscriptUri: string) => {
        const previousFunscriptUri =
          resourceId === "restore-a-resource"
            ? "file:///tmp/original-a.funscript"
            : resourceId === "restore-b-resource"
              ? "https://stash.example/original-b.funscript"
              : null;
        return previousFunscriptUri
          ? { resourceId, hardModeFunscriptUri, previousFunscriptUri, converterVersion: 1 }
          : null;
      }
    );

    const result = await caller.revertRoundHardModeFunscript({ roundId: "restore-a" });

    expect(result).toMatchObject({ scope: "hero", updatedResources: 2 });
    expect(resourcesByIdRef.get("restore-a-resource")?.funscriptUri).toBe(
      "file:///tmp/original-a.funscript"
    );
    expect(resourcesByIdRef.get("restore-b-resource")?.funscriptUri).toBe(
      "https://stash.example/original-b.funscript"
    );
  });

  it("does not change hero attachments when the conversion transaction fails", async () => {
    const caller = createRendererCaller();
    roundsByIdRef.set("transaction-round", {
      id: "transaction-round",
      name: "Transaction Round",
      author: null,
      description: null,
      bpm: null,
      difficulty: null,
      startTime: 0,
      endTime: 1000,
      type: "Normal",
      heroId: "hero-1",
    });
    resourcesByIdRef.set("transaction-resource", {
      id: "transaction-resource",
      roundId: "transaction-round",
      videoUri: "file:///tmp/video.mp4",
      funscriptUri: "file:///tmp/original.funscript",
      phash: null,
      durationMs: 1000,
      disabled: false,
      createdAt: new Date("2026-03-06T00:00:01.000Z"),
      updatedAt: new Date("2026-03-06T00:00:01.000Z"),
    });
    dbMockRef.transaction.mockRejectedValueOnce(new Error("Database transaction failed."));

    await expect(
      caller.convertHeroFunscriptToHardMode({
        heroId: "hero-1",
      })
    ).rejects.toThrow("Database transaction failed");

    expect(resourcesByIdRef.get("transaction-resource")?.funscriptUri).toBe(
      "file:///tmp/original.funscript"
    );
  });

  it("rejects a hard-mode conversion when the hero has no resource-backed rounds", async () => {
    const caller = createRendererCaller();
    roundsByIdRef.set("template-only", {
      id: "template-only",
      name: "Template only",
      author: null,
      description: null,
      bpm: null,
      difficulty: null,
      startTime: 0,
      endTime: 1000,
      type: "Normal",
      heroId: "hero-1",
    });

    await expect(
      caller.convertHeroFunscriptToHardMode({
        heroId: "hero-1",
      })
    ).rejects.toThrow("no resource-backed rounds");
  });

  it("rejects hard-mode conversion for a missing hero before reading the source file", async () => {
    const caller = createRendererCaller();

    await expect(
      caller.convertHeroFunscriptToHardMode({
        heroId: "missing-hero",
      })
    ).rejects.toThrow("Hero not found");

    expect(convertLocalFunscriptToManagedHardModeMock).not.toHaveBeenCalled();
  });

  it("rejects hero funscript updates for a missing hero", async () => {
    const caller = createRendererCaller();

    await expect(
      caller.updateHeroFunscript({
        heroId: "missing-hero",
        funscriptUri: "file:///tmp/new.funscript",
      })
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
      message: "Hero not found.",
    });
  });

  it("does not update rounds for other heroes when updating hero funscript", async () => {
    const caller = createRendererCaller();

    heroesByIdRef.set("hero-2", {
      id: "hero-2",
      name: "Hero Two",
      author: null,
      description: null,
      createdAt: new Date("2026-03-05T00:00:00.000Z"),
      updatedAt: new Date("2026-03-05T00:00:00.000Z"),
    });
    roundsByIdRef.set("hero-round-1", {
      id: "hero-round-1",
      name: "Hero Round 1",
      author: null,
      description: null,
      bpm: null,
      difficulty: null,
      startTime: 0,
      endTime: 1000,
      type: "Normal",
      heroId: "hero-1",
    });
    roundsByIdRef.set("other-hero-round", {
      id: "other-hero-round",
      name: "Other Hero Round",
      author: null,
      description: null,
      bpm: null,
      difficulty: null,
      startTime: 0,
      endTime: 1000,
      type: "Normal",
      heroId: "hero-2",
    });
    resourcesByIdRef.set("resource-hero-1", {
      id: "resource-hero-1",
      roundId: "hero-round-1",
      videoUri: "file:///tmp/hero-1.mp4",
      funscriptUri: null,
      phash: null,
      durationMs: 1000,
      disabled: false,
      createdAt: new Date("2026-03-06T00:00:01.000Z"),
      updatedAt: new Date("2026-03-06T00:00:01.000Z"),
    });
    resourcesByIdRef.set("resource-hero-2", {
      id: "resource-hero-2",
      roundId: "other-hero-round",
      videoUri: "file:///tmp/hero-2.mp4",
      funscriptUri: "file:///tmp/other.funscript",
      phash: null,
      durationMs: 1000,
      disabled: false,
      createdAt: new Date("2026-03-06T00:00:01.000Z"),
      updatedAt: new Date("2026-03-06T00:00:01.000Z"),
    });

    await caller.updateHeroFunscript({
      heroId: "hero-1",
      funscriptUri: "file:///tmp/new.funscript",
    });

    expect(resourcesByIdRef.get("resource-hero-1")?.funscriptUri).toBe("file:///tmp/new.funscript");
    expect(resourcesByIdRef.get("resource-hero-2")?.funscriptUri).toBe(
      "file:///tmp/other.funscript"
    );
  });

  it("deletes a hero entry and all attached rounds", async () => {
    const caller = createRendererCaller();

    roundsByIdRef.set("round-hero", {
      id: "round-hero",
      name: "Hero Round",
      author: "Round Author",
      description: "Attached round",
      bpm: 120,
      difficulty: 2,
      startTime: 1000,
      endTime: 5000,
      type: "Normal",
      heroId: "hero-1",
    });
    resourcesByIdRef.set("resource-hero", {
      id: "resource-hero",
      roundId: "round-hero",
      videoUri: "file:///tmp/hero.mp4",
      funscriptUri: "file:///tmp/hero.funscript",
      phash: null,
      durationMs: 4000,
      disabled: false,
      createdAt: new Date("2026-03-06T00:00:00.000Z"),
      updatedAt: new Date("2026-03-06T00:00:00.000Z"),
    });

    await expect(caller.deleteHero({ id: "hero-1" })).resolves.toEqual({ deleted: true });

    expect(heroesByIdRef.has("hero-1")).toBe(false);
    expect(roundsByIdRef.has("round-hero")).toBe(false);
    expect(resourcesByIdRef.has("resource-hero")).toBe(false);
  });

  it("updates round metadata and validates time order", async () => {
    const caller = createRendererCaller();

    await expect(
      caller.updateRound({
        id: "round-1",
        name: "Round Prime",
        author: "Editor",
        description: "Updated round",
        bpm: 132,
        difficulty: 4,
        startTime: 2000,
        endTime: 6000,
        type: "Cum",
      })
    ).resolves.toMatchObject({
      id: "round-1",
      name: "Round Prime",
      type: "Cum",
      bpm: 132,
      difficulty: 4,
    });

    await expect(
      caller.updateRound({
        id: "round-1",
        name: "Broken",
        author: null,
        description: null,
        bpm: null,
        difficulty: null,
        startTime: 4000,
        endTime: 3000,
        type: "Normal",
      })
    ).rejects.toThrow("greater than start time");
  });

  it("creates a website-backed installed round with an attached resource", async () => {
    const caller = createRendererCaller();
    calculateFunscriptDifficultyFromUriMock.mockResolvedValue(3);

    const created = await caller.createWebsiteRound({
      name: "Website Round",
      videoUri: "https://www.xhamster.com/videos/demo-123",
      funscriptUri: "app://media/tmp/demo.funscript",
    });

    const installedRound = roundsByIdRef.get(created.roundId);
    const installedResource = resourcesByIdRef.get(created.resourceId);

    expect(installedRound).toMatchObject({
      name: "Website Round",
      type: "Normal",
      difficulty: 3,
    });
    expect(installedRound?.installSourceKey).toMatch(/^website:/);
    expect(installedResource).toMatchObject({
      roundId: created.roundId,
      videoUri: "https://www.xhamster.com/videos/demo-123",
      funscriptUri: "app://media/tmp/demo.funscript",
      disabled: false,
    });
    expect(calculateFunscriptDifficultyFromUriMock).toHaveBeenCalledWith(
      "app://media/tmp/demo.funscript"
    );
    expect(dbMockRef.transaction).toHaveBeenCalledTimes(1);
    expect(queueWebsiteVideoCacheImmediatelyMock).toHaveBeenCalledWith({
      roundId: created.roundId,
      resourceId: created.resourceId,
      roundName: "Website Round",
      url: "https://www.xhamster.com/videos/demo-123",
    });
  });

  it("rejects invalid website round video URLs", async () => {
    const caller = createRendererCaller();

    await expect(
      caller.createWebsiteRound({
        name: "Broken Website Round",
        videoUri: "ftp://example.com/video",
        funscriptUri: null,
      })
    ).rejects.toThrow("public http(s) URLs");
    expect(queueWebsiteVideoCacheImmediatelyMock).not.toHaveBeenCalled();
  });

  it("deletes a round entry", async () => {
    const caller = createRendererCaller();

    await expect(caller.deleteRound({ id: "round-1" })).resolves.toEqual({ deleted: true });
    expect(roundsByIdRef.has("round-1")).toBe(false);
  });

  it("converts a hero group back to a standalone round by renaming the kept round and clearing timing", async () => {
    const caller = createRendererCaller();

    roundsByIdRef.set("round-1", {
      id: "round-1",
      name: "Hero One - round 1",
      author: "Round Author",
      description: "Original round",
      bpm: 120,
      difficulty: 2,
      startTime: 1000,
      endTime: 5000,
      type: "Normal",
      heroId: "hero-1",
    });
    roundsByIdRef.set("round-2", {
      id: "round-2",
      name: "Hero One - round 2",
      author: "Round Author",
      description: "Original round 2",
      bpm: 120,
      difficulty: 2,
      startTime: 6000,
      endTime: 9000,
      type: "Normal",
      heroId: "hero-1",
    });

    await expect(
      caller.convertHeroGroupToRound({
        keepRoundId: "round-1",
        roundIds: ["round-1", "round-2"],
        heroId: "hero-1",
        roundName: "Hero One",
      })
    ).resolves.toMatchObject({
      keptRoundId: "round-1",
      removedRoundCount: 1,
      deletedHero: true,
    });

    expect(roundsByIdRef.get("round-1")).toMatchObject({
      heroId: null,
      name: "Hero One",
      startTime: null,
      endTime: null,
    });
    expect(roundsByIdRef.has("round-2")).toBe(false);
  });

  it("exports installed database with default URI mode disabled and supports explicit enable", async () => {
    const caller = createRendererCaller();

    const defaultResult = await caller.exportInstalledDatabase();
    expect(defaultResult.includeResourceUris).toBe(false);
    expect(exportInstalledDatabaseMock).toHaveBeenCalledWith({ includeResourceUris: false });

    await caller.exportInstalledDatabase({ includeResourceUris: true });
    expect(exportInstalledDatabaseMock).toHaveBeenLastCalledWith({ includeResourceUris: true });
  });

  it("analyzes, exports, polls, and aborts library package export", async () => {
    const caller = createRendererCaller();

    await expect(
      caller.analyzeLibraryExportPackage({
        roundIds: ["round-1"],
        includeMedia: true,
        compressionMode: "av1",
        compressionStrength: 55,
      })
    ).resolves.toMatchObject({
      videoTotals: { uniqueVideos: 1 },
      compression: { defaultMode: "av1", strength: 80 },
    });
    expect(analyzeLibraryExportPackageMock).toHaveBeenCalledWith({
      roundIds: ["round-1"],
      heroIds: undefined,
      includeMedia: true,
      compressionMode: "av1",
      compressionStrength: 55,
    });

    await expect(
      caller.exportLibraryPackage({
        roundIds: ["round-1"],
        includeMedia: true,
        compressionMode: "av1",
        compressionStrength: 70,
        asFpack: true,
      })
    ).resolves.toMatchObject({
      exportDir: "/tmp/f-land/export/library",
      compression: { enabled: true },
    });
    expect(exportLibraryPackageMock).toHaveBeenCalledWith({
      roundIds: ["round-1"],
      heroIds: undefined,
      includeMedia: true,
      directoryPath: undefined,
      asFpack: true,
      compressionMode: "av1",
      compressionStrength: 70,
    });

    await expect(caller.getLibraryExportPackageStatus()).resolves.toMatchObject({
      state: "idle",
    });
    expect(getLibraryExportPackageStatusMock).toHaveBeenCalledTimes(1);

    await expect(caller.abortLibraryExportPackage()).resolves.toMatchObject({
      state: "running",
      phase: "copying",
    });
    expect(requestLibraryExportPackageAbortMock).toHaveBeenCalledTimes(1);
  });

  it("backs up settings on demand", async () => {
    const caller = createRendererCaller();

    await expect(caller.backupSettingsNow()).resolves.toEqual({
      backupPath: "/tmp/settings-backups/f-land-settings-backup-2026-04-21T12-00-00.000Z.json",
      deletedBackups: 0,
    });

    expect(runSettingsBackupMock).toHaveBeenCalledTimes(1);
  });

  it("reports a readable error when settings backup cannot be created", async () => {
    const caller = createRendererCaller();
    runSettingsBackupMock.mockResolvedValueOnce(null);

    await expect(caller.backupSettingsNow()).rejects.toThrow(
      "Settings backup could not be created because the settings file is unavailable."
    );
  });

  it("opens the settings backup folder", async () => {
    const caller = createRendererCaller();

    await expect(caller.openSettingsBackupFolder()).resolves.toEqual({
      path: "/tmp/settings-backups",
    });

    expect(shellOpenPathMock).toHaveBeenCalledWith("/tmp/settings-backups");
  });

  it("creates a plaintext settings file on demand", async () => {
    const caller = createRendererCaller();

    await expect(caller.createPlaintextSettingsFile()).resolves.toEqual({
      plaintextPath:
        "/tmp/settings-backups/f-land-settings-plaintext-2026-04-21T12-00-00.000Z.json",
    });

    expect(createPlaintextSettingsFileMock).toHaveBeenCalledTimes(1);
    expect(shellShowItemInFolderMock).toHaveBeenCalledWith(
      "/tmp/settings-backups/f-land-settings-plaintext-2026-04-21T12-00-00.000Z.json"
    );
  });

  it("clears persisted database rows and store state", async () => {
    const caller = createRendererCaller();

    await caller.recordSinglePlayerRun({
      finishedAtIso: "2026-03-05T10:00:00.000Z",
      score: 540,
      highscoreBefore: 500,
      highscoreAfter: 540,
      wasNewHighscore: true,
      completionReason: "finished",
      playlistId: "playlist-1",
      playlistName: "Default Playlist",
      playlistFormatVersion: 1,
      endingPosition: 100,
      turn: 42,
    });
    await caller.upsertMultiplayerMatchCache({
      lobbyId: "lobby-1",
      finishedAtIso: "2026-03-05T12:00:00.000Z",
      isFinal: true,
      resultsJson: [{ player_id: "p1" }],
    });
    await caller.enqueueResultSyncLobby({ lobbyId: "lobby-1" });
    await caller.setLocalHighscore({ highscore: 120 });
    await caller.upsertSinglePlayerRunSave(createSinglePlayerRunSaveInput());

    await expect(caller.clearAllData()).resolves.toEqual({ cleared: true });

    expect(runDatabaseBackupMock).toHaveBeenCalledTimes(1);
    expect(runSettingsBackupMock).toHaveBeenCalledTimes(1);
    expect(dbMockRef.transaction).toHaveBeenCalledTimes(1);
    expect(runDatabaseBackupMock.mock.invocationCallOrder[0]).toBeLessThan(
      dbMockRef.transaction.mock.invocationCallOrder[0]!
    );
    expect(runSettingsBackupMock.mock.invocationCallOrder[0]).toBeLessThan(
      storeMockRef.clear.mock.invocationCallOrder[0]!
    );
    expect(storeMockRef.clear).toHaveBeenCalledTimes(1);
    expect(clearWebsiteVideoCacheMock).toHaveBeenCalledWith("/tmp/web-video-cache");
    expect(clearPlayableVideoCacheMock).toHaveBeenCalledTimes(1);
    expect(clearMusicCacheMock).toHaveBeenCalledWith("/tmp/music-cache");
    expect(clearFpackExtractionCacheMock).toHaveBeenCalledWith("/tmp/fpacks");
    expect(clearWebsiteVideoCacheMock.mock.invocationCallOrder[0]).toBeLessThan(
      storeMockRef.clear.mock.invocationCallOrder[0]!
    );
    expect(clearMusicCacheMock.mock.invocationCallOrder[0]).toBeLessThan(
      storeMockRef.clear.mock.invocationCallOrder[0]!
    );
    expect(clearFpackExtractionCacheMock.mock.invocationCallOrder[0]).toBeLessThan(
      storeMockRef.clear.mock.invocationCallOrder[0]!
    );
    await expect(caller.getLocalHighscore()).resolves.toMatchObject({
      highscore: 0,
      highscoreCheatMode: false,
    });
    await expect(caller.listSinglePlayerRuns({ limit: 10 })).resolves.toHaveLength(0);
    await expect(caller.listSinglePlayerRunSaves()).resolves.toHaveLength(0);
    await expect(caller.listMultiplayerMatchCache({ limit: 10 })).resolves.toHaveLength(0);
    await expect(caller.listResultSyncLobbies()).resolves.toHaveLength(0);
  });

  it("can clear only video caches without clearing the store", async () => {
    const caller = createRendererCaller();

    await expect(
      caller.clearAllData({
        rounds: false,
        playlists: false,
        stats: false,
        history: false,
        cache: false,
        videoCache: true,
        musicCache: false,
        fpackExtraction: false,
        settings: false,
      })
    ).resolves.toEqual({ cleared: true });

    expect(storeMockRef.clear).not.toHaveBeenCalled();
    expect(clearWebsiteVideoCacheMock).toHaveBeenCalledTimes(1);
    expect(clearPlayableVideoCacheMock).toHaveBeenCalledTimes(1);
    expect(clearMusicCacheMock).not.toHaveBeenCalled();
    expect(clearFpackExtractionCacheMock).not.toHaveBeenCalled();
  });

  it("does not clear settings when the settings backup fails", async () => {
    const caller = createRendererCaller();
    runSettingsBackupMock.mockResolvedValueOnce(null);

    await expect(
      caller.clearAllData({
        rounds: false,
        playlists: false,
        stats: false,
        history: false,
        cache: false,
        videoCache: false,
        musicCache: false,
        fpackExtraction: false,
        eroscriptsCache: false,
        settings: true,
      })
    ).rejects.toThrow("Cannot clear settings because a settings backup could not be created.");

    expect(storeMockRef.clear).not.toHaveBeenCalled();
  });

  it("counts installed rounds using the same filtering semantics as getInstalledRounds", async () => {
    const caller = createRendererCaller();

    roundsByIdRef.set("round-2", {
      id: "round-2",
      name: "Disabled Resource Round",
      author: null,
      description: null,
      bpm: null,
      difficulty: null,
      startTime: null,
      endTime: null,
      type: "Normal",
      installSourceKey: null,
      previewImage: null,
      phash: null,
      createdAt: new Date("2026-03-06T00:00:00.000Z"),
      updatedAt: new Date("2026-03-06T00:00:00.000Z"),
    });
    resourcesByIdRef.set("resource-2", {
      id: "resource-2",
      roundId: "round-2",
      videoUri: "file:///tmp/round-2.mp4",
      funscriptUri: null,
      phash: null,
      durationMs: null,
      disabled: true,
      createdAt: new Date("2026-03-06T00:00:00.000Z"),
      updatedAt: new Date("2026-03-06T00:00:00.000Z"),
    });
    roundsByIdRef.set("round-3", {
      id: "round-3",
      name: "Template Round",
      author: null,
      description: null,
      bpm: null,
      difficulty: null,
      startTime: null,
      endTime: null,
      type: "Normal",
      installSourceKey: null,
      previewImage: null,
      phash: null,
      createdAt: new Date("2026-03-07T00:00:00.000Z"),
      updatedAt: new Date("2026-03-07T00:00:00.000Z"),
    });

    await expect(caller.getInstalledRoundCount()).resolves.toBe(1);
    await expect(caller.getInstalledRoundCount({ includeTemplates: true })).resolves.toBe(3);
    await expect(caller.getInstalledRoundCount({ includeDisabled: true })).resolves.toBe(2);
  });

  it("returns installed round catalog entries without resolved media uris", async () => {
    const caller = createRendererCaller();

    const result = await caller.getInstalledRoundCatalog();

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: "round-1",
      name: "Round One",
      createdAt: expect.any(Date),
      updatedAt: expect.any(Date),
      excludeFromRandom: false,
      resources: [
        {
          id: "resource-1",
          disabled: false,
          hasFunscript: false,
        },
      ],
    });
    expect(result[0]?.resources[0]).not.toHaveProperty("videoUri");
    expect(result[0]?.resources[0]).not.toHaveProperty("funscriptUri");
    expect(result[0]).not.toHaveProperty("previewImage");
    expect(getWebsiteVideoCacheStateMock).not.toHaveBeenCalled();
  });

  it("marks installed catalog entries whose primary script was converted to hard mode", async () => {
    const caller = createRendererCaller();
    const primaryResource = resourcesByIdRef.get("resource-1");
    if (!primaryResource) throw new Error("Missing primary test resource.");
    primaryResource.funscriptUri = "app://media/managed-hard-mode.funscript";
    getHardModeAttachmentRevertMock.mockResolvedValueOnce({
      resourceId: "resource-1",
      hardModeFunscriptUri: primaryResource.funscriptUri,
      previousFunscriptUri: "file:///tmp/original.funscript",
      converterVersion: 2,
    });

    const result = await caller.getInstalledRoundCatalog();

    expect(result[0]?.isHardModeConverted).toBe(true);
    expect(getHardModeAttachmentRevertMock).toHaveBeenCalledWith(
      "resource-1",
      primaryResource.funscriptUri
    );
  });

  it("loads disabled round ids without selecting unrelated round or resource columns", async () => {
    const caller = createRendererCaller();

    roundsByIdRef.set("round-2", {
      id: "round-2",
      name: "Disabled Resource Round",
      author: null,
      description: null,
      bpm: null,
      difficulty: null,
      startTime: null,
      endTime: null,
      type: "Normal",
      installSourceKey: null,
      previewImage: null,
      phash: null,
      createdAt: new Date("2026-03-06T00:00:00.000Z"),
      updatedAt: new Date("2026-03-06T00:00:00.000Z"),
    });
    resourcesByIdRef.set("resource-2", {
      id: "resource-2",
      roundId: "round-2",
      videoUri: "file:///tmp/round-2.mp4",
      funscriptUri: null,
      phash: null,
      durationMs: null,
      disabled: true,
      createdAt: new Date("2026-03-06T00:00:00.000Z"),
      updatedAt: new Date("2026-03-06T00:00:00.000Z"),
    });

    await expect(caller.getDisabledRoundIds()).resolves.toEqual(["round-2"]);

    expect(dbMockRef.query.round.findMany).toHaveBeenCalledWith({
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
    });
  });

  it("returns installed round card assets only for requested ids", async () => {
    const caller = createRendererCaller();

    roundsByIdRef.set("round-2", {
      id: "round-2",
      name: "Website Round",
      author: null,
      description: null,
      bpm: null,
      difficulty: null,
      startTime: null,
      endTime: null,
      type: "Normal",
      installSourceKey: "website:round-2",
      previewImage: "data:image/jpeg;base64,preview",
      phash: null,
      createdAt: new Date("2026-03-06T00:00:00.000Z"),
      updatedAt: new Date("2026-03-06T00:00:00.000Z"),
    });
    resourcesByIdRef.set("resource-2", {
      id: "resource-2",
      roundId: "round-2",
      videoUri: "https://example.com/watch?v=2",
      funscriptUri: null,
      phash: null,
      durationMs: null,
      disabled: false,
      createdAt: new Date("2026-03-06T00:00:00.000Z"),
      updatedAt: new Date("2026-03-06T00:00:00.000Z"),
    });
    createResourceUriResolverMock.mockReturnValueOnce(
      (resource: { videoUri: string; funscriptUri: string | null }) => ({
        videoUri: `app://external/web-url?target=${encodeURIComponent(resource.videoUri)}`,
        funscriptUri: resource.funscriptUri,
      })
    );
    getWebsiteVideoCacheStateMock.mockResolvedValueOnce("pending");

    const result = await caller.getInstalledRoundCardAssets({
      roundIds: ["round-2"],
    });

    expect(result).toEqual([
      {
        roundId: "round-2",
        previewImage: "data:image/jpeg;base64,preview",
        previewVideoUri: "app://external/web-url?target=https%3A%2F%2Fexample.com%2Fwatch%3Fv%3D2",
        websiteVideoCacheStatus: "pending",
        primaryResourceId: "resource-2",
      },
    ]);
    expect(getWebsiteVideoCacheStateMock).toHaveBeenCalledTimes(1);
    expect(getWebsiteVideoCacheStateMock).toHaveBeenCalledWith("https://example.com/watch?v=2");
  });

  it("does not resolve website cache state for non-website card assets", async () => {
    const caller = createRendererCaller();

    const result = await caller.getInstalledRoundCardAssets({
      roundIds: ["round-1"],
    });

    expect(result).toEqual([
      {
        roundId: "round-1",
        previewImage: null,
        previewVideoUri: "file:///tmp/round-1.mp4",
        websiteVideoCacheStatus: "not_applicable",
        primaryResourceId: "resource-1",
      },
    ]);
    expect(getWebsiteVideoCacheStateMock).not.toHaveBeenCalled();
  });

  it("returns round media resources with request-scoped uri resolution", async () => {
    const caller = createRendererCaller();
    const existingResource = resourcesByIdRef.get("resource-1");
    if (existingResource) {
      existingResource.durationMs = 5000;
    }
    createResourceUriResolverMock.mockReturnValueOnce(
      (resource: { videoUri: string; funscriptUri: string | null }) => ({
        videoUri: `app://external/stash?target=${encodeURIComponent(resource.videoUri)}`,
        funscriptUri: resource.funscriptUri,
      })
    );

    await expect(caller.getRoundMediaResources({ roundId: "round-1" })).resolves.toMatchObject({
      roundId: "round-1",
      resources: [
        {
          id: "resource-1",
          videoUri: "app://external/stash?target=file%3A%2F%2F%2Ftmp%2Fround-1.mp4",
          funscriptUri: null,
        },
      ],
    });
  });

  it("returns sampled background video uris without pending website videos and respects the limit", async () => {
    const caller = createRendererCaller();

    resourcesByIdRef.set("resource-2", {
      id: "resource-2",
      roundId: "round-1",
      videoUri: "https://example.com/pending",
      funscriptUri: null,
      phash: null,
      durationMs: null,
      disabled: false,
      createdAt: new Date("2026-03-08T00:00:00.000Z"),
      updatedAt: new Date("2026-03-08T00:00:00.000Z"),
    });
    resourcesByIdRef.set("resource-3", {
      id: "resource-3",
      roundId: "round-1",
      videoUri: "file:///tmp/round-3.mp4",
      funscriptUri: null,
      phash: null,
      durationMs: null,
      disabled: false,
      createdAt: new Date("2026-03-07T00:00:00.000Z"),
      updatedAt: new Date("2026-03-07T00:00:00.000Z"),
    });
    resourcesByIdRef.set("resource-4", {
      id: "resource-4",
      roundId: "round-1",
      videoUri: "https://example.com/cached",
      funscriptUri: null,
      phash: null,
      durationMs: null,
      disabled: false,
      createdAt: new Date("2026-03-09T00:00:00.000Z"),
      updatedAt: new Date("2026-03-09T00:00:00.000Z"),
    });
    getWebsiteVideoCacheStateMock.mockImplementation(async (uri: string) => {
      if (uri.includes("pending")) return "pending";
      if (uri.includes("cached")) return "cached";
      return "not_applicable";
    });

    const result = await caller.getBackgroundVideoUris({ limit: 2 });

    expect(result).toHaveLength(2);
    expect(result.some((uri) => uri.includes("pending"))).toBe(false);
    expect(result[0]).toContain("cached");
  });

  it("persists funscript offset via updateResourceFunscriptOffset", async () => {
    const caller = createRendererCaller();

    const result = await caller.updateResourceFunscriptOffset({
      resourceId: "resource-1",
      offsetMs: 150,
    });

    expect(result).toEqual({ resourceId: "resource-1", funscriptOffsetMs: 150 });
    expect(resourcesByIdRef.get("resource-1")?.funscriptOffsetMs).toBe(150);
  });

  it("rejects non-finite funscript offset in updateResourceFunscriptOffset", async () => {
    const caller = createRendererCaller();

    await expect(
      caller.updateResourceFunscriptOffset({
        resourceId: "resource-1",
        offsetMs: Infinity,
      })
    ).rejects.toThrow("finite integer");
  });

  it("rejects out-of-range funscript offset in updateResourceFunscriptOffset", async () => {
    const caller = createRendererCaller();

    await expect(
      caller.updateResourceFunscriptOffset({
        resourceId: "resource-1",
        offsetMs: 5000,
      })
    ).rejects.toThrow("between");
  });

  it("rejects unknown resource in updateResourceFunscriptOffset", async () => {
    const caller = createRendererCaller();

    await expect(
      caller.updateResourceFunscriptOffset({
        resourceId: "resource-nonexistent",
        offsetMs: 100,
      })
    ).rejects.toThrow("Resource not found");
  });

  it("updates funscriptOffsetMs on the primary resource via updateRound", async () => {
    const caller = createRendererCaller();

    await caller.updateRound({
      id: "round-1",
      name: "Round One",
      author: null,
      description: null,
      bpm: null,
      difficulty: null,
      startTime: null,
      endTime: null,
      funscriptOffsetMs: -50,
      type: "Normal",
    });

    expect(resourcesByIdRef.get("resource-1")?.funscriptOffsetMs).toBe(-50);
  });

  it("clears funscriptOffsetMs on the primary resource when null is passed", async () => {
    const caller = createRendererCaller();
    resourcesByIdRef.set("resource-1", {
      ...resourcesByIdRef.get("resource-1")!,
      funscriptOffsetMs: 200,
    });

    await caller.updateRound({
      id: "round-1",
      name: "Round One",
      author: null,
      description: null,
      bpm: null,
      difficulty: null,
      startTime: null,
      endTime: null,
      funscriptOffsetMs: null,
      type: "Normal",
    });

    expect(resourcesByIdRef.get("resource-1")?.funscriptOffsetMs).toBeNull();
  });
});
