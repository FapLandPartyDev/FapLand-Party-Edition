import { describe, expect, it } from "vitest";
import { buildDetectedSegments, findDetectionSettingsForTargetCount } from "./detection";

describe("buildDetectedSegments", () => {
  it("splits on pause gaps and preserves order", () => {
    const segments = buildDetectedSegments({
      actions: [
        { at: 0, pos: 50 },
        { at: 3500, pos: 55 },
        { at: 13000, pos: 60 },
        { at: 16000, pos: 62 },
      ],
      durationMs: 20000,
      pauseGapMs: 4000,
      minRoundMs: 2000,
    });

    expect(segments).toEqual([
      { startTimeMs: 0, endTimeMs: 8250, type: "Normal" },
      { startTimeMs: 8250, endTimeMs: 20000, type: "Normal" },
    ]);
  });

  it("ignores gaps below threshold", () => {
    const segments = buildDetectedSegments({
      actions: [
        { at: 0, pos: 50 },
        { at: 1000, pos: 55 },
        { at: 1900, pos: 60 },
      ],
      durationMs: 5000,
      pauseGapMs: 3000,
      minRoundMs: 500,
    });

    expect(segments).toEqual([{ startTimeMs: 0, endTimeMs: 5000, type: "Normal" }]);
  });

  it("drops segments shorter than min duration", () => {
    const segments = buildDetectedSegments({
      actions: [
        { at: 0, pos: 50 },
        { at: 1000, pos: 55 },
        { at: 12000, pos: 60 },
      ],
      durationMs: 20000,
      pauseGapMs: 2000,
      minRoundMs: 7000,
    });

    expect(segments).toEqual([{ startTimeMs: 6500, endTimeMs: 20000, type: "Normal" }]);
  });

  it("supports custom default type", () => {
    const segments = buildDetectedSegments({
      actions: [{ at: 0, pos: 50 }],
      durationMs: 2000,
      pauseGapMs: 300,
      minRoundMs: 100,
      defaultType: "Interjection",
    });

    expect(segments).toEqual([{ startTimeMs: 0, endTimeMs: 2000, type: "Interjection" }]);
  });

  it("ignores an idle gap at the absolute start", () => {
    const segments = buildDetectedSegments({
      actions: [
        { at: 0, pos: 50 },
        { at: 5000, pos: 50 },
        { at: 6200, pos: 80 },
        { at: 7600, pos: 30 },
      ],
      durationMs: 12000,
      pauseGapMs: 3000,
      minRoundMs: 1000,
    });

    expect(segments).toEqual([{ startTimeMs: 0, endTimeMs: 12000, type: "Normal" }]);
  });

  it("ignores an idle gap at the absolute end", () => {
    const segments = buildDetectedSegments({
      actions: [
        { at: 1000, pos: 20 },
        { at: 2600, pos: 80 },
        { at: 11000, pos: 80 },
      ],
      durationMs: 15000,
      pauseGapMs: 3000,
      minRoundMs: 1000,
    });

    expect(segments).toEqual([{ startTimeMs: 0, endTimeMs: 15000, type: "Normal" }]);
  });
});

describe("findDetectionSettingsForTargetCount", () => {
  it("finds exact target count by changing pause and min round settings", () => {
    const result = findDetectionSettingsForTargetCount({
      actions: [
        { at: 0, pos: 20 },
        { at: 1000, pos: 40 },
        { at: 6000, pos: 60 },
        { at: 7000, pos: 80 },
        { at: 12000, pos: 30 },
      ],
      durationMs: 16000,
      targetCount: 3,
      currentPauseGapMs: 900,
      currentMinRoundMs: 1000,
    });

    expect(result.status).toBe("success");
    if (result.status !== "success") return;
    expect(result.segments).toHaveLength(3);
    expect(result.evaluations).toBeGreaterThan(0);
  });

  it("returns failure when exact target count cannot be produced", () => {
    const result = findDetectionSettingsForTargetCount({
      actions: [{ at: 0, pos: 50 }],
      durationMs: 5000,
      targetCount: 3,
      currentPauseGapMs: 900,
      currentMinRoundMs: 1000,
    });

    expect(result.status).toBe("failure");
    expect(result.closest?.segmentCount).toBe(1);
  });

  it("honors the evaluation cap", () => {
    const result = findDetectionSettingsForTargetCount({
      actions: [
        { at: 0, pos: 20 },
        { at: 1000, pos: 40 },
        { at: 6000, pos: 60 },
      ],
      durationMs: 10000,
      targetCount: 4,
      currentPauseGapMs: 900,
      currentMinRoundMs: 1000,
      maxEvaluations: 3,
    });

    expect(result.evaluations).toBeLessThanOrEqual(3);
  });

  it("prefers exact matches with the highest possible pause gap", () => {
    const result = findDetectionSettingsForTargetCount({
      actions: [
        { at: 0, pos: 20 },
        { at: 1000, pos: 40 },
        { at: 6000, pos: 60 },
      ],
      durationMs: 10000,
      targetCount: 2,
      currentPauseGapMs: 5000,
      currentMinRoundMs: 1000,
    });

    expect(result.status).toBe("success");
    if (result.status !== "success") return;
    expect(result.pauseGapMs).toBeGreaterThan(5000);
  });

  it("handles a target count of one", () => {
    const result = findDetectionSettingsForTargetCount({
      actions: [],
      durationMs: 5000,
      targetCount: 1,
      currentPauseGapMs: 900,
      currentMinRoundMs: 1000,
    });

    expect(result.status).toBe("success");
    if (result.status !== "success") return;
    expect(result.segments).toEqual([{ startTimeMs: 0, endTimeMs: 5000, type: "Normal" }]);
  });
});
