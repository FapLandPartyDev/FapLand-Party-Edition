import type { FunscriptAction } from "../../game/media/playback";
import {
  getFunscriptActionsFingerprint,
  normalizeFunscriptMaxRate,
  processFunscriptTrajectory,
} from "./funscriptRateLimiter";

export type ScriptEnhancement = { enabled: boolean; wildness: number };
export const DEFAULT_SCRIPT_ENHANCEMENT: ScriptEnhancement = { enabled: false, wildness: 50 };

export function normalizeScriptEnhancement(value: unknown): ScriptEnhancement {
  if (!value || typeof value !== "object") return { ...DEFAULT_SCRIPT_ENHANCEMENT };
  const settings = value as Record<string, unknown>;
  return {
    enabled: settings.enabled === true,
    wildness:
      typeof settings.wildness === "number" && Number.isFinite(settings.wildness)
        ? Math.round(Math.max(0, Math.min(100, settings.wildness)))
        : 50,
  };
}

const scriptUris = new WeakMap<FunscriptAction[], string>();

export function identifyScriptActions(actions: FunscriptAction[], uri: string): void {
  scriptUris.set(actions, uri);
}

export function getScriptActionsUri(actions: FunscriptAction[]): string | undefined {
  return scriptUris.get(actions);
}

export function inheritScriptIdentity(
  source: FunscriptAction[],
  actions: FunscriptAction[]
): FunscriptAction[] {
  const uri = scriptUris.get(source);
  if (uri) identifyScriptActions(actions, uri);
  return actions;
}

/** Pure, whole-timeline transform: seeking and replay never change the pattern. */
export function enhanceScript(
  source: FunscriptAction[],
  settings: ScriptEnhancement,
  playbackRate = 1,
  maxRate?: number
): FunscriptAction[] {
  const strength = normalizeScriptEnhancement(settings).wildness / 100;
  if (!settings.enabled || strength === 0 || source.length < 3) return source;
  const sanitized = processFunscriptTrajectory(source, { enabled: false }).actions;
  // Remove only collinear samples; retain authored easing and pauses.
  const turns: FunscriptAction[] = [];
  for (const action of sanitized) {
    while (turns.length >= 2) {
      const previous = turns[turns.length - 1]!;
      const before = turns[turns.length - 2]!;
      if ((previous.pos - before.pos) * (action.pos - previous.pos) <= 0) break;
      const cross =
        (previous.pos - before.pos) * (action.at - previous.at) -
        (action.pos - previous.pos) * (previous.at - before.at);
      if (Math.abs(cross) > 0.000001) break;
      turns.pop();
    }
    turns.push({ ...action });
  }
  if (turns.length < 3) return source;
  const rate = Number.isFinite(playbackRate) ? Math.max(0.25, Math.min(3, playbackRate)) : 1;
  const limit = normalizeFunscriptMaxRate(maxRate);
  let min = 100;
  let max = 0;
  for (const action of turns) {
    min = Math.min(min, action.pos);
    max = Math.max(max, action.pos);
  }
  const span = max - min;
  if (span === 0) return source;
  const seed = parseInt(getFunscriptActionsFingerprint(sanitized).split(":")[1]!, 36) / 0xffffffff;
  const output = turns.map((action) => ({ ...action }));
  const clamp = (value: number) => Math.max(min, Math.min(max, value));
  const travel = (left: FunscriptAction, right: FunscriptAction) =>
    ((right.at - left.at) * limit) / (1000 * rate);
  // Detect cadence from actual direction changes, not from easing sample density.
  const motionIndices = turns.flatMap((point, index) =>
    index === 0 ||
    index === turns.length - 1 ||
    (point.pos - turns[index - 1]!.pos) * (turns[index + 1]!.pos - point.pos) <= 0
      ? [index]
      : []
  );
  const motion = motionIndices.map((index) => turns[index]!);
  const budgets = motion.slice(1).map((point, index) => {
    const before = motion[index]!;
    let budget = travel(before, point);
    const distance = Math.abs(point.pos - before.pos);
    for (let sample = motionIndices[index]! + 1; sample <= motionIndices[index + 1]!; sample += 1) {
      const delta = Math.abs(turns[sample]!.pos - turns[sample - 1]!.pos);
      if (delta > 0)
        budget = Math.min(budget, (travel(turns[sample - 1]!, turns[sample]!) * distance) / delta);
    }
    return budget;
  });
  const fastEdges = motion.slice(1).map((action, index) => {
    const before = motion[index]!;
    return (
      action.pos !== before.pos &&
      ((action.at - before.at) / rate <= 160 || Math.abs(action.pos - before.pos) > budgets[index]!)
    );
  });
  const fastPoints = turns.map(() => false);
  fastEdges.forEach((fast, index) => {
    if (!fast) return;
    for (let sample = motionIndices[index]!; sample <= motionIndices[index + 1]!; sample += 1) {
      fastPoints[sample] = true;
    }
  });

  for (let index = 1; index < turns.length - 1; index += 1) {
    const before = turns[index - 1]!;
    const current = turns[index]!;
    const after = turns[index + 1]!;
    // Keep pauses and their boundary positions intact.
    if (before.pos === current.pos || after.pos === current.pos) continue;
    if (fastPoints[index]) continue;
    const previousPeer = turns[index - 2];
    const nextPeer = turns[index + 2];
    const repetitive = [previousPeer, nextPeer].some(
      (peer) => peer && Math.abs(peer.pos - current.pos) <= span * 0.08
    );
    if (!repetitive) continue;
    const wave = Math.sin(seed * Math.PI * 2 + index * 0.79);
    const isPeak = current.pos > before.pos && current.pos > after.pos;
    const isTrough = current.pos < before.pos && current.pos < after.pos;
    if (!isPeak && !isTrough) continue;
    // A full accent every fourth stroke gives the variation a recurring pulse.
    const accent = Math.floor(index / 2) % 4 === 3;
    const contraction = accent ? 0 : (0.1 + 0.1 * wave) * strength * span;
    output[index]!.pos = clamp(current.pos + (isPeak ? -contraction : contraction));
  }

  // Anchor each downbeat (the trough). Delay the rise's peak only where both
  // travel legs still fit the configured speed budget at the playback rate.
  let peakNumber = 0;
  for (let index = 1; index < output.length - 1; index += 1) {
    if (fastPoints[index - 1] || fastPoints[index] || fastPoints[index + 1]) continue;
    const before = output[index - 1]!;
    const peak = output[index]!;
    const after = output[index + 1]!;
    if (peak.pos <= before.pos || peak.pos <= after.pos) continue;
    peakNumber += 1;
    if (
      turns[index - 1]!.pos === turns[index - 2]?.pos ||
      turns[index + 1]!.pos === turns[index + 2]?.pos
    )
      continue;
    const period = after.at - before.at;
    if (period / rate < 600 || period / rate > 5000) continue;
    const latestPeak = after.at - Math.ceil(((peak.pos - after.pos) * 1000 * rate) / limit);
    const earliestPeak = before.at + Math.ceil(((peak.pos - before.pos) * 1000 * rate) / limit);
    // Leave room for rebound strokes instead of spending all spare travel on
    // a late peak. Alternate those with the longer slow-rise, quick-fall shape.
    const peakFraction = peakNumber % 2 === 1 ? 0.55 : 0.75;
    const desired = Math.round(
      peak.at + Math.max(0, before.at + period * peakFraction - peak.at) * strength
    );
    if (latestPeak < earliestPeak || latestPeak <= peak.at) continue;
    peak.at = Math.max(earliestPeak, Math.min(latestPeak, desired));
  }

  // Treat each rapid passage as a carrier with a slowly moving center. Reserve
  // most of the speed budget for the vibration itself, including at low wildness.
  // Independent peak contraction followed by causal clipping can erase reversals.
  for (let start = 0; start < motion.length; start += 1) {
    if (!fastEdges[start]) continue;
    let end = start;
    while (end + 1 < motion.length && fastEdges[end]) end += 1;
    const centers: number[] = [];
    const amplitudes: number[] = [];
    for (let index = start; index <= end; index += 1) {
      const current = motion[index]!;
      const before = motion[Math.max(start, index - 1)]!;
      const after = motion[Math.min(end, index + 1)]!;
      const neighbor = index === start ? after : before;
      const room = Math.min(
        index > start ? budgets[index - 1]! : Infinity,
        index < end ? budgets[index]! : Infinity
      );
      const excursion = Math.min(
        index > start ? Math.abs(current.pos - before.pos) : Infinity,
        index < end ? Math.abs(after.pos - current.pos) : Infinity
      );
      amplitudes.push(Math.min(excursion / 2, room * 0.42));
      const wave = Math.sin(seed * Math.PI * 2 + current.at / (rate * 400));
      centers.push(
        (current.pos + neighbor.pos) / 2 + wave * Math.min(span * 0.12, excursion * 0.25) * strength
      );
    }
    const margin = amplitudes.reduce((largest, amplitude) => Math.max(largest, amplitude), 0);
    const centerBudget = (offset: number) =>
      Math.min(
        budgets[start + offset - 1]! * 0.12,
        (amplitudes[offset - 1]! + amplitudes[offset]!) * 0.12
      );
    const startsAtHold = motion[start - 1]?.pos === motion[start]!.pos;
    const endsAtHold = motion[end + 1]?.pos === motion[end]!.pos;
    const startCenter =
      motion[start]!.pos - Math.sign(motion[start]!.pos - motion[start + 1]!.pos) * amplitudes[0]!;
    const endCenter =
      motion[end]!.pos - Math.sign(motion[end]!.pos - motion[end - 1]!.pos) * amplitudes.at(-1)!;
    for (let offset = 0; offset < centers.length; offset += 1) {
      centers[offset] = Math.max(min + margin, Math.min(max - margin, centers[offset]!));
      if (offset === 0 && startsAtHold) centers[offset] = startCenter;
      if (offset === 0) continue;
      const budget = centerBudget(offset);
      centers[offset] = Math.max(
        centers[offset - 1]! - budget,
        Math.min(centers[offset - 1]! + budget, centers[offset]!)
      );
    }
    if (endsAtHold) {
      centers[centers.length - 1] = endCenter;
      for (let offset = centers.length - 2; offset >= 0; offset -= 1) {
        const budget = centerBudget(offset + 1);
        centers[offset] = Math.max(
          centers[offset + 1]! - budget,
          Math.min(centers[offset + 1]! + budget, centers[offset]!)
        );
      }
    }
    // Blend a whole passage together. Per-point blending can alternate fitted
    // and unfitted centers at a speed transition and destroy the carrier.
    const fits = motion
      .slice(start + 1, end + 1)
      .every(
        (point, offset) =>
          Math.abs(point.pos - motion[start + offset]!.pos) <= budgets[start + offset]!
      );
    for (let index = start; index <= end; index += 1) {
      const current = motion[index]!;
      // Hold boundaries remain authored anchors.
      if (motion[index - 1]?.pos === current.pos || motion[index + 1]?.pos === current.pos)
        continue;
      const offset = index - start;
      const direction =
        index === start
          ? Math.sign(current.pos - motion[index + 1]!.pos)
          : Math.sign(current.pos - motion[index - 1]!.pos);
      const target = centers[offset]! + direction * amplitudes[offset]!;
      // If the source already fits, wildness blends in the center variation.
      // Overspeed sources need the full fitted carrier even at low wildness.
      output[motionIndices[index]!]!.pos = fits
        ? current.pos + (target - current.pos) * strength
        : target;
    }
    for (let index = start; index < end; index += 1) {
      const first = motionIndices[index]!;
      const last = motionIndices[index + 1]!;
      for (let sample = first + 1; sample < last; sample += 1) {
        const fraction =
          (turns[sample]!.pos - turns[first]!.pos) / (turns[last]!.pos - turns[first]!.pos);
        output[sample]!.pos =
          output[first]!.pos + fraction * (output[last]!.pos - output[first]!.pos);
      }
    }
    start = end;
  }

  const detailed: FunscriptAction[] = [];
  let stroke = 0;
  for (let index = 0; index < output.length; index += 1) {
    const current = output[index]!;
    detailed.push(current);
    const after = output[index + 1];
    const before = output[index - 1];
    if (!after || fastPoints[index] || fastPoints[index + 1]) continue;
    if (!before || current.pos <= before.pos || current.pos <= after.pos) continue;
    stroke += 1;
    const duration = after.at - current.at;
    if (duration / rate < 240) continue;
    const distance = current.pos - after.pos;
    const knots: FunscriptAction[] = [];
    if (stroke % 4 === 2 && duration / rate >= 450) {
      // Three small, evenly spaced reversals make a brief textured descent.
      for (let pulse = 1; pulse <= 6; pulse += 1) {
        const fraction = pulse * 0.09;
        const baseline = current.pos - distance * fraction;
        knots.push({
          at: Math.round(current.at + duration * fraction),
          pos: clamp(baseline + (pulse % 2 === 0 ? 1 : -1) * distance * 0.08 * strength),
        });
      }
    } else if (stroke % 4 === 1 || stroke % 4 === 3) {
      // Overshoot, rebound, and settle inside the script's existing range.
      for (const [fraction, offset] of [
        [0.2, -0.12],
        [0.38, 0.12],
        [0.58, -0.03],
      ]) {
        knots.push({
          at: Math.round(current.at + duration * fraction!),
          pos: clamp(current.pos - distance * fraction! + distance * offset! * strength),
        });
      }
    }
    // Only add a motif when every leg fits; never let the limiter flatten it.
    const candidate = [current, ...knots, after];
    if (
      candidate.every(
        (point, offset) =>
          offset === 0 ||
          (point.at > candidate[offset - 1]!.at &&
            Math.abs(point.pos - candidate[offset - 1]!.pos) <=
              travel(candidate[offset - 1]!, point))
      )
    ) {
      detailed.push(...knots);
    }
  }
  return processFunscriptTrajectory(detailed, {
    enabled: true,
    playbackRate: rate,
    maxRate: limit,
    rdpEpsilon: 0,
  }).actions;
}
