// @vitest-environment node

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@libsql/client";

let storageRoot = "";

vi.mock("electron", () => ({
  app: {
    isPackaged: true,
    getPath: () => storageRoot,
  },
}));

vi.mock("./db", () => ({
  ensureAppDatabaseReady: vi.fn(async () => {}),
  getDb: vi.fn(),
  resetAppDatabaseState: vi.fn(),
  resolveDatabaseUrl: () => `file:${path.join(storageRoot, "dev.db")}`,
}));

import {
  listDatabaseBackups,
  resetInstallationForRecovery,
  restoreDatabaseBackup,
} from "./startupRecovery";

describe("startup recovery installation reset", () => {
  beforeEach(async () => {
    storageRoot = await fs.mkdtemp(path.join(os.tmpdir(), "f-land-recovery-"));
    await fs.writeFile(path.join(storageRoot, "dev.db"), "database-v0506");
    await fs.writeFile(path.join(storageRoot, "dev.db-wal"), "pending-wal");
    await fs.writeFile(path.join(storageRoot, "config.json"), '{"broken":true}');
    await fs.mkdir(path.join(storageRoot, "GPUCache"));
    await fs.writeFile(path.join(storageRoot, "GPUCache", "cache.bin"), "cache");
  });

  afterEach(async () => {
    await fs.rm(storageRoot, { recursive: true, force: true });
  });

  it("clears faulty installation state while preserving the live database and an archive", async () => {
    const result = await resetInstallationForRecovery({ keepDatabase: true });

    await expect(fs.readFile(path.join(storageRoot, "dev.db"), "utf8")).resolves.toBe(
      "database-v0506"
    );
    await expect(fs.readFile(path.join(storageRoot, "dev.db-wal"), "utf8")).resolves.toBe(
      "pending-wal"
    );
    await expect(fs.access(path.join(storageRoot, "config.json"))).rejects.toThrow();
    await expect(fs.access(path.join(storageRoot, "GPUCache"))).rejects.toThrow();
    expect(result.databaseArchivePath).not.toBeNull();
    await expect(
      fs.readFile(path.join(result.databaseArchivePath!, "dev.db"), "utf8")
    ).resolves.toBe("database-v0506");
  });

  it("archives the old database before a factory reset removes it", async () => {
    const result = await resetInstallationForRecovery({ keepDatabase: false });

    await expect(fs.access(path.join(storageRoot, "dev.db"))).rejects.toThrow();
    await expect(fs.access(path.join(storageRoot, "dev.db-wal"))).rejects.toThrow();
    await expect(
      fs.readFile(path.join(result.databaseArchivePath!, "dev.db"), "utf8")
    ).resolves.toBe("database-v0506");
    await expect(
      fs.readFile(path.join(result.databaseArchivePath!, "dev.db-wal"), "utf8")
    ).resolves.toBe("pending-wal");
  });

  it("restores a verified managed backup and preserves a safety copy", async () => {
    const databasePath = path.join(storageRoot, "dev.db");
    await fs.rm(databasePath, { force: true });
    const activeClient = createClient({ url: `file:${databasePath}` });
    await activeClient.execute("CREATE TABLE records (value TEXT NOT NULL)");
    await activeClient.execute("INSERT INTO records VALUES ('current')");
    activeClient.close();

    const backupDir = path.join(storageRoot, "database-backups");
    await fs.mkdir(backupDir, { recursive: true });
    const backupId = "f-land-db-backup-2026-08-05T10-00-00.000Z.db";
    const backupPath = path.join(backupDir, backupId);
    const backupClient = createClient({ url: `file:${backupPath}` });
    await backupClient.execute("CREATE TABLE records (value TEXT NOT NULL)");
    await backupClient.execute("INSERT INTO records VALUES ('legacy')");
    backupClient.close();

    const backups = await listDatabaseBackups();
    expect(backups).toMatchObject([{ id: backupId, integrity: "ok" }]);

    const result = await restoreDatabaseBackup(backupId);
    expect(result.restoredBackupId).toBe(backupId);
    await expect(fs.stat(result.safetyBackupPath)).resolves.toMatchObject({
      size: expect.any(Number),
    });

    const restoredClient = createClient({ url: `file:${databasePath}` });
    const restored = await restoredClient.execute("SELECT value FROM records");
    restoredClient.close();
    expect(restored.rows[0]?.value).toBe("legacy");
  });

  it("rejects backup identifiers outside the managed backup directory", async () => {
    await expect(restoreDatabaseBackup("../dev.db")).rejects.toThrow(
      "Invalid database backup identifier"
    );
  });
});
