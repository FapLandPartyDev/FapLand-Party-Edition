// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExternalSource } from "./types";

type CachedResourceRow = {
  id: string;
  videoUri: string;
  phash: string | null;
  disabled: boolean;
};

type CachedRoundRow = {
  id: string;
  name: string;
  author: string | null;
  description: string | null;
  phash: string | null;
  previewImage: string | null;
  installSourceKey: string | null;
  resources: CachedResourceRow[];
};

const {
  getDbMock,
  listExternalSourcesMock,
  getDisabledRoundIdsMock,
  getIntegrationSyncStatusMock,
  setIntegrationSyncStatusMock,
  setDisabledRoundIdsMock,
  sourcePrefixForManagedRoundsMock,
  toStashInstallSourceKeyMock,
  syncSourceMock,
  normalizeBaseUrlMock,
} = vi.hoisted(() => ({
  getDbMock: vi.fn(),
  listExternalSourcesMock: vi.fn(),
  getDisabledRoundIdsMock: vi.fn(),
  getIntegrationSyncStatusMock: vi.fn(),
  setIntegrationSyncStatusMock: vi.fn(),
  setDisabledRoundIdsMock: vi.fn(),
  sourcePrefixForManagedRoundsMock: vi.fn(),
  toStashInstallSourceKeyMock: vi.fn(),
  syncSourceMock: vi.fn(),
  normalizeBaseUrlMock: vi.fn(),
}));

vi.mock("../db", () => ({
  getDb: getDbMock,
}));

vi.mock("../roundPreview", () => ({
  generateRoundPreviewImageDataUri: vi.fn(async () => null),
}));

vi.mock("./providers/stashProvider", () => ({
  stashProvider: {
    kind: "stash",
    canHandleUri: vi.fn(() => true),
    resolvePlayableUri: vi.fn((uri: string) => uri),
    syncSource: syncSourceMock,
  },
}));

vi.mock("./stashClient", () => ({
  fetchStashMediaWithAuth: vi.fn(),
  searchStashTags: vi.fn(),
  testStashConnection: vi.fn(async () => ({ ok: true })),
  toNormalizedPhash: vi.fn((value: string | null | undefined) => {
    if (typeof value !== "string") return null;
    const normalized = value.trim().toLowerCase();
    return normalized.length > 0 ? normalized : null;
  }),
}));

vi.mock("./store", () => ({
  createEmptyIntegrationSyncStatus: vi.fn(() => ({
    state: "idle",
    triggeredBy: "manual",
    startedAt: null,
    finishedAt: null,
    stats: {
      sourcesSeen: 0,
      sourcesSynced: 0,
      scenesSeen: 0,
      roundsCreated: 0,
      roundsUpdated: 0,
      roundsLinked: 0,
      resourcesAdded: 0,
      disabledRounds: 0,
      failed: 0,
    },
    lastMessage: null,
    lastErrors: [],
  })),
  createStashSource: vi.fn(),
  deleteExternalSource: vi.fn(),
  getDisabledRoundIds: getDisabledRoundIdsMock,
  getExternalSourceById: vi.fn(),
  getIntegrationSyncStatus: getIntegrationSyncStatusMock,
  listExternalSources: listExternalSourcesMock,
  normalizeBaseUrl: normalizeBaseUrlMock,
  setDisabledRoundIds: setDisabledRoundIdsMock,
  setExternalSourceEnabled: vi.fn(),
  setIntegrationSyncStatus: setIntegrationSyncStatusMock,
  sourcePrefixForManagedRounds: sourcePrefixForManagedRoundsMock,
  toStashInstallSourceKey: toStashInstallSourceKeyMock,
  updateStashSource: vi.fn(),
}));

function createDbMock(initialRounds: CachedRoundRow[]) {
  let nextRoundId = 100;
  let nextResourceId = 200;
  const rounds = initialRounds.map((entry) => ({
    ...entry,
    resources: [...entry.resources],
  }));

  const db = {
    query: {
      hero: {
        findMany: vi.fn(async () => []),
      },
      round: {
        findMany: vi.fn(async (input: { columns?: { id: true }; with?: unknown } | undefined) => {
          if (input?.with) {
            return rounds.map((entry) => ({
              id: entry.id,
              name: entry.name,
              author: entry.author,
              description: entry.description,
              phash: entry.phash,
              previewImage: entry.previewImage,
              installSourceKey: entry.installSourceKey,
              resources: entry.resources.map((res) => ({
                id: res.id,
                videoUri: res.videoUri,
                phash: res.phash,
                disabled: res.disabled,
              })),
            }));
          }

          if (input?.columns?.id) {
            return rounds
              .filter((entry) => (entry.installSourceKey ?? "").startsWith("stash:"))
              .map((entry) => ({ id: entry.id }));
          }

          return [];
        }),
      },
    },
    insert: vi.fn((table: unknown) => ({
      values: (input: unknown) => ({
        returning: async () => {
          if (typeof input === "object" && input !== null && "roundId" in input) {
            const payload = input as {
              roundId: string;
              videoUri: string;
              funscriptUri: string | null;
              phash: string | null;
              disabled: boolean;
            };
            const created = {
              id: `res-${nextResourceId++}`,
              videoUri: payload.videoUri,
              phash: payload.phash,
              disabled: payload.disabled,
            };
            const targetRound = rounds.find((entry) => entry.id === payload.roundId);
            if (targetRound) {
              targetRound.resources.push(created);
            }
            return [created];
          }

          if (typeof input === "object" && input !== null && "installSourceKey" in input) {
            const payload = input as {
              name: string;
              author: string | null;
              description: string | null;
              phash: string | null;
              previewImage: string | null;
              type: string | null;
              heroId: string | null;
              installSourceKey: string | null;
            };
            const created = {
              id: `round-${nextRoundId++}`,
              name: payload.name,
              author: payload.author,
              description: payload.description,
              phash: payload.phash,
              previewImage: payload.previewImage,
              installSourceKey: payload.installSourceKey,
              resources: [] as CachedResourceRow[],
            };
            rounds.push(created);
            return [created];
          }

          return [];
        },
      }),
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(async () => []),
      })),
    })),
  };

  return db;
}

function makeSource(): ExternalSource {
  return {
    id: "source-1",
    kind: "stash",
    name: "Stash",
    enabled: true,
    baseUrl: "https://stash.example",
    authMode: "apiKey",
    apiKey: "abc",
    username: null,
    password: null,
    tagSelections: [],
    createdAt: "2026-03-09T00:00:00.000Z",
    updatedAt: "2026-03-09T00:00:00.000Z",
  };
}

function makeIdleStatus() {
  return {
    state: "idle" as const,
    triggeredBy: "manual" as const,
    startedAt: null,
    finishedAt: null,
    stats: {
      sourcesSeen: 0,
      sourcesSynced: 0,
      scenesSeen: 0,
      roundsCreated: 0,
      roundsUpdated: 0,
      roundsLinked: 0,
      resourcesAdded: 0,
      disabledRounds: 0,
      failed: 0,
    },
    lastMessage: null,
    lastErrors: [],
  };
}

describe("integration phash linking", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();

    const source = makeSource();
    let status = makeIdleStatus();

    listExternalSourcesMock.mockReturnValue([source]);
    getDisabledRoundIdsMock.mockReturnValue([]);
    getIntegrationSyncStatusMock.mockImplementation(() => status);
    setIntegrationSyncStatusMock.mockImplementation((next) => {
      status = next;
      return next;
    });
    setDisabledRoundIdsMock.mockImplementation((ids: Iterable<string>) => [...ids]);
    normalizeBaseUrlMock.mockImplementation((input: string) => input.replace(/\/+$/, ""));
    sourcePrefixForManagedRoundsMock.mockImplementation(
      (input: ExternalSource) => `stash:${input.baseUrl.replace(/\/+$/, "")}:scene:`,
    );
    toStashInstallSourceKeyMock.mockImplementation(
      (baseUrl: string, sceneId: string) => `stash:${baseUrl.replace(/\/+$/, "")}:scene:${sceneId}`,
    );
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("links to an existing round when phash is similar", async () => {
    getDbMock.mockReturnValue(createDbMock([
      {
        id: "round-existing",
        name: "Existing",
        author: "Author",
        description: null,
        phash: "0",
        previewImage: "preview",
        installSourceKey: null,
        resources: [{ id: "res-1", videoUri: "https://stash.example/old.mp4", phash: null, disabled: false }],
      },
    ]));

    syncSourceMock.mockImplementationOnce(async (_source, context) => {
      context.onSceneSeen();
      await context.ingestScene({
        sceneId: "scene-1",
        installSourceKey: "ignored-by-wrapper",
        roundTypeFallback: "Normal",
        name: "Imported Scene",
        author: "Author",
        description: null,
        phash: "3ff",
        videoUri: "https://stash.example/new.mp4",
        funscriptUri: null,
      });
    });

    const { syncExternalSources } = await import("./index");
    const result = await syncExternalSources("manual");

    expect(syncSourceMock).toHaveBeenCalledTimes(1);
    expect(result.stats.failed).toBe(0);
    expect(result.stats.roundsLinked).toBe(1);
    expect(result.stats.roundsCreated).toBe(0);
    expect(result.stats.resourcesAdded).toBe(1);
  });

  it("does not fuzzy-match non-hex fallback hashes", async () => {
    getDbMock.mockReturnValue(createDbMock([
      {
        id: "round-existing",
        name: "Existing",
        author: "Author",
        description: null,
        phash: "sha256:abc@0-1000",
        previewImage: "preview",
        installSourceKey: null,
        resources: [{ id: "res-1", videoUri: "https://stash.example/old.mp4", phash: null, disabled: false }],
      },
    ]));

    syncSourceMock.mockImplementationOnce(async (_source, context) => {
      context.onSceneSeen();
      await context.ingestScene({
        sceneId: "scene-2",
        installSourceKey: "ignored-by-wrapper",
        roundTypeFallback: "Normal",
        name: "Imported Scene",
        author: "Author",
        description: null,
        phash: "sha256:abd@0-1000",
        videoUri: "https://stash.example/new.mp4",
        funscriptUri: null,
      });
    });

    const { syncExternalSources } = await import("./index");
    const result = await syncExternalSources("manual");

    expect(syncSourceMock).toHaveBeenCalledTimes(1);
    expect(result.stats.failed).toBe(0);
    expect(result.stats.roundsLinked).toBe(0);
    expect(result.stats.roundsCreated).toBe(1);
  });
});
