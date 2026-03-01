// @vitest-environment node

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { hero, resource, round } from "./db/schema";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type RoundRow = {
  id: string;
  installSourceKey: string | null;
  previewImage: string | null;
};

type HeroRow = {
  id: string;
  name: string;
  author: string | null;
  description: string | null;
  phash: string | null;
};

const state = {
  heroesByName: new Map<string, HeroRow>(),
  roundsById: new Map<string, RoundRow>(),
  roundIdByInstallSourceKey: new Map<string, string>(),
  resourcesByRoundId: new Map<string, Array<{ videoUri: string; funscriptUri: string | null; phash: string | null }>>(),
  nextRoundId: 1,
  nextHeroId: 1,
};

const { getDbMock, syncExternalSourcesMock } = vi.hoisted(() => ({
  getDbMock: vi.fn(),
  syncExternalSourcesMock: vi.fn(async () => undefined),
}));

vi.mock("./dialogPathApproval", () => ({
  assertApprovedDialogPath: vi.fn((_: string, input: string) => input),
}));

vi.mock("./db", () => ({
  getDb: getDbMock,
}));

vi.mock("./integrations", () => ({
  syncExternalSources: syncExternalSourcesMock,
}));

vi.mock("./roundPreview", () => ({
  generateRoundPreviewImageDataUri: vi.fn(async () => null),
}));

vi.mock("./phash", () => ({
  generateVideoPhash: vi.fn(async () => {
    throw new Error("ffmpeg unavailable in test");
  }),
  generateVideoPhashForNormalizedRange: vi.fn(async () => {
    throw new Error("ffmpeg unavailable in test");
  }),
  getNormalizedVideoHashRange: vi.fn(async () => {
    throw new Error("no normalized range");
  }),
  toVideoHashRangeCacheKey: vi.fn((input: string) => input),
}));

function resetState(): void {
  state.heroesByName.clear();
  state.roundsById.clear();
  state.roundIdByInstallSourceKey.clear();
  state.resourcesByRoundId.clear();
  state.nextRoundId = 1;
  state.nextHeroId = 1;
}

function buildPrismaMock() {
  const db = {
    query: {
      hero: {
        findFirst: vi.fn(async () => null),
        findMany: vi.fn(async () => [...state.heroesByName.values()]),
      },
      round: {
        findFirst: vi.fn(async (input: { columns?: { id: true; previewImage: true } }) => {
          const key = extractFirstSqlParam(input);
          if (typeof key !== "string") return null;
          const id = state.roundIdByInstallSourceKey.get(key);
          if (!id) return null;
          const row = state.roundsById.get(id);
          if (!row) return null;
          return { id: row.id, previewImage: row.previewImage };
        }),
        findMany: vi.fn(async () =>
          [...state.roundsById.values()]
            .filter((entry) => Boolean(entry.installSourceKey))
            .map((entry) => ({
              id: entry.id,
              installSourceKey: entry.installSourceKey,
              previewImage: entry.previewImage,
            })),
        ),
      },
      resource: {
        findFirst: vi.fn(async () => null),
        findMany: vi.fn(async () => []),
      },
    },
    insert: vi.fn((table: unknown) => ({
      values: (input: unknown) => ({
        returning: async () => {
          if (table === round) {
            const data = input as { installSourceKey: string | null; previewImage: string | null };
            const id = `round-${state.nextRoundId++}`;
            const row: RoundRow = {
              id,
              installSourceKey: data.installSourceKey,
              previewImage: data.previewImage,
            };
            state.roundsById.set(id, row);
            if (row.installSourceKey) {
              state.roundIdByInstallSourceKey.set(row.installSourceKey, id);
            }
            return [{ id }];
          }

          if (table === resource) {
            const resources = input as Array<{
              roundId: string;
              videoUri: string;
              funscriptUri: string | null;
              phash: string | null;
            }>;
            for (const entry of resources) {
              const rows = state.resourcesByRoundId.get(entry.roundId) ?? [];
              rows.push({
                videoUri: entry.videoUri,
                funscriptUri: entry.funscriptUri,
                phash: entry.phash,
              });
              state.resourcesByRoundId.set(entry.roundId, rows);
            }
            return [];
          }

          if (table === hero) {
            const payload = input as { name: string; author?: string | null; description?: string | null; phash?: string | null };
            const id = `hero-${state.nextHeroId++}`;
            state.heroesByName.set(payload.name, {
              id,
              name: payload.name,
              author: payload.author ?? null,
              description: payload.description ?? null,
              phash: payload.phash ?? null,
            });
            return [{ id }];
          }

          return [];
        },
      }),
    })),
    update: vi.fn((table: unknown) => ({
      set: (input: { installSourceKey: string | null; previewImage: string | null }) => ({
        where: (_where: unknown) => ({
          returning: async () => {
            if (table !== round) return [];
            const id = extractFirstSqlParam(_where);
            if (typeof id !== "string") throw new Error("round not found");
            const existing = state.roundsById.get(id);
            if (!existing) throw new Error("round not found");
            const next: RoundRow = {
              ...existing,
              installSourceKey: input.installSourceKey,
              previewImage: input.previewImage,
            };
            state.roundsById.set(id, next);
            if (next.installSourceKey) {
              state.roundIdByInstallSourceKey.set(next.installSourceKey, id);
            }
            return [{ id }];
          },
        }),
      }),
    })),
    delete: vi.fn((table: unknown) => ({
      where: async (_where: unknown) => {
        if (table !== resource) return;
        const roundId = extractFirstSqlParam(_where);
        if (typeof roundId === "string") {
          state.resourcesByRoundId.set(roundId, []);
        }
      },
    })),
    transaction: vi.fn(async <T>(cb: (tx: unknown) => Promise<T>) => cb(db)),
  };

  return db;
}

function extractFirstSqlParam(input: { where?: unknown } | unknown): unknown {
  const values: unknown[] = [];

  const visit = (node: unknown) => {
    if (!node) return;
    if (Array.isArray(node)) {
      for (const entry of node) visit(entry);
      return;
    }
    if (typeof node !== "object") return;
    if ("value" in node) {
      values.push((node as { value: unknown }).value);
    }
    if ("queryChunks" in node && Array.isArray((node as { queryChunks?: unknown[] }).queryChunks)) {
      for (const chunk of (node as { queryChunks: unknown[] }).queryChunks) {
        visit(chunk);
      }
    }
    if ("where" in node) {
      visit((node as { where?: unknown }).where);
    }
  };

  visit(input);
  return values[0];
}

describe("installer legacy folder import", () => {
  beforeEach(() => {
    resetState();
    getDbMock.mockReturnValue(buildPrismaMock());
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("imports legacy files with natural filename order and returns legacy metadata", async () => {
    const { scanInstallFolderOnceWithLegacySupport } = await import("./installer");
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "f-land-legacy-"));
    await fs.writeFile(path.join(root, "10.mp4"), "video-10");
    await fs.writeFile(path.join(root, "2.mp4"), "video-2");
    await fs.writeFile(path.join(root, "1.mp4"), "video-1");
    await fs.writeFile(path.join(root, "2.funscript"), "{\"actions\":[]}");

    const result = await scanInstallFolderOnceWithLegacySupport(root);

    expect(result.status.state).toBe("done");
    expect(result.status.stats.installed).toBe(3);
    expect(result.legacyImport?.roundIds).toHaveLength(3);
    expect(result.legacyImport?.orderedSlots.map((slot) => slot.kind === "round" ? slot.ref.name : slot.label)).toEqual(["1", "2", "10"]);
    expect(result.legacyImport?.playlistNameHint).toBe(path.basename(root));
  });

  it("turns checkpoint-named legacy files into checkpoint slots when enabled", async () => {
    const { scanInstallFolderOnceWithLegacySupport } = await import("./installer");
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "f-land-legacy-checkpoint-"));
    await fs.writeFile(path.join(root, "1.mp4"), "video-1");
    await fs.writeFile(path.join(root, "25 - checkpoint.mp4"), "video-checkpoint");
    await fs.writeFile(path.join(root, "26.mp4"), "video-26");

    const result = await scanInstallFolderOnceWithLegacySupport(root, { omitCheckpointRounds: true });

    expect(result.legacyImport?.roundIds).toHaveLength(2);
    expect(result.legacyImport?.orderedSlots).toEqual([
      expect.objectContaining({ kind: "round" }),
      { kind: "checkpoint", label: "25 - checkpoint", restDurationMs: null },
      expect.objectContaining({ kind: "round" }),
    ]);
  });

  it("skips reviewed legacy slots that are excluded from import", async () => {
    const { importLegacyFolderWithPlan } = await import("./installer");
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "f-land-legacy-reviewed-"));
    const first = path.join(root, "1.mp4");
    const checkpoint = path.join(root, "2 checkpoint.mp4");
    const third = path.join(root, "3.mp4");
    await fs.writeFile(first, "video-1");
    await fs.writeFile(checkpoint, "video-checkpoint");
    await fs.writeFile(third, "video-3");

    const result = await importLegacyFolderWithPlan(root, [
      {
        id: "legacy-slot:0:1.mp4",
        sourcePath: first,
        originalOrder: 0,
        selectedAsCheckpoint: false,
        excludedFromImport: false,
      },
      {
        id: "legacy-slot:1:2 checkpoint.mp4",
        sourcePath: checkpoint,
        originalOrder: 1,
        selectedAsCheckpoint: true,
        excludedFromImport: true,
      },
      {
        id: "legacy-slot:2:3.mp4",
        sourcePath: third,
        originalOrder: 2,
        selectedAsCheckpoint: false,
        excludedFromImport: false,
      },
    ]);

    expect(result.status.state).toBe("done");
    expect(result.status.stats.installed).toBe(2);
    expect(result.legacyImport?.roundIds).toHaveLength(2);
    expect(result.legacyImport?.orderedSlots.map((slot) => slot.kind === "round" ? slot.ref.name : slot.label)).toEqual(["1", "3"]);
  });

  it("does not return legacy metadata when sidecar import already installed rounds", async () => {
    const { scanInstallFolderOnceWithLegacySupport } = await import("./installer");
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "f-land-sidecar-"));
    await fs.writeFile(path.join(root, "alpha.round"), JSON.stringify({ name: "Alpha Round" }));
    await fs.writeFile(path.join(root, "alpha.mp4"), "video-alpha");

    const result = await scanInstallFolderOnceWithLegacySupport(root);

    expect(result.status.state).toBe("done");
    expect(result.status.stats.installed).toBeGreaterThanOrEqual(1);
    expect(result.legacyImport).toBeUndefined();
  });
});
