// @vitest-environment node

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  app: {
    isPackaged: false,
    getAppPath: () => "/tmp/f-land",
    getPath: () => "/tmp/f-land",
  },
}));

import {
  markRoundExcludeFromRandomMigrationIfManuallyApplied,
  migratePortableDatabaseIfNeeded,
  repairSinglePlayerRunSaveSchema,
  resolveDatabaseUrl,
} from "./db";

type ExecuteResult = {
  rows: Array<Record<string, unknown>>;
};

describe("drizzle migration journal", () => {
  it("lists every SQL migration so the runtime migrator applies them", async () => {
    const migrationsDir = path.resolve(process.cwd(), "drizzle");
    const migrationFiles = (await fs.readdir(migrationsDir))
      .filter((fileName) => fileName.endsWith(".sql"))
      .map((fileName) => fileName.replace(/\.sql$/, ""))
      .sort();
    const journal = JSON.parse(
      await fs.readFile(path.join(migrationsDir, "meta", "_journal.json"), "utf8")
    ) as { entries?: Array<{ tag?: unknown }> };
    const journalTags = (journal.entries ?? [])
      .map((entry) => entry.tag)
      .filter((tag): tag is string => typeof tag === "string")
      .sort();

    expect(journalTags).toEqual(migrationFiles);
  });
});

describe("markRoundExcludeFromRandomMigrationIfManuallyApplied", () => {
  const execute = vi.fn<(_: string) => Promise<ExecuteResult>>();
  const dbInstance = {
    $client: {
      execute,
    },
  } as never;

  beforeEach(() => {
    execute.mockReset();
  });

  it("records the migration when the column was added manually after the previous migration", async () => {
    execute.mockImplementation(async (sql: string) => {
      if (sql.includes("sqlite_master")) {
        return { rows: [{ name: "__drizzle_migrations" }] };
      }
      if (sql.includes('SELECT created_at FROM "__drizzle_migrations"')) {
        return { rows: [{ created_at: 1775692800000 }] };
      }
      if (sql.includes('PRAGMA table_info("Round")')) {
        return { rows: [{ name: "id" }, { name: "excludeFromRandom" }] };
      }
      return { rows: [] };
    });

    await markRoundExcludeFromRandomMigrationIfManuallyApplied(
      dbInstance,
      path.resolve(process.cwd(), "drizzle")
    );

    expect(execute).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO "__drizzle_migrations"')
    );
    expect(execute).toHaveBeenCalledWith(expect.stringContaining("1776643200000"));
  });

  it("does not record the migration when earlier migrations are not recorded", async () => {
    execute.mockImplementation(async (sql: string) => {
      if (sql.includes("sqlite_master")) {
        return { rows: [{ name: "__drizzle_migrations" }] };
      }
      if (sql.includes('SELECT created_at FROM "__drizzle_migrations"')) {
        return { rows: [{ created_at: 1775001600000 }] };
      }
      if (sql.includes('PRAGMA table_info("Round")')) {
        return { rows: [{ name: "id" }, { name: "excludeFromRandom" }] };
      }
      return { rows: [] };
    });

    await markRoundExcludeFromRandomMigrationIfManuallyApplied(
      dbInstance,
      path.resolve(process.cwd(), "drizzle")
    );

    expect(execute).not.toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO "__drizzle_migrations"')
    );
  });
});

describe("repairSinglePlayerRunSaveSchema", () => {
  const execute = vi.fn<(_: string) => Promise<ExecuteResult>>();
  const dbInstance = {
    $client: {
      execute,
    },
  } as never;

  beforeEach(() => {
    execute.mockReset();
  });

  it("adds missing legacy columns, removes incomplete rows, and recreates the unique index", async () => {
    execute.mockImplementation(async (sql: string) => {
      if (sql.includes("sqlite_master")) {
        return { rows: [{ name: "SinglePlayerRunSave" }] };
      }
      if (sql.includes('PRAGMA table_info("SinglePlayerRunSave")')) {
        return {
          rows: [{ name: "id" }, { name: "playlistId" }],
        };
      }
      if (sql.includes('PRAGMA index_list("SinglePlayerRunSave")')) {
        return { rows: [] };
      }
      return { rows: [] };
    });

    await repairSinglePlayerRunSaveSchema(dbInstance);

    expect(execute).toHaveBeenCalledWith(
      expect.stringContaining('ALTER TABLE "SinglePlayerRunSave" ADD COLUMN "playlistName" text')
    );
    expect(execute).toHaveBeenCalledWith(
      expect.stringContaining('ALTER TABLE "SinglePlayerRunSave" ADD COLUMN "snapshotJson" text')
    );
    expect(execute).toHaveBeenCalledWith(
      expect.stringContaining('DELETE FROM "SinglePlayerRunSave"')
    );
    expect(execute).toHaveBeenCalledWith(
      expect.stringContaining('CREATE UNIQUE INDEX "SinglePlayerRunSave_playlistId_unique"')
    );
  });

  it("creates the table and index when the save table is missing", async () => {
    execute.mockImplementation(async (sql: string) => {
      if (sql.includes("sqlite_master")) {
        return { rows: [] };
      }
      if (sql.includes('PRAGMA index_list("SinglePlayerRunSave")')) {
        return { rows: [] };
      }
      return { rows: [] };
    });

    await repairSinglePlayerRunSaveSchema(dbInstance);

    expect(execute).toHaveBeenCalledWith(
      expect.stringContaining('CREATE TABLE "SinglePlayerRunSave"')
    );
    expect(execute).toHaveBeenCalledWith(
      expect.stringContaining('CREATE UNIQUE INDEX "SinglePlayerRunSave_playlistId_unique"')
    );
  });
});

describe("resolveDatabaseUrl", () => {
  it("uses the app storage base dir when no DATABASE_URL is configured", () => {
    expect(resolveDatabaseUrl({ env: {} })).toBe("file:/tmp/f-land/dev.db");
  });

  it("uses the executable-adjacent database for Windows zip portable builds", () => {
    expect(
      resolveDatabaseUrl({
        platform: "win32",
        isPackaged: true,
        env: {},
        execPath: "C:\\Games\\Fap Land\\Fap Land.exe",
        markerExists: () => false,
      })
    ).toBe("file:C:\\Games\\Fap Land\\dev.db");
  });

  it("uses a suffixed executable-adjacent database for isolated Windows zip sessions", () => {
    expect(
      resolveDatabaseUrl({
        platform: "win32",
        isPackaged: true,
        env: { FLAND_USER_DATA_SUFFIX: "mp1" },
        execPath: "C:\\Games\\Fap Land\\Fap Land.exe",
        markerExists: () => false,
      })
    ).toBe("file:C:\\Games\\Fap Land\\dev-mp1.db");
  });

  it("keeps Windows setup installs on the normal app storage path", () => {
    expect(
      resolveDatabaseUrl({
        platform: "win32",
        isPackaged: true,
        env: {},
        execPath: "C:\\Program Files\\Fap Land\\Fap Land.exe",
        markerExists: () => true,
      })
    ).toBe("file:/tmp/f-land/dev.db");
  });

  it("keeps Linux packaged builds on the normal app storage path", () => {
    expect(
      resolveDatabaseUrl({
        platform: "linux",
        isPackaged: true,
        env: {},
        execPath: "/tmp/Fap Land.AppImage",
        markerExists: () => false,
      })
    ).toBe("file:/tmp/f-land/dev.db");
  });

  it("lets DATABASE_URL override default portable and installed paths", () => {
    expect(
      resolveDatabaseUrl({
        platform: "win32",
        isPackaged: true,
        execPath: "C:\\Games\\Fap Land\\Fap Land.exe",
        env: { DATABASE_URL: "file:/custom/app.db" },
        markerExists: () => false,
      })
    ).toBe("file:/custom/app.db");
  });
});

describe("migratePortableDatabaseIfNeeded", () => {
  async function withPortableRoot<T>(handler: (root: string) => Promise<T>): Promise<T> {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "f-land-portable-"));
    try {
      return await handler(root);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  }

  it("moves an old portable database next to the executable", async () => {
    await withPortableRoot(async (root) => {
      await fs.mkdir(path.join(root, "data"), { recursive: true });
      await fs.writeFile(path.join(root, "data", "dev.db"), "main");

      await migratePortableDatabaseIfNeeded({
        platform: "win32",
        isPackaged: true,
        env: { PORTABLE_EXECUTABLE_DIR: root, DATABASE_URL: undefined },
      });

      await expect(fs.readFile(path.join(root, "dev.db"), "utf8")).resolves.toBe("main");
      await expect(fs.access(path.join(root, "data", "dev.db"))).rejects.toThrow();
    });
  });

  it("moves portable database wal and shm sidecars when present", async () => {
    await withPortableRoot(async (root) => {
      await fs.mkdir(path.join(root, "data"), { recursive: true });
      await fs.writeFile(path.join(root, "data", "dev.db"), "main");
      await fs.writeFile(path.join(root, "data", "dev.db-wal"), "wal");
      await fs.writeFile(path.join(root, "data", "dev.db-shm"), "shm");

      await migratePortableDatabaseIfNeeded({
        platform: "win32",
        isPackaged: true,
        env: { PORTABLE_EXECUTABLE_DIR: root, DATABASE_URL: undefined },
      });

      await expect(fs.readFile(path.join(root, "dev.db"), "utf8")).resolves.toBe("main");
      await expect(fs.readFile(path.join(root, "dev.db-wal"), "utf8")).resolves.toBe("wal");
      await expect(fs.readFile(path.join(root, "dev.db-shm"), "utf8")).resolves.toBe("shm");
    });
  });

  it("does not overwrite an existing executable-adjacent database", async () => {
    await withPortableRoot(async (root) => {
      await fs.mkdir(path.join(root, "data"), { recursive: true });
      await fs.writeFile(path.join(root, "data", "dev.db"), "old");
      await fs.writeFile(path.join(root, "dev.db"), "new");

      await migratePortableDatabaseIfNeeded({
        platform: "win32",
        isPackaged: true,
        env: { PORTABLE_EXECUTABLE_DIR: root, DATABASE_URL: undefined },
      });

      await expect(fs.readFile(path.join(root, "dev.db"), "utf8")).resolves.toBe("new");
      await expect(fs.readFile(path.join(root, "data", "dev.db"), "utf8")).resolves.toBe("old");
    });
  });

  it("moves an old suffixed portable database next to the executable", async () => {
    await withPortableRoot(async (root) => {
      await fs.mkdir(path.join(root, "data", "mp1"), { recursive: true });
      await fs.writeFile(path.join(root, "data", "mp1", "dev.db"), "main");

      await migratePortableDatabaseIfNeeded({
        platform: "win32",
        isPackaged: true,
        env: { PORTABLE_EXECUTABLE_DIR: root, FLAND_USER_DATA_SUFFIX: "mp1" },
      });

      await expect(fs.readFile(path.join(root, "dev-mp1.db"), "utf8")).resolves.toBe("main");
      await expect(fs.access(path.join(root, "data", "mp1", "dev.db"))).rejects.toThrow();
    });
  });

  it("does not run for Linux AppImage-like builds", async () => {
    await withPortableRoot(async (root) => {
      await fs.mkdir(path.join(root, "data"), { recursive: true });
      await fs.writeFile(path.join(root, "data", "dev.db"), "old");

      await migratePortableDatabaseIfNeeded({
        platform: "linux",
        isPackaged: true,
        execPath: path.join(root, "Fap Land.AppImage"),
        env: { APPIMAGE: path.join(root, "Fap Land.AppImage"), DATABASE_URL: undefined },
        markerExists: () => false,
      });

      await expect(fs.access(path.join(root, "dev.db"))).rejects.toThrow();
      await expect(fs.readFile(path.join(root, "data", "dev.db"), "utf8")).resolves.toBe("old");
    });
  });
});
