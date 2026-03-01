// @vitest-environment node

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";

vi.mock("electron", () => ({
  app: {
    isPackaged: false,
    getAppPath: () => "/tmp/f-land",
    getPath: () => "/tmp/f-land",
  },
}));

import {
  configureDatabaseConnection,
  ensureProgressionSchemaReady,
  markRoundExcludeFromRandomMigrationIfManuallyApplied,
  migratePortableDatabaseIfNeeded,
  repairInstalledLibrarySchema,
  repairRoundHeroMetadataSchema,
  repairSinglePlayerRunSaveSchema,
  resolveDatabaseUrl,
  runPreMigrationDatabaseBackup,
} from "./db";

type ExecuteResult = {
  rows: Array<Record<string, unknown>>;
};

const originalDatabaseUrl = process.env.DATABASE_URL;

afterEach(() => {
  if (originalDatabaseUrl === undefined) {
    delete process.env.DATABASE_URL;
  } else {
    process.env.DATABASE_URL = originalDatabaseUrl;
  }
});

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

  it("adds acquisition job library behavior after the acquisition migration was already applied", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "f-land-acquisition-migration-"));
    const legacyMigrations = path.join(tempRoot, "migrations");
    const currentMigrations = path.resolve(process.cwd(), "drizzle");
    const client = createClient({ url: `file:${path.join(tempRoot, "dev.db")}` });
    const database = drizzle(client);

    try {
      const journal = JSON.parse(
        await fs.readFile(path.join(currentMigrations, "meta", "_journal.json"), "utf8")
      ) as { version: string; dialect: string; entries: Array<{ idx: number; tag: string }> };
      const legacyJournal = {
        ...journal,
        entries: journal.entries.filter((entry) => entry.idx <= 15),
      };
      await fs.mkdir(path.join(legacyMigrations, "meta"), { recursive: true });
      await fs.writeFile(
        path.join(legacyMigrations, "meta", "_journal.json"),
        JSON.stringify(legacyJournal)
      );
      for (const entry of legacyJournal.entries) {
        await fs.copyFile(
          path.join(currentMigrations, `${entry.tag}.sql`),
          path.join(legacyMigrations, `${entry.tag}.sql`)
        );
      }

      await migrate(database, { migrationsFolder: legacyMigrations });
      const before = await client.execute(`PRAGMA table_info("AcquisitionJob")`);
      expect(before.rows.some((column) => column.name === "addCompletedToLibrary")).toBe(false);

      await migrate(database, { migrationsFolder: currentMigrations });
      const after = await client.execute(`PRAGMA table_info("AcquisitionJob")`);
      expect(after.rows.some((column) => column.name === "addCompletedToLibrary")).toBe(true);
    } finally {
      client.close();
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("upgrades a populated v0.5.06 database without losing user data", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "f-land-v0506-migration-"));
    const client = createClient({ url: `file:${path.join(tempRoot, "dev.db")}` });
    const database = drizzle(client);
    const migrationsFolder = path.resolve(process.cwd(), "drizzle");

    try {
      // v0.5.06 shipped the journal through 0009. Reapplying today's journal
      // models the direct in-place upgrade performed by the current release.
      await migrate(database, { migrationsFolder });
      await client.execute(
        `INSERT INTO "Hero" ("id", "name", "createdAt", "updatedAt") VALUES ('hero-06', 'Saved Hero', 1, 1)`
      );
      await client.execute(
        `INSERT INTO "Round" ("id", "name", "type", "heroId", "createdAt", "updatedAt") VALUES ('round-06', 'Saved Round', 'Normal', 'hero-06', 1, 1)`
      );
      await client.execute(
        `INSERT INTO "Resource" ("id", "videoUri", "roundId", "createdAt", "updatedAt") VALUES ('resource-06', '/library/video.mp4', 'round-06', 1, 1)`
      );
      await client.execute(
        `INSERT INTO "Playlist" ("id", "name", "configJson", "createdAt", "updatedAt") VALUES ('playlist-06', 'Saved Playlist', '{}', 1, 1)`
      );

      await migrate(database, { migrationsFolder });
      await repairSinglePlayerRunSaveSchema(database as never);
      await repairInstalledLibrarySchema(database as never);

      const rows = await client.execute(
        `SELECT r."name" AS roundName, h."name" AS heroName, p."name" AS playlistName, x."videoUri" AS videoUri
         FROM "Round" r
         JOIN "Hero" h ON h."id" = r."heroId"
         JOIN "Resource" x ON x."roundId" = r."id"
         CROSS JOIN "Playlist" p
         WHERE r."id" = 'round-06' AND p."id" = 'playlist-06'`
      );
      expect(rows.rows).toEqual([
        expect.objectContaining({
          roundName: "Saved Round",
          heroName: "Saved Hero",
          playlistName: "Saved Playlist",
          videoUri: "/library/video.mp4",
        }),
      ]);
      await expect(client.execute("PRAGMA integrity_check")).resolves.toMatchObject({
        rows: [{ integrity_check: "ok" }],
      });
    } finally {
      client.close();
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  });
});

describe("configureDatabaseConnection", () => {
  it("waits for short-lived SQLite write contention", async () => {
    const execute = vi.fn(async () => ({ rows: [] }));
    const dbInstance = { $client: { execute } } as never;

    await configureDatabaseConnection(dbInstance);

    expect(execute).toHaveBeenCalledWith("PRAGMA busy_timeout = 5000");
  });
});

describe("ensureProgressionSchemaReady", () => {
  it("repairs a running pre-progression database before the local profile is inserted", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "f-land-progression-repair-"));
    const client = createClient({ url: `file:${path.join(tempRoot, "legacy.db")}` });
    const database = drizzle(client);

    try {
      await client.execute(`
        CREATE TABLE "GameProfile" (
          "id" text PRIMARY KEY NOT NULL,
          "highscore" integer DEFAULT 0 NOT NULL,
          "highscoreCheatMode" integer DEFAULT 0,
          "highscoreAssisted" integer DEFAULT 0 NOT NULL,
          "highscoreAssistedSaveMode" text,
          "createdAt" integer NOT NULL,
          "updatedAt" integer NOT NULL
        )
      `);

      await ensureProgressionSchemaReady(database as never);
      await client.execute({
        sql: `INSERT INTO "GameProfile" (
          "id", "highscore", "highscoreCheatMode", "highscoreAssisted",
          "highscoreAssistedSaveMode", "progressionXp", "equippedTitleId",
          "respecTokens", "createdAt", "updatedAt"
        ) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?)`,
        args: ["local", 0, 0, 0, 0, "fresh-face", 0, 1, 1],
      });

      const columns = await client.execute(`PRAGMA table_info("GameProfile")`);
      expect(columns.rows.map((row) => row.name)).toEqual(
        expect.arrayContaining(["progressionXp", "equippedTitleId", "respecTokens"])
      );
      await expect(
        client.execute(`SELECT "enabled" FROM "ProgressionSkillRank" LIMIT 1`)
      ).resolves.toBeDefined();
      await expect(
        client.execute(`SELECT "sourceKind" FROM "ProgressionAward" LIMIT 1`)
      ).resolves.toBeDefined();
    } finally {
      client.close();
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
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

describe("repairRoundHeroMetadataSchema", () => {
  const execute = vi.fn<(_: string) => Promise<ExecuteResult>>();
  const dbInstance = {
    $client: {
      execute,
    },
  } as never;

  beforeEach(() => {
    execute.mockReset();
  });

  it("adds missing tagsJson columns to round and hero tables", async () => {
    execute.mockImplementation(async (sql: string) => {
      if (sql.includes('PRAGMA table_info("Round")')) {
        return { rows: [{ name: "id" }] };
      }
      if (sql.includes('PRAGMA table_info("Hero")')) {
        return { rows: [{ name: "id" }] };
      }
      return { rows: [] };
    });

    await repairRoundHeroMetadataSchema(dbInstance);

    expect(execute).toHaveBeenCalledWith(
      expect.stringContaining(
        `ALTER TABLE "Round" ADD COLUMN "tagsJson" text NOT NULL DEFAULT '[]'`
      )
    );
    expect(execute).toHaveBeenCalledWith(
      expect.stringContaining(`ALTER TABLE "Hero" ADD COLUMN "tagsJson" text NOT NULL DEFAULT '[]'`)
    );
  });

  it("does nothing when both tagsJson columns already exist", async () => {
    execute.mockImplementation(async (sql: string) => {
      if (sql.includes('PRAGMA table_info("Round")')) {
        return { rows: [{ name: "id" }, { name: "tagsJson" }] };
      }
      if (sql.includes('PRAGMA table_info("Hero")')) {
        return { rows: [{ name: "id" }, { name: "tagsJson" }] };
      }
      return { rows: [] };
    });

    await repairRoundHeroMetadataSchema(dbInstance);

    expect(execute).not.toHaveBeenCalledWith(
      expect.stringContaining('ALTER TABLE "Round" ADD COLUMN "tagsJson"')
    );
    expect(execute).not.toHaveBeenCalledWith(
      expect.stringContaining('ALTER TABLE "Hero" ADD COLUMN "tagsJson"')
    );
  });
});

describe("repairInstalledLibrarySchema", () => {
  const execute = vi.fn<(_: string) => Promise<ExecuteResult>>();
  const dbInstance = {
    $client: {
      execute,
    },
  } as never;

  beforeEach(() => {
    execute.mockReset();
  });

  it("adds missing installed library columns across resource, round, and hero tables", async () => {
    execute.mockImplementation(async (sql: string) => {
      if (sql.includes('PRAGMA table_info("Resource")')) {
        return { rows: [{ name: "id" }] };
      }
      if (sql.includes('PRAGMA table_info("Round")')) {
        return { rows: [{ name: "id" }] };
      }
      if (sql.includes('PRAGMA table_info("Hero")')) {
        return { rows: [{ name: "id" }] };
      }
      return { rows: [] };
    });

    await repairInstalledLibrarySchema(dbInstance);

    expect(execute).toHaveBeenCalledWith(
      expect.stringContaining('ALTER TABLE "Resource" ADD COLUMN "durationMs" integer')
    );
    expect(execute).toHaveBeenCalledWith(
      expect.stringContaining('ALTER TABLE "Round" ADD COLUMN "cutRangesJson" text')
    );
    expect(execute).toHaveBeenCalledWith(
      expect.stringContaining(
        'ALTER TABLE "Round" ADD COLUMN "excludeFromRandom" integer DEFAULT 0 NOT NULL'
      )
    );
    expect(execute).toHaveBeenCalledWith(
      expect.stringContaining(
        `ALTER TABLE "Round" ADD COLUMN "tagsJson" text NOT NULL DEFAULT '[]'`
      )
    );
    expect(execute).toHaveBeenCalledWith(
      expect.stringContaining(`ALTER TABLE "Hero" ADD COLUMN "tagsJson" text NOT NULL DEFAULT '[]'`)
    );
    expect(execute).toHaveBeenCalledWith(
      expect.stringContaining('ALTER TABLE "Round" ADD COLUMN "libraryLabel" text')
    );
    expect(execute).toHaveBeenCalledWith(
      expect.stringContaining('ALTER TABLE "Resource" ADD COLUMN "funscriptOffsetMs" integer')
    );
  });

  it("does nothing when installed library columns already exist", async () => {
    execute.mockImplementation(async (sql: string) => {
      if (sql.includes('PRAGMA table_info("Resource")')) {
        return { rows: [{ name: "id" }, { name: "durationMs" }, { name: "funscriptOffsetMs" }] };
      }
      if (sql.includes('PRAGMA table_info("Round")')) {
        return {
          rows: [
            { name: "id" },
            { name: "cutRangesJson" },
            { name: "excludeFromRandom" },
            { name: "tagsJson" },
            { name: "libraryLabel" },
          ],
        };
      }
      if (sql.includes('PRAGMA table_info("Hero")')) {
        return { rows: [{ name: "id" }, { name: "tagsJson" }] };
      }
      return { rows: [] };
    });

    await repairInstalledLibrarySchema(dbInstance);

    expect(execute).not.toHaveBeenCalledWith(
      expect.stringContaining('ALTER TABLE "Resource" ADD COLUMN "durationMs"')
    );
    expect(execute).not.toHaveBeenCalledWith(
      expect.stringContaining('ALTER TABLE "Round" ADD COLUMN "cutRangesJson"')
    );
    expect(execute).not.toHaveBeenCalledWith(
      expect.stringContaining('ALTER TABLE "Round" ADD COLUMN "excludeFromRandom"')
    );
    expect(execute).not.toHaveBeenCalledWith(
      expect.stringContaining('ALTER TABLE "Round" ADD COLUMN "tagsJson"')
    );
    expect(execute).not.toHaveBeenCalledWith(
      expect.stringContaining('ALTER TABLE "Hero" ADD COLUMN "tagsJson"')
    );
    expect(execute).not.toHaveBeenCalledWith(
      expect.stringContaining('ALTER TABLE "Round" ADD COLUMN "libraryLabel"')
    );
    expect(execute).not.toHaveBeenCalledWith(
      expect.stringContaining('ALTER TABLE "Resource" ADD COLUMN "funscriptOffsetMs"')
    );
  });
});

describe("runPreMigrationDatabaseBackup", () => {
  const execute = vi.fn<(_: string) => Promise<ExecuteResult>>();
  const dbInstance = {
    $client: {
      execute,
    },
  } as never;

  beforeEach(() => {
    execute.mockReset();
  });

  it("creates a database backup before migrations run when the database already exists", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "f-land-pre-migration-backup-"));
    const databasePath = path.join(root, "dev.db");
    const expectedBackupPath =
      "/tmp/f-land/database-backups/f-land-db-backup-2026-04-21T12-34-56.000Z.db";
    process.env.DATABASE_URL = `file:${databasePath}`;
    await fs.writeFile(databasePath, "sqlite");
    await fs.rm(expectedBackupPath, { force: true });
    execute.mockImplementation(async () => {
      const backupClient = createClient({ url: `file:${expectedBackupPath}` });
      await backupClient.execute("CREATE TABLE backup_validation (id INTEGER PRIMARY KEY)");
      backupClient.close();
      return { rows: [] };
    });

    try {
      await runPreMigrationDatabaseBackup(dbInstance, new Date("2026-04-21T12:34:56.000Z"));

      expect(execute).toHaveBeenCalledWith(
        "VACUUM INTO '/tmp/f-land/database-backups/f-land-db-backup-2026-04-21T12-34-56.000Z.db'"
      );
    } finally {
      await fs.rm(root, { recursive: true, force: true });
      await fs.rm(expectedBackupPath, { force: true });
    }
  });

  it("skips the pre-migration backup when the database does not exist yet", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "f-land-pre-migration-backup-"));
    process.env.DATABASE_URL = `file:${path.join(root, "dev.db")}`;

    try {
      await runPreMigrationDatabaseBackup(dbInstance);

      expect(execute).not.toHaveBeenCalled();
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
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
