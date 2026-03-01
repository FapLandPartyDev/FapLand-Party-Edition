import type { FunscriptAction } from "../game/media/playback";
import {
  extractBeatbarMotionEvents,
  getAntiPerkSequenceDefinition,
} from "../components/game/antiPerkSequences";
import { createGeneratedSequenceActions } from "../components/game/generatedSequenceMotion";

export const HAPTICS_TEST_SOURCE_ID = "settings-device-sync-test";
export const HAPTICS_TEST_PERIOD_MS = 12000;
export const HAPTICS_TEST_TICK_MS = 250;
export const HAPTICS_TEST_BEATBAR_STYLE = "jackhammer";

function createSeededRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

export const HAPTICS_TEST_ACTIONS: FunscriptAction[] = createGeneratedSequenceActions(
  HAPTICS_TEST_PERIOD_MS,
  HAPTICS_TEST_BEATBAR_STYLE,
  createSeededRng(0x51f7c0de)
);
export const HAPTICS_TEST_BEATBAR_EVENTS = extractBeatbarMotionEvents(HAPTICS_TEST_ACTIONS);
export const HAPTICS_TEST_BEAT_HITS = getAntiPerkSequenceDefinition(
  HAPTICS_TEST_BEATBAR_STYLE
).extractBeatHits(HAPTICS_TEST_ACTIONS);
