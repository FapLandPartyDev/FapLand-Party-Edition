// @vitest-environment node

import { describe, expect, it } from "vitest";
import { fromUriToLocalPath, toDeterministicInstallSourceKey, validateAndNormalizeSegments } from "./converter";

describe("converter helpers", () => {
  it("sorts and validates segments", () => {
    const normalized = validateAndNormalizeSegments([
      { startTimeMs: 3000, endTimeMs: 6000, type: "Normal" },
      { startTimeMs: 0, endTimeMs: 2000, type: "Cum" },
    ]);

    expect(normalized).toEqual([
      { startTimeMs: 0, endTimeMs: 2000, type: "Cum", customName: null, bpm: null, difficulty: null },
      { startTimeMs: 3000, endTimeMs: 6000, type: "Normal", customName: null, bpm: null, difficulty: null },
    ]);
  });

  it("normalizes custom segment names", () => {
    const normalized = validateAndNormalizeSegments([
      { startTimeMs: 0, endTimeMs: 2000, type: "Normal", customName: "  Intro Segment  " },
      { startTimeMs: 3000, endTimeMs: 6000, type: "Cum", customName: "   " },
    ]);

    expect(normalized[0]?.customName).toBe("Intro Segment");
    expect(normalized[1]?.customName).toBeNull();
  });

  it("normalizes and validates bpm and difficulty", () => {
    const normalized = validateAndNormalizeSegments([
      { startTimeMs: 0, endTimeMs: 2000, type: "Normal", bpm: 119.7, difficulty: 4 },
      { startTimeMs: 3000, endTimeMs: 6000, type: "Cum", bpm: null, difficulty: null },
    ]);

    expect(normalized[0]?.bpm).toBe(120);
    expect(normalized[0]?.difficulty).toBe(4);
    expect(normalized[1]?.bpm).toBeNull();
    expect(normalized[1]?.difficulty).toBeNull();
  });

  it("rejects invalid bpm", () => {
    expect(() =>
      validateAndNormalizeSegments([{ startTimeMs: 0, endTimeMs: 2000, type: "Normal", bpm: 0 }]),
    ).toThrow(/bpm/i);
    expect(() =>
      validateAndNormalizeSegments([{ startTimeMs: 0, endTimeMs: 2000, type: "Normal", bpm: 401 }]),
    ).toThrow(/bpm/i);
    expect(() =>
      validateAndNormalizeSegments([{ startTimeMs: 0, endTimeMs: 2000, type: "Normal", bpm: Number.NaN }]),
    ).toThrow(/bpm/i);
  });

  it("rejects invalid difficulty", () => {
    expect(() =>
      validateAndNormalizeSegments([{ startTimeMs: 0, endTimeMs: 2000, type: "Normal", difficulty: 0 }]),
    ).toThrow(/difficulty/i);
    expect(() =>
      validateAndNormalizeSegments([{ startTimeMs: 0, endTimeMs: 2000, type: "Normal", difficulty: 6 }]),
    ).toThrow(/difficulty/i);
    expect(() =>
      validateAndNormalizeSegments([{ startTimeMs: 0, endTimeMs: 2000, type: "Normal", difficulty: 2.5 }]),
    ).toThrow(/difficulty/i);
  });

  it("rejects overlapping segments", () => {
    expect(() =>
      validateAndNormalizeSegments([
        { startTimeMs: 0, endTimeMs: 3000, type: "Normal" },
        { startTimeMs: 2000, endTimeMs: 4000, type: "Interjection" },
      ]),
    ).toThrow(/overlap/i);
  });

  it("builds deterministic install source keys", () => {
    const first = toDeterministicInstallSourceKey({
      heroName: "Test Hero",
      videoUri: "app://media/%2Ftmp%2Fvideo.mp4",
      funscriptUri: "app://media/%2Ftmp%2Fvideo.funscript",
      startTimeMs: 1000,
      endTimeMs: 5000,
    });

    const second = toDeterministicInstallSourceKey({
      heroName: "Test Hero",
      videoUri: "app://media/%2Ftmp%2Fvideo.mp4",
      funscriptUri: "app://media/%2Ftmp%2Fvideo.funscript",
      startTimeMs: 1000,
      endTimeMs: 5000,
    });

    const third = toDeterministicInstallSourceKey({
      heroName: "Test Hero",
      videoUri: "app://media/%2Ftmp%2Fvideo.mp4",
      funscriptUri: "app://media/%2Ftmp%2Fvideo.funscript",
      startTimeMs: 1200,
      endTimeMs: 5000,
    });

    expect(first).toBe(second);
    expect(third).not.toBe(first);
  });

  it("resolves app and file uris to local paths", () => {
    expect(fromUriToLocalPath("app://media/%2Ftmp%2Fvideo.mp4")).toBe("/tmp/video.mp4");
    expect(fromUriToLocalPath("https://cdn.example.com/video.mp4")).toBeNull();
  });
});
