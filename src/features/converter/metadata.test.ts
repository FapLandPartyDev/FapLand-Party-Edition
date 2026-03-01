import { describe, expect, it } from "vitest";
import {
  applyAutoMetadataToSegments,
  computeAutoMetadataForSegment,
  estimateBpmFromActions,
  estimateDifficultyFromActions,
} from "./metadata";

describe("converter metadata", () => {
  it("estimates bpm from reversals", () => {
    const actions = [
      { at: 0, pos: 0 },
      { at: 500, pos: 100 },
      { at: 1000, pos: 0 },
      { at: 1500, pos: 100 },
      { at: 2000, pos: 0 },
    ];

    const bpm = estimateBpmFromActions(actions, 2);
    expect(bpm).toBe(45);
  });

  it("returns null bpm on insufficient action data", () => {
    expect(estimateBpmFromActions([{ at: 0, pos: 10 }, { at: 1000, pos: 20 }], 2)).toBeNull();
  });

  it("computes difficulty on 1-5 scale", () => {
    const actions = [
      { at: 0, pos: 0 },
      { at: 200, pos: 100 },
      { at: 400, pos: 0 },
      { at: 600, pos: 100 },
      { at: 800, pos: 0 },
      { at: 1000, pos: 100 },
    ];

    const difficulty = estimateDifficultyFromActions(actions, 1.2);
    expect(difficulty).toBeGreaterThanOrEqual(1);
    expect(difficulty).toBeLessThanOrEqual(5);
  });

  it("returns null difficulty on insufficient velocity samples", () => {
    expect(estimateDifficultyFromActions([{ at: 0, pos: 30 }], 1)).toBeNull();
  });

  it("clamps bpm to allowed bounds", () => {
    const fastActions = Array.from({ length: 120 }, (_, index) => ({
      at: index * 10,
      pos: index % 2 === 0 ? 0 : 100,
    }));

    expect(estimateBpmFromActions(fastActions, 1)).toBe(400);
  });

  it("computes segment auto metadata in window", () => {
    const actions = [
      { at: 0, pos: 0 },
      { at: 500, pos: 100 },
      { at: 1000, pos: 0 },
      { at: 1500, pos: 100 },
      { at: 2000, pos: 0 },
      { at: 3000, pos: 0 },
    ];

    const auto = computeAutoMetadataForSegment(actions, { startTimeMs: 0, endTimeMs: 2000 });
    expect(auto.bpm).toBe(45);
    expect(auto.difficulty).toBeTypeOf("number");
  });

  it("keeps manual overrides while recomputing non-overridden values", () => {
    const segments = [
      {
        id: "a",
        startTimeMs: 0,
        endTimeMs: 2000,
        bpm: null,
        difficulty: null,
        bpmOverride: false,
        difficultyOverride: false,
      },
      {
        id: "b",
        startTimeMs: 0,
        endTimeMs: 2000,
        bpm: 123,
        difficulty: 5,
        bpmOverride: true,
        difficultyOverride: true,
      },
    ];

    const actions = [
      { at: 0, pos: 0 },
      { at: 500, pos: 100 },
      { at: 1000, pos: 0 },
      { at: 1500, pos: 100 },
      { at: 2000, pos: 0 },
    ];

    const updated = applyAutoMetadataToSegments(segments, actions);

    expect(updated[0]?.bpm).toBe(45);
    expect(updated[0]?.difficulty).toBeTypeOf("number");
    expect(updated[1]?.bpm).toBe(123);
    expect(updated[1]?.difficulty).toBe(5);
  });
});
