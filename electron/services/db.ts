import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { app } from "electron";
import path from "node:path";
import { getNodeEnv } from "../../src/zod/env";
import * as schema from "./db/schema";

let db: ReturnType<typeof drizzle<typeof schema>> | null = null;
let databaseReadyPromise: Promise<void> | null = null;
let dbClientUrl: string = "";

export function resolveDatabaseUrl(): string {
    const env = getNodeEnv();
    if (env.databaseUrlRaw) return env.databaseUrl;

    const baseDir = app.isPackaged ? app.getPath("userData") : app.getAppPath();
    return `file:${path.join(baseDir, "dev.db")}`;
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
        })();
    }
    return databaseReadyPromise;
}

