// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  getDbMock,
  getInstallScanStatusMock,
  generateVideoPhashMock,
  resolveDirectPlayableResolutionMock,
  storeGetMock,
} = vi.hoisted(() => ({
  getDbMock: vi.fn(),
  getInstallScanStatusMock: vi.fn(),
  generateVideoPhashMock: vi.fn(),
  resolveDirectPlayableResolutionMock: vi.fn(),
  storeGetMock: vi.fn(),
}));

vi.mock("./db", () => ({
  getDb: getDbMock,
}));

vi.mock("./installer", () => ({
  getInstallScanStatus: getInstallScanStatusMock,
}));

vi.mock("./phash", () => ({
  generateVideoPhash: generateVideoPhashMock,
}));

vi.mock("./store", () => ({
  getStore: () => ({
    get: storeGetMock,
  }),
}));

vi.mock("../../../src/constants/phashSettings", () => ({
  BACKGROUND_PHASH_SCANNING_ENABLED_KEY: "game.backgroundPhashScanning.enabled",
  BACKGROUND_PHASH_ROUNDS_PER_PASS_KEY: "game.backgroundPhashScanning.roundsPerPass",
  normalizeBackgroundPhashScanningEnabled: () => true,
  normalizeBackgroundPhashRoundsPerPass: (value: unknown) => {
    const parsed = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(parsed)) return 3;
    return Math.max(1, Math.min(20, Math.floor(parsed)));
  },
}));

vi.mock("./integrations", () => ({
  resolveDirectPlayableResolution: resolveDirectPlayableResolutionMock,
}));

function buildDbMock(
  rows: Array<{
    roundId: string;
    roundName: string;
    resourceId: string;
    videoUri: string;
    startTime: number | null;
    endTime: number | null;
  }>
) {
  const roundUpdates: Array<{ phash: string | null }> = [];
  const resourceUpdates: Array<{ phash: string | null }> = [];
  let updateCallCount = 0;

  return {
    roundUpdates,
    resourceUpdates,
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        innerJoin: vi.fn(() => ({
          where: vi.fn(async () => rows),
        })),
      })),
    })),
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    update: vi.fn((_table: unknown) => ({
      set: vi.fn((values: { phash?: string | null }) => ({
        where: vi.fn(async () => {
          updateCallCount += 1;
          if (updateCallCount % 2 === 1) {
            roundUpdates.push({ phash: values.phash ?? null });
            return;
          }
          resourceUpdates.push({ phash: values.phash ?? null });
        }),
      })),
    })),
  };
}

describe("phashScanService", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.useRealTimers();
    getInstallScanStatusMock.mockReturnValue({ state: "idle" });
    generateVideoPhashMock.mockResolvedValue("phash-1");
    resolveDirectPlayableResolutionMock.mockResolvedValue(null);
    storeGetMock.mockReturnValue(undefined);
  });

  it("skips rounds when no playable resolution is found", async () => {
    const dbMock = buildDbMock([
      {
        roundId: "round-unavailable",
        roundName: "Unavailable Video",
        resourceId: "res-1",
        videoUri: "app://external/stash?target=http://localhost:9999/stream",
        startTime: 0,
        endTime: 1000,
      },
    ]);
    getDbMock.mockReturnValue(dbMock);
    resolveDirectPlayableResolutionMock.mockResolvedValue(null);

    const service = await import("./phashScanService");
    const result = await service.startPhashScanManual();

    expect(resolveDirectPlayableResolutionMock).toHaveBeenCalledWith(
      "app://external/stash?target=http://localhost:9999/stream"
    );
    expect(generateVideoPhashMock).not.toHaveBeenCalled();
    expect(result.completedCount).toBe(0);
    expect(result.skippedCount).toBe(1);
    expect(result.state).toBe("done");
  });

  it("computes phash for resolved video paths", async () => {
    const dbMock = buildDbMock([
      {
        roundId: "round-1",
        roundName: "Round One",
        resourceId: "res-1",
        videoUri: "https://page.example/watch/1",
        startTime: 1000,
        endTime: 5000,
      },
    ]);
    getDbMock.mockReturnValue(dbMock);
    resolveDirectPlayableResolutionMock.mockResolvedValue({
      streamUrl: "/tmp/cached-website.mp4",
    });

    const service = await import("./phashScanService");
    const result = await service.startPhashScanManual();

    expect(resolveDirectPlayableResolutionMock).toHaveBeenCalledWith(
      "https://page.example/watch/1"
    );
    expect(generateVideoPhashMock).toHaveBeenCalledWith("/tmp/cached-website.mp4", 1000, 5000, {
      lowPriority: true,
      headers: undefined,
    });
    expect(dbMock.roundUpdates).toHaveLength(1);
    expect(dbMock.resourceUpdates).toHaveLength(1);
    expect(result.state).toBe("done");
    expect(result.completedCount).toBe(1);
  });

  it("computes phash with headers when provided by resolution", async () => {
    const dbMock = buildDbMock([
      {
        roundId: "round-headers",
        roundName: "Headers Round",
        resourceId: "res-1",
        videoUri: "app://external/stash?target=http://localhost:9999/stream",
        startTime: 2000,
        endTime: 6000,
      },
    ]);
    getDbMock.mockReturnValue(dbMock);
    resolveDirectPlayableResolutionMock.mockResolvedValue({
      streamUrl: "http://localhost:9999/stream",
      headers: { Authorization: "Bearer token123" },
    });

    const service = await import("./phashScanService");
    const result = await service.startPhashScanManual();

    expect(generateVideoPhashMock).toHaveBeenCalledWith(
      "http://localhost:9999/stream",
      2000,
      6000,
      {
        lowPriority: true,
        headers: { Authorization: "Bearer token123" },
      }
    );
    expect(result.completedCount).toBe(1);
  });

  it("falls back to another resource on the same round when the first has no resolution", async () => {
    const dbMock = buildDbMock([
      {
        roundId: "round-1",
        roundName: "Round One",
        resourceId: "res-1",
        videoUri: "https://page.example/watch/uncached",
        startTime: 1000,
        endTime: 5000,
      },
      {
        roundId: "round-1",
        roundName: "Round One",
        resourceId: "res-2",
        videoUri: "https://page.example/watch/cached",
        startTime: 1000,
        endTime: 5000,
      },
    ]);
    getDbMock.mockReturnValue(dbMock);
    resolveDirectPlayableResolutionMock.mockImplementation(async (uri: string) => {
      if (uri.endsWith("/cached")) {
        return { streamUrl: "/tmp/cached-website.mp4" };
      }
      return null;
    });

    const service = await import("./phashScanService");
    const result = await service.startPhashScanManual();

    expect(resolveDirectPlayableResolutionMock).toHaveBeenCalledWith(
      "https://page.example/watch/uncached"
    );
    expect(resolveDirectPlayableResolutionMock).toHaveBeenCalledWith(
      "https://page.example/watch/cached"
    );
    expect(generateVideoPhashMock).toHaveBeenCalledWith("/tmp/cached-website.mp4", 1000, 5000, {
      lowPriority: true,
      headers: undefined,
    });
    expect(dbMock.roundUpdates).toHaveLength(1);
    expect(dbMock.resourceUpdates).toEqual([{ phash: "phash-1" }]);
    expect(result.state).toBe("done");
    expect(result.completedCount).toBe(1);
    expect(result.failedCount).toBe(0);
  });

  it("queues a rerun when another phash scan is requested during an active scan", async () => {
    vi.useFakeTimers();

    const rowsByPass = [
      [
        {
          roundId: "round-1",
          roundName: "Round One",
          resourceId: "res-1",
          videoUri: "https://page.example/watch/1",
          startTime: 1000,
          endTime: 5000,
        },
      ],
      [
        {
          roundId: "round-2",
          roundName: "Round Two",
          resourceId: "res-2",
          videoUri: "https://page.example/watch/2",
          startTime: 2000,
          endTime: 6000,
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
      update: vi.fn(() => ({
        set: vi.fn(() => ({
          where: vi.fn(async () => undefined),
        })),
      })),
    });

    const releases = new Map<string, () => void>();
    resolveDirectPlayableResolutionMock.mockImplementation(async (uri: string) => {
      if (uri.endsWith("/1")) return { streamUrl: "/tmp/cached-website-1.mp4" };
      if (uri.endsWith("/2")) return { streamUrl: "/tmp/cached-website-2.mp4" };
      return null;
    });
    generateVideoPhashMock.mockImplementation(
      (videoPath: string) =>
        new Promise<string>((resolve) => {
          releases.set(videoPath, () => resolve(`phash:${videoPath}`));
        })
    );

    const service = await import("./phashScanService");
    const firstRun = service.startPhashScanManual();

    await vi.waitFor(() => {
      expect(generateVideoPhashMock).toHaveBeenCalledWith("/tmp/cached-website-1.mp4", 1000, 5000, {
        lowPriority: true,
        headers: undefined,
      });
    });

    await service.startPhashScanManual();

    releases.get("/tmp/cached-website-1.mp4")?.();
    await vi.runAllTimersAsync();

    await vi.waitFor(() => {
      expect(generateVideoPhashMock).toHaveBeenCalledWith("/tmp/cached-website-2.mp4", 2000, 6000, {
        lowPriority: true,
        headers: undefined,
      });
    });

    releases.get("/tmp/cached-website-2.mp4")?.();
    await vi.runAllTimersAsync();

    await firstRun;
    expect(service.getPhashScanStatus().state).toBe("done");
    expect(generateVideoPhashMock).toHaveBeenCalledTimes(2);
  });

  it("limits background scans to the configured rounds per pass", async () => {
    const rows = Array.from({ length: 5 }, (_, index) => ({
      roundId: `round-${index + 1}`,
      roundName: `Round ${index + 1}`,
      resourceId: `res-${index + 1}`,
      videoUri: `https://page.example/watch/${index + 1}`,
      startTime: null,
      endTime: null,
    }));
    const dbMock = buildDbMock(rows);
    getDbMock.mockReturnValue(dbMock);
    storeGetMock.mockImplementation((key: string) =>
      key === "game.backgroundPhashScanning.roundsPerPass" ? 2 : true
    );
    resolveDirectPlayableResolutionMock.mockImplementation(async (uri: string) => ({
      streamUrl: `/tmp/${uri.split("/").pop()}.mp4`,
    }));

    const service = await import("./phashScanService");
    const result = await service.startPhashScan();

    expect(result.totalCount).toBe(2);
    expect(result.completedCount).toBe(2);
    expect(generateVideoPhashMock).toHaveBeenCalledTimes(2);
    expect(dbMock.roundUpdates).toHaveLength(2);
  });

  it("uses the default background batch size when the stored value is invalid", async () => {
    const rows = Array.from({ length: 5 }, (_, index) => ({
      roundId: `round-${index + 1}`,
      roundName: `Round ${index + 1}`,
      resourceId: `res-${index + 1}`,
      videoUri: `https://page.example/watch/${index + 1}`,
      startTime: null,
      endTime: null,
    }));
    getDbMock.mockReturnValue(buildDbMock(rows));
    storeGetMock.mockImplementation((key: string) =>
      key === "game.backgroundPhashScanning.roundsPerPass" ? "bad" : true
    );
    resolveDirectPlayableResolutionMock.mockImplementation(async (uri: string) => ({
      streamUrl: `/tmp/${uri.split("/").pop()}.mp4`,
    }));

    const service = await import("./phashScanService");
    const result = await service.startPhashScan();

    expect(result.totalCount).toBe(3);
    expect(result.completedCount).toBe(3);
    expect(generateVideoPhashMock).toHaveBeenCalledTimes(3);
  });
});
