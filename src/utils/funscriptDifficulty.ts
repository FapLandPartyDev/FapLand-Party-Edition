export type FunscriptDifficultyMetrics = {
  averageVelocity: number;
  pointsPerSecond: number;
  durationSec: number;
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Maps funscript motion metrics to the 1–5 difficulty scale.
 *
 * The inputs are normalized linearly so common scripts retain useful separation
 * across levels 1–3. Levels 4 and 5 require increasingly unusual combinations
 * of velocity and action density instead of being reached early by log curves.
 */
export function estimateFunscriptDifficulty({
  averageVelocity,
  pointsPerSecond,
  durationSec,
}: FunscriptDifficultyMetrics): number | null {
  if (
    !Number.isFinite(averageVelocity) ||
    averageVelocity < 0 ||
    !Number.isFinite(pointsPerSecond) ||
    pointsPerSecond < 0 ||
    !Number.isFinite(durationSec) ||
    durationSec <= 0
  ) {
    return null;
  }

  const velocityNorm = clamp(averageVelocity / 2_000, 0, 1);
  const pointNorm = clamp(pointsPerSecond / 20, 0, 1);
  const lengthNorm = clamp(durationSec / 180, 0, 1);
  const score = 0.55 * velocityNorm + 0.35 * pointNorm + 0.1 * lengthNorm;

  if (score < 0.125) return 1;
  if (score < 0.375) return 2;
  if (score < 0.575) return 3;
  if (score < 0.875) return 4;
  return 5;
}
