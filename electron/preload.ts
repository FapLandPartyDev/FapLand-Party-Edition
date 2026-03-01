import { contextBridge, ipcRenderer, webUtils } from "electron";
import { exposeElectronTRPC } from "trpc-electron/main";
import type { AppUpdateState } from "./services/updater";
import type { EroScriptsLoginStatus } from "./services/eroscripts";

process.once("loaded", () => {
  exposeElectronTRPC();
});

function toRendererErrorPayload(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return {
      message: error.message,
      stack: error.stack,
      name: error.name,
      route: window.location.pathname,
    };
  }
  return {
    message: typeof error === "string" ? error : String(error),
    route: window.location.pathname,
  };
}

window.addEventListener("error", (event) => {
  void ipcRenderer.invoke("debug:renderer-error", {
    message: event.message,
    stack: event.error instanceof Error ? event.error.stack : undefined,
    filename: event.filename,
    lineNumber: event.lineno,
    columnNumber: event.colno,
    route: window.location.pathname,
  });
});

window.addEventListener("unhandledrejection", (event) => {
  void ipcRenderer.invoke("debug:renderer-error", {
    type: "unhandledrejection",
    ...toRendererErrorPayload(event.reason),
  });
});

// Keep the app:// media URL helper separate from the tRPC bridge.
contextBridge.exposeInMainWorld("electronAPI", {
  file: {
    convertFileSrc: (filePath: string): string => `app://media/${encodeURIComponent(filePath)}`,
  },
  dialog: {
    selectFolders: () => ipcRenderer.invoke("dialog:selectFolders") as Promise<string[]>,
    selectInstallImportFile: () =>
      ipcRenderer.invoke("dialog:selectInstallImportFile") as Promise<string | null>,
    selectPlaylistImportFile: () =>
      ipcRenderer.invoke("dialog:selectPlaylistImportFile") as Promise<string | null>,
    selectPlaylistExportPath: (defaultName: string) =>
      ipcRenderer.invoke("dialog:selectPlaylistExportPath", defaultName) as Promise<string | null>,
    selectPlaylistExportDirectory: (defaultName?: string) =>
      ipcRenderer.invoke("dialog:selectPlaylistExportDirectory", defaultName) as Promise<
        string | null
      >,
    selectWebsiteVideoCacheDirectory: () =>
      ipcRenderer.invoke("dialog:selectWebsiteVideoCacheDirectory") as Promise<string | null>,
    selectEroScriptsCacheDirectory: () =>
      ipcRenderer.invoke("dialog:selectEroScriptsCacheDirectory") as Promise<string | null>,
    selectMusicCacheDirectory: () =>
      ipcRenderer.invoke("dialog:selectMusicCacheDirectory") as Promise<string | null>,
    selectMoaningCacheDirectory: () =>
      ipcRenderer.invoke("dialog:selectMoaningCacheDirectory") as Promise<string | null>,
    selectConverterVideoFile: () =>
      ipcRenderer.invoke("dialog:selectConverterVideoFile") as Promise<string | null>,
    selectMapBackgroundFile: () =>
      ipcRenderer.invoke("dialog:selectMapBackgroundFile") as Promise<string | null>,
    selectMusicFiles: () => ipcRenderer.invoke("dialog:selectMusicFiles") as Promise<string[]>,
    selectMoaningFiles: () => ipcRenderer.invoke("dialog:selectMoaningFiles") as Promise<string[]>,
    addMusicFromUrl: (url: string) =>
      ipcRenderer.invoke("music:addFromUrl", url) as Promise<{ filePath: string; title: string }>,
    addMusicPlaylistFromUrl: (url: string) =>
      ipcRenderer.invoke("music:addPlaylistFromUrl", url) as Promise<{
        playlistTitle: string;
        totalTracks: number;
        tracks: { filePath: string; title: string }[];
        errors: { url: string; error: string }[];
      }>,
    addMoaningFromUrl: (url: string) =>
      ipcRenderer.invoke("moaning:addFromUrl", url) as Promise<{
        filePath: string;
        title: string;
      }>,
    addMoaningPlaylistFromUrl: (url: string) =>
      ipcRenderer.invoke("moaning:addPlaylistFromUrl", url) as Promise<{
        playlistTitle: string;
        totalTracks: number;
        tracks: { filePath: string; title: string }[];
        errors: { url: string; error: string }[];
      }>,
    selectConverterFunscriptFile: () =>
      ipcRenderer.invoke("dialog:selectConverterFunscriptFile") as Promise<string | null>,
    selectFpackExtractionDirectory: () =>
      ipcRenderer.invoke("dialog:selectFpackExtractionDirectory") as Promise<string | null>,
    selectMigrationTargetDirectory: () =>
      ipcRenderer.invoke("dialog:selectMigrationTargetDirectory") as Promise<string | null>,
    selectPortableInstallation: () =>
      ipcRenderer.invoke("dialog:selectPortableInstallation") as Promise<string | null>,
  },
  window: {
    isFullscreen: () => ipcRenderer.invoke("window:isFullscreen") as Promise<boolean>,
    setFullscreen: (value: boolean) =>
      ipcRenderer.invoke("window:setFullscreen", value) as Promise<boolean>,
    toggleFullscreen: () => ipcRenderer.invoke("window:toggleFullscreen") as Promise<boolean>,
    getZoomPercent: () => ipcRenderer.invoke("window:getZoomPercent") as Promise<number>,
    zoomIn: () => ipcRenderer.invoke("window:zoomIn") as Promise<number>,
    zoomOut: () => ipcRenderer.invoke("window:zoomOut") as Promise<number>,
    resetZoom: () => ipcRenderer.invoke("window:resetZoom") as Promise<number>,
    subscribeToZoom: (callback: (zoomPercent: number) => void) => {
      const listener = (_event: unknown, zoomPercent: number) => {
        callback(zoomPercent);
      };
      ipcRenderer.on("window:zoom-changed", listener);
      return () => {
        ipcRenderer.off("window:zoom-changed", listener);
      };
    },
    close: () => ipcRenderer.invoke("window:close") as Promise<boolean>,
  },
  performance: {
    updateState: (state: { route: string; visible: boolean; idleSensitive: boolean }) =>
      ipcRenderer.invoke("performance:updateState", state) as Promise<void>,
  },
  tcode: {
    listPorts: () =>
      ipcRenderer.invoke("tcode:listPorts") as Promise<
        Array<{ path: string; manufacturer: string | null }>
      >,
    connect: (config: {
      transport: "serial" | "websocket";
      serialPath?: string;
      baudRate?: number;
      websocketUrl?: string;
    }) =>
      ipcRenderer.invoke("tcode:connect", config) as Promise<{ success: boolean; error?: string }>,
    send: (command: string) => ipcRenderer.invoke("tcode:send", command) as Promise<boolean>,
    disconnect: () => ipcRenderer.invoke("tcode:disconnect") as Promise<void>,
    isConnected: () => ipcRenderer.invoke("tcode:isConnected") as Promise<boolean>,
  },
  updates: {
    subscribe: (callback: (state: AppUpdateState) => void) => {
      const listener = (_event: unknown, state: AppUpdateState) => {
        callback(state);
      };
      ipcRenderer.on("updates:state", listener);
      return () => {
        ipcRenderer.off("updates:state", listener);
      };
    },
  },
  appOpen: {
    consumePendingFiles: () =>
      ipcRenderer.invoke("app-open:consumePendingFiles") as Promise<string[]>,
    openDroppedFiles: (files: FileList | File[]) => {
      const filePaths = Array.from(files)
        .map((file) => webUtils.getPathForFile(file))
        .filter((filePath) => filePath.trim().length > 0);
      return ipcRenderer.invoke("app-open:openDroppedFiles", filePaths) as Promise<void>;
    },
    subscribe: (callback: (filePaths: string[]) => void) => {
      const listener = (_event: unknown, filePaths: string[]) => {
        callback(filePaths);
      };
      ipcRenderer.on("app-open:files", listener);
      void ipcRenderer.invoke("app-open:renderer-ready");
      return () => {
        ipcRenderer.off("app-open:files", listener);
      };
    },
  },
  auth: {
    consumePendingCallback: () =>
      ipcRenderer.invoke("auth:consumePendingCallback") as Promise<string | null>,
    subscribe: (callback: (url: string) => void) => {
      const listener = (_event: unknown, url: string) => {
        callback(url);
      };
      ipcRenderer.on("auth:callback", listener);
      return () => {
        ipcRenderer.off("auth:callback", listener);
      };
    },
  },
  eroscripts: {
    subscribeToLoginStatus: (callback: (status: EroScriptsLoginStatus) => void) => {
      const listener = (_event: unknown, status: EroScriptsLoginStatus) => {
        callback(status);
      };
      ipcRenderer.on("eroscripts:login-status", listener);
      return () => {
        ipcRenderer.off("eroscripts:login-status", listener);
      };
    },
  },
} as const);
