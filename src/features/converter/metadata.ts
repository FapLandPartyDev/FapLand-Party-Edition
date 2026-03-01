import type { FunscriptAction } from "../../game/media/playback";

export type SegmentMetadataDraft = {
  id: string;
  startTimeMs: number;
  endTimeMs: number;
  bpm: number | null;
  difficulty: number | null;
  bpmOverride: boolean;
  difficultyOverride: boolean;
};

export type SegmentAutoMetadata = {
  bpm: number | null;
  difficulty: number | null;
};

function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

function toSignedDelta(value: number): -1 | 0 | 1 {
  if (value > 0) return 1;
  if (value < 0) return -1;
  return 0;
}

export function extractActionsInRange(actions: FunscriptAction[], startTimeMs: number, endTimeMs: number): FunscriptAction[] {
  return actions.filter((action) => action.at >= startTimeMs && action.at <= endTimeMs);
}

export function estimateBpmFromActions(actions: FunscriptAction[], durationSec: number): number | null {
  if (actions.length < 3 || !Number.isFinite(durationSec) || durationSec <= 0) return null;

  let reversals = 0;
  let lastDirection: -1 | 0 | 1 = 0;

  for (let index = 1; index < actions.length; index += 1) {
    const previous = actions[index - 1];
    const current = actions[index];
    if (!previous || !current) continue;

    const direction = toSignedDelta(current.pos - previous.pos);
    if (direction === 0) continue;

    if (lastDirection !== 0 && direction !== lastDirection) {
      reversals += 1;
    }

    lastDirection = direction;
  }

  if (reversals <= 0) return null;

  const strokeCycles = reversals / 2;
  const bpmRaw = (strokeCycles * 60) / durationSec;
  if (!Number.isFinite(bpmRaw) || bpmRaw <= 0) return null;
  return clamp(Math.round(bpmRaw), 1, 400);
}

export function estimateDifficultyFromActions(actions: FunscriptAction[], durationSec: number): number | null {
  if (actions.length < 2 || !Number.isFinite(durationSec) || durationSec <= 0) return null;

  const points = actions.length;
  const pointRate = points / durationSec;

  let velocitySamples = 0;
  let velocitySum = 0;

  for (let index = 1; index < actions.length; index += 1) {
    const previous = actions[index - 1];
    const current = actions[index];
    if (!previous || !current) continue;

    const deltaTimeSec = (current.at - previous.at) / 1000;
    if (!Number.isFinite(deltaTimeSec) || deltaTimeSec <= 0) continue;

    const deltaPos = Math.abs(current.pos - previous.pos);
    const velocity = deltaPos / deltaTimeSec;
    if (!Number.isFinite(velocity)) continue;

    velocitySamples += 1;
    velocitySum += velocity;
  }

  if (velocitySamples <= 0) return null;

  const avgVelocity = velocitySum / velocitySamples;
  const lengthMin = durationSec / 60;

  const pointNorm = clamp(Math.log1p(pointRate) / Math.log1p(8), 0, 1);
  const velocityNorm = clamp(Math.log1p(avgVelocity) / Math.log1p(400), 0, 1);
  const lengthNorm = clamp(lengthMin / 3, 0, 1);

  const score = 0.55 * velocityNorm + 0.35 * pointNorm + 0.1 * lengthNorm;
  return clamp(Math.round(1 + score * 4), 1, 5);
}

export function computeAutoMetadataForSegment(
  actions: FunscriptAction[],
  segment: Pick<SegmentMetadataDraft, "startTimeMs" | "endTimeMs">,
): SegmentAutoMetadata {
  const durationSec = Math.max((segment.endTimeMs - segment.startTimeMs) / 1000, 1);
  const segmentActions = extractActionsInRange(actions, segment.startTimeMs, segment.endTimeMs);

  return {
    bpm: estimateBpmFromActions(segmentActions, durationSec),
    difficulty: estimateDifficultyFromActions(segmentActions, durationSec),
  };
}

export function applyAutoMetadataToSegments(
  segments: SegmentMetadataDraft[],
  actions: FunscriptAction[],
): SegmentMetadataDraft[] {
  return segments.map((segment) => {
    const auto = computeAutoMetadataForSegment(actions, segment);
    return {
      ...segment,
      bpm: segment.bpmOverride ? segment.bpm : auto.bpm,
      difficulty: segment.difficultyOverride ? segment.difficulty : auto.difficulty,
    };
  });
}
