import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const adapter = (provider: "thehandy" | "intiface" | "tcode") => ({
    provider,
    verifyConnection: vi.fn(),
    createSession: vi.fn(),
    preloadScript: vi.fn(async () => undefined),
    sendSync: vi.fn(async () => undefined),
    pausePlayback: vi.fn(async () => undefined),
    resumePlayback: vi.fn(async () => undefined),
    stopPlayback: vi.fn(async () => undefined),
    disconnect: vi.fn(async () => undefined),
  });
  return {
    handy: adapter("thehandy"),
    intiface: adapter("intiface"),
    tcode: adapter("tcode"),
  };
});

vi.mock("./thehandyAdapter", () => ({ thehandyAdapter: mocks.handy }));
vi.mock("./intifaceAdapter", () => ({ intifaceAdapter: mocks.intiface }));
vi.mock("./tcodeAdapter", () => ({ tcodeAdapter: mocks.tcode }));

import {
  createHapticsSession,
  pauseHapticsPlayback,
  resumeHapticsPlayback,
  sendHapticsSync,
  type HapticsGroupConfig,
} from "./runtime";

const handyConfig = {
  provider: "thehandy" as const,
  connectionKey: "handy-key",
  appApiKey: "app-key",
  appApiKeyOverride: "",
  localIp: "",
};

const intifaceConfig = {
  provider: "intiface" as const,
  websocketUrl: "ws://127.0.0.1:12345",
  deviceName: "Vibrator",
  deviceIndex: 2,
  stroke: { min: 0, max: 1, minAbsolute: null, maxAbsolute: null },
  vibrationSensitivity: 1,
};

const group: HapticsGroupConfig = {
  provider: "group",
  devices: [
    { id: "handy", config: handyConfig, offsetMs: 10 },
    { id: "vibrator", config: intifaceConfig, offsetMs: -20 },
  ],
};

describe("multi-device haptics runtime", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.handy.createSession.mockResolvedValue({
      provider: "thehandy",
      expiresAtMs: Date.now() + 60_000,
    });
    mocks.intiface.createSession.mockResolvedValue({
      provider: "intiface",
      expiresAtMs: Date.now() + 60_000,
    });
  });

  it("creates and synchronizes every configured device with its own offset", async () => {
    const session = await createHapticsSession(group);

    await sendHapticsSync(group, session, 1_000, 1, "script", [
      { at: 0, pos: 0 },
      { at: 1_000, pos: 100 },
    ]);

    expect(mocks.handy.createSession).toHaveBeenCalledWith(handyConfig);
    expect(mocks.intiface.createSession).toHaveBeenCalledWith(intifaceConfig);
    expect(mocks.handy.sendSync).toHaveBeenCalledWith(
      handyConfig,
      expect.anything(),
      1_010,
      1,
      "script",
      expect.any(Array)
    );
    expect(mocks.intiface.sendSync).toHaveBeenCalledWith(
      intifaceConfig,
      expect.anything(),
      980,
      1,
      "script",
      expect.any(Array)
    );
  });

  it("pauses and resumes every device at its offset-adjusted playback position", async () => {
    const session = await createHapticsSession(group);

    await pauseHapticsPlayback(group, session);
    await resumeHapticsPlayback(group, session, 1_000, 1.25);

    expect(mocks.handy.pausePlayback).toHaveBeenCalledWith(handyConfig, expect.anything());
    expect(mocks.intiface.pausePlayback).toHaveBeenCalledWith(intifaceConfig, expect.anything());
    expect(mocks.handy.resumePlayback).toHaveBeenCalledWith(
      handyConfig,
      expect.anything(),
      1_010,
      1.25
    );
    expect(mocks.intiface.resumePlayback).toHaveBeenCalledWith(
      intifaceConfig,
      expect.anything(),
      980,
      1.25
    );
  });

  it("keeps healthy devices running when another device rejects a command", async () => {
    const session = await createHapticsSession(group);
    mocks.handy.sendSync.mockRejectedValueOnce(new Error("Handy offline"));

    await expect(
      sendHapticsSync(group, session, 500, 1, "script", [{ at: 0, pos: 50 }])
    ).resolves.toBeUndefined();
    expect(mocks.intiface.sendSync).toHaveBeenCalledTimes(1);
  });

  it("reports an error when every connected device rejects a command", async () => {
    const session = await createHapticsSession(group);
    mocks.handy.sendSync.mockRejectedValueOnce(new Error("Handy offline"));
    mocks.intiface.sendSync.mockRejectedValueOnce(new Error("Intiface offline"));

    await expect(
      sendHapticsSync(group, session, 500, 1, "script", [{ at: 0, pos: 50 }])
    ).rejects.toThrow("Handy offline");
  });
});
