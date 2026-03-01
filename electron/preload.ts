import { contextBridge, ipcRenderer } from "electron";
import type { AppUpdateState } from "./services/updater";

contextBridge.exposeInMainWorld("electronTRPC", {
    sendMessage: (args: unknown) => {
        ipcRenderer.send("electron-trpc", args);
    },
    onMessage: (callback: (args: unknown) => void) => {
        ipcRenderer.on("electron-trpc", (_event, args) => callback(args));
    },
});

// Keep the file:// protocol helper (pure URL transform, not IPC)
contextBridge.exposeInMainWorld("electronAPI", {
    file: {
        convertFileSrc: (filePath: string): string =>
            `app://media/${encodeURIComponent(filePath)}`,
    },
    dialog: {
        selectFolders: () => ipcRenderer.invoke("dialog:selectFolders") as Promise<string[]>,
        selectInstallImportFile: () => ipcRenderer.invoke("dialog:selectInstallImportFile") as Promise<string | null>,
        selectPlaylistImportFile: () => ipcRenderer.invoke("dialog:selectPlaylistImportFile") as Promise<string | null>,
        selectPlaylistExportPath: (defaultName: string) =>
            ipcRenderer.invoke("dialog:selectPlaylistExportPath", defaultName) as Promise<string | null>,
        selectConverterVideoFile: () => ipcRenderer.invoke("dialog:selectConverterVideoFile") as Promise<string | null>,
        selectConverterFunscriptFile: () =>
            ipcRenderer.invoke("dialog:selectConverterFunscriptFile") as Promise<string | null>,
    },
    window: {
        isFullscreen: () => ipcRenderer.invoke("window:isFullscreen") as Promise<boolean>,
        setFullscreen: (value: boolean) => ipcRenderer.invoke("window:setFullscreen", value) as Promise<boolean>,
        toggleFullscreen: () => ipcRenderer.invoke("window:toggleFullscreen") as Promise<boolean>,
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
        consumePendingFiles: () => ipcRenderer.invoke("app-open:consumePendingFiles") as Promise<string[]>,
        subscribe: (callback: (filePaths: string[]) => void) => {
            const listener = (_event: unknown, filePaths: string[]) => {
                callback(filePaths);
            };
            ipcRenderer.on("app-open:files", listener);
            return () => {
                ipcRenderer.off("app-open:files", listener);
            };
        },
    },
} as const);
