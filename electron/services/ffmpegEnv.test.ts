// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import { FFMPEG_GPU_PREFERENCE_KEY } from "../../src/constants/debugSettings";
import { applyElectronGpuEnv, resolveStartupGpuIndex } from "./ffmpegEnv";

describe("ffmpegEnv", () => {
  it("resolves startup GPU preference from an injected startup store", () => {
    const store = {
      get: vi.fn((key: string) => (key === FFMPEG_GPU_PREFERENCE_KEY ? "gpu:3" : undefined)),
    };

    expect(resolveStartupGpuIndex(store)).toBe(3);
    expect(store.get).toHaveBeenCalledWith(FFMPEG_GPU_PREFERENCE_KEY);
  });

  it("appends gpu-device-index from startup storage on Windows without reading the main store", () => {
    const appendSwitch = vi.fn();
    const store = {
      get: vi.fn((key: string) => (key === FFMPEG_GPU_PREFERENCE_KEY ? "gpu:2" : undefined)),
    };

    applyElectronGpuEnv(
      { commandLine: { appendSwitch } },
      { env: {}, platform: "win32" },
      store
    );

    expect(appendSwitch).toHaveBeenCalledWith("gpu-device-index", "2");
    expect(store.get).toHaveBeenCalledWith(FFMPEG_GPU_PREFERENCE_KEY);
  });

  it("does not append gpu-device-index for the default startup GPU preference", () => {
    const appendSwitch = vi.fn();

    applyElectronGpuEnv(
      { commandLine: { appendSwitch } },
      { env: {}, platform: "win32" },
      { get: () => "default" }
    );

    expect(appendSwitch).not.toHaveBeenCalled();
  });

  it("sets DRI_PRIME from startup storage on Linux", () => {
    const env: NodeJS.ProcessEnv = {};

    applyElectronGpuEnv(
      { commandLine: { appendSwitch: vi.fn() } },
      { env, platform: "linux" },
      { get: () => "gpu:1" }
    );

    expect(env.DRI_PRIME).toBe("1");
  });

  it("clears DRI_PRIME on Linux when startup GPU preference is default", () => {
    const env: NodeJS.ProcessEnv = { DRI_PRIME: "1" };

    applyElectronGpuEnv(
      { commandLine: { appendSwitch: vi.fn() } },
      { env, platform: "linux" },
      { get: () => "default" }
    );

    expect(env.DRI_PRIME).toBeUndefined();
  });
});
