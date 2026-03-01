import type { FunscriptAction } from "../../game/media/playback";
import { enhanceBeatScript } from "./beatScriptEnhancement";
import { DEFAULT_ENHANCEMENT_PATTERNS, type EnhancementPatterns } from "./enhancementPatterns";
import { normalizeFunscriptMaxRate, processFunscriptTrajectory } from "./funscriptRateLimiter";

export type ScriptEnhancement = {
  enabled: boolean;
  wildness: number;
  beatPunch?: number;
  /** Expand restricted stroke ranges toward full travel (0 = off). */
  delimited?: number;
  delimitedEnabled?: boolean;
  variation?: number;
  phraseLength?: 4 | 8 | 16;
};
export const DEFAULT_SCRIPT_ENHANCEMENT: ScriptEnhancement = { enabled: false, wildness: 50 };

export function normalizeScriptEnhancement(value: unknown): ScriptEnhancement {
  if (!value || typeof value !== "object") return { ...DEFAULT_SCRIPT_ENHANCEMENT };
  const settings = value as Record<string, unknown>;
  const controls: Partial<ScriptEnhancement> = {};
  if (typeof settings.delimitedEnabled === "boolean")
    controls.delimitedEnabled = settings.delimitedEnabled;
  for (const key of ["beatPunch", "variation", "delimited"] as const) {
    const control = settings[key];
    if (typeof control === "number" && Number.isFinite(control))
      controls[key] = Math.round(Math.max(0, Math.min(100, control)));
  }
  if (settings.phraseLength === 4 || settings.phraseLength === 8 || settings.phraseLength === 16)
    controls.phraseLength = settings.phraseLength;
  return {
    ...controls,
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
  maxRate = normalizeFunscriptMaxRate(undefined),
  patterns: EnhancementPatterns = DEFAULT_ENHANCEMENT_PATTERNS
): FunscriptAction[] {
  const normalized = normalizeScriptEnhancement(settings);
  if (!normalized.enabled) return source;
  const patterned = enhanceBeatScript(source, normalized, playbackRate, maxRate, patterns);
  const strength =
    patterns.delimited && normalized.delimitedEnabled !== false
      ? (normalized.delimited ?? 0) / 100
      : 0;
  if (strength === 0 || patterned.length < 2) return patterned;
  const rate = Number.isFinite(playbackRate) ? Math.max(0.25, Math.min(3, playbackRate)) : 1;
  const limit = normalizeFunscriptMaxRate(maxRate);
  const { actions, maximumSourceRate } = processFunscriptTrajectory(patterned, {
    enabled: false,
    playbackRate: rate,
  });
  if (maximumSourceRate === 0) return patterned;

  // Fit the turns and interpolate the samples between them by position to keep
  // the original easing and holds. Each moving sample contributes a speed limit.
  const baselineGain = Math.min(1, limit / maximumSourceRate);
  const turns = [0];
  const strokes: { minDelta: number; maxDelta: number }[] = [];
  let direction = 0;
  let gain = Infinity;
  for (let i = 1; i < actions.length; i++) {
    const before = actions[i - 1]!;
    const after = actions[i]!;
    const delta = after.pos - before.pos;
    if (delta === 0) continue;
    const nextDirection = Math.sign(delta);
    if (direction !== 0 && direction !== nextDirection) {
      addTurn(i - 1);
      gain = Infinity;
    }
    direction = nextDirection;
    gain = Math.min(gain, ((after.at - before.at) * limit) / (1000 * rate * Math.abs(delta)));
  }
  addTurn(actions.length - 1);

  function addTurn(index: number) {
    const delta = actions[index]!.pos - actions[turns.at(-1)!]!.pos;
    const baseline = delta * baselineGain;
    const capacity = delta * gain;
    strokes.push({
      minDelta: Math.min(baseline, capacity),
      maxDelta: Math.max(baseline, capacity),
    });
    turns.push(index);
  }

  const bounds = turns.map((index, i) => {
    const stroke = strokes[Math.max(0, i - 1)]!;
    const isPeak = i === 0 ? stroke.maxDelta < 0 : stroke.minDelta > 0;
    const pos = actions[index]!.pos;
    const target = pos + ((isPeak ? 100 : 0) - pos) * strength;
    return { lowerTarget: target, upperTarget: target, min: 0, max: 100 };
  });

  // Propagate reachability in both directions to distribute travel between
  // adjacent turns and keep a fast stroke from limiting unrelated movement.
  function constrain(index: number, from: number, minDelta: number, maxDelta: number) {
    const current = bounds[index]!;
    const neighbor = bounds[from]!;
    current.lowerTarget = Math.min(current.lowerTarget, neighbor.lowerTarget + maxDelta);
    current.upperTarget = Math.max(current.upperTarget, neighbor.upperTarget + minDelta);
    current.min = Math.max(current.min, neighbor.min + minDelta);
    current.max = Math.min(current.max, neighbor.max + maxDelta);
  }
  for (let i = 0; i < strokes.length; i++) {
    const { minDelta, maxDelta } = strokes[i]!;
    constrain(i + 1, i, minDelta, maxDelta);
  }
  for (let i = strokes.length - 1; i >= 0; i--) {
    const { minDelta, maxDelta } = strokes[i]!;
    constrain(i, i + 1, -maxDelta, -minDelta);
  }
  const positions = bounds.map(({ lowerTarget, upperTarget, min, max }) =>
    Math.max(min, Math.min(max, (lowerTarget + upperTarget) / 2))
  );
  const output: FunscriptAction[] = [{ at: actions[0]!.at, pos: positions[0]! }];
  for (let i = 0; i < strokes.length; i++) {
    const first = turns[i]!;
    const last = turns[i + 1]!;
    const start = actions[first]!.pos;
    const span = actions[last]!.pos - start;
    const from = positions[i]!;
    const to = positions[i + 1]!;
    for (let sample = first + 1; sample <= last; sample++) {
      const { at, pos } = actions[sample]!;
      output.push({ at, pos: from + ((pos - start) / span) * (to - from) });
    }
  }
  return output;
}
