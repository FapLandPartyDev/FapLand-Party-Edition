import { app, BrowserWindow, protocol, ipcMain, dialog, Menu, type OpenDialogOptions } from "electron";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { config as loadDotenv } from "dotenv";
import { createIPCHandler } from "electron-trpc/main";
import { appRouter } from "./trpc/router";
import { getNodeEnv } from "../src/zod/env";
import {
    SUPPORTED_VIDEO_EXTENSIONS,
    getVideoContentTypeByExtension,
    isVideoExtension,
} from "../src/constants/videoFormats";
import { approveDialogPath } from "./services/dialogPathApproval";
import { ensureAppDatabaseReady } from "./services/db";
import { scanInstallSources } from "./services/installer";
import { proxyExternalRequest } from "./services/integrations";
import { initializeAppUpdater, subscribeToUpdateState } from "./services/updater";

const OPENABLE_FILE_EXTENSIONS = new Set([".hero", ".round", ".fplay"]);
const pendingOpenedFiles: string[] = [];
let appOpenRendererReady = false;
let mainWindowRef: BrowserWindow | null = null;

// Allow custom app:// URLs to behave like normal web URLs, including
// media streaming and fetch() from the renderer.
loadDotenv();

protocol.registerSchemesAsPrivileged([
    {
        scheme: "app",
        privileges: {
            standard: true,
            secure: true,
            supportFetchAPI: true,
            corsEnabled: true,
            stream: true,
        },
    },
]);



app.commandLine.appendSwitch("enable-features", "UseOzonePlatform,WaylandWindowDecorations");
app.commandLine.appendSwitch("ozone-platform-hint", "auto");

function normalizeUserDataSuffix(raw: string | undefined): string | null {
    if (!raw) return null;
    const trimmed = raw.trim().toLowerCase();
    if (trimmed.length === 0) return null;

    const sanitized = trimmed.replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
    return sanitized.length > 0 ? sanitized : null;
}

const userDataSuffix = normalizeUserDataSuffix(process.env.FLAND_USER_DATA_SUFFIX);
if (userDataSuffix) {
    // Allow running multiple clients on one machine with isolated session/state storage.
    app.setPath("userData", path.join(app.getPath("appData"), `f - land - ${userDataSuffix} `));
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.join(__dirname, "..");
const env = getNodeEnv();
const normalizedProcessEnv: NodeJS.ProcessEnv = {
    ...process.env,
    APP_ROOT,
};

if (env.databaseUrlRaw) {
    normalizedProcessEnv.DATABASE_URL = env.databaseUrlRaw;
} else {
    delete normalizedProcessEnv.DATABASE_URL;
}

if (env.viteDevServerUrl) {
    normalizedProcessEnv.VITE_DEV_SERVER_URL = env.viteDevServerUrl;
} else {
    delete normalizedProcessEnv.VITE_DEV_SERVER_URL;
}

if (env.updateRepository) {
    normalizedProcessEnv.FLAND_UPDATE_REPOSITORY = env.updateRepository;
} else {
    delete normalizedProcessEnv.FLAND_UPDATE_REPOSITORY;
}

process.env = normalizedProcessEnv;

const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL;
const RENDERER_DIST = path.join(APP_ROOT, "dist");

function normalizeOpenedFilePath(rawPath: string): string | null {
    const trimmed = rawPath.trim();
    if (trimmed.length === 0 || trimmed.startsWith("-")) return null;

    const ext = path.extname(trimmed).toLowerCase();
    if (!OPENABLE_FILE_EXTENSIONS.has(ext)) return null;

    return path.normalize(path.resolve(trimmed));
}

function approveOpenedFilePath(filePath: string): void {
    const ext = path.extname(filePath).toLowerCase();
    if (ext === ".fplay") {
        approveDialogPath("playlistImportFile", filePath);
        return;
    }

    if (ext === ".hero" || ext === ".round") {
        approveDialogPath("installSidecarFile", filePath);
    }
}

function queueOpenedFiles(filePaths: string[]): void {
    const normalized = filePaths
        .map(normalizeOpenedFilePath)
        .filter((filePath): filePath is string => Boolean(filePath));
    if (normalized.length === 0) return;

    for (const filePath of normalized) {
        approveOpenedFilePath(filePath);
    }

    if (appOpenRendererReady && mainWindowRef && !mainWindowRef.isDestroyed()) {
        mainWindowRef.webContents.send("app-open:files", normalized);
        return;
    }

    pendingOpenedFiles.push(...normalized);
}

function focusMainWindow(): void {
    const targetWindow = mainWindowRef ?? BrowserWindow.getAllWindows()[0] ?? null;
    if (!targetWindow) return;
    if (targetWindow.isMinimized()) {
        targetWindow.restore();
    }
    targetWindow.focus();
}

if (!app.requestSingleInstanceLock()) {
    app.quit();
} else {
    queueOpenedFiles(process.argv.slice(1));

    app.on("second-instance", (_event, argv) => {
        queueOpenedFiles(argv.slice(1));
        focusMainWindow();
    });
}

app.on("open-file", (event, filePath) => {
    event.preventDefault();
    queueOpenedFiles([filePath]);
    focusMainWindow();
});

function resolveMediaContentType(filePath: string): string {
    const extension = path.extname(filePath).toLowerCase();
    if (extension === ".funscript" || extension === ".json") return "application/json";

    const mappedVideoType = getVideoContentTypeByExtension(extension);
    if (mappedVideoType) return mappedVideoType;
    if (isVideoExtension(extension)) {
        // Chromium treats the app:// response as a media stream when we provide any video/*
        // type, so use mp4 as a compatibility fallback for known-but-unmapped extensions.
        return "video/mp4";
    }

    return "application/octet-stream";
}

type ParsedByteRange = { start: number; end: number } | null | "invalid";

function parseRangeHeader(rangeHeader: string | null, totalSize: number): ParsedByteRange {
    if (!rangeHeader) return null;

    const normalized = rangeHeader.trim();
    if (!normalized.toLowerCase().startsWith("bytes=")) return "invalid";

    const value = normalized.slice(6).split(",")[0]?.trim() ?? "";
    const matched = value.match(/^(\d*)-(\d*)$/);
    if (!matched) return "invalid";

    const rawStart = matched[1] ?? "";
    const rawEnd = matched[2] ?? "";
    if (rawStart.length === 0 && rawEnd.length === 0) return "invalid";

    if (rawStart.length === 0) {
        const suffixLength = Number(rawEnd);
        if (!Number.isFinite(suffixLength) || suffixLength <= 0) return "invalid";
        const safeSuffixLength = Math.floor(suffixLength);
        const end = Math.max(0, totalSize - 1);
        const start = Math.max(0, totalSize - safeSuffixLength);
        return { start, end };
    }

    const start = Math.floor(Number(rawStart));
    if (!Number.isFinite(start) || start < 0) return "invalid";

    const parsedEnd = rawEnd.length > 0 ? Math.floor(Number(rawEnd)) : totalSize - 1;
    if (!Number.isFinite(parsedEnd) || parsedEnd < 0) return "invalid";

    if (start >= totalSize || start > parsedEnd) return "invalid";

    const end = Math.min(parsedEnd, totalSize - 1);
    return { start, end };
}

async function createMediaResponse(filePath: string, request: Request): Promise<Response> {
    let fileStats;
    try {
        fileStats = await stat(filePath);
    } catch {
        return new Response("Not found", { status: 404 });
    }

    if (!fileStats.isFile()) {
        return new Response("Not found", { status: 404 });
    }

    const totalSize = fileStats.size;
    const range = parseRangeHeader(request.headers.get("range"), totalSize);
    const contentType = resolveMediaContentType(filePath);

    if (range === "invalid") {
        return new Response(null, {
            status: 416,
            headers: {
                "Accept-Ranges": "bytes",
                "Content-Range": `bytes */${totalSize}`,
            },
        });
    }

    if (!range) {
        const headers = new Headers({
            "Accept-Ranges": "bytes",
            "Content-Length": `${totalSize}`,
            "Content-Type": contentType,
        });

        if (request.method === "HEAD") {
            return new Response(null, { status: 200, headers });
        }

        const stream = createReadStream(filePath);
        return new Response(Readable.toWeb(stream) as ReadableStream, {
            status: 200,
            headers,
        });
    }

    const contentLength = Math.max(0, range.end - range.start + 1);
    const headers = new Headers({
        "Accept-Ranges": "bytes",
        "Content-Length": `${contentLength}`,
        "Content-Range": `bytes ${range.start}-${range.end}/${totalSize}`,
        "Content-Type": contentType,
    });

    if (request.method === "HEAD") {
        return new Response(null, { status: 206, headers });
    }

    const stream = createReadStream(filePath, {
        start: range.start,
        end: range.end,
    });

    return new Response(Readable.toWeb(stream) as ReadableStream, {
        status: 206,
        headers,
    });
}

function registerFileProtocol(): void {
    protocol.handle("app", async (request: Request) => {
        const url = new URL(request.url);

        if (url.hostname === "external") {
            return proxyExternalRequest(request);
        }

        if (url.hostname !== "media") {
            return new Response("Not found", { status: 404 });
        }

        const decoded = decodeURIComponent(url.pathname.slice(1));
        const normalizedPath =
            process.platform === "win32" && /^\/[A-Za-z]:/.test(decoded)
                ? path.normalize(decoded.slice(1))
                : path.normalize(decoded);

        return createMediaResponse(normalizedPath, request);
    });
}

function createWindow(): BrowserWindow {
    const mainWindow = new BrowserWindow({
        width: 1280,
        height: 800,
        title: "Fap Land",
        webPreferences: {
            preload: path.join(__dirname, "preload.cjs"),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: false,
        },
        backgroundColor: "#050508",
        autoHideMenuBar: true,
    });
    mainWindowRef = mainWindow;
    appOpenRendererReady = false;

    // Wire up tRPC IPC handler for this window
    createIPCHandler({ router: appRouter });

    // Forward renderer console logs to terminal
    mainWindow.webContents.on("console-message", (_event, _level, message, line, sourceId) => {
        console.log(`[Renderer Console] ${sourceId}:${line} - ${message}`);
    });

    // Handle zoom shortcuts and F11 fullscreen toggle since we removed the default menu
    mainWindow.webContents.on("before-input-event", (event, input) => {
        if (input.type !== "keyDown") return;

        if (input.key === "F11") {
            mainWindow.setFullScreen(!mainWindow.isFullScreen());
            event.preventDefault();
            return;
        }

        if (input.control || input.meta) {
            const currentZoom = mainWindow.webContents.getZoomLevel();
            if (input.key === "=" || input.key === "+") {
                mainWindow.webContents.setZoomLevel(currentZoom + 0.5);
                event.preventDefault();
            } else if (input.key === "-") {
                mainWindow.webContents.setZoomLevel(currentZoom - 0.5);
                event.preventDefault();
            } else if (input.key.toLowerCase() === "o" || input.key === "0") {
                mainWindow.webContents.setZoomLevel(0);
                event.preventDefault();
            }
        }
    });

    if (VITE_DEV_SERVER_URL) {
        mainWindow.loadURL(VITE_DEV_SERVER_URL);
        mainWindow.webContents.openDevTools();
    } else {
        mainWindow.loadFile(path.join(RENDERER_DIST, "index.html"));
    }

    mainWindow.on("closed", () => {
        if (mainWindowRef === mainWindow) {
            mainWindowRef = null;
            appOpenRendererReady = false;
        }
    });

    mainWindow.webContents.on("did-start-loading", () => {
        if (mainWindowRef === mainWindow) {
            appOpenRendererReady = false;
        }
    });

    return mainWindow;
}

function broadcastUpdateState() {
    subscribeToUpdateState((state) => {
        for (const window of BrowserWindow.getAllWindows()) {
            window.webContents.send("updates:state", state);
        }
    });
}

function registerWindowControlsIpc() {
    ipcMain.handle("window:isFullscreen", (event) => {
        const win = BrowserWindow.fromWebContents(event.sender);
        return win?.isFullScreen() ?? false;
    });

    ipcMain.handle("window:setFullscreen", (event, value: boolean) => {
        const win = BrowserWindow.fromWebContents(event.sender);
        if (!win) return false;
        win.setFullScreen(Boolean(value));
        return win.isFullScreen();
    });

    ipcMain.handle("window:toggleFullscreen", (event) => {
        const win = BrowserWindow.fromWebContents(event.sender);
        if (!win) return false;
        win.setFullScreen(!win.isFullScreen());
        return win.isFullScreen();
    });
}

function registerDialogIpc() {
    ipcMain.handle("dialog:selectFolders", async (event) => {
        const win = BrowserWindow.fromWebContents(event.sender);
        const options: OpenDialogOptions = {
            title: "Select Auto-Scan Folders",
            properties: ["openDirectory", "multiSelections", "createDirectory"],
        };
        const result = win
            ? await dialog.showOpenDialog(win, options)
            : await dialog.showOpenDialog(options);

        if (result.canceled) {
            return [] as string[];
        }

        for (const filePath of result.filePaths) {
            approveDialogPath("installFolder", filePath);
        }

        return result.filePaths;
    });

    ipcMain.handle("dialog:selectInstallImportFile", async (event) => {
        const win = BrowserWindow.fromWebContents(event.sender);
        const options: OpenDialogOptions = {
            title: "Import File",
            properties: ["openFile"],
            filters: [
                { name: "F-Land Import Files", extensions: ["hero", "round", "fplay"] },
                { name: "All Files", extensions: ["*"] },
            ],
        };
        const result = win
            ? await dialog.showOpenDialog(win, options)
            : await dialog.showOpenDialog(options);

        if (result.canceled) {
            return null;
        }

        const filePath = result.filePaths[0] ?? null;
        if (!filePath) {
            return null;
        }

        approveOpenedFilePath(filePath);
        return filePath;
    });

    ipcMain.handle("dialog:selectPlaylistImportFile", async (event) => {
        const win = BrowserWindow.fromWebContents(event.sender);
        const options: OpenDialogOptions = {
            title: "Import Playlist",
            properties: ["openFile"],
            filters: [{ name: "F-Land Playlist", extensions: ["fplay"] }],
        };
        const result = win
            ? await dialog.showOpenDialog(win, options)
            : await dialog.showOpenDialog(options);

        if (result.canceled) {
            return null;
        }

        const filePath = result.filePaths[0] ?? null;
        if (filePath) {
            approveDialogPath("playlistImportFile", filePath);
        }

        return filePath;
    });

    ipcMain.handle("dialog:selectPlaylistExportPath", async (event, defaultName?: string) => {
        const win = BrowserWindow.fromWebContents(event.sender);
        const options = {
            title: "Export Playlist",
            defaultPath: defaultName && defaultName.trim().length > 0 ? `${defaultName}.fplay` : undefined,
            filters: [{ name: "F-Land Playlist", extensions: ["fplay"] }],
        };
        const result = win
            ? await dialog.showSaveDialog(win, options)
            : await dialog.showSaveDialog(options);

        if (result.canceled) {
            return null;
        }

        const filePath = result.filePath ?? null;
        if (filePath) {
            approveDialogPath("playlistExportFile", filePath);
        }

        return filePath;
    });

    ipcMain.handle("dialog:selectConverterVideoFile", async (event) => {
        const win = BrowserWindow.fromWebContents(event.sender);
        const options: OpenDialogOptions = {
            title: "Select Source Video",
            properties: ["openFile"],
            filters: [
                { name: "Video Files", extensions: SUPPORTED_VIDEO_EXTENSIONS },
                { name: "All Files", extensions: ["*"] },
            ],
        };
        const result = win
            ? await dialog.showOpenDialog(win, options)
            : await dialog.showOpenDialog(options);
        if (result.canceled) return null;
        return result.filePaths[0] ?? null;
    });

    ipcMain.handle("dialog:selectConverterFunscriptFile", async (event) => {
        const win = BrowserWindow.fromWebContents(event.sender);
        const options: OpenDialogOptions = {
            title: "Select Funscript (Optional)",
            properties: ["openFile"],
            filters: [
                { name: "Funscript", extensions: ["funscript", "json"] },
                { name: "All Files", extensions: ["*"] },
            ],
        };
        const result = win
            ? await dialog.showOpenDialog(win, options)
            : await dialog.showOpenDialog(options);
        if (result.canceled) return null;
        return result.filePaths[0] ?? null;
    });
}

function registerAppOpenIpc() {
    ipcMain.handle("app-open:consumePendingFiles", () => {
        appOpenRendererReady = true;
        return pendingOpenedFiles.splice(0, pendingOpenedFiles.length);
    });
}

app.whenReady().then(async () => {
    await ensureAppDatabaseReady();
    registerFileProtocol();
    registerWindowControlsIpc();
    registerDialogIpc();
    registerAppOpenIpc();
    broadcastUpdateState();
    Menu.setApplicationMenu(null);
    createWindow();
    void initializeAppUpdater().catch((error) => {
        console.error("Startup update check failed", error);
    });
    void scanInstallSources("startup").catch((error) => {
        console.error("Startup install scan failed", error);
    });

    app.on("activate", () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
        app.quit();
    }
});
