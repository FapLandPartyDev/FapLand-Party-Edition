// @vitest-environment node

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getPlaintextSettingsExportPath,
  getSettingsBackupPath,
  isSettingsBackupFileName,
  runSettingsBackupForPath,
  writePlaintextSettingsExportForPath,
} from "./settingsBackupCore";

describe("settings backup core", () => {
  let tempRoot: string;

  beforeEach(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "f-land-settings-backup-core-"));
  });

  afterEach(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  it("generates timestamped json backup paths", () => {
    expect(getSettingsBackupPath("/backups", new Date("2026-04-21T12:34:56.789Z"))).toBe(
      "/backups/f-land-settings-backup-2026-04-21T12-34-56.789Z.json"
    );
    expect(getPlaintextSettingsExportPath("/backups", new Date("2026-04-21T12:34:56.789Z"))).toBe(
      "/backups/f-land-settings-plaintext-2026-04-21T12-34-56.789Z.json"
    );
  });

  it("identifies settings backup filenames", () => {
    expect(isSettingsBackupFileName("f-land-settings-backup-2026-04-21T12-00-00.000Z.json")).toBe(
      true
    );
    expect(isSettingsBackupFileName("f-land-settings-backup-2026-04-21T12-00-00.000Z.db")).toBe(
      false
    );
    expect(isSettingsBackupFileName("f-land-db-backup-2026-04-21T12-00-00.000Z.json")).toBe(false);
  });

  it("copies settings file and prunes old backups", async () => {
    const settingsPath = path.join(tempRoot, "f-land.json");
    const backupDir = path.join(tempRoot, "settings-backups");
    const pruneOldBackups = vi.fn(async () => 2);
    await fs.writeFile(settingsPath, JSON.stringify({ locale: "de" }), "utf8");

    const result = await runSettingsBackupForPath({
      settingsPath,
      backupDir,
      now: new Date("2026-04-21T12:00:00.000Z"),
      pruneOldBackups,
    });

    expect(result).toEqual({
      backupPath: path.join(backupDir, "f-land-settings-backup-2026-04-21T12-00-00.000Z.json"),
      deletedBackups: 2,
    });
    await expect(fs.readFile(result!.backupPath, "utf8")).resolves.toBe('{"locale":"de"}');
    expect(pruneOldBackups).toHaveBeenCalledWith(new Date("2026-04-21T12:00:00.000Z"));
  });

  it("writes decrypted settings as formatted plaintext json", async () => {
    const backupDir = path.join(tempRoot, "settings-backups");

    const result = await writePlaintextSettingsExportForPath({
      settings: { locale: "de", nested: { enabled: true } },
      backupDir,
      now: new Date("2026-04-21T12:00:00.000Z"),
    });

    expect(result).toEqual({
      plaintextPath: path.join(
        backupDir,
        "f-land-settings-plaintext-2026-04-21T12-00-00.000Z.json"
      ),
    });
    await expect(fs.readFile(result.plaintextPath, "utf8")).resolves.toBe(
      '{\n  "locale": "de",\n  "nested": {\n    "enabled": true\n  }\n}\n'
    );
  });

  it("returns null when settings file is missing", async () => {
    await expect(
      runSettingsBackupForPath({
        settingsPath: path.join(tempRoot, "missing.json"),
        backupDir: path.join(tempRoot, "settings-backups"),
        now: new Date("2026-04-21T12:00:00.000Z"),
        pruneOldBackups: vi.fn(async () => 0),
      })
    ).resolves.toBeNull();
  });
});
