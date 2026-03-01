import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_ENHANCEMENT_PATTERNS } from "./enhancementPatterns";
import type { ScriptEnhancement } from "./scriptEnhancement";

const mocks = vi.hoisted(() => ({
  read: vi.fn(),
  global: vi.fn(),
  profile: vi.fn(),
  patterns: vi.fn(),
}));
vi.mock("../scriptEnhancementSettings", () => ({
  readScriptEnhancement: mocks.read,
  readEnhancementPatterns: mocks.patterns,
  readGlobalScriptEnhancementEnabled: mocks.global,
  readEnhancementSpeedProfile: mocks.profile,
}));

import { enhancedSourceId, getEnhancedTrajectory } from "./enhancedTrajectory";
import {
  getScriptActionsUri,
  identifyScriptActions,
  inheritScriptIdentity,
} from "./scriptEnhancement";
import type { HapticsConnectionConfig } from "./types";

const config: HapticsConnectionConfig = {
  provider: "thehandy",
  connectionKey: "test",
  appApiKey: "test",
  appApiKeyOverride: "",
  localIp: "",
  funscriptRateLimitEnabled: true,
};
const source = () =>
  Array.from({ length: 17 }, (_, index) => ({ at: index * 500, pos: (index % 2) * 100 }));

describe("enhanced trajectory preparation", () => {
  it("applies delimited alone and invalidates cached output when its strength changes", async () => {
    const actions = source().map((p) => ({ ...p, pos: 40 + p.pos * 0.2 }));
    identifyScriptActions(actions, "delimited");
    let settings: ScriptEnhancement = { enabled: true, wildness: 0, delimited: 50 };
    mocks.read.mockImplementation(async () => settings);
    const first = await getEnhancedTrajectory(config, actions);
    expect(first[0]!.pos).toBe(20);
    expect(first[1]!.pos).toBe(80);
    expect(await getEnhancedTrajectory(config, actions)).toBe(first);
    settings = { ...settings, delimited: 100 };
    const full = await getEnhancedTrajectory(config, actions);
    expect(full[0]!.pos).toBe(0);
    expect(full[1]!.pos).toBe(100);
    settings = { ...settings, delimitedEnabled: false };
    expect(await getEnhancedTrajectory(config, actions)).toBe(actions);
    settings = { ...settings, delimitedEnabled: true };
    expect(await getEnhancedTrajectory(config, actions)).toEqual(full);
    expect(enhancedSourceId("main", actions, full)).not.toBe(
      enhancedSourceId("main", actions, first)
    );
    mocks.global.mockResolvedValue(false);
    expect(await getEnhancedTrajectory(config, actions)).toBe(actions);
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.patterns.mockResolvedValue(DEFAULT_ENHANCEMENT_PATTERNS);
    mocks.global.mockResolvedValue(true);
    mocks.profile.mockResolvedValue({ preset: "automatic", customRate: 1600 });
  });

  it("invalidates cached trajectories for independent controls and device profiles", async () => {
    const actions = source();
    identifyScriptActions(actions, "independent-controls");
    const multi: HapticsConnectionConfig = {
      provider: "multifunplayer",
      stroke: { min: 0, max: 1, minAbsolute: null, maxAbsolute: null },
    };
    let settings: ScriptEnhancement = {
      enabled: true,
      wildness: 0,
      beatPunch: 100,
      variation: 0,
    };
    mocks.read.mockImplementation(async () => settings);
    const first = await getEnhancedTrajectory(multi, actions);
    expect(first).not.toEqual(actions);
    settings = { ...settings, variation: 100 };
    const varied = await getEnhancedTrajectory(multi, actions);
    expect(varied).not.toEqual(first);
    settings = { ...settings, phraseLength: 4 };
    expect(await getEnhancedTrajectory(multi, actions)).not.toBe(varied);
    mocks.profile.mockResolvedValue({ preset: "custom", customRate: 300 });
    const limited = await getEnhancedTrajectory(multi, actions);
    for (let i = 1; i < limited.length; i++) {
      expect(
        (Math.abs(limited[i]!.pos - limited[i - 1]!.pos) * 1000) /
          (limited[i]!.at - limited[i - 1]!.at)
      ).toBeLessThanOrEqual(300.000001);
    }
    mocks.profile.mockRejectedValue(new Error("profile unavailable"));
    expect(await getEnhancedTrajectory(multi, actions)).toBe(actions);
  });

  it("leaves generated sequences alone without reading settings", async () => {
    const actions = source();
    expect(await getEnhancedTrajectory(config, actions)).toBe(actions);
    expect(mocks.read).not.toHaveBeenCalled();
  });

  it("bypasses all enhancement globally and restores saved wildness when re-enabled", async () => {
    const actions = source();
    identifyScriptActions(actions, "globally-controlled");
    mocks.read.mockResolvedValue({ enabled: true, wildness: 85 });
    const enhanced = await getEnhancedTrajectory(config, actions);
    mocks.global.mockResolvedValue(false);
    expect(await getEnhancedTrajectory(config, actions)).toBe(actions);
    expect(enhancedSourceId("main", actions, actions)).toBe("main");
    mocks.global.mockResolvedValue(true);
    expect(await getEnhancedTrajectory(config, actions)).toBe(enhanced);
    expect(mocks.read).toHaveBeenCalledTimes(2);
  });

  it("keeps per-script identity through inversion and intensity caps", () => {
    const actions = source();
    identifyScriptActions(actions, "script-a");
    const capped = inheritScriptIdentity(
      actions,
      actions.map((a) => ({ ...a, pos: a.pos / 2 }))
    );
    const inverted = inheritScriptIdentity(
      capped,
      capped.map((a) => ({ ...a, pos: 100 - a.pos }))
    );
    expect(getScriptActionsUri(inverted)).toBe("script-a");
  });

  it("reuses cached output and reloads when wildness, speed or enabled state changes", async () => {
    const actions = source();
    identifyScriptActions(actions, "script-a");
    let settings: ScriptEnhancement = { enabled: true, wildness: 40 };
    mocks.read.mockImplementation(async () => settings);
    const first = await getEnhancedTrajectory(config, actions);
    expect(mocks.read).toHaveBeenCalledWith("script-a");
    expect(await getEnhancedTrajectory(config, actions)).toBe(first);
    settings = { enabled: true, wildness: 90 };
    const wilder = await getEnhancedTrajectory(config, actions);
    expect(enhancedSourceId("video:main", actions, first)).not.toBe(
      enhancedSourceId("video:main", actions, wilder)
    );
    expect(await getEnhancedTrajectory(config, actions, 2)).not.toEqual(wilder);
    settings = { ...settings, enabled: false };
    expect(await getEnhancedTrajectory(config, actions)).toBe(actions);
    expect(enhancedSourceId("video:main", actions, actions)).toBe("video:main");
  });

  it("isolates settings between scripts", async () => {
    mocks.read.mockImplementation(async (uri: string) => ({ enabled: uri === "a", wildness: 80 }));
    const a = source();
    const b = source();
    identifyScriptActions(a, "a");
    identifyScriptActions(b, "b");
    expect(await getEnhancedTrajectory(config, a)).not.toEqual(a);
    expect(await getEnhancedTrajectory(config, b)).toBe(b);
  });

  it("rebuilds cached motion when global patterns change on The Handy", async () => {
    const actions = source();
    identifyScriptActions(actions, "pattern-selection");
    mocks.read.mockResolvedValue({ enabled: true, wildness: 100 });
    const enhanced = await getEnhancedTrajectory(config, actions);

    mocks.patterns.mockResolvedValue({
      beatPunch: false,
      variation: false,
      delimited: false,
      overshoot: false,
    });
    expect(await getEnhancedTrajectory(config, actions)).toBe(actions);

    mocks.patterns.mockResolvedValue({
      beatPunch: false,
      variation: false,
      delimited: false,
      overshoot: true,
    });
    const overshoot = await getEnhancedTrajectory(config, actions);
    expect(overshoot).not.toEqual(enhanced);
    expect(overshoot.length).toBeGreaterThan(actions.length);
    expect(await getEnhancedTrajectory(config, actions)).toBe(overshoot);

    mocks.patterns.mockResolvedValue({
      ...DEFAULT_ENHANCEMENT_PATTERNS,
      beatPunch: false,
      variation: false,
      delimited: false,
      softLanding: true,
    });
    const landing = await getEnhancedTrajectory(config, actions);
    expect(landing).not.toEqual(overshoot);
    expect(landing.length).toBeGreaterThan(actions.length);
    expect(await getEnhancedTrajectory(config, actions)).toBe(landing);
  });
});
