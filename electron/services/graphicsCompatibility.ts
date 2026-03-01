import { app } from "electron";
import path from "node:path";
import fs from "node:fs";
import {
  FFMPEG_GPU_PREFERENCE_KEY,
  normalizeFfmpegGpuPreference,
} from "../../src/constants/debugSettings";
import {
  DEFAULT_GRAPHICS_DISABLE_ACCELERATED_VIDEO_DECODE_ENABLED,
  DEFAULT_GRAPHICS_DISABLE_ACCELERATED_VIDEO_ENCODE_ENABLED,
  DEFAULT_GRAPHICS_DISABLE_GPU_BLOCKLIST_OVERRIDE_ENABLED,
  DEFAULT_GRAPHICS_DISABLE_GPU_COMPOSITING_ENABLED,
  DEFAULT_GRAPHICS_DISABLE_GPU_RASTERIZATION_ENABLED,
  DEFAULT_GRAPHICS_DISABLE_GPU_SHADER_DISK_CACHE_ENABLED,
  DEFAULT_GRAPHICS_DISABLE_WEBGL2_ENABLED,
  DEFAULT_GRAPHICS_DISABLE_ZERO_COPY_ENABLED,
  DEFAULT_GRAPHICS_FORCE_ANGLE_OPENGL_ENABLED,
  DEFAULT_GRAPHICS_SAFE_MODE_ENABLED,
  GRAPHICS_DISABLE_ACCELERATED_VIDEO_DECODE_ENABLED_KEY,
  GRAPHICS_DISABLE_ACCELERATED_VIDEO_ENCODE_ENABLED_KEY,
  GRAPHICS_DISABLE_GPU_BLOCKLIST_OVERRIDE_ENABLED_KEY,
  GRAPHICS_DISABLE_GPU_COMPOSITING_ENABLED_KEY,
  GRAPHICS_DISABLE_GPU_RASTERIZATION_ENABLED_KEY,
  GRAPHICS_DISABLE_GPU_SHADER_DISK_CACHE_ENABLED_KEY,
  GRAPHICS_DISABLE_WEBGL2_ENABLED_KEY,
  GRAPHICS_DISABLE_ZERO_COPY_ENABLED_KEY,
  GRAPHICS_FORCE_ANGLE_OPENGL_ENABLED_KEY,
  GRAPHICS_SAFE_MODE_ENABLED_KEY,
  normalizeGraphicsBoolean,
} from "../../src/constants/graphicsSettings";

export type GraphicsCompatibilitySettings = {
  safeModeEnabled: boolean;
  disableZeroCopyEnabled: boolean;
  disableGpuBlocklistOverrideEnabled: boolean;
  disableGpuRasterizationEnabled: boolean;
  disableGpuCompositingEnabled: boolean;
  disableAcceleratedVideoDecodeEnabled: boolean;
  disableGpuShaderDiskCacheEnabled: boolean;
  disableAcceleratedVideoEncodeEnabled: boolean;
  forceAngleOpenGL: boolean;
  disableWebgl2: boolean;
};

export type GraphicsCompatibilityAppliedFlags = GraphicsCompatibilitySettings & {
  appendedSwitches: string[];
  hardwareAccelerationDisabled: boolean;
};

type ElectronAppLike = {
  disableHardwareAcceleration: () => void;
  commandLine: {
    appendSwitch: (switchName: string, value?: string) => void;
  };
};

type StoreLike = {
  get: (key: string) => unknown;
  set?: (key: string, value: unknown) => void;
};

const graphicsCompatibilityKeys = new Set([
  GRAPHICS_SAFE_MODE_ENABLED_KEY,
  GRAPHICS_DISABLE_ZERO_COPY_ENABLED_KEY,
  GRAPHICS_DISABLE_GPU_BLOCKLIST_OVERRIDE_ENABLED_KEY,
  GRAPHICS_DISABLE_GPU_RASTERIZATION_ENABLED_KEY,
  GRAPHICS_DISABLE_GPU_COMPOSITING_ENABLED_KEY,
  GRAPHICS_DISABLE_ACCELERATED_VIDEO_DECODE_ENABLED_KEY,
  GRAPHICS_DISABLE_GPU_SHADER_DISK_CACHE_ENABLED_KEY,
  GRAPHICS_DISABLE_ACCELERATED_VIDEO_ENCODE_ENABLED_KEY,
  GRAPHICS_FORCE_ANGLE_OPENGL_ENABLED_KEY,
  GRAPHICS_DISABLE_WEBGL2_ENABLED_KEY,
]);

export function createStartupGraphicsStore(): StoreLike {
  let userDataPath: string;
  try {
    userDataPath = app.getPath("userData");
  } catch (error) {
    console.warn("Falling back to cwd graphics startup store", error);
    userDataPath = process.cwd();
  }

  const storePath = path.join(userDataPath, "graphics-startup.json");

  let storeData: Record<string, unknown> = {};
  try {
    if (fs.existsSync(storePath)) {
      storeData = JSON.parse(fs.readFileSync(storePath, "utf-8"));
    }
  } catch (error) {
    console.warn("Failed to read graphics-startup.json", error);
  }

  return {
    get: (key: string) => {
      return key.split(".").reduce((acc: any, part) => acc && acc[part], storeData);
    },
    set: (key: string, value: unknown) => {
      const parts = key.split(".");
      let current: any = storeData;
      for (let i = 0; i < parts.length - 1; i++) {
        if (!current[parts[i]] || typeof current[parts[i]] !== "object") {
          current[parts[i]] = {};
        }
        current = current[parts[i]];
      }
      current[parts[parts.length - 1]] = value;

      try {
        fs.writeFileSync(storePath, JSON.stringify(storeData, null, 2), "utf-8");
      } catch (error) {
        console.warn("Failed to write graphics-startup.json", error);
      }
    },
  };
}

export function readGraphicsCompatibilitySettings(
  store: StoreLike = createStartupGraphicsStore()
): GraphicsCompatibilitySettings {
  return {
    safeModeEnabled:
      normalizeGraphicsBoolean(store.get(GRAPHICS_SAFE_MODE_ENABLED_KEY)) ||
      DEFAULT_GRAPHICS_SAFE_MODE_ENABLED,
    disableZeroCopyEnabled:
      normalizeGraphicsBoolean(store.get(GRAPHICS_DISABLE_ZERO_COPY_ENABLED_KEY)) ||
      DEFAULT_GRAPHICS_DISABLE_ZERO_COPY_ENABLED,
    disableGpuBlocklistOverrideEnabled:
      normalizeGraphicsBoolean(store.get(GRAPHICS_DISABLE_GPU_BLOCKLIST_OVERRIDE_ENABLED_KEY)) ||
      DEFAULT_GRAPHICS_DISABLE_GPU_BLOCKLIST_OVERRIDE_ENABLED,
    disableGpuRasterizationEnabled:
      normalizeGraphicsBoolean(store.get(GRAPHICS_DISABLE_GPU_RASTERIZATION_ENABLED_KEY)) ||
      DEFAULT_GRAPHICS_DISABLE_GPU_RASTERIZATION_ENABLED,
    disableGpuCompositingEnabled:
      normalizeGraphicsBoolean(store.get(GRAPHICS_DISABLE_GPU_COMPOSITING_ENABLED_KEY)) ||
      DEFAULT_GRAPHICS_DISABLE_GPU_COMPOSITING_ENABLED,
    disableAcceleratedVideoDecodeEnabled:
      normalizeGraphicsBoolean(
        store.get(GRAPHICS_DISABLE_ACCELERATED_VIDEO_DECODE_ENABLED_KEY)
      ) || DEFAULT_GRAPHICS_DISABLE_ACCELERATED_VIDEO_DECODE_ENABLED,
    disableGpuShaderDiskCacheEnabled:
      normalizeGraphicsBoolean(
        store.get(GRAPHICS_DISABLE_GPU_SHADER_DISK_CACHE_ENABLED_KEY)
      ) || DEFAULT_GRAPHICS_DISABLE_GPU_SHADER_DISK_CACHE_ENABLED,
    disableAcceleratedVideoEncodeEnabled:
      normalizeGraphicsBoolean(
        store.get(GRAPHICS_DISABLE_ACCELERATED_VIDEO_ENCODE_ENABLED_KEY)
      ) || DEFAULT_GRAPHICS_DISABLE_ACCELERATED_VIDEO_ENCODE_ENABLED,
    forceAngleOpenGL:
      normalizeGraphicsBoolean(store.get(GRAPHICS_FORCE_ANGLE_OPENGL_ENABLED_KEY)) ||
      DEFAULT_GRAPHICS_FORCE_ANGLE_OPENGL_ENABLED,
    disableWebgl2:
      normalizeGraphicsBoolean(store.get(GRAPHICS_DISABLE_WEBGL2_ENABLED_KEY)) ||
      DEFAULT_GRAPHICS_DISABLE_WEBGL2_ENABLED,
  };
}

export function persistGraphicsCompatibilityStartupSetting(
  key: string,
  value: unknown,
  store: StoreLike = createStartupGraphicsStore()
): boolean {
  if (!store.set) {
    return false;
  }

  if (graphicsCompatibilityKeys.has(key)) {
    store.set(key, normalizeGraphicsBoolean(value));
    return true;
  }

  if (key === FFMPEG_GPU_PREFERENCE_KEY) {
    store.set(key, normalizeFfmpegGpuPreference(value));
    return true;
  }

  return false;
}

export function applyGraphicsCompatibilityFlags(
  electronApp: ElectronAppLike = app,
  settings: GraphicsCompatibilitySettings = readGraphicsCompatibilitySettings()
): GraphicsCompatibilityAppliedFlags {
  const appendedSwitches: string[] = [];
  const appendSwitch = (switchName: string, value?: string) => {
    electronApp.commandLine.appendSwitch(switchName, value);
    appendedSwitches.push(value ? `${switchName}=${value}` : switchName);
  };

  if (settings.safeModeEnabled) {
    electronApp.disableHardwareAcceleration();
  }

  if (!settings.disableGpuRasterizationEnabled) {
    appendSwitch("enable-gpu-rasterization");
  }

  if (!settings.disableZeroCopyEnabled) {
    appendSwitch("enable-zero-copy");
  }

  if (!settings.disableGpuBlocklistOverrideEnabled) {
    appendSwitch("ignore-gpu-blocklist");
  }

  if (settings.disableGpuCompositingEnabled) {
    appendSwitch("disable-gpu-compositing");
  }

  if (settings.disableAcceleratedVideoDecodeEnabled) {
    appendSwitch("disable-accelerated-video-decode");
  }

  if (settings.disableGpuShaderDiskCacheEnabled) {
    appendSwitch("disable-gpu-shader-disk-cache");
  }

  if (settings.disableAcceleratedVideoEncodeEnabled) {
    appendSwitch("disable-accelerated-video-encode");
  }

  if (settings.forceAngleOpenGL) {
    appendSwitch("use-angle", "gl");
  }

  if (settings.disableWebgl2) {
    appendSwitch("disable-webgl2");
  }

  return {
    ...settings,
    appendedSwitches,
    hardwareAccelerationDisabled: settings.safeModeEnabled,
  };
}
