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
                selectConverterVideoFile: () => Promise<string | null>;
                selectConverterFunscriptFile: () => Promise<string | null>;
            };
            window: {
                isFullscreen: () => Promise<boolean>;
                setFullscreen: (value: boolean) => Promise<boolean>;
                toggleFullscreen: () => Promise<boolean>;
            };
            updates: {
                subscribe: (callback: (state: import("../electron/services/updater").AppUpdateState) => void) => UpdateUnsubscribe;
            };
            appOpen: {
                consumePendingFiles: () => Promise<string[]>;
                subscribe: (callback: (filePaths: string[]) => void) => UpdateUnsubscribe;
            };
        };
    }
}

export { };
