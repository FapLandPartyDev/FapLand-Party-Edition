import type { FunscriptAction } from "../../game/media/playback";

export const DEFAULT_FUNSCRIPT_MAX_RATE = 400;
export const DEFAULT_FUNSCRIPT_RDP_EPSILON = 1;
export const FUNSCRIPT_MAX_RATE_MIN = 1;
export const FUNSCRIPT_MAX_RATE_MAX = 2_000;
export const FUNSCRIPT_RDP_EPSILON_MIN = 0;
export const FUNSCRIPT_RDP_EPSILON_MAX = 20;

export function normalizeFunscriptMaxRate(value: unknown): number {
  if (value === null || value === undefined || value === "") return DEFAULT_FUNSCRIPT_MAX_RATE;
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_FUNSCRIPT_MAX_RATE;
  return Math.max(FUNSCRIPT_MAX_RATE_MIN, Math.min(FUNSCRIPT_MAX_RATE_MAX, parsed));
}

export function normalizeFunscriptRdpEpsilon(value: unknown): number {
  if (value === null || value === undefined || value === "") return DEFAULT_FUNSCRIPT_RDP_EPSILON;
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_FUNSCRIPT_RDP_EPSILON;
  return Math.max(FUNSCRIPT_RDP_EPSILON_MIN, Math.min(FUNSCRIPT_RDP_EPSILON_MAX, parsed));
}

export type FunscriptProcessingOptions = {
  enabled: boolean;
  playbackRate?: number;
  strokeSpanPercent?: number;
  maxRate?: number;
  rdpEpsilon?: number;
};

export type FunscriptProcessingResult = {
  actions: FunscriptAction[];
  clampedActionCount: number;
  maximumSourceRate: number;
};

function sanitizeActions(actions: FunscriptAction[]): FunscriptAction[] {
  const indexed = actions.flatMap((action, index) => {
    if (!Number.isFinite(action.at) || !Number.isFinite(action.pos)) return [];
    return [
      {
        action: {
          at: Math.max(0, Math.round(action.at)),
          pos: Math.max(0, Math.min(100, action.pos)),
        },
        index,
      },
    ];
  });

  indexed.sort((left, right) => left.action.at - right.action.at || left.index - right.index);

  const result: FunscriptAction[] = [];
  for (const entry of indexed) {
    const previous = result[result.length - 1];
    if (previous?.at === entry.action.at) {
      result[result.length - 1] = entry.action;
    } else {
      result.push(entry.action);
    }
  }
  return result;
}

function simplifyRdp(actions: FunscriptAction[], epsilon: number): FunscriptAction[] {
  if (actions.length < 3 || epsilon <= 0) return [...actions];

  const keep = new Uint8Array(actions.length);
  keep[0] = 1;
  keep[actions.length - 1] = 1;
  const stack: Array<[number, number]> = [[0, actions.length - 1]];
  const epsilonSquared = epsilon * epsilon;

  while (stack.length > 0) {
    const segment = stack.pop();
    if (!segment) break;
    const [start, end] = segment;
    const first = actions[start];
    const last = actions[end];
    if (!first || !last) continue;

    const dx = last.at - first.at;
    const dy = last.pos - first.pos;
    const magnitudeSquared = dx * dx + dy * dy;
    let furthestIndex = -1;
    let furthestDistanceSquared = 0;

    for (let index = start + 1; index < end; index += 1) {
      const action = actions[index];
      if (!action) continue;
      let distanceSquared: number;
      if (magnitudeSquared === 0) {
        const pointDx = action.at - first.at;
        const pointDy = action.pos - first.pos;
        distanceSquared = pointDx * pointDx + pointDy * pointDy;
      } else {
        const numerator =
          dy * action.at - dx * action.pos + last.at * first.pos - last.pos * first.at;
        distanceSquared = (numerator * numerator) / magnitudeSquared;
      }
      if (distanceSquared > furthestDistanceSquared) {
        furthestDistanceSquared = distanceSquared;
        furthestIndex = index;
      }
    }

    if (furthestIndex >= 0 && furthestDistanceSquared > epsilonSquared) {
      keep[furthestIndex] = 1;
      stack.push([start, furthestIndex], [furthestIndex, end]);
    }
  }

  return actions.filter((_, index) => keep[index] === 1);
}

export function processFunscriptTrajectory(
  sourceActions: FunscriptAction[],
  options: FunscriptProcessingOptions
): FunscriptProcessingResult {
  const actions = sanitizeActions(sourceActions);
  if (actions.length < 2) {
    return { actions, clampedActionCount: 0, maximumSourceRate: 0 };
  }

  const playbackRate = Math.max(0.01, options.playbackRate ?? 1);
  let maximumSourceRate = 0;
  for (let index = 1; index < actions.length; index += 1) {
    const previous = actions[index - 1];
    const current = actions[index];
    if (!previous || !current) continue;
    const elapsedSeconds = (current.at - previous.at) / 1000 / playbackRate;
    if (elapsedSeconds > 0) {
      maximumSourceRate = Math.max(
        maximumSourceRate,
        Math.abs(current.pos - previous.pos) / elapsedSeconds
      );
    }
  }

  if (!options.enabled) {
    return { actions, clampedActionCount: 0, maximumSourceRate };
  }

  const strokeFraction = Math.max(0.01, Math.min(1, (options.strokeSpanPercent ?? 100) / 100));
  const maximumRate = normalizeFunscriptMaxRate(options.maxRate);
  const limited: FunscriptAction[] = [actions[0]!];
  let clampedActionCount = 0;

  for (let index = 1; index < actions.length; index += 1) {
    const current = actions[index];
    const previous = limited[limited.length - 1];
    if (!current || !previous) continue;
    const elapsedSeconds = (current.at - previous.at) / 1000 / playbackRate;
    const maximumChange = (maximumRate / strokeFraction) * elapsedSeconds;
    const change = current.pos - previous.pos;
    if (Math.abs(change) > maximumChange) {
      limited.push({
        at: current.at,
        pos: Math.max(0, Math.min(100, previous.pos + Math.sign(change) * maximumChange)),
      });
      clampedActionCount += 1;
    } else {
      limited.push({ ...current });
    }
  }

  return {
    actions: simplifyRdp(limited, normalizeFunscriptRdpEpsilon(options.rdpEpsilon)),
    clampedActionCount,
    maximumSourceRate,
  };
}

export function getFunscriptActionsFingerprint(actions: FunscriptAction[]): string {
  let hash = 2166136261;
  for (const action of actions) {
    const values = [Math.round(action.at), Math.round(action.pos * 1000)];
    for (const value of values) {
      hash ^= value;
      hash = Math.imul(hash, 16777619);
    }
  }
  return `${actions.length}:${(hash >>> 0).toString(36)}`;
}
