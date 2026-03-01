import fs from "node:fs/promises";
import path from "node:path";

const BACKUP_FILE_PREFIX = "f-land-settings-backup-";
const BACKUP_FILE_SUFFIX = ".json";

export type SettingsBackupResult = {
  backupPath: string;
  deletedBackups: number;
};

function toSafeIsoTimestamp(date: Date): string {
  return date.toISOString().replaceAll(":", "-");
}

export function getSettingsBackupPath(backupDir: string, date: Date): string {
  return path.join(
    backupDir,
    `${BACKUP_FILE_PREFIX}${toSafeIsoTimestamp(date)}${BACKUP_FILE_SUFFIX}`
  );
}

export function isSettingsBackupFileName(fileName: string): boolean {
  return fileName.startsWith(BACKUP_FILE_PREFIX) && fileName.endsWith(BACKUP_FILE_SUFFIX);
}

function isRecoverableAccessError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException).code;
  return code === "ENOENT" || code === "EACCES" || code === "EPERM";
}

export async function runSettingsBackupForPath({
  settingsPath,
  backupDir,
  now,
  pruneOldBackups,
}: {
  settingsPath: string;
  backupDir: string;
  now: Date;
  pruneOldBackups: (now: Date) => Promise<number>;
}): Promise<SettingsBackupResult | null> {
  try {
    await fs.access(settingsPath);
  } catch (error) {
    if (isRecoverableAccessError(error)) return null;
    throw error;
  }

  const backupPath = getSettingsBackupPath(backupDir, now);
  await fs.mkdir(backupDir, { recursive: true });
  await fs.copyFile(settingsPath, backupPath);

  const deletedBackups = await pruneOldBackups(now);
  return { backupPath, deletedBackups };
}
