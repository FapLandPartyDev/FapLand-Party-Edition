import fs from "node:fs/promises";
import path from "node:path";
import {
  DATABASE_BACKUP_ENABLED_KEY,
  DATABASE_BACKUP_FREQUENCY_DAYS_KEY,
  DATABASE_BACKUP_LAST_BACKUP_AT_KEY,
  DATABASE_BACKUP_RETENTION_DAYS_KEY,
  normalizeDatabaseBackupEnabled,
  normalizeDatabaseBackupFrequencyDays,
  normalizeDatabaseBackupRetentionDays,
} from "../../src/constants/databaseBackupSettings";
import { getDb, resolveDatabaseUrl } from "./db";
import { resolveAppStorageBaseDir } from "./appPaths";
import { getStore } from "./store";
import {
  isDatabaseBackupFileName,
  parseFileDatabasePath,
  runDatabaseBackupForClient,
  type DatabaseBackupResult,
} from "./databaseBackupCore";
import { debugLog } from "./debugLogging";

const DAY_MS = 24 * 60 * 60 * 1000;
const INITIAL_BACKUP_CHECK_DELAY_MS = 10_000;
const BACKUP_CHECK_INTERVAL_MS = 30 * 60 * 1000;

let backupTimer: NodeJS.Timeout | null = null;
let initialBackupTimer: NodeJS.Timeout | null = null;
let activeBackupPromise: Promise<DatabaseBackupResult | null> | null = null;
let unsupportedDatabaseWarningShown = false;

function getBackupDir(): string {
  return path.join(resolveAppStorageBaseDir(), "database-backups");
}

export function resolveDatabaseBackupDir(): string {
  return getBackupDir();
}

function getLastBackupMs(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

async function getBackupFileNames(): Promise<string[]> {
  try {
    const entries = await fs.readdir(getBackupDir(), { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && isDatabaseBackupFileName(entry.name))
      .map((entry) => entry.name);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

export async function pruneOldDatabaseBackups(now = new Date()): Promise<number> {
  const store = getStore();
  const retentionDays = normalizeDatabaseBackupRetentionDays(
    store.get(DATABASE_BACKUP_RETENTION_DAYS_KEY)
  );
  const cutoffMs = now.getTime() - retentionDays * DAY_MS;
  const backupDir = getBackupDir();
  const backupFileNames = await getBackupFileNames();
  let deletedBackups = 0;

  for (const fileName of backupFileNames) {
    const filePath = path.join(backupDir, fileName);
    const stats = await fs.stat(filePath);
    if (stats.mtimeMs >= cutoffMs) continue;

    await fs.unlink(filePath);
    deletedBackups += 1;
  }

  return deletedBackups;
}

export async function runDatabaseBackup(now = new Date()): Promise<DatabaseBackupResult | null> {
  const databasePath = parseFileDatabasePath(resolveDatabaseUrl());
  if (!databasePath) {
    if (!unsupportedDatabaseWarningShown) {
      console.warn("Automatic database backups require a local file: SQLite database URL.");
      debugLog.warn("databaseBackup", "Automatic backups skipped for non-file database URL");
      unsupportedDatabaseWarningShown = true;
    }
    return null;
  }

  debugLog.info("databaseBackup", "Database backup started");
  const result = await runDatabaseBackupForClient({
    db: getDb(),
    backupDir: getBackupDir(),
    databaseUrl: resolveDatabaseUrl(),
    now,
    pruneOldBackups: pruneOldDatabaseBackups,
  });
  getStore().set(DATABASE_BACKUP_LAST_BACKUP_AT_KEY, now.toISOString());
  debugLog.info("databaseBackup", "Database backup finished", result);

  return result;
}

export async function runDueDatabaseBackup(now = new Date()): Promise<DatabaseBackupResult | null> {
  if (activeBackupPromise) return activeBackupPromise;

  activeBackupPromise = (async () => {
    const store = getStore();
    const enabled = normalizeDatabaseBackupEnabled(store.get(DATABASE_BACKUP_ENABLED_KEY));
    if (!enabled) return null;

    const frequencyDays = normalizeDatabaseBackupFrequencyDays(
      store.get(DATABASE_BACKUP_FREQUENCY_DAYS_KEY)
    );
    const lastBackupMs = getLastBackupMs(store.get(DATABASE_BACKUP_LAST_BACKUP_AT_KEY));
    if (lastBackupMs !== null && now.getTime() - lastBackupMs < frequencyDays * DAY_MS) {
      await pruneOldDatabaseBackups(now);
      return null;
    }

    return runDatabaseBackup(now);
  })();

  try {
    return await activeBackupPromise;
  } finally {
    activeBackupPromise = null;
  }
}

export function startContinuousDatabaseBackup(): void {
  if (!initialBackupTimer) {
    initialBackupTimer = setTimeout(() => {
      initialBackupTimer = null;
      void runDueDatabaseBackup().catch((error) => {
        console.error("Initial database backup failed:", error);
        debugLog.error("databaseBackup", "Initial database backup failed", error);
      });
    }, INITIAL_BACKUP_CHECK_DELAY_MS);
  }

  if (backupTimer) return;

  backupTimer = setInterval(() => {
    void runDueDatabaseBackup().catch((error) => {
      console.error("Automatic database backup failed:", error);
      debugLog.error("databaseBackup", "Automatic database backup failed", error);
    });
  }, BACKUP_CHECK_INTERVAL_MS);
}

export function stopContinuousDatabaseBackup(): void {
  if (initialBackupTimer) {
    clearTimeout(initialBackupTimer);
    initialBackupTimer = null;
  }
  if (backupTimer) {
    clearInterval(backupTimer);
    backupTimer = null;
  }
}
