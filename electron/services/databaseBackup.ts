import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
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

const BACKUP_FILE_PREFIX = "f-land-db-backup-";
const BACKUP_FILE_SUFFIX = ".db";
const DAY_MS = 24 * 60 * 60 * 1000;
const INITIAL_BACKUP_CHECK_DELAY_MS = 10_000;
const BACKUP_CHECK_INTERVAL_MS = 30 * 60 * 1000;

let backupTimer: NodeJS.Timeout | null = null;
let initialBackupTimer: NodeJS.Timeout | null = null;
let activeBackupPromise: Promise<DatabaseBackupResult | null> | null = null;
let unsupportedDatabaseWarningShown = false;

export type DatabaseBackupResult = {
  backupPath: string;
  deletedBackups: number;
};

function toSafeIsoTimestamp(date: Date): string {
  return date.toISOString().replaceAll(":", "-");
}

function sqlStringLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function getBackupDir(): string {
  return path.join(resolveAppStorageBaseDir(), "database-backups");
}

export function resolveDatabaseBackupDir(): string {
  return getBackupDir();
}

function getBackupPath(date: Date): string {
  return path.join(
    getBackupDir(),
    `${BACKUP_FILE_PREFIX}${toSafeIsoTimestamp(date)}${BACKUP_FILE_SUFFIX}`
  );
}

function parseFileDatabasePath(databaseUrl: string): string | null {
  if (!databaseUrl.startsWith("file:")) return null;

  const rawPath = databaseUrl.slice("file:".length);
  if (rawPath === ":memory:") return null;
  if (rawPath.startsWith("//")) {
    return fileURLToPath(databaseUrl);
  }
  return path.resolve(rawPath);
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
      .filter(
        (entry) =>
          entry.isFile() &&
          entry.name.startsWith(BACKUP_FILE_PREFIX) &&
          entry.name.endsWith(BACKUP_FILE_SUFFIX)
      )
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
      unsupportedDatabaseWarningShown = true;
    }
    return null;
  }

  await fs.access(databasePath);
  const backupDir = getBackupDir();
  const backupPath = getBackupPath(now);
  await fs.mkdir(backupDir, { recursive: true });

  await getDb().$client.execute(`VACUUM INTO ${sqlStringLiteral(backupPath)}`);
  getStore().set(DATABASE_BACKUP_LAST_BACKUP_AT_KEY, now.toISOString());

  const deletedBackups = await pruneOldDatabaseBackups(now);
  return { backupPath, deletedBackups };
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
      });
    }, INITIAL_BACKUP_CHECK_DELAY_MS);
  }

  if (backupTimer) return;

  backupTimer = setInterval(() => {
    void runDueDatabaseBackup().catch((error) => {
      console.error("Automatic database backup failed:", error);
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
