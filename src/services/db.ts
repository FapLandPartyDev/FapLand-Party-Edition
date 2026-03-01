import { trpc } from "./trpc";
import { invalidateInstalledRoundCaches } from "./installedRoundsCache";

/**
 * Re-export Prisma inferred types directly from the tRPC client.
 * No manual type definitions needed — types flow from the Prisma schema
 * on the main process all the way to the renderer.
 */
export type Hero = Awaited<ReturnType<typeof trpc.db.getHeroes.query>>[number];
export type Round = Awaited<ReturnType<typeof trpc.db.getHeroRounds.query>>[number];
export type Resource = NonNullable<Awaited<ReturnType<typeof trpc.db.getResource.query>>>;
export type InstalledRound = Awaited<ReturnType<typeof trpc.db.getInstalledRounds.query>>[number];
export type InstalledRoundCatalogEntry = Awaited<
  ReturnType<typeof trpc.db.getInstalledRoundCatalog.query>
>[number];
export type InstalledRoundMediaResources = NonNullable<
  Awaited<ReturnType<typeof trpc.db.getRoundMediaResources.query>>
>;
export type BackgroundVideoUri = Awaited<
  ReturnType<typeof trpc.db.getBackgroundVideoUris.query>
>[number];
export type InstallScanStatus = Awaited<ReturnType<typeof trpc.db.getInstallScanStatus.query>>;
export type InstallFolderScanResult = Awaited<
  ReturnType<typeof trpc.db.scanInstallFolderOnce.mutate>
>;
export type InstallFolderInspectionResult = Awaited<
  ReturnType<typeof trpc.db.inspectInstallFolder.query>
>;
export type LegacyReviewedImportResult = Awaited<
  ReturnType<typeof trpc.db.importLegacyFolderWithPlan.mutate>
>;
export type InstallDatabaseExportResult = Awaited<
  ReturnType<typeof trpc.db.exportInstalledDatabase.mutate>
>;
export type LibraryPackageExportResult = Awaited<
  ReturnType<typeof trpc.db.exportLibraryPackage.mutate>
>;
export type LibraryExportPackageStatus = Awaited<
  ReturnType<typeof trpc.db.getLibraryExportPackageStatus.query>
>;
export type LibraryExportPackageAnalysis = Awaited<
  ReturnType<typeof trpc.db.analyzeLibraryExportPackage.query>
>;
export type DisabledRoundIds = Awaited<ReturnType<typeof trpc.db.getDisabledRoundIds.query>>;
export type MultiplayerMatchCacheRow = Awaited<
  ReturnType<typeof trpc.db.listMultiplayerMatchCache.query>
>[number];
export type ResultSyncQueueRow = Awaited<
  ReturnType<typeof trpc.db.listResultSyncLobbies.query>
>[number];
export type SinglePlayerRunHistoryRow = Awaited<
  ReturnType<typeof trpc.db.listSinglePlayerRuns.query>
>[number];
export type SinglePlayerRunSaveRow = NonNullable<
  Awaited<ReturnType<typeof trpc.db.getSinglePlayerRunSave.query>>
>;
export type PhashScanStatus = Awaited<ReturnType<typeof trpc.db.getPhashScanStatus.query>>;
export type WebsiteVideoScanStatus = Awaited<
  ReturnType<typeof trpc.db.getWebsiteVideoScanStatus.query>
>;
export type InstallSidecarSecurityAnalysis = Awaited<
  ReturnType<typeof trpc.db.inspectInstallSidecarFile.query>
>;
export type VideoDownloadProgress = Awaited<
  ReturnType<typeof trpc.db.getWebsiteVideoDownloadProgresses.query>
>[number];
type ClearAllDataOptions = Parameters<typeof trpc.db.clearAllData.mutate>[0];

async function withInstalledRoundCacheInvalidation<T>(action: () => Promise<T>): Promise<T> {
  const result = await action();
  invalidateInstalledRoundCaches();
  return result;
}

export const db = {
  resource: {
    findMany: () => trpc.db.getResources.query(),
    findBackgroundVideos: (limit = 6) => trpc.db.getBackgroundVideoUris.query({ limit }),
    findFirst: (roundId: string) => trpc.db.getResource.query({ roundId }),
  },
  hero: {
    findMany: () => trpc.db.getHeroes.query(),
    update: (input: {
      id: string;
      name: string;
      author?: string | null;
      description?: string | null;
    }) => withInstalledRoundCacheInvalidation(() => trpc.db.updateHero.mutate(input)),
    delete: (id: string) =>
      withInstalledRoundCacheInvalidation(() => trpc.db.deleteHero.mutate({ id })),
  },
  round: {
    findByHero: (heroId: string) => trpc.db.getHeroRounds.query({ heroId }),
    findInstalled: (includeDisabled = false, includeTemplates = false) =>
      trpc.db.getInstalledRounds.query({ includeDisabled, includeTemplates }),
    findInstalledCatalog: (includeDisabled = false, includeTemplates = false) =>
      trpc.db.getInstalledRoundCatalog.query({ includeDisabled, includeTemplates }),
    getMediaResources: (roundId: string, includeDisabled = false) =>
      trpc.db.getRoundMediaResources.query({ roundId, includeDisabled }),
    countInstalled: (includeDisabled = false, includeTemplates = false) =>
      trpc.db.getInstalledRoundCount.query({ includeDisabled, includeTemplates }),
    getDisabledIds: () => trpc.db.getDisabledRoundIds.query(),
    update: (input: {
      id: string;
      name: string;
      author?: string | null;
      description?: string | null;
      bpm?: number | null;
      difficulty?: number | null;
      startTime?: number | null;
      endTime?: number | null;
      funscriptUri?: string | null;
      type: "Normal" | "Interjection" | "Cum";
    }) => withInstalledRoundCacheInvalidation(() => trpc.db.updateRound.mutate(input)),
    createWebsiteRound: (input: { name: string; videoUri: string; funscriptUri?: string | null }) =>
      withInstalledRoundCacheInvalidation(() => trpc.db.createWebsiteRound.mutate(input)),
    checkWebsiteVideoSupport: (videoUri: string) =>
      trpc.db.checkWebsiteRoundVideoSupport.query({ videoUri }),
    delete: (id: string) =>
      withInstalledRoundCacheInvalidation(() => trpc.db.deleteRound.mutate({ id })),
    repairTemplate: (input: { roundId: string; installedRoundId: string }) =>
      withInstalledRoundCacheInvalidation(() => trpc.db.repairTemplateRound.mutate(input)),
    retryTemplateLinking: (input?: { roundId?: string; heroId?: string }) =>
      withInstalledRoundCacheInvalidation(() => trpc.db.retryTemplateLinking.mutate(input)),
    convertHeroGroupToRound: (input: {
      keepRoundId: string;
      roundIds: string[];
      heroId?: string | null;
      roundName: string;
    }) => withInstalledRoundCacheInvalidation(() => trpc.db.convertHeroGroupToRound.mutate(input)),
  },
  template: {
    repairHero: (input: {
      heroId: string;
      sourceHeroId: string;
      assignments?: Array<{ roundId: string; installedRoundId: string }>;
    }) => withInstalledRoundCacheInvalidation(() => trpc.db.repairTemplateHero.mutate(input)),
    retryLinking: (input?: { roundId?: string; heroId?: string }) =>
      withInstalledRoundCacheInvalidation(() => trpc.db.retryTemplateLinking.mutate(input)),
  },
  install: {
    getScanStatus: () => trpc.db.getInstallScanStatus.query(),
    abortScan: () => trpc.db.abortInstallScan.mutate(),
    scanNow: () => withInstalledRoundCacheInvalidation(() => trpc.db.scanInstallSources.mutate()),
    inspectFolder: (folderPath: string) => trpc.db.inspectInstallFolder.query({ folderPath }),
    scanFolderOnce: (folderPath: string, omitCheckpointRounds = true) =>
      withInstalledRoundCacheInvalidation(() =>
        trpc.db.scanInstallFolderOnce.mutate({ folderPath, omitCheckpointRounds })
      ),
    inspectSidecarFile: (filePath: string) => trpc.db.inspectInstallSidecarFile.query({ filePath }),
    importSidecarFile: (filePath: string, allowedBaseDomains?: string[]) =>
      withInstalledRoundCacheInvalidation(() =>
        trpc.db.importInstallSidecarFile.mutate({ filePath, allowedBaseDomains })
      ),
    importLegacyWithPlan: (
      folderPath: string,
      reviewedSlots: Array<{
        id: string;
        sourcePath: string;
        originalOrder: number;
        selectedAsCheckpoint: boolean;
        excludedFromImport: boolean;
      }>,
      deferPhash?: boolean
    ) =>
      withInstalledRoundCacheInvalidation(() =>
        trpc.db.importLegacyFolderWithPlan.mutate({ folderPath, reviewedSlots, deferPhash })
      ),
    getAutoScanFolders: () => trpc.db.getAutoScanFolders.query(),
    addAutoScanFolder: (folderPath: string) => trpc.db.addAutoScanFolder.mutate({ folderPath }),
    addAutoScanFolderAndScan: (folderPath: string) =>
      withInstalledRoundCacheInvalidation(() =>
        trpc.db.addAutoScanFolderAndScan.mutate({ folderPath })
      ),
    removeAutoScanFolder: (folderPath: string) =>
      trpc.db.removeAutoScanFolder.mutate({ folderPath }),
    exportDatabase: (includeResourceUris = false) =>
      trpc.db.exportInstalledDatabase.mutate({ includeResourceUris }),
    exportPackage: (input: {
      roundIds?: string[];
      heroIds?: string[];
      includeMedia?: boolean;
      directoryPath?: string;
      asFpack?: boolean;
      compressionMode?: "copy" | "av1";
      compressionStrength?: number;
    }) => trpc.db.exportLibraryPackage.mutate(input),
    analyzeExportPackage: (input: {
      roundIds?: string[];
      heroIds?: string[];
      includeMedia?: boolean;
      compressionMode?: "copy" | "av1";
      compressionStrength?: number;
    }) => trpc.db.analyzeLibraryExportPackage.query(input),
    getExportPackageStatus: () => trpc.db.getLibraryExportPackageStatus.query(),
    abortExportPackage: () => trpc.db.abortLibraryExportPackage.mutate(),
    openExportFolder: () => trpc.db.openInstallExportFolder.mutate(),
    clearAllData: (input?: ClearAllDataOptions) =>
      withInstalledRoundCacheInvalidation(() => trpc.db.clearAllData.mutate(input)),
  },
  gameProfile: {
    getLocalHighscore: () => trpc.db.getLocalHighscore.query(),
    setLocalHighscore: (
      highscore: number,
      options?: {
        cheatMode?: boolean;
        assisted?: boolean;
        assistedSaveMode?: "checkpoint" | "everywhere" | null;
      }
    ) =>
      trpc.db.setLocalHighscore.mutate({
        highscore,
        cheatMode: options?.cheatMode,
        assisted: options?.assisted,
        assistedSaveMode: options?.assistedSaveMode,
      }),
  },
  singlePlayerHistory: {
    recordRun: (input: {
      finishedAtIso?: string;
      score: number;
      survivedDurationSec?: number | null;
      highscoreBefore: number;
      highscoreAfter: number;
      wasNewHighscore: boolean;
      completionReason: string;
      playlistId?: string | null;
      playlistName: string;
      playlistFormatVersion?: number | null;
      endingPosition: number;
      turn: number;
      cheatModeActive?: boolean;
      assistedActive?: boolean;
      assistedSaveMode?: "checkpoint" | "everywhere" | null;
    }) => trpc.db.recordSinglePlayerRun.mutate(input),
    listRuns: (limit = 50) => trpc.db.listSinglePlayerRuns.query({ limit }),
    getCumLoadCount: () => trpc.db.getSinglePlayerCumLoadCount.query(),
    deleteRun: (id: string) => trpc.db.deleteSinglePlayerRun.mutate({ id }),
  },
  singlePlayerSaves: {
    upsert: (input: Parameters<typeof trpc.db.upsertSinglePlayerRunSave.mutate>[0]) =>
      trpc.db.upsertSinglePlayerRunSave.mutate(input),
    getByPlaylist: (playlistId: string) => trpc.db.getSinglePlayerRunSave.query({ playlistId }),
    list: () => trpc.db.listSinglePlayerRunSaves.query(),
    deleteByPlaylist: (playlistId: string) =>
      trpc.db.deleteSinglePlayerRunSaveByPlaylist.mutate({ playlistId }),
  },
  multiplayer: {
    upsertMatchCache: (input: {
      lobbyId: string;
      finishedAtIso: string;
      isFinal: boolean;
      resultsJson: unknown;
    }) => trpc.db.upsertMultiplayerMatchCache.mutate(input),
    getMatchCache: (lobbyId: string) => trpc.db.getMultiplayerMatchCache.query({ lobbyId }),
    listMatchCache: (limit = 50) => trpc.db.listMultiplayerMatchCache.query({ limit }),
    enqueueResultSyncLobby: (lobbyId: string) => trpc.db.enqueueResultSyncLobby.mutate({ lobbyId }),
    touchResultSyncLobby: (lobbyId: string) => trpc.db.touchResultSyncLobby.mutate({ lobbyId }),
    listResultSyncLobbies: () => trpc.db.listResultSyncLobbies.query(),
    removeResultSyncLobby: (lobbyId: string) => trpc.db.removeResultSyncLobby.mutate({ lobbyId }),
  },
  phash: {
    getScanStatus: () => trpc.db.getPhashScanStatus.query(),
    startScan: () => trpc.db.startPhashScan.mutate(),
    startScanManual: () => trpc.db.startPhashScanManual.mutate(),
    abortScan: () => trpc.db.abortPhashScan.mutate(),
  },
  webVideoCache: {
    getScanStatus: () => trpc.db.getWebsiteVideoScanStatus.query(),
    startScan: () => trpc.db.startWebsiteVideoScan.mutate(),
    startScanManual: () => trpc.db.startWebsiteVideoScanManual.mutate(),
    abortScan: () => trpc.db.abortWebsiteVideoScan.mutate(),
    getDownloadProgresses: () => trpc.db.getWebsiteVideoDownloadProgresses.query(),
  },
} as const;
