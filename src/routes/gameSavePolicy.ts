import type { GameCompletionReason } from "../game/types";

type SavedSessionClock = {
  sessionStartedAtMs: number;
  savedAtMs: number;
};

export const resolveSessionStartedAtMs = (
  savedSession: SavedSessionClock | null,
  nowMs: number = Date.now()
): number => {
  if (!savedSession) return nowMs;

  const elapsedAtSaveMs = Math.max(0, savedSession.savedAtMs - savedSession.sessionStartedAtMs);
  return Math.max(0, nowMs - elapsedAtSaveMs);
};

export const shouldClearSinglePlayerSaveOnCompletion = (
  completionReason: GameCompletionReason | null
): boolean => completionReason === "finished";
