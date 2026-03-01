import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getInstalledRoundCardAssetsCached: vi.fn(),
  invalidateInstalledRoundCardAssets: vi.fn(),
  peekInstalledRoundCardAssetsCached: vi.fn(),
  loadInstalledRoundPreviewImage: vi.fn(
    async (entry: { roundId: string; previewImage: string | null }) => entry
  ),
}));

vi.mock("../../services/installedRoundsCache", () => ({
  getInstalledRoundCardAssetsCached: mocks.getInstalledRoundCardAssetsCached,
  invalidateInstalledRoundCardAssets: mocks.invalidateInstalledRoundCardAssets,
  peekInstalledRoundCardAssetsCached: mocks.peekInstalledRoundCardAssetsCached,
  loadInstalledRoundPreviewImage: mocks.loadInstalledRoundPreviewImage,
}));

import { useVisibleRoundAssets } from "./useVisibleRoundAssets";

describe("useVisibleRoundAssets", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  it("hydrates cached visible previews immediately and only fetches missing entries asynchronously", async () => {
    mocks.peekInstalledRoundCardAssetsCached.mockReturnValue([
      {
        roundId: "round-1",
        previewImage: "data:image/png;base64,cached",
        previewVideoUri: "app://media/cached.mp4",
        websiteVideoCacheStatus: "cached",
        primaryResourceId: "resource-1",
      },
    ]);
    mocks.getInstalledRoundCardAssetsCached.mockResolvedValue([
      {
        roundId: "round-2",
        previewImage: "data:image/png;base64,fetched",
        previewVideoUri: "app://media/fetched.mp4",
        websiteVideoCacheStatus: "cached",
        primaryResourceId: "resource-2",
      },
    ]);

    const { result } = renderHook(() =>
      useVisibleRoundAssets({
        visibleRoundIds: ["round-1", "round-2"],
        selectedRoundId: null,
        includeDisabled: false,
        isScrolling: false,
      })
    );

    expect(result.current.cardAssetsByRoundId.get("round-1")?.previewImage).toBe(
      "data:image/png;base64,cached"
    );
    expect(result.current.cardAssetsByRoundId.has("round-2")).toBe(false);
    expect(mocks.getInstalledRoundCardAssetsCached).not.toHaveBeenCalled();

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(mocks.getInstalledRoundCardAssetsCached).toHaveBeenCalledWith(["round-2"], false);
    expect(result.current.cardAssetsByRoundId.get("round-2")?.previewImage).toBe(
      "data:image/png;base64,fetched"
    );
  });

  it("does not request visible previews while scrolling", async () => {
    mocks.peekInstalledRoundCardAssetsCached.mockReturnValue([]);
    mocks.getInstalledRoundCardAssetsCached.mockResolvedValue([]);

    renderHook(() =>
      useVisibleRoundAssets({
        visibleRoundIds: ["round-1"],
        selectedRoundId: null,
        includeDisabled: false,
        isScrolling: true,
      })
    );

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(mocks.getInstalledRoundCardAssetsCached).not.toHaveBeenCalled();
  });

  it("repairs cached missing thumbnails asynchronously and displays the result", async () => {
    const entry = {
      roundId: "round-1",
      previewImage: null,
      previewVideoUri: "app://media/local.mp4",
      websiteVideoCacheStatus: "not_applicable",
      primaryResourceId: "resource-1",
    };
    const visibleRoundIds = [entry.roundId];
    mocks.peekInstalledRoundCardAssetsCached.mockReturnValue([entry]);
    mocks.loadInstalledRoundPreviewImage.mockResolvedValueOnce({
      ...entry,
      previewImage: "repaired",
    });
    const { result } = renderHook(() =>
      useVisibleRoundAssets({
        visibleRoundIds,
        selectedRoundId: null,
        includeDisabled: false,
        isScrolling: false,
      })
    );
    expect(mocks.loadInstalledRoundPreviewImage).not.toHaveBeenCalled();
    await act(async () => {
      await vi.runAllTimersAsync();
    });
    expect(mocks.getInstalledRoundCardAssetsCached).not.toHaveBeenCalled();
    expect(result.current.cardAssetsByRoundId.get(entry.roundId)?.previewImage).toBe("repaired");
  });

  it("loads visible previews in batches of four", async () => {
    mocks.peekInstalledRoundCardAssetsCached.mockReturnValue([]);
    mocks.getInstalledRoundCardAssetsCached.mockResolvedValue([]);

    renderHook(() =>
      useVisibleRoundAssets({
        visibleRoundIds: ["round-1", "round-2", "round-3", "round-4", "round-5"],
        selectedRoundId: null,
        includeDisabled: false,
        isScrolling: false,
      })
    );

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(mocks.getInstalledRoundCardAssetsCached).toHaveBeenNthCalledWith(
      1,
      ["round-1", "round-2", "round-3", "round-4"],
      false
    );
    expect(mocks.getInstalledRoundCardAssetsCached).toHaveBeenNthCalledWith(2, ["round-5"], false);
  });

  it("delivers every visible card's assets before waiting for thumbnail extraction", async () => {
    const visibleRoundIds = ["1", "2", "3", "4", "5"];
    mocks.peekInstalledRoundCardAssetsCached.mockReturnValue([]);
    mocks.getInstalledRoundCardAssetsCached.mockImplementation(async (ids: string[]) =>
      ids.map((roundId) => ({
        roundId,
        previewImage: null,
        previewVideoUri: "app://media/local.mp4",
        websiteVideoCacheStatus: "not_applicable",
        primaryResourceId: roundId,
      }))
    );
    let finish!: (entry: { roundId: string; previewImage: string | null }) => void;
    mocks.loadInstalledRoundPreviewImage.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    const { result, unmount } = renderHook(() =>
      useVisibleRoundAssets({
        visibleRoundIds,
        selectedRoundId: null,
        includeDisabled: false,
        isScrolling: false,
      })
    );
    await act(async () => {
      await vi.runAllTimersAsync();
    });
    expect(mocks.getInstalledRoundCardAssetsCached).toHaveBeenCalledTimes(2);
    expect(result.current.cardAssetsByRoundId.size).toBe(5);
    expect(mocks.loadInstalledRoundPreviewImage).toHaveBeenCalledTimes(1);
    unmount();
    await act(async () => {
      finish({ roundId: "1", previewImage: "finished" });
    });
    expect(mocks.loadInstalledRoundPreviewImage).toHaveBeenCalledTimes(1);
  });

  it("cancels queued visible preview work when scrolling starts", async () => {
    mocks.peekInstalledRoundCardAssetsCached.mockReturnValue([]);
    mocks.getInstalledRoundCardAssetsCached.mockResolvedValue([]);

    const { rerender } = renderHook(
      ({ isScrolling }: { isScrolling: boolean }) =>
        useVisibleRoundAssets({
          visibleRoundIds: ["round-1"],
          selectedRoundId: null,
          includeDisabled: false,
          isScrolling,
        }),
      { initialProps: { isScrolling: false } }
    );

    rerender({ isScrolling: true });
    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(mocks.getInstalledRoundCardAssetsCached).not.toHaveBeenCalled();
  });

  it("continues to prioritize an explicitly selected round while scrolling", async () => {
    mocks.peekInstalledRoundCardAssetsCached.mockReturnValue([]);
    mocks.getInstalledRoundCardAssetsCached.mockResolvedValue([]);

    renderHook(() =>
      useVisibleRoundAssets({
        visibleRoundIds: ["round-1", "round-2"],
        selectedRoundId: "round-2",
        includeDisabled: false,
        isScrolling: true,
      })
    );

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(mocks.getInstalledRoundCardAssetsCached).toHaveBeenCalledWith(["round-2"], false);
  });

  it("invalidates and reloads only requested visible round assets", async () => {
    const initialEntries = [
      {
        roundId: "round-1",
        previewImage: null,
        previewVideoUri: "app://external/web-url?target=https%3A%2F%2Fexample.com%2Fone",
        websiteVideoCacheStatus: "pending",
        primaryResourceId: "resource-1",
      },
      {
        roundId: "round-2",
        previewImage: null,
        previewVideoUri: "app://external/web-url?target=https%3A%2F%2Fexample.com%2Ftwo",
        websiteVideoCacheStatus: "pending",
        primaryResourceId: "resource-2",
      },
    ];
    let roundOneInvalidated = false;
    mocks.invalidateInstalledRoundCardAssets.mockImplementation((roundId: string) => {
      if (roundId === "round-1") roundOneInvalidated = true;
    });
    mocks.peekInstalledRoundCardAssetsCached.mockImplementation(() =>
      roundOneInvalidated
        ? initialEntries.filter((entry) => entry.roundId !== "round-1")
        : initialEntries
    );
    mocks.getInstalledRoundCardAssetsCached.mockResolvedValue([
      {
        roundId: "round-1",
        previewImage: "data:image/png;base64,finished",
        previewVideoUri: "app://media/finished.mp4",
        websiteVideoCacheStatus: "cached",
        primaryResourceId: "resource-1",
      },
    ]);

    const { result } = renderHook(() =>
      useVisibleRoundAssets({
        visibleRoundIds: ["round-1", "round-2"],
        selectedRoundId: null,
        includeDisabled: false,
        isScrolling: false,
      })
    );

    act(() => {
      result.current.refreshRoundAssets(["round-1"]);
    });
    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(mocks.invalidateInstalledRoundCardAssets).toHaveBeenCalledTimes(1);
    expect(mocks.invalidateInstalledRoundCardAssets).toHaveBeenCalledWith("round-1");
    expect(mocks.getInstalledRoundCardAssetsCached).toHaveBeenCalledWith(["round-1"], false);
    expect(result.current.cardAssetsByRoundId.get("round-1")?.websiteVideoCacheStatus).toBe(
      "cached"
    );
    expect(result.current.cardAssetsByRoundId.get("round-2")?.websiteVideoCacheStatus).toBe(
      "pending"
    );
  });
});
