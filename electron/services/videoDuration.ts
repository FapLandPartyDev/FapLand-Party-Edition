import { resolvePhashBinaries } from "./phash/binaries";
import { probeVideoDurationMs } from "./phash/probe";
import { toLocalVideoPath } from "./playableVideo";
import { getCachedWebsiteVideoMetadata } from "./webVideo";

const durationByLocalPath = new Map<string, Promise<number | null>>();

function normalizeDurationMs(value: number): number | null {
  if (!Number.isFinite(value) || value <= 0) return null;
  return Math.floor(value);
}

export function __resetVideoDurationCacheForTests(): void {
  durationByLocalPath.clear();
}

export async function resolveVideoDurationMsForLocalPath(
  localPath: string
): Promise<number | null> {
  const existing = durationByLocalPath.get(localPath);
  if (existing) return existing;

  const pending = (async () => {
    try {
      const binaries = await resolvePhashBinaries();
      const durationMs = await probeVideoDurationMs(binaries.ffprobePath, localPath);
      return normalizeDurationMs(durationMs);
    } catch {
      return null;
    }
  })();

  durationByLocalPath.set(localPath, pending);
  return pending;
}

export async function resolveVideoDurationMsForUri(videoUri: string): Promise<number | null> {
  const localPath = toLocalVideoPath(videoUri);
  if (localPath) {
    return resolveVideoDurationMsForLocalPath(localPath);
  }

  const cachedMetadata = await getCachedWebsiteVideoMetadata(videoUri);
  return cachedMetadata?.durationMs ?? null;
}
