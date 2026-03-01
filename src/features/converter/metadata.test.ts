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
    expect(
      estimateBpmFromActions(
        [
          { at: 0, pos: 10 },
          { at: 1000, pos: 20 },
        ],
        2
      )
    ).toBeNull();
  });

  it("computes difficulty on 1-5 scale with calibration points", () => {
    const easyActions = [
      { at: 0, pos: 0 },
      { at: 200, pos: 50 },
      { at: 400, pos: 0 },
      { at: 600, pos: 50 },
      { at: 800, pos: 0 },
    ];
    expect(estimateDifficultyFromActions(easyActions, 8)).toBe(1);

    // A sustained five-minute script with about 800 beat hits rates highly.
    const mediumActions = Array.from({ length: 1_601 }, (_, index) => ({
      at: Math.round(index * 187.5),
      pos: index % 2 === 0 ? 0 : 70,
    }));
    expect(estimateDifficultyFromActions(mediumActions, 300)).toBe(4);

    // One thousand or more beat hits over five minutes reaches level 5.
    const extremeActions = Array.from({ length: 2_001 }, (_, index) => ({
      at: index * 150,
      pos: index % 2 === 0 ? 0 : 100,
    }));
    expect(estimateDifficultyFromActions(extremeActions, 300)).toBe(5);
  });

  it("returns null difficulty on insufficient beat-hit data", () => {
    expect(estimateDifficultyFromActions([{ at: 0, pos: 30 }], 1)).toBeNull();
  });

  it("does not let movement velocity affect difficulty", () => {
    const smallMovements = Array.from({ length: 1_000 }, (_, index) => ({
      at: index * 100,
      pos: index % 2 === 0 ? 49 : 51,
    }));
    const largeMovements = smallMovements.map((action, index) => ({
      ...action,
      pos: index % 2 === 0 ? 0 : 100,
    }));

    expect(estimateDifficultyFromActions(smallMovements, 180)).toBe(
      estimateDifficultyFromActions(largeMovements, 180)
    );
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
