import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getInstalledRoundCatalog: vi.fn(async (): Promise<Array<{ id: string }>> => []),
  getInstalledRoundCardAssets: vi.fn(
    async (): Promise<
      Array<{
        roundId: string;
        previewImage: string | null;
        previewVideoUri: string | null;
        websiteVideoCacheStatus: "not_applicable" | "cached" | "pending";
        primaryResourceId: string | null;
      }>
    > => []
  ),
  getRoundMediaResources: vi.fn(
    async (): Promise<{ roundId: string; resources: Array<{ id: string }> } | null> => null
  ),
}));

vi.mock("./trpc", () => ({
  trpc: {
    db: {
      getInstalledRoundCatalog: {
        query: mocks.getInstalledRoundCatalog,
      },
      getInstalledRoundCardAssets: {
        query: mocks.getInstalledRoundCardAssets,
      },
      getRoundMediaResources: {
        query: mocks.getRoundMediaResources,
      },
    },
  },
}));

import {
  getInstalledRoundCardAssetsCached,
  getInstalledRoundCatalogCached,
  getRoundMediaResourcesCached,
  invalidateInstalledRoundCaches,
  invalidateInstalledRoundCardAssets,
  invalidateInstalledRoundMedia,
} from "./installedRoundsCache";

describe("installedRoundsCache", () => {
  beforeEach(() => {
    invalidateInstalledRoundCaches();
    vi.clearAllMocks();
  });

  it("reuses the same in-flight catalog request and refetches after invalidation", async () => {
    const pending = Promise.resolve([{ id: "round-1" }]);
    mocks.getInstalledRoundCatalog.mockReturnValue(pending);

    const first = getInstalledRoundCatalogCached();
    const second = getInstalledRoundCatalogCached();

    expect(first).toBe(second);
    await expect(first).resolves.toEqual([{ id: "round-1" }]);
    expect(mocks.getInstalledRoundCatalog).toHaveBeenCalledTimes(1);

    invalidateInstalledRoundCaches();
    mocks.getInstalledRoundCatalog.mockResolvedValue([{ id: "round-2" }]);

    await expect(getInstalledRoundCatalogCached()).resolves.toEqual([{ id: "round-2" }]);
    expect(mocks.getInstalledRoundCatalog).toHaveBeenCalledTimes(2);
  });

  it("reuses media requests per round and supports targeted invalidation", async () => {
    mocks.getRoundMediaResources.mockResolvedValue({
      roundId: "round-1",
      resources: [],
    });

    const first = getRoundMediaResourcesCached("round-1");
    const second = getRoundMediaResourcesCached("round-1");

    expect(first).toBe(second);
    await expect(first).resolves.toEqual({ roundId: "round-1", resources: [] });
    expect(mocks.getRoundMediaResources).toHaveBeenCalledTimes(1);

    invalidateInstalledRoundMedia("round-1");
    mocks.getRoundMediaResources.mockResolvedValue({
      roundId: "round-1",
      resources: [{ id: "res-1" }],
    });

    await expect(getRoundMediaResourcesCached("round-1")).resolves.toEqual({
      roundId: "round-1",
      resources: [{ id: "res-1" }],
    });
    expect(mocks.getRoundMediaResources).toHaveBeenCalledTimes(2);
  });

  it("caches installed round card assets per round and supports targeted invalidation", async () => {
    mocks.getInstalledRoundCardAssets.mockResolvedValue([
      {
        roundId: "round-1",
        previewImage: null,
        previewVideoUri: "app://media/round-1.mp4",
        websiteVideoCacheStatus: "cached",
        primaryResourceId: "res-1",
      },
    ]);

    const first = getInstalledRoundCardAssetsCached(["round-1"]);
    const second = getInstalledRoundCardAssetsCached(["round-1"]);

    await expect(first).resolves.toEqual([
      {
        roundId: "round-1",
        previewImage: null,
        previewVideoUri: "app://media/round-1.mp4",
        websiteVideoCacheStatus: "cached",
        primaryResourceId: "res-1",
      },
    ]);
    await expect(second).resolves.toEqual([
      {
        roundId: "round-1",
        previewImage: null,
        previewVideoUri: "app://media/round-1.mp4",
        websiteVideoCacheStatus: "cached",
        primaryResourceId: "res-1",
      },
    ]);
    expect(mocks.getInstalledRoundCardAssets).toHaveBeenCalledTimes(1);

    invalidateInstalledRoundCardAssets("round-1");
    mocks.getInstalledRoundCardAssets.mockResolvedValue([
      {
        roundId: "round-1",
        previewImage: "data:image/jpeg;base64,preview",
        previewVideoUri: "app://media/round-1.mp4",
        websiteVideoCacheStatus: "cached",
        primaryResourceId: "res-1",
      },
    ]);

    await expect(getInstalledRoundCardAssetsCached(["round-1"])).resolves.toEqual([
      {
        roundId: "round-1",
        previewImage: "data:image/jpeg;base64,preview",
        previewVideoUri: "app://media/round-1.mp4",
        websiteVideoCacheStatus: "cached",
        primaryResourceId: "res-1",
      },
    ]);
    expect(mocks.getInstalledRoundCardAssets).toHaveBeenCalledTimes(2);
  });
});
