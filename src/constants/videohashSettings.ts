export const VIDEOHASH_FFMPEG_SOURCE_PREFERENCE_KEY = "hash.videophash.ffmpegSourcePreference";

export const VIDEOHASH_FFMPEG_SOURCE_PREFERENCE_VALUES = ["auto", "bundled", "system"] as const;

export type VideoHashFfmpegSourcePreference =
  (typeof VIDEOHASH_FFMPEG_SOURCE_PREFERENCE_VALUES)[number];

export const DEFAULT_VIDEOHASH_FFMPEG_SOURCE_PREFERENCE: VideoHashFfmpegSourcePreference = "auto";

export function normalizeVideoHashFfmpegSourcePreference(
  value: unknown,
): VideoHashFfmpegSourcePreference {
  if (typeof value !== "string") return DEFAULT_VIDEOHASH_FFMPEG_SOURCE_PREFERENCE;

  const normalized = value.trim().toLowerCase();
  if (normalized === "bundled") return "bundled";
  if (normalized === "system") return "system";
  return DEFAULT_VIDEOHASH_FFMPEG_SOURCE_PREFERENCE;
}
