// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  getDbMock,
  getInstallScanStatusMock,
  ensureWebsiteVideoCachedMock,
  getCachedWebsiteVideoMetadataMock,
  getWebsiteVideoTargetUrlMock,
  generateRoundPreviewImageDataUriMock,
  startPhashScanManualMock,
  isStashProxyUriMock,
} = vi.hoisted(() => {
  return {
    getDbMock: vi.fn(),
    getInstallScanStatusMock: vi.fn(),
    ensureWebsiteVideoCachedMock: vi.fn(),
    getCachedWebsiteVideoMetadataMock: vi.fn(),
    getWebsiteVideoTargetUrlMock: vi.fn(),
    generateRoundPreviewImageDataUriMock: vi.fn(),
    startPhashScanManualMock: vi.fn(),
    isStashProxyUriMock: vi.fn(),
  };
});

vi.mock("./db", () => ({
  getDb: getDbMock,
}));

vi.mock("./installer", () => ({
  getInstallScanStatus: getInstallScanStatusMock,
}));

vi.mock("./webVideo", () => ({
  ensureWebsiteVideoCached: ensureWebsiteVideoCachedMock,
  getCachedWebsiteVideoMetadata: getCachedWebsiteVideoMetadataMock,
  getWebsiteVideoTargetUrl: getWebsiteVideoTargetUrlMock,
  isStashProxyUri: isStashProxyUriMock,
}));

vi.mock("./roundPreview", () => ({
  generateRoundPreviewImageDataUri: generateRoundPreviewImageDataUriMock,
}));

vi.mock("./phashScanService", () => ({
  startPhashScanManual: startPhashScanManualMock,
}));

function buildDbMock(rows: Array<{
  resourceId: string;
  roundId: string;
  roundName: string;
  videoUri: string;
}>, previewRows: Array<{
  roundId: string;
  resourceId: string;
  startTime: number | null;
  endTime: number | null;
  previewImage: string | null;
}> = []) {
  const queryRows = [rows, previewRows];
  const updatedRounds: Array<{ id: string; previewImage: string | null }> = [];
  return {
    updatedRounds,
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        innerJoin: vi.fn(() => ({
          where: vi.fn(async () => queryRows.shift() ?? []),
        })),
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn((values: { previewImage?: string | null }) => ({
        where: vi.fn((whereClause: unknown) => {
          const roundId = JSON.stringify(whereClause).match(/"value":"([^"]+)"/)?.[1] ?? "unknown";
          updatedRounds.push({ id: roundId, previewImage: values.previewImage ?? null });
          return Promise.resolve();
        }),
      })),
    })),
  };
}

describe("webVideoScanService", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.useRealTimers();
    getInstallScanStatusMock.mockReturnValue({ state: "idle" });
    ensureWebsiteVideoCachedMock.mockResolvedValue({
      finalFilePath: "/tmp/cached.mp4",
    });
    generateRoundPreviewImageDataUriMock.mockResolvedValue(null);
    startPhashScanManualMock.mockResolvedValue({ state: "running" });
    getCachedWebsiteVideoMetadataMock.mockResolvedValue(null);
    getWebsiteVideoTargetUrlMock.mockImplementation((uri: string) => {
      if (uri.startsWith("https://page.example/")) {
        return uri;
      }
      return null;
    });
    isStashProxyUriMock.mockReturnValue(false);
  });

  it("ignores stash proxy URIs even if not marked in installSourceKey", async () => {
    getDbMock.mockReturnValue(buildDbMock([
      {
        resourceId: "res-stash",
        roundId: "round-stash",
        roundName: "Stash Round",
        videoUri: "app://external/stash?target=http://localhost:9999/stream",
      },
      {
        resourceId: "res-1",
        roundId: "round-1",
        roundName: "Round One",
        videoUri: "https://page.example/watch/1",
      },
    ]));
    isStashProxyUriMock.mockImplementation((uri: string) => uri.includes("/stash"));

    const service = await import("./webVideoScanService");
    const result = await service.startWebsiteVideoScanManual();

    expect(isStashProxyUriMock).toHaveBeenCalledWith("app://external/stash?target=http://localhost:9999/stream");
    expect(ensureWebsiteVideoCachedMock).toHaveBeenCalledTimes(1);
    expect(ensureWebsiteVideoCachedMock).toHaveBeenCalledWith("https://page.example/watch/1");
    expect(result.totalCount).toBe(1); // The stash one was filtered out in findUncachedWebsiteVideos
    expect(result.completedCount).toBe(1);
  });

  it("downloads only distinct uncached website URLs", async () => {
    getDbMock.mockReturnValue(buildDbMock([
      {
        resourceId: "res-1",
        roundId: "round-1",
        roundName: "Round One",
        videoUri: "https://page.example/watch/1",
      },
      {
        resourceId: "res-2",
        roundId: "round-2",
        roundName: "Round Two",
        videoUri: "https://page.example/watch/1",
      },
      {
        resourceId: "res-3",
        roundId: "round-3",
        roundName: "Round Three",
        videoUri: "file:///tmp/local.mp4",
      },
      {
        resourceId: "res-4",
        roundId: "round-4",
        roundName: "Round Four",
        videoUri: "https://page.example/watch/2",
      },
    ]));
    getCachedWebsiteVideoMetadataMock.mockImplementation(async (uri: string) => {
      if (uri === "https://page.example/watch/2") {
        return {
          finalFilePath: "/tmp/already-cached.mp4",
        };
      }
      return null;
    });

    const service = await import("./webVideoScanService");
    const result = await service.startWebsiteVideoScanManual();

    expect(ensureWebsiteVideoCachedMock).toHaveBeenCalledTimes(1);
    expect(ensureWebsiteVideoCachedMock).toHaveBeenCalledWith("https://page.example/watch/1");
    expect(result.state).toBe("done");
    expect(result.totalCount).toBe(1);
    expect(result.completedCount).toBe(1);
    expect(result.failedCount).toBe(0);
  });

  it("starts non-manual scans without a user-configurable disable switch", async () => {
    getDbMock.mockReturnValue(buildDbMock([
      {
        resourceId: "res-1",
        roundId: "round-1",
        roundName: "Round One",
        videoUri: "https://page.example/watch/1",
      },
    ]));

    const service = await import("./webVideoScanService");
    const result = await service.startWebsiteVideoScan();

    expect(ensureWebsiteVideoCachedMock).toHaveBeenCalledTimes(1);
    expect(result.state).toBe("done");
    expect(result.completedCount).toBe(1);
  });

  it("waits for install scanning to finish before downloading", async () => {
    vi.useFakeTimers();
    getDbMock.mockReturnValue(buildDbMock([
      {
        resourceId: "res-1",
        roundId: "round-1",
        roundName: "Round One",
        videoUri: "https://page.example/watch/1",
      },
    ]));

    const installStates = [{ state: "running" }, { state: "running" }, { state: "idle" }];
    getInstallScanStatusMock.mockImplementation(() => installStates.shift() ?? { state: "idle" });

    const service = await import("./webVideoScanService");
    const pending = service.startWebsiteVideoScanManual();

    expect(ensureWebsiteVideoCachedMock).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1000);
    await vi.runAllTimersAsync();

    await pending;
    expect(ensureWebsiteVideoCachedMock).toHaveBeenCalledWith("https://page.example/watch/1");
  });

  it("aborts after the current download finishes", async () => {
    vi.useFakeTimers();
    getDbMock.mockReturnValue(buildDbMock([
      {
        resourceId: "res-1",
        roundId: "round-1",
        roundName: "Round One",
        videoUri: "https://page.example/watch/1",
      },
      {
        resourceId: "res-2",
        roundId: "round-2",
        roundName: "Round Two",
        videoUri: "https://page.example/watch/2",
      },
    ]));

    let releaseFirst: any = null;
    ensureWebsiteVideoCachedMock.mockImplementation((url: string) => {
      if (url === "https://page.example/watch/1") {
        return new Promise<void>((resolve) => {
          releaseFirst = resolve;
        });
      }
      return Promise.resolve();
    });

    const service = await import("./webVideoScanService");
    const pending = service.startWebsiteVideoScanManual();

    await vi.waitFor(() => {
      expect(ensureWebsiteVideoCachedMock).toHaveBeenCalledWith("https://page.example/watch/1");
    });

    service.requestWebsiteVideoScanAbort();
    releaseFirst?.();
    await vi.runAllTimersAsync();

    const result = await pending;
    expect(ensureWebsiteVideoCachedMock).toHaveBeenCalledTimes(2);
    expect(result.state).toBe("aborted");
    expect(result.completedCount).toBe(2);
    expect(result.totalCount).toBe(2);
  });

  it("processes multiple downloads in parallel", async () => {
    vi.useFakeTimers();
    getDbMock.mockReturnValue(buildDbMock([
      {
        resourceId: "res-1",
        roundId: "round-1",
        roundName: "Round One",
        videoUri: "https://page.example/watch/1",
      },
      {
        resourceId: "res-2",
        roundId: "round-2",
        roundName: "Round Two",
        videoUri: "https://page.example/watch/2",
      },
      {
        resourceId: "res-3",
        roundId: "round-3",
        roundName: "Round Three",
        videoUri: "https://page.example/watch/3",
      },
    ]));

    const releases = new Map<string, () => void>();
    ensureWebsiteVideoCachedMock.mockImplementation(
      (url: string) =>
        new Promise<void>((resolve) => {
          releases.set(url, resolve);
        })
    );

    const service = await import("./webVideoScanService");
    const pending = service.startWebsiteVideoScanManual();

    await vi.waitFor(() => {
      expect(ensureWebsiteVideoCachedMock).toHaveBeenCalledTimes(3);
    });

    releases.forEach((release) => release());
    await vi.runAllTimersAsync();

    const result = await pending;
    expect(result.state).toBe("done");
    expect(result.completedCount).toBe(3);
  });

  it("generates missing preview images and queues the phash service after caching", async () => {
    const dbMock = buildDbMock(
      [
        {
          resourceId: "res-1",
          roundId: "round-1",
          roundName: "Round One",
          videoUri: "https://page.example/watch/1",
        },
      ],
      [
        {
          roundId: "round-1",
          resourceId: "res-1",
          startTime: 1000,
          endTime: 5000,
          previewImage: null,
        },
      ]
    );
    getDbMock.mockReturnValue(dbMock);
    generateRoundPreviewImageDataUriMock.mockResolvedValue("data:image/jpeg;base64,preview");

    const service = await import("./webVideoScanService");
    const result = await service.startWebsiteVideoScanManual();

    expect(generateRoundPreviewImageDataUriMock).toHaveBeenCalledWith({
      videoUri: "app://media/%2Ftmp%2Fcached.mp4",
      startTimeMs: 1000,
      endTimeMs: 5000,
    });
    expect(dbMock.updatedRounds).toHaveLength(1);
    expect(dbMock.updatedRounds[0]?.previewImage).toBe("data:image/jpeg;base64,preview");
    expect(startPhashScanManualMock).toHaveBeenCalledTimes(1);
    expect(result.state).toBe("done");
  });

  it("queues an immediate follow-up scan when new work is requested during an active run", async () => {
    vi.useFakeTimers();

    const rowsByPass = [
      [
        {
          resourceId: "res-1",
          roundId: "round-1",
          roundName: "Round One",
          videoUri: "https://page.example/watch/1",
        },
      ],
      [
        {
          resourceId: "res-2",
          roundId: "round-2",
          roundName: "Round Two",
          videoUri: "https://page.example/watch/2",
        },
      ],
      [],
    ];

    getDbMock.mockReturnValue({
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          innerJoin: vi.fn(() => ({
            where: vi.fn(async () => rowsByPass.shift() ?? []),
          })),
        })),
      })),
    });

    const releases = new Map<string, () => void>();
    ensureWebsiteVideoCachedMock.mockImplementation(
      (url: string) =>
        new Promise<void>((resolve) => {
          releases.set(url, resolve);
        })
    );

    const service = await import("./webVideoScanService");
    const firstRun = service.startWebsiteVideoScanManual();

    await vi.waitFor(() => {
      expect(ensureWebsiteVideoCachedMock).toHaveBeenCalledWith("https://page.example/watch/1");
    });

    await service.startWebsiteVideoScan();

    releases.get("https://page.example/watch/1")?.();
    await vi.runAllTimersAsync();

    await vi.waitFor(() => {
      expect(ensureWebsiteVideoCachedMock).toHaveBeenCalledWith("https://page.example/watch/2");
    });

    releases.get("https://page.example/watch/2")?.();
    await vi.runAllTimersAsync();

    await firstRun;
    expect(service.getWebsiteVideoScanStatus().state).toBe("done");
    expect(ensureWebsiteVideoCachedMock).toHaveBeenCalledTimes(2);
  });
});
