import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ScriptEnhancement } from "./scriptEnhancement";

const mocks = vi.hoisted(() => ({ read: vi.fn(), global: vi.fn() }));
vi.mock("../scriptEnhancementSettings", () => ({
  readScriptEnhancement: mocks.read,
  readGlobalScriptEnhancementEnabled: mocks.global,
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
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.global.mockResolvedValue(true);
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
});
