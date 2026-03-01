import type { FunscriptAction } from "../../game/media/playback";
import { hasStrokeShapes, type EnhancementPatterns } from "./enhancementPatterns";
import { fitRapidScript } from "./fitRapidScript";
import type { ScriptEnhancement } from "./scriptEnhancement";
import { normalizeFunscriptMaxRate, processFunscriptTrajectory } from "./funscriptRateLimiter";

type Cycle = { first: number; peak: number; last: number; period: number; depth: number };
type StrokeShape = ReadonlyArray<readonly [timeFraction: number, travelFraction: number]>;
const DESCENT_SHAPES = {
  overshoot: [
    [0.2, 0.32],
    [0.38, 0.26],
    [0.58, 0.61],
  ],
  doubleRebound: [
    [0.22, 0.36],
    [0.34, 0.26],
    [0.53, 0.62],
    [0.65, 0.52],
    [0.82, 0.85],
  ],
  softLanding: [
    [0.38, 0.72],
    [0.7, 0.94],
  ],
} as const satisfies Record<string, StrokeShape>;
const DESCENT_PATTERNS = ["overshoot", "doubleRebound", "softLanding"] as const;
const STAIRCASE = [
  [0.19, 0.32],
  [0.34, 0.32],
  [0.52, 0.68],
  [0.68, 0.68],
] as const satisfies StrokeShape;

/** Deterministic enhancement that keeps every authored cue time. */
export function enhanceBeatScript(
  source: FunscriptAction[],
  settings: ScriptEnhancement,
  playbackRate: number,
  maxRate: number,
  patterns: EnhancementPatterns
): FunscriptAction[] {
  const percent = (value: number) => Math.max(0, Math.min(100, value)) / 100;
  const punch = patterns.beatPunch ? percent(settings.beatPunch ?? settings.wildness) : 0;
  const variation = patterns.variation ? percent(settings.variation ?? settings.wildness) : 0;
  if ((punch === 0 && variation === 0 && !hasStrokeShapes(patterns)) || source.length < 3)
    return source;
  const rate = Number.isFinite(playbackRate) ? Math.max(0.25, Math.min(3, playbackRate)) : 1;
  const limit = normalizeFunscriptMaxRate(maxRate);
  const actions = processFunscriptTrajectory(source, { enabled: false }).actions;
  const output = actions.map((point) => ({ ...point }));
  const travel = (a: FunscriptAction, b: FunscriptAction) =>
    (Math.abs(b.pos - a.pos) * 1000 * rate) / (b.at - a.at);
  // Only fit rapid passages when needed; already authored texture remains exact.
  const fast = actions.map(
    (point, i) =>
      i > 0 &&
      point.pos !== actions[i - 1]!.pos &&
      ((point.at - actions[i - 1]!.at) / rate <= 160 || travel(actions[i - 1]!, point) > limit)
  );
  let fitted: Map<number, number> | undefined;
  for (let start = 1; start < actions.length; start++) {
    if (!fast[start]) continue;
    let end = start;
    while (fast[end + 1]) end++;
    if (
      actions
        .slice(start, end + 1)
        .some((point, offset) => travel(actions[start + offset - 1]!, point) > limit)
    ) {
      fitted ??= new Map(
        fitRapidScript(actions, rate, limit).map((point) => [point.at, point.pos])
      );
      for (let i = start - 1; i <= end; i++)
        output[i]!.pos = fitted.get(actions[i]!.at) ?? actions[i]!.pos;
    }
    start = end;
  }
  const turns = actions.flatMap((point, i) =>
    i === 0 ||
    i === actions.length - 1 ||
    (point.pos - actions[i - 1]!.pos) * (actions[i + 1]!.pos - point.pos) <= 0
      ? [i]
      : []
  );
  const linear = (first: number, last: number, depth: number) => {
    const a = actions[first]!,
      b = actions[last]!;
    for (let i = first + 1; i < last; i++) {
      const fraction = (actions[i]!.at - a.at) / (b.at - a.at);
      if (
        Math.abs(actions[i]!.pos - (a.pos + (b.pos - a.pos) * fraction)) >
        Math.max(0.5, depth * 0.015)
      )
        return false;
    }
    return true;
  };
  const cycles: Cycle[] = [];
  for (let t = 1; t < turns.length - 1; t++) {
    const first = turns[t - 1]!,
      peak = turns[t]!,
      last = turns[t + 1]!;
    const a = actions[first]!,
      b = actions[peak]!,
      c = actions[last]!;
    const period = (c.at - a.at) / rate;
    const fraction = (c.at - b.at) / (c.at - a.at);
    const depth = Math.min(b.pos - a.pos, b.pos - c.pos);
    if (
      depth < 10 ||
      period < 340 ||
      period > 5000 ||
      fraction < 0.32 ||
      fraction > 0.68 ||
      a.pos === actions[first - 1]?.pos ||
      c.pos === actions[last + 1]?.pos ||
      !linear(first, peak, depth) ||
      !linear(peak, last, depth) ||
      output[first]!.pos !== a.pos ||
      output[peak]!.pos !== b.pos ||
      output[last]!.pos !== c.pos
    )
      continue;
    cycles.push({ first, peak, last, period, depth });
  }
  const resembles = (a: Cycle, b: Cycle) =>
    a.last === b.first &&
    Math.abs(a.period - b.period) <= Math.min(a.period, b.period) * 0.12 &&
    [
      Math.abs(actions[a.peak]!.pos - actions[b.peak]!.pos),
      Math.abs(actions[a.first]!.pos - actions[b.first]!.pos),
      Math.abs(actions[a.last]!.pos - actions[b.last]!.pos),
    ].every((delta) => delta <= Math.min(a.depth, b.depth) * 0.08);
  const strokeKnots = new Map<number, FunscriptAction[]>();
  const shapeLeg = (first: number, last: number, knots: FunscriptAction[]) => {
    const points = [output[first]!, ...knots, output[last]!];
    if (
      points
        .slice(1)
        .some((point, i) => point.at <= points[i]!.at || travel(points[i]!, point) > limit)
    )
      return;

    let leg = 0;
    const authoredTimes = new Set<number>();
    for (let i = first + 1; i < last; i++) {
      const point = output[i]!;
      authoredTimes.add(point.at);
      while (point.at > points[leg + 1]!.at) leg++;
      const a = points[leg]!;
      const b = points[leg + 1]!;
      point.pos = a.pos + ((b.pos - a.pos) * (point.at - a.at)) / (b.at - a.at);
    }
    strokeKnots.set(
      first,
      knots.filter((knot) => !authoredTimes.has(knot.at))
    );
  };
  const phraseLength = settings.phraseLength ?? 8;
  for (let start = 0; start < cycles.length; start++) {
    let end = start;
    // Compare against the start as well, so gradual authored ramps never get
    // mistaken for a long run of locally similar strokes.
    while (
      end + 1 < cycles.length &&
      resembles(cycles[end]!, cycles[end + 1]!) &&
      Math.abs(actions[cycles[end + 1]!.peak]!.pos - actions[cycles[start]!.peak]!.pos) <=
        cycles[start]!.depth * 0.08 &&
      Math.abs(actions[cycles[end + 1]!.last]!.pos - actions[cycles[start]!.last]!.pos) <=
        cycles[start]!.depth * 0.08
    )
      end++;
    if (end - start + 1 < 4) {
      start = end;
      continue;
    }
    for (let n = start; n <= end; n++) {
      const cycle = cycles[n]!;
      const offset = n - start;
      const phrase = Math.floor(offset / phraseLength);
      const phraseStart = start + phrase * phraseLength;
      const phraseEnd = Math.min(end, phraseStart + phraseLength - 1);
      const phase = (n - phraseStart) / Math.max(1, phraseEnd - phraseStart);
      const accent = (n - phraseStart + 1) % 4 === 0 || n === phraseEnd;
      const { first, peak, last, depth } = cycle;
      if (!accent) {
        const contraction =
          phrase % 3 === 0
            ? 0.22 * (1 - phase)
            : phrase % 3 === 1
              ? [0.05, 0.16, 0.08, 0][offset % 4]!
              : 0.12 * Math.sin(phase * Math.PI);
        output[peak]!.pos -= depth * contraction * variation;
      }
      if (n !== end && !accent) {
        const lift =
          phrase % 3 === 2 ? 0.2 * Math.sin(phase * Math.PI) : [0.12, 0.24, 0.08, 0][offset % 4]!;
        output[last]!.pos += depth * lift * variation;
      }
      // Interpolate only the recognized linear legs, retaining every input time.
      for (const [left, right] of [
        [first, peak],
        [peak, last],
      ]) {
        const a = actions[left!]!,
          b = actions[right!]!;
        for (let i = left! + 1; i < right!; i++) {
          const fraction = (actions[i]!.pos - a.pos) / (b.pos - a.pos);
          output[i]!.pos =
            output[left!]!.pos + fraction * (output[right!]!.pos - output[left!]!.pos);
        }
      }
      const a = output[peak]!,
        b = output[last]!;
      const duration = b.at - a.at;
      const distance = a.pos - b.pos;
      const targetDrop = Math.max(
        Math.min(cycle.period * 0.22, 80 + (offset % 4) * 13) * rate,
        Math.ceil((distance * 0.96 * 1000 * rate) / limit)
      );
      const drop = Math.ceil(duration - Math.max(0, duration - targetDrop) * punch);
      if (punch > 0 && drop < duration - 2 && distance > 0) {
        shapeLeg(peak, last, [{ at: b.at - drop, pos: a.pos - distance * 0.04 }]);
      }
    }
    start = end;
  }

  if (hasStrokeShapes(patterns)) {
    const descents = DESCENT_PATTERNS.filter((pattern) => patterns[pattern]);
    const applyShape = (first: number, last: number, shape: StrokeShape) => {
      const a = output[first]!;
      const b = output[last]!;
      shapeLeg(
        first,
        last,
        shape.map(([time, travel]) => ({
          at: Math.round(a.at + (b.at - a.at) * time),
          pos: a.pos + (b.pos - a.pos) * travel,
        }))
      );
    };
    const canShape = (from: number, to: number) => {
      const a = actions[from]!;
      const b = actions[to]!;
      return (
        (b.at - a.at) / rate >= 240 &&
        (b.pos - a.pos) * (output[to]!.pos - output[from]!.pos) > 0 &&
        linear(from, to, Math.abs(b.pos - a.pos))
      );
    };
    let stroke = 0;
    for (let i = 1; i < turns.length - 1; i++) {
      const first = turns[i - 1]!;
      const peak = turns[i]!;
      const last = turns[i + 1]!;
      if (actions[peak]!.pos <= actions[first]!.pos || actions[peak]!.pos <= actions[last]!.pos)
        continue;

      if (patterns.staircase && canShape(first, peak)) applyShape(first, peak, STAIRCASE);
      if (descents.length > 0 && canShape(peak, last)) {
        // Reserve one descent per rotation for the base motion or beat punch.
        const pattern = descents[stroke++ % (descents.length + 1)];
        if (pattern) applyShape(peak, last, DESCENT_SHAPES[pattern]);
      }
    }
  }

  const result = [...output, ...Array.from(strokeKnots.values()).flat()].sort(
    (a, b) => a.at - b.at
  );
  return processFunscriptTrajectory(result, {
    enabled: true,
    playbackRate: rate,
    maxRate: limit,
    rdpEpsilon: 0,
  }).actions;
}
