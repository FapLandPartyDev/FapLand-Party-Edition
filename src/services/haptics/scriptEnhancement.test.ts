import { describe, expect, it } from "vitest";
import { DEFAULT_ENHANCEMENT_PATTERNS } from "./enhancementPatterns";
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
  it("expands restricted strokes independently of other patterns", () => {
    const source = [
      { at: 0, pos: 60 },
      { at: 500, pos: 70 },
      { at: 1000, pos: 80 },
      { at: 1500, pos: 80 },
      { at: 2000, pos: 60 },
    ];
    const original = structuredClone(source);
    const options = { enabled: true, wildness: 0, delimited: 100 };
    const result = enhanceScript(source, options);
    expect(result.map((p) => p.pos)).toEqual([0, 50, 100, 100, 0]);
    expect(result.map((p) => p.at)).toEqual(source.map((p) => p.at));
    expect(enhanceScript(source, { ...options, delimited: 50 }).map((p) => p.pos)).toEqual([
      30, 60, 90, 90, 30,
    ]);
    expect(source).toEqual(original);
    expect(enhanceScript(source, { ...options, enabled: false })).toBe(source);
    expect(enhanceScript(source, { ...options, delimited: 0 })).toBe(source);
  });

  it("caps delimited expansion at playback speed without flattening reversals", () => {
    const source = strokes(100).map((p) => ({ ...p, pos: 40 + p.pos * 0.2 }));
    const options = { enabled: true, wildness: 0, delimited: 100 };
    for (const rate of [0.5, 1, 2]) {
      const result = enhanceScript(source, options, rate, 400);
      expectSpeedLimit(result, rate, 400);
      expect(result.map((p) => p.at)).toEqual(source.map((p) => p.at));
      expect(result[1]!.pos - result[0]!.pos).toBeCloseTo(40 / rate);
    }
    const hold = [
      { at: 0, pos: 70 },
      { at: 1000, pos: 70 },
    ];
    expect(enhanceScript(hold, options)).toBe(hold);
    expect(normalizeScriptEnhancement({ ...options, delimited: 200 }).delimited).toBe(100);
    expect(normalizeScriptEnhancement({ ...options, delimited: NaN }).delimited).toBeUndefined();
  });

  it("expands upper-half beats and slower strokes independently in a full-range script", () => {
    const source = [
      { at: 0, pos: 0 },
      { at: 500, pos: 100 },
      { at: 1000, pos: 60 },
      { at: 1500, pos: 80 },
      { at: 1600, pos: 60 },
      { at: 1700, pos: 80 },
      { at: 1950, pos: 80 },
      { at: 2200, pos: 70 },
      { at: 2450, pos: 60 },
      { at: 2950, pos: 100 },
    ];
    const result = enhanceScript(source, { enabled: true, wildness: 0, delimited: 100 }, 1, 400);
    expectSpeedLimit(result, 1, 400);
    expect(result.map((p) => p.at)).toEqual(source.map((p) => p.at));
    expect(result[0]!.pos).toBe(0);
    expect(result[1]!.pos).toBe(100);
    expect(result[3]!.pos - result[2]!.pos).toBeGreaterThan(40);
    expect(result[3]!.pos - result[4]!.pos).toBeCloseTo(40);
    expect(result[5]!.pos - result[4]!.pos).toBeCloseTo(40);
    expect(result[5]!.pos).toBe(result[6]!.pos);
    expect(result[7]!.pos).toBeCloseTo((result[6]!.pos + result[8]!.pos) / 2);
    expect(result[8]!.pos).toBe(0);
    expect(result[9]!.pos).toBe(100);
  });

  it("locks every authored cue and keeps the same reversal count across phrase patterns", () => {
    const source = strokes(400, 65).map((point) => ({ ...point, pos: 20 + point.pos * 0.6 }));
    const options = { ...settings, phraseLength: 8 as const };
    const result = enhanceScript(source, options);
    expect(result).toEqual(enhanceScript(structuredClone(source), options));
    for (const point of source) expect(result.some((p) => p.at === point.at)).toBe(true);
    const reversals = (points: FunscriptAction[]) =>
      points
        .slice(1, -1)
        .filter((p, i) => (p.pos - points[i]!.pos) * (points[i + 2]!.pos - p.pos) < 0).length;
    expect(reversals(result)).toBe(reversals(source));
    expect(result.every((p) => p.pos >= 20 && p.pos <= 80)).toBe(true);
    const at = (time: number) => result.find((p) => p.at === time)!.pos;
    expect(at(400)).toBeLessThan(at(1200));
    expect(at(1200)).toBeLessThan(at(2000));
    expect(at(2800)).toBe(80);
    expect(at(3200)).toBe(20);
    expectSpeedLimit(result, 1, 1600);
  });

  it("adjusts punch without varying depth and variation without changing cue timing", () => {
    const source = strokes(500, 33);
    const punchOnly = enhanceScript(source, {
      ...settings,
      beatPunch: 100,
      variation: 0,
    });
    for (const point of source) expect(punchOnly.find((p) => p.at === point.at)).toEqual(point);
    expect(punchOnly.length).toBeGreaterThan(source.length);
    const varietyOnly = enhanceScript(source, {
      ...settings,
      beatPunch: 0,
      variation: 100,
    });
    expect(varietyOnly.map((p) => p.at)).toEqual(source.map((p) => p.at));
    expect(varietyOnly.map((p) => p.pos)).not.toEqual(source.map((p) => p.pos));
    expect(enhanceScript(source, { ...settings, beatPunch: 0, variation: 0 })).toBe(source);
    expect(enhanceScript(source, { ...settings, phraseLength: 4 })).not.toEqual(
      enhanceScript(source, { ...settings, phraseLength: 16 })
    );
  });

  it("recognizes linearly sampled strokes without treating samples as extra beats", () => {
    const sparse = strokes(500, 17);
    const sampled = sparse.flatMap((point, i) =>
      i === sparse.length - 1
        ? [point]
        : [0, 0.2, 0.4, 0.6, 0.8].map((fraction) => ({
            at: point.at + fraction * 500,
            pos: point.pos + fraction * (sparse[i + 1]!.pos - point.pos),
          }))
    );
    const options = { ...settings };
    const detailed = enhanceScript(sampled, options);
    const simple = enhanceScript(sparse, options);
    for (const point of sparse)
      expect(detailed.find((p) => p.at === point.at)).toEqual(
        simple.find((p) => p.at === point.at)
      );
    expectSpeedLimit(detailed, 1, 1600);
  });

  it("preserves authored range ramps, tempo transitions and nonlinear easing", () => {
    const ramp = strokes(500, 25).map((point, i) => ({ ...point, pos: i % 2 ? 45 + i * 2 : 20 }));
    const ease = strokes(500, 17).flatMap((point, i) =>
      i === 16
        ? [point]
        : [0, 0.2, 0.4, 0.6, 0.8].map((fraction) => ({
            at: point.at + fraction * 500,
            pos: point.pos + fraction ** 2 * (strokes(500, 17)[i + 1]!.pos - point.pos),
          }))
    );
    const tempo = strokes(500, 7).concat(
      strokes(300, 7)
        .slice(1)
        .map((p) => ({ ...p, at: p.at + 3000 }))
    );
    const options = { ...settings };
    expect(enhanceScript(ramp, options)).toEqual(ramp);
    expect(enhanceScript(ease, options)).toEqual(ease);
    expect(enhanceScript(tempo, options)).toEqual(tempo);
  });

  it("resets phrase patterns after pauses and preserves every hold boundary", () => {
    const a = strokes(500, 17);
    const b = a.map((p) => ({ ...p, at: p.at + 11000 }));
    const source = [...a, { at: 10000, pos: 0 }, ...b];
    const options = { ...settings };
    const result = enhanceScript(source, options);
    for (const time of [8000, 10000, 11000])
      expect(result.find((p) => p.at === time)).toEqual({ at: time, pos: 0 });
    const standalone = enhanceScript(b, options);
    // The first cycle borders a hold and remains authored; subsequent stable
    // phrases must not inherit the preceding section's phrase counter.
    expect(result.find((p) => p.at === 11500)?.pos).toBe(100);
    expect(standalone.find((p) => p.at === 11500)?.pos).toBeLessThan(100);
  });

  it("normalizes independent controls and preserves saved intensity", () => {
    expect(
      normalizeScriptEnhancement({ ...settings, beatPunch: 130, variation: -4, phraseLength: 16 })
    ).toEqual({
      ...settings,
      beatPunch: 100,
      variation: 0,
      phraseLength: 16,
    });
    expect(
      normalizeScriptEnhancement({ ...settings, beatPunch: NaN, variation: "20", phraseLength: 9 })
    ).toEqual(settings);
  });

  it("creates sharper beat drops, alternating depths and full-depth accents", () => {
    const source = strokes(500);
    const snapshot = structuredClone(source);
    const options = { ...settings };
    const result = enhanceScript(source, options, 1, 1600);
    expect(result).toEqual(enhanceScript(source, options, 1, 1600));
    expect(source).toEqual(snapshot);
    for (let index = 2; index < source.length; index += 2) {
      const trough = result.find((point) => point.at === source[index]!.at)!;
      const peak = result[result.indexOf(trough) - 1]!;
      expect(trough.at - peak.at).toBeLessThanOrEqual(120);
    }
    expect(result.find((point) => point.at === 8000)?.pos).toBe(0);
    expect(result.find((point) => point.at === 2000)?.pos).toBeGreaterThan(0);
    expectSpeedLimit(result, 1, 1600);
  });

  it.each([0.5, 1, 3])("fits Enhanced to speed budgets at playback rate %s", (rate) => {
    for (const period of [30, 100, 300, 500, 1000]) {
      const source = strokes(period, 81);
      const result = enhanceScript(source, { ...settings }, rate, 175);
      expectSpeedLimit(result, rate, 175);
      if (period <= 100) {
        for (let i = 1; i < result.length - 1; i++) {
          expect(
            (result[i]!.pos - result[i - 1]!.pos) * (result[i + 1]!.pos - result[i]!.pos)
          ).toBeLessThan(0);
        }
      }
    }
  });

  it("preserves authored fast drops, pauses, and easing that fit within the speed limit", () => {
    const authored = [
      { at: 0, pos: 20 },
      { at: 1000, pos: 20 },
      { at: 1400, pos: 30 },
      { at: 1600, pos: 60 },
      { at: 1900, pos: 80 },
      { at: 1960, pos: 20 },
      { at: 3000, pos: 20 },
    ];
    expect(enhanceScript(authored, settings, 1, 1600)).toEqual(authored);
  });

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

  it("adds optional speed-bounded overshoot without moving authored cues", () => {
    const source = strokes(1000, 9).map((point) => ({ ...point, pos: 20 + point.pos * 0.6 }));
    const options = { ...settings, wildness: 0 };
    expect(enhanceScript(source, options, 1, 400)).toBe(source);
    const result = enhanceScript(source, options, 1, 400, {
      ...DEFAULT_ENHANCEMENT_PATTERNS,
      overshoot: true,
    });
    expect(result.filter((point) => point.at % 1000 === 0)).toEqual(source);
    const rebound = result.filter((point) => point.at > 1000 && point.at < 2000);
    expect(rebound.map((point) => point.at)).toEqual([1200, 1380, 1580]);
    expect(rebound[0]!.pos).toBeCloseTo(60.8);
    expect(rebound[1]!.pos).toBeCloseTo(64.4);
    expect(rebound[2]!.pos).toBeCloseTo(43.4);
    expect(result.every((point) => point.pos >= 20 && point.pos <= 80)).toBe(true);
    expectSpeedLimit(result, 1, 400);
  });

  it("adds stair-step holds, two rebounds, and a soft landing on separate stroke legs", () => {
    const source = strokes(500, 9).map((point) => ({ ...point, pos: 30 + point.pos * 0.4 }));
    const patterns = {
      ...DEFAULT_ENHANCEMENT_PATTERNS,
      staircase: true,
      doubleRebound: true,
      softLanding: true,
    };
    const options = { ...settings, wildness: 0 };
    const result = enhanceScript(source, options, 1, 400, patterns);
    const between = (start: number, end: number) =>
      result.filter(({ at }) => at >= start && at <= end);

    expect(result.filter(({ at }) => at % 500 === 0)).toEqual(source);
    const rise = between(0, 500);
    expect(rise.map(({ at }) => at)).toEqual([0, 95, 170, 260, 340, 500]);
    expect(rise[1]!.pos).toBe(rise[2]!.pos);
    expect(rise[3]!.pos).toBe(rise[4]!.pos);

    const doubleRebound = between(500, 1000);
    const rebounds = doubleRebound.slice(1).filter(({ pos }, i) => pos > doubleRebound[i]!.pos);
    expect(rebounds.map(({ at }) => at)).toEqual([670, 825]);

    const landing = between(1500, 2000);
    expect(landing.map(({ at }) => at)).toEqual([1500, 1690, 1850, 2000]);
    const speeds = landing.slice(1).map(({ at, pos }, i) => {
      const before = landing[i]!;
      return (before.pos - pos) / (at - before.at);
    });
    expect(speeds[0]).toBeGreaterThan(speeds[1]!);
    expect(speeds[1]).toBeGreaterThan(speeds[2]!);
    expect(speeds[2]).toBeGreaterThan(0);
    expect(between(2500, 3000)).toEqual(source.slice(5, 7));
    expectSpeedLimit(result, 1, 400);
    expect(enhanceScript(source, options, 1, 100, patterns)).toEqual(source);
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
