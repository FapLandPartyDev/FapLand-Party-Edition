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
      updates: {
        subscribe: (
          callback: (state: import("../electron/services/updater").AppUpdateState) => void
        ) => UpdateUnsubscribe;
      };
      appOpen: {
        consumePendingFiles: () => Promise<string[]>;
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
    };
  }
}

export {};
