import { type ReactNode, act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findInstalledCatalog: vi.fn(),
}));

vi.mock("@/services/db", () => ({
  db: { round: { findInstalledCatalog: mocks.findInstalledCatalog } },
}));
vi.mock("@/services/playlists", () => ({ playlists: { list: vi.fn().mockResolvedValue([]) } }));
vi.mock("@/services/trpc", () => ({ trpc: { store: { get: { query: vi.fn().mockResolvedValue(null) } } } }));

import { useInstalledRoundsCatalog } from "../hooks/useLibraryData";

const makeEntry = (id: string) => ({ id, name: `Round ${id}`, author: null, description: null, tags: [], type: "Normal" as const, bpm: null, difficulty: null, startTime: 0, endTime: 0, excludeFromRandom: false, primaryResourceId: null, funscriptUri: null, funscriptOffsetMs: 0, invertFunscript: false, hero: null, heroId: null, installedAt: 0, isTemplate: false, scriptReady: false, source: "local" as const, videoDurationSec: 0, websiteVideoCacheStatus: null });

function createWrapper(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe("debug", () => {
  let client: QueryClient;
  beforeEach(() => {
    client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 60_000, staleTime: 0 } } });
    mocks.findInstalledCatalog.mockReset();
  });
  afterEach(() => client.clear());

  it("debug key change", async () => {
    const sentinel = makeEntry("sentinel");
    mocks.findInstalledCatalog.mockResolvedValueOnce([sentinel]);
    
    let resolveNew = () => {};
    mocks.findInstalledCatalog.mockImplementationOnce(() => new Promise<any>((r) => { resolveNew = r; }));

    const { result, rerender } = renderHook(
      ({ includeDisabled }) => useInstalledRoundsCatalog(includeDisabled, true),
      { wrapper: createWrapper(client), initialProps: { includeDisabled: true } }
    );

    await waitFor(() => expect(result.current.data).toEqual([sentinel]));
    console.log("After initial:", { calls: mocks.findInstalledCatalog.mock.calls.length, data: result.current.data?.length, isFetching: result.current.isFetching });

    await act(async () => {
      rerender({ includeDisabled: false });
      await Promise.resolve();
    });
    
    console.log("After rerender:", { calls: mocks.findInstalledCatalog.mock.calls.length, data: result.current.data, isFetching: result.current.isFetching, status: result.current.status });
    
    expect(true).toBe(true);
  });
});
