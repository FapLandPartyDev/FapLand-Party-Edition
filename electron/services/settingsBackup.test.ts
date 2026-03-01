// @vitest-environment node

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DATABASE_BACKUP_ENABLED_KEY,
  DATABASE_BACKUP_FREQUENCY_DAYS_KEY,
  DATABASE_BACKUP_RETENTION_DAYS_KEY,
  SETTINGS_BACKUP_LAST_BACKUP_AT_KEY,
} from "../../src/constants/databaseBackupSettings";

const { debugLogMock, getStoreMock, resolveSettingsStorePathMock, appStorageBaseDir } = vi.hoisted(
  () => ({
    debugLogMock: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    },
    getStoreMock: vi.fn(),
    resolveSettingsStorePathMock: vi.fn(),
    appStorageBaseDir: { value: "" },
  })
);

vi.mock("./debugLogging", () => ({
  debugLog: debugLogMock,
}));

vi.mock("./appPaths", () => ({
  resolveAppStorageBaseDir: () => appStorageBaseDir.value,
}));

vi.mock("./store", () => ({
  getStore: getStoreMock,
  resolveSettingsStorePath: resolveSettingsStorePathMock,
}));

import {
  pruneOldSettingsBackups,
  resolveSettingsBackupDir,
  runDueSettingsBackup,
  runSettingsBackup,
} from "./settingsBackup";

describe("settings backup service", () => {
  let tempRoot: string;
  let settingsPath: string;
  let storeData: Record<string, unknown>;
  let store: { get: ReturnType<typeof vi.fn>; set: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    vi.clearAllMocks();
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "f-land-settings-backup-"));
    appStorageBaseDir.value = tempRoot;
    settingsPath = path.join(tempRoot, "f-land.json");
    await fs.writeFile(settingsPath, JSON.stringify({ volume: 0.5 }), "utf8");
    storeData = {};
    store = {
      get: vi.fn((key: string) => storeData[key]),
      set: vi.fn((key: string, value: unknown) => {
        storeData[key] = value;
      }),
    };
    getStoreMock.mockReturnValue(store);
    resolveSettingsStorePathMock.mockReturnValue(settingsPath);
  });

  afterEach(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  it("resolves the settings backup directory", () => {
    expect(resolveSettingsBackupDir()).toBe(path.join(tempRoot, "settings-backups"));
  });

  it("runs a backup and writes the independent last backup timestamp", async () => {
    const now = new Date("2026-04-21T12:00:00.000Z");

    const result = await runSettingsBackup(now);

    expect(result?.backupPath).toBe(
      path.join(
        tempRoot,
        "settings-backups",
        "f-land-settings-backup-2026-04-21T12-00-00.000Z.json"
      )
    );
    expect(store.set).toHaveBeenCalledWith(SETTINGS_BACKUP_LAST_BACKUP_AT_KEY, now.toISOString());
    await expect(fs.readFile(result!.backupPath, "utf8")).resolves.toBe('{"volume":0.5}');
  });

  it("uses shared database backup settings and skips when disabled", async () => {
    storeData[DATABASE_BACKUP_ENABLED_KEY] = false;

    await expect(runDueSettingsBackup(new Date("2026-04-21T12:00:00.000Z"))).resolves.toBeNull();

    await expect(fs.readdir(path.join(tempRoot, "settings-backups"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("skips when the last backup is newer than the shared frequency", async () => {
    storeData[DATABASE_BACKUP_ENABLED_KEY] = true;
    storeData[DATABASE_BACKUP_FREQUENCY_DAYS_KEY] = 2;
    storeData[SETTINGS_BACKUP_LAST_BACKUP_AT_KEY] = "2026-04-20T12:00:00.000Z";

    await expect(runDueSettingsBackup(new Date("2026-04-21T12:00:00.000Z"))).resolves.toBeNull();

    await expect(fs.readdir(path.join(tempRoot, "settings-backups"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("runs when due", async () => {
    storeData[DATABASE_BACKUP_ENABLED_KEY] = true;
    storeData[DATABASE_BACKUP_FREQUENCY_DAYS_KEY] = 1;
    storeData[SETTINGS_BACKUP_LAST_BACKUP_AT_KEY] = "2026-04-20T11:59:59.000Z";

    const result = await runDueSettingsBackup(new Date("2026-04-21T12:00:00.000Z"));

    expect(result?.backupPath).toContain("f-land-settings-backup-2026-04-21T12-00-00.000Z.json");
  });

  it("prunes old settings backups without touching unrelated files", async () => {
    storeData[DATABASE_BACKUP_RETENTION_DAYS_KEY] = 7;
    const backupDir = path.join(tempRoot, "settings-backups");
    await fs.mkdir(backupDir, { recursive: true });
    const oldBackup = path.join(backupDir, "f-land-settings-backup-2026-04-01T12-00-00.000Z.json");
    const freshBackup = path.join(
      backupDir,
      "f-land-settings-backup-2026-04-20T12-00-00.000Z.json"
    );
    const unrelatedFile = path.join(backupDir, "notes.json");
    await fs.writeFile(oldBackup, "old", "utf8");
    await fs.writeFile(freshBackup, "fresh", "utf8");
    await fs.writeFile(unrelatedFile, "notes", "utf8");
    await fs.utimes(
      oldBackup,
      new Date("2026-04-01T12:00:00.000Z"),
      new Date("2026-04-01T12:00:00.000Z")
    );
    await fs.utimes(
      freshBackup,
      new Date("2026-04-20T12:00:00.000Z"),
      new Date("2026-04-20T12:00:00.000Z")
    );
    await fs.utimes(
      unrelatedFile,
      new Date("2026-04-01T12:00:00.000Z"),
      new Date("2026-04-01T12:00:00.000Z")
    );

    await expect(pruneOldSettingsBackups(new Date("2026-04-21T12:00:00.000Z"))).resolves.toBe(1);

    await expect(fs.access(oldBackup)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(fs.readFile(freshBackup, "utf8")).resolves.toBe("fresh");
    await expect(fs.readFile(unrelatedFile, "utf8")).resolves.toBe("notes");
  });
});
