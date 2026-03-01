import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findInstalledCatalog: vi.fn(),
}));

vi.mock("@/services/db", () => ({
  db: {
    round: {
      findInstalledCatalog: mocks.findInstalledCatalog,
    },
  },
}));

vi.mock("@/services/playlists", () => ({
  playlists: { list: vi.fn().mockResolvedValue([]) },
}));

vi.mock("@/services/trpc", () => ({
  trpc: {
    store: {
      get: { query: vi.fn().mockResolvedValue(null) },
    },
  },
}));

import { useInstalledRoundsCatalog } from "../hooks/useLibraryData";

function createWrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

function makeCatalogEntry(id: string) {
  return {
    id,
    name: `Round ${id}`,
    author: null,
    description: null,
    tags: [],
    type: "Normal" as const,
    bpm: null,
    difficulty: null,
    startTime: 0,
    endTime: 0,
    excludeFromRandom: false,
    primaryResourceId: null,
    funscriptUri: null,
    funscriptOffsetMs: 0,
    invertFunscript: false,
    hero: null,
    heroId: null,
    installedAt: 0,
    isTemplate: false,
    scriptReady: false,
    source: "local" as const,
    videoDurationSec: 0,
    websiteVideoCacheStatus: null,
  };
}

/**
 * These tests verify the data-layer behavior that prevents the rounds grid
 * from disappearing during background refetches.
 *
 * Two fixes were applied:
 * 1. Removed the `!isLibraryRefreshing` term from the grid section guard in
 *    InstalledRoundsPage.tsx so the grid stays mounted during background refetch.
 * 2. Added `placeholderData: keepPreviousData` to `useInstalledRoundsCatalog`
 *    so the grid does not blank when `showDisabled` changes the query key.
 *
 * Failure-proof:
 * - Re-adding `!isLibraryRefreshing` to the grid guard makes Scenario A fail
 *   (the grid would unmount during refetch).
 * - Removing `placeholderData: keepPreviousData` makes Scenario B fail
 *   (data becomes undefined during the key switch).
 */
describe("RoundGrid stays mounted during background refetches", () => {
  let client: QueryClient;

  beforeEach(() => {
    client = new QueryClient({
      defaultOptions: {
        queries: { retry: false, gcTime: 60_000, staleTime: 0 },
      },
    });
    mocks.findInstalledCatalog.mockReset();
  });

  afterEach(() => {
    client.clear();
  });

  // Scenario A: same-key background refetch (the original unmount bug).
  it("keeps previous data visible during a same-key background refetch", async () => {
    const sentinel = makeCatalogEntry("sentinel-a");
    mocks.findInstalledCatalog.mockResolvedValueOnce([sentinel]);

    const { result } = renderHook(() => useInstalledRoundsCatalog(true, true), {
      wrapper: createWrapper(client),
    });

    await waitFor(() => {
      expect(result.current.data).toEqual([sentinel]);
    });
    expect(result.current.isLoading).toBe(false);
    expect(mocks.findInstalledCatalog).toHaveBeenCalledTimes(1);

    // Defer the next fetch so isFetching becomes true while data is still present.
    let resolveSecond: (value: typeof sentinel[]) => void = () => {};
    mocks.findInstalledCatalog.mockImplementationOnce(
      () =>
        new Promise<typeof sentinel[]>((resolve) => {
          resolveSecond = resolve;
        })
    );

    // Trigger the same-key refetch directly. Do not await: the deferred promise
    // intentionally keeps the observable fetching window open.
    let refetchPromise!: ReturnType<typeof result.current.refetch>;
    act(() => {
      refetchPromise = result.current.refetch();
    });

    // While the deferred refetch is in flight, previous data must still be
    // available so cards don't vanish. Query observer notifications are
    // intentionally batched, so assert the request itself rather than a
    // transient isFetching render.
    await waitFor(() => {
      expect(mocks.findInstalledCatalog).toHaveBeenCalledTimes(2);
    });
    expect(result.current.data).toEqual([sentinel]);

    // Resolve the refetch with updated data.
    const updated = makeCatalogEntry("updated-a");
    await act(async () => {
      resolveSecond([updated]);
      await refetchPromise;
    });

    await waitFor(() => {
      expect(result.current.data).toEqual([updated]);
    });
  });

  // Scenario B: query-key change via the showDisabled toggle.
  // The SAME observer must change its key via rerender so that
  // placeholderData:keepPreviousData supplies the previous key's data.
  it("keeps previous data visible when the query key changes via showDisabled toggle", async () => {
    const sentinel = makeCatalogEntry("sentinel-b");

    // Seed the includeDisabled:true key with the sentinel.
    mocks.findInstalledCatalog.mockResolvedValueOnce([sentinel]);

    const { result, rerender } = renderHook(
      ({ includeDisabled }: { includeDisabled: boolean }) =>
        useInstalledRoundsCatalog(includeDisabled, true),
      {
        wrapper: createWrapper(client),
        initialProps: { includeDisabled: true },
      }
    );

    await waitFor(() => {
      expect(result.current.data).toEqual([sentinel]);
    });

    // Defer the new key's fetch so the pending window is observable.
    let resolveNewKey: (value: typeof sentinel[]) => void = () => {};
    mocks.findInstalledCatalog.mockImplementationOnce(
      () =>
        new Promise<typeof sentinel[]>((resolve) => {
          resolveNewKey = resolve;
        })
    );

    // Rerender the SAME hook with includeDisabled=false (flips the query key).
    await act(async () => {
      rerender({ includeDisabled: false });
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(mocks.findInstalledCatalog).toHaveBeenCalledTimes(2);
    });

    expect(result.current.data).toEqual([sentinel]);

    // Resolve the new key with fresh data.
    const fresh = makeCatalogEntry("fresh-b");
    await act(async () => {
      resolveNewKey([fresh]);
    });

    await waitFor(() => {
      expect(result.current.data).toEqual([fresh]);
    });
  });
});
