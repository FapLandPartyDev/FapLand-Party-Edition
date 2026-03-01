import { app } from "electron";
import path from "node:path";
import { normalizeUserDataSuffix, resolvePortableAwareStoragePath } from "./portable";

export const WEBSITE_VIDEO_CACHE_RELATIVE_PATH = "web-video-cache";
export const MUSIC_CACHE_RELATIVE_PATH = "music-cache";
export const FPACK_EXTRACTION_RELATIVE_PATH = "fpacks";
export const PLAYABLE_VIDEO_CACHE_RELATIVE_PATH = "video-playback-cache";

function getUserDataSuffix(): string | null {
  return normalizeUserDataSuffix(process.env.FLAND_USER_DATA_SUFFIX);
}

export function resolveDefaultStoragePath(relativePath: string): string {
  return (
    resolvePortableAwareStoragePath(null, relativePath, getUserDataSuffix()) ??
    path.join(app.getPath("userData"), relativePath)
  );
}

export function resolveConfiguredStoragePath(
  configuredPath: unknown,
  relativePath: string
): string {
  const portablePath = resolvePortableAwareStoragePath(
    configuredPath,
    relativePath,
    getUserDataSuffix()
  );
  if (portablePath) return portablePath;

  if (typeof configuredPath === "string" && configuredPath.trim().length > 0) {
    return path.resolve(configuredPath.trim());
  }

  return path.join(app.getPath("userData"), relativePath);
}
