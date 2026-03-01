import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { app } from "electron";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { getNodeEnv } from "../../src/zod/env";
import { resolveAppStorageBaseDir } from "./appPaths";
import * as schema from "./db/schema";
import {
  getPortableDataRoot,
  getPortableDatabasePath,
  normalizeUserDataSuffix,
  type PortableContext,
} from "./portable";

let db: ReturnType<typeof drizzle<typeof schema>> | null = null;
let databaseReadyPromise: Promise<void> | null = null;
let dbClientUrl: string = "";

const ROUND_EXCLUDE_FROM_RANDOM_MIGRATION_TAG = "0005_round_exclude_from_random";

function rowValueToString(row: Record<string, unknown>, key: string): string | null {
  const value = row[key];
  return typeof value === "string" ? value : null;
}

function rowValueToNumber(row: Record<string, unknown>, key: string): number | null {
  const value = row[key];
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

async function hasTable(
  dbInstance: ReturnType<typeof drizzle<typeof schema>>,
  tableName: string
): Promise<boolean> {
  const result = await dbInstance.$client.execute(
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name = '${tableName}'`
  );
  return result.rows.length > 0;
}

async function hasColumn(
  dbInstance: ReturnType<typeof drizzle<typeof schema>>,
  tableName: string,
  columnName: string
): Promise<boolean> {
  const result = await dbInstance.$client.execute(`PRAGMA table_info("${tableName}")`);
  return result.rows.some((row) => {
    const rowRecord = row as Record<string, unknown>;
    return rowValueToString(rowRecord, "name") === columnName;
  });
}

async function hasIndex(
  dbInstance: ReturnType<typeof drizzle<typeof schema>>,
  tableName: string,
  indexName: string
): Promise<boolean> {
  const result = await dbInstance.$client.execute(`PRAGMA index_list("${tableName}")`);
  return result.rows.some((row) => {
    const rowRecord = row as Record<string, unknown>;
    return rowValueToString(rowRecord, "name") === indexName;
  });
}

async function readMigrationJournalEntry(
  migrationsFolder: string,
  migrationTag: string
): Promise<{ when: number } | null> {
  const journal = JSON.parse(
    await fs.readFile(path.join(migrationsFolder, "meta", "_journal.json"), "utf8")
  ) as { entries?: Array<{ tag?: unknown; when?: unknown }> };

  const entry = (journal.entries ?? []).find((candidate) => candidate.tag === migrationTag);
  if (!entry || typeof entry.tag !== "string" || typeof entry.when !== "number") return null;

  return { when: entry.when };
}

async function readMigrationHash(migrationsFolder: string, migrationTag: string): Promise<string> {
  const migrationSql = await fs.readFile(
    path.join(migrationsFolder, `${migrationTag}.sql`),
    "utf8"
  );
  return crypto.createHash("sha256").update(migrationSql).digest("hex");
}

export async function markRoundExcludeFromRandomMigrationIfManuallyApplied(
  dbInstance: ReturnType<typeof drizzle<typeof schema>>,
  migrationsFolder: string
): Promise<void> {
  const migrationsTableExists = await hasTable(dbInstance, "__drizzle_migrations");
  if (!migrationsTableExists) return;

  const latestMigrationResult = await dbInstance.$client.execute(
    `SELECT created_at FROM "__drizzle_migrations" ORDER BY created_at DESC LIMIT 1`
  );
  const latestMigration = latestMigrationResult.rows[0] as Record<string, unknown> | undefined;
  if (!latestMigration) return;

  const latestMigrationCreatedAt = rowValueToNumber(latestMigration, "created_at");
  if (latestMigrationCreatedAt === null) return;

  const targetMigration = await readMigrationJournalEntry(
    migrationsFolder,
    ROUND_EXCLUDE_FROM_RANDOM_MIGRATION_TAG
  );
  if (!targetMigration || latestMigrationCreatedAt >= targetMigration.when) return;

  const previousMigration = await readMigrationJournalEntry(
    migrationsFolder,
    "0004_round_query_indexes"
  );
  if (!previousMigration || latestMigrationCreatedAt < previousMigration.when) return;

  const columnExists = await hasColumn(dbInstance, "Round", "excludeFromRandom");
  if (!columnExists) return;

  const migrationHash = await readMigrationHash(
    migrationsFolder,
    ROUND_EXCLUDE_FROM_RANDOM_MIGRATION_TAG
  );
  await dbInstance.$client.execute(
    `INSERT INTO "__drizzle_migrations" ("hash", "created_at") VALUES` +
      `('${migrationHash}', ${targetMigration.when})`
  );
}

async function repairLegacyPlaylistSchema(
  dbInstance: ReturnType<typeof drizzle<typeof schema>>
): Promise<void> {
  const playlistInstallSourceKeyExists = await hasColumn(
    dbInstance,
    "Playlist",
    "installSourceKey"
  );
  if (!playlistInstallSourceKeyExists) {
    await dbInstance.$client.execute(`ALTER TABLE "Playlist" ADD COLUMN "installSourceKey" text`);
  }

  const playlistInstallSourceKeyIndexExists = await hasIndex(
    dbInstance,
    "Playlist",
    "Playlist_installSourceKey_unique"
  );
  if (!playlistInstallSourceKeyIndexExists) {
    await dbInstance.$client.execute(
      `CREATE UNIQUE INDEX "Playlist_installSourceKey_unique" ON "Playlist" ("installSourceKey")`
    );
  }
}

async function repairCheatModeSchema(
  dbInstance: ReturnType<typeof drizzle<typeof schema>>
): Promise<void> {
  const gameProfileCheatModeExists = await hasColumn(
    dbInstance,
    "GameProfile",
    "highscoreCheatMode"
  );
  if (!gameProfileCheatModeExists) {
    await dbInstance.$client.execute(
      `ALTER TABLE "GameProfile" ADD COLUMN "highscoreCheatMode" integer DEFAULT 0`
    );
  }

  const runHistoryCheatModeExists = await hasColumn(
    dbInstance,
    "SinglePlayerRunHistory",
    "cheatModeActive"
  );
  if (!runHistoryCheatModeExists) {
    await dbInstance.$client.execute(
      `ALTER TABLE "SinglePlayerRunHistory" ADD COLUMN "cheatModeActive" integer DEFAULT 0`
    );
  }
}

async function repairAssistedSchema(
  dbInstance: ReturnType<typeof drizzle<typeof schema>>
): Promise<void> {
  const gameProfileAssistedExists = await hasColumn(dbInstance, "GameProfile", "highscoreAssisted");
  if (!gameProfileAssistedExists) {
    await dbInstance.$client.execute(
      `ALTER TABLE "GameProfile" ADD COLUMN "highscoreAssisted" integer DEFAULT 0`
    );
  }

  const gameProfileAssistedSaveModeExists = await hasColumn(
    dbInstance,
    "GameProfile",
    "highscoreAssistedSaveMode"
  );
  if (!gameProfileAssistedSaveModeExists) {
    await dbInstance.$client.execute(
      `ALTER TABLE "GameProfile" ADD COLUMN "highscoreAssistedSaveMode" text`
    );
  }

  const runHistoryAssistedExists = await hasColumn(
    dbInstance,
    "SinglePlayerRunHistory",
    "assistedActive"
  );
  if (!runHistoryAssistedExists) {
    await dbInstance.$client.execute(
      `ALTER TABLE "SinglePlayerRunHistory" ADD COLUMN "assistedActive" integer DEFAULT 0`
    );
  }

  const runHistoryAssistedSaveModeExists = await hasColumn(
    dbInstance,
    "SinglePlayerRunHistory",
    "assistedSaveMode"
  );
  if (!runHistoryAssistedSaveModeExists) {
    await dbInstance.$client.execute(
      `ALTER TABLE "SinglePlayerRunHistory" ADD COLUMN "assistedSaveMode" text`
    );
  }
}

export async function repairSinglePlayerRunSaveSchema(
  dbInstance: ReturnType<typeof drizzle<typeof schema>>
): Promise<void> {
  const tableExists = await hasTable(dbInstance, "SinglePlayerRunSave");
  if (!tableExists) {
    await dbInstance.$client.execute(`
            CREATE TABLE "SinglePlayerRunSave" (
                "id" text PRIMARY KEY NOT NULL,
                "playlistId" text NOT NULL,
                "playlistName" text NOT NULL,
                "playlistFormatVersion" integer,
                "saveMode" text NOT NULL,
                "snapshotJson" text NOT NULL,
                "savedAt" integer NOT NULL,
                "createdAt" integer NOT NULL,
                "updatedAt" integer NOT NULL,
                FOREIGN KEY ("playlistId") REFERENCES "Playlist"("id") ON UPDATE cascade ON DELETE cascade
            )
        `);
  } else {
    const requiredColumns: Array<{ name: string; definition: string }> = [
      { name: "playlistName", definition: `text` },
      { name: "playlistFormatVersion", definition: `integer` },
      { name: "saveMode", definition: `text` },
      { name: "snapshotJson", definition: `text` },
      { name: "savedAt", definition: `integer` },
      { name: "createdAt", definition: `integer` },
      { name: "updatedAt", definition: `integer` },
    ];

    for (const column of requiredColumns) {
      const columnExists = await hasColumn(dbInstance, "SinglePlayerRunSave", column.name);
      if (!columnExists) {
        await dbInstance.$client.execute(
          `ALTER TABLE "SinglePlayerRunSave" ADD COLUMN "${column.name}" ${column.definition}`
        );
      }
    }

    // Legacy partial tables cannot reconstruct resume state safely.
    await dbInstance.$client.execute(`
            DELETE FROM "SinglePlayerRunSave"
            WHERE "playlistName" IS NULL
               OR "saveMode" IS NULL
               OR "snapshotJson" IS NULL
               OR "savedAt" IS NULL
               OR "createdAt" IS NULL
               OR "updatedAt" IS NULL
        `);
  }

  const uniqueIndexExists = await hasIndex(
    dbInstance,
    "SinglePlayerRunSave",
    "SinglePlayerRunSave_playlistId_unique"
  );
  if (!uniqueIndexExists) {
    await dbInstance.$client.execute(
      `CREATE UNIQUE INDEX "SinglePlayerRunSave_playlistId_unique" ON "SinglePlayerRunSave" ("playlistId")`
    );
  }
}

export function resolveDatabaseUrl(context: PortableContext = {}): string {
  const env = getNodeEnv(context.env);
  if (env.databaseUrlRaw) return env.databaseUrl;

  const userDataSuffix = normalizeUserDataSuffix(
    context.env?.FLAND_USER_DATA_SUFFIX ?? process.env.FLAND_USER_DATA_SUFFIX
  );
  const portableDatabasePath = getPortableDatabasePath(userDataSuffix, context);
  if (portableDatabasePath) return `file:${portableDatabasePath}`;

  return `file:${path.join(resolveAppStorageBaseDir(), "dev.db")}`;
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function moveIfExists(sourcePath: string, destinationPath: string): Promise<boolean> {
  if (!(await pathExists(sourcePath))) return false;
  if (await pathExists(destinationPath)) {
    throw new Error(
      `Cannot migrate portable database because destination already exists: ${destinationPath}`
    );
  }
  await fs.rename(sourcePath, destinationPath);
  return true;
}

export async function migratePortableDatabaseIfNeeded(
  context: PortableContext = {}
): Promise<void> {
  const env = getNodeEnv(context.env);
  if (env.databaseUrlRaw) return;

  const userDataSuffix = normalizeUserDataSuffix(
    context.env?.FLAND_USER_DATA_SUFFIX ?? process.env.FLAND_USER_DATA_SUFFIX
  );
  const portableDatabasePath = getPortableDatabasePath(userDataSuffix, context);
  const oldPortableDataRoot = getPortableDataRoot(userDataSuffix, context);
  if (!portableDatabasePath || !oldPortableDataRoot) return;
  if (await pathExists(portableDatabasePath)) return;

  const pathApi = portableDatabasePath.includes("\\") ? path.win32 : path;
  const oldDatabasePath = pathApi.join(oldPortableDataRoot, "dev.db");
  const movedMainDatabase = await moveIfExists(oldDatabasePath, portableDatabasePath);
  if (!movedMainDatabase) return;

  for (const suffix of ["-wal", "-shm"]) {
    await moveIfExists(`${oldDatabasePath}${suffix}`, `${portableDatabasePath}${suffix}`);
  }
}

export function getDb() {
  if (!db) {
    dbClientUrl = resolveDatabaseUrl();
    const client = createClient({ url: dbClientUrl });
    db = drizzle(client, { schema });
  }
  return db;
}

export async function ensureAppDatabaseReady(): Promise<void> {
  if (!databaseReadyPromise) {
    databaseReadyPromise = (async () => {
      await migratePortableDatabaseIfNeeded();
      const dbInstance = getDb();
      const migrationsFolder = app.isPackaged
        ? path.join(process.resourcesPath, "drizzle")
        : path.join(app.getAppPath(), "drizzle");

      await markRoundExcludeFromRandomMigrationIfManuallyApplied(dbInstance, migrationsFolder);
      await migrate(dbInstance, { migrationsFolder });
      await repairLegacyPlaylistSchema(dbInstance);
      await repairCheatModeSchema(dbInstance);
      await repairAssistedSchema(dbInstance);
      await repairSinglePlayerRunSaveSchema(dbInstance);
    })();
  }
  return databaseReadyPromise;
}
