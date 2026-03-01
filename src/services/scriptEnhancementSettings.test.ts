import { describe, expect, it, vi } from "vitest";

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
} from "./scriptEnhancementSettings";

describe("per-script enhancement persistence", () => {
  it("loads defaults once, then persists and caches each script independently", async () => {
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
});
