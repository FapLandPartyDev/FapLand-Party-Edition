import { describe, expect, it } from "vitest";
import {
  createGeneratedSequenceActions,
  GENERATED_SEQUENCE_LIMITS,
  getGeneratedSequenceTravelSpeedMmPerSec,
} from "./generatedSequenceMotion";

function createSeededRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function getRange(actions: Array<{ pos: number }>): number {
  const positions = actions.map((action) => action.pos);
  return Math.max(...positions) - Math.min(...positions);
}

function hasPattern(
  actions: Array<{ at: number; pos: number }>,
  predicate: (window: number[]) => boolean,
  size: number
): boolean {
  for (let index = 0; index <= actions.length - size; index += 1) {
    const window = actions.slice(index, index + size).map((action) => action.pos);
    if (predicate(window)) return true;
  }
  return false;
}

describe("generated sequence motion", () => {
  it("keeps every generated transition within The Handy travel-speed limit", () => {
    const modes = ["milker", "jackhammer", "no-rest"] as const;

    for (const mode of modes) {
      for (let seed = 1; seed <= 128; seed += 1) {
        const actions = createGeneratedSequenceActions(15_000, mode, createSeededRng(seed));
        for (let index = 1; index < actions.length; index += 1) {
          const speed = getGeneratedSequenceTravelSpeedMmPerSec(
            actions[index - 1]!,
            actions[index]!
          );
          expect(speed).toBeLessThanOrEqual(GENERATED_SEQUENCE_LIMITS.deviceMaxTravelMmPerSec);
        }
      }
    }
  });

  it("gives jackhammer a large, aggressive stroke range", () => {
    const actions = createGeneratedSequenceActions(15_000, "jackhammer", createSeededRng(7));
    const maxStepMs = actions.slice(1).reduce((maxGap, action, index) => {
      const gap = action.at - actions[index]!.at;
      return Math.max(maxGap, gap);
    }, 0);
    const hasLowBuzz = hasPattern(
      actions,
      (window) =>
        window[0]! <= 20 &&
        window[1]! < window[0]! &&
        window[2]! > window[1]! &&
        window[3]! < window[2]!,
      4
    );
    const hasTopFlutter = hasPattern(
      actions,
      (window) => window[0]! >= 70 && window[1]! > window[0]! && window[2] === window[0],
      3
    );

    expect(getRange(actions)).toBeGreaterThanOrEqual(68);
    expect(actions.some((action) => action.pos <= 10)).toBe(true);
    expect(actions.some((action) => action.pos >= 88)).toBe(true);
    expect(maxStepMs).toBeLessThanOrEqual(270);
    expect(hasLowBuzz).toBe(true);
    expect(hasTopFlutter).toBe(true);
  });

  it("gives milker a wide asymmetric pull-release pattern", () => {
    const actions = createGeneratedSequenceActions(15_000, "milker", createSeededRng(11));
    const averageStepMs =
      (actions[actions.length - 1]!.at - actions[0]!.at) / Math.max(1, actions.length - 1);
    const hasTopRegrip = actions.some((action, index) => {
      if (index < 2) return false;
      return (
        actions[index - 2]!.pos >= 82 &&
        actions[index - 1]!.pos <= actions[index - 2]!.pos - 6 &&
        action.pos >= actions[index - 1]!.pos + 4
      );
    });
    const hasDescendingLadder = hasPattern(
      actions,
      (window) =>
        window[0]! > window[1]! &&
        window[2]! > window[1]! &&
        window[3]! < window[2]! &&
        window[3]! < window[0]!,
      4
    );

    expect(getRange(actions)).toBeGreaterThanOrEqual(78);
    expect(actions.some((action) => action.pos <= 14)).toBe(true);
    expect(actions.some((action) => action.pos >= 92)).toBe(true);
    expect(actions.length).toBeGreaterThanOrEqual(105);
    expect(averageStepMs).toBeLessThanOrEqual(145);
    expect(hasTopRegrip).toBe(true);
    expect(hasDescendingLadder).toBe(true);
  });

  it("keeps no-rest gentler than the harsher anti-perks", () => {
    const noRestActions = createGeneratedSequenceActions(10_000, "no-rest", createSeededRng(5));
    const jackhammerActions = createGeneratedSequenceActions(
      10_000,
      "jackhammer",
      createSeededRng(5)
    );

    expect(getRange(noRestActions)).toBeLessThan(getRange(jackhammerActions));
    expect(getRange(noRestActions)).toBeLessThanOrEqual(50);
  });
});
