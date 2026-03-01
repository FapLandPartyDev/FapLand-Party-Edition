import { describe, expect, it } from "vitest";
import {
  getEffectiveDurationMs,
  getEffectiveElapsedMs,
  normalizeRoundCutRanges,
  skipCutIfNeeded,
} from "./roundCuts";

describe("round cut helpers", () => {
  it("normalizes and merges adjacent cuts", () => {
    expect(
      normalizeRoundCutRanges(
        [
          { startTimeMs: 4_000, endTimeMs: 5_000 },
          { startTimeMs: 3_000, endTimeMs: 4_000 },
        ],
        1_000,
        10_000
      )
    ).toEqual([{ startTimeMs: 3_000, endTimeMs: 5_000 }]);
  });

  it("computes effective duration and elapsed time", () => {
    const cuts = [
      { startTimeMs: 10_000, endTimeMs: 20_000 },
      { startTimeMs: 40_000, endTimeMs: 45_000 },
    ];

    expect(getEffectiveDurationMs(0, 60_000, cuts)).toBe(45_000);
    expect(getEffectiveElapsedMs(15_000, 0, cuts)).toBe(10_000);
    expect(getEffectiveElapsedMs(50_000, 0, cuts)).toBe(35_000);
  });

  it("maps source time inside a cut to the cut end", () => {
    expect(skipCutIfNeeded(12, [{ startTimeMs: 10_000, endTimeMs: 20_000 }])).toBe(20);
    expect(skipCutIfNeeded(20, [{ startTimeMs: 10_000, endTimeMs: 20_000 }])).toBeNull();
  });
});
