import { describe, expect, it } from "vitest";
import {
  buildDifficultySectionRoundOrder,
  ensureLinearSetupCapacity,
  getRequiredLinearRoundCount,
  sortSelectedRoundsByDifficulty,
} from "./playlist-workshop";

function makeSetup(
  overrides: Partial<Parameters<typeof ensureLinearSetupCapacity>[0]> = {}
): Parameters<typeof ensureLinearSetupCapacity>[0] {
  return {
    roundCount: 10,
    safePointsEnabled: false,
    safePointIndices: [],
    difficultySections: [],
    shuffleDifficultySectionRounds: false,
    saveMode: "none",
    normalRoundOrder: [],
    enabledCumRoundIds: [],
    enabledPerkIds: [],
    enabledAntiPerkIds: [],
    perkTriggerChancePerRound: 0,
    intermediaryMinPerTriggeredRound: 1,
    intermediaryMaxPerTriggeredRound: 1,
    roundStartDelaySec: 0,
    disableDiceAnimation: false,
    disableInterjectionsDuringCumRounds: true,
    allowPausingDuringFinalCumRound: false,
    startingMoney: 120,
    probabilities: {
      intermediary: { initial: 0, increasePerRound: 0, max: 0 },
      antiPerk: { initial: 0, increasePerRound: 0, max: 0 },
    },
    resetIntermediaryProbabilityAfterTrigger: false,
    resetAntiPerkProbabilityAfterTrigger: false,
    scorePerCumRoundSuccess: 0,
    diceMin: 1,
    diceMax: 6,
    ...overrides,
  };
}

function makeRound(
  id: string,
  name: string,
  difficulty: number | null
): Parameters<typeof sortSelectedRoundsByDifficulty>[0][number] {
  return {
    id,
    heroId: null,
    name,
    author: "Author",
    description: null,
    bpm: null,
    type: "Normal",
    difficulty,
    phash: null,
    previewImage: null,
    startTime: 0,
    endTime: 180000,
    cutRangesJson: null,
    tagsJson: "[]",
    installSourceKey: null,
    libraryLabel: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    hero: null,
    tags: [],
    resources: [],
    excludeFromRandom: false,
    isDisabled: false,
  };
}

describe("getRequiredLinearRoundCount", () => {
  it("matches selected count when safe points are disabled", () => {
    expect(getRequiredLinearRoundCount(4, [2, 5], false)).toBe(4);
  });

  it("accounts for blocked safe-point indices when safe points are enabled", () => {
    expect(getRequiredLinearRoundCount(4, [2, 5], true)).toBe(6);
  });
});

describe("ensureLinearSetupCapacity", () => {
  it("increases round count to fit the selected queue", () => {
    const next = ensureLinearSetupCapacity(
      makeSetup({
        roundCount: 2,
        safePointsEnabled: true,
        safePointIndices: [2],
        normalRoundOrder: ["round-1", "round-2"],
      })
    );

    expect(next.roundCount).toBe(3);
    expect(next.normalRoundOrder).toEqual(["round-1", "round-2"]);
  });

  it("never decreases an already large enough round count", () => {
    const next = ensureLinearSetupCapacity(
      makeSetup({
        roundCount: 12,
        safePointsEnabled: true,
        safePointIndices: [2, 8],
        normalRoundOrder: ["round-1", "round-2", "round-3"],
      })
    );

    expect(next.roundCount).toBe(12);
    expect(next.safePointIndices).toEqual([2, 8]);
  });
});

describe("sortSelectedRoundsByDifficulty", () => {
  it("orders unknown difficulty first and preserves relative order for equal name+difficulty", () => {
    const secondSame = makeRound("round-2", "Same", 2);
    const firstSame = makeRound("round-1", "Same", 2);

    const sorted = sortSelectedRoundsByDifficulty([
      makeRound("hard", "Hard", 5),
      secondSame,
      makeRound("unknown", "Mystery", null),
      makeRound("easy", "Easy", 1),
      firstSame,
    ]);

    expect(sorted.map((round) => round.id)).toEqual([
      "unknown",
      "easy",
      "round-2",
      "round-1",
      "hard",
    ]);
  });
});

describe("buildDifficultySectionRoundOrder", () => {
  it("avoids duplicates until the matching pool is exhausted", () => {
    const order = buildDifficultySectionRoundOrder({
      sections: [{ startIndex: 1, endIndex: 3, minDifficulty: 1, maxDifficulty: 1 }],
      rounds: [makeRound("easy-a", "Easy A", 1), makeRound("easy-b", "Easy B", 1)],
    });

    expect(order).toEqual(["easy-a", "easy-b", "easy-a"]);
  });

  it("falls back to the nearest difficulty when a section has no exact match", () => {
    const order = buildDifficultySectionRoundOrder({
      sections: [{ startIndex: 1, endIndex: 1, minDifficulty: 5, maxDifficulty: 5 }],
      rounds: [makeRound("medium", "Medium", 3), makeRound("easy", "Easy", 1)],
    });

    expect(order).toEqual(["medium"]);
  });

  it("shuffles equally eligible rounds when requested", () => {
    const randomValues = [0.9, 0.1, 0.8, 0.2];
    const order = buildDifficultySectionRoundOrder({
      sections: [{ startIndex: 1, endIndex: 2, minDifficulty: 1, maxDifficulty: 1 }],
      rounds: [makeRound("easy-a", "Easy A", 1), makeRound("easy-b", "Easy B", 1)],
      shuffle: true,
      random: () => randomValues.shift() ?? 0,
    });

    expect(order).toEqual(["easy-b", "easy-a"]);
  });

  it("guarantees a different legal order on repeated shuffled rebuilds", () => {
    const previousOrder = ["easy-a", "easy-b", "hard-a", "hard-b"];
    const order = buildDifficultySectionRoundOrder({
      sections: [
        { startIndex: 1, endIndex: 2, minDifficulty: 1, maxDifficulty: 1 },
        { startIndex: 3, endIndex: 4, minDifficulty: 5, maxDifficulty: 5 },
      ],
      rounds: [
        makeRound("easy-a", "Easy A", 1),
        makeRound("easy-b", "Easy B", 1),
        makeRound("hard-a", "Hard A", 5),
        makeRound("hard-b", "Hard B", 5),
      ],
      shuffle: true,
      previousOrder,
      random: () => 0,
    });

    expect(order).not.toEqual(previousOrder);
    expect(new Set(order.slice(0, 2))).toEqual(new Set(["easy-a", "easy-b"]));
    expect(new Set(order.slice(2, 4))).toEqual(new Set(["hard-a", "hard-b"]));
  });
});
