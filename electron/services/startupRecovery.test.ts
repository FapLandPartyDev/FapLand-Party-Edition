// @vitest-environment node

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

import { resetInstallationForRecovery } from "./startupRecovery";

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
});
