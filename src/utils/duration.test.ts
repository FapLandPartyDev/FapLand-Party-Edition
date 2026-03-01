import { describe, expect, it } from "vitest";
import { formatDurationLabel, getRoundDurationSec } from "./duration";

describe("getRoundDurationSec", () => {
  it("uses explicit round trim when present", () => {
    expect(
      getRoundDurationSec({
        startTime: 5_000,
        endTime: 35_000,
        resources: [{ durationMs: 999_000 }],
      } as any)
    ).toBe(30);
  });

  it("falls back to resource duration when the round has no explicit end", () => {
    expect(
      getRoundDurationSec({
        startTime: null,
        endTime: null,
        resources: [{ durationMs: 185_000 }],
      } as any)
    ).toBe(185);
  });

  it("subtracts round start from resource duration when only the start is known", () => {
    expect(
      getRoundDurationSec({
        startTime: 15_000,
        endTime: null,
        resources: [{ durationMs: 75_000 }],
      } as any)
    ).toBe(60);
  });

  it("returns unknown when neither round nor resource duration is available", () => {
    expect(
      getRoundDurationSec({
        startTime: null,
        endTime: null,
        resources: [{ durationMs: null }],
      } as any)
    ).toBe(0);
  });
});

describe("formatDurationLabel", () => {
  it("formats zero as 0:00", () => {
    expect(formatDurationLabel(0)).toBe("0:00");
  });

  it("formats sub-minute durations", () => {
    expect(formatDurationLabel(59)).toBe("0:59");
  });

  it("formats minute durations", () => {
    expect(formatDurationLabel(61)).toBe("1:01");
  });

  it("formats hour durations", () => {
    expect(formatDurationLabel(3661)).toBe("1:01:01");
  });

  it("returns unknown for invalid input", () => {
    expect(formatDurationLabel(Number.NaN)).toBe("Unknown duration");
    expect(formatDurationLabel(-1)).toBe("Unknown duration");
  });
});
