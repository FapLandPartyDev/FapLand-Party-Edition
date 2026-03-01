import { waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const BOORU_MEDIA_CACHE_KEY = "game.intermediary.booruMediaCache.v1";

const mocks = vi.hoisted(() => ({
  searchMediaQuery: vi.fn(),
  storeGetQuery: vi.fn(),
  storeSetMutate: vi.fn(),
}));

let storedValues: Record<string, unknown>;

vi.mock("./trpc", () => ({
  trpc: {
    booru: {
      searchMedia: {
        query: mocks.searchMediaQuery,
      },
    },
    store: {
      get: {
        query: mocks.storeGetQuery,
      },
      set: {
        mutate: mocks.storeSetMutate,
      },
    },
  },
}));

import {
  __resetBooruCachesForTests,
  appendRandomSortTagForBooruSearch,
  ensureBooruMediaCache,
  getCachedBooruMediaForDisplay,
  refreshBooruMediaCache,
} from "./booru";

type StoredCacheEntry = {
  updatedAtMs: number;
  media: Array<{
    id: string;
    source: "rule34" | "gelbooru" | "danbooru";
    url: string;
    previewUrl?: string | null;
  }>;
};

function createMedia(id: string) {
  return {
    id,
    source: "rule34" as const,
    url: `https://cdn.example.com/${id}.webm`,
    previewUrl: `https://cdn.example.com/${id}.jpg`,
  };
}

function createCacheStore(entry?: StoredCacheEntry) {
  return {
    version: 1 as const,
    entries: entry
      ? {
          "animated gif webm": entry,
        }
      : {},
  };
}

describe("booru service cache behavior", () => {
  beforeEach(() => {
    storedValues = {
      [BOORU_MEDIA_CACHE_KEY]: createCacheStore(),
    };

    mocks.searchMediaQuery.mockReset();
    mocks.storeGetQuery.mockReset();
    mocks.storeSetMutate.mockReset();

    mocks.storeGetQuery.mockImplementation(
      async ({ key }: { key: string }) => storedValues[key] ?? null
    );
    mocks.storeSetMutate.mockImplementation(
      async ({ key, value }: { key: string; value: unknown }) => {
        storedValues[key] = value;
      }
    );

    vi.restoreAllMocks();
    vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
    __resetBooruCachesForTests();
  });

  it("appends sort:random when absent", () => {
    expect(appendRandomSortTagForBooruSearch("animated gif webm")).toBe(
      "animated gif webm sort:random"
    );
  });

  it("does not duplicate sort:random when already present", () => {
    expect(appendRandomSortTagForBooruSearch("animated gif webm sort:random")).toBe(
      "animated gif webm sort:random"
    );
  });

  it("returns fresh cached media without searching", async () => {
    const cachedMedia = [createMedia("cached-a")];
    storedValues[BOORU_MEDIA_CACHE_KEY] = createCacheStore({
      updatedAtMs: Date.now(),
      media: cachedMedia,
    });

    const media = await ensureBooruMediaCache("animated gif webm", 18);

    expect(media).toEqual(cachedMedia);
    expect(mocks.searchMediaQuery).not.toHaveBeenCalled();
  });

  it("persists refreshed media on success", async () => {
    const refreshedMedia = [createMedia("fresh-a")];
    mocks.searchMediaQuery.mockResolvedValueOnce(refreshedMedia);

    const media = await refreshBooruMediaCache("animated gif webm", 18);

    expect(media).toEqual(refreshedMedia);
    expect(mocks.searchMediaQuery).toHaveBeenCalledWith({
      prompt: "animated gif webm sort:random",
      limitPerSource: 18,
    });
    expect(storedValues[BOORU_MEDIA_CACHE_KEY]).toEqual(
      createCacheStore({
        updatedAtMs: Date.now(),
        media: refreshedMedia,
      })
    );
  });

  it("returns existing cached media when refresh throws", async () => {
    const cachedMedia = [createMedia("cached-a")];
    storedValues[BOORU_MEDIA_CACHE_KEY] = createCacheStore({
      updatedAtMs: Date.now() - 8 * 24 * 60 * 60 * 1000,
      media: cachedMedia,
    });
    mocks.searchMediaQuery.mockRejectedValueOnce(new Error("429"));

    const media = await refreshBooruMediaCache("animated gif webm", 18);

    expect(media).toEqual(cachedMedia);
    expect(storedValues[BOORU_MEDIA_CACHE_KEY]).toEqual(
      createCacheStore({
        updatedAtMs: Date.now() - 8 * 24 * 60 * 60 * 1000,
        media: cachedMedia,
      })
    );
  });

  it("returns existing cached media when refresh returns empty", async () => {
    const cachedMedia = [createMedia("cached-a")];
    storedValues[BOORU_MEDIA_CACHE_KEY] = createCacheStore({
      updatedAtMs: Date.now() - 8 * 24 * 60 * 60 * 1000,
      media: cachedMedia,
    });
    mocks.searchMediaQuery.mockResolvedValueOnce([]);

    const media = await refreshBooruMediaCache("animated gif webm", 18);

    expect(media).toEqual(cachedMedia);
    expect(storedValues[BOORU_MEDIA_CACHE_KEY]).toEqual(
      createCacheStore({
        updatedAtMs: Date.now() - 8 * 24 * 60 * 60 * 1000,
        media: cachedMedia,
      })
    );
  });

  it("triggers one background refresh when cached media is viewed", async () => {
    const cachedMedia = [createMedia("cached-a")];
    const refreshedMedia = [createMedia("fresh-a")];
    storedValues[BOORU_MEDIA_CACHE_KEY] = createCacheStore({
      updatedAtMs: Date.now(),
      media: cachedMedia,
    });
    mocks.searchMediaQuery.mockResolvedValueOnce(refreshedMedia);

    const media = await getCachedBooruMediaForDisplay("animated gif webm", 18);

    expect(media).toEqual(cachedMedia);
    await waitFor(() => expect(mocks.searchMediaQuery).toHaveBeenCalledTimes(1));
  });

  it("does not trigger multiple background refreshes for the same cache generation", async () => {
    const cachedMedia = [createMedia("cached-a")];
    storedValues[BOORU_MEDIA_CACHE_KEY] = createCacheStore({
      updatedAtMs: Date.now(),
      media: cachedMedia,
    });
    mocks.searchMediaQuery.mockResolvedValue([createMedia("fresh-a")]);

    await getCachedBooruMediaForDisplay("animated gif webm", 18);
    await getCachedBooruMediaForDisplay("animated gif webm", 18);

    await waitFor(() => expect(mocks.searchMediaQuery).toHaveBeenCalledTimes(1));
  });

  it("allows another background refresh after a newer cache generation is written", async () => {
    const initialNow = Date.now();
    storedValues[BOORU_MEDIA_CACHE_KEY] = createCacheStore({
      updatedAtMs: initialNow,
      media: [createMedia("cached-a")],
    });
    mocks.searchMediaQuery
      .mockResolvedValueOnce([createMedia("fresh-a")])
      .mockResolvedValueOnce([createMedia("fresh-b")]);

    await getCachedBooruMediaForDisplay("animated gif webm", 18);
    await waitFor(() => expect(mocks.searchMediaQuery).toHaveBeenCalledTimes(1));

    vi.spyOn(Date, "now").mockReturnValue(initialNow + 10_000);
    await getCachedBooruMediaForDisplay("animated gif webm", 18);

    await waitFor(() => expect(mocks.searchMediaQuery).toHaveBeenCalledTimes(2));
  });
});
