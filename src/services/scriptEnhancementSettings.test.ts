import { describe, expect, it, vi } from "vitest";
import { DEFAULT_ENHANCEMENT_PATTERNS } from "./haptics/enhancementPatterns";

const mocks = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn() }));
vi.mock("./trpc", () => ({
  trpc: { store: { get: { query: mocks.get }, set: { mutate: mocks.set } } },
}));
import {
  readScriptEnhancement,
  saveScriptEnhancement,
  readGlobalScriptEnhancementEnabled,
  saveGlobalScriptEnhancementEnabled,
  SCRIPT_ENHANCEMENT_ENABLED_KEY,
  readEnhancementSpeedProfile,
  saveEnhancementSpeedProfile,
  readEnhancementPatterns,
  saveEnhancementPattern,
  SCRIPT_ENHANCEMENT_PATTERNS_KEY,
} from "./scriptEnhancementSettings";

describe("per-script enhancement persistence", () => {
  it("saves delimited intensity and its toggle separately for each script", async () => {
    mocks.set.mockResolvedValue(undefined);
    const a = { enabled: true, wildness: 0, delimited: 35, delimitedEnabled: true };
    const b = { enabled: true, wildness: 0, delimited: 80, delimitedEnabled: false };
    await saveScriptEnhancement("delimited-a", a);
    await saveScriptEnhancement("delimited-b", b);
    expect(await readScriptEnhancement("delimited-a")).toEqual(a);
    expect(await readScriptEnhancement("delimited-b")).toEqual(b);
    await saveScriptEnhancement("delimited-a", { ...a, delimitedEnabled: false });
    expect(await readScriptEnhancement("delimited-a")).toEqual({ ...a, delimitedEnabled: false });
    expect(await readScriptEnhancement("delimited-b")).toEqual(b);
  });

  it("reads a saved legacy script with its original intensity and enable state", async () => {
    mocks.get.mockResolvedValue({ enabled: true, wildness: 70, engine: "legacy" });
    expect(await readScriptEnhancement("engine-choice")).toEqual({ enabled: true, wildness: 70 });
  });

  it("persists concurrent pattern changes without overwriting earlier choices", async () => {
    mocks.get.mockResolvedValue({ variation: false });
    mocks.set.mockResolvedValue(undefined);
    expect(await readEnhancementPatterns()).toEqual({
      ...DEFAULT_ENHANCEMENT_PATTERNS,
      variation: false,
    });
    await Promise.all([
      saveEnhancementPattern("beatPunch", false),
      saveEnhancementPattern("doubleRebound", true),
    ]);
    const value = {
      ...DEFAULT_ENHANCEMENT_PATTERNS,
      beatPunch: false,
      variation: false,
      doubleRebound: true,
    };
    expect(mocks.set).toHaveBeenLastCalledWith({ key: SCRIPT_ENHANCEMENT_PATTERNS_KEY, value });
    expect(await readEnhancementPatterns()).toEqual(value);
  });

  it("loads defaults once, then persists and caches each script independently", async () => {
    mocks.get.mockClear();
    mocks.get.mockResolvedValue(undefined);
    expect(await readScriptEnhancement("one.funscript")).toEqual({ enabled: false, wildness: 50 });
    await readScriptEnhancement("one.funscript");
    expect(mocks.get).toHaveBeenCalledTimes(1);
    mocks.set.mockResolvedValue(undefined);
    await saveScriptEnhancement("one.funscript", { enabled: true, wildness: 77 });
    expect(mocks.set).toHaveBeenCalledWith({
      key: expect.stringContaining("one.funscript"),
      value: { enabled: true, wildness: 77 },
    });
    expect(await readScriptEnhancement("one.funscript")).toEqual({ enabled: true, wildness: 77 });
    expect(await readScriptEnhancement("two.funscript")).toEqual({ enabled: false, wildness: 50 });
  });

  it("retains the working settings if saving fails", async () => {
    mocks.get.mockResolvedValue({ enabled: true, wildness: 65 });
    await readScriptEnhancement("failed-save");
    mocks.set.mockRejectedValue(new Error("Disk unavailable"));
    await expect(
      saveScriptEnhancement("failed-save", { enabled: false, wildness: 10 })
    ).rejects.toThrow("Disk unavailable");
    expect(await readScriptEnhancement("failed-save")).toEqual({ enabled: true, wildness: 65 });
  });

  it("persists the global master switch independently from per-script settings", async () => {
    mocks.get.mockResolvedValue(undefined);
    mocks.set.mockResolvedValue(undefined);
    expect(await readGlobalScriptEnhancementEnabled()).toBe(true);
    await saveGlobalScriptEnhancementEnabled(false);
    expect(mocks.set).toHaveBeenLastCalledWith({
      key: SCRIPT_ENHANCEMENT_ENABLED_KEY,
      value: false,
    });
    expect(await readGlobalScriptEnhancementEnabled()).toBe(false);
    expect(await readScriptEnhancement("one.funscript")).toEqual({ enabled: true, wildness: 77 });
    await saveGlobalScriptEnhancementEnabled(true);
    expect(await readGlobalScriptEnhancementEnabled()).toBe(true);
  });

  it("persists independent controls and keeps device profiles separate", async () => {
    mocks.set.mockResolvedValue(undefined);
    const controls = {
      enabled: true,
      wildness: 50,
      beatPunch: 90,
      variation: 20,
      phraseLength: 16 as const,
    };
    await saveScriptEnhancement("independent", controls);
    expect(await readScriptEnhancement("independent")).toEqual(controls);
    mocks.get.mockResolvedValue(undefined);
    expect(await readEnhancementSpeedProfile("thehandy")).toEqual({
      preset: "automatic",
      customRate: 1600,
    });
    await saveEnhancementSpeedProfile("multifunplayer", { preset: "custom", customRate: 1250 });
    expect(await readEnhancementSpeedProfile("multifunplayer")).toEqual({
      preset: "custom",
      customRate: 1250,
    });
    expect(await readEnhancementSpeedProfile("thehandy")).toEqual({
      preset: "automatic",
      customRate: 1600,
    });
    mocks.set.mockRejectedValueOnce(new Error("disk"));
    await expect(
      saveEnhancementSpeedProfile("multifunplayer", { preset: "balanced", customRate: 1600 })
    ).rejects.toThrow("disk");
    expect(await readEnhancementSpeedProfile("multifunplayer")).toEqual({
      preset: "custom",
      customRate: 1250,
    });
  });
});
