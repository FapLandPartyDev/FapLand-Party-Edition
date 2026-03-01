import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { app } from "electron";
import path from "node:path";
import { getNodeEnv } from "../../src/zod/env";
import { resolveAppStorageBaseDir } from "./appPaths";
import * as schema from "./db/schema";

let db: ReturnType<typeof drizzle<typeof schema>> | null = null;
let databaseReadyPromise: Promise<void> | null = null;
let dbClientUrl: string = "";

function rowValueToString(row: Record<string, unknown>, key: string): string | null {
    const value = row[key];
    return typeof value === "string" ? value : null;
}

async function hasTable(
    dbInstance: ReturnType<typeof drizzle<typeof schema>>,
    tableName: string,
): Promise<boolean> {
    const result = await dbInstance.$client.execute(
        `SELECT name FROM sqlite_master WHERE type = 'table' AND name = '${tableName}'`,
    );
    return result.rows.length > 0;
}

async function hasColumn(
    dbInstance: ReturnType<typeof drizzle<typeof schema>>,
    tableName: string,
    columnName: string,
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
    indexName: string,
): Promise<boolean> {
    const result = await dbInstance.$client.execute(`PRAGMA index_list("${tableName}")`);
    return result.rows.some((row) => {
        const rowRecord = row as Record<string, unknown>;
        return rowValueToString(rowRecord, "name") === indexName;
    });
}

async function repairLegacyPlaylistSchema(dbInstance: ReturnType<typeof drizzle<typeof schema>>): Promise<void> {
    const playlistInstallSourceKeyExists = await hasColumn(dbInstance, "Playlist", "installSourceKey");
    if (!playlistInstallSourceKeyExists) {
        await dbInstance.$client.execute(`ALTER TABLE "Playlist" ADD COLUMN "installSourceKey" text`);
    }

    const playlistInstallSourceKeyIndexExists = await hasIndex(dbInstance, "Playlist", "Playlist_installSourceKey_unique");
    if (!playlistInstallSourceKeyIndexExists) {
        await dbInstance.$client.execute(
            `CREATE UNIQUE INDEX "Playlist_installSourceKey_unique" ON "Playlist" ("installSourceKey")`,
        );
    }
}

async function repairCheatModeSchema(dbInstance: ReturnType<typeof drizzle<typeof schema>>): Promise<void> {
    const gameProfileCheatModeExists = await hasColumn(dbInstance, "GameProfile", "highscoreCheatMode");
    if (!gameProfileCheatModeExists) {
        await dbInstance.$client.execute(`ALTER TABLE "GameProfile" ADD COLUMN "highscoreCheatMode" integer DEFAULT 0`);
    }

    const runHistoryCheatModeExists = await hasColumn(dbInstance, "SinglePlayerRunHistory", "cheatModeActive");
    if (!runHistoryCheatModeExists) {
        await dbInstance.$client.execute(`ALTER TABLE "SinglePlayerRunHistory" ADD COLUMN "cheatModeActive" integer DEFAULT 0`);
    }
}

async function repairAssistedSchema(dbInstance: ReturnType<typeof drizzle<typeof schema>>): Promise<void> {
    const gameProfileAssistedExists = await hasColumn(dbInstance, "GameProfile", "highscoreAssisted");
    if (!gameProfileAssistedExists) {
        await dbInstance.$client.execute(`ALTER TABLE "GameProfile" ADD COLUMN "highscoreAssisted" integer DEFAULT 0`);
    }

    const gameProfileAssistedSaveModeExists = await hasColumn(dbInstance, "GameProfile", "highscoreAssistedSaveMode");
    if (!gameProfileAssistedSaveModeExists) {
        await dbInstance.$client.execute(`ALTER TABLE "GameProfile" ADD COLUMN "highscoreAssistedSaveMode" text`);
    }

    const runHistoryAssistedExists = await hasColumn(dbInstance, "SinglePlayerRunHistory", "assistedActive");
    if (!runHistoryAssistedExists) {
        await dbInstance.$client.execute(`ALTER TABLE "SinglePlayerRunHistory" ADD COLUMN "assistedActive" integer DEFAULT 0`);
    }

    const runHistoryAssistedSaveModeExists = await hasColumn(dbInstance, "SinglePlayerRunHistory", "assistedSaveMode");
    if (!runHistoryAssistedSaveModeExists) {
        await dbInstance.$client.execute(`ALTER TABLE "SinglePlayerRunHistory" ADD COLUMN "assistedSaveMode" text`);
    }
}

export async function repairSinglePlayerRunSaveSchema(
    dbInstance: ReturnType<typeof drizzle<typeof schema>>,
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
                    `ALTER TABLE "SinglePlayerRunSave" ADD COLUMN "${column.name}" ${column.definition}`,
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

    const uniqueIndexExists = await hasIndex(dbInstance, "SinglePlayerRunSave", "SinglePlayerRunSave_playlistId_unique");
    if (!uniqueIndexExists) {
        await dbInstance.$client.execute(
            `CREATE UNIQUE INDEX "SinglePlayerRunSave_playlistId_unique" ON "SinglePlayerRunSave" ("playlistId")`,
        );
    }
}

export function resolveDatabaseUrl(): string {
    const env = getNodeEnv();
    if (env.databaseUrlRaw) return env.databaseUrl;

    return `file:${path.join(resolveAppStorageBaseDir(), "dev.db")}`;
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
            const dbInstance = getDb();
            const migrationsFolder = app.isPackaged
                ? path.join(process.resourcesPath, "drizzle")
                : path.join(app.getAppPath(), "drizzle");

            await migrate(dbInstance, { migrationsFolder });
            await repairLegacyPlaylistSchema(dbInstance);
            await repairCheatModeSchema(dbInstance);
            await repairAssistedSchema(dbInstance);
            await repairSinglePlayerRunSaveSchema(dbInstance);
        })();
    }
    return databaseReadyPromise;
}
