import type { GameState } from "./types";

const FALLBACK_ROUND_PAUSE_MS = 20_000;
const MIN_ROUND_PAUSE_MS = 250;
const MAX_ROUND_PAUSE_MS = 30_000;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function resolveEffectiveRestPauseMs(state: GameState): number {
  const currentPlayer = state.players[state.currentPlayerIndex];
  if (!currentPlayer) return FALLBACK_ROUND_PAUSE_MS;
  const currentField = state.config.board.find((field) => field.id === currentPlayer.currentNodeId);
  const baseRoundPauseMs = Number.isFinite(currentPlayer.stats.roundPauseMs)
    ? currentPlayer.stats.roundPauseMs
    : FALLBACK_ROUND_PAUSE_MS;
  const safeRoundPauseMs = clamp(baseRoundPauseMs, MIN_ROUND_PAUSE_MS, MAX_ROUND_PAUSE_MS);
  const extraPauseMs =
    currentField?.kind === "safePoint"
      ? currentField.checkpointRestMs ?? 0
      : currentField?.kind === "campfire"
        ? currentField.pauseBonusMs ?? 0
        : 0;

  return clamp(
    safeRoundPauseMs + Math.max(0, extraPauseMs),
    MIN_ROUND_PAUSE_MS,
    MAX_ROUND_PAUSE_MS
  );
}
