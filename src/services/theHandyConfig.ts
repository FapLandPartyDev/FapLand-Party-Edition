import {
  DEFAULT_THEHANDY_APP_API_KEY,
  THEHANDY_OFFSET_MAX_MS,
  THEHANDY_OFFSET_MIN_MS,
} from "../constants/theHandy";

export function normalizeHandyAppApiKeyOverride(value: string | null | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

export function resolveHandyAppApiKey(appApiKeyOverride: string | null | undefined): string {
  const normalizedOverride = normalizeHandyAppApiKeyOverride(appApiKeyOverride);
  if (normalizedOverride.length > 0) {
    return normalizedOverride;
  }

  return DEFAULT_THEHANDY_APP_API_KEY.trim();
}

export function normalizeHandyOffsetMs(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(THEHANDY_OFFSET_MIN_MS, Math.min(THEHANDY_OFFSET_MAX_MS, Math.round(parsed)));
}
