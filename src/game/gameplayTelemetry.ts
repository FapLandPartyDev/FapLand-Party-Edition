export type GameplayMode = "single_player" | "multiplayer";
export type GameplaySessionStatus = "in_progress" | "completed" | "abandoned";
export type RoundPlayStatus = "playing" | "completed" | "skipped" | "abandoned";
export type RoundCumOutcome = "manual_loss" | "failed_instruction" | "came_as_told" | "did_not_cum";

export type RoundPlaybackTelemetryEvent = {
  id: string;
  roundId: string;
  roundName: string;
  roundType: "Normal" | "Interjection" | "Cum";
  phaseKind: "normal" | "cum" | "cumPoint" | "interjection";
  nodeId: string | null;
  poolId: string | null;
  startedAtIso: string;
  finishedAtIso?: string | null;
  scheduledDurationMs?: number | null;
  watchedDurationMs: number;
  status: RoundPlayStatus;
  cumOutcome?: RoundCumOutcome | null;
};

export function mergeWatchedMediaDelta(input: {
  previousTimeSec: number | null;
  currentTimeSec: number;
  seeking: boolean;
  maxContinuousDeltaSec?: number;
}): number {
  if (input.seeking || input.previousTimeSec === null) return 0;
  const delta = input.currentTimeSec - input.previousTimeSec;
  const maxDelta = input.maxContinuousDeltaSec ?? 2;
  if (!Number.isFinite(delta) || delta <= 0 || delta > maxDelta) return 0;
  return delta;
}

export function shouldCountGameplayActivity(
  visibilityState: DocumentVisibilityState,
  focused: boolean
): boolean {
  return visibilityState === "visible" && focused;
}
