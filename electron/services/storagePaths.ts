import { app } from "electron";
import path from "node:path";
import type Store from "electron-store";
import {
  isPortableMode,
  normalizeUserDataSuffix,
  resolvePortableAwareStoragePath,
} from "./portable";

export const WEBSITE_VIDEO_CACHE_RELATIVE_PATH = "web-video-cache";
export const MUSIC_CACHE_RELATIVE_PATH = "music-cache";
export const EROSCRIPTS_CACHE_RELATIVE_PATH = "eroscripts-cache";
export const FPACK_EXTRACTION_RELATIVE_PATH = "fpacks";
export const PLAYABLE_VIDEO_CACHE_RELATIVE_PATH = "video-playback-cache";
export const HARDMODE_FUNSCRIPT_RELATIVE_PATH = "hardmode-funscripts";

export const PORTABLE_STORAGE_DEFAULTS: ReadonlyMap<string, string> = new Map([
  ["webVideo.cacheRootPath", WEBSITE_VIDEO_CACHE_RELATIVE_PATH],
  ["music.cacheRootPath", MUSIC_CACHE_RELATIVE_PATH],
  ["eroscripts.cacheRootPath", EROSCRIPTS_CACHE_RELATIVE_PATH],
  ["fpack.extractionPath", FPACK_EXTRACTION_RELATIVE_PATH],
]);

function getUserDataSuffix(): string | null {
  return normalizeUserDataSuffix(process.env.FLAND_USER_DATA_SUFFIX);
}

export function getPortableStorageDefault(storeKey: string): string | null {
  if (!isPortableMode()) return null;
  return PORTABLE_STORAGE_DEFAULTS.get(storeKey) ?? null;
}

export function initializePortableStorageDefaults(store: Store): void {
  if (!isPortableMode()) return;
  for (const [key, relativePath] of PORTABLE_STORAGE_DEFAULTS) {
    const current = store.get(key);
    if (current === undefined || current === null || current === "") {
      store.set(key, relativePath);
    }
  }
}

export function isPortableRelativeStoragePath(value: unknown): boolean {
  if (!isPortableMode()) return false;
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (trimmed.length === 0) return false;
  return !path.isAbsolute(trimmed);
}

export function formatPortableRelativePath(relativePath: string): string {
  const portable = relativePath.split(path.sep).join(path.posix.sep);
  if (portable.startsWith("./") || portable.startsWith("../")) return portable;
  return `./data/${portable}`;
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
