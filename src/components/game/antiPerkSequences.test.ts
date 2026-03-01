import { describe, expect, it } from "vitest";
import {
  ANTI_PERK_SEQUENCE_DEFINITIONS,
  extractBeatbarMotionEvents,
  extractDescendingBeatbarBeats,
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

  it("creates one beat for every descending move in beatbar-capable sequences", () => {
    for (const definition of Object.values(ANTI_PERK_SEQUENCE_DEFINITIONS)) {
      const durationMs = definition.durationSec * 1000;
      const actions = definition.createActions(durationMs, createSeededRng(9));
      const beatbarBeats = definition.createBeatbarBeats(actions);

      if (!definition.supportsBeatbar) {
        expect(beatbarBeats).toEqual([]);
        continue;
      }

      expect(beatbarBeats.length).toBeGreaterThan(0);
      expect(beatbarBeats.length).toBeLessThan(actions.length);
      expect(beatbarBeats.every((beat) => beat.at >= 0 && beat.at <= durationMs)).toBe(true);
      expect(
        beatbarBeats.every((beat, index) => index === 0 || beat.at >= beatbarBeats[index - 1]!.at)
      ).toBe(true);
      expect(beatbarBeats.every((beat) => beat.strength >= 0.35 && beat.strength <= 1)).toBe(true);
      const descendingMoves = actions.slice(1).filter((action, index) => {
        const previous = actions[index]!;
        return action.pos < previous.pos;
      });
      expect(beatbarBeats).toHaveLength(descendingMoves.length);
      expect(beatbarBeats.map(({ at, lowPos }) => ({ at, lowPos }))).toEqual(
        descendingMoves.map(({ at, pos }) => ({ at, lowPos: pos }))
      );
    }
  });

  it("includes short, consecutive, and final descending moves", () => {
    const beats = extractDescendingBeatbarBeats([
      { at: 0, pos: 50 },
      { at: 90, pos: 92 },
      { at: 126, pos: 86 },
      { at: 160, pos: 91 },
      { at: 196, pos: 84 },
      { at: 320, pos: 18 },
      { at: 440, pos: 18 },
      { at: 520, pos: 12 },
    ]);

    expect(beats).toEqual([
      {
        at: 126,
        lowPos: 86,
        fromPos: 92,
        strength: 0.35,
      },
      {
        at: 196,
        lowPos: 84,
        fromPos: 91,
        strength: 0.35,
      },
      {
        at: 320,
        lowPos: 18,
        fromPos: 84,
        strength: 1,
      },
      {
        at: 520,
        lowPos: 12,
        fromPos: 18,
        strength: 0.35,
      },
    ]);
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
