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
  shouldDeferBackgroundWorkMock,
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
    shouldDeferBackgroundWorkMock: vi.fn(),
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

vi.mock("./rendererPerformance", () => ({
  shouldDeferBackgroundWork: shouldDeferBackgroundWorkMock,
}));

vi.mock("./phashScanService", () => ({
  startPhashScanManual: startPhashScanManualMock,
}));

function buildDbMock(
  rows: Array<{
    resourceId: string;
    roundId: string;
    roundName: string;
    videoUri: string;
  }>,
  previewRows: Array<{
    roundId: string;
    resourceId: string;
    startTime: number | null;
    endTime: number | null;
    previewImage: string | null;
  }> = []
) {
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
          let roundId = "unknown";
          try {
            roundId = JSON.stringify(whereClause).match(/"value":"([^"]+)"/)?.[1] ?? "unknown";
          } catch {
            roundId = "unknown";
          }
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
    shouldDeferBackgroundWorkMock.mockReturnValue(false);
  });

  it("ignores stash proxy URIs even if not marked in installSourceKey", async () => {
    getDbMock.mockReturnValue(
      buildDbMock([
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
      ])
    );
    isStashProxyUriMock.mockImplementation((uri: string) => uri.includes("/stash"));

    const service = await import("./webVideoScanService");
    const result = await service.startWebsiteVideoScanManual();

    expect(isStashProxyUriMock).toHaveBeenCalledWith(
      "app://external/stash?target=http://localhost:9999/stream"
    );
    expect(ensureWebsiteVideoCachedMock).toHaveBeenCalledTimes(1);
    expect(ensureWebsiteVideoCachedMock).toHaveBeenCalledWith("https://page.example/watch/1");
    expect(result.totalCount).toBe(1); // The stash one was filtered out in findUncachedWebsiteVideos
    expect(result.completedCount).toBe(1);
  });

  it("downloads only distinct uncached website URLs", async () => {
    getDbMock.mockReturnValue(
      buildDbMock([
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
      ])
    );
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

  it("continues caching other rounds when one cache discovery fails", async () => {
    getDbMock.mockReturnValue(
      buildDbMock([
        {
          resourceId: "res-1",
          roundId: "round-1",
          roundName: "Broken Round",
          videoUri: "https://page.example/watch/1",
        },
        {
          resourceId: "res-2",
          roundId: "round-2",
          roundName: "Working Round",
          videoUri: "https://page.example/watch/2",
        },
      ])
    );
    getCachedWebsiteVideoMetadataMock.mockImplementation(async (uri: string) => {
      if (uri === "https://page.example/watch/1") {
        throw new Error("Broken cache metadata");
      }
      return null;
    });

    const service = await import("./webVideoScanService");
    const result = await service.startWebsiteVideoScanManual();

    expect(ensureWebsiteVideoCachedMock).toHaveBeenCalledTimes(1);
    expect(ensureWebsiteVideoCachedMock).toHaveBeenCalledWith("https://page.example/watch/2");
    expect(result.state).toBe("done");
    expect(result.totalCount).toBe(2);
    expect(result.completedCount).toBe(1);
    expect(result.skippedCount).toBe(1);
    expect(result.failedCount).toBe(1);
    expect(result.errors).toEqual([
      {
        resourceId: "res-1",
        roundId: "round-1",
        roundName: "Broken Round",
        url: "https://page.example/watch/1",
        reason: "Broken cache metadata",
      },
    ]);
  });

  it("starts non-manual scans without a user-configurable disable switch", async () => {
    getDbMock.mockReturnValue(
      buildDbMock([
        {
          resourceId: "res-1",
          roundId: "round-1",
          roundName: "Round One",
          videoUri: "https://page.example/watch/1",
        },
      ])
    );

    const service = await import("./webVideoScanService");
    const result = await service.startWebsiteVideoScan();

    expect(ensureWebsiteVideoCachedMock).toHaveBeenCalledTimes(1);
    expect(result.state).toBe("done");
    expect(result.completedCount).toBe(1);
  });

  it("starts a targeted cache immediately while install and background work are blocked", async () => {
    getInstallScanStatusMock.mockReturnValue({ state: "running" });
    shouldDeferBackgroundWorkMock.mockReturnValue(true);
    getDbMock.mockReturnValue(buildDbMock([]));

    const service = await import("./webVideoScanService");
    const pending = service.queueWebsiteVideoCacheImmediately({
      resourceId: "res-targeted",
      roundId: "round-targeted",
      roundName: "Targeted Round",
      url: "https://page.example/watch/targeted",
    });

    await vi.waitFor(() => {
      expect(ensureWebsiteVideoCachedMock).toHaveBeenCalledWith(
        "https://page.example/watch/targeted"
      );
    });
    await pending;

    expect(getInstallScanStatusMock).not.toHaveBeenCalled();
  });

  it("runs targeted cache requests sequentially and deduplicates queued URLs", async () => {
    getDbMock.mockReturnValue(buildDbMock([]));
    // Assigned from the async mock after the cache request starts.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let releaseFirst: any = null;
    ensureWebsiteVideoCachedMock.mockImplementation(
      (url: string) =>
        new Promise<{ finalFilePath: string }>((resolve) => {
          if (url.endsWith("/one")) {
            releaseFirst = () => resolve({ finalFilePath: "/tmp/one.mp4" });
            return;
          }
          resolve({ finalFilePath: "/tmp/two.mp4" });
        })
    );

    const service = await import("./webVideoScanService");
    const first = service.queueWebsiteVideoCacheImmediately({
      resourceId: "res-1",
      roundId: "round-1",
      roundName: "Round One",
      url: "https://page.example/watch/one",
    });
    const duplicate = service.queueWebsiteVideoCacheImmediately({
      resourceId: "res-duplicate",
      roundId: "round-duplicate",
      roundName: "Duplicate",
      url: "https://page.example/watch/one",
    });
    const second = service.queueWebsiteVideoCacheImmediately({
      resourceId: "res-2",
      roundId: "round-2",
      roundName: "Round Two",
      url: "https://page.example/watch/two",
    });

    expect(duplicate).toBe(first);
    await vi.waitFor(() => {
      expect(ensureWebsiteVideoCachedMock).toHaveBeenCalledTimes(1);
    });
    expect(ensureWebsiteVideoCachedMock).not.toHaveBeenCalledWith("https://page.example/watch/two");

    releaseFirst?.();
    await Promise.all([first, duplicate, second]);

    expect(ensureWebsiteVideoCachedMock).toHaveBeenCalledTimes(2);
    expect(startPhashScanManualMock).toHaveBeenCalledTimes(2);
  });

  it("prioritizes targeted work without exceeding the bulk concurrency ceiling", async () => {
    const bulkUrls = [1, 2, 3, 4].map((index) => `https://page.example/watch/bulk-${index}`);
    getDbMock.mockReturnValue(
      buildDbMock(
        bulkUrls.map((videoUri, index) => ({
          resourceId: `res-${index}`,
          roundId: `round-${index}`,
          roundName: `Bulk ${index}`,
          videoUri,
        }))
      )
    );

    let activeCount = 0;
    let maxActiveCount = 0;
    const releases = new Map<string, () => void>();
    ensureWebsiteVideoCachedMock.mockImplementation(
      (url: string) =>
        new Promise<{ finalFilePath: string }>((resolve) => {
          activeCount += 1;
          maxActiveCount = Math.max(maxActiveCount, activeCount);
          releases.set(url, () => {
            activeCount -= 1;
            resolve({ finalFilePath: `/tmp/${encodeURIComponent(url)}.mp4` });
          });
        })
    );

    const service = await import("./webVideoScanService");
    const bulkRun = service.startWebsiteVideoScanManual();
    await vi.waitFor(() => {
      expect(ensureWebsiteVideoCachedMock).toHaveBeenCalledTimes(3);
    });

    const targetedUrl = "https://page.example/watch/targeted-priority";
    const targetedRun = service.queueWebsiteVideoCacheImmediately({
      resourceId: "res-targeted",
      roundId: "round-targeted",
      roundName: "Targeted",
      url: targetedUrl,
    });
    expect(ensureWebsiteVideoCachedMock).not.toHaveBeenCalledWith(targetedUrl);

    releases.get(bulkUrls[0]!)?.();
    await vi.waitFor(() => {
      expect(ensureWebsiteVideoCachedMock).toHaveBeenCalledWith(targetedUrl);
    });
    expect(maxActiveCount).toBe(3);

    releases.get(targetedUrl)?.();
    releases.get(bulkUrls[1]!)?.();
    releases.get(bulkUrls[2]!)?.();
    await vi.waitFor(() => {
      expect(ensureWebsiteVideoCachedMock).toHaveBeenCalledWith(bulkUrls[3]);
    });
    releases.get(bulkUrls[3]!)?.();

    await Promise.all([bulkRun, targetedRun]);
    expect(maxActiveCount).toBe(3);
  });

  it("waits for install scanning to finish before downloading", async () => {
    vi.useFakeTimers();
    getDbMock.mockReturnValue(
      buildDbMock([
        {
          resourceId: "res-1",
          roundId: "round-1",
          roundName: "Round One",
          videoUri: "https://page.example/watch/1",
        },
      ])
    );

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
    getDbMock.mockReturnValue(
      buildDbMock([
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
      ])
    );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let releaseFirst: any = null;
    ensureWebsiteVideoCachedMock.mockImplementation((url: string) => {
      if (url === "https://page.example/watch/1") {
        return new Promise<{ finalFilePath: string }>((resolve) => {
          releaseFirst = resolve;
        });
      }
      return Promise.resolve({ finalFilePath: "/tmp/cached-2.mp4" });
    });

    const service = await import("./webVideoScanService");
    const pending = service.startWebsiteVideoScanManual();

    await vi.waitFor(() => {
      expect(ensureWebsiteVideoCachedMock).toHaveBeenCalledWith("https://page.example/watch/1");
    });

    service.requestWebsiteVideoScanAbort();
    releaseFirst?.({ finalFilePath: "/tmp/cached-1.mp4" });
    await vi.runAllTimersAsync();

    const result = await pending;
    expect(ensureWebsiteVideoCachedMock).toHaveBeenCalledTimes(2);
    expect(result.state).toBe("aborted");
    expect(result.completedCount).toBe(2);
    expect(result.totalCount).toBe(2);
  });

  it("processes multiple downloads in parallel", async () => {
    vi.useFakeTimers();
    getDbMock.mockReturnValue(
      buildDbMock([
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
      ])
    );

    const releases = new Map<string, () => void>();
    ensureWebsiteVideoCachedMock.mockImplementation(
      (url: string) =>
        new Promise<{ finalFilePath: string }>((resolve) => {
          releases.set(url, () =>
            resolve({ finalFilePath: `/tmp/${encodeURIComponent(url)}.mp4` })
          );
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

    const queryResults = [
      [
        {
          resourceId: "res-1",
          roundId: "round-1",
          roundName: "Round One",
          videoUri: "https://page.example/watch/1",
        },
      ],
      [],
      [
        {
          resourceId: "res-2",
          roundId: "round-2",
          roundName: "Round Two",
          videoUri: "https://page.example/watch/2",
        },
      ],
      [],
      [],
    ];

    getDbMock.mockReturnValue({
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          innerJoin: vi.fn(() => ({
            where: vi.fn(async () => queryResults.shift() ?? []),
          })),
        })),
      })),
    });

    const releases = new Map<string, () => void>();
    ensureWebsiteVideoCachedMock.mockImplementation(
      (url: string) =>
        new Promise<{ finalFilePath: string }>((resolve) => {
          releases.set(url, () =>
            resolve({ finalFilePath: `/tmp/${encodeURIComponent(url)}.mp4` })
          );
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

  it("delays the initial continuous scan so startup stays responsive", async () => {
    vi.useFakeTimers();
    getDbMock.mockReturnValue(
      buildDbMock([
        {
          resourceId: "res-1",
          roundId: "round-1",
          roundName: "Round 1",
          videoUri: "https://page.example/watch/1",
        },
      ])
    );

    const service = await import("./webVideoScanService");
    service.startContinuousWebsiteVideoScan();

    await vi.advanceTimersByTimeAsync(59_999);
    expect(ensureWebsiteVideoCachedMock).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    await vi.waitFor(() => {
      expect(ensureWebsiteVideoCachedMock).toHaveBeenCalledWith("https://page.example/watch/1");
    });
    service.stopContinuousWebsiteVideoScan();
  });
});
