import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getInstalledRoundCatalog: vi.fn(async () => []),
  getRoundMediaResources: vi.fn(async () => null),
}));

vi.mock("./trpc", () => ({
  trpc: {
    db: {
      getInstalledRoundCatalog: {
        query: mocks.getInstalledRoundCatalog,
      },
      getRoundMediaResources: {
        query: mocks.getRoundMediaResources,
      },
    },
  },
}));

import {
  getInstalledRoundCatalogCached,
  getRoundMediaResourcesCached,
  invalidateInstalledRoundCaches,
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
});
