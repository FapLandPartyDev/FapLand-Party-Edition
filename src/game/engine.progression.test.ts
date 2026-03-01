import { describe, expect, it } from "vitest";
import { createInitialGameState } from "./engine";
import type { GameConfig } from "./types";

function makeConfig(): GameConfig {
  return {
    board: [{ id: "start", name: "Start", kind: "start" }],
    runtimeGraph: {
      startNodeId: "start",
      edges: [],
      edgesById: {},
      outgoingEdgeIdsByNodeId: {},
      nodeIndexById: { start: 0 },
    },
    dice: { min: 1, max: 6 },
    perkSelection: { optionsPerPick: 3, triggerChancePerCompletedRound: 0.35 },
    perkPool: { enabledPerkIds: ["loaded-dice"], enabledAntiPerkIds: [] },
    probabilityScaling: {
      initialIntermediaryProbability: 0.1,
      initialAntiPerkProbability: 0.1,
      intermediaryIncreasePerRound: 0.02,
      antiPerkIncreasePerRound: 0.015,
      maxIntermediaryProbability: 1,
      maxAntiPerkProbability: 0.75,
    },
    singlePlayer: {
      totalIndices: 1,
      safePointIndices: [],
      normalRoundIdsByIndex: {},
      cumRoundIds: [],
    },
    economy: {
      startingMoney: 120,
      moneyPerCompletedRound: 50,
      startingScore: 0,
      scorePerCompletedRound: 100,
      scorePerIntermediary: 30,
      scorePerActiveAntiPerk: 25,
      scorePerCumRoundSuccess: 420,
    },
    roundStartDelayMs: 20_000,
  };
}

describe("solo progression modifiers", () => {
  it("applies purchased modifiers to a fresh state", () => {
    const state = createInitialGameState(makeConfig(), {
      progressionModifiers: {
        starterPerkIds: ["loaded-dice"],
        startingPauseCharges: 2,
        startingSkipCharges: 1,
        pauseDurationMs: 5_000,
        diceMin: 1,
        diceMax: 2,
        startingMoney: 50,
        startingScore: 25,
        shieldRounds: 2,
      },
    });
    const player = state.players[0]!;
    expect(player.stats).toMatchObject({ diceMin: 2, diceMax: 8, roundPauseMs: 25_000 });
    expect(player.money).toBe(170);
    expect(player.score).toBe(25);
    expect(player.roundControl).toMatchObject({
      pauseCharges: 2,
      skipCharges: 1,
      pauseDurationMs: 20_000,
    });
    expect(player.shieldRoundsRemaining).toBe(2);
    expect(player.inventory[0]?.perkId).toBe("loaded-dice");
  });

  it("does not change games when modifiers are omitted", () => {
    const state = createInitialGameState(makeConfig());
    expect(state.players[0]?.roundControl).toMatchObject({
      pauseCharges: 0,
      skipCharges: 0,
    });
    expect(state.players[0]?.inventory).toEqual([]);
  });

  it("resolves a mystery starter to a real inventory perk", () => {
    const state = createInitialGameState(makeConfig(), {
      progressionModifiers: { starterPerkIds: ["__random__"] },
    });

    expect(state.players[0]?.inventory[0]?.perkId).toBe("loaded-dice");
  });
});
