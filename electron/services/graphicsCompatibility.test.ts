// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import { FFMPEG_GPU_PREFERENCE_KEY } from "../../src/constants/debugSettings";
import {
  GRAPHICS_DISABLE_ACCELERATED_VIDEO_DECODE_ENABLED_KEY,
  GRAPHICS_DISABLE_ACCELERATED_VIDEO_ENCODE_ENABLED_KEY,
  GRAPHICS_DISABLE_GPU_BLOCKLIST_OVERRIDE_ENABLED_KEY,
  GRAPHICS_DISABLE_GPU_COMPOSITING_ENABLED_KEY,
  GRAPHICS_DISABLE_GPU_RASTERIZATION_ENABLED_KEY,
  GRAPHICS_DISABLE_GPU_SHADER_DISK_CACHE_ENABLED_KEY,
  GRAPHICS_DISABLE_GPU_VSYNC_ENABLED_KEY,
  GRAPHICS_DISABLE_WEBGL2_ENABLED_KEY,
  GRAPHICS_DISABLE_ZERO_COPY_ENABLED_KEY,
  GRAPHICS_FORCE_ANGLE_OPENGL_ENABLED_KEY,
  GRAPHICS_SAFE_MODE_ENABLED_KEY,
} from "../../src/constants/graphicsSettings";
import {
  applyGraphicsCompatibilityFlags,
  persistGraphicsCompatibilityStartupSetting,
  readGraphicsCompatibilitySettings,
} from "./graphicsCompatibility";

const defaultSettings = {
  safeModeEnabled: false,
  disableZeroCopyEnabled: false,
  disableGpuBlocklistOverrideEnabled: false,
  disableGpuRasterizationEnabled: false,
  disableGpuCompositingEnabled: false,
  disableAcceleratedVideoDecodeEnabled: false,
  disableGpuShaderDiskCacheEnabled: false,
  disableAcceleratedVideoEncodeEnabled: false,
  disableGpuVsyncEnabled: false,
  forceAngleOpenGL: false,
  disableWebgl2: false,
};

describe("graphicsCompatibility", () => {
  it("keeps the fast GPU switches by default", () => {
    const appendSwitch = vi.fn();
    const disableHardwareAcceleration = vi.fn();

    const applied = applyGraphicsCompatibilityFlags(
      { commandLine: { appendSwitch }, disableHardwareAcceleration },
      defaultSettings
    );

    expect(disableHardwareAcceleration).not.toHaveBeenCalled();
    expect(applied.appendedSwitches).toEqual([
      "enable-gpu-rasterization",
      "enable-zero-copy",
      "ignore-gpu-blocklist",
    ]);
    expect(appendSwitch).toHaveBeenCalledWith("enable-gpu-rasterization", undefined);
    expect(appendSwitch).toHaveBeenCalledWith("enable-zero-copy", undefined);
    expect(appendSwitch).toHaveBeenCalledWith("ignore-gpu-blocklist", undefined);
  });

  it("omits zero-copy and GPU blocklist override when configured", () => {
    const appendSwitch = vi.fn();

    const applied = applyGraphicsCompatibilityFlags(
      {
        commandLine: { appendSwitch },
        disableHardwareAcceleration: vi.fn(),
      },
      {
        ...defaultSettings,
        disableZeroCopyEnabled: true,
        disableGpuBlocklistOverrideEnabled: true,
      }
    );

    expect(applied.appendedSwitches).toEqual(["enable-gpu-rasterization"]);
    expect(appendSwitch).not.toHaveBeenCalledWith("enable-zero-copy", undefined);
    expect(appendSwitch).not.toHaveBeenCalledWith("ignore-gpu-blocklist", undefined);
  });

  it("disables hardware acceleration before app ready when safe mode is enabled", () => {
    const disableHardwareAcceleration = vi.fn();

    const applied = applyGraphicsCompatibilityFlags(
      {
        commandLine: { appendSwitch: vi.fn() },
        disableHardwareAcceleration,
      },
      {
        ...defaultSettings,
        safeModeEnabled: true,
      }
    );

    expect(disableHardwareAcceleration).toHaveBeenCalledTimes(1);
    expect(applied.hardwareAccelerationDisabled).toBe(true);
  });

  it("omits gpu rasterization switch when disableGpuRasterizationEnabled is true", () => {
    const appendSwitch = vi.fn();

    const applied = applyGraphicsCompatibilityFlags(
      {
        commandLine: { appendSwitch },
        disableHardwareAcceleration: vi.fn(),
      },
      {
        ...defaultSettings,
        disableGpuRasterizationEnabled: true,
      }
    );

    expect(applied.appendedSwitches).not.toContain("enable-gpu-rasterization");
    expect(appendSwitch).not.toHaveBeenCalledWith("enable-gpu-rasterization", undefined);
  });

  it("appends disable-gpu-compositing when disableGpuCompositingEnabled is true", () => {
    const appendSwitch = vi.fn();

    const applied = applyGraphicsCompatibilityFlags(
      {
        commandLine: { appendSwitch },
        disableHardwareAcceleration: vi.fn(),
      },
      {
        ...defaultSettings,
        disableGpuCompositingEnabled: true,
      }
    );

    expect(applied.appendedSwitches).toContain("disable-gpu-compositing");
    expect(appendSwitch).toHaveBeenCalledWith("disable-gpu-compositing", undefined);
  });

  it("appends disable-accelerated-video-decode when disableAcceleratedVideoDecodeEnabled is true", () => {
    const appendSwitch = vi.fn();

    const applied = applyGraphicsCompatibilityFlags(
      {
        commandLine: { appendSwitch },
        disableHardwareAcceleration: vi.fn(),
      },
      {
        ...defaultSettings,
        disableAcceleratedVideoDecodeEnabled: true,
      }
    );

    expect(applied.appendedSwitches).toContain("disable-accelerated-video-decode");
    expect(appendSwitch).toHaveBeenCalledWith("disable-accelerated-video-decode", undefined);
  });

  it("does not append disable switches when all settings are false", () => {
    const appendSwitch = vi.fn();

    const applied = applyGraphicsCompatibilityFlags(
      {
        commandLine: { appendSwitch },
        disableHardwareAcceleration: vi.fn(),
      },
      defaultSettings
    );

    expect(applied.appendedSwitches).not.toContain("disable-gpu-compositing");
    expect(applied.appendedSwitches).not.toContain("disable-accelerated-video-decode");
    expect(applied.appendedSwitches).not.toContain("disable-gpu-shader-disk-cache");
    expect(applied.appendedSwitches).not.toContain("disable-accelerated-video-encode");
    expect(applied.appendedSwitches).not.toContain("disable-gpu-vsync");
    expect(applied.appendedSwitches).not.toContain("use-angle=gl");
    expect(applied.appendedSwitches).not.toContain("disable-webgl2");
    expect(appendSwitch).not.toHaveBeenCalledWith("disable-gpu-compositing", undefined);
    expect(appendSwitch).not.toHaveBeenCalledWith("disable-accelerated-video-decode", undefined);
    expect(appendSwitch).not.toHaveBeenCalledWith("disable-gpu-shader-disk-cache", undefined);
    expect(appendSwitch).not.toHaveBeenCalledWith("disable-accelerated-video-encode", undefined);
    expect(appendSwitch).not.toHaveBeenCalledWith("disable-gpu-vsync", undefined);
    expect(appendSwitch).not.toHaveBeenCalledWith("use-angle", "gl");
    expect(appendSwitch).not.toHaveBeenCalledWith("disable-webgl2", undefined);
  });

  it("reads settings from the store", () => {
    const values = new Map<string, unknown>([
      [GRAPHICS_SAFE_MODE_ENABLED_KEY, true],
      [GRAPHICS_DISABLE_ZERO_COPY_ENABLED_KEY, "true"],
      [GRAPHICS_DISABLE_GPU_BLOCKLIST_OVERRIDE_ENABLED_KEY, false],
      [GRAPHICS_DISABLE_GPU_RASTERIZATION_ENABLED_KEY, "true"],
      [GRAPHICS_DISABLE_GPU_COMPOSITING_ENABLED_KEY, true],
      [GRAPHICS_DISABLE_ACCELERATED_VIDEO_DECODE_ENABLED_KEY, false],
      [GRAPHICS_DISABLE_GPU_SHADER_DISK_CACHE_ENABLED_KEY, true],
      [GRAPHICS_DISABLE_ACCELERATED_VIDEO_ENCODE_ENABLED_KEY, "true"],
      [GRAPHICS_DISABLE_GPU_VSYNC_ENABLED_KEY, true],
      [GRAPHICS_FORCE_ANGLE_OPENGL_ENABLED_KEY, false],
      [GRAPHICS_DISABLE_WEBGL2_ENABLED_KEY, "true"],
    ]);

    expect(readGraphicsCompatibilitySettings({ get: (key) => values.get(key) })).toEqual({
      safeModeEnabled: true,
      disableZeroCopyEnabled: true,
      disableGpuBlocklistOverrideEnabled: false,
      disableGpuRasterizationEnabled: true,
      disableGpuCompositingEnabled: true,
      disableAcceleratedVideoDecodeEnabled: false,
      disableGpuShaderDiskCacheEnabled: true,
      disableAcceleratedVideoEncodeEnabled: true,
      disableGpuVsyncEnabled: true,
      forceAngleOpenGL: false,
      disableWebgl2: true,
    });
  });

  it("mirrors graphics settings and GPU preference into the startup store", () => {
    const set = vi.fn();

    expect(
      persistGraphicsCompatibilityStartupSetting(GRAPHICS_DISABLE_ZERO_COPY_ENABLED_KEY, "true", {
        get: vi.fn(),
        set,
      })
    ).toBe(true);
    expect(set).toHaveBeenCalledWith(GRAPHICS_DISABLE_ZERO_COPY_ENABLED_KEY, true);

    expect(
      persistGraphicsCompatibilityStartupSetting(FFMPEG_GPU_PREFERENCE_KEY, "gpu:2", {
        get: vi.fn(),
        set,
      })
    ).toBe(true);
    expect(set).toHaveBeenCalledWith(FFMPEG_GPU_PREFERENCE_KEY, "gpu:2");

    expect(
      persistGraphicsCompatibilityStartupSetting(FFMPEG_GPU_PREFERENCE_KEY, "invalid", {
        get: vi.fn(),
        set,
      })
    ).toBe(true);
    expect(set).toHaveBeenCalledWith(FFMPEG_GPU_PREFERENCE_KEY, "default");

    expect(
      persistGraphicsCompatibilityStartupSetting("unrelated.setting", true, {
        get: vi.fn(),
        set,
      })
    ).toBe(false);
  });

  it("appends disable-gpu-shader-disk-cache when disableGpuShaderDiskCacheEnabled is true", () => {
    const appendSwitch = vi.fn();

    const applied = applyGraphicsCompatibilityFlags(
      {
        commandLine: { appendSwitch },
        disableHardwareAcceleration: vi.fn(),
      },
      {
        ...defaultSettings,
        disableGpuShaderDiskCacheEnabled: true,
      }
    );

    expect(applied.appendedSwitches).toContain("disable-gpu-shader-disk-cache");
    expect(appendSwitch).toHaveBeenCalledWith("disable-gpu-shader-disk-cache", undefined);
  });

  it("appends disable-accelerated-video-encode when disableAcceleratedVideoEncodeEnabled is true", () => {
    const appendSwitch = vi.fn();

    const applied = applyGraphicsCompatibilityFlags(
      {
        commandLine: { appendSwitch },
        disableHardwareAcceleration: vi.fn(),
      },
      {
        ...defaultSettings,
        disableAcceleratedVideoEncodeEnabled: true,
      }
    );

    expect(applied.appendedSwitches).toContain("disable-accelerated-video-encode");
    expect(appendSwitch).toHaveBeenCalledWith("disable-accelerated-video-encode", undefined);
  });

  it("appends disable-gpu-vsync when disableGpuVsyncEnabled is true", () => {
    const appendSwitch = vi.fn();

    const applied = applyGraphicsCompatibilityFlags(
      {
        commandLine: { appendSwitch },
        disableHardwareAcceleration: vi.fn(),
      },
      {
        ...defaultSettings,
        disableGpuVsyncEnabled: true,
      }
    );

    expect(applied.appendedSwitches).toContain("disable-gpu-vsync");
    expect(appendSwitch).toHaveBeenCalledWith("disable-gpu-vsync", undefined);
  });

  it("appends use-angle=gl when forceAngleOpenGL is true", () => {
    const appendSwitch = vi.fn();

    const applied = applyGraphicsCompatibilityFlags(
      {
        commandLine: { appendSwitch },
        disableHardwareAcceleration: vi.fn(),
      },
      {
        ...defaultSettings,
        forceAngleOpenGL: true,
      }
    );

    expect(applied.appendedSwitches).toContain("use-angle=gl");
    expect(appendSwitch).toHaveBeenCalledWith("use-angle", "gl");
  });

  it("appends disable-webgl2 when disableWebgl2 is true", () => {
    const appendSwitch = vi.fn();

    const applied = applyGraphicsCompatibilityFlags(
      {
        commandLine: { appendSwitch },
        disableHardwareAcceleration: vi.fn(),
      },
      {
        ...defaultSettings,
        disableWebgl2: true,
      }
    );

    expect(applied.appendedSwitches).toContain("disable-webgl2");
    expect(appendSwitch).toHaveBeenCalledWith("disable-webgl2", undefined);
  });

  it("persists all new graphics keys into the startup store", () => {
    const set = vi.fn();
    const store = { get: vi.fn(), set };

    expect(
      persistGraphicsCompatibilityStartupSetting(
        GRAPHICS_DISABLE_GPU_RASTERIZATION_ENABLED_KEY,
        true,
        store
      )
    ).toBe(true);
    expect(
      persistGraphicsCompatibilityStartupSetting(
        GRAPHICS_DISABLE_GPU_COMPOSITING_ENABLED_KEY,
        "true",
        store
      )
    ).toBe(true);
    expect(
      persistGraphicsCompatibilityStartupSetting(
        GRAPHICS_DISABLE_ACCELERATED_VIDEO_DECODE_ENABLED_KEY,
        false,
        store
      )
    ).toBe(true);
    expect(
      persistGraphicsCompatibilityStartupSetting(
        GRAPHICS_DISABLE_GPU_SHADER_DISK_CACHE_ENABLED_KEY,
        true,
        store
      )
    ).toBe(true);
    expect(
      persistGraphicsCompatibilityStartupSetting(
        GRAPHICS_DISABLE_ACCELERATED_VIDEO_ENCODE_ENABLED_KEY,
        "true",
        store
      )
    ).toBe(true);
    expect(
      persistGraphicsCompatibilityStartupSetting(
        GRAPHICS_DISABLE_GPU_VSYNC_ENABLED_KEY,
        true,
        store
      )
    ).toBe(true);
    expect(
      persistGraphicsCompatibilityStartupSetting(
        GRAPHICS_FORCE_ANGLE_OPENGL_ENABLED_KEY,
        false,
        store
      )
    ).toBe(true);
    expect(
      persistGraphicsCompatibilityStartupSetting(
        GRAPHICS_DISABLE_WEBGL2_ENABLED_KEY,
        "true",
        store
      )
    ).toBe(true);

    expect(set).toHaveBeenCalledTimes(8);
  });
});
