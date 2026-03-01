import { describe, expect, it } from "vitest";
import { enhanceScript, normalizeScriptEnhancement } from "./scriptEnhancement";
import type { FunscriptAction } from "../../game/media/playback";
import { processFunscriptTrajectory } from "./funscriptRateLimiter";

const settings = { enabled: true, wildness: 100 };
const strokes = (halfPeriod: number, count = 17): FunscriptAction[] =>
  Array.from({ length: count }, (_, index) => ({ at: index * halfPeriod, pos: (index % 2) * 100 }));

function expectSpeedLimit(actions: FunscriptAction[], rate: number, limit: number) {
  for (let index = 1; index < actions.length; index += 1) {
    const previous = actions[index - 1]!;
    const action = actions[index]!;
    expect(action.at).toBeGreaterThan(previous.at);
    expect(
      (Math.abs(action.pos - previous.pos) * 1000 * rate) / (action.at - previous.at)
    ).toBeLessThanOrEqual(limit + 0.000001);
    expect(action.pos).toBeGreaterThanOrEqual(0);
    expect(action.pos).toBeLessThanOrEqual(100);
  }
}

describe("script enhancement", () => {
  it("keeps disabled and zero wildness scripts exactly unchanged", () => {
    const source = strokes(100);
    expect(enhanceScript(source, { ...settings, enabled: false })).toBe(source);
    expect(enhanceScript(source, { ...settings, wildness: 0 })).toBe(source);
  });

  it("is deterministic without mutating the script", () => {
    const source = strokes(500);
    const snapshot = structuredClone(source);
    const result = enhanceScript(source, settings);
    expect(result).toEqual(enhanceScript(structuredClone(source), settings));
    expect(result).not.toEqual(source);
    expect(source).toEqual(snapshot);
  });

  it("makes slow strokes rise slowly and fall quickly while retaining downbeats", () => {
    const source = strokes(500);
    const result = enhanceScript(source, settings);
    for (let index = 1; index < source.length - 1; index += 2) {
      const before = source[index - 1]!;
      const after = source[index + 1]!;
      const cycle = result.filter((point) => point.at > before.at && point.at < after.at);
      const peak = cycle.reduce((highest, point) => (point.pos > highest.pos ? point : highest));
      expect(peak.at - before.at).toBeGreaterThan(after.at - peak.at);
      expect(result.some((point) => point.at === after.at)).toBe(true);
    }
    expectSpeedLimit(result, 1, 400);
  });

  it.each([5, 25, 60, 100])("retains every fast reversal at wildness %s", (wildness) => {
    for (const rate of [0.5, 1, 1.5, 3]) {
      for (const halfPeriod of [10, 30, 50, 100]) {
        const source = strokes(halfPeriod, 81);
        const result = enhanceScript(source, { enabled: true, wildness }, rate, 175);
        expect(result.map((point) => point.at)).toEqual(source.map((point) => point.at));
        for (let index = 1; index < result.length - 1; index += 1) {
          const incoming = result[index]!.pos - result[index - 1]!.pos;
          const outgoing = result[index + 1]!.pos - result[index]!.pos;
          expect(incoming * outgoing).toBeLessThan(0);
          expect(Math.sign(incoming)).toBe(index % 2 === 1 ? 1 : -1);
        }
        expectSpeedLimit(result, rate, 175);
      }
    }
  });

  it("keeps small authored vibration perceptible after device simplification", () => {
    const source = strokes(40, 61).map((point) => ({ ...point, pos: 49.7 + point.pos * 0.006 }));
    const enhanced = enhanceScript(source, settings);
    const processed = processFunscriptTrajectory(enhanced, {
      enabled: true,
      rdpEpsilon: 20,
    }).actions;
    expect(processed).toEqual(enhanced);
    expect(enhanced.map((point) => point.at)).toEqual(source.map((point) => point.at));
    for (let index = 1; index < enhanced.length; index += 1) {
      expect(Math.abs(enhanced[index]!.pos - enhanced[index - 1]!.pos)).toBeGreaterThan(0.45);
    }
  });

  it("preserves tiny vibration inside a script with much larger slow strokes", () => {
    const carrier = strokes(30, 61).map((point) => ({
      at: 3000 + point.at,
      pos: 49.7 + point.pos * 0.006,
    }));
    const source = [{ at: 0, pos: 0 }, { at: 1000, pos: 100 }, ...carrier, { at: 6000, pos: 0 }];
    const result = enhanceScript(source, settings);
    const vibration = result.filter((point) => point.at >= 3000 && point.at <= 4800);
    expect(vibration).toHaveLength(carrier.length);
    for (let index = 1; index < vibration.length - 1; index += 1) {
      const incoming = vibration[index]!.pos - vibration[index - 1]!.pos;
      const outgoing = vibration[index + 1]!.pos - vibration[index]!.pos;
      expect(incoming * outgoing).toBeLessThan(0);
      expect(Math.abs(incoming)).toBeGreaterThan(0.45);
    }
    expectSpeedLimit(result, 1, 400);
  });

  it("keeps reversals through changes in vibration cadence and amplitude", () => {
    let at = 0;
    const source = Array.from({ length: 81 }, (_, index) => {
      at += [30, 60, 100, 50][index % 4]!;
      return { at, pos: index % 2 === 0 ? 25 + (index % 7) : 65 + (index % 9) };
    });
    for (const wildness of [5, 50, 100]) {
      const result = enhanceScript(source, { enabled: true, wildness }, 1, 400);
      expect(result.map((point) => point.at)).toEqual(source.map((point) => point.at));
      for (let index = 1; index < result.length - 1; index += 1) {
        expect(
          (result[index]!.pos - result[index - 1]!.pos) *
            (result[index + 1]!.pos - result[index]!.pos)
        ).toBeLessThan(0);
      }
      expectSpeedLimit(result, 1, 400);
    }
  });

  it("uses stroke cadence rather than sample density and keeps authored easing", () => {
    const source = Array.from({ length: 9 }, (_, stroke) =>
      [0, 0.2, 0.65, 1].map((fraction, sample) => ({
        at: stroke * 80 + sample * 20,
        pos: stroke % 2 === 0 ? fraction * 100 : 100 - fraction * 100,
      }))
    ).flat();
    // Remove duplicated extrema across the short join between strokes.
    const withoutHolds = source.filter(
      (point, index) => index === 0 || point.pos !== source[index - 1]!.pos
    );
    const result = enhanceScript(withoutHolds, settings);
    expect(result.map((point) => point.at)).toEqual(withoutHolds.map((point) => point.at));
    for (let index = 1; index < withoutHolds.length - 1; index += 1) {
      const expected = Math.sign(withoutHolds[index]!.pos - withoutHolds[index - 1]!.pos);
      expect(Math.sign(result[index]!.pos - result[index - 1]!.pos)).toBe(expected);
    }
    expectSpeedLimit(result, 1, 400);
    const slowEase = [
      { at: 0, pos: 0 },
      { at: 100, pos: 5 },
      { at: 200, pos: 20 },
      { at: 300, pos: 45 },
      { at: 400, pos: 75 },
      { at: 500, pos: 100 },
    ];
    expect(enhanceScript(slowEase, settings)).toEqual(slowEase);
  });

  it("enters and exits vibration at authored holds without losing the initial reversals", () => {
    const carrier = strokes(50, 81).map((point) => ({ ...point, at: point.at + 1000 }));
    const source = [{ at: 0, pos: 0 }, ...carrier, { at: 6000, pos: 0 }];
    const result = enhanceScript(source, settings);
    expect(result[0]).toEqual(source[0]);
    expect(result[1]).toEqual(source[1]);
    expect(result.at(-2)).toEqual(source.at(-2));
    expect(result.at(-1)).toEqual(source.at(-1));
    for (let index = 2; index < result.length - 2; index += 1) {
      expect(
        (result[index]!.pos - result[index - 1]!.pos) *
          (result[index + 1]!.pos - result[index]!.pos)
      ).toBeLessThan(0);
    }
    expectSpeedLimit(result, 1, 400);
  });

  it("adds bounded overshoot rebounds, vibration bursts and recurring full peaks to slow strokes", () => {
    const source = strokes(1000, 33).map((point) => ({ ...point, pos: 20 + point.pos * 0.6 }));
    const result = enhanceScript(source, settings);
    const reversalsInDescent = (start: number, end: number) => {
      const points = result.filter((point) => point.at >= start && point.at <= end);
      return points.slice(1).filter((point, index) => point.pos > points[index]!.pos).length;
    };
    expect(result.length).toBeGreaterThan(source.length);
    // First descent rings once; the second has a regular three-pulse texture.
    expect(reversalsInDescent(1100, 2000)).toBe(1);
    expect(reversalsInDescent(3500, 4000)).toBe(3);
    for (const at of [7500, 15500, 23500, 31500]) {
      expect(result.find((point) => point.at === at)?.pos).toBe(80);
    }
    expect(result.every((point) => point.pos >= 20 && point.pos <= 80)).toBe(true);
    expectSpeedLimit(result, 1, 400);
  });

  it("varies the centers of short fast strokes within the available speed", () => {
    const result = enhanceScript(strokes(50, 41), settings);
    const centers = result
      .slice(2, -2)
      .filter((_, index) => index % 2 === 0)
      .map((point, index) => (point.pos + result[index * 2 + 3]!.pos) / 2);
    expect(Math.max(...centers) - Math.min(...centers)).toBeGreaterThan(10);
    expectSpeedLimit(result, 1, 400);
  });

  it.each([0.5, 1, 1.5, 3])("respects speed limits at playback rate %s", (rate) => {
    for (const period of [30, 100, 300, 500, 1000]) {
      expectSpeedLimit(enhanceScript(strokes(period), settings, rate, 175), rate, 175);
    }
  });

  it("preserves holds and never exceeds a script's capped range", () => {
    const source = [
      { at: 0, pos: 20 },
      { at: 1000, pos: 20 },
      { at: 1500, pos: 60 },
      { at: 2000, pos: 20 },
      { at: 3000, pos: 20 },
    ];
    const result = enhanceScript(source, settings);
    expect(result[0]).toEqual(source[0]);
    expect(result[1]).toEqual(source[1]);
    expect(result.at(-1)).toEqual(source.at(-1));
    expect(result.every((action) => action.pos >= 20 && action.pos <= 60)).toBe(true);
  });

  it("handles empty scripts and normalizes stored settings", () => {
    expect(enhanceScript([], settings)).toEqual([]);
    expect(normalizeScriptEnhancement({ enabled: "true", wildness: Infinity })).toEqual({
      enabled: false,
      wildness: 50,
    });
    expect(normalizeScriptEnhancement({ enabled: true, wildness: 200 })).toEqual(settings);
  });
});
