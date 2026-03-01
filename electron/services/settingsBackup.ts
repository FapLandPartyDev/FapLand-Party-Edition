import fs from "node:fs/promises";
import path from "node:path";
import {
  DATABASE_BACKUP_ENABLED_KEY,
  DATABASE_BACKUP_FREQUENCY_DAYS_KEY,
  DATABASE_BACKUP_RETENTION_DAYS_KEY,
  SETTINGS_BACKUP_LAST_BACKUP_AT_KEY,
  normalizeDatabaseBackupEnabled,
  normalizeDatabaseBackupFrequencyDays,
  normalizeDatabaseBackupRetentionDays,
} from "../../src/constants/databaseBackupSettings";
import { resolveAppStorageBaseDir } from "./appPaths";
import { getStore, resolveSettingsStorePath } from "./store";
import {
  isSettingsBackupFileName,
  runSettingsBackupForPath,
  type SettingsBackupResult,
} from "./settingsBackupCore";
import { debugLog } from "./debugLogging";

const DAY_MS = 24 * 60 * 60 * 1000;
const INITIAL_BACKUP_CHECK_DELAY_MS = 10_000;
const BACKUP_CHECK_INTERVAL_MS = 30 * 60 * 1000;

let backupTimer: NodeJS.Timeout | null = null;
let initialBackupTimer: NodeJS.Timeout | null = null;
let activeBackupPromise: Promise<SettingsBackupResult | null> | null = null;
let unavailableSettingsWarningShown = false;

function getBackupDir(): string {
  return path.join(resolveAppStorageBaseDir(), "settings-backups");
}

export function resolveSettingsBackupDir(): string {
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
      .filter((entry) => entry.isFile() && isSettingsBackupFileName(entry.name))
      .map((entry) => entry.name);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

export async function pruneOldSettingsBackups(now = new Date()): Promise<number> {
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

export async function runSettingsBackup(now = new Date()): Promise<SettingsBackupResult | null> {
  debugLog.info("settingsBackup", "Settings backup started");
  const result = await runSettingsBackupForPath({
    settingsPath: resolveSettingsStorePath(),
    backupDir: getBackupDir(),
    now,
    pruneOldBackups: pruneOldSettingsBackups,
  });

  if (!result) {
    if (!unavailableSettingsWarningShown) {
      console.warn("Automatic settings backup skipped because the settings file is unavailable.");
      debugLog.warn(
        "settingsBackup",
        "Settings backup skipped because settings file is unavailable"
      );
      unavailableSettingsWarningShown = true;
    }
    return null;
  }

  getStore().set(SETTINGS_BACKUP_LAST_BACKUP_AT_KEY, now.toISOString());
  debugLog.info("settingsBackup", "Settings backup finished", result);

  return result;
}

export async function runDueSettingsBackup(now = new Date()): Promise<SettingsBackupResult | null> {
  if (activeBackupPromise) return activeBackupPromise;

  activeBackupPromise = (async () => {
    const store = getStore();
    const enabled = normalizeDatabaseBackupEnabled(store.get(DATABASE_BACKUP_ENABLED_KEY));
    if (!enabled) return null;

    const frequencyDays = normalizeDatabaseBackupFrequencyDays(
      store.get(DATABASE_BACKUP_FREQUENCY_DAYS_KEY)
    );
    const lastBackupMs = getLastBackupMs(store.get(SETTINGS_BACKUP_LAST_BACKUP_AT_KEY));
    if (lastBackupMs !== null && now.getTime() - lastBackupMs < frequencyDays * DAY_MS) {
      await pruneOldSettingsBackups(now);
      return null;
    }

    return runSettingsBackup(now);
  })();

  try {
    return await activeBackupPromise;
  } finally {
    activeBackupPromise = null;
  }
}

export function startContinuousSettingsBackup(): void {
  if (!initialBackupTimer) {
    initialBackupTimer = setTimeout(() => {
      initialBackupTimer = null;
      void runDueSettingsBackup().catch((error) => {
        console.error("Initial settings backup failed:", error);
        debugLog.error("settingsBackup", "Initial settings backup failed", error);
      });
    }, INITIAL_BACKUP_CHECK_DELAY_MS);
  }

  if (backupTimer) return;

  backupTimer = setInterval(() => {
    void runDueSettingsBackup().catch((error) => {
      console.error("Automatic settings backup failed:", error);
      debugLog.error("settingsBackup", "Automatic settings backup failed", error);
    });
  }, BACKUP_CHECK_INTERVAL_MS);
}

export function stopContinuousSettingsBackup(): void {
  if (initialBackupTimer) {
    clearTimeout(initialBackupTimer);
    initialBackupTimer = null;
  }
  if (backupTimer) {
    clearInterval(backupTimer);
    backupTimer = null;
  }
}
