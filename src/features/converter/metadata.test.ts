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
    // Approx filename 1 (Easy): 244 velocity, ~9 point rate, 120s
    // score = 0.85 * vNorm(244) + 0.1 * pNorm(9) + 0.05 * lNorm(0.66)
    // vNorm(244) = (5.5 - 5.44) / (7.38 - 5.44) = 0.03
    // pNorm(9) = (2.3 - 1.1) / (3.7 - 1.1) = 0.46
    // lNorm(0.66) = 0.22
    // score = 0.85 * 0.03 + 0.1 * 0.46 + 0.05 * 0.22 = 0.025 + 0.046 + 0.011 = 0.082
    // round(1 + 0.082 * 4) = round(1.33) = 1 star
    const easyActions = [
      { at: 0, pos: 0 },
      { at: 200, pos: 50 }, // velocity = 250
      { at: 400, pos: 0 },
      { at: 600, pos: 50 },
      { at: 800, pos: 0 },
    ];
    expect(estimateDifficultyFromActions(easyActions, 8)).toBe(1);

    // Approx filename 47 (Medium): 691 velocity, ~6 point rate, 300s
    // vNorm(691) = (6.54 - 5.44) / 1.94 = 0.56
    // pNorm(6) = (1.95 - 1.1) / 2.6 = 0.32
    // score = 0.85 * 0.56 + 0.1 * 0.32 + 0.05 * 1.0 = 0.476 + 0.032 + 0.05 = 0.558
    // round(1 + 0.558 * 4) = round(3.23) = 3 stars
    const mediumActions = [
      { at: 0, pos: 0 },
      { at: 100, pos: 70 }, // velocity = 700
      { at: 200, pos: 0 },
      { at: 300, pos: 70 },
      { at: 400, pos: 0 },
    ];
    expect(estimateDifficultyFromActions(mediumActions, 300)).toBe(3);

    // Extreme (filename 100): 1600+ velocity
    // vNorm(1600) = 1.0
    // score = 0.85 * 1.0 + ... = >0.85
    // round(1 + 0.85 * 4) = round(4.4) = 4 or 5 stars
    const extremeActions = [
      { at: 0, pos: 0 },
      { at: 50, pos: 80 }, // velocity = 1600
      { at: 100, pos: 0 },
      { at: 150, pos: 80 },
      { at: 200, pos: 0 },
    ];
    expect(estimateDifficultyFromActions(extremeActions, 300)).toBeGreaterThanOrEqual(4);
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
