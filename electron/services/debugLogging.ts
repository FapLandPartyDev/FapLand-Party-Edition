import { app } from "electron";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  DEBUG_LOG_LEVEL_KEY,
  DEBUG_LOG_MAX_FILE_SIZE_MB_KEY,
  DEFAULT_DEBUG_LOG_LEVEL,
  DEFAULT_DEBUG_LOG_MAX_FILE_SIZE_MB,
  normalizeDebugLogLevel,
  normalizeDebugLogMaxFileSizeMb,
  type DebugLogLevel,
} from "../../src/constants/debugSettings";
import {
  DATABASE_BACKUP_ENABLED_KEY,
  DATABASE_BACKUP_FREQUENCY_DAYS_KEY,
  DATABASE_BACKUP_RETENTION_DAYS_KEY,
  normalizeDatabaseBackupEnabled,
  normalizeDatabaseBackupFrequencyDays,
  normalizeDatabaseBackupRetentionDays,
} from "../../src/constants/databaseBackupSettings";
import { VIDEOHASH_FFMPEG_SOURCE_PREFERENCE_KEY } from "../../src/constants/videohashSettings";
import { YT_DLP_BINARY_PREFERENCE_KEY } from "../../src/constants/ytDlpSettings";
import { WEBSITE_VIDEO_CACHE_ROOT_PATH_KEY } from "../../src/constants/websiteVideoCacheSettings";
import { MUSIC_CACHE_ROOT_PATH_KEY } from "../../src/constants/musicSettings";
import { EROSCRIPTS_CACHE_ROOT_PATH_KEY } from "../../src/constants/eroscriptsSettings";
import { FPACK_EXTRACTION_PATH_KEY } from "../../src/constants/fpackSettings";
import { UPDATE_CHANNEL_KEY } from "../../src/constants/updateSettings";
import { resolveAppStorageBaseDir } from "./appPaths";
import { parseFileDatabasePath } from "./databaseBackupCore";
import { getDb, resolveDatabaseUrl } from "./db";
import { getStore } from "./store";
import { isPortableMode, normalizeUserDataSuffix } from "./portable";
import { getRendererPerformanceState } from "./rendererPerformance";
import { getGpuDiagnosticsSnapshot } from "./gpuDiagnostics";
import { getPhashScanStatus } from "./phashScanService";
import { getWebsiteVideoScanStatus } from "./webVideoScanService";
import { getInstallScanStatus } from "./installer";
import {
  getConfiguredVideoHashBinaryPreference,
  resetPhashBinariesCache,
  resolvePhashBinaries,
} from "./phash/binaries";
import {
  getConfiguredYtDlpBinaryPreference,
  resetYtDlpBinaryCache,
  resolveYtDlpBinary,
} from "./webVideo/binaries";
import {
  getCpuInfo,
  getGraphicsInfo,
  getMemInfo,
  getOsInfo,
} from "./systemInfoCache";

export type DebugLogEntry = {
  ts: string;
  level: Exclude<DebugLogLevel, "off">;
  source: string;
  message: string;
  data?: unknown;
};

export type DebugDiagnostics = {
  collectedAtIso: string;
  app: Record<string, unknown>;
  storage: Record<string, unknown>;
  hardware: Record<string, unknown>;
  database: Record<string, unknown>;
  runtime: Record<string, unknown>;
  collectionErrors: string[];
};

export type DebugLoggingOptions = {
  logFilePath?: string;
  maxBytes?: number;
  rotatedFiles?: number;
};

const RECENT_LOG_LINES = 300;
const levelRank: Record<DebugLogLevel, number> = {
  off: 0,
  error: 1,
  warn: 2,
  info: 3,
  debug: 4,
};

let activeLogLevel: DebugLogLevel = DEFAULT_DEBUG_LOG_LEVEL;
let activeMaxFileSizeMb: number = DEFAULT_DEBUG_LOG_MAX_FILE_SIZE_MB;
let options: DebugLoggingOptions = {};
let writeQueue: Promise<void> = Promise.resolve();

function getMaxBytes(): number {
  if (options.maxBytes != null) return options.maxBytes;
  return activeMaxFileSizeMb * 1024 * 1024;
}

export function configureDebugLoggingForTests(nextOptions: DebugLoggingOptions): void {
  options = nextOptions;
  activeLogLevel = DEFAULT_DEBUG_LOG_LEVEL;
  writeQueue = Promise.resolve();
}

export function getDebugLogFilePath(): string {
  return options.logFilePath ?? path.join(resolveAppStorageBaseDir(), "logs", "f-land.log");
}

async function pruneLogFile(logFilePath: string): Promise<void> {
  const maxBytes = getMaxBytes();
  const stats = await fs.stat(logFilePath).catch(() => null);
  if (!stats || stats.size < maxBytes) return;

  const content = await fs.readFile(logFilePath, "utf8");
  const lines = content.split("\n");
  let totalBytes = Buffer.byteLength(content, "utf8");
  let pruneFrom = 0;

  while (totalBytes > maxBytes * 0.8 && pruneFrom < lines.length - 1) {
    totalBytes -= Buffer.byteLength(lines[pruneFrom] + "\n", "utf8");
    pruneFrom += 1;
  }

  if (pruneFrom > 0) {
    await fs.writeFile(logFilePath, lines.slice(pruneFrom).join("\n"), "utf8");
  }
}

function shouldLog(level: DebugLogEntry["level"]): boolean {
  return levelRank[activeLogLevel] >= levelRank[level];
}

export function getDebugLogLevel(): DebugLogLevel {
  return activeLogLevel;
}

export function initializeDebugLogging(): void {
  try {
    const store = getStore();
    activeLogLevel = normalizeDebugLogLevel(store.get(DEBUG_LOG_LEVEL_KEY));
    activeMaxFileSizeMb = normalizeDebugLogMaxFileSizeMb(store.get(DEBUG_LOG_MAX_FILE_SIZE_MB_KEY));
  } catch {
    activeLogLevel = DEFAULT_DEBUG_LOG_LEVEL;
    activeMaxFileSizeMb = DEFAULT_DEBUG_LOG_MAX_FILE_SIZE_MB;
  }
}

export function setDebugLogLevel(level: DebugLogLevel): void {
  activeLogLevel = normalizeDebugLogLevel(level);
  getStore().set(DEBUG_LOG_LEVEL_KEY, activeLogLevel);
}

export function getDebugLogMaxFileSizeMb(): number {
  return activeMaxFileSizeMb;
}

export function setDebugLogMaxFileSizeMb(mb: number): void {
  activeMaxFileSizeMb = normalizeDebugLogMaxFileSizeMb(mb);
  getStore().set(DEBUG_LOG_MAX_FILE_SIZE_MB_KEY, activeMaxFileSizeMb);
}

function serializeError(error: Error): Record<string, unknown> {
  return {
    name: error.name,
    message: error.message,
    stack: error.stack,
  };
}

function normalizeLogData(data: unknown): unknown {
  if (data instanceof Error) return serializeError(data);
  return data;
}

async function appendEntry(entry: DebugLogEntry): Promise<void> {
  const logFilePath = getDebugLogFilePath();
  await fs.mkdir(path.dirname(logFilePath), { recursive: true });
  await pruneLogFile(logFilePath);
  const sanitized = sanitizeForPublicDebug(entry);
  await fs.appendFile(logFilePath, `${JSON.stringify(sanitized)}\n`, "utf8");
}

function enqueueEntry(entry: DebugLogEntry): void {
  if (!shouldLog(entry.level)) return;
  writeQueue = writeQueue.then(() => appendEntry(entry)).catch(() => undefined);
}

export const debugLog = {
  error(source: string, message: string, data?: unknown): void {
    enqueueEntry({
      ts: new Date().toISOString(),
      level: "error",
      source,
      message,
      data: normalizeLogData(data),
    });
  },
  warn(source: string, message: string, data?: unknown): void {
    enqueueEntry({
      ts: new Date().toISOString(),
      level: "warn",
      source,
      message,
      data: normalizeLogData(data),
    });
  },
  info(source: string, message: string, data?: unknown): void {
    enqueueEntry({
      ts: new Date().toISOString(),
      level: "info",
      source,
      message,
      data: normalizeLogData(data),
    });
  },
  debug(source: string, message: string, data?: unknown): void {
    enqueueEntry({
      ts: new Date().toISOString(),
      level: "debug",
      source,
      message,
      data: normalizeLogData(data),
    });
  },
};

export async function flushDebugLog(): Promise<void> {
  await writeQueue;
}

function stableHash(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex").slice(0, 8);
}

function getUsername(): string {
  try {
    return os.userInfo().username;
  } catch {
    return "";
  }
}

function redactPath(value: string): string {
  let next = value;
  next = next.replace(/\/home\/([^/\s]+)/g, "/home/<user>");
  next = next.replace(/\/Users\/([^/\s]+)/g, "/Users/<user>");
  next = next.replace(/[A-Za-z]:\\Users\\([^\\\s]+)/g, (match) =>
    match.replace(/Users\\[^\\\s]+/i, "Users\\<user>")
  );

  const unixMatch = next.match(/^(\/(?:home|Users)\/<user>\/)(.+\/)?([^/]+)$/);
  if (unixMatch) {
    const middle = unixMatch[2]?.replace(/\/$/u, "") ?? "";
    return `${unixMatch[1]}${middle ? `<path:${stableHash(middle)}>/` : ""}${unixMatch[3]}`;
  }

  const winMatch = next.match(/^([A-Za-z]:\\Users\\<user>\\)(.+\\)?([^\\]+)$/);
  if (winMatch) {
    const middle = winMatch[2]?.replace(/\\$/u, "") ?? "";
    return `${winMatch[1]}${middle ? `<path:${stableHash(middle)}>\\` : ""}${winMatch[3]}`;
  }

  return next;
}

function sanitizeString(value: string): string {
  let next = value;
  const username = getUsername();
  if (username) {
    next = next.replaceAll(username, "<user>");
  }
  next = redactPath(next);
  next = next.replace(/\bhttps?:\/\/[^\s"'<>]+/gi, (url) => {
    try {
      const parsed = new URL(url);
      const privateIp =
        /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(parsed.hostname) &&
        parsed.hostname !== "127.0.0.1";
      if (privateIp) parsed.hostname = "<private-ip>";
      parsed.search = parsed.search ? "?<redacted>" : "";
      parsed.hash = "";
      return parsed.toString();
    } catch {
      return url.replace(/[?#].*$/u, "?<redacted>");
    }
  });
  next = next.replace(
    /\b(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)\d{1,3}\.\d{1,3}\b/g,
    "<private-ip>"
  );
  next = next.replace(/\b([A-Z0-9._%+-]{16,}|[a-f0-9]{24,}|sk-[A-Za-z0-9_-]+)\b/g, "<redacted>");
  return next;
}

function isSensitiveKey(key: string): boolean {
  return /(token|api.?key|authorization|cookie|password|passwd|secret|session|machine.?id|serial|refresh|access)/i.test(
    key
  );
}

export function sanitizeForPublicDebug<T = unknown>(value: T): T {
  if (typeof value === "string") return sanitizeString(value) as T;
  if (typeof value === "number" || typeof value === "boolean" || value == null) return value;
  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeForPublicDebug(entry)) as T;
  }
  if (value instanceof Date) return value.toISOString() as T;
  if (typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      result[key] = isSensitiveKey(key) ? "<redacted>" : sanitizeForPublicDebug(entry);
    }
    return result as T;
  }
  return String(value) as T;
}

async function getFileSize(filePath: string): Promise<number> {
  const stats = await fs.stat(filePath).catch(() => null);
  return stats?.size ?? 0;
}

function getDatabaseUrlKind(databaseUrl: string): "file" | "remote/libsql" | "custom" {
  if (databaseUrl.startsWith("file:")) return "file";
  if (databaseUrl.startsWith("libsql:") || databaseUrl.startsWith("http")) return "remote/libsql";
  return "custom";
}

async function getDatabaseDiagnostics(
  collectionErrors: string[]
): Promise<Record<string, unknown>> {
  const databaseUrl = resolveDatabaseUrl();
  const databasePath = parseFileDatabasePath(databaseUrl);
  const db = getDb();
  const result: Record<string, unknown> = {
    urlKind: getDatabaseUrlKind(databaseUrl),
    path: databasePath ? sanitizeForPublicDebug(databasePath) : null,
    fileSizeBytes: databasePath ? await getFileSize(databasePath) : null,
  };

  try {
    const migrations = await db.$client.execute(
      `SELECT hash, created_at FROM "__drizzle_migrations" ORDER BY created_at DESC`
    );
    const latest = migrations.rows[0] as Record<string, unknown> | undefined;
    result.migrations = {
      count: migrations.rows.length,
      latestCreatedAt: latest?.created_at ?? null,
      latestHashPrefix:
        typeof latest?.hash === "string" ? latest.hash.slice(0, 12) : (latest?.hash ?? null),
    };
  } catch (error) {
    collectionErrors.push(`database migrations: ${error instanceof Error ? error.message : error}`);
  }

  for (const [key, sql] of Object.entries({
    userVersion: "PRAGMA user_version",
    journalMode: "PRAGMA journal_mode",
    quickCheck: "PRAGMA quick_check",
  })) {
    try {
      const rows = (await db.$client.execute(sql)).rows;
      result[key] = rows[0] ?? null;
    } catch (error) {
      collectionErrors.push(`${key}: ${error instanceof Error ? error.message : error}`);
    }
  }

  try {
    const tables = await db.$client.execute(
      `SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`
    );
    result.tables = await Promise.all(
      tables.rows.map(async (row) => {
        const tableName = String((row as Record<string, unknown>).name);
        const [countRows, columns, indexes] = await Promise.all([
          db.$client.execute(`SELECT COUNT(*) AS count FROM "${tableName}"`).catch(() => ({
            rows: [{ count: null }],
          })),
          db.$client.execute(`PRAGMA table_info("${tableName}")`).catch(() => ({ rows: [] })),
          db.$client.execute(`PRAGMA index_list("${tableName}")`).catch(() => ({ rows: [] })),
        ]);
        const countRow = countRows.rows[0] as Record<string, unknown> | undefined;
        return {
          name: tableName,
          rowCount: countRow?.count ?? null,
          columns: columns.rows.map((column) => {
            const typed = column as Record<string, unknown>;
            return { name: typed.name, type: typed.type, notNull: typed.notnull === 1 };
          }),
          indexes: indexes.rows.map((index) => {
            const typed = index as Record<string, unknown>;
            return { name: typed.name, unique: typed.unique === 1 };
          }),
        };
      })
    );
  } catch (error) {
    collectionErrors.push(`database schema: ${error instanceof Error ? error.message : error}`);
  }

  return result;
}

async function getBinaryDiagnostics(): Promise<Record<string, unknown>> {
  const ffmpegPreference = getConfiguredVideoHashBinaryPreference();
  const ytDlpPreference = getConfiguredYtDlpBinaryPreference();
  resetPhashBinariesCache();
  resetYtDlpBinaryCache();
  const [phash, ytDlp] = await Promise.allSettled([
    resolvePhashBinaries(ffmpegPreference),
    resolveYtDlpBinary(ytDlpPreference),
  ]);
  return sanitizeForPublicDebug({
    ffmpeg:
      phash.status === "fulfilled"
        ? {
            preference: ffmpegPreference,
            source: phash.value.source,
            path: phash.value.ffmpegPath,
            version: phash.value.ffmpegVersion,
          }
        : { preference: ffmpegPreference, error: String(phash.reason) },
    ffprobe:
      phash.status === "fulfilled"
        ? {
            preference: ffmpegPreference,
            source: phash.value.source,
            path: phash.value.ffprobePath,
            version: phash.value.ffprobeVersion,
          }
        : { preference: ffmpegPreference, error: String(phash.reason) },
    ytDlp:
      ytDlp.status === "fulfilled"
        ? {
            preference: ytDlpPreference,
            source: ytDlp.value.source,
            path: ytDlp.value.ytDlpPath,
            version: ytDlp.value.version,
          }
        : { preference: ytDlpPreference, error: String(ytDlp.reason) },
  });
}

export async function getDebugState(): Promise<{
  logLevel: DebugLogLevel;
  logFilePath: string;
  anonymizedLogFilePath: string;
  logFileExists: boolean;
  logFileSizeBytes: number;
  maxFileSizeMb: number;
}> {
  const logFilePath = getDebugLogFilePath();
  const stats = await fs.stat(logFilePath).catch(() => null);
  return {
    logLevel: activeLogLevel,
    logFilePath,
    anonymizedLogFilePath: sanitizeForPublicDebug(logFilePath),
    logFileExists: Boolean(stats),
    logFileSizeBytes: stats?.size ?? 0,
    maxFileSizeMb: activeMaxFileSizeMb,
  };
}

export async function collectDebugDiagnostics(): Promise<DebugDiagnostics> {
  const collectionErrors: string[] = [];
  const store = getStore();
  const logFilePath = getDebugLogFilePath();
  const databaseUrl = resolveDatabaseUrl();
  const databasePath = parseFileDatabasePath(databaseUrl);

  const [cpu, mem, osInfo, graphics] = await Promise.all([
    (async () => {
      const value = await getCpuInfo();
      if (value === null) collectionErrors.push("cpu: unavailable");
      return value;
    })(),
    (async () => {
      const value = await getMemInfo();
      if (value === null) collectionErrors.push("memory: unavailable");
      return value;
    })(),
    (async () => {
      const value = await getOsInfo();
      if (value === null) collectionErrors.push("os: unavailable");
      return value;
    })(),
    (async () => {
      const g = await getGraphicsInfo();
      if (!g) collectionErrors.push("graphics: unavailable");
      return g;
    })(),
  ]);

  const diagnostics: DebugDiagnostics = {
    collectedAtIso: new Date().toISOString(),
    app: sanitizeForPublicDebug({
      name: app.getName?.() ?? "Fap Land",
      version: app.getVersion?.() ?? null,
      isPackaged: app.isPackaged,
      buildProfile: process.env.FLAND_BUILD_PROFILE ?? null,
      devServerEnabled: Boolean(process.env.VITE_DEV_SERVER_URL),
      devFeaturesEnabled: process.env.FLAND_ENABLE_DEV_FEATURES === "true",
      remoteDebuggingEnabled: Boolean(process.env.FLAND_REMOTE_DEBUGGING_PORT),
      remoteDebuggingPort: process.env.FLAND_REMOTE_DEBUGGING_PORT ?? null,
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node,
      v8: process.versions.v8,
      platform: process.platform,
      arch: process.arch,
      uptimeSec: Math.round(process.uptime()),
      locale: app.getLocale?.() ?? null,
    }),
    storage: sanitizeForPublicDebug({
      portable: isPortableMode(),
      userDataSuffixSet: Boolean(normalizeUserDataSuffix(process.env.FLAND_USER_DATA_SUFFIX)),
      userDataPath: app.getPath("userData"),
      sessionDataPath: app.getPath("sessionData"),
      appPath: app.getAppPath(),
      resourcesPath: process.resourcesPath,
      databaseUrlKind: getDatabaseUrlKind(databaseUrl),
      databasePath,
      databaseFileSizeBytes: databasePath ? await getFileSize(databasePath) : null,
      logFilePath,
      logFileSizeBytes: await getFileSize(logFilePath),
    }),
    hardware: sanitizeForPublicDebug({
      cpu: cpu
        ? {
            manufacturer: cpu.manufacturer,
            brand: cpu.brand,
            physicalCores: cpu.physicalCores,
            cores: cpu.cores,
            speed: cpu.speed,
          }
        : null,
      memory: mem ? { total: mem.total, free: mem.free, available: mem.available } : null,
      os: osInfo
        ? {
            distro: osInfo.distro,
            release: osInfo.release,
            build: osInfo.build,
            kernel: osInfo.kernel,
          }
        : null,
      graphics: graphics
        ? {
            controllers: graphics.controllers.map((controller) => ({
              vendor: controller.vendor,
              model: controller.model,
              vram: controller.vram,
              driverVersion: controller.driverVersion,
            })),
            displays: graphics.displays.map((display) => ({
              currentResX: display.currentResX,
              currentResY: display.currentResY,
              resolutionX: display.resolutionX,
              resolutionY: display.resolutionY,
            })),
          }
        : null,
    }),
    database: {},
    runtime: {},
    collectionErrors,
  };

  diagnostics.database = sanitizeForPublicDebug(await getDatabaseDiagnostics(collectionErrors));

  diagnostics.runtime = sanitizeForPublicDebug({
    logLevel: activeLogLevel,
    rendererPerformanceState: getRendererPerformanceState(),
    gpuDiagnostics: getGpuDiagnosticsSnapshot(),
    appMetrics: app.getAppMetrics().map((metric, index) => ({
      process: metric.type,
      label: `${metric.type}-${index + 1}`,
      cpu: metric.cpu,
      memory: metric.memory,
    })),
    updateChannel: store.get(UPDATE_CHANNEL_KEY),
    binaryPreferences: {
      videoHashFfmpeg: store.get(VIDEOHASH_FFMPEG_SOURCE_PREFERENCE_KEY),
      ytDlp: store.get(YT_DLP_BINARY_PREFERENCE_KEY),
    },
    binaries: await getBinaryDiagnostics().catch((error) => ({
      error: error instanceof Error ? error.message : String(error),
    })),
    scanners: {
      phash: getPhashScanStatus(),
      websiteVideo: getWebsiteVideoScanStatus(),
      install: getInstallScanStatus(),
    },
    backup: {
      enabled: normalizeDatabaseBackupEnabled(store.get(DATABASE_BACKUP_ENABLED_KEY)),
      frequencyDays: normalizeDatabaseBackupFrequencyDays(
        store.get(DATABASE_BACKUP_FREQUENCY_DAYS_KEY)
      ),
      retentionDays: normalizeDatabaseBackupRetentionDays(
        store.get(DATABASE_BACKUP_RETENTION_DAYS_KEY)
      ),
      databaseDirectory: path.join(resolveAppStorageBaseDir(), "database-backups"),
      settingsDirectory: path.join(resolveAppStorageBaseDir(), "settings-backups"),
    },
    cacheRoots: {
      websiteVideo: store.get(WEBSITE_VIDEO_CACHE_ROOT_PATH_KEY),
      music: store.get(MUSIC_CACHE_ROOT_PATH_KEY),
      eroscripts: store.get(EROSCRIPTS_CACHE_ROOT_PATH_KEY),
      fpack: store.get(FPACK_EXTRACTION_PATH_KEY),
    },
  });

  return sanitizeForPublicDebug(diagnostics);
}

export async function readRecentSanitizedLogLines(maxLines = RECENT_LOG_LINES): Promise<string[]> {
  const logFilePath = getDebugLogFilePath();
  try {
    const content = await fs.readFile(logFilePath, "utf8");
    return content
      .trimEnd()
      .split(/\r?\n/u)
      .slice(-maxLines)
      .map((line) => sanitizeForPublicDebug(line));
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return code === "ENOENT"
      ? []
      : [
          `<failed to read log: ${sanitizeForPublicDebug(error instanceof Error ? error.message : String(error))}>`,
        ];
  }
}

function formatTimestampForFilename(date: Date): string {
  return date
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/u, "Z");
}

export async function createDebugBundle(): Promise<{
  filename: string;
  mimeType: "text/plain";
  content: string;
}> {
  const diagnostics = await collectDebugDiagnostics();
  const recentLogs = await readRecentSanitizedLogLines();
  const content = [
    "# Fap Land Debug Bundle",
    "",
    "## Diagnostics",
    JSON.stringify(sanitizeForPublicDebug(diagnostics), null, 2),
    "",
    "## Recent Logs",
    recentLogs.length > 0 ? recentLogs.join("\n") : "<no current log file entries>",
    "",
  ].join("\n");

  return {
    filename: `f-land-debug-${formatTimestampForFilename(new Date())}.txt`,
    mimeType: "text/plain",
    content: sanitizeForPublicDebug(content),
  };
}

export function getAllSettingsSanitized(): Record<string, unknown> {
  const store = getStore();
  const raw = store.store as Record<string, unknown>;
  return sanitizeForPublicDebug(raw) as Record<string, unknown>;
}

export async function clearDebugLogFile(): Promise<void> {
  const logFilePath = getDebugLogFilePath();
  await fs.mkdir(path.dirname(logFilePath), { recursive: true });
  await fs.truncate(logFilePath, 0).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error;
  });
}
