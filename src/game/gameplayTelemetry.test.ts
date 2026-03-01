import { describe, expect, it } from "vitest";
import { mergeWatchedMediaDelta, shouldCountGameplayActivity } from "./gameplayTelemetry";

describe("mergeWatchedMediaDelta", () => {
  it("counts continuous forward media time", () => {
    expect(
      mergeWatchedMediaDelta({ previousTimeSec: 10, currentTimeSec: 10.4, seeking: false })
    ).toBeCloseTo(0.4);
  });

  it("ignores seeks, backwards movement, and discontinuities", () => {
    expect(mergeWatchedMediaDelta({ previousTimeSec: 10, currentTimeSec: 30, seeking: true })).toBe(
      0
    );
    expect(mergeWatchedMediaDelta({ previousTimeSec: 10, currentTimeSec: 9, seeking: false })).toBe(
      0
    );
    expect(
      mergeWatchedMediaDelta({ previousTimeSec: 10, currentTimeSec: 30, seeking: false })
    ).toBe(0);
  });
});

describe("shouldCountGameplayActivity", () => {
  it("counts only visible, focused gameplay", () => {
    expect(shouldCountGameplayActivity("visible", true)).toBe(true);
    expect(shouldCountGameplayActivity("visible", false)).toBe(false);
    expect(shouldCountGameplayActivity("hidden", true)).toBe(false);
  });
});
