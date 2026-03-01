import { beforeEach, describe, expect, it, vi } from "vitest";
import { thehandyAdapter } from "./thehandyAdapter";

const mocks = vi.hoisted(() => ({
  verifyConnection: vi.fn(async () => ({ success: true, deviceType: "TheHandy v3" })),
  issueHandySession: vi.fn(async () => ({
    mode: "appId" as const,
    clientToken: null,
    expiresAtMs: Date.now() + 60_000,
    serverTimeOffsetMs: 0,
    serverTimeOffsetMeasuredAtMs: 0,
    loadedScriptId: null,
    activeScriptId: null,
    lastSyncAtMs: 0,
    lastPlaybackRate: 1,
    maxBufferPoints: 4000,
    streamedPoints: null,
    nextStreamPointIndex: 0,
    tailPointStreamIndex: 0,
    uploadedUntilMs: 0,
    lastHspAddAtMs: 0,
    hspAddBackoffUntilMs: 0,
    hspModeActive: false,
  })),
  getHandyStroke: vi.fn(async () => ({ min: 0, max: 1, minAbsolute: 0, maxAbsolute: 200 })),
  updateHandyStroke: vi.fn(async (_auth: unknown, stroke: { min: number; max: number }) => ({
    min: stroke.min,
    max: stroke.max,
    minAbsolute: null,
    maxAbsolute: null,
  })),
  stopHandyPlayback: vi.fn(async () => undefined),
  preloadHspScript: vi.fn(async () => undefined),
}));

vi.mock("../handyApi", () => ({
  verifyConnection: mocks.verifyConnection,
}));

vi.mock("../thehandy/runtime", () => ({
  issueHandySession: mocks.issueHandySession,
  getHandyStroke: mocks.getHandyStroke,
  updateHandyStroke: mocks.updateHandyStroke,
  stopHandyPlayback: mocks.stopHandyPlayback,
  pauseHandyPlayback: vi.fn(async () => undefined),
  resumeHandyPlayback: vi.fn(async () => undefined),
  preloadHspScript: mocks.preloadHspScript,
  sendHspSync: vi.fn(async () => undefined),
}));

const config = {
  provider: "thehandy" as const,
  connectionKey: "conn-key",
  appApiKey: "app-key",
  appApiKeyOverride: "app-key",
  localIp: "",
  funscriptRateLimitEnabled: true,
};

describe("thehandyAdapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("delegates connection verification to the current TheHandy verifier", async () => {
    const result = await thehandyAdapter.verifyConnection(config);

    expect(result.success).toBe(true);
    expect(result.provider).toBe("thehandy");
    expect(mocks.verifyConnection).toHaveBeenCalledWith("conn-key", "", "app-key");
  });

  it("delegates stroke get and update", async () => {
    await expect(thehandyAdapter.getStroke!(config)).resolves.toEqual({
      min: 0,
      max: 1,
      minAbsolute: 0,
      maxAbsolute: 200,
    });

    await expect(thehandyAdapter.updateStroke!(config, { min: 0.2, max: 0.8 })).resolves.toEqual({
      min: 0.2,
      max: 0.8,
      minAbsolute: null,
      maxAbsolute: null,
    });
  });

  it("delegates stop to the current TheHandy runtime", async () => {
    const session = await thehandyAdapter.createSession(config);
    await thehandyAdapter.stopPlayback(config, session);

    expect(mocks.issueHandySession).toHaveBeenCalledWith({
      connectionKey: "conn-key",
      appApiKey: "app-key",
    });
    expect(mocks.stopHandyPlayback).toHaveBeenCalledWith(
      { connectionKey: "conn-key", appApiKey: "app-key" },
      session
    );
  });

  it("serializes a late stop before initializing the next script", async () => {
    let finishStop: (() => void) | null = null;
    mocks.stopHandyPlayback.mockImplementationOnce(
      () =>
        new Promise<undefined>((resolve) => {
          finishStop = () => resolve(undefined);
        })
    );
    const oldSession = await thehandyAdapter.createSession(config);
    const nextSession = await thehandyAdapter.createSession(config);

    const stopping = thehandyAdapter.stopPlayback(config, oldSession);
    const preloading = thehandyAdapter.preloadScript(
      config,
      nextSession,
      "next-round",
      [{ at: 0, pos: 50 }],
      0
    );

    await vi.waitFor(() => {
      expect(mocks.stopHandyPlayback).toHaveBeenCalledTimes(1);
    });
    expect(mocks.preloadHspScript).not.toHaveBeenCalled();

    const releaseStop = finishStop as (() => void) | null;
    if (!releaseStop) throw new Error("Stop operation did not start.");
    releaseStop();
    await Promise.all([stopping, preloading]);
    expect(mocks.preloadHspScript).toHaveBeenCalledTimes(1);
  });

  it("preprocesses direct Handy uploads and fingerprints the limiter setting", async () => {
    const session = await thehandyAdapter.createSession(config);
    const actions = [
      { at: 0, pos: 0 },
      { at: 100, pos: 100 },
    ];

    await thehandyAdapter.preloadScript(config, session, "round", actions);
    const enabledCall = mocks.preloadHspScript.mock.lastCall as unknown as
      [unknown, unknown, string, Array<{ at: number; pos: number }>] | undefined;
    expect(enabledCall?.[2]).toContain("rate-limit=true");
    expect(enabledCall?.[3]).toEqual([
      { at: 0, pos: 0 },
      { at: 100, pos: 40 },
    ]);

    await thehandyAdapter.preloadScript(
      { ...config, funscriptMaxRate: 200, funscriptRdpEpsilon: 0 },
      session,
      "round",
      actions
    );
    const configuredCall = mocks.preloadHspScript.mock.lastCall as unknown as
      [unknown, unknown, string, Array<{ at: number; pos: number }>] | undefined;
    expect(configuredCall?.[2]).toContain("max-rate=200");
    expect(configuredCall?.[3]).toEqual([
      { at: 0, pos: 0 },
      { at: 100, pos: 20 },
    ]);

    await thehandyAdapter.preloadScript(
      { ...config, funscriptRateLimitEnabled: false },
      session,
      "round",
      actions
    );
    const disabledCall = mocks.preloadHspScript.mock.lastCall as unknown as
      [unknown, unknown, string, Array<{ at: number; pos: number }>] | undefined;
    expect(disabledCall?.[2]).toContain("rate-limit=false");
    expect(disabledCall?.[3]).toEqual(actions);
  });
});
