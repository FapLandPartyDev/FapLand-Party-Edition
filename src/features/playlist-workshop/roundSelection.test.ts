import { describe, expect, it } from "vitest";
import {
  buildDifficultySectionResult,
  buildProgressiveRoundOrder,
  fillRoundOrderRemainderRandomly,
  getProgressiveDifficultyBounds,
  randomizeRoundOrder,
} from "./roundSelection";

const round = (id: string, difficulty: number | null) => ({
  id,
  name: id,
  difficulty,
});

describe("randomizeRoundOrder", () => {
  it("never returns the same order when multiple entries exist", () => {
    expect(randomizeRoundOrder(["a", "b", "c"], () => 0)).not.toEqual(["a", "b", "c"]);
  });

  it("does not add entries from outside the supplied order", () => {
    expect(new Set(randomizeRoundOrder(["a", "b", "c"], () => 0.5))).toEqual(
      new Set(["a", "b", "c"])
    );
  });
});

describe("buildProgressiveRoundOrder", () => {
  it("moves its lower and upper bounds at the 25-round cutoffs", () => {
    expect(getProgressiveDifficultyBounds(0, 100)).toEqual({
      minDifficulty: 1,
      maxDifficulty: 2,
    });
    expect(getProgressiveDifficultyBounds(24, 100)).toEqual({
      minDifficulty: 1,
      maxDifficulty: 2,
    });
    expect(getProgressiveDifficultyBounds(25, 100)).toEqual({
      minDifficulty: 2,
      maxDifficulty: 3,
    });
    expect(getProgressiveDifficultyBounds(50, 100)).toEqual({
      minDifficulty: 3,
      maxDifficulty: 4,
    });
    expect(getProgressiveDifficultyBounds(75, 100)).toEqual({
      minDifficulty: 4,
      maxDifficulty: 5,
    });
    expect(getProgressiveDifficultyBounds(99, 100)).toEqual({
      minDifficulty: 4,
      maxDifficulty: 5,
    });
  });

  it("uses bounded quarter bands across a 100-round queue", () => {
    const input = Array.from({ length: 100 }, (_, index) =>
      round(`round-${index}`, (index % 5) + 1)
    );
    const result = buildProgressiveRoundOrder(input, () => 0.5);

    expect(result).toHaveLength(100);
    for (const [index, entry] of result.entries()) {
      const bounds = getProgressiveDifficultyBounds(index, result.length);
      expect(entry.difficulty).toBeGreaterThanOrEqual(bounds.minDifficulty);
      expect(entry.difficulty).toBeLessThanOrEqual(bounds.maxDifficulty);
    }
  });

  it("keeps unavoidable out-of-band difficulties as close as possible", () => {
    const result = buildProgressiveRoundOrder(
      Array.from({ length: 8 }, (_, index) => round(`easy-${index}`, 1)),
      () => 0
    );

    expect(result.map((entry) => entry.id)).toHaveLength(8);
    expect(new Set(result.map((entry) => entry.id)).size).toBe(8);
  });
});

describe("fillRoundOrderRemainderRandomly", () => {
  it("fills to the target with unique candidates", () => {
    const result = fillRoundOrderRemainderRandomly({
      roundIds: ["matched"],
      candidates: [round("matched", 1), round("extra-a", 5), round("extra-b", 3)],
      targetCount: 3,
      random: () => 0,
    });

    expect(result).toEqual(["matched", "extra-b", "extra-a"]);
    expect(new Set(result).size).toBe(3);
  });

  it("returns a partial fill when the candidate pool is still too small", () => {
    expect(
      fillRoundOrderRemainderRandomly({
        roundIds: ["matched"],
        candidates: [round("only-extra", 4)],
        targetCount: 4,
      })
    ).toEqual(["matched", "only-extra"]);
  });
});

describe("buildDifficultySectionResult", () => {
  it("uses exact queued matches without repeating or substituting", () => {
    const result = buildDifficultySectionResult({
      sections: [{ startIndex: 1, endIndex: 3, minDifficulty: 1, maxDifficulty: 1 }],
      queuedRounds: [round("easy", 1), round("hard", 5)],
      libraryRounds: [round("other-hard", 5)],
      playableCapacity: 3,
    });

    expect(result.roundIds).toEqual(["easy"]);
    expect(result.sections).toEqual([{ sectionIndex: 0, requested: 3, matched: 1, missing: 2 }]);
    expect(result.addedLibraryIds).toEqual([]);
    expect(result.removedQueueIds).toEqual(["hard"]);
  });

  it("adds only eligible filtered library candidates when enabled", () => {
    const result = buildDifficultySectionResult({
      sections: [{ startIndex: 1, endIndex: 2, minDifficulty: 2, maxDifficulty: 3 }],
      queuedRounds: [round("queued", 2)],
      libraryRounds: [round("filtered-in", 3), round("wrong-difficulty", 5)],
      allowLibraryFill: true,
      playableCapacity: 2,
    });

    expect(result.roundIds).toEqual(["queued", "filtered-in"]);
    expect(result.addedLibraryIds).toEqual(["filtered-in"]);
  });

  it("reports overlapping sections instead of building an ambiguous queue", () => {
    const result = buildDifficultySectionResult({
      sections: [
        { startIndex: 1, endIndex: 3, minDifficulty: 1, maxDifficulty: 2 },
        { startIndex: 3, endIndex: 4, minDifficulty: 3, maxDifficulty: 4 },
      ],
      queuedRounds: [],
      playableCapacity: 4,
    });

    expect(result.validationErrors).toContain("Section 2 overlaps another section.");
    expect(result.roundIds).toEqual([]);
  });

  it("reports uncovered queue positions", () => {
    const result = buildDifficultySectionResult({
      sections: [{ startIndex: 2, endIndex: 3, minDifficulty: 1, maxDifficulty: 5 }],
      queuedRounds: [],
      playableCapacity: 4,
    });

    expect(result.uncoveredPositions).toEqual([1, 4]);
  });
});
