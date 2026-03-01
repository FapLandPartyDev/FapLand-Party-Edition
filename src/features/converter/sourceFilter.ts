import type { InstalledRound } from "../../services/db";

export const CONVERTER_MINIMUM_VIDEO_LENGTH_KEY = "converter.minimumVideoLengthMinutes";
export const MAXIMUM_VIDEO_LENGTH_FILTER_MINUTES = 120;

export function normalizeMinimumVideoLength(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.min(MAXIMUM_VIDEO_LENGTH_FILTER_MINUTES, Math.max(0, Math.round(parsed)));
}

export function readMinimumVideoLength(): number {
  if (typeof window === "undefined") return 0;
  return normalizeMinimumVideoLength(
    window.localStorage.getItem(CONVERTER_MINIMUM_VIDEO_LENGTH_KEY)
  );
}

export function getRoundVideoDurationMs(round: InstalledRound): number | null {
  const resourceDurationMs = round.resources.find(
    (resource) =>
      !resource.disabled && typeof resource.durationMs === "number" && resource.durationMs > 0
  )?.durationMs;
  if (resourceDurationMs != null) return resourceDurationMs;

  const anyResourceDurationMs = round.resources.find(
    (resource) => typeof resource.durationMs === "number" && resource.durationMs > 0
  )?.durationMs;
  if (anyResourceDurationMs != null) return anyResourceDurationMs;

  if (round.startTime == null || round.endTime == null) return null;
  const roundDurationMs = round.endTime - round.startTime;
  return roundDurationMs > 0 ? roundDurationMs : null;
}

export function meetsMinimumVideoLength(
  durationMs: number | null,
  minimumLengthMinutes: number
): boolean {
  if (durationMs == null || minimumLengthMinutes <= 0) return true;
  return durationMs >= minimumLengthMinutes * 60_000;
}
