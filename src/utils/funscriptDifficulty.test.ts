import { describe, expect, it } from "vitest";
import { estimateFunscriptDifficulty } from "./funscriptDifficulty";

describe("estimateFunscriptDifficulty", () => {
  it.each([
    ["easy", { averageVelocity: 250, pointsPerSecond: 0.625, durationSec: 8 }, 1],
    ["typical", { averageVelocity: 700, pointsPerSecond: 6, durationSec: 180 }, 3],
    ["very active", { averageVelocity: 1_200, pointsPerSecond: 10, durationSec: 180 }, 4],
    ["extreme", { averageVelocity: 1_600, pointsPerSecond: 16, durationSec: 180 }, 4],
    ["maximum", { averageVelocity: 2_000, pointsPerSecond: 20, durationSec: 180 }, 5],
  ])("rates %s scripts on a linear scale", (_label, metrics, expected) => {
    expect(estimateFunscriptDifficulty(metrics)).toBe(expected);
  });

  it("rejects invalid metrics", () => {
    expect(
      estimateFunscriptDifficulty({
        averageVelocity: Number.NaN,
        pointsPerSecond: 1,
        durationSec: 60,
      })
    ).toBeNull();
  });
});
