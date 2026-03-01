import {
  DEFAULT_THEHANDY_APP_API_KEY,
  THEHANDY_OFFSET_MAX_MS,
  THEHANDY_OFFSET_MIN_MS,
} from "../constants/theHandy";

export type HandyStrokeState = {
  min: number;
  max: number;
  minAbsolute: number | null;
  maxAbsolute: number | null;
};

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

export function clampHandyStrokeRatio(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.min(1, parsed));
}

export function roundHandyStrokeRatio(value: number): number {
  return Math.round(clampHandyStrokeRatio(value) * 10_000) / 10_000;
}

export function normalizeHandyStrokeState(
  value: Partial<HandyStrokeState> | null | undefined
): HandyStrokeState {
  const rawMin = clampHandyStrokeRatio(value?.min);
  const rawMax = clampHandyStrokeRatio(value?.max);
  const min = Math.min(rawMin, rawMax);
  const max = Math.max(rawMin, rawMax);
  const minAbsolute =
    typeof value?.minAbsolute === "number" && Number.isFinite(value.minAbsolute)
      ? value.minAbsolute
      : null;
  const maxAbsolute =
    typeof value?.maxAbsolute === "number" && Number.isFinite(value.maxAbsolute)
      ? value.maxAbsolute
      : null;

  return { min, max, minAbsolute, maxAbsolute };
}

export function getHandyStrokePercent(stroke: Pick<HandyStrokeState, "min" | "max">): number {
  return Math.round((clampHandyStrokeRatio(stroke.max) - clampHandyStrokeRatio(stroke.min)) * 100);
}

export function formatHandyStrokeBoundPercent(value: number): number {
  return Math.round(clampHandyStrokeRatio(value) * 100);
}

export function getHandyStrokeFromPercent(
  stroke: Pick<HandyStrokeState, "min" | "max">,
  percent: unknown
): Pick<HandyStrokeState, "min" | "max"> {
  const targetSpan = Math.max(0, Math.min(100, Number(percent))) / 100;
  if (targetSpan >= 1) {
    return { min: 0, max: 1 };
  }

  const normalized = normalizeHandyStrokeState({ min: stroke.min, max: stroke.max });
  const currentCenter = (normalized.min + normalized.max) / 2;
  let nextMin = currentCenter - targetSpan / 2;
  let nextMax = currentCenter + targetSpan / 2;

  if (nextMin < 0) {
    nextMax = Math.min(1, nextMax - nextMin);
    nextMin = 0;
  }

  if (nextMax > 1) {
    const overflow = nextMax - 1;
    nextMin = Math.max(0, nextMin - overflow);
    nextMax = 1;
  }

  return {
    min: roundHandyStrokeRatio(Math.min(nextMin, nextMax)),
    max: roundHandyStrokeRatio(Math.max(nextMin, nextMax)),
  };
}

export function getHandyStrokeFromBounds(
  minPercent: unknown,
  maxPercent: unknown
): Pick<HandyStrokeState, "min" | "max"> {
  const normalizedMin = clampHandyStrokeRatio(Number(minPercent) / 100);
  const normalizedMax = clampHandyStrokeRatio(Number(maxPercent) / 100);
  return {
    min: roundHandyStrokeRatio(Math.min(normalizedMin, normalizedMax)),
    max: roundHandyStrokeRatio(Math.max(normalizedMin, normalizedMax)),
  };
}
