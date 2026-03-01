// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const { getDbMock } = vi.hoisted(() => ({
  getDbMock: vi.fn(),
}));

const { exportInstalledDatabaseMock } = vi.hoisted(() => ({
  exportInstalledDatabaseMock: vi.fn(),
}));

const { getStoreMock } = vi.hoisted(() => ({
  getStoreMock: vi.fn(),
}));

vi.mock("../../services/db", () => ({
  getDb: getDbMock,
}));

vi.mock("../../services/installExport", () => ({
  exportInstalledDatabase: exportInstalledDatabaseMock,
}));

vi.mock("../../services/store", () => ({
  getStore: getStoreMock,
}));

import { dbRouter } from "./db";

type CacheRow = {
  lobbyId: string;
  finishedAt: Date;
  isFinal: boolean;
  resultsJson: unknown;
  createdAt: Date;
  updatedAt: Date;
};

type QueueRow = {
  lobbyId: string;
  createdAt: Date;
  lastAttemptAt: Date | null;
};

type SinglePlayerRunRow = {
  id: string;
  finishedAt: Date;
  score: number;
  highscoreBefore: number;
  highscoreAfter: number;
  wasNewHighscore: boolean;
  completionReason: string;
  playlistId: string | null;
  playlistName: string;
  playlistFormatVersion: number | null;
  endingPosition: number;
  turn: number;
  createdAt: Date;
};

type HeroRow = {
  id: string;
  name: string;
  author: string | null;
  description: string | null;
  createdAt: Date;
  updatedAt: Date;
};

type RoundRow = {
  id: string;
  name: string;
  author: string | null;
  description: string | null;
  bpm: number | null;
  difficulty: number | null;
  startTime: number | null;
  endTime: number | null;
  type: "Normal" | "Interjection" | "Cum";
  heroId?: string | null;
};

describe("dbRouter local highscore and multiplayer cache", () => {
  let dbMockRef: ReturnType<typeof getDbMock>;
  let storeMockRef: ReturnType<typeof getStoreMock>;
  let heroesByIdRef: Map<string, HeroRow>;
  let roundsByIdRef: Map<string, RoundRow>;

  beforeEach(() => {
    vi.clearAllMocks();
    exportInstalledDatabaseMock.mockResolvedValue({
      exportDir: "/tmp/f-land/export/2026-03-05T20-00-00.000Z",
      heroFiles: 1,
      roundFiles: 1,
      exportedRounds: 2,
      includeResourceUris: false,
    });

    const cacheByLobby = new Map<string, CacheRow>();
    const queueByLobby = new Map<string, QueueRow>();
    const singleRuns: SinglePlayerRunRow[] = [];
    heroesByIdRef = new Map<string, HeroRow>([
      ["hero-1", {
        id: "hero-1",
        name: "Hero One",
        author: "Author One",
        description: "Original hero",
        createdAt: new Date("2026-03-05T00:00:00.000Z"),
        updatedAt: new Date("2026-03-05T00:00:00.000Z"),
      }],
    ]);
    roundsByIdRef = new Map<string, RoundRow>([
      ["round-1", {
        id: "round-1",
        name: "Round One",
        author: "Round Author",
        description: "Original round",
        bpm: 120,
        difficulty: 2,
        startTime: 1000,
        endTime: 5000,
        type: "Normal",
      }],
    ]);
    let highscore = 0;
    const storeMock = {
      clear: vi.fn(),
    };

    const getTableName = (table: unknown): string | null => {
      if (!table || typeof table !== "object") return null;
      for (const symbol of Object.getOwnPropertySymbols(table)) {
        const value = (table as Record<symbol, unknown>)[symbol];
        if (typeof value === "string") {
          return value;
        }
      }
      return null;
    };

    const extractSqlParams = (input: unknown): unknown[] => {
      const values: unknown[] = [];
      const visit = (node: unknown) => {
        if (!node) return;
        if (Array.isArray(node)) {
          for (const item of node) visit(item);
          return;
        }
        if (typeof node !== "object") return;
        if ("value" in node) values.push((node as { value: unknown }).value);
        if ("queryChunks" in node && Array.isArray((node as { queryChunks?: unknown[] }).queryChunks)) {
          for (const chunk of (node as { queryChunks: unknown[] }).queryChunks) visit(chunk);
        }
      };
      visit(input);
      return values;
    };

    const dbMock = {
      query: {
        singlePlayerRunHistory: {
          findMany: vi.fn(async (input: { limit: number }) => (
            [...singleRuns]
              .sort((a, b) => b.finishedAt.getTime() - a.finishedAt.getTime())
              .slice(0, input.limit)
          )),
        },
        multiplayerMatchCache: {
          findFirst: vi.fn(async (input: { where: unknown }) => {
            const [lobbyId] = extractSqlParams(input.where);
            if (typeof lobbyId === "string") {
              return cacheByLobby.get(lobbyId) ?? null;
            }
            return cacheByLobby.values().next().value ?? null;
          }),
          findMany: vi.fn(async (input: { limit: number }) => (
            [...cacheByLobby.values()]
              .sort((a, b) => b.finishedAt.getTime() - a.finishedAt.getTime())
              .slice(0, input.limit)
          )),
        },
        resultSyncQueue: {
          findMany: vi.fn(async () => [...queueByLobby.values()].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())),
        },
        hero: {
          findFirst: vi.fn(async (input: { where: unknown }) => {
            const [value] = extractSqlParams(input.where);
            if (typeof value === "string") {
              return heroesByIdRef.get(value) ?? [...heroesByIdRef.values()].find((entry) => entry.name === value) ?? null;
            }
            return heroesByIdRef.values().next().value ?? null;
          }),
        },
        round: {
          findFirst: vi.fn(async (input: { where: unknown }) => {
            const [value] = extractSqlParams(input.where);
            if (typeof value === "string") {
              return roundsByIdRef.get(value) ?? null;
            }
            return roundsByIdRef.values().next().value ?? null;
          }),
          findMany: vi.fn(async (input: { where: unknown }) => {
            const ids = extractSqlParams(input.where).filter((value): value is string => typeof value === "string");
            if (ids.length === 0) {
              return [...roundsByIdRef.values()];
            }
            return ids
              .map((id) => roundsByIdRef.get(id))
              .filter((entry): entry is RoundRow => entry !== undefined);
          }),
        },
      },
      select: vi.fn(() => ({
        from: (table: unknown) => ({
          where: (whereClause: unknown) => {
            if (getTableName(table) === "GameProfile") {
              return {
                get: async () => (highscore > 0 ? {
                  id: "local",
                  highscore,
                  createdAt: new Date("2026-03-05T00:00:00.000Z"),
                  updatedAt: new Date("2026-03-05T00:00:00.000Z"),
                } : null),
              };
            }

            if (getTableName(table) === "Round") {
              const [heroIdValue] = extractSqlParams(whereClause);
              return Promise.resolve(
                [...roundsByIdRef.values()]
                  .filter((entry) => entry.heroId === heroIdValue)
                  .map((entry) => ({ id: entry.id })),
              );
            }

            return Promise.resolve([]);
          },
        }),
      })),
      insert: vi.fn((table: unknown) => ({
        values: (data: unknown) => ({
          onConflictDoUpdate: ({ set }: { set: Record<string, unknown> }) => ({
            returning: async () => {
              if (getTableName(table) === "GameProfile") {
                const nextHighscore = Math.max(
                  highscore,
                  Number((data as { highscore: number }).highscore ?? 0),
                  Number(set.highscore ?? 0),
                );
                highscore = nextHighscore;
                return [];
              }

              if (getTableName(table) === "MultiplayerMatchCache") {
                const input = data as CacheRow;
                const existing = cacheByLobby.get(input.lobbyId);
                const now = new Date();
                const next: CacheRow = existing
                  ? { ...existing, ...input, updatedAt: set.updatedAt as Date ?? now }
                  : { ...input, createdAt: now, updatedAt: now };
                cacheByLobby.set(next.lobbyId, next);
                return [next];
              }

              if (getTableName(table) === "ResultSyncQueue") {
                const input = data as { lobbyId: string; lastAttemptAt?: Date };
                const existing = queueByLobby.get(input.lobbyId);
                const next: QueueRow = existing
                  ? { ...existing, lastAttemptAt: (set.lastAttemptAt as Date | undefined) ?? existing.lastAttemptAt }
                  : { lobbyId: input.lobbyId, createdAt: new Date(), lastAttemptAt: input.lastAttemptAt ?? null };
                queueByLobby.set(next.lobbyId, next);
                return [next];
              }

              return [];
            },
            then: async (resolve: (value: unknown) => unknown) => {
              if (getTableName(table) !== "GameProfile") return resolve([]);
              highscore = Math.max(
                highscore,
                Number((data as { highscore: number }).highscore ?? 0),
                Number(set.highscore ?? 0),
              );
              return resolve([]);
            },
          }),
          then: async (resolve: (value: unknown) => unknown) => {
            if (getTableName(table) !== "GameProfile") return resolve([]);
            highscore = Math.max(
              highscore,
              Number((data as { highscore: number }).highscore ?? 0),
            );
            return resolve([]);
          },
          onConflictDoNothing: () => ({
            returning: async () => {
              if (getTableName(table) !== "ResultSyncQueue") return [];
              const input = data as { lobbyId: string };
              if (queueByLobby.has(input.lobbyId)) return [];
              const next: QueueRow = { lobbyId: input.lobbyId, createdAt: new Date(), lastAttemptAt: null };
              queueByLobby.set(next.lobbyId, next);
              return [next];
            },
          }),
          returning: async () => {
            if (getTableName(table) === "SinglePlayerRunHistory") {
              const row: SinglePlayerRunRow = {
                id: `run-${singleRuns.length + 1}`,
                createdAt: new Date(),
                ...(data as Omit<SinglePlayerRunRow, "id" | "createdAt">),
              };
              singleRuns.push(row);
              return [row];
            }
            return [];
          },
        }),
      })),
      update: vi.fn((table: unknown) => ({
        set: (data: Record<string, unknown>) => ({
          where: (whereClause: unknown) => ({
            then: async (resolve: (value: unknown) => unknown) => {
              const [id] = extractSqlParams(whereClause);
              if (getTableName(table) === "Hero") {
                const existing = typeof id === "string"
                  ? heroesByIdRef.get(id)
                  : heroesByIdRef.values().next().value ?? null;
                if (existing) {
                  heroesByIdRef.set(existing.id, { ...existing, ...data, updatedAt: new Date("2026-03-06T00:00:00.000Z") });
                }
              }

              if (getTableName(table) === "Round") {
                const existing = typeof id === "string"
                  ? roundsByIdRef.get(id)
                  : roundsByIdRef.values().next().value ?? null;
                if (existing) {
                  roundsByIdRef.set(existing.id, { ...existing, ...data });
                }
              }

              return resolve([]);
            },
            returning: async () => {
              const [id] = extractSqlParams(whereClause);
              if (getTableName(table) === "Hero") {
                const existing = typeof id === "string"
                  ? heroesByIdRef.get(id)
                  : heroesByIdRef.values().next().value ?? null;
                if (!existing) throw new Error("Hero not found");
                const next = { ...existing, ...data, updatedAt: new Date("2026-03-06T00:00:00.000Z") };
                heroesByIdRef.set(existing.id, next);
                return [next];
              }

              if (getTableName(table) === "Round") {
                const existing = typeof id === "string"
                  ? roundsByIdRef.get(id)
                  : roundsByIdRef.values().next().value ?? null;
                if (!existing) throw new Error("Round not found");
                const next = { ...existing, ...data };
                roundsByIdRef.set(existing.id, next);
                return [next];
              }

              return [];
            },
          }),
        }),
      })),
      delete: vi.fn((table: unknown) => ({
        where: (whereClause: unknown) => ({
          returning: async () => {
            const [value] = extractSqlParams(whereClause);
            if (getTableName(table) === "ResultSyncQueue") {
              const lobbyId = typeof value === "string" ? value : queueByLobby.keys().next().value;
              if (typeof lobbyId !== "string") return [];
              const existing = queueByLobby.get(lobbyId);
              if (!existing) return [];
              queueByLobby.delete(lobbyId);
              return [existing];
            }
            return [];
          },
          then: async (resolve: (value: unknown) => unknown) => {
            const tableName = getTableName(table);
            const values = extractSqlParams(whereClause).filter((value): value is string => typeof value === "string");
            if (tableName === "Round") {
              for (const roundId of values) {
                roundsByIdRef.delete(roundId);
              }
            }
            if (tableName === "Hero") {
              if (values.length === 0) {
                heroesByIdRef.clear();
                for (const entry of roundsByIdRef.values()) {
                  entry.heroId = null;
                }
              } else {
                for (const heroId of values) {
                  heroesByIdRef.delete(heroId);
                  for (const entry of roundsByIdRef.values()) {
                    if (entry.heroId === heroId) {
                      entry.heroId = null;
                    }
                  }
                }
              }
            }
            if (tableName === "ResultSyncQueue") {
              const lobbyIds = values.length > 0 ? values : Array.from(queueByLobby.keys());
              for (const lobbyId of lobbyIds) {
                queueByLobby.delete(lobbyId);
              }
            }
            if (tableName === "MultiplayerMatchCache") cacheByLobby.clear();
            if (tableName === "SinglePlayerRunHistory") singleRuns.length = 0;
            if (tableName === "GameProfile") highscore = 0;
            if (
              tableName === "Resource" ||
              tableName === "PlaylistTrackPlay" ||
              tableName === "Playlist" ||
              tableName === "MultiplayerMatchCache" ||
              tableName === "SinglePlayerRunHistory" ||
              tableName === "GameProfile" ||
              tableName === "Hero" ||
              tableName === "Round" ||
              tableName === "ResultSyncQueue"
            ) {
              return resolve([]);
            }
            return resolve([]);
          },
        }),
        then: async (resolve: (value: unknown) => unknown) => {
          const tableName = getTableName(table);
          if (tableName === "MultiplayerMatchCache") cacheByLobby.clear();
          if (tableName === "ResultSyncQueue") queueByLobby.clear();
          if (tableName === "SinglePlayerRunHistory") singleRuns.length = 0;
          if (tableName === "GameProfile") highscore = 0;
          if (tableName === "Hero") {
            heroesByIdRef.clear();
            for (const entry of roundsByIdRef.values()) {
              entry.heroId = null;
            }
          }
          if (tableName === "Round") roundsByIdRef.clear();
          if (
            tableName === "Resource" ||
            tableName === "PlaylistTrackPlay" ||
            tableName === "Playlist" ||
            tableName === "MultiplayerMatchCache" ||
            tableName === "SinglePlayerRunHistory" ||
            tableName === "GameProfile" ||
            tableName === "Hero" ||
            tableName === "Round" ||
            tableName === "ResultSyncQueue"
          ) {
            return resolve([]);
          }
          return resolve([]);
        },
      })),
      transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback(dbMock)),
    };

    dbMockRef = dbMock;
    storeMockRef = storeMock;
    getDbMock.mockReturnValue(dbMockRef);
    getStoreMock.mockReturnValue(storeMockRef);
  });

  it("stores and returns max local highscore", async () => {
    const caller = dbRouter.createCaller({} as never);

    expect(await caller.getLocalHighscore()).toBe(0);
    expect(await caller.setLocalHighscore({ highscore: 120 })).toBe(120);
    expect(await caller.setLocalHighscore({ highscore: 75 })).toBe(120);
    expect(await caller.getLocalHighscore()).toBe(120);
  });

  it("supports multiplayer match cache CRUD and sync queue lifecycle", async () => {
    const caller = dbRouter.createCaller({} as never);

    await caller.upsertMultiplayerMatchCache({
      lobbyId: "lobby-1",
      finishedAtIso: "2026-03-05T12:00:00.000Z",
      isFinal: false,
      resultsJson: [{ player_id: "p1" }],
    });
    await caller.upsertMultiplayerMatchCache({
      lobbyId: "lobby-2",
      finishedAtIso: "2026-03-05T13:00:00.000Z",
      isFinal: true,
      resultsJson: [{ player_id: "p2" }],
    });

    const single = await caller.getMultiplayerMatchCache({ lobbyId: "lobby-1" });
    expect(single?.lobbyId).toBe("lobby-1");
    expect(single?.isFinal).toBe(false);

    const list = await caller.listMultiplayerMatchCache({ limit: 10 });
    expect(list.map((entry) => entry.lobbyId)).toEqual(["lobby-2", "lobby-1"]);

    await caller.enqueueResultSyncLobby({ lobbyId: "lobby-1" });
    await caller.touchResultSyncLobby({ lobbyId: "lobby-1" });
    await caller.enqueueResultSyncLobby({ lobbyId: "lobby-3" });
    const queued = await caller.listResultSyncLobbies();
    expect(queued.map((entry) => entry.lobbyId)).toEqual(["lobby-1", "lobby-3"]);
    expect(queued[0]?.lastAttemptAt).toBeInstanceOf(Date);

    const deleted = await caller.removeResultSyncLobby({ lobbyId: "lobby-1" });
    expect(deleted).toHaveLength(1);
    const remaining = await caller.listResultSyncLobbies();
    expect(remaining.map((entry) => entry.lobbyId)).toEqual(["lobby-3"]);
  });

  it("stores and lists single-player run history with playlist metadata", async () => {
    const caller = dbRouter.createCaller({} as never);

    await caller.recordSinglePlayerRun({
      finishedAtIso: "2026-03-05T10:00:00.000Z",
      score: 540,
      highscoreBefore: 500,
      highscoreAfter: 540,
      wasNewHighscore: true,
      completionReason: "finished",
      playlistId: "playlist-1",
      playlistName: "Default Playlist",
      playlistFormatVersion: 1,
      endingPosition: 100,
      turn: 42,
    });
    await caller.recordSinglePlayerRun({
      finishedAtIso: "2026-03-05T09:00:00.000Z",
      score: 320,
      highscoreBefore: 540,
      highscoreAfter: 540,
      wasNewHighscore: false,
      completionReason: "self_reported_cum",
      playlistId: "playlist-2",
      playlistName: "Alt Playlist",
      playlistFormatVersion: 1,
      endingPosition: 74,
      turn: 28,
    });

    const runs = await caller.listSinglePlayerRuns({ limit: 10 });
    expect(runs).toHaveLength(2);
    expect(runs[0]?.playlistName).toBe("Default Playlist");
    expect(runs[0]?.score).toBe(540);
    expect(runs[0]?.wasNewHighscore).toBe(true);
    expect(runs[1]?.completionReason).toBe("self_reported_cum");
  });

  it("updates hero metadata with unique-name protection", async () => {
    const caller = dbRouter.createCaller({} as never);

    await expect(caller.updateHero({
      id: "hero-1",
      name: "Hero Prime",
      author: "New Author",
      description: "Updated hero",
    })).resolves.toMatchObject({
      id: "hero-1",
      name: "Hero Prime",
      author: "New Author",
      description: "Updated hero",
    });
  });

  it("deletes a hero entry and detaches attached rounds", async () => {
    const caller = dbRouter.createCaller({} as never);

    roundsByIdRef.set("round-hero", {
      id: "round-hero",
      name: "Hero Round",
      author: "Round Author",
      description: "Attached round",
      bpm: 120,
      difficulty: 2,
      startTime: 1000,
      endTime: 5000,
      type: "Normal",
      heroId: "hero-1",
    });

    await expect(caller.deleteHero({ id: "hero-1" })).resolves.toEqual({ deleted: true });

    expect(heroesByIdRef.has("hero-1")).toBe(false);
    expect(roundsByIdRef.get("round-hero")?.heroId).toBeNull();
  });

  it("updates round metadata and validates time order", async () => {
    const caller = dbRouter.createCaller({} as never);

    await expect(caller.updateRound({
      id: "round-1",
      name: "Round Prime",
      author: "Editor",
      description: "Updated round",
      bpm: 132,
      difficulty: 4,
      startTime: 2000,
      endTime: 6000,
      type: "Cum",
    })).resolves.toMatchObject({
      id: "round-1",
      name: "Round Prime",
      type: "Cum",
      bpm: 132,
      difficulty: 4,
    });

    await expect(caller.updateRound({
      id: "round-1",
      name: "Broken",
      author: null,
      description: null,
      bpm: null,
      difficulty: null,
      startTime: 4000,
      endTime: 3000,
      type: "Normal",
    })).rejects.toThrow("greater than start time");
  });

  it("deletes a round entry", async () => {
    const caller = dbRouter.createCaller({} as never);

    await expect(caller.deleteRound({ id: "round-1" })).resolves.toEqual({ deleted: true });
    expect(roundsByIdRef.has("round-1")).toBe(false);
  });

  it("converts a hero group back to a standalone round by renaming the kept round and clearing timing", async () => {
    const caller = dbRouter.createCaller({} as never);

    roundsByIdRef.set("round-1", {
      id: "round-1",
      name: "Hero One - round 1",
      author: "Round Author",
      description: "Original round",
      bpm: 120,
      difficulty: 2,
      startTime: 1000,
      endTime: 5000,
      type: "Normal",
      heroId: "hero-1",
    });
    roundsByIdRef.set("round-2", {
        id: "round-2",
        name: "Hero One - round 2",
        author: "Round Author",
        description: "Original round 2",
        bpm: 120,
        difficulty: 2,
        startTime: 6000,
        endTime: 9000,
        type: "Normal",
        heroId: "hero-1",
      });

    await expect(caller.convertHeroGroupToRound({
      keepRoundId: "round-1",
      roundIds: ["round-1", "round-2"],
      heroId: "hero-1",
      roundName: "Hero One",
    })).resolves.toMatchObject({
      keptRoundId: "round-1",
      removedRoundCount: 1,
      deletedHero: true,
    });

    expect(roundsByIdRef.get("round-1")).toMatchObject({
      heroId: null,
      name: "Hero One",
      startTime: null,
      endTime: null,
    });
    expect(roundsByIdRef.has("round-2")).toBe(false);
  });

  it("exports installed database with default URI mode disabled and supports explicit enable", async () => {
    const caller = dbRouter.createCaller({} as never);

    const defaultResult = await caller.exportInstalledDatabase();
    expect(defaultResult.includeResourceUris).toBe(false);
    expect(exportInstalledDatabaseMock).toHaveBeenCalledWith({ includeResourceUris: false });

    await caller.exportInstalledDatabase({ includeResourceUris: true });
    expect(exportInstalledDatabaseMock).toHaveBeenLastCalledWith({ includeResourceUris: true });
  });

  it("clears persisted database rows and store state", async () => {
    const caller = dbRouter.createCaller({} as never);

    await caller.recordSinglePlayerRun({
      finishedAtIso: "2026-03-05T10:00:00.000Z",
      score: 540,
      highscoreBefore: 500,
      highscoreAfter: 540,
      wasNewHighscore: true,
      completionReason: "finished",
      playlistId: "playlist-1",
      playlistName: "Default Playlist",
      playlistFormatVersion: 1,
      endingPosition: 100,
      turn: 42,
    });
    await caller.upsertMultiplayerMatchCache({
      lobbyId: "lobby-1",
      finishedAtIso: "2026-03-05T12:00:00.000Z",
      isFinal: true,
      resultsJson: [{ player_id: "p1" }],
    });
    await caller.enqueueResultSyncLobby({ lobbyId: "lobby-1" });
    await caller.setLocalHighscore({ highscore: 120 });

    await expect(caller.clearAllData()).resolves.toEqual({ cleared: true });

    expect(dbMockRef.transaction).toHaveBeenCalledTimes(1);
    expect(storeMockRef.clear).toHaveBeenCalledTimes(1);
    await expect(caller.getLocalHighscore()).resolves.toBe(0);
    await expect(caller.listSinglePlayerRuns({ limit: 10 })).resolves.toHaveLength(0);
    await expect(caller.listMultiplayerMatchCache({ limit: 10 })).resolves.toHaveLength(0);
    await expect(caller.listResultSyncLobbies()).resolves.toHaveLength(0);
  });
});
