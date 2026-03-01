import type { FunscriptAction } from "../../game/media/playback";

export type GeneratedSequenceMode = "milker" | "jackhammer" | "no-rest";

const DEVICE_MAX_STROKE_MM = 110;
const DEVICE_MAX_TRAVEL_MM_PER_SEC = 400;
const DEVICE_MIN_DIRECTION_CHANGE_MS = 60;

type SequenceState = {
  actions: FunscriptAction[];
  currentTimeMs: number;
  currentPos: number;
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function randomRange(rng: () => number, min: number, max: number): number {
  return min + rng() * (max - min);
}

function getMinTransitionMs(fromPos: number, toPos: number): number {
  const distanceMm = (Math.abs(toPos - fromPos) / 100) * DEVICE_MAX_STROKE_MM;
  const travelLimitedMs = (distanceMm / DEVICE_MAX_TRAVEL_MM_PER_SEC) * 1000;
  return Math.max(DEVICE_MIN_DIRECTION_CHANGE_MS, Math.ceil(travelLimitedMs) + 2);
}

function pushMove(
  state: SequenceState,
  totalDurationMs: number,
  targetPos: number,
  requestedDurationMs: number
): boolean {
  if (state.currentTimeMs >= totalDurationMs) return false;

  const nextPos = clamp(Math.round(targetPos), 0, 100);
  const minDurationMs = getMinTransitionMs(state.currentPos, nextPos);
  const durationMs = Math.max(minDurationMs, Math.floor(requestedDurationMs));
  const remainingMs = totalDurationMs - state.currentTimeMs;

  if (durationMs >= remainingMs) {
    const ratio = durationMs <= 0 ? 1 : remainingMs / durationMs;
    const rawPartialPos = state.currentPos + (nextPos - state.currentPos) * ratio;
    // Round toward the current position so a truncated tail move cannot turn
    // into a tiny last-millisecond jump that exceeds the device travel limit.
    const quantizedPartialPos =
      rawPartialPos >= state.currentPos ? Math.floor(rawPartialPos) : Math.ceil(rawPartialPos);
    const partialPos = clamp(quantizedPartialPos, 0, 100);
    state.currentTimeMs = totalDurationMs;
    state.currentPos = partialPos;
    state.actions.push({ at: totalDurationMs, pos: partialPos });
    return false;
  }

  state.currentTimeMs += durationMs;
  state.currentPos = nextPos;
  state.actions.push({ at: state.currentTimeMs, pos: nextPos });
  return true;
}

function pushMewtwoBuzz(
  state: SequenceState,
  totalDurationMs: number,
  anchorPos: number,
  offsets: number[],
  minStepMs: number,
  maxStepMs: number,
  rng: () => number
): boolean {
  for (const offset of offsets) {
    if (
      !pushMove(state, totalDurationMs, anchorPos + offset, randomRange(rng, minStepMs, maxStepMs))
    ) {
      return false;
    }
  }
  return true;
}

function pushMilkerLadder(
  state: SequenceState,
  totalDurationMs: number,
  topPos: number,
  rng: () => number
): boolean {
  let currentTop = topPos;
  const rungs = 3 + Math.floor(rng() * 3);

  for (let index = 0; index < rungs; index += 1) {
    const release = Math.max(32, currentTop - randomRange(rng, 8, 14));
    const regrip = Math.min(96, release + randomRange(rng, 4, 8));
    if (!pushMove(state, totalDurationMs, currentTop, randomRange(rng, 48, 76))) return false;
    if (!pushMove(state, totalDurationMs, release, randomRange(rng, 38, 62))) return false;
    if (!pushMove(state, totalDurationMs, regrip, randomRange(rng, 32, 54))) return false;
    currentTop = Math.max(44, release - randomRange(rng, 5, 10));
  }

  return true;
}

function pushMilkerVibration(
  state: SequenceState,
  totalDurationMs: number,
  anchorPos: number,
  rng: () => number
): boolean {
  const amplitude = randomRange(rng, 4, 9);
  const offsets = [0, amplitude, -amplitude * 0.65, amplitude * 0.45, -amplitude * 0.35, 0];
  return pushMewtwoBuzz(state, totalDurationMs, anchorPos, offsets, 24, 40, rng);
}

function buildJackhammerSequence(
  state: SequenceState,
  totalDurationMs: number,
  rng: () => number
): void {
  while (state.currentTimeMs < totalDurationMs) {
    const burstCycles = 4 + Math.floor(rng() * 4);
    const low = randomRange(rng, 4, 12);
    const high = randomRange(rng, 84, 94);

    for (let index = 0; index < burstCycles; index += 1) {
      const isAccent = rng() > 0.72;
      const accentLow = isAccent ? Math.max(0, low - randomRange(rng, 2, 6)) : low;
      const accentHigh = isAccent ? Math.min(98, high + randomRange(rng, 2, 4)) : high;

      if (!pushMove(state, totalDurationMs, accentLow, randomRange(rng, 80, 105))) return;
      if (!pushMove(state, totalDurationMs, accentHigh, randomRange(rng, 80, 105))) return;

      if (rng() > 0.58) {
        const buzzAnchor = Math.max(6, Math.min(20, accentLow + randomRange(rng, 1, 6)));
        if (!pushMewtwoBuzz(state, totalDurationMs, buzzAnchor, [0, -4, 2, -6, 0], 30, 44, rng))
          return;
      }

      if (rng() > 0.68) {
        const topAnchor = Math.min(92, Math.max(74, accentHigh - randomRange(rng, 4, 8)));
        if (!pushMewtwoBuzz(state, totalDurationMs, topAnchor, [0, 8, 0], 30, 42, rng)) return;
      }
    }
  }
}

function buildMilkerSequence(
  state: SequenceState,
  totalDurationMs: number,
  rng: () => number
): void {
  while (state.currentTimeMs < totalDurationMs) {
    const preload = randomRange(rng, 20, 34);
    const pullHigh = randomRange(rng, 92, 100);
    const slamLow = randomRange(rng, 4, 14);
    const reboundHigh = randomRange(rng, 84, 94);
    const midReset = randomRange(rng, 28, 42);

    if (!pushMove(state, totalDurationMs, preload, randomRange(rng, 85, 130))) return;
    if (!pushMove(state, totalDurationMs, pullHigh, randomRange(rng, 130, 180))) return;
    if (!pushMove(state, totalDurationMs, slamLow, randomRange(rng, 130, 185))) return;
    if (!pushMove(state, totalDurationMs, reboundHigh, randomRange(rng, 95, 140))) return;

    if (rng() > 0.28) {
      if (!pushMilkerLadder(state, totalDurationMs, reboundHigh, rng)) return;
    }

    if (rng() > 0.52) {
      const vibrationAnchor = Math.max(
        30,
        Math.min(90, state.currentPos - randomRange(rng, 4, 10))
      );
      if (!pushMove(state, totalDurationMs, vibrationAnchor, randomRange(rng, 40, 72))) return;
      if (!pushMilkerVibration(state, totalDurationMs, vibrationAnchor, rng)) return;
    } else {
      const secondaryLow = randomRange(rng, 10, 22);
      const secondaryHigh = randomRange(rng, 78, 90);
      if (!pushMove(state, totalDurationMs, secondaryLow, randomRange(rng, 85, 125))) return;
      if (!pushMove(state, totalDurationMs, secondaryHigh, randomRange(rng, 88, 132))) return;
    }

    if (!pushMove(state, totalDurationMs, midReset, randomRange(rng, 70, 115))) return;
  }
}

function buildNoRestSequence(
  state: SequenceState,
  totalDurationMs: number,
  rng: () => number
): void {
  while (state.currentTimeMs < totalDurationMs) {
    const low = randomRange(rng, 28, 36);
    const high = randomRange(rng, 64, 74);
    const center = randomRange(rng, 44, 56);

    if (!pushMove(state, totalDurationMs, low, randomRange(rng, 180, 260))) return;
    if (!pushMove(state, totalDurationMs, high, randomRange(rng, 180, 260))) return;
    if (!pushMove(state, totalDurationMs, center, randomRange(rng, 120, 180))) return;
  }
}

export function createGeneratedSequenceActions(
  durationMs: number,
  mode: GeneratedSequenceMode,
  rng: () => number = Math.random
): FunscriptAction[] {
  const clampedDurationMs = Math.max(2000, Math.floor(durationMs));
  const state: SequenceState = {
    actions: [{ at: 0, pos: 50 }],
    currentTimeMs: 0,
    currentPos: 50,
  };

  if (mode === "jackhammer") {
    buildJackhammerSequence(state, clampedDurationMs, rng);
  } else if (mode === "milker") {
    buildMilkerSequence(state, clampedDurationMs, rng);
  } else {
    buildNoRestSequence(state, clampedDurationMs, rng);
  }

  if (state.actions[state.actions.length - 1]?.at !== clampedDurationMs) {
    state.actions.push({ at: clampedDurationMs, pos: state.currentPos });
  }

  return state.actions;
}

export function getGeneratedSequenceTravelSpeedMmPerSec(
  from: FunscriptAction,
  to: FunscriptAction
): number {
  const dtSec = (to.at - from.at) / 1000;
  if (dtSec <= 0) return 0;
  const distanceMm = (Math.abs(to.pos - from.pos) / 100) * DEVICE_MAX_STROKE_MM;
  return distanceMm / dtSec;
}

export const GENERATED_SEQUENCE_LIMITS = {
  deviceMaxStrokeMm: DEVICE_MAX_STROKE_MM,
  deviceMaxTravelMmPerSec: DEVICE_MAX_TRAVEL_MM_PER_SEC,
  deviceMinDirectionChangeMs: DEVICE_MIN_DIRECTION_CHANGE_MS,
} as const;
