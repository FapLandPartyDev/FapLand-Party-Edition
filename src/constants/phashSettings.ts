export const BACKGROUND_PHASH_SCANNING_ENABLED_KEY = "game.backgroundPhashScanning.enabled";
export const DEFAULT_BACKGROUND_PHASH_SCANNING_ENABLED = true;
export const BACKGROUND_PHASH_ROUNDS_PER_PASS_KEY = "game.backgroundPhashScanning.roundsPerPass";
export const DEFAULT_BACKGROUND_PHASH_ROUNDS_PER_PASS = 3;
export const MIN_BACKGROUND_PHASH_ROUNDS_PER_PASS = 1;
export const MAX_BACKGROUND_PHASH_ROUNDS_PER_PASS = 20;
export const PREVIEW_FFMPEG_SINGLE_THREAD_ENABLED_KEY = "media.previewFfmpegSingleThread.enabled";
export const DEFAULT_PREVIEW_FFMPEG_SINGLE_THREAD_ENABLED = false;

export function normalizeBackgroundPhashScanningEnabled(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  return DEFAULT_BACKGROUND_PHASH_SCANNING_ENABLED;
}

export function normalizeBackgroundPhashRoundsPerPass(value: unknown): number {
  const parsed =
    typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(parsed)) return DEFAULT_BACKGROUND_PHASH_ROUNDS_PER_PASS;

  const rounded = Math.floor(parsed);
  return Math.max(
    MIN_BACKGROUND_PHASH_ROUNDS_PER_PASS,
    Math.min(MAX_BACKGROUND_PHASH_ROUNDS_PER_PASS, rounded)
  );
}

export function normalizePreviewFfmpegSingleThreadEnabled(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  return DEFAULT_PREVIEW_FFMPEG_SINGLE_THREAD_ENABLED;
}
