import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { resolveDatabaseUrl } from "./db";
import { parseFileDatabasePath } from "./databaseBackupCore";
import { getStore } from "./store";
import {
  resolveConfiguredStoragePath,
  WEBSITE_VIDEO_CACHE_RELATIVE_PATH,
  MUSIC_CACHE_RELATIVE_PATH,
  EROSCRIPTS_CACHE_RELATIVE_PATH,
  FPACK_EXTRACTION_RELATIVE_PATH,
} from "./storagePaths";
import { isPortableMode } from "./portable";

export type StoragePathEntry = {
  storeKey: string;
  relativeName: string;
};

export const MIGRATABLE_STORAGE_PATHS: StoragePathEntry[] = [
  {
    storeKey: "webVideo.cacheRootPath",
    relativeName: WEBSITE_VIDEO_CACHE_RELATIVE_PATH,
  },
  {
    storeKey: "music.cacheRootPath",
    relativeName: MUSIC_CACHE_RELATIVE_PATH,
  },
  {
    storeKey: "eroscripts.cacheRootPath",
    relativeName: EROSCRIPTS_CACHE_RELATIVE_PATH,
  },
  {
    storeKey: "fpack.extractionPath",
    relativeName: FPACK_EXTRACTION_RELATIVE_PATH,
  },
];

export type MigrationPathResult = {
  storeKey: string;
  relativeName: string;
  sourcePath: string;
  targetPath: string;
  copiedFiles: number;
};

export type MigratePathsResult = {
  migrated: MigrationPathResult[];
  skipped: Array<{ storeKey: string; reason: string }>;
  originalsDeleted: boolean;
};

export type DetectPortableResult = {
  valid: boolean;
  reason?: string;
  exePath?: string;
  dataRoot?: string;
  databasePath?: string;
  existingDatabaseExists: boolean;
};

export type MigrateToPortableResult = {
  migratedCaches: MigrationPathResult[];
  skippedCaches: Array<{ storeKey: string; reason: string }>;
  databaseMigrated: boolean;
  databaseBackupPath?: string;
  storeConfigMigrated: boolean;
};

async function copyDirectoryRecursive(
  source: string,
  target: string
): Promise<{ copiedFiles: number }> {
  await fs.mkdir(target, { recursive: true });
  let copiedFiles = 0;

  const entries = await fs.readdir(source, { withFileTypes: true });
  for (const entry of entries) {
    const sourcePath = path.join(source, entry.name);
    const targetPath = path.join(target, entry.name);
    if (entry.isDirectory()) {
      const sub = await copyDirectoryRecursive(sourcePath, targetPath);
      copiedFiles += sub.copiedFiles;
    } else {
      await fs.copyFile(sourcePath, targetPath);
      copiedFiles += 1;
    }
  }

  return { copiedFiles };
}

async function directoryExists(dirPath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(dirPath);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(filePath);
    return stat.isFile();
  } catch {
    return false;
  }
}

export async function migratePathsToTarget(
  targetDirectory: string,
  deleteOriginals: boolean
): Promise<MigratePathsResult> {
  if (isPortableMode()) {
    throw new Error("Path migration is not available in portable mode.");
  }

  await fs.mkdir(targetDirectory, { recursive: true });

  const store = getStore();
  const migrated: MigrationPathResult[] = [];
  const skipped: Array<{ storeKey: string; reason: string }> = [];

  for (const entry of MIGRATABLE_STORAGE_PATHS) {
    const currentPath = resolveConfiguredStoragePath(store.get(entry.storeKey), entry.relativeName);

    const sourceExists = await directoryExists(currentPath);
    if (!sourceExists) {
      skipped.push({
        storeKey: entry.storeKey,
        reason: `Source directory does not exist: ${currentPath}`,
      });
      continue;
    }

    const targetPath = path.join(targetDirectory, entry.relativeName);
    const { copiedFiles } = await copyDirectoryRecursive(currentPath, targetPath);

    store.set(entry.storeKey, targetPath);
    migrated.push({
      storeKey: entry.storeKey,
      relativeName: entry.relativeName,
      sourcePath: currentPath,
      targetPath,
      copiedFiles,
    });
  }

  let originalsDeleted = false;
  if (deleteOriginals && migrated.length > 0) {
    for (const result of migrated) {
      try {
        await fs.rm(result.sourcePath, { recursive: true, force: true });
      } catch {
        // Best-effort deletion
      }
    }
    originalsDeleted = true;
  }

  return { migrated, skipped, originalsDeleted };
}

export function detectPortableInstallation(directory: string): DetectPortableResult {
  if (isPortableMode()) {
    return {
      valid: false,
      reason: "Already running in portable mode.",
      existingDatabaseExists: false,
    };
  }

  if (process.platform !== "win32") {
    return {
      valid: false,
      reason: "Portable mode is only available on Windows.",
      existingDatabaseExists: false,
    };
  }

  const normalizedDir = path.resolve(directory.trim());

  const possibleExecutables = [
    path.join(normalizedDir, "Fap Land.exe"),
    path.join(normalizedDir, "fap-land.exe"),
    path.join(normalizedDir, "FapLand.exe"),
    path.join(normalizedDir, "fapland.exe"),
  ];

  const dataRoot = path.join(normalizedDir, "data");
  const databasePath = path.join(normalizedDir, "dev.db");

  let exePath: string | undefined;
  for (const candidate of possibleExecutables) {
    if (path.normalize(candidate).startsWith(normalizedDir)) {
      exePath = candidate;
      break;
    }
  }

  const hasDataDirectory = fsSync.existsSync(dataRoot) && fsSync.statSync(dataRoot).isDirectory();

  if (!exePath && !hasDataDirectory) {
    return {
      valid: false,
      reason:
        "No portable installation detected. The directory must contain the F-Land executable or a data/ folder.",
      existingDatabaseExists: false,
    };
  }

  const existingDatabaseExists = fsSync.existsSync(databasePath);

  return {
    valid: true,
    exePath: exePath ?? undefined,
    dataRoot,
    databasePath,
    existingDatabaseExists,
  };
}

export async function migrateToPortable(
  portableDirectory: string
): Promise<MigrateToPortableResult> {
  if (isPortableMode()) {
    throw new Error("Cannot migrate to portable while already in portable mode.");
  }

  const detection = detectPortableInstallation(portableDirectory);
  if (!detection.valid || !detection.dataRoot || !detection.databasePath) {
    throw new Error(detection.reason ?? "Invalid portable installation directory.");
  }

  const store = getStore();
  const { dataRoot, databasePath } = detection;

  await fs.mkdir(dataRoot, { recursive: true });

  // Step 1: Backup existing portable database if present
  let databaseBackupPath: string | undefined;
  if (detection.existingDatabaseExists) {
    const timestamp = new Date().toISOString().replaceAll(":", "-");
    databaseBackupPath = `${databasePath}.migration-backup-${timestamp}`;
    await fs.copyFile(databasePath, databaseBackupPath);
    // Also backup WAL/SHM if present
    for (const suffix of ["-wal", "-shm"]) {
      const srcPath = `${databasePath}${suffix}`;
      if (fsSync.existsSync(srcPath)) {
        await fs.copyFile(srcPath, `${databaseBackupPath}${suffix}`);
      }
    }
  }

  // Step 2: Copy cache directories
  const migratedCaches: MigrationPathResult[] = [];
  const skippedCaches: Array<{ storeKey: string; reason: string }> = [];

  for (const entry of MIGRATABLE_STORAGE_PATHS) {
    const currentPath = resolveConfiguredStoragePath(store.get(entry.storeKey), entry.relativeName);

    const sourceExists = await directoryExists(currentPath);
    if (!sourceExists) {
      skippedCaches.push({
        storeKey: entry.storeKey,
        reason: `Source directory does not exist: ${currentPath}`,
      });
      continue;
    }

    const targetPath = path.join(dataRoot, entry.relativeName);
    const { copiedFiles } = await copyDirectoryRecursive(currentPath, targetPath);

    store.set(entry.storeKey, entry.relativeName);
    migratedCaches.push({
      storeKey: entry.storeKey,
      relativeName: entry.relativeName,
      sourcePath: currentPath,
      targetPath,
      copiedFiles,
    });
  }

  // Step 3: Copy the database
  const databaseUrl = resolveDatabaseUrl();
  const currentDatabasePath = parseFileDatabasePath(databaseUrl);
  let databaseMigrated = false;

  if (currentDatabasePath && (await fileExists(currentDatabasePath))) {
    await fs.copyFile(currentDatabasePath, databasePath);
    for (const suffix of ["-wal", "-shm"]) {
      const srcPath = `${currentDatabasePath}${suffix}`;
      if (fsSync.existsSync(srcPath)) {
        await fs.copyFile(srcPath, `${databasePath}${suffix}`);
      }
    }
    databaseMigrated = true;
  }

  // Step 4: Copy store config
  let storeConfigMigrated = false;
  try {
    const storePath = (store as unknown as { path: string }).path;
    if (storePath && (await fileExists(storePath))) {
      const targetConfigPath = path.join(dataRoot, path.basename(storePath));
      await fs.copyFile(storePath, targetConfigPath);
      storeConfigMigrated = true;
    }
  } catch {
    // Best-effort
  }

  return {
    migratedCaches,
    skippedCaches,
    databaseMigrated,
    databaseBackupPath,
    storeConfigMigrated,
  };
}
