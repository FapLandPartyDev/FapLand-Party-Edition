import { describe, expect, it } from "vitest";
import {
  normalizeFunscriptMaxRate,
  normalizeFunscriptRdpEpsilon,
  processFunscriptTrajectory,
} from "./funscriptRateLimiter";

describe("processFunscriptTrajectory", () => {
  it("uses defaults for missing settings and clamps configured values", () => {
    expect(normalizeFunscriptMaxRate(null)).toBe(400);
    expect(normalizeFunscriptRdpEpsilon(undefined)).toBe(1);
    expect(normalizeFunscriptMaxRate(5_000)).toBe(2_000);
    expect(normalizeFunscriptRdpEpsilon(-1)).toBe(0);
  });

  it("leaves an ordinary trajectory unchanged", () => {
    const source = [
      { at: 0, pos: 0 },
      { at: 500, pos: 100 },
    ];
    expect(processFunscriptTrajectory(source, { enabled: true }).actions).toEqual(source);
    expect(source).toEqual([
      { at: 0, pos: 0 },
      { at: 500, pos: 100 },
    ]);
  });

  it("causally clamps overspeed movements and reversals", () => {
    const result = processFunscriptTrajectory(
      [
        { at: 0, pos: 0 },
        { at: 100, pos: 100 },
        { at: 200, pos: 0 },
      ],
      { enabled: true, rdpEpsilon: 0 }
    );
    expect(result.actions).toEqual([
      { at: 0, pos: 0 },
      { at: 100, pos: 40 },
      { at: 200, pos: 0 },
    ]);
    expect(result.clampedActionCount).toBe(1);
  });

  it("accounts for playback rate and stroke span", () => {
    const source = [
      { at: 0, pos: 0 },
      { at: 100, pos: 100 },
    ];
    expect(
      processFunscriptTrajectory(source, { enabled: true, playbackRate: 2, rdpEpsilon: 0 })
        .actions[1]?.pos
    ).toBe(20);
    expect(
      processFunscriptTrajectory(source, {
        enabled: true,
        playbackRate: 1,
        strokeSpanPercent: 50,
        rdpEpsilon: 0,
      }).actions[1]?.pos
    ).toBe(80);
  });

  it("uses configurable rate and simplification parameters", () => {
    const source = [
      { at: 0, pos: 0 },
      { at: 100, pos: 100 },
      { at: 200, pos: 0 },
    ];
    expect(
      processFunscriptTrajectory(source, {
        enabled: true,
        maxRate: 200,
        rdpEpsilon: 0,
      }).actions
    ).toEqual([
      { at: 0, pos: 0 },
      { at: 100, pos: 20 },
      { at: 200, pos: 0 },
    ]);
  });

  it("sanitizes and deterministically keeps the last duplicate timestamp", () => {
    expect(
      processFunscriptTrajectory(
        [
          { at: 100, pos: 120 },
          { at: Number.NaN, pos: 50 },
          { at: -10, pos: -5 },
          { at: 100, pos: 25 },
        ],
        { enabled: false }
      ).actions
    ).toEqual([
      { at: 0, pos: 0 },
      { at: 100, pos: 25 },
    ]);
  });

  it("bypasses limiting and simplification when disabled", () => {
    const source = [
      { at: 0, pos: 0 },
      { at: 10, pos: 50 },
      { at: 20, pos: 100 },
    ];
    expect(processFunscriptTrajectory(source, { enabled: false }).actions).toEqual(source);
  });
});
