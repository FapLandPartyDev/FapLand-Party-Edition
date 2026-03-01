import type { FunscriptAction } from "../../game/media/playback";
import {
  createGeneratedSequenceActions,
  type GeneratedSequenceMode,
} from "./generatedSequenceMotion";
import { i18n } from "../../i18n";

export type AntiPerkSequenceId = GeneratedSequenceMode;
export type BeatbarVisualStyle = "jackhammer" | "milker" | "neutral";

export type BeatHit = {
  at: number;
  pos: number;
  strength: number;
};

export type BeatbarBeat = {
  at: number;
  lowPos: number;
  fromPos: number;
  strength: number;
};

export type BeatbarMotionEvent = {
  at: number;
  fromPos: number;
  toPos: number;
  strength: number;
  kind: "downstroke" | "vibration";
};

export type AntiPerkSequenceDefinition = {
  id: AntiPerkSequenceId;
  label: string;
  statusWhileCountdown: string;
  durationSec: number;
  supportsBeatbar: boolean;
  beatbarStyle: BeatbarVisualStyle;
  createActions: (durationMs: number, rng?: () => number) => FunscriptAction[];
  createBeatbarBeats: (actions: FunscriptAction[]) => BeatbarBeat[];
  extractBeatHits: (actions: FunscriptAction[]) => BeatHit[];
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function extractAccentBeatHits(
  actions: FunscriptAction[],
  options: {
    minUpwardTravel: number;
    minSpacingMs: number;
    minPeakPos: number;
  }
): BeatHit[] {
  const hits: BeatHit[] = [];

  for (let index = 1; index < actions.length - 1; index += 1) {
    const previous = actions[index - 1]!;
    const current = actions[index]!;
    const next = actions[index + 1]!;

    const upwardTravel = current.pos - previous.pos;
    const downwardTravel = current.pos - next.pos;
    const isPeak = current.pos >= previous.pos && current.pos > next.pos;
    if (!isPeak) continue;
    if (current.pos < options.minPeakPos) continue;
    if (upwardTravel < options.minUpwardTravel) continue;
    if (downwardTravel <= 0) continue;

    const lastHit = hits[hits.length - 1];
    if (lastHit && current.at - lastHit.at < options.minSpacingMs) {
      if (current.pos <= lastHit.pos) continue;
      hits[hits.length - 1] = {
        at: current.at,
        pos: current.pos,
        strength: clamp((upwardTravel + downwardTravel) / 48, 0.35, 1),
      };
      continue;
    }

    hits.push({
      at: current.at,
      pos: current.pos,
      strength: clamp((upwardTravel + downwardTravel) / 48, 0.35, 1),
    });
  }

  return hits;
}

function isMicroVibrationMove(move: { deltaPos: number; durationMs: number }): boolean {
  return move.durationMs <= 55 && Math.abs(move.deltaPos) <= 12;
}

export function extractDescendingBeatbarBeats(actions: FunscriptAction[]): BeatbarBeat[] {
  const beats: BeatbarBeat[] = [];

  for (let index = 1; index < actions.length; index += 1) {
    const previous = actions[index - 1]!;
    const current = actions[index]!;
    const downwardTravel = previous.pos - current.pos;

    if (downwardTravel <= 0) continue;

    beats.push({
      at: current.at,
      lowPos: current.pos,
      fromPos: previous.pos,
      strength: clamp(downwardTravel / 42, 0.35, 1),
    });
  }

  return beats;
}

export function extractBeatbarMotionEvents(actions: FunscriptAction[]): BeatbarMotionEvent[] {
  const events: BeatbarMotionEvent[] = [];

  for (let index = 1; index < actions.length; index += 1) {
    const previous = actions[index - 1]!;
    const current = actions[index]!;
    const deltaPos = current.pos - previous.pos;
    const durationMs = Math.max(1, current.at - previous.at);

    if (deltaPos >= 0) continue;

    const previousMove =
      index >= 2
        ? {
            deltaPos: actions[index - 1]!.pos - actions[index - 2]!.pos,
            durationMs: actions[index - 1]!.at - actions[index - 2]!.at,
          }
        : null;
    const nextMove =
      index + 1 < actions.length
        ? {
            deltaPos: actions[index + 1]!.pos - current.pos,
            durationMs: actions[index + 1]!.at - current.at,
          }
        : null;

    const vibratesWithPrevious =
      previousMove !== null &&
      previousMove.deltaPos > 0 &&
      isMicroVibrationMove(previousMove) &&
      isMicroVibrationMove({ deltaPos, durationMs });
    const vibratesWithNext =
      nextMove !== null &&
      nextMove.deltaPos > 0 &&
      isMicroVibrationMove(nextMove) &&
      isMicroVibrationMove({ deltaPos, durationMs });
    const isVibration = vibratesWithPrevious || vibratesWithNext;

    events.push({
      at: current.at,
      fromPos: previous.pos,
      toPos: current.pos,
      strength: clamp(Math.abs(deltaPos) / 42 + (durationMs <= 120 ? 0.18 : 0), 0.28, 1),
      kind: isVibration ? "vibration" : "downstroke",
    });
  }

  return events;
}

export const ANTI_PERK_SEQUENCE_DEFINITIONS: Record<
  AntiPerkSequenceId,
  AntiPerkSequenceDefinition
> = {
  milker: {
    id: "milker",
    get label() {
      return i18n._({ id: "antiperk.sequence.milker.label", message: "MILKER SEQUENCE" });
    },
    get statusWhileCountdown() {
      return i18n._({
        id: "antiperk.sequence.milker.status",
        message: "Milker anti-perk active...",
      });
    },
    durationSec: 30,
    supportsBeatbar: true,
    beatbarStyle: "milker",
    createActions: (durationMs, rng) => createGeneratedSequenceActions(durationMs, "milker", rng),
    createBeatbarBeats: extractDescendingBeatbarBeats,
    extractBeatHits: (actions) =>
      extractAccentBeatHits(actions, {
        minUpwardTravel: 22,
        minSpacingMs: 220,
        minPeakPos: 80,
      }),
  },
  jackhammer: {
    id: "jackhammer",
    get label() {
      return i18n._({ id: "antiperk.sequence.jackhammer.label", message: "JACKHAMMER SEQUENCE" });
    },
    get statusWhileCountdown() {
      return i18n._({
        id: "antiperk.sequence.jackhammer.status",
        message: "Jackhammer anti-perk active...",
      });
    },
    durationSec: 15,
    supportsBeatbar: true,
    beatbarStyle: "jackhammer",
    createActions: (durationMs, rng) =>
      createGeneratedSequenceActions(durationMs, "jackhammer", rng),
    createBeatbarBeats: extractDescendingBeatbarBeats,
    extractBeatHits: (actions) =>
      extractAccentBeatHits(actions, {
        minUpwardTravel: 20,
        minSpacingMs: 150,
        minPeakPos: 80,
      }),
  },
  "no-rest": {
    id: "no-rest",
    get label() {
      return i18n._({ id: "antiperk.sequence.noRest.label", message: "NO REST FILLER" });
    },
    get statusWhileCountdown() {
      return i18n._({
        id: "antiperk.sequence.noRest.status",
        message: "No-rest anti-perk active...",
      });
    },
    durationSec: 10,
    supportsBeatbar: false,
    beatbarStyle: "neutral",
    createActions: (durationMs, rng) => createGeneratedSequenceActions(durationMs, "no-rest", rng),
    createBeatbarBeats: () => [],
    extractBeatHits: () => [],
  },
};

export function getAntiPerkSequenceDefinition(id: AntiPerkSequenceId): AntiPerkSequenceDefinition {
  return ANTI_PERK_SEQUENCE_DEFINITIONS[id];
}
