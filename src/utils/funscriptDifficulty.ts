export type FunscriptDifficultyMetrics = {
  beatHitCount: number;
  durationSec: number;
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Maps a funscript's beat hits and duration to the 1–5 difficulty scale.
 *
 * A full beat is one up/down stroke, represented by two timed funscript actions.
 * Total beat hits are the primary signal, while duration has enough weight to
 * make longer rounds meaningfully harder. Position changes are deliberately
 * ignored: moving farther during a stroke should not increase its difficulty.
 */
export function estimateFunscriptDifficulty({
  beatHitCount,
  durationSec,
}: FunscriptDifficultyMetrics): number | null {
  if (
    !Number.isFinite(beatHitCount) ||
    beatHitCount < 0 ||
    !Number.isFinite(durationSec) ||
    durationSec <= 0
  ) {
    return null;
  }

  const hitNorm = clamp(beatHitCount / 1_000, 0, 1);
  const lengthNorm = clamp(durationSec / 300, 0, 1);
  const score = 0.65 * hitNorm + 0.35 * lengthNorm;

  return clamp(Math.round(1 + score * 4), 1, 5);
}
