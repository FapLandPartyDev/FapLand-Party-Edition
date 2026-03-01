import { describe, expect, it } from "vitest";
import { completeRound, createInitialGameState, reportPlayerCum } from "./engine";
import type { GameConfig, GameState } from "./types";

function makeConfig(): GameConfig {
  return {
    board: [
      { id: "start", name: "Start", kind: "start" },
      { id: "round-1", name: "Round 1", kind: "round", fixedRoundId: "round-1" },
    ],
    runtimeGraph: {
      startNodeId: "start",
      pathChoiceTimeoutMs: 6000,
      edges: [{ id: "e1", fromNodeId: "start", toNodeId: "round-1", gateCost: 0, weight: 1 }],
      edgesById: { e1: { id: "e1", fromNodeId: "start", toNodeId: "round-1", gateCost: 0, weight: 1 } },
      outgoingEdgeIdsByNodeId: { start: ["e1"] },
      randomRoundPoolsById: {},
      nodeIndexById: { start: 0, "round-1": 1 },
    },
    dice: { min: 1, max: 6 },
    perkSelection: {
      optionsPerPick: 3,
      triggerChancePerCompletedRound: 0,
    },
    perkPool: {
      enabledPerkIds: [],
      enabledAntiPerkIds: [],
    },
    probabilityScaling: {
      initialIntermediaryProbability: 0,
      initialAntiPerkProbability: 0,
      intermediaryIncreasePerRound: 0.02,
      antiPerkIncreasePerRound: 0.015,
      maxIntermediaryProbability: 0.85,
      maxAntiPerkProbability: 0.75,
    },
    singlePlayer: {
      totalIndices: 1,
      safePointIndices: [],
      normalRoundIdsByIndex: {},
      cumRoundIds: ["cum-1"],
    },
    economy: {
      startingMoney: 120,
      moneyPerCompletedRound: 50,
      startingScore: 0,
      scorePerCompletedRound: 100,
      scorePerIntermediary: 30,
      scorePerActiveAntiPerk: 25,
      scorePerCumRoundSuccess: 120,
    },
  };
}

function withActiveCumRound(state: GameState, score = 0): GameState {
  const player = state.players[state.currentPlayerIndex];
  if (!player) return state;

  return {
    ...state,
    sessionPhase: "cum",
    nextCumRoundIndex: 1,
    players: state.players.map((entry) => (
      entry.id === player.id ? { ...entry, score } : entry
    )),
    activeRound: {
      fieldId: "cum-1",
      nodeId: "cum-1",
      roundId: "cum-1",
      roundName: "Cum Round 1",
      selectionKind: "cum",
      poolId: null,
      phaseKind: "cum",
      campaignIndex: null,
    },
    queuedRound: null,
    pendingPathChoice: null,
    pendingPerkSelection: null,
  };
}

describe("engine cum flow", () => {
  it("self-reported cum ends the run immediately", () => {
    const initial = createInitialGameState(makeConfig());
    const next = reportPlayerCum(initial);

    expect(next.sessionPhase).toBe("completed");
    expect(next.completionReason).toBe("self_reported_cum");
    expect(next.activeRound).toBeNull();
    expect(next.queuedRound).toBeNull();
    expect(next.pendingPathChoice).toBeNull();
    expect(next.pendingPerkSelection).toBeNull();
  });

  it("awards cum bonus when cum round outcome is success", () => {
    const initial = withActiveCumRound(createInitialGameState(makeConfig()), 15);

    const cameAsTold = completeRound(initial, {
      intermediaryCount: 0,
      activeAntiPerkCount: 0,
      cumOutcome: "came_as_told",
    }, []);
    expect(cameAsTold.players[cameAsTold.currentPlayerIndex]?.score).toBe(135);
    expect(cameAsTold.sessionPhase).toBe("completed");
    expect(cameAsTold.completionReason).toBe("finished");

    const didNotCum = completeRound(initial, {
      intermediaryCount: 0,
      activeAntiPerkCount: 0,
      cumOutcome: "did_not_cum",
    }, []);
    expect(didNotCum.players[didNotCum.currentPlayerIndex]?.score).toBe(135);
    expect(didNotCum.sessionPhase).toBe("completed");
    expect(didNotCum.completionReason).toBe("finished");
  });

  it("fails the run when cum instruction is failed", () => {
    const initial = withActiveCumRound(createInitialGameState(makeConfig()), 40);
    const next = completeRound(initial, {
      intermediaryCount: 0,
      activeAntiPerkCount: 0,
      cumOutcome: "failed_instruction",
    }, []);

    expect(next.players[next.currentPlayerIndex]?.score).toBe(40);
    expect(next.sessionPhase).toBe("completed");
    expect(next.completionReason).toBe("cum_instruction_failed");
  });
});
