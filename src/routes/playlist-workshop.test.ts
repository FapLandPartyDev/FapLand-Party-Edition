import { describe, expect, it } from "vitest";
import { pruneLinearSetupToRoundCount } from "./playlist-workshop";

describe("pruneLinearSetupToRoundCount", () => {
  it("deselects normal rounds whose assigned field exceeds the reduced round count", () => {
    const next = pruneLinearSetupToRoundCount(
      {
        roundCount: 10,
        safePointsEnabled: false,
        safePointIndices: [],
        normalRoundOrder: ["round-1", "round-2", "round-3", "round-4", "round-5", "round-6"],
        enabledCumRoundIds: [],
        enabledPerkIds: [],
        enabledAntiPerkIds: [],
        perkTriggerChancePerRound: 0,
        roundStartDelaySec: 0,
        startingMoney: 120,
        diceMin: 1,
        diceMax: 6,
        probabilities: {
          intermediary: { initial: 0, increasePerRound: 0, max: 0 },
          antiPerk: { initial: 0, increasePerRound: 0, max: 0 },
        },
        scorePerCumRoundSuccess: 0,
      },
      5
    );

    expect(next.roundCount).toBe(5);
    expect(next.normalRoundOrder).toEqual(["round-1", "round-2", "round-3", "round-4", "round-5"]);
  });

  it("drops safe points above the reduced max before pruning round placement", () => {
    const next = pruneLinearSetupToRoundCount(
      {
        roundCount: 10,
        safePointsEnabled: true,
        safePointIndices: [2, 8],
        normalRoundOrder: ["round-1", "round-2", "round-3", "round-4", "round-5"],
        enabledCumRoundIds: [],
        enabledPerkIds: [],
        enabledAntiPerkIds: [],
        perkTriggerChancePerRound: 0,
        roundStartDelaySec: 0,
        startingMoney: 120,
        diceMin: 1,
        diceMax: 6,
        probabilities: {
          intermediary: { initial: 0, increasePerRound: 0, max: 0 },
          antiPerk: { initial: 0, increasePerRound: 0, max: 0 },
        },
        scorePerCumRoundSuccess: 0,
      },
      5
    );

    expect(next.safePointIndices).toEqual([2]);
    expect(next.normalRoundOrder).toEqual(["round-1", "round-2", "round-3", "round-4"]);
  });
});
