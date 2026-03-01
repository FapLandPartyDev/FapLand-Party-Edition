export const YT_DLP_BINARY_PREFERENCE_KEY = "webVideo.ytDlpBinaryPreference";

export const YT_DLP_BINARY_PREFERENCE_VALUES = ["auto", "bundled", "system"] as const;

export type YtDlpBinaryPreference = (typeof YT_DLP_BINARY_PREFERENCE_VALUES)[number];

export const DEFAULT_YT_DLP_BINARY_PREFERENCE: YtDlpBinaryPreference = "auto";

export function normalizeYtDlpBinaryPreference(value: unknown): YtDlpBinaryPreference {
  if (typeof value !== "string") return DEFAULT_YT_DLP_BINARY_PREFERENCE;

  const normalized = value.trim().toLowerCase();
  if (normalized === "bundled") return "bundled";
  if (normalized === "system") return "system";
  return DEFAULT_YT_DLP_BINARY_PREFERENCE;
}
