import type { InstalledRound } from "../services/db";

type RoundDurationLike = Pick<InstalledRound, "startTime" | "endTime"> & {
  resources?: Array<{ durationMs?: number | null }> | null;
};

function toFiniteNonNegativeMs(value: number | null | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
  return Math.floor(value);
}

function getResourceDurationMs(round: RoundDurationLike): number | null {
  if (!Array.isArray(round.resources)) return null;
  for (const resource of round.resources) {
    const durationMs = toFiniteNonNegativeMs(resource.durationMs);
    if (durationMs !== null && durationMs > 0) return durationMs;
  }
  return null;
}

export function getRoundDurationSec(round: RoundDurationLike): number {
  const startMs = toFiniteNonNegativeMs(round.startTime) ?? 0;
  const endMs = toFiniteNonNegativeMs(round.endTime);

  if (endMs !== null && endMs > startMs) {
    return Math.max(0, Math.floor((endMs - startMs) / 1000));
  }

  const resourceDurationMs = getResourceDurationMs(round);
  if (resourceDurationMs !== null && resourceDurationMs > startMs) {
    return Math.max(0, Math.floor((resourceDurationMs - startMs) / 1000));
  }

  return 0;
}

export function formatDurationLabel(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return "Unknown duration";
  const total = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}
