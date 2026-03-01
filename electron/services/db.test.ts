// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  app: {
    isPackaged: false,
    getAppPath: () => "/tmp/f-land",
    getPath: () => "/tmp/f-land",
  },
}));

import { repairSinglePlayerRunSaveSchema, resolveDatabaseUrl } from "./db";

type ExecuteResult = {
  rows: Array<Record<string, unknown>>;
};

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
          rows: [
            { name: "id" },
            { name: "playlistId" },
          ],
        };
      }
      if (sql.includes('PRAGMA index_list("SinglePlayerRunSave")')) {
        return { rows: [] };
      }
      return { rows: [] };
    });

    await repairSinglePlayerRunSaveSchema(dbInstance);

    expect(execute).toHaveBeenCalledWith(
      expect.stringContaining('ALTER TABLE "SinglePlayerRunSave" ADD COLUMN "playlistName" text'),
    );
    expect(execute).toHaveBeenCalledWith(
      expect.stringContaining('ALTER TABLE "SinglePlayerRunSave" ADD COLUMN "snapshotJson" text'),
    );
    expect(execute).toHaveBeenCalledWith(
      expect.stringContaining('DELETE FROM "SinglePlayerRunSave"'),
    );
    expect(execute).toHaveBeenCalledWith(
      expect.stringContaining('CREATE UNIQUE INDEX "SinglePlayerRunSave_playlistId_unique"'),
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
      expect.stringContaining('CREATE TABLE "SinglePlayerRunSave"'),
    );
    expect(execute).toHaveBeenCalledWith(
      expect.stringContaining('CREATE UNIQUE INDEX "SinglePlayerRunSave_playlistId_unique"'),
    );
  });
});

describe("resolveDatabaseUrl", () => {
  it("uses the app storage base dir when no DATABASE_URL is configured", () => {
    vi.unstubAllEnvs();
    expect(resolveDatabaseUrl()).toBe("file:/tmp/f-land/dev.db");
  });
});
