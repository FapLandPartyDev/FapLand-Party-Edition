import { beforeEach, describe, expect, it, vi } from "vitest";

const handyIndexMocks = vi.hoisted(() => ({
  getDeviceInfo: vi.fn(),
  getStroke: vi.fn(async () => ({
    result: { min: 0.1, max: 0.9, min_absolute: 20, max_absolute: 180 },
  })),
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
  setStroke: vi.fn(async ({ body }: { body: { min: number; max: number } }) => ({
    result: { min: body.min, max: body.max },
  })),
}));

vi.mock("./index", () => handyIndexMocks);

import {
  getHandyStroke,
  issueHandySession,
  preloadHspScript,
  resolveInitialPreloadTargetMs,
  sendHspSync,
  updateHandyStroke,
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
    [HspAddCallOptions] | undefined;
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

describe("handy stroke helpers", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it("reads and normalizes the current stroke settings", async () => {
    const stroke = await getHandyStroke({
      connectionKey: "conn-key",
      appApiKey: "app-key",
    });

    expect(handyIndexMocks.getStroke).toHaveBeenCalledTimes(1);
    expect(stroke).toEqual({
      min: 0.1,
      max: 0.9,
      minAbsolute: 20,
      maxAbsolute: 180,
    });
  });

  it("updates stroke settings using the official slider stroke endpoint", async () => {
    const stroke = await updateHandyStroke(
      {
        connectionKey: "conn-key",
        appApiKey: "app-key",
      },
      {
        min: 0.2,
        max: 0.8,
      }
    );

    expect(handyIndexMocks.setStroke).toHaveBeenCalledTimes(1);
    expect(handyIndexMocks.setStroke.mock.calls[0]?.[0]).toMatchObject({
      body: {
        min: 0.2,
        max: 0.8,
      },
      headers: {
        "X-Connection-Key": "conn-key",
      },
    });
    expect(stroke).toEqual({
      min: 0.2,
      max: 0.8,
      minAbsolute: null,
      maxAbsolute: null,
    });
  });

  it("throws a meaningful error when stroke settings are unavailable", async () => {
    const unavailableStrokePayload: unknown = { result: {} };
    handyIndexMocks.getStroke.mockResolvedValueOnce(
      unavailableStrokePayload as {
        result: { min: number; max: number; min_absolute: number; max_absolute: number };
      }
    );

    await expect(
      getHandyStroke({
        connectionKey: "conn-key",
        appApiKey: "app-key",
      })
    ).rejects.toThrow("Stroke settings unavailable.");
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

  it("forces an immediate unfiltered correction when requested", async () => {
    const session = createLoadedHspSession({ lastSyncAtMs: Date.now() });

    await sendHspSync(
      { connectionKey: "conn-key", appApiKey: "app-key" },
      session,
      750,
      1,
      "video-1",
      longActions,
      { forceTimeSync: true, timeFilter: null }
    );

    expect(handyIndexMocks.setHspTime).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.not.objectContaining({ filter: expect.anything() }),
      })
    );
  });

  it("does not throttle the retry after a device-level sync error", async () => {
    const lastSyncAtMs = Date.now() - 10_000;
    const session = createLoadedHspSession({ lastSyncAtMs });
    handyIndexMocks.setHspTime.mockResolvedValueOnce({
      error: {
        code: 1002,
        name: "DeviceTimeout",
        message: "Device timeout",
        connected: true,
      },
    } as never);

    await expect(
      sendHspSync(
        { connectionKey: "conn-key", appApiKey: "app-key" },
        session,
        750,
        1,
        "video-1",
        longActions
      )
    ).rejects.toThrow("Device timeout");

    expect(session.lastSyncAtMs).toBe(lastSyncAtMs);
    await sendHspSync(
      { connectionKey: "conn-key", appApiKey: "app-key" },
      session,
      760,
      1,
      "video-1",
      longActions
    );
    expect(handyIndexMocks.setHspTime).toHaveBeenCalledTimes(2);
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

  it("does not advance HSP stream state when all hspAdd retries are exhausted", async () => {
    const session = createLoadedHspSession();
    handyIndexMocks.hspAdd
      .mockRejectedValueOnce(new Error("temporary hsp add failure"))
      .mockRejectedValueOnce(new Error("temporary hsp add failure"))
      .mockRejectedValueOnce(new Error("temporary hsp add failure"));

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

    expect(handyIndexMocks.hspAdd).toHaveBeenCalledTimes(3);
    expect(session.nextStreamPointIndex).toBe(100);
    expect(session.tailPointStreamIndex).toBe(100);
    expect(session.uploadedUntilMs).toBe(49_500);
    expect(session.hspAddBackoffUntilMs).toBeGreaterThan(0);
  });

  it("retries individual hspAdd chunks before giving up", async () => {
    const session = createLoadedHspSession();
    handyIndexMocks.hspAdd
      .mockRejectedValueOnce(new Error("transient"))
      .mockResolvedValueOnce({ result: {} });

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
    expect(session.nextStreamPointIndex).toBe(200);
    expect(session.tailPointStreamIndex).toBe(200);
  });

  it("retries the same unsent HSP chunk after all per-chunk retries are exhausted", async () => {
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(1_000);
    const session = createLoadedHspSession();
    handyIndexMocks.hspAdd
      .mockRejectedValueOnce(new Error("temporary hsp add failure"))
      .mockRejectedValueOnce(new Error("temporary hsp add failure"))
      .mockRejectedValueOnce(new Error("temporary hsp add failure"));

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

    expect(handyIndexMocks.hspAdd).toHaveBeenCalledTimes(4);
    const failedAppend = getHspAddCall(0);
    const retryAppend = getHspAddCall(3);
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

describe("prepareHspMode retries", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it("retries hspSetup on transient failure during preload", async () => {
    handyIndexMocks.hspSetup
      .mockRejectedValueOnce(new Error("transient setup failure"))
      .mockResolvedValueOnce({ result: { max_points: 4000 } });

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
      { connectionKey: "conn-key", appApiKey: "app-key" },
      session,
      "retry-video",
      [{ at: 0, pos: 50 }],
      0
    );

    expect(handyIndexMocks.hspSetup).toHaveBeenCalledTimes(2);
    expect(session.hspModeActive).toBe(true);
  });

  it("uses the session's unique stream id during HSP setup", async () => {
    const session = createLoadedHspSession({
      loadedScriptId: null,
      activeScriptId: null,
      streamedPoints: null,
      hspModeActive: false,
      streamId: 4242,
    });

    await preloadHspScript(
      { connectionKey: "conn-key", appApiKey: "app-key" },
      session,
      "new-stream",
      [{ at: 0, pos: 50 }]
    );

    expect(handyIndexMocks.hspSetup).toHaveBeenCalledWith(
      expect.objectContaining({ body: { stream_id: 4242 } })
    );
  });

  it("retries hspFlush on transient failure during preload", async () => {
    handyIndexMocks.hspFlush
      .mockRejectedValueOnce(new Error("transient flush failure"))
      .mockResolvedValueOnce({ result: { max_points: 4000 } });

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
      { connectionKey: "conn-key", appApiKey: "app-key" },
      session,
      "retry-video",
      [{ at: 0, pos: 50 }],
      0
    );

    expect(handyIndexMocks.hspFlush).toHaveBeenCalledTimes(2);
    expect(session.hspModeActive).toBe(true);
  });

  it("lets HSP setup select the device mode without an explicit mode command", async () => {
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
      { connectionKey: "conn-key", appApiKey: "app-key" },
      session,
      "retry-video",
      [{ at: 0, pos: 50 }],
      0
    );

    expect(handyIndexMocks.setMode).not.toHaveBeenCalled();
    expect(handyIndexMocks.hspSetup).toHaveBeenCalledTimes(1);
    expect(session.hspModeActive).toBe(true);
  });
});
