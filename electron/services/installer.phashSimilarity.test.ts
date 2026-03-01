// @vitest-environment node

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { hero, resource, round } from "./db/schema";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toLocalMediaUri } from "./localMedia";

type RoundRow = {
  id: string;
  installSourceKey: string | null;
  previewImage: string | null;
  difficulty: number | null;
  excludeFromRandom: boolean;
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
  resourcesByRoundId: new Map<string, Array<{ videoUri: string; phash: string | null }>>(),
  resourceRows: [] as Array<{
    roundId: string;
    videoUri: string;
    funscriptUri: string | null;
    phash: string | null;
  }>,
  nextRoundId: 1,
  nextHeroId: 1,
};

const {
  getDbMock,
  syncExternalSourcesMock,
  generateVideoPhashMock,
  generateVideoPhashForNormalizedRangeMock,
  getNormalizedVideoHashRangeMock,
  toVideoHashRangeCacheKeyMock,
  generateRoundPreviewImageDataUriMock,
  calculateFunscriptDifficultyFromUriMock,
} = vi.hoisted(() => ({
  getDbMock: vi.fn(),
  syncExternalSourcesMock: vi.fn(async () => undefined),
  generateVideoPhashMock: vi.fn(),
  generateVideoPhashForNormalizedRangeMock: vi.fn(),
  getNormalizedVideoHashRangeMock: vi.fn(),
  toVideoHashRangeCacheKeyMock: vi.fn((input: string) => input),
  generateRoundPreviewImageDataUriMock: vi.fn(async () => null),
  calculateFunscriptDifficultyFromUriMock: vi.fn(async () => null),
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
  generateRoundPreviewImageDataUri: generateRoundPreviewImageDataUriMock,
}));

vi.mock("./phash", () => ({
  generateVideoPhash: generateVideoPhashMock,
  generateVideoPhashForNormalizedRange: generateVideoPhashForNormalizedRangeMock,
  getNormalizedVideoHashRange: getNormalizedVideoHashRangeMock,
  toVideoHashRangeCacheKey: toVideoHashRangeCacheKeyMock,
}));

vi.mock("./funscript", () => ({
  calculateFunscriptDifficultyFromUri: calculateFunscriptDifficultyFromUriMock,
}));

function resetState(): void {
  state.heroesByName.clear();
  state.roundsById.clear();
  state.roundIdByInstallSourceKey.clear();
  state.resourcesByRoundId.clear();
  state.resourceRows = [];
  state.nextRoundId = 1;
  state.nextHeroId = 1;
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

function rememberResources(
  resources: Array<{
    roundId: string;
    videoUri: string;
    funscriptUri: string | null;
    phash: string | null;
  }>
): void {
  for (const entry of resources) {
    const rows = state.resourcesByRoundId.get(entry.roundId) ?? [];
    rows.push({ videoUri: entry.videoUri, phash: entry.phash });
    state.resourcesByRoundId.set(entry.roundId, rows);
    state.resourceRows.push(entry);
  }
}

function buildDbMock() {
  const db = {
    query: {
      hero: {
        findFirst: vi.fn(async () => null),
        findMany: vi.fn(async () => [...state.heroesByName.values()]),
      },
      round: {
        findFirst: vi.fn(async (input: { where?: unknown }) => {
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
              resources: [],
            }))
        ),
      },
      resource: {
        findFirst: vi.fn(async (input: { where?: unknown }) => {
          const phash = extractFirstSqlParam(input);
          if (typeof phash !== "string") return null;
          const existing = state.resourceRows.find((row) => row.phash === phash);
          return existing ? { videoUri: existing.videoUri } : null;
        }),
        findMany: vi.fn(async () => {
          return state.resourceRows
            .filter((row) => typeof row.phash === "string" && row.phash.length > 0)
            .map((row) => ({ videoUri: row.videoUri, phash: row.phash }));
        }),
      },
    },
    insert: vi.fn((table: unknown) => ({
      values: (input: unknown) => {
        if (table === resource && Array.isArray(input)) {
          rememberResources(
            input.map((entry) => ({
              roundId: entry.roundId,
              videoUri: entry.videoUri,
              funscriptUri: entry.funscriptUri ?? null,
              phash: entry.phash,
            }))
          );
        }

        return {
          returning: async () => {
            if (table === round) {
              const payload = input as {
                installSourceKey: string | null;
                previewImage: string | null;
                difficulty: number | null;
                excludeFromRandom?: boolean;
              };
              const id = `round-${state.nextRoundId++}`;
              state.roundsById.set(id, {
                id,
                installSourceKey: payload.installSourceKey,
                previewImage: payload.previewImage,
                difficulty: payload.difficulty ?? null,
                excludeFromRandom: payload.excludeFromRandom ?? false,
              });
              if (payload.installSourceKey) {
                state.roundIdByInstallSourceKey.set(payload.installSourceKey, id);
              }
              return [{ id }];
            }

            if (table === resource) {
              if (Array.isArray(input)) {
                return [];
              }
              const payload = input as {
                roundId: string;
                videoUri: string;
                funscriptUri?: string | null;
                phash: string | null;
              };
              rememberResources([
                {
                  roundId: payload.roundId,
                  videoUri: payload.videoUri,
                  funscriptUri: payload.funscriptUri ?? null,
                  phash: payload.phash,
                },
              ]);
              return [
                {
                  id: `res-${state.resourceRows.length}`,
                  roundId: payload.roundId,
                  videoUri: payload.videoUri,
                  phash: payload.phash,
                  disabled: false,
                },
              ];
            }

            if (table === hero) {
              const payload = input as {
                name: string;
                author?: string | null;
                description?: string | null;
                phash?: string | null;
              };
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
        };
      },
    })),
    update: vi.fn((table: unknown) => ({
      set: vi.fn((input: unknown) => ({
        where: vi.fn((where: unknown) => ({
          returning: vi.fn(async () => {
            if (table !== round) return [];
            const id = extractFirstSqlParam(where);
            const inputInstallSourceKey = (input as { installSourceKey: string | null })
              .installSourceKey;
            const targetId =
              typeof id === "string" && state.roundsById.has(id)
                ? id
                : inputInstallSourceKey
                  ? state.roundIdByInstallSourceKey.get(inputInstallSourceKey)
                  : undefined;
            if (!targetId) return [];
            const existing = state.roundsById.get(targetId);
            if (!existing) return [];
            state.roundsById.set(targetId, {
              ...existing,
              installSourceKey: inputInstallSourceKey,
              previewImage: (input as { previewImage: string | null }).previewImage,
              difficulty:
                (input as { difficulty?: number | null }).difficulty ?? existing.difficulty,
              excludeFromRandom:
                (input as { excludeFromRandom?: boolean }).excludeFromRandom ??
                existing.excludeFromRandom,
            });
            return [{ id: targetId }];
          }),
        })),
      })),
    })),
    delete: vi.fn((table: unknown) => ({
      where: async (input: unknown) => {
        if (table !== resource) return;
        const roundId = extractFirstSqlParam(input);
        if (typeof roundId !== "string") return;
        state.resourcesByRoundId.set(roundId, []);
        state.resourceRows = state.resourceRows.filter((row) => row.roundId !== roundId);
      },
    })),
    transaction: vi.fn(async <T>(cb: (tx: unknown) => Promise<T>) => cb(db)),
  };

  return db;
}

describe("installer phash similarity", () => {
  beforeEach(() => {
    resetState();
    getDbMock.mockReturnValue(buildDbMock());
    generateRoundPreviewImageDataUriMock.mockImplementation(async () => null);
    generateVideoPhashForNormalizedRangeMock.mockImplementation(async () => {
      throw new Error("no normalized range hash");
    });
    getNormalizedVideoHashRangeMock.mockImplementation(async () => {
      throw new Error("no normalized range");
    });
    toVideoHashRangeCacheKeyMock.mockImplementation((input: string) => input);
    calculateFunscriptDifficultyFromUriMock.mockResolvedValue(null);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("reuses canonical video URI when imported phash is similar", async () => {
    generateVideoPhashMock.mockImplementation(async (videoPath: string) => {
      if (videoPath.endsWith("1.mp4")) return "0";
      if (videoPath.endsWith("2.mp4")) return "3ff";
      throw new Error(`Unexpected path: ${videoPath}`);
    });

    const { scanInstallFolderOnceWithLegacySupport } = await import("./installer");
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "f-land-installer-phash-sim-"));
    await fs.writeFile(path.join(root, "1.mp4"), "video-1");
    await fs.writeFile(path.join(root, "2.mp4"), "video-2");

    const result = await scanInstallFolderOnceWithLegacySupport(root);
    const roundIds = result.legacyImport?.roundIds ?? [];
    expect(roundIds).toHaveLength(2);

    const firstRoundResource = state.resourcesByRoundId.get(roundIds[0] ?? "")?.[0];
    const secondRoundResource = state.resourcesByRoundId.get(roundIds[1] ?? "")?.[0];
    expect(firstRoundResource?.videoUri).toBeTruthy();
    expect(secondRoundResource?.videoUri).toBe(firstRoundResource?.videoUri);
    const db = getDbMock.mock.results[0]?.value;
    expect(db?.query.resource.findMany).toHaveBeenCalledTimes(2);
    expect(db?.query.resource.findFirst).not.toHaveBeenCalled();
  });

  it("shares phash work across concurrent hero rounds with the same source range", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "f-land-installer-shared-phash-"));
    const videoPath = path.join(root, "shared.mp4");
    const heroPath = path.join(root, "shared.hero");
    await fs.writeFile(videoPath, "video");
    await fs.writeFile(
      heroPath,
      JSON.stringify({
        name: "Shared Hero",
        rounds: [
          {
            name: "Round 1",
            startTime: 0,
            endTime: 5000,
            resources: [{ videoUri: `app://media/${encodeURIComponent(videoPath)}` }],
          },
          {
            name: "Round 2",
            startTime: 0,
            endTime: 5000,
            resources: [{ videoUri: `app://media/${encodeURIComponent(videoPath)}` }],
          },
        ],
      })
    );

    getNormalizedVideoHashRangeMock.mockResolvedValue({
      durationMs: 10000,
      startTimeMs: 0,
      endTimeMs: 5000,
      isFullVideo: false,
    });
    generateVideoPhashForNormalizedRangeMock.mockImplementation(async () => "shared-hash");

    const { importInstallSidecarFile } = await import("./installer");
    const result = await importInstallSidecarFile(heroPath);

    expect(result.status.stats.installed).toBe(2);
    expect(getNormalizedVideoHashRangeMock).toHaveBeenCalledTimes(1);
    expect(generateVideoPhashForNormalizedRangeMock).toHaveBeenCalledTimes(1);
  });

  it("shares preview generation across concurrent hero rounds with the same source range", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "f-land-installer-shared-preview-"));
    const videoPath = path.join(root, "shared.mp4");
    const heroPath = path.join(root, "shared.hero");
    await fs.writeFile(videoPath, "video");
    await fs.writeFile(
      heroPath,
      JSON.stringify({
        name: "Shared Preview Hero",
        rounds: [
          {
            name: "Round 1",
            startTime: 1000,
            endTime: 4000,
            phash: "explicit-hash-1",
            resources: [{ videoUri: `app://media/${encodeURIComponent(videoPath)}` }],
          },
          {
            name: "Round 2",
            startTime: 1000,
            endTime: 4000,
            phash: "explicit-hash-2",
            resources: [{ videoUri: `app://media/${encodeURIComponent(videoPath)}` }],
          },
        ],
      })
    );

    getNormalizedVideoHashRangeMock.mockResolvedValue({
      durationMs: 10000,
      startTimeMs: 1000,
      endTimeMs: 4000,
      isFullVideo: false,
    });
    generateRoundPreviewImageDataUriMock.mockImplementation(async () => "preview-data");

    const { importInstallSidecarFile } = await import("./installer");
    const result = await importInstallSidecarFile(heroPath);

    expect(result.status.stats.installed).toBe(2);
    expect(generateRoundPreviewImageDataUriMock).toHaveBeenCalledTimes(1);
  });

  it("resolves relative .round resource paths against the sidecar location", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "f-land-installer-relative-round-"));
    const mediaDir = path.join(root, "media");
    await fs.mkdir(mediaDir, { recursive: true });
    const videoPath = path.join(mediaDir, "portable.mp4");
    const funscriptPath = path.join(mediaDir, "portable.funscript");
    const roundPath = path.join(root, "portable.round");
    await fs.writeFile(videoPath, "video");
    await fs.writeFile(funscriptPath, '{"actions":[]}');
    await fs.writeFile(
      roundPath,
      JSON.stringify({
        name: "Portable Round",
        phash: "portable-round-hash",
        resources: [
          {
            videoUri: "./media/portable.mp4",
            funscriptUri: "./media/portable.funscript",
          },
        ],
      })
    );

    const { importInstallSidecarFile } = await import("./installer");
    const result = await importInstallSidecarFile(roundPath);

    expect(result.status.stats.installed).toBe(1);
    expect(state.resourceRows[0]?.videoUri).toBe(toLocalMediaUri(videoPath));
    expect(state.resourceRows[0]?.funscriptUri).toBe(toLocalMediaUri(funscriptPath));
  });

  it("imports optional random exclusion from .round sidecars", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "f-land-installer-excluded-round-"));
    const roundPath = path.join(root, "portable.round");
    await fs.writeFile(
      roundPath,
      JSON.stringify({
        name: "Portable Round",
        excludeFromRandom: true,
        resources: [],
      })
    );

    const { importInstallSidecarFile } = await import("./installer");
    const result = await importInstallSidecarFile(roundPath);

    expect(result.status.stats.installed).toBe(1);
    expect(state.roundsById.get("round-1")?.excludeFromRandom).toBe(true);
  });

  it("imports random exclusion per .hero round entry", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "f-land-installer-excluded-hero-"));
    const heroPath = path.join(root, "portable.hero");
    await fs.writeFile(
      heroPath,
      JSON.stringify({
        name: "Portable Hero",
        rounds: [
          {
            name: "Round A",
            excludeFromRandom: true,
            resources: [],
          },
          {
            name: "Round B",
            resources: [],
          },
        ],
      })
    );

    const { importInstallSidecarFile } = await import("./installer");
    const result = await importInstallSidecarFile(heroPath);

    expect(result.status.stats.installed).toBe(2);
    expect(state.roundsById.get("round-1")?.excludeFromRandom).toBe(true);
    expect(state.roundsById.get("round-2")?.excludeFromRandom).toBe(false);
  });

  it("preserves missing random exclusion on update and clears explicit false", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "f-land-installer-exclusion-update-"));
    const roundPath = path.join(root, "portable.round");
    await fs.writeFile(
      roundPath,
      JSON.stringify({
        name: "Portable Round",
        excludeFromRandom: true,
        resources: [],
      })
    );

    const { importInstallSidecarFile } = await import("./installer");
    const currentRound = () =>
      state.roundsById.get(state.roundIdByInstallSourceKey.get(roundPath) ?? "");
    await importInstallSidecarFile(roundPath);
    expect(currentRound()?.excludeFromRandom).toBe(true);

    await fs.writeFile(
      roundPath,
      JSON.stringify({
        name: "Portable Round",
        resources: [],
      })
    );
    await importInstallSidecarFile(roundPath);
    expect(currentRound()?.excludeFromRandom).toBe(true);

    await fs.writeFile(
      roundPath,
      JSON.stringify({
        name: "Portable Round",
        excludeFromRandom: false,
        resources: [],
      })
    );
    await importInstallSidecarFile(roundPath);
    expect(currentRound()?.excludeFromRandom).toBe(false);
  });

  it("calculates missing difficulty from an attached funscript during import", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "f-land-installer-difficulty-"));
    const mediaDir = path.join(root, "media");
    await fs.mkdir(mediaDir, { recursive: true });
    const videoPath = path.join(mediaDir, "portable.mp4");
    const funscriptPath = path.join(mediaDir, "portable.funscript");
    const roundPath = path.join(root, "portable.round");
    await fs.writeFile(videoPath, "video");
    await fs.writeFile(funscriptPath, '{"actions":[{"at":0,"pos":0},{"at":1000,"pos":100}]}');
    await fs.writeFile(
      roundPath,
      JSON.stringify({
        name: "Portable Round",
        resources: [
          { videoUri: "./media/portable.mp4", funscriptUri: "./media/portable.funscript" },
        ],
      })
    );
    calculateFunscriptDifficultyFromUriMock.mockResolvedValue(4);

    const { importInstallSidecarFile } = await import("./installer");
    const result = await importInstallSidecarFile(roundPath);

    expect(result.status.stats.installed).toBe(1);
    expect(calculateFunscriptDifficultyFromUriMock).toHaveBeenCalledWith(
      toLocalMediaUri(funscriptPath)
    );
    expect(state.roundsById.get("round-1")?.difficulty).toBe(4);
  });

  it("keeps explicit difficulty when the sidecar already provides it", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "f-land-installer-explicit-difficulty-"));
    const mediaDir = path.join(root, "media");
    await fs.mkdir(mediaDir, { recursive: true });
    const videoPath = path.join(mediaDir, "portable.mp4");
    const funscriptPath = path.join(mediaDir, "portable.funscript");
    const roundPath = path.join(root, "portable.round");
    await fs.writeFile(videoPath, "video");
    await fs.writeFile(funscriptPath, '{"actions":[{"at":0,"pos":0},{"at":1000,"pos":100}]}');
    await fs.writeFile(
      roundPath,
      JSON.stringify({
        name: "Portable Round",
        difficulty: 2,
        resources: [
          { videoUri: "./media/portable.mp4", funscriptUri: "./media/portable.funscript" },
        ],
      })
    );

    const { importInstallSidecarFile } = await import("./installer");
    const result = await importInstallSidecarFile(roundPath);

    expect(result.status.stats.installed).toBe(1);
    expect(calculateFunscriptDifficultyFromUriMock).not.toHaveBeenCalled();
    expect(state.roundsById.get("round-1")?.difficulty).toBe(2);
  });

  it("resolves relative .hero resource paths against nested sidecar locations", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "f-land-installer-relative-hero-"));
    const mediaDir = path.join(root, "media");
    const sidecarDir = path.join(root, "sidecars");
    await fs.mkdir(mediaDir, { recursive: true });
    await fs.mkdir(sidecarDir, { recursive: true });
    const videoPath = path.join(mediaDir, "portable-hero.mp4");
    const heroPath = path.join(sidecarDir, "portable.hero");
    await fs.writeFile(videoPath, "video");
    await fs.writeFile(
      heroPath,
      JSON.stringify({
        name: "Portable Hero",
        rounds: [
          {
            name: "Round A",
            phash: "portable-hero-a",
            resources: [{ videoUri: "../media/portable-hero.mp4" }],
          },
          {
            name: "Round B",
            phash: "portable-hero-b",
            resources: [{ videoUri: "../media/portable-hero.mp4" }],
          },
        ],
      })
    );

    const { importInstallSidecarFile } = await import("./installer");
    const result = await importInstallSidecarFile(heroPath);

    expect(result.status.stats.installed).toBe(2);
    expect(state.resourceRows).toHaveLength(2);
    expect(state.resourceRows.every((entry) => entry.videoUri === toLocalMediaUri(videoPath))).toBe(
      true
    );
  });

  it("marks website-backed hero rounds as web when the sidecar uses proxy video URIs", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "f-land-installer-web-hero-"));
    const heroPath = path.join(root, "website.hero");
    await fs.writeFile(
      heroPath,
      JSON.stringify({
        name: "Website Hero",
        rounds: [
          {
            name: "Round A",
            phash: "website-hero-a",
            resources: [
              {
                videoUri: "app://external/web-url?target=https%3A%2F%2Fexample.com%2Fwatch%3Fv%3Da",
              },
            ],
          },
          {
            name: "Round B",
            phash: "website-hero-b",
            resources: [
              {
                videoUri: "app://external/web-url?target=https%3A%2F%2Fexample.com%2Fwatch%3Fv%3Db",
              },
            ],
          },
        ],
      })
    );

    const { importInstallSidecarFile } = await import("./installer");
    const result = await importInstallSidecarFile(heroPath);

    expect(result.status.stats.installed).toBe(2);
    const keys = Array.from(state.roundIdByInstallSourceKey.keys());
    expect(keys).toHaveLength(2);
    expect(keys[0]).toMatch(/^website:/);
    expect(keys[1]).toMatch(/^website:/);
  });

  it("persists sidecars in sorted order even when preparation completes out of order", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "f-land-installer-order-"));
    const aPath = path.join(root, "a.round");
    const bPath = path.join(root, "b.round");

    await fs.writeFile(
      aPath,
      JSON.stringify({
        name: "A",
        phash: "phash-a",
        resources: [{ videoUri: "https://example.com/a.mp4" }],
      })
    );
    await fs.writeFile(
      bPath,
      JSON.stringify({
        name: "B",
        phash: "phash-b",
        resources: [{ videoUri: "https://example.com/b.mp4" }],
      })
    );

    generateRoundPreviewImageDataUriMock.mockImplementation(
      async ({ videoUri }: { videoUri: string }) => {
        if (videoUri.endsWith("/a.mp4")) {
          await new Promise((resolve) => setTimeout(resolve, 20));
        } else {
          await new Promise((resolve) => setTimeout(resolve, 1));
        }
        return null;
      }
    );

    const { scanInstallSources } = await import("./installer");
    const result = await scanInstallSources("manual", [root]);

    expect(result.stats.installed).toBe(2);
    const keys = Array.from(state.roundIdByInstallSourceKey.keys());
    expect(keys).toHaveLength(2);
    expect(keys[0]).toMatch(/^website:/);
    expect(keys[1]).toMatch(/^website:/);
  });
});
