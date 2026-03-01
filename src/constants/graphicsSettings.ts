export const GRAPHICS_SAFE_MODE_ENABLED_KEY = "graphics.safeMode.enabled";
export const GRAPHICS_DISABLE_ZERO_COPY_ENABLED_KEY = "graphics.disableZeroCopy.enabled";
export const GRAPHICS_DISABLE_GPU_BLOCKLIST_OVERRIDE_ENABLED_KEY =
  "graphics.disableGpuBlocklistOverride.enabled";
export const GRAPHICS_DISABLE_GPU_RASTERIZATION_ENABLED_KEY =
  "graphics.disableGpuRasterization.enabled";
export const GRAPHICS_DISABLE_GPU_COMPOSITING_ENABLED_KEY =
  "graphics.disableGpuCompositing.enabled";
export const GRAPHICS_DISABLE_ACCELERATED_VIDEO_DECODE_ENABLED_KEY =
  "graphics.disableAcceleratedVideoDecode.enabled";
export const GRAPHICS_DISABLE_GPU_SHADER_DISK_CACHE_ENABLED_KEY =
  "graphics.disableGpuShaderDiskCache.enabled";
export const GRAPHICS_DISABLE_ACCELERATED_VIDEO_ENCODE_ENABLED_KEY =
  "graphics.disableAcceleratedVideoEncode.enabled";
export const GRAPHICS_FORCE_ANGLE_OPENGL_ENABLED_KEY =
  "graphics.forceAngleOpenGL.enabled";
export const GRAPHICS_DISABLE_WEBGL2_ENABLED_KEY =
  "graphics.disableWebgl2.enabled";
export const GRAPHICS_GPU_CRASH_HINT_PENDING_KEY = "graphics.gpuCrashHint.pending";

export const DEFAULT_GRAPHICS_SAFE_MODE_ENABLED = false;
export const DEFAULT_GRAPHICS_DISABLE_ZERO_COPY_ENABLED = false;
export const DEFAULT_GRAPHICS_DISABLE_GPU_BLOCKLIST_OVERRIDE_ENABLED = false;
export const DEFAULT_GRAPHICS_DISABLE_GPU_RASTERIZATION_ENABLED = false;
export const DEFAULT_GRAPHICS_DISABLE_GPU_COMPOSITING_ENABLED = false;
export const DEFAULT_GRAPHICS_DISABLE_ACCELERATED_VIDEO_DECODE_ENABLED = false;
export const DEFAULT_GRAPHICS_DISABLE_GPU_SHADER_DISK_CACHE_ENABLED = false;
export const DEFAULT_GRAPHICS_DISABLE_ACCELERATED_VIDEO_ENCODE_ENABLED = false;
export const DEFAULT_GRAPHICS_FORCE_ANGLE_OPENGL_ENABLED = false;
export const DEFAULT_GRAPHICS_DISABLE_WEBGL2_ENABLED = false;

export function normalizeGraphicsBoolean(value: unknown): boolean {
  return value === true || value === "true";
}
