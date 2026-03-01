import { createClient } from "@libsql/client";
import { app } from "electron";
import fs from "node:fs/promises";
import path from "node:path";
import { resolveAppStorageBaseDir } from "./appPaths";
import { getDb, ensureAppDatabaseReady, resetAppDatabaseState, resolveDatabaseUrl } from "./db";
import { parseFileDatabasePath, runDatabaseBackupForClient } from "./databaseBackupCore";
import { runSettingsBackupForPath } from "./settingsBackupCore";
import { resolveSettingsStorePath } from "./store";

const DATABASE_BACKUP_DIR = "database-backups";
const SETTINGS_BACKUP_DIR = "settings-backups";
const DATABASE_SIDECAR_SUFFIXES = ["", "-wal", "-shm"] as const;
const RECOVERABLE_CACHE_NAMES = [
  "Cache",
  "Code Cache",
  "GPUCache",
  "DawnCache",
  "DawnGraphiteCache",
  "DawnWebGPUCache",
  "web-video-cache",
  "playable-video-cache",
  "music-cache",
  "moaning-cache",
  "fpacks",
  "eroscripts-cache",
] as const;

export type StartupRecoveryStatus = {
  databasePath: string | null;
  databaseExists: boolean;
  databaseBytes: number | null;
  integrity: "ok" | "missing" | "unavailable" | "corrupt";
  integrityMessage: string;
};

function safeTimestamp(now = new Date()): string {
  return now.toISOString().replaceAll(":", "-");
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function getLocalDatabasePath(): string | null {
  return parseFileDatabasePath(resolveDatabaseUrl());
}

async function runIntegrityCheck(databasePath: string): Promise<string[]> {
  const client = createClient({ url: `file:${databasePath}` });
  try {
    const result = await client.execute("PRAGMA quick_check");
    return result.rows.map((row) => String(row.quick_check ?? Object.values(row)[0] ?? ""));
  } finally {
    client.close();
  }
}

export async function getStartupRecoveryStatus(): Promise<StartupRecoveryStatus> {
  const databasePath = getLocalDatabasePath();
  if (!databasePath) {
    return {
      databasePath: null,
      databaseExists: false,
      databaseBytes: null,
      integrity: "unavailable",
      integrityMessage: "Recovery requires a local SQLite database.",
    };
  }
  if (!(await exists(databasePath))) {
    return {
      databasePath,
      databaseExists: false,
      databaseBytes: null,
      integrity: "missing",
      integrityMessage: "No database exists yet. A new one will be created on startup.",
    };
  }

  const stats = await fs.stat(databasePath);
  try {
    const rows = await runIntegrityCheck(databasePath);
    const ok = rows.length === 1 && rows[0]?.toLowerCase() === "ok";
    return {
      databasePath,
      databaseExists: true,
      databaseBytes: stats.size,
      integrity: ok ? "ok" : "corrupt",
      integrityMessage: ok ? "Database integrity check passed." : rows.join("; "),
    };
  } catch (error) {
    return {
      databasePath,
      databaseExists: true,
      databaseBytes: stats.size,
      integrity: "corrupt",
      integrityMessage: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function backupDatabaseForRecovery(now = new Date()): Promise<string> {
  const databaseUrl = resolveDatabaseUrl();
  const databasePath = parseFileDatabasePath(databaseUrl);
  if (!databasePath || !(await exists(databasePath))) {
    throw new Error("No local database is available to back up.");
  }

  const client = createClient({ url: databaseUrl });
  try {
    const result = await runDatabaseBackupForClient({
      db: { $client: client },
      backupDir: path.join(resolveAppStorageBaseDir(), DATABASE_BACKUP_DIR),
      databaseUrl,
      now,
      pruneOldBackups: async () => 0,
    });
    if (!result) throw new Error("The database could not be backed up.");
    return result.backupPath;
  } finally {
    client.close();
  }
}

export async function repairDatabaseForRecovery(): Promise<{
  backupPath: string;
  integrityMessage: string;
}> {
  const databasePath = getLocalDatabasePath();
  if (!databasePath || !(await exists(databasePath))) {
    throw new Error("No local database is available to repair.");
  }

  const integrityRows = await runIntegrityCheck(databasePath);
  if (integrityRows.length !== 1 || integrityRows[0]?.toLowerCase() !== "ok") {
    throw new Error(
      `Database integrity check failed. The original was not changed: ${integrityRows.join("; ")}`
    );
  }

  const backupPath = await backupDatabaseForRecovery();
  resetAppDatabaseState();
  await ensureAppDatabaseReady();
  const database = getDb();
  await database.$client.execute("REINDEX");
  await database.$client.execute("PRAGMA optimize");
  await database.$client.execute("VACUUM");

  return { backupPath, integrityMessage: "Database repaired, migrated, and optimized." };
}

export async function clearRecoveryCaches(): Promise<{ clearedPaths: number }> {
  const roots = new Set([app.getPath("userData"), app.getPath("sessionData")]);
  const paths = [...roots].flatMap((root) =>
    RECOVERABLE_CACHE_NAMES.map((name) => path.join(root, name))
  );
  await Promise.all(paths.map((cachePath) => fs.rm(cachePath, { recursive: true, force: true })));
  return { clearedPaths: paths.length };
}

export async function resetSettingsForRecovery(now = new Date()): Promise<{
  backupPath: string | null;
}> {
  const settingsPath = resolveSettingsStorePath();
  const backup = await runSettingsBackupForPath({
    settingsPath,
    backupDir: path.join(resolveAppStorageBaseDir(), SETTINGS_BACKUP_DIR),
    now,
    pruneOldBackups: async () => 0,
  });
  await fs.rm(settingsPath, { force: true });
  await fs.rm(path.join(path.dirname(settingsPath), "store-key.json"), { force: true });
  return { backupPath: backup?.backupPath ?? null };
}

async function archiveDatabaseBundle(databasePath: string, now = new Date()): Promise<string> {
  const archiveDir = path.join(
    resolveAppStorageBaseDir(),
    DATABASE_BACKUP_DIR,
    `recovery-original-${safeTimestamp(now)}`
  );
  await fs.mkdir(archiveDir, { recursive: true });
  for (const suffix of DATABASE_SIDECAR_SUFFIXES) {
    const source = `${databasePath}${suffix}`;
    if (await exists(source)) await fs.copyFile(source, path.join(archiveDir, `dev.db${suffix}`));
  }
  return archiveDir;
}

export async function resetInstallationForRecovery(options: {
  keepDatabase: boolean;
}): Promise<{ databaseArchivePath: string | null }> {
  if (!app.isPackaged) {
    throw new Error("Full installation reset is disabled in development builds.");
  }

  const storageRoot = resolveAppStorageBaseDir();
  const databasePath = getLocalDatabasePath();
  // Close any client left behind by a failed/partial normal startup before
  // copying WAL state or replacing files (especially important on Windows).
  resetAppDatabaseState();
  const databaseArchivePath =
    databasePath && (await exists(databasePath)) ? await archiveDatabaseBundle(databasePath) : null;
  const preservedPaths = new Set([
    path.join(storageRoot, DATABASE_BACKUP_DIR),
    path.join(storageRoot, SETTINGS_BACKUP_DIR),
  ]);
  if (options.keepDatabase && databasePath) {
    for (const suffix of DATABASE_SIDECAR_SUFFIXES) preservedPaths.add(`${databasePath}${suffix}`);
  }

  const entries = await fs.readdir(storageRoot, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = path.join(storageRoot, entry.name);
    if (preservedPaths.has(entryPath)) continue;
    await fs.rm(entryPath, { recursive: true, force: true });
  }

  if (
    !options.keepDatabase &&
    databasePath &&
    !databasePath.startsWith(`${storageRoot}${path.sep}`)
  ) {
    for (const suffix of DATABASE_SIDECAR_SUFFIXES) {
      await fs.rm(`${databasePath}${suffix}`, { force: true });
    }
  }
  return { databaseArchivePath };
}
