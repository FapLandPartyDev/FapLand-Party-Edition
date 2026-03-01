import type { InstalledRound, Resource } from "../../services/db";

export type PlaybackResource = Pick<Resource, "videoUri" | "funscriptUri">;

export type FunscriptAction = {
  at: number;
  pos: number;
};

export type FunscriptTimeline = {
  actions: FunscriptAction[];
};

export type IntermediaryTrigger = {
  id: string;
  atProgress: number;
  resource: PlaybackResource;
};

export type PlaybackModifierContext = {
  playerPerks: string[];
  playerAntiPerks: string[];
  mainResource: PlaybackResource;
  intermediaryResources: PlaybackResource[];
};

export type PlaybackRateState = {
  elapsedSessionSec: number;
  currentTimeSec: number;
  durationSec: number;
};

export type PlaybackModifier = {
  id: string;
  isEnabled: (ctx: PlaybackModifierContext) => boolean;
  getPlaybackRateMultiplier?: (state: PlaybackRateState) => number;
  createIntermediaryQueue?: (ctx: PlaybackModifierContext) => IntermediaryTrigger[];
};

const JAMMED_DICE_INTERMEDIARIES: PlaybackModifier = {
  id: "jammed-dice-intermediary-spawn",
  isEnabled: (ctx) => ctx.playerAntiPerks.includes("jammed-dice") && ctx.intermediaryResources.length > 0,
  createIntermediaryQueue: (ctx) => {
    const markers = [0.33, 0.66];
    return markers.map((atProgress, index) => {
      const resource = ctx.intermediaryResources[index % ctx.intermediaryResources.length];
      return {
        id: `jammed-dice-${index}`,
        atProgress,
        resource,
      };
    });
  },
};

const HIGHSPEED_RATE: PlaybackModifier = {
  id: "highspeed-rate",
  isEnabled: (ctx) => ctx.playerAntiPerks.includes("highspeed"),
  getPlaybackRateMultiplier: () => 1.2,
};

const BUILTIN_MODIFIERS: PlaybackModifier[] = [
  JAMMED_DICE_INTERMEDIARIES,
  HIGHSPEED_RATE,
];

export function getActivePlaybackModifiers(
  ctx: PlaybackModifierContext,
  extraModifiers: PlaybackModifier[] = [],
): PlaybackModifier[] {
  return [...BUILTIN_MODIFIERS, ...extraModifiers].filter((modifier) => modifier.isEnabled(ctx));
}

export function computePlaybackRate(
  modifiers: PlaybackModifier[],
  state: PlaybackRateState,
): number {
  const rate = modifiers.reduce((acc, modifier) => {
    if (!modifier.getPlaybackRateMultiplier) return acc;
    const multiplier = modifier.getPlaybackRateMultiplier(state);
    if (!Number.isFinite(multiplier) || multiplier <= 0) return acc;
    return acc * multiplier;
  }, 1);

  return Math.min(3, Math.max(0.25, rate));
}

export function buildIntermediaryQueue(
  modifiers: PlaybackModifier[],
  ctx: PlaybackModifierContext,
): IntermediaryTrigger[] {
  return modifiers
    .flatMap((modifier) => modifier.createIntermediaryQueue?.(ctx) ?? [])
    .filter((entry) => Number.isFinite(entry.atProgress) && entry.atProgress > 0 && entry.atProgress < 1)
    .sort((a, b) => a.atProgress - b.atProgress);
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

const funscriptTimelineCache = new Map<string, FunscriptTimeline>();
const funscriptTimelineInFlight = new Map<string, Promise<FunscriptTimeline | null>>();

export async function loadFunscriptTimeline(funscriptUri: string): Promise<FunscriptTimeline | null> {
  const cached = funscriptTimelineCache.get(funscriptUri);
  if (cached) return cached;

  const inFlight = funscriptTimelineInFlight.get(funscriptUri);
  if (inFlight) return inFlight;

  const loadPromise = (async () => {
    try {
      const response = await fetch(funscriptUri);
      if (!response.ok) return null;

      const body = await response.text();
      const normalizedBody = body.charCodeAt(0) === 0xfeff ? body.slice(1) : body;
      const raw = JSON.parse(normalizedBody) as {
        actions?: Array<{ at?: unknown; pos?: unknown }>;
        range?: unknown;
        inverted?: unknown;
      };
      const range = toNumber(raw.range);
      const normalizeRange = range !== null && range > 0 ? range : 100;
      const isInverted = raw.inverted === true;
      const actions = (raw.actions ?? [])
        .map((action) => {
          const at = toNumber(action.at);
          const pos = toNumber(action.pos);
          if (at === null || pos === null) return null;
          const normalizedPos = Math.max(0, Math.min(100, (pos / normalizeRange) * 100));
          const finalPos = isInverted ? 100 - normalizedPos : normalizedPos;
          return { at: Math.max(0, at), pos: finalPos } satisfies FunscriptAction;
        })
        .filter((action): action is FunscriptAction => action !== null)
        .sort((a, b) => a.at - b.at);

      // Ensure a t=0 anchor so HSP playback does not start in a starvation gap
      // when the first funscript action is delayed.
      if (actions.length > 0) {
        const first = actions[0];
        if (first && first.at > 0) {
          actions.unshift({ at: 0, pos: first.pos });
        }
      }

      const timeline = { actions };
      funscriptTimelineCache.set(funscriptUri, timeline);
      return timeline;
    } catch (error) {
      console.warn("Failed to load funscript timeline", error);
      return null;
    } finally {
      funscriptTimelineInFlight.delete(funscriptUri);
    }
  })();

  funscriptTimelineInFlight.set(funscriptUri, loadPromise);
  return loadPromise;
}

export function getFunscriptPositionAtMs(timeline: FunscriptTimeline | null, timeMs: number): number | null {
  if (!timeline || timeline.actions.length === 0) return null;

  let lo = 0;
  let hi = timeline.actions.length - 1;
  let best = -1;

  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const point = timeline.actions[mid];
    if (!point) break;

    if (point.at <= timeMs) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }

  if (best < 0) return timeline.actions[0]?.pos ?? null;
  const current = timeline.actions[best];
  const next = timeline.actions[best + 1];
  if (!current) return null;
  if (!next) return current.pos;

  const span = next.at - current.at;
  if (span <= 0) return current.pos;

  const progress = Math.max(0, Math.min(1, (timeMs - current.at) / span));
  return current.pos + (next.pos - current.pos) * progress;
}

export function resolveRoundResources(round: InstalledRound): {
  mainResource: PlaybackResource | null;
  intermediaryResources: PlaybackResource[];
} {
  const [mainResource, ...intermediaryResources] = round.resources;
  return {
    mainResource: mainResource ?? null,
    intermediaryResources,
  };
}
