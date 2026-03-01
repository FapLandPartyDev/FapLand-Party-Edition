import { beforeEach, describe, expect, it, vi } from "vitest";

const handyIndexMocks = vi.hoisted(() => ({
  getDeviceInfo: vi.fn(),
  getServerTime: vi.fn(async () => ({ server_time: 10_250 })),
  hspAdd: vi.fn(async () => ({ result: {} })),
  hspFlush: vi.fn(async () => ({ result: { max_points: 4000 } })),
  hspPause: vi.fn(async () => ({ result: {} })),
  hspPlay: vi.fn(async () => ({ result: {} })),
  hspResume: vi.fn(async () => ({ result: {} })),
  hspSetup: vi.fn(async () => ({ result: { max_points: 4000 } })),
  hspStop: vi.fn(async () => ({ result: {} })),
  isConnected: vi.fn(),
  issueToken: vi.fn(),
  setHspPaybackRate: vi.fn(async () => ({ result: {} })),
  setHspTime: vi.fn(async () => ({ result: {} })),
  setMode: vi.fn(async () => ({ result: {} })),
}));

vi.mock("./index", () => handyIndexMocks);

import {
  issueHandySession,
  preloadHspScript,
  resolveInitialPreloadTargetMs,
  sendHspSync,
  type HandySession,
} from "./runtime";

function createLoadedHspSession(overrides: Partial<HandySession> = {}): HandySession {
  return {
    mode: "appId",
    clientToken: null,
    expiresAtMs: 120_000,
    serverTimeOffsetMs: 0,
    serverTimeOffsetMeasuredAtMs: Date.now(),
    loadedScriptId: "video-1:500:0:249500",
    activeScriptId: "video-1:500:0:249500",
    lastSyncAtMs: Date.now(),
    lastPlaybackRate: 1,
    maxBufferPoints: 1000,
    streamedPoints: Array.from({ length: 500 }, (_, index) => ({
      t: index * 500,
      x: index % 2 === 0 ? 20 : 80,
    })),
    nextStreamPointIndex: 100,
    tailPointStreamIndex: 100,
    uploadedUntilMs: 49_500,
    lastHspAddAtMs: 0,
    hspAddBackoffUntilMs: 0,
    hspModeActive: true,
    ...overrides,
  };
}

const longActions = Array.from({ length: 500 }, (_, index) => ({
  at: index * 500,
  pos: index % 2 === 0 ? 20 : 80,
}));

type HspAddCallOptions = {
  body: {
    points: Array<{ t: number; x: number }>;
    tail_point_stream_index: number;
    flush: boolean;
  };
};

function getHspAddCall(index: number): HspAddCallOptions {
  const call = handyIndexMocks.hspAdd.mock.calls[index] as unknown as
    | [HspAddCallOptions]
    | undefined;
  const options = call?.[0];
  if (!options) {
    throw new Error(`Missing hspAdd call ${index}`);
  }
  return options;
}

function getAllHspAddedPoints(): Array<{ t: number; x: number }> {
  return handyIndexMocks.hspAdd.mock.calls.flatMap((call) => {
    const [options] = call as unknown as [HspAddCallOptions];
    return options.body.points;
  });
}

describe("resolveInitialPreloadTargetMs", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it("extends the initial preload to include the first point after startup", () => {
    const targetMs = resolveInitialPreloadTargetMs(
      [
        { t: 0, x: 25 },
        { t: 30_000, x: 75 },
      ],
      0,
      0
    );

    expect(targetMs).toBe(30_000);
  });

  it("extends the initial preload when resuming inside a long interpolation gap", () => {
    const targetMs = resolveInitialPreloadTargetMs(
      [
        { t: 0, x: 25 },
        { t: 30_000, x: 75 },
      ],
      0,
      10_000
    );

    // start=10000, initial target = 10000 + 30000 = 40000; next point at 30000 < 40000, stays 40000
    expect(targetMs).toBe(40_000);
  });

  it("keeps the full 30s preload window when a future point is already nearby", () => {
    const targetMs = resolveInitialPreloadTargetMs(
      [
        { t: 9_000, x: 25 },
        { t: 12_000, x: 75 },
      ],
      0,
      10_000
    );

    // start=10000, initial target = max(10000, 9000) + 30000 = 40000; next point 12000 < 40000, stays 40000
    expect(targetMs).toBe(40_000);
  });
});

describe("sendHspSync", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it("uses the cached estimated Handy server time instead of raw local wall-clock time", async () => {
    vi.spyOn(Date, "now")
      .mockReturnValueOnce(20_000)
      .mockReturnValueOnce(30_000)
      .mockReturnValueOnce(40_000)
      .mockReturnValueOnce(50_000);

    const session: HandySession = {
      mode: "appId",
      clientToken: null,
      expiresAtMs: 60_000,
      serverTimeOffsetMs: 180,
      serverTimeOffsetMeasuredAtMs: 19_000,
      loadedScriptId: "video-1:2:0:1000",
      activeScriptId: null,
      lastSyncAtMs: 0,
      lastPlaybackRate: 1,
      maxBufferPoints: 4000,
      streamedPoints: [
        { t: 0, x: 20 },
        { t: 1000, x: 80 },
      ],
      nextStreamPointIndex: 2,
      tailPointStreamIndex: 2,
      uploadedUntilMs: 1000,
      lastHspAddAtMs: 0,
      hspAddBackoffUntilMs: 0,
      hspModeActive: true,
    };

    await sendHspSync(
      {
        connectionKey: "conn-key",
        appApiKey: "app-key",
      },
      session,
      500,
      1,
      "video-1",
      [
        { at: 0, pos: 20 },
        { at: 1000, pos: 80 },
      ]
    );

    expect(handyIndexMocks.getServerTime).not.toHaveBeenCalled();
    expect(handyIndexMocks.hspPlay).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({
          start_time: 500,
          server_time: 30_180,
        }),
      })
    );
    expect(handyIndexMocks.setHspTime).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({
          current_time: 500,
          server_time: 50_180,
        }),
      })
    );
  });

  it("advances HSP stream state only after a successful top-up append", async () => {
    const session = createLoadedHspSession();

    await sendHspSync(
      {
        connectionKey: "conn-key",
        appApiKey: "app-key",
      },
      session,
      20_000,
      1,
      "video-1",
      longActions
    );

    expect(handyIndexMocks.hspAdd).toHaveBeenCalled();
    const firstAppend = getHspAddCall(0);
    expect(firstAppend).toEqual(
      expect.objectContaining({
        body: expect.objectContaining({
          points: expect.arrayContaining([
            { t: 50_000, x: 20 },
            { t: 99_500, x: 80 },
          ]),
          tail_point_stream_index: 200,
          flush: false,
        }),
      })
    );
    expect(firstAppend.body.points).toHaveLength(100);
    for (const call of handyIndexMocks.hspAdd.mock.calls) {
      const [options] = call as unknown as [HspAddCallOptions];
      expect(options.body.points.length).toBeLessThanOrEqual(100);
    }
    expect(session.nextStreamPointIndex).toBe(200);
    expect(session.tailPointStreamIndex).toBe(200);
    expect(session.uploadedUntilMs).toBe(99_500);
    expect(session.lastHspAddAtMs).toBeGreaterThan(0);
  });

  it("does not advance HSP stream state when a top-up append fails", async () => {
    const session = createLoadedHspSession();
    handyIndexMocks.hspAdd.mockRejectedValueOnce(new Error("temporary hsp add failure"));

    await expect(
      sendHspSync(
        {
          connectionKey: "conn-key",
          appApiKey: "app-key",
        },
        session,
        20_000,
        1,
        "video-1",
        longActions
      )
    ).rejects.toThrow("temporary hsp add failure");

    expect(session.nextStreamPointIndex).toBe(100);
    expect(session.tailPointStreamIndex).toBe(100);
    expect(session.uploadedUntilMs).toBe(49_500);
    expect(session.hspAddBackoffUntilMs).toBeGreaterThan(0);
  });

  it("retries the same unsent HSP chunk after a failed top-up append", async () => {
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(1_000);
    const session = createLoadedHspSession();
    handyIndexMocks.hspAdd.mockRejectedValueOnce(new Error("temporary hsp add failure"));

    await expect(
      sendHspSync(
        {
          connectionKey: "conn-key",
          appApiKey: "app-key",
        },
        session,
        20_000,
        1,
        "video-1",
        longActions
      )
    ).rejects.toThrow("temporary hsp add failure");

    nowSpy.mockReturnValue(1_400);
    await sendHspSync(
      {
        connectionKey: "conn-key",
        appApiKey: "app-key",
      },
      session,
      20_000,
      1,
      "video-1",
      longActions
    );

    expect(handyIndexMocks.hspAdd).toHaveBeenCalledTimes(2);
    const failedAppend = getHspAddCall(0);
    const retryAppend = getHspAddCall(1);
    expect(failedAppend.body.points).toEqual(retryAppend.body.points);
    expect(retryAppend.body.tail_point_stream_index).toBe(200);
    expect(session.nextStreamPointIndex).toBe(200);
    expect(session.tailPointStreamIndex).toBe(200);
    expect(session.uploadedUntilMs).toBe(99_500);
  });

  it("uses a larger initial buffer for dense fast scripts", async () => {
    handyIndexMocks.hspFlush.mockResolvedValueOnce({ result: { max_points: 4000 } });
    const denseActions = Array.from({ length: 5000 }, (_, index) => ({
      at: index * 10,
      pos: index % 2 === 0 ? 15 : 95,
    }));
    const session = createLoadedHspSession({
      loadedScriptId: null,
      activeScriptId: null,
      streamedPoints: null,
      nextStreamPointIndex: 0,
      tailPointStreamIndex: 0,
      uploadedUntilMs: 0,
      maxBufferPoints: 4000,
      hspModeActive: false,
    });

    await preloadHspScript(
      {
        connectionKey: "conn-key",
        appApiKey: "app-key",
      },
      session,
      "dense-video",
      denseActions,
      0
    );

    expect(handyIndexMocks.hspAdd).toHaveBeenCalledTimes(30);
    for (const call of handyIndexMocks.hspAdd.mock.calls) {
      const [options] = call as unknown as [HspAddCallOptions];
      expect(options.body.points.length).toBeLessThanOrEqual(100);
    }
    expect(session.nextStreamPointIndex).toBe(3000);
    expect(session.tailPointStreamIndex).toBe(3000);
    expect(session.uploadedUntilMs).toBe(29_990);
  });

  it("paces ongoing top-up appends from repeated sync calls", async () => {
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(1_000);
    const session = createLoadedHspSession();

    await sendHspSync(
      {
        connectionKey: "conn-key",
        appApiKey: "app-key",
      },
      session,
      20_000,
      1,
      "video-1",
      longActions
    );
    expect(handyIndexMocks.hspAdd).toHaveBeenCalledTimes(1);
    expect(session.nextStreamPointIndex).toBe(200);

    nowSpy.mockReturnValue(1_200);
    await sendHspSync(
      {
        connectionKey: "conn-key",
        appApiKey: "app-key",
      },
      session,
      20_100,
      1,
      "video-1",
      longActions
    );
    expect(handyIndexMocks.hspAdd).toHaveBeenCalledTimes(1);
    expect(session.nextStreamPointIndex).toBe(200);

    nowSpy.mockReturnValue(1_400);
    await sendHspSync(
      {
        connectionKey: "conn-key",
        appApiKey: "app-key",
      },
      session,
      20_200,
      1,
      "video-1",
      longActions
    );
    expect(handyIndexMocks.hspAdd).toHaveBeenCalledTimes(2);
    expect(session.nextStreamPointIndex).toBe(300);
  });

  it("tops up dense scripts when point-buffer occupancy is low", async () => {
    const session = createLoadedHspSession({
      nextStreamPointIndex: 40,
      tailPointStreamIndex: 40,
      uploadedUntilMs: 100_000,
    });

    await sendHspSync(
      {
        connectionKey: "conn-key",
        appApiKey: "app-key",
      },
      session,
      10_000,
      1,
      "video-1",
      longActions
    );

    expect(handyIndexMocks.hspAdd).toHaveBeenCalledTimes(1);
    expect(session.nextStreamPointIndex).toBe(140);
    expect(session.tailPointStreamIndex).toBe(140);
    expect(session.uploadedUntilMs).toBe(69_500);
  });

  it("uploads fast script points without downsampling", async () => {
    const fastActions = Array.from({ length: 64 }, (_, index) => ({
      at: index * 8,
      pos: index % 4 === 0 ? 100 : index % 4 === 1 ? 0 : index % 4 === 2 ? 75 : 25,
    }));
    const session = createLoadedHspSession({
      loadedScriptId: null,
      activeScriptId: null,
      streamedPoints: null,
      nextStreamPointIndex: 0,
      tailPointStreamIndex: 0,
      uploadedUntilMs: 0,
      maxBufferPoints: 4000,
      hspModeActive: false,
    });

    await preloadHspScript(
      {
        connectionKey: "conn-key",
        appApiKey: "app-key",
      },
      session,
      "fast-video",
      fastActions,
      0
    );

    expect(getAllHspAddedPoints()).toEqual(
      fastActions.map((action) => ({
        t: action.at,
        x: action.pos,
      }))
    );
  });
});

describe("issueHandySession", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it("falls back to zero offset when server time sampling fails", async () => {
    handyIndexMocks.getServerTime.mockRejectedValueOnce(new Error("server time unavailable"));
    handyIndexMocks.getServerTime.mockRejectedValueOnce(new Error("server time unavailable"));
    handyIndexMocks.getServerTime.mockRejectedValueOnce(new Error("server time unavailable"));

    const session = await issueHandySession({
      connectionKey: "conn-key",
      appApiKey: "app-key",
    });

    expect(handyIndexMocks.getServerTime).toHaveBeenCalledTimes(3);
    expect(session.serverTimeOffsetMs).toBe(0);
    expect(session.serverTimeOffsetMeasuredAtMs).toBeGreaterThan(0);
  });

  it("samples server time once during session creation", async () => {
    const timestamps = [9_000, 10_000, 10_020, 10_030, 10_050, 10_060, 10_080, 10_090];
    let timestampIndex = 0;
    vi.spyOn(Date, "now").mockImplementation(() => {
      const value =
        timestamps[Math.min(timestampIndex, timestamps.length - 1)] ??
        timestamps[timestamps.length - 1]!;
      timestampIndex += 1;
      return value;
    });

    const session = await issueHandySession({
      connectionKey: "conn-key",
      appApiKey: "app-key",
    });

    expect(handyIndexMocks.getServerTime).toHaveBeenCalledTimes(3);
    expect(session.serverTimeOffsetMeasuredAtMs).toBe(10_000);
    expect(session.serverTimeOffsetMs).toBeGreaterThan(0);
  });
});
