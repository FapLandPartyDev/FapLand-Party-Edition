import { describe, expect, it } from "vitest";
import { buildDetectedSegments } from "./detection";

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
});
