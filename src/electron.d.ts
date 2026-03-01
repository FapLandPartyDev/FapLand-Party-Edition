declare global {
  type UpdateUnsubscribe = () => void;

  interface Window {
    electronAPI: {
      file: {
        convertFileSrc: (filePath: string) => string;
      };
      dialog: {
        selectFolders: () => Promise<string[]>;
        selectInstallImportFile: () => Promise<string | null>;
        selectPlaylistImportFile: () => Promise<string | null>;
        selectPlaylistExportPath: (defaultName: string) => Promise<string | null>;
        selectPlaylistExportDirectory: (defaultName?: string) => Promise<string | null>;
        selectWebsiteVideoCacheDirectory: () => Promise<string | null>;
        selectEroScriptsCacheDirectory: () => Promise<string | null>;
        selectMusicCacheDirectory: () => Promise<string | null>;
        selectMoaningCacheDirectory: () => Promise<string | null>;
        selectConverterVideoFile: () => Promise<string | null>;
        selectMapBackgroundFile: () => Promise<string | null>;
        selectMusicFiles: () => Promise<string[]>;
        selectMoaningFiles: () => Promise<string[]>;
        addMusicFromUrl: (url: string) => Promise<{ filePath: string; title: string }>;
        addMusicPlaylistFromUrl: (url: string) => Promise<{
          playlistTitle: string;
          totalTracks: number;
          tracks: { filePath: string; title: string }[];
          errors: { url: string; error: string }[];
        }>;
        addMoaningFromUrl: (url: string) => Promise<{ filePath: string; title: string }>;
        addMoaningPlaylistFromUrl: (url: string) => Promise<{
          playlistTitle: string;
          totalTracks: number;
          tracks: { filePath: string; title: string }[];
          errors: { url: string; error: string }[];
        }>;
        selectConverterFunscriptFile: () => Promise<string | null>;
        selectFpackExtractionDirectory: () => Promise<string | null>;
        selectMigrationTargetDirectory: () => Promise<string | null>;
        selectPortableInstallation: () => Promise<string | null>;
      };
      window: {
        isFullscreen: () => Promise<boolean>;
        setFullscreen: (value: boolean) => Promise<boolean>;
        toggleFullscreen: () => Promise<boolean>;
        getZoomPercent?: () => Promise<number>;
        zoomIn?: () => Promise<number>;
        zoomOut?: () => Promise<number>;
        resetZoom?: () => Promise<number>;
        subscribeToZoom?: (callback: (zoomPercent: number) => void) => UpdateUnsubscribe;
        close: () => Promise<boolean>;
      };
      performance?: {
        updateState: (state: {
          route: string;
          visible: boolean;
          activity: "critical" | "interactive" | "idle";
        }) => Promise<void>;
      };
      debug?: {
        recordVideoEvent: (payload: Record<string, unknown>) => Promise<void>;
        recordTCodeSerialEvent?: (payload: Record<string, unknown>) => Promise<void>;
      };
      serial?: {
        getSelectedPortMetadata: () => Promise<{
          portName: string;
          displayName: string | null;
          vendorId: string | null;
          productId: string | null;
        } | null>;
      };
      updates: {
        subscribe: (
          callback: (state: import("../electron/services/updater").AppUpdateState) => void
        ) => UpdateUnsubscribe;
      };
      appOpen: {
        consumePendingFiles: () => Promise<string[]>;
        openDroppedFiles?: (files: FileList | File[]) => Promise<void>;
        subscribe: (callback: (filePaths: string[]) => void) => UpdateUnsubscribe;
      };
      auth?: {
        consumePendingCallback: () => Promise<string | null>;
        subscribe: (callback: (url: string) => void) => UpdateUnsubscribe;
      };
      eroscripts: {
        subscribeToLoginStatus: (
          callback: (
            status: import("../electron/services/eroscripts").EroScriptsLoginStatus
          ) => void
        ) => UpdateUnsubscribe;
      };
      gpuRecovery: {
        consumeRecoveryHint: () => Promise<boolean>;
        subscribe: (callback: (pending: boolean) => void) => UpdateUnsubscribe;
      };
      startupRecovery?: {
        enterRecovery?: () => Promise<void>;
        startNormally?: () => Promise<void>;
        getStatus?: () => Promise<{
          databasePath: string | null;
          databaseExists: boolean;
          databaseBytes: number | null;
          integrity: "ok" | "missing" | "unavailable" | "corrupt";
          integrityMessage: string;
        }>;
        backupDatabase?: () => Promise<string>;
        repairDatabase?: () => Promise<{ backupPath: string; integrityMessage: string }>;
        listDatabaseBackups?: () => Promise<
          Array<{
            id: string;
            createdAt: string;
            bytes: number;
            integrity: "ok" | "corrupt";
            integrityMessage: string;
          }>
        >;
        restoreDatabaseBackup?: (backupId: string) => Promise<{
          restoredBackupId: string;
          safetyBackupPath: string;
          integrityMessage: string;
        }>;
        clearCaches?: () => Promise<{ clearedPaths: number }>;
        resetSettings?: () => Promise<{ backupPath: string | null }>;
        resetInstallation?: (
          keepDatabase: boolean
        ) => Promise<{ databaseArchivePath: string | null }>;
        restart?: () => Promise<void>;
        getAlwaysRecoveryMode?: () => Promise<boolean>;
        setAlwaysRecoveryMode?: (enabled: boolean) => Promise<void>;
      };
    };
  }
}

export {};
