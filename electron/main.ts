import {
  app,
  BrowserWindow,
  protocol,
  ipcMain,
  dialog,
  Menu,
  shell,
  session,
  type OpenDialogOptions,
} from "electron";
import path from "node:path";
import { createReadStream } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { createIPCHandler } from "trpc-electron/main";
import { config as loadDotenv } from "dotenv";
import { appRouter } from "./trpc/router";
import { getNodeEnv } from "../src/zod/env";
import { SUPPORTED_VIDEO_EXTENSIONS } from "../src/constants/videoFormats";
import { approveDialogPath } from "./services/dialogPathApproval";
import { normalizeMultiplayerAuthCallback } from "./services/authCallback";
import { ensureAppDatabaseReady } from "./services/db";
import { initStore, getStore } from "./services/store";
import { scanInstallSources } from "./services/installer";
import {
  getPortableDataRoot,
  normalizeUserDataSuffix,
  resolvePortableMovedDataPath,
} from "./services/portable";
import { resolveExistingLocalMediaPath } from "./services/localMedia";
import { initializePortableStorageDefaults } from "./services/storagePaths";
import { proxyExternalRequest } from "./services/integrations";
import { startContinuousPhashScan } from "./services/phashScanService";
import { startContinuousWebsiteVideoScan } from "./services/webVideoScanService";
import { createMediaResponse } from "./services/protocol/mediaResponse";
import { initializeAppUpdater, subscribeToUpdateState } from "./services/updater";
import { subscribeToEroScriptsLoginStatus } from "./services/eroscripts";
import {
  startContinuousDatabaseBackup,
  stopContinuousDatabaseBackup,
} from "./services/databaseBackup";
import {
  downloadMusicFromUrl,
  downloadPlaylistFromUrl,
  isSupportedMusicUrl,
} from "./services/musicDownload";

const OPENABLE_FILE_EXTENSIONS = new Set([".hero", ".round", ".fplay", ".fpack"]);
const pendingOpenedFiles: string[] = [];
const pendingAuthCallbacks: string[] = [];
let appOpenRendererReady = false;
let mainWindowRef: BrowserWindow | null = null;
let rendererDevToolsWindowRef: BrowserWindow | null = null;
let trpcIpcHandler: { attachWindow: (window: BrowserWindow) => void } | null = null;
const WINDOW_ZOOM_STEP = 0.5;

function getWindowZoomPercent(win: BrowserWindow): number {
  return Math.round(win.webContents.getZoomFactor() * 100);
}

function notifyWindowZoomChanged(win: BrowserWindow): number {
  const zoomPercent = getWindowZoomPercent(win);
  win.webContents.send("window:zoom-changed", zoomPercent);
  return zoomPercent;
}

function setWindowZoomLevel(win: BrowserWindow, zoomLevel: number): number {
  win.webContents.setZoomLevel(zoomLevel);
  return notifyWindowZoomChanged(win);
}

function changeWindowZoomLevel(win: BrowserWindow, delta: number): number {
  return setWindowZoomLevel(win, win.webContents.getZoomLevel() + delta);
}

function reportFatalStartupError(error: unknown): void {
  const message =
    error instanceof Error ? `${error.message}\n\n${error.stack ?? ""}` : String(error);
  console.error("Fatal startup error", error);

  try {
    dialog.showErrorBox("Fap Land failed to start", message);
  } catch {
    // Best-effort reporting only.
  }
}

process.on("uncaughtException", (error) => {
  reportFatalStartupError(error);
});

process.on("unhandledRejection", (reason) => {
  reportFatalStartupError(reason);
});

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

const userDataSuffix = normalizeUserDataSuffix(process.env.FLAND_USER_DATA_SUFFIX);
const portableDataRoot = getPortableDataRoot(userDataSuffix);
if (portableDataRoot) {
  app.setPath("userData", portableDataRoot);
  app.setPath("sessionData", path.join(portableDataRoot, "session"));
} else if (userDataSuffix) {
  // Allow running multiple clients on one machine with isolated session/state storage.
  app.setPath("userData", path.join(app.getPath("appData"), `f-land-${userDataSuffix}`));
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
const isDevServerEnabled = Boolean(VITE_DEV_SERVER_URL);
const isDevelopmentToolsEnabled = isDevServerEnabled || env.enableDevFeatures;
const remoteDebuggingPort = env.remoteDebuggingPort ?? (isDevelopmentToolsEnabled ? 9222 : null);
const PACKAGED_RENDERER_ENTRY_URL = "app://renderer/index.html";
const REACT_DEVTOOLS_EXTENSION_ID = "fmkadmapgofadopljbjfkapdkoienihi";

type DevToolsTarget = {
  type?: string;
  title?: string;
  url?: string;
  devtoolsFrontendUrl?: string;
  devtoolsFrontendUrlCompat?: string;
  webSocketDebuggerUrl?: string;
};

if (remoteDebuggingPort !== null) {
  app.commandLine.appendSwitch("remote-debugging-address", "127.0.0.1");
  app.commandLine.appendSwitch("remote-debugging-port", String(remoteDebuggingPort));
}

function getReactDevToolsUserDataRoots(): string[] {
  const home = app.getPath("home");
  const localAppData = process.env.LOCALAPPDATA;

  switch (process.platform) {
    case "darwin":
      return [
        path.join(home, "Library/Application Support/Google/Chrome"),
        path.join(home, "Library/Application Support/Google/Chrome Beta"),
        path.join(home, "Library/Application Support/Chromium"),
        path.join(home, "Library/Application Support/BraveSoftware/Brave-Browser"),
        path.join(home, "Library/Application Support/Microsoft Edge"),
      ];
    case "win32":
      if (!localAppData) return [];
      return [
        path.join(localAppData, "Google/Chrome/User Data"),
        path.join(localAppData, "Google/Chrome Beta/User Data"),
        path.join(localAppData, "Chromium/User Data"),
        path.join(localAppData, "BraveSoftware/Brave-Browser/User Data"),
        path.join(localAppData, "Microsoft/Edge/User Data"),
      ];
    default:
      return [
        path.join(home, ".config/google-chrome"),
        path.join(home, ".config/google-chrome-beta"),
        path.join(home, ".config/chromium"),
        path.join(home, ".config/BraveSoftware/Brave-Browser"),
        path.join(home, ".config/microsoft-edge"),
      ];
  }
}

async function findReactDevToolsExtensionPath(): Promise<string | null> {
  const versionCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

  for (const userDataRoot of getReactDevToolsUserDataRoots()) {
    let profileNames: string[];
    try {
      const entries = await readdir(userDataRoot, { withFileTypes: true });
      profileNames = entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .filter((name) => name === "Default" || name.startsWith("Profile "));
    } catch {
      continue;
    }

    for (const profileName of profileNames.sort((left, right) => {
      if (left === "Default") return -1;
      if (right === "Default") return 1;
      return versionCollator.compare(left, right);
    })) {
      const extensionRoot = path.join(
        userDataRoot,
        profileName,
        "Extensions",
        REACT_DEVTOOLS_EXTENSION_ID
      );

      let versionNames: string[];
      try {
        const versionEntries = await readdir(extensionRoot, { withFileTypes: true });
        versionNames = versionEntries
          .filter((entry) => entry.isDirectory())
          .map((entry) => entry.name)
          .sort((left, right) => versionCollator.compare(right, left));
      } catch {
        continue;
      }

      for (const versionName of versionNames) {
        const manifestPath = path.join(extensionRoot, versionName, "manifest.json");
        try {
          const manifestStat = await stat(manifestPath);
          if (manifestStat.isFile()) {
            return path.join(extensionRoot, versionName);
          }
        } catch {
          // Keep looking through other installed copies.
        }
      }
    }
  }

  return null;
}

async function installReactDevTools(): Promise<void> {
  if (!isDevelopmentToolsEnabled) return;

  const existingExtension = session.defaultSession.getExtension(REACT_DEVTOOLS_EXTENSION_ID);
  if (existingExtension) return;

  const extensionPath = await findReactDevToolsExtensionPath();
  if (!extensionPath) {
    console.warn(
      "React DevTools extension was not found in a local Chrome/Chromium profile. Install it in your browser to enable the React Profiler tab inside Electron DevTools."
    );
    return;
  }

  try {
    await session.defaultSession.loadExtension(extensionPath);
    console.log(`Loaded React DevTools from ${extensionPath}`);
  } catch (error) {
    console.warn("Failed to load React DevTools extension", error);
  }
}

async function logRemoteInspectorUrl(mainWindow: BrowserWindow): Promise<void> {
  if (remoteDebuggingPort === null) return;

  try {
    const response = await fetch(`http://127.0.0.1:${remoteDebuggingPort}/json/list`);
    if (!response.ok) return;

    const targets = (await response.json()) as DevToolsTarget[];
    const currentUrl = mainWindow.webContents.getURL();
    const target =
      targets.find((entry) => entry.type === "page" && entry.url === currentUrl) ??
      targets.find((entry) => entry.type === "page" && entry.title === mainWindow.getTitle()) ??
      targets.find((entry) => entry.type === "page");

    const frontendPath = target?.devtoolsFrontendUrlCompat ?? target?.devtoolsFrontendUrl;
    const wsUrl = target?.webSocketDebuggerUrl;
    const wsPath = wsUrl?.replace(/^ws:\/\/127\.0\.0\.1:\d+/, "127.0.0.1:" + remoteDebuggingPort);

    if (wsPath) {
      console.log(
        `Open this in Chrome for the renderer inspector: devtools://devtools/bundled/inspector.html?ws=${wsPath}`
      );
    }

    if (frontendPath) {
      const inspectorUrl =
        frontendPath.startsWith("http://") || frontendPath.startsWith("https://")
          ? frontendPath
          : `http://127.0.0.1:${remoteDebuggingPort}${frontendPath}`;

      console.log(`Fallback remote inspector URL: ${inspectorUrl}`);
    }
  } catch (error) {
    console.warn("Failed to resolve remote Chrome DevTools frontend URL", error);
  }
}

function showRendererDevTools(mainWindow: BrowserWindow): void {
  if (!isDevelopmentToolsEnabled) return;
  if (mainWindow.isDestroyed()) return;

  let devToolsWindow = rendererDevToolsWindowRef;
  if (!devToolsWindow || devToolsWindow.isDestroyed()) {
    devToolsWindow = new BrowserWindow({
      width: 1280,
      height: 900,
      title: "F-Land DevTools",
      autoHideMenuBar: true,
      show: false,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        devTools: false,
      },
    });
    rendererDevToolsWindowRef = devToolsWindow;

    devToolsWindow.on("closed", () => {
      if (rendererDevToolsWindowRef === devToolsWindow) {
        rendererDevToolsWindowRef = null;
      }

      if (!mainWindow.isDestroyed() && mainWindow.webContents.isDevToolsOpened()) {
        mainWindow.webContents.closeDevTools();
      }
    });
  }

  mainWindow.webContents.setDevToolsWebContents(devToolsWindow.webContents);
  mainWindow.webContents.once("devtools-opened", () => {
    if (!devToolsWindow?.isDestroyed()) {
      devToolsWindow.show();
      devToolsWindow.focus();
    }
  });

  mainWindow.webContents.openDevTools({
    mode: "detach",
    activate: true,
  });

  setTimeout(() => {
    if (mainWindow.isDestroyed()) return;
    console.log(`Renderer DevTools opened: ${mainWindow.webContents.isDevToolsOpened()}`);
  }, 250);
}

function scheduleRendererDevTools(mainWindow: BrowserWindow): void {
  if (!isDevelopmentToolsEnabled) return;

  let opened = false;
  const openOnce = () => {
    if (opened || mainWindow.isDestroyed()) return;
    opened = true;
    showRendererDevTools(mainWindow);
  };

  mainWindow.once("ready-to-show", () => {
    setTimeout(openOnce, 150);
  });

  mainWindow.webContents.once("did-finish-load", () => {
    setTimeout(openOnce, 150);
  });
}

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

  if (ext === ".hero" || ext === ".round" || ext === ".fpack") {
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

  pendingOpenedFiles.push(...normalized);
  flushPendingOpenedFiles();
}

function flushPendingOpenedFiles(): void {
  if (!appOpenRendererReady || !mainWindowRef || mainWindowRef.isDestroyed()) {
    return;
  }

  if (pendingOpenedFiles.length === 0) return;

  mainWindowRef.webContents.send(
    "app-open:files",
    pendingOpenedFiles.splice(0, pendingOpenedFiles.length)
  );
}

function queueAuthCallback(rawUrl: string): void {
  const normalized = normalizeMultiplayerAuthCallback(rawUrl);
  if (!normalized) return;

  if (mainWindowRef && !mainWindowRef.isDestroyed()) {
    mainWindowRef.webContents.send("auth:callback", normalized);
    return;
  }

  pendingAuthCallbacks.push(normalized);
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
  for (const arg of process.argv) {
    queueAuthCallback(arg);
  }

  app.on("second-instance", (_event, argv) => {
    queueOpenedFiles(argv.slice(1));
    for (const arg of argv) {
      queueAuthCallback(arg);
    }
    focusMainWindow();
  });
}

app.on("open-file", (event, filePath) => {
  event.preventDefault();
  queueOpenedFiles([filePath]);
  focusMainWindow();
});

app.on("open-url", (event, url) => {
  event.preventDefault();
  queueAuthCallback(url);
  focusMainWindow();
});

function resolveRendererContentType(filePath: string): string {
  const extension = path.extname(filePath).toLowerCase();

  switch (extension) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".js":
    case ".mjs":
    case ".cjs":
      return "text/javascript; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".json":
    case ".map":
      return "application/json; charset=utf-8";
    case ".svg":
      return "image/svg+xml";
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".gif":
      return "image/gif";
    case ".ico":
      return "image/x-icon";
    case ".webp":
      return "image/webp";
    case ".woff":
      return "font/woff";
    case ".woff2":
      return "font/woff2";
    case ".txt":
    case ".md":
      return "text/plain; charset=utf-8";
    case ".webmanifest":
      return "application/manifest+json; charset=utf-8";
    case ".xml":
      return "application/xml; charset=utf-8";
    default:
      return "application/octet-stream";
  }
}

function resolveRendererPath(url: URL): string | null {
  const decodedPath = decodeURIComponent(url.pathname);
  const normalizedRelativePath = path.posix.normalize(decodedPath);
  const relativePath = normalizedRelativePath === "/" ? "/index.html" : normalizedRelativePath;

  if (
    !relativePath.startsWith("/") ||
    relativePath.includes("\0") ||
    relativePath.startsWith("/..") ||
    relativePath.includes("/../")
  ) {
    return null;
  }

  return path.join(RENDERER_DIST, relativePath.slice(1));
}

async function createRendererResponse(url: URL): Promise<Response> {
  const filePath = resolveRendererPath(url);
  if (!filePath) {
    return new Response("Not found", { status: 404 });
  }

  let fileStats;
  try {
    fileStats = await stat(filePath);
  } catch {
    return new Response("Not found", { status: 404 });
  }

  if (!fileStats.isFile()) {
    return new Response("Not found", { status: 404 });
  }

  const headers = new Headers({
    "Content-Length": `${fileStats.size}`,
    "Content-Type": resolveRendererContentType(filePath),
  });

  const stream = createReadStream(filePath);
  return new Response(Readable.toWeb(stream) as ReadableStream, {
    status: 200,
    headers,
  });
}

function registerFileProtocol(): void {
  protocol.handle("app", async (request: Request) => {
    const url = new URL(request.url);

    if (url.hostname === "external") {
      return proxyExternalRequest(request);
    }

    if (url.hostname === "renderer") {
      return createRendererResponse(url);
    }

    if (url.hostname === "media") {
      const decoded = decodeURIComponent(url.pathname.slice(1));
      const normalizedPath =
        process.platform === "win32" && /^\/[A-Za-z]:/.test(decoded)
          ? path.normalize(decoded.slice(1))
          : path.normalize(decoded);
      const portablePath = resolvePortableMovedDataPath(normalizedPath, userDataSuffix);

      return createMediaResponse(
        resolveExistingLocalMediaPath(portablePath ?? normalizedPath),
        request,
        url.searchParams
      );
    }

    return new Response("Not found", { status: 404 });
  });
}

function isSafeExternalUrl(target: string): boolean {
  try {
    const parsed = new URL(target);
    return (
      parsed.protocol === "http:" || parsed.protocol === "https:" || parsed.protocol === "mailto:"
    );
  } catch {
    return false;
  }
}

function isAllowedNavigationTarget(target: string): boolean {
  try {
    const parsed = new URL(target);

    if (parsed.protocol === "app:") {
      return parsed.hostname === "media" || parsed.hostname === "renderer";
    }

    if (isDevServerEnabled && VITE_DEV_SERVER_URL) {
      const devServerUrl = new URL(VITE_DEV_SERVER_URL);
      return parsed.origin === devServerUrl.origin;
    }

    return parsed.protocol === "file:";
  } catch {
    return false;
  }
}

async function createWindow(): Promise<BrowserWindow> {
  await installReactDevTools();

  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    title: "Fap Land",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: !isDevServerEnabled,
      devTools: isDevelopmentToolsEnabled,
      webSecurity: true,
      allowRunningInsecureContent: false,
      spellcheck: false,
      backgroundThrottling: true,
    },
    backgroundColor: "#050508",
    autoHideMenuBar: true,
  });
  mainWindowRef = mainWindow;
  appOpenRendererReady = false;

  if (!trpcIpcHandler) {
    trpcIpcHandler = createIPCHandler({
      router: appRouter,
      windows: [mainWindow],
      createContext: async ({ event }) => ({ event }),
    });
  } else {
    trpcIpcHandler.attachWindow(mainWindow);
  }

  // Forward renderer console logs to terminal during development
  if (isDevelopmentToolsEnabled) {
    mainWindow.webContents.on("console-message", (details) => {
      console.log(
        `[Renderer Console] ${details.sourceId}:${details.lineNumber} - ${details.message}`
      );
    });
  }

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isSafeExternalUrl(url)) {
      void shell.openExternal(url);
    }

    return { action: "deny" };
  });

  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (isAllowedNavigationTarget(url)) {
      return;
    }

    event.preventDefault();
    if (isSafeExternalUrl(url)) {
      void shell.openExternal(url);
    }
  });

  // Handle zoom shortcuts and F11 fullscreen toggle since we removed the default menu
  mainWindow.webContents.on("before-input-event", (event, input) => {
    if (input.type !== "keyDown") return;

    if (input.key === "F11") {
      mainWindow.setFullScreen(!mainWindow.isFullScreen());
      event.preventDefault();
      return;
    }

    if (
      isDevelopmentToolsEnabled &&
      (input.key === "F12" ||
        (input.control && input.shift && input.key.toLowerCase() === "i") ||
        (input.meta && input.alt && input.key.toLowerCase() === "i"))
    ) {
      if (mainWindow.webContents.isDevToolsOpened()) {
        mainWindow.webContents.closeDevTools();
      } else {
        showRendererDevTools(mainWindow);
      }
      event.preventDefault();
      return;
    }

    if (input.control || input.meta) {
      if (input.key === "=" || input.key === "+") {
        changeWindowZoomLevel(mainWindow, WINDOW_ZOOM_STEP);
        event.preventDefault();
      } else if (input.key === "-") {
        changeWindowZoomLevel(mainWindow, -WINDOW_ZOOM_STEP);
        event.preventDefault();
      } else if (input.key.toLowerCase() === "o" || input.key === "0") {
        setWindowZoomLevel(mainWindow, 0);
        event.preventDefault();
      }
    }
  });

  if (isDevServerEnabled && VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadURL(PACKAGED_RENDERER_ENTRY_URL);
  }

  scheduleRendererDevTools(mainWindow);

  if (remoteDebuggingPort !== null) {
    mainWindow.webContents.once("did-finish-load", () => {
      setTimeout(() => {
        void logRemoteInspectorUrl(mainWindow);
      }, 250);
    });
  }

  mainWindow.on("closed", () => {
    if (rendererDevToolsWindowRef && !rendererDevToolsWindowRef.isDestroyed()) {
      rendererDevToolsWindowRef.close();
      rendererDevToolsWindowRef = null;
    }

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

function broadcastEroScriptsLoginStatus() {
  subscribeToEroScriptsLoginStatus((status) => {
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send("eroscripts:login-status", status);
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

  ipcMain.handle("window:getZoomPercent", (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return 100;
    return getWindowZoomPercent(win);
  });

  ipcMain.handle("window:zoomIn", (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return 100;
    return changeWindowZoomLevel(win, WINDOW_ZOOM_STEP);
  });

  ipcMain.handle("window:zoomOut", (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return 100;
    return changeWindowZoomLevel(win, -WINDOW_ZOOM_STEP);
  });

  ipcMain.handle("window:resetZoom", (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return 100;
    return setWindowZoomLevel(win, 0);
  });

  ipcMain.handle("window:close", (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return false;
    win.close();
    return true;
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
        { name: "F-Land Import Files", extensions: ["hero", "round", "fplay", "fpack"] },
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
      defaultPath:
        defaultName && defaultName.trim().length > 0 ? `${defaultName}.fplay` : undefined,
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

  ipcMain.handle("dialog:selectPlaylistExportDirectory", async (event, defaultName?: string) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const options: OpenDialogOptions = {
      title:
        defaultName && defaultName.trim().length > 0
          ? `Choose export folder for ${defaultName}`
          : "Choose export folder",
      properties: ["openDirectory", "createDirectory"],
    };
    const result = win
      ? await dialog.showOpenDialog(win, options)
      : await dialog.showOpenDialog(options);

    if (result.canceled) {
      return null;
    }

    const directoryPath = result.filePaths[0] ?? null;
    if (directoryPath) {
      approveDialogPath("playlistExportDirectory", directoryPath);
    }

    return directoryPath;
  });

  ipcMain.handle("dialog:selectFpackExtractionDirectory", async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const options: OpenDialogOptions = {
      title: "Choose fpack extraction folder",
      properties: ["openDirectory", "createDirectory"],
    };
    const result = win
      ? await dialog.showOpenDialog(win, options)
      : await dialog.showOpenDialog(options);

    if (result.canceled) {
      return null;
    }

    return result.filePaths[0] ?? null;
  });

  ipcMain.handle("dialog:selectWebsiteVideoCacheDirectory", async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const options: OpenDialogOptions = {
      title: "Choose website video cache folder",
      properties: ["openDirectory", "createDirectory"],
    };
    const result = win
      ? await dialog.showOpenDialog(win, options)
      : await dialog.showOpenDialog(options);

    if (result.canceled) {
      return null;
    }

    return result.filePaths[0] ?? null;
  });

  ipcMain.handle("dialog:selectEroScriptsCacheDirectory", async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const options: OpenDialogOptions = {
      title: "Choose EroScripts download cache folder",
      properties: ["openDirectory", "createDirectory"],
    };
    const result = win
      ? await dialog.showOpenDialog(win, options)
      : await dialog.showOpenDialog(options);

    if (result.canceled) {
      return null;
    }

    return result.filePaths[0] ?? null;
  });

  ipcMain.handle("dialog:selectMusicCacheDirectory", async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const options: OpenDialogOptions = {
      title: "Choose music cache folder",
      properties: ["openDirectory", "createDirectory"],
    };
    const result = win
      ? await dialog.showOpenDialog(win, options)
      : await dialog.showOpenDialog(options);

    if (result.canceled) {
      return null;
    }

    return result.filePaths[0] ?? null;
  });

  ipcMain.handle("dialog:selectMoaningCacheDirectory", async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const options: OpenDialogOptions = {
      title: "Choose moaning cache folder",
      properties: ["openDirectory", "createDirectory"],
    };
    const result = win
      ? await dialog.showOpenDialog(win, options)
      : await dialog.showOpenDialog(options);

    if (result.canceled) {
      return null;
    }

    return result.filePaths[0] ?? null;
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

  ipcMain.handle("dialog:selectMusicFiles", async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const options: OpenDialogOptions = {
      title: "Select Music Files",
      properties: ["openFile", "multiSelections"],
      filters: [
        { name: "Audio Files", extensions: ["mp3", "m4a", "aac", "ogg", "wav", "flac"] },
        { name: "All Files", extensions: ["*"] },
      ],
    };
    const result = win
      ? await dialog.showOpenDialog(win, options)
      : await dialog.showOpenDialog(options);
    if (result.canceled) return [] as string[];
    return result.filePaths;
  });

  ipcMain.handle("dialog:selectMoaningFiles", async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const options: OpenDialogOptions = {
      title: "Select Moaning Files",
      properties: ["openFile", "multiSelections"],
      filters: [
        { name: "Audio Files", extensions: ["mp3", "m4a", "aac", "ogg", "wav", "flac"] },
        { name: "All Files", extensions: ["*"] },
      ],
    };
    const result = win
      ? await dialog.showOpenDialog(win, options)
      : await dialog.showOpenDialog(options);
    if (result.canceled) return [] as string[];
    return result.filePaths;
  });

  ipcMain.handle("music:addFromUrl", async (_event, url: string) => {
    const trimmedUrl = url.trim();
    if (!trimmedUrl) {
      throw new Error("URL is required.");
    }
    if (!isSupportedMusicUrl(trimmedUrl)) {
      throw new Error("Unsupported URL. Only HTTP(S) URLs supported by yt-dlp are allowed.");
    }
    const result = await downloadMusicFromUrl(trimmedUrl);
    return { filePath: result.filePath, title: result.title };
  });

  ipcMain.handle("music:addPlaylistFromUrl", async (_event, url: string) => {
    const trimmedUrl = url.trim();
    if (!trimmedUrl) {
      throw new Error("URL is required.");
    }
    if (!isSupportedMusicUrl(trimmedUrl)) {
      throw new Error("Unsupported URL. Only HTTP(S) URLs supported by yt-dlp are allowed.");
    }
    const result = await downloadPlaylistFromUrl(trimmedUrl);
    return {
      playlistTitle: result.playlistTitle,
      totalTracks: result.totalTracks,
      tracks: result.tracks,
      errors: result.errors,
    };
  });

  ipcMain.handle("moaning:addFromUrl", async (_event, url: string) => {
    const trimmedUrl = url.trim();
    if (!trimmedUrl) {
      throw new Error("URL is required.");
    }
    if (!isSupportedMusicUrl(trimmedUrl)) {
      throw new Error("Unsupported URL. Only HTTP(S) URLs supported by yt-dlp are allowed.");
    }
    const result = await downloadMusicFromUrl(trimmedUrl);
    return { filePath: result.filePath, title: result.title };
  });

  ipcMain.handle("moaning:addPlaylistFromUrl", async (_event, url: string) => {
    const trimmedUrl = url.trim();
    if (!trimmedUrl) {
      throw new Error("URL is required.");
    }
    if (!isSupportedMusicUrl(trimmedUrl)) {
      throw new Error("Unsupported URL. Only HTTP(S) URLs supported by yt-dlp are allowed.");
    }
    const result = await downloadPlaylistFromUrl(trimmedUrl);
    return {
      playlistTitle: result.playlistTitle,
      totalTracks: result.totalTracks,
      tracks: result.tracks,
      errors: result.errors,
    };
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
    return pendingOpenedFiles.splice(0, pendingOpenedFiles.length);
  });
  ipcMain.handle("app-open:renderer-ready", () => {
    appOpenRendererReady = true;
    flushPendingOpenedFiles();
  });
}

function registerAuthCallbackIpc() {
  ipcMain.handle("auth:consumePendingCallback", () => {
    return pendingAuthCallbacks.shift() ?? null;
  });
}

app
  .whenReady()
  .then(async () => {
    if (remoteDebuggingPort !== null) {
      console.log(
        `Chrome DevTools remote debugging available on http://127.0.0.1:${remoteDebuggingPort}`
      );
    }

    app.setAsDefaultProtocolClient("fland");
    await initStore();
    initializePortableStorageDefaults(getStore());
    await ensureAppDatabaseReady();
    registerFileProtocol();
    registerWindowControlsIpc();
    registerDialogIpc();
    registerAppOpenIpc();
    registerAuthCallbackIpc();
    broadcastUpdateState();
    broadcastEroScriptsLoginStatus();
    Menu.setApplicationMenu(null);
    await createWindow();
    void initializeAppUpdater().catch((error) => {
      console.error("Startup update check failed", error);
    });
    void scanInstallSources("startup").catch((error) => {
      console.error("Startup install scan failed", error);
    });
    startContinuousPhashScan();
    startContinuousWebsiteVideoScan();
    startContinuousDatabaseBackup();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        void createWindow();
      }
    });
  })
  .catch((error) => {
    reportFatalStartupError(error);
    app.quit();
  });

app.on("window-all-closed", () => {
  stopContinuousDatabaseBackup();
  if (process.platform !== "darwin") {
    app.quit();
  }
});
