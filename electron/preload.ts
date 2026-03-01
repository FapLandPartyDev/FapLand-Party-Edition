import { contextBridge, ipcRenderer } from "electron";
import { exposeElectronTRPC } from "trpc-electron/main";
import type { AppUpdateState } from "./services/updater";

process.once("loaded", () => {
  exposeElectronTRPC();
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
    selectMusicCacheDirectory: () =>
      ipcRenderer.invoke("dialog:selectMusicCacheDirectory") as Promise<string | null>,
    selectConverterVideoFile: () =>
      ipcRenderer.invoke("dialog:selectConverterVideoFile") as Promise<string | null>,
    selectMusicFiles: () => ipcRenderer.invoke("dialog:selectMusicFiles") as Promise<string[]>,
    addMusicFromUrl: (url: string) =>
      ipcRenderer.invoke("music:addFromUrl", url) as Promise<{ filePath: string; title: string }>,
    addMusicPlaylistFromUrl: (url: string) =>
      ipcRenderer.invoke("music:addPlaylistFromUrl", url) as Promise<{
        playlistTitle: string;
        totalTracks: number;
        tracks: { filePath: string; title: string }[];
        errors: { url: string; error: string }[];
      }>,
    selectConverterFunscriptFile: () =>
      ipcRenderer.invoke("dialog:selectConverterFunscriptFile") as Promise<string | null>,
    selectFpackExtractionDirectory: () =>
      ipcRenderer.invoke("dialog:selectFpackExtractionDirectory") as Promise<string | null>,
  },
  window: {
    isFullscreen: () => ipcRenderer.invoke("window:isFullscreen") as Promise<boolean>,
    setFullscreen: (value: boolean) =>
      ipcRenderer.invoke("window:setFullscreen", value) as Promise<boolean>,
    toggleFullscreen: () => ipcRenderer.invoke("window:toggleFullscreen") as Promise<boolean>,
    close: () => ipcRenderer.invoke("window:close") as Promise<boolean>,
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
} as const);
