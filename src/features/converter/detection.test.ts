import { describe, expect, it } from "vitest";
import {
  buildDetectedSegments,
  findAdaptiveDetectionSettings,
  findDetectionSettingsForTargetCount,
} from "./detection";

describe("buildDetectedSegments", () => {
  it("splits on pause gaps and trims the final segment to action cadence", () => {
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
      { startTimeMs: 8250, endTimeMs: 19000, type: "Normal" },
    ]);
  });

  it("ignores gaps below threshold and ends near the last action cadence", () => {
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

    expect(segments).toEqual([{ startTimeMs: 0, endTimeMs: 4275, type: "Normal" }]);
  });

  it("drops segments shorter than min duration after cadence trimming", () => {
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

    expect(segments).toEqual([{ startTimeMs: 6500, endTimeMs: 14500, type: "Normal" }]);
  });

  it("supports custom default type", () => {
    const segments = buildDetectedSegments({
      actions: [{ at: 0, pos: 50 }],
      durationMs: 2000,
      pauseGapMs: 300,
      minRoundMs: 100,
      defaultType: "Interjection",
    });

    expect(segments).toEqual([{ startTimeMs: 0, endTimeMs: 1500, type: "Interjection" }]);
  });

  it("starts near the first real action when a synthetic anchor creates leading idle", () => {
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

    expect(segments).toEqual([{ startTimeMs: 2000, endTimeMs: 10600, type: "Normal" }]);
  });

  it("ends near the last real action when trailing idle keeps the same position", () => {
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

    expect(segments).toEqual([{ startTimeMs: 0, endTimeMs: 5600, type: "Normal" }]);
  });

  it("starts the first round near delayed real action with adaptive cadence", () => {
    const segments = buildDetectedSegments({
      actions: [
        { at: 7000, pos: 20 },
        { at: 7400, pos: 80 },
        { at: 7800, pos: 25 },
      ],
      durationMs: 20_000,
      pauseGapMs: 3_000,
      minRoundMs: 500,
    });

    expect(segments).toEqual([{ startTimeMs: 6000, endTimeMs: 8800, type: "Normal" }]);
  });

  it("preserves interior pause midpoints while trimming outer idle time", () => {
    const segments = buildDetectedSegments({
      actions: [
        { at: 5000, pos: 20 },
        { at: 5500, pos: 80 },
        { at: 9500, pos: 40 },
        { at: 10000, pos: 90 },
      ],
      durationMs: 20_000,
      pauseGapMs: 3_000,
      minRoundMs: 500,
    });

    expect(segments).toEqual([
      { startTimeMs: 3750, endTimeMs: 7500, type: "Normal" },
      { startTimeMs: 7500, endTimeMs: 11250, type: "Normal" },
    ]);
  });
});

describe("findAdaptiveDetectionSettings", () => {
  it("finds stable long rounds separated by a meaningful pause", () => {
    const actions = [
      ...Array.from({ length: 170 }, (_, index) => ({
        at: index * 1_000,
        pos: index % 2 ? 80 : 20,
      })),
      ...Array.from({ length: 170 }, (_, index) => ({
        at: 175_000 + index * 1_000,
        pos: index % 2 ? 80 : 20,
      })),
    ];

    const result = findAdaptiveDetectionSettings({
      actions,
      durationMs: 350_000,
      currentPauseGapMs: 900,
      currentMinRoundMs: 180_000,
    });

    expect(result.segments).toHaveLength(2);
    expect(result.pauseGapMs).toBeGreaterThanOrEqual(1_000);
    expect(result.evaluations).toBeGreaterThan(0);
  });

  it("returns no split for empty action data", () => {
    const result = findAdaptiveDetectionSettings({
      actions: [],
      durationMs: 350_000,
      currentPauseGapMs: 900,
      currentMinRoundMs: 180_000,
    });

    expect(result.segments).toEqual([]);
    expect(result.evaluations).toBe(0);
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
    if (result.status !== "failure") return;
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
    expect(result.pauseGapMs).toBe(5000);
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

  it("uses real non-grid pause gaps to find an exact target count", () => {
    const result = findDetectionSettingsForTargetCount({
      actions: [
        { at: 1000, pos: 20 },
        { at: 1400, pos: 70 },
        { at: 3737, pos: 30 },
        { at: 4137, pos: 80 },
      ],
      durationMs: 8000,
      targetCount: 2,
      currentPauseGapMs: 2500,
      currentMinRoundMs: 500,
      pauseGapRangeMs: { min: 100, max: 3000 },
      minRoundRangeMs: { min: 500, max: 4000 },
    });

    expect(result.status).toBe("success");
    if (result.status !== "success") return;
    expect(result.pauseGapMs).toBe(2337);
    expect(result.segments).toEqual([
      { startTimeMs: 0, endTimeMs: 2568, type: "Normal" },
      { startTimeMs: 2568, endTimeMs: 5137, type: "Normal" },
    ]);
  });
});
