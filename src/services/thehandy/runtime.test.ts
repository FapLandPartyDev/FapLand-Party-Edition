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

import { issueHandySession, resolveInitialPreloadTargetMs, sendHspSync, type HandySession } from "./runtime";

describe("resolveInitialPreloadTargetMs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("extends the initial preload to include the first point after startup", () => {
    const targetMs = resolveInitialPreloadTargetMs(
      [
        { t: 0, x: 25 },
        { t: 30_000, x: 75 },
      ],
      0,
      0,
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
      10_000,
    );

    expect(targetMs).toBe(30_000);
  });

  it("keeps the normal 15s preload window when a future point is already nearby", () => {
    const targetMs = resolveInitialPreloadTargetMs(
      [
        { t: 9_000, x: 25 },
        { t: 12_000, x: 75 },
      ],
      0,
      10_000,
    );

    expect(targetMs).toBe(25_000);
  });
});

describe("sendHspSync", () => {
  beforeEach(() => {
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
      loadedScriptId: null,
      activeScriptId: null,
      lastSyncAtMs: 0,
      lastPlaybackRate: 1,
      maxBufferPoints: 4000,
      streamedPoints: null,
      nextStreamPointIndex: 0,
      tailPointStreamIndex: 0,
      uploadedUntilMs: 0,
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
      ],
    );

    expect(handyIndexMocks.getServerTime).not.toHaveBeenCalled();
    expect(handyIndexMocks.hspPlay).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({
          start_time: 500,
          server_time: 30_180,
        }),
      }),
    );
    expect(handyIndexMocks.setHspTime).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({
          current_time: 500,
          server_time: 50_180,
        }),
      }),
    );
  });
});

describe("issueHandySession", () => {
  beforeEach(() => {
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
      const value = timestamps[Math.min(timestampIndex, timestamps.length - 1)] ?? timestamps[timestamps.length - 1]!;
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
