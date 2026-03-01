import { describe, expect, it } from "vitest";
import { estimateFunscriptDifficulty } from "./funscriptDifficulty";

describe("estimateFunscriptDifficulty", () => {
  it.each([
    ["easy", { beatHitCount: 2.5, durationSec: 8 }, 1],
    ["typical", { beatHitCount: 400, durationSec: 180 }, 3],
    ["very active", { beatHitCount: 800, durationSec: 220 }, 4],
    ["maximum", { beatHitCount: 1_000, durationSec: 300 }, 5],
  ])("rates %s scripts by total beat hits and length", (_label, metrics, expected) => {
    expect(estimateFunscriptDifficulty(metrics)).toBe(expected);
  });

  it("rates a longer script as harder when the beat-hit count is equal", () => {
    expect(estimateFunscriptDifficulty({ beatHitCount: 250, durationSec: 60 })).toBe(2);
    expect(estimateFunscriptDifficulty({ beatHitCount: 250, durationSec: 300 })).toBe(3);
  });

  it("rejects invalid metrics", () => {
    expect(
      estimateFunscriptDifficulty({
        beatHitCount: Number.NaN,
        durationSec: 60,
      })
    ).toBeNull();
  });
});
