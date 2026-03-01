import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { createInitialGameState } from "./engine";
import { getSinglePlayerPerkPool } from "./data/perks";
import type { GameConfig, GameState } from "./types";
import {
  CUM_ROUND_COUNTDOWN_DURATION,
  NORMAL_ROUND_COUNTDOWN_DURATION,
  resolveRoundCountdownDuration,
  useGameAnimation,
} from "./useGameAnimation";

vi.mock("../utils/audio", () => ({
  playDiceResultSound: vi.fn(),
  playDiceRollStartSound: vi.fn(),
  playGatePassSound: vi.fn(),
  playPerkActionSound: vi.fn(),
  playRoundStartSound: vi.fn(),
  playTokenLandingSound: vi.fn(),
  playTokenStepSound: vi.fn(),
}));

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
      maxIntermediaryProbability: 1,
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
      scorePerCumRoundSuccess: 420,
    },
    roundStartDelayMs: 20_000,
  };
}

function withQueuedRound(state: GameState, phaseKind: "normal" | "cum"): GameState {
  return {
    ...state,
    queuedRound: {
      fieldId: "round-1",
      nodeId: "round-1",
      roundId: phaseKind === "cum" ? "cum-1" : "round-1",
      roundName: phaseKind === "cum" ? "Finale" : "Round 1",
      selectionKind: phaseKind === "cum" ? "cum" : "fixed",
      poolId: null,
      phaseKind,
      campaignIndex: phaseKind === "cum" ? null : 0,
    },
  };
}

function makePerkConfig(): GameConfig {
  return {
    ...makeConfig(),
    board: [
      { id: "start", name: "Start", kind: "start" },
      { id: "perk-1", name: "Perk 1", kind: "perk" },
    ],
    runtimeGraph: {
      startNodeId: "start",
      pathChoiceTimeoutMs: 6000,
      edges: [{ id: "e1", fromNodeId: "start", toNodeId: "perk-1", gateCost: 0, weight: 1 }],
      edgesById: {
        e1: { id: "e1", fromNodeId: "start", toNodeId: "perk-1", gateCost: 0, weight: 1 },
      },
      outgoingEdgeIdsByNodeId: { start: ["e1"] },
      randomRoundPoolsById: {},
      nodeIndexById: { start: 0, "perk-1": 1 },
    },
    dice: { min: 1, max: 1 },
    perkSelection: {
      optionsPerPick: 1,
      triggerChancePerCompletedRound: 0,
    },
    perkPool: {
      enabledPerkIds: [getSinglePlayerPerkPool()[0]?.id ?? "loaded-dice"],
      enabledAntiPerkIds: [],
    },
    roundStartDelayMs: 1000,
  };
}

describe("useGameAnimation", () => {
  it("resolves countdown duration by round type", () => {
    expect(resolveRoundCountdownDuration(null)).toBe(NORMAL_ROUND_COUNTDOWN_DURATION);
    expect(resolveRoundCountdownDuration(withQueuedRound(createInitialGameState(makeConfig()), "normal").queuedRound))
      .toBe(NORMAL_ROUND_COUNTDOWN_DURATION);
    expect(resolveRoundCountdownDuration(withQueuedRound(createInitialGameState(makeConfig()), "cum").queuedRound))
      .toBe(CUM_ROUND_COUNTDOWN_DURATION);
  });

  it("completes cum round countdown using the phase duration", () => {
    const initialState = withQueuedRound(createInitialGameState(makeConfig()), "cum");
    const { result } = renderHook(() => useGameAnimation(initialState, []));

    act(() => {
      result.current.handleStartQueuedRound();
    });

    expect(result.current.animPhase.kind).toBe("roundCountdown");
    if (result.current.animPhase.kind !== "roundCountdown") {
      throw new Error("Expected round countdown phase.");
    }
    expect(result.current.animPhase.duration).toBe(CUM_ROUND_COUNTDOWN_DURATION);
    expect(result.current.state.activeRound).toBeNull();

    act(() => {
      result.current.tickAnim(3);
    });

    expect(result.current.animPhase.kind).toBe("roundCountdown");
    if (result.current.animPhase.kind !== "roundCountdown") {
      throw new Error("Expected round countdown phase after partial tick.");
    }
    expect(result.current.animPhase.remaining).toBeCloseTo(1, 5);
    expect(result.current.state.activeRound).toBeNull();

    act(() => {
      result.current.tickAnim(1);
    });

    expect(result.current.animPhase.kind).toBe("idle");
    expect(result.current.state.activeRound?.phaseKind).toBe("cum");
    expect(result.current.state.activeRound?.roundName).toBe("Finale");
    expect(result.current.state.queuedRound).toBeNull();
  });

  it("does not auto-skip or replace a pending perk selection during perk reveal", () => {
    const initialState = createInitialGameState(makePerkConfig());
    const { result } = renderHook(() => useGameAnimation(initialState, []));

    act(() => {
      result.current.handleRoll();
    });

    act(() => {
      result.current.tickAnim(2);
    });

    act(() => {
      result.current.tickAnim(1);
    });

    act(() => {
      result.current.tickAnim(1);
    });

    expect(result.current.animPhase.kind).toBe("perkReveal");
    expect(result.current.state.pendingPerkSelection).not.toBeNull();
    const initialOptions = result.current.state.pendingPerkSelection?.options.map((option) => option.id);

    act(() => {
      result.current.tickAnim(2);
    });

    expect(result.current.state.pendingPerkSelection).not.toBeNull();
    expect(result.current.state.pendingPerkSelection?.options.map((option) => option.id)).toEqual(
      initialOptions
    );
    expect(result.current.state.turn).toBe(1);
    expect(result.current.state.lastRoll).toBe(1);
  });
});
