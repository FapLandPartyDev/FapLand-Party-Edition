import { describe, expect, it } from "vitest";
import {
  ANTI_PERK_SEQUENCE_DEFINITIONS,
  extractBeatbarMotionEvents,
  getAntiPerkSequenceDefinition,
} from "./antiPerkSequences";

function createSeededRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("antiPerkSequences", () => {
  it("exposes stable definitions for built-in generated anti-perks", () => {
    expect(getAntiPerkSequenceDefinition("milker").label).toBe("MILKER SEQUENCE");
    expect(getAntiPerkSequenceDefinition("jackhammer").durationSec).toBe(15);
    expect(getAntiPerkSequenceDefinition("no-rest").supportsBeatbar).toBe(false);
  });

  it("extracts monotonic accent beats for beatbar-capable sequences", () => {
    for (const definition of Object.values(ANTI_PERK_SEQUENCE_DEFINITIONS)) {
      const durationMs = definition.durationSec * 1000;
      const actions = definition.createActions(durationMs, createSeededRng(9));
      const beatHits = definition.extractBeatHits(actions);

      if (!definition.supportsBeatbar) {
        expect(beatHits).toEqual([]);
        continue;
      }

      expect(beatHits.length).toBeGreaterThan(0);
      expect(beatHits.length).toBeLessThan(actions.length);
      expect(beatHits.every((hit) => hit.at >= 0 && hit.at <= durationMs)).toBe(true);
      expect(beatHits.every((hit, index) => index === 0 || hit.at >= beatHits[index - 1]!.at)).toBe(
        true
      );
      expect(beatHits.every((hit) => hit.strength >= 0.35 && hit.strength <= 1)).toBe(true);
    }
  });

  it("marks fast alternating micro-downmoves as vibration instead of downstrokes", () => {
    const events = extractBeatbarMotionEvents([
      { at: 0, pos: 50 },
      { at: 90, pos: 92 },
      { at: 126, pos: 86 },
      { at: 160, pos: 91 },
      { at: 196, pos: 84 },
      { at: 320, pos: 18 },
    ]);

    expect(events.filter((event) => event.kind === "vibration")).toHaveLength(2);
    expect(events.filter((event) => event.kind === "downstroke")).toHaveLength(1);
    expect(events[events.length - 1]).toMatchObject({
      kind: "downstroke",
      fromPos: 84,
      toPos: 18,
    });
  });
});
