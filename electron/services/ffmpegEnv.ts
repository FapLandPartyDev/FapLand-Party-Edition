import { app } from "electron";
import {
  FFMPEG_GPU_PREFERENCE_KEY,
  normalizeFfmpegGpuPreference,
  parseFfmpegGpuIndex,
} from "../../src/constants/debugSettings";
import { getStore } from "./store";
import { createStartupGraphicsStore } from "./graphicsCompatibility";

type StoreLike = {
  get: (key: string) => unknown;
};

type ElectronAppLike = {
  commandLine: {
    appendSwitch: (switchName: string, value?: string) => void;
  };
};

type ProcessEnvLike = {
  env: NodeJS.ProcessEnv;
  platform: NodeJS.Platform;
};

function resolveGpuIndexFromStore(store: StoreLike): number | null {
  const preference = normalizeFfmpegGpuPreference(store.get(FFMPEG_GPU_PREFERENCE_KEY));
  return parseFfmpegGpuIndex(preference);
}

export function resolveGpuIndex(): number | null {
  return resolveGpuIndexFromStore(getStore());
}

export function resolveStartupGpuIndex(
  store: StoreLike = createStartupGraphicsStore()
): number | null {
  return resolveGpuIndexFromStore(store);
}

/**
 * Returns environment variables to pass to an FFmpeg child process so it
 * uses the GPU selected by the user's preference setting.
 *
 * On Linux, DRI_PRIME=<index> steers the Mesa/VAAPI stack to the correct GPU.
 * On Windows, CUDA_VISIBLE_DEVICES=<index> restricts the CUDA runtime so
 * NVENC/NVDEC uses the correct GPU.
 */
export function getFfmpegGpuEnv(): Record<string, string> | undefined {
  const index = resolveGpuIndex();
  if (index === null) return undefined;

  if (process.platform === "linux") {
    return { DRI_PRIME: String(index) };
  }

  if (process.platform === "win32") {
    return { CUDA_VISIBLE_DEVICES: String(index) };
  }

  return undefined;
}

/**
 * Steers Electron's Chromium GPU sub-process to the selected GPU.
 * Must be called before app.ready so the GPU process inherits the setting.
 *
 * - Linux: sets DRI_PRIME on the process environment (inherited by the
 *   Chromium GPU subprocess, which is forked before app.ready).
 * - Windows / macOS: appends the --gpu-device-index Chromium command-line
 *   switch, which is the only cross-platform mechanism Chromium exposes for
 *   GPU selection without DRI.
 */
export function applyElectronGpuEnv(
  electronApp: ElectronAppLike = app,
  processLike: ProcessEnvLike = process,
  store: StoreLike = createStartupGraphicsStore()
): void {
  const index = resolveStartupGpuIndex(store);

  if (processLike.platform === "linux") {
    if (index === null) {
      delete processLike.env.DRI_PRIME;
      return;
    }
    processLike.env.DRI_PRIME = String(index);
    return;
  }

  // Windows / macOS: use the Chromium --gpu-device-index switch.
  // Only append when a specific GPU is chosen; omitting the switch lets
  // Chromium pick its default (usually GPU 0).
  if (index !== null) {
    electronApp.commandLine.appendSwitch("gpu-device-index", String(index));
  }
}
