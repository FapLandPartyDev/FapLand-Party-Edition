import { trpc } from "./trpc";

/**
 * Re-export Prisma inferred types directly from the tRPC client.
 * No manual type definitions needed — types flow from the Prisma schema
 * on the main process all the way to the renderer.
 */
export type Hero = Awaited<ReturnType<typeof trpc.db.getHeroes.query>>[number];
export type Round = Awaited<ReturnType<typeof trpc.db.getHeroRounds.query>>[number];
export type Resource = NonNullable<Awaited<ReturnType<typeof trpc.db.getResource.query>>>;
export type InstalledRound = Awaited<ReturnType<typeof trpc.db.getInstalledRounds.query>>[number];
export type InstallScanStatus = Awaited<ReturnType<typeof trpc.db.getInstallScanStatus.query>>;
export type InstallFolderScanResult = Awaited<ReturnType<typeof trpc.db.scanInstallFolderOnce.mutate>>;
export type InstallFolderInspectionResult = Awaited<ReturnType<typeof trpc.db.inspectInstallFolder.query>>;
export type LegacyReviewedImportResult = Awaited<ReturnType<typeof trpc.db.importLegacyFolderWithPlan.mutate>>;
export type InstallDatabaseExportResult = Awaited<ReturnType<typeof trpc.db.exportInstalledDatabase.mutate>>;
export type DisabledRoundIds = Awaited<ReturnType<typeof trpc.db.getDisabledRoundIds.query>>;
export type MultiplayerMatchCacheRow = Awaited<ReturnType<typeof trpc.db.listMultiplayerMatchCache.query>>[number];
export type ResultSyncQueueRow = Awaited<ReturnType<typeof trpc.db.listResultSyncLobbies.query>>[number];
export type SinglePlayerRunHistoryRow = Awaited<ReturnType<typeof trpc.db.listSinglePlayerRuns.query>>[number];

export const db = {
    resource: {
        findMany: () => trpc.db.getResources.query(),
        findFirst: (roundId: string) => trpc.db.getResource.query({ roundId }),
    },
    hero: {
        findMany: () => trpc.db.getHeroes.query(),
        update: (input: {
            id: string;
            name: string;
            author?: string | null;
            description?: string | null;
        }) => trpc.db.updateHero.mutate(input),
        delete: (id: string) => trpc.db.deleteHero.mutate({ id }),
    },
    round: {
        findByHero: (heroId: string) => trpc.db.getHeroRounds.query({ heroId }),
        findInstalled: (includeDisabled = false) => trpc.db.getInstalledRounds.query({ includeDisabled }),
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
            type: "Normal" | "Interjection" | "Cum";
        }) => trpc.db.updateRound.mutate(input),
        delete: (id: string) => trpc.db.deleteRound.mutate({ id }),
        convertHeroGroupToRound: (input: {
            keepRoundId: string;
            roundIds: string[];
            heroId?: string | null;
            roundName: string;
        }) => trpc.db.convertHeroGroupToRound.mutate(input),
    },
    install: {
        getScanStatus: () => trpc.db.getInstallScanStatus.query(),
        abortScan: () => trpc.db.abortInstallScan.mutate(),
        scanNow: () => trpc.db.scanInstallSources.mutate(),
        inspectFolder: (folderPath: string) => trpc.db.inspectInstallFolder.query({ folderPath }),
        scanFolderOnce: (folderPath: string, omitCheckpointRounds = true) =>
            trpc.db.scanInstallFolderOnce.mutate({ folderPath, omitCheckpointRounds }),
        importSidecarFile: (filePath: string) => trpc.db.importInstallSidecarFile.mutate({ filePath }),
        importLegacyWithPlan: (folderPath: string, reviewedSlots: Array<{
            id: string;
            sourcePath: string;
            originalOrder: number;
            selectedAsCheckpoint: boolean;
            excludedFromImport: boolean;
        }>) => trpc.db.importLegacyFolderWithPlan.mutate({ folderPath, reviewedSlots }),
        getAutoScanFolders: () => trpc.db.getAutoScanFolders.query(),
        addAutoScanFolder: (folderPath: string) => trpc.db.addAutoScanFolder.mutate({ folderPath }),
        removeAutoScanFolder: (folderPath: string) => trpc.db.removeAutoScanFolder.mutate({ folderPath }),
        exportDatabase: (includeResourceUris = false) =>
            trpc.db.exportInstalledDatabase.mutate({ includeResourceUris }),
        openExportFolder: () => trpc.db.openInstallExportFolder.mutate(),
        clearAllData: () => trpc.db.clearAllData.mutate(),
    },
    gameProfile: {
        getLocalHighscore: () => trpc.db.getLocalHighscore.query(),
        setLocalHighscore: (highscore: number) => trpc.db.setLocalHighscore.mutate({ highscore }),
    },
    singlePlayerHistory: {
        recordRun: (input: {
            finishedAtIso?: string;
            score: number;
            highscoreBefore: number;
            highscoreAfter: number;
            wasNewHighscore: boolean;
            completionReason: string;
            playlistId?: string | null;
            playlistName: string;
            playlistFormatVersion?: number | null;
            endingPosition: number;
            turn: number;
        }) => trpc.db.recordSinglePlayerRun.mutate(input),
        listRuns: (limit = 50) => trpc.db.listSinglePlayerRuns.query({ limit }),
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
} as const;
