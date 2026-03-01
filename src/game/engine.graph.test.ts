import { afterEach, describe, expect, it, vi } from "vitest";
import {
  completeRound,
  createInitialGameState,
  resolvePathChoiceTimeout,
  rollTurn,
  selectPathEdge,
  triggerQueuedRound,
} from "./engine";
import type { GameConfig } from "./types";
import type { InstalledRound } from "../services/db";

function makeRound(id: string, name = id, type: InstalledRound["type"] = "Normal"): InstalledRound {
  const now = new Date("2026-01-01T00:00:00.000Z");
  return {
    id,
    name,
    author: "Author",
    description: null,
    bpm: null,
    difficulty: null,
    phash: null,
    startTime: null,
    endTime: null,
    installSourceKey: null,
    previewImage: null,
    type,
    heroId: null,
    createdAt: now,
    updatedAt: now,
    hero: null,
    resources: [],
  };
}

function makeGraphConfig(input: {
  board: GameConfig["board"];
  edges: GameConfig["runtimeGraph"]["edges"];
  startNodeId?: string;
  randomPoolsById?: GameConfig["runtimeGraph"]["randomRoundPoolsById"];
}): GameConfig {
  const startNodeId = input.startNodeId ?? "start";
  const nodeIndexById = input.board.reduce<Record<string, number>>((acc, node, index) => {
    acc[node.id] = index;
    return acc;
  }, {});
  const edgesById = input.edges.reduce<Record<string, GameConfig["runtimeGraph"]["edges"][number]>>((acc, edge) => {
    acc[edge.id] = edge;
    return acc;
  }, {});
  const outgoingEdgeIdsByNodeId = input.edges.reduce<Record<string, string[]>>((acc, edge) => {
    const outgoing = acc[edge.fromNodeId];
    if (outgoing) {
      outgoing.push(edge.id);
    } else {
      acc[edge.fromNodeId] = [edge.id];
    }
    return acc;
  }, {});

  return {
    board: input.board,
    runtimeGraph: {
      startNodeId,
      pathChoiceTimeoutMs: 6000,
      edges: input.edges,
      edgesById,
      outgoingEdgeIdsByNodeId,
      randomRoundPoolsById: input.randomPoolsById ?? {},
      nodeIndexById,
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
      totalIndices: Math.max(1, input.board.length - 1),
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
      scorePerCumRoundSuccess: 120,
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("graph engine runtime", () => {
  it("pauses on fork choice and resumes after manual edge selection", () => {
    const config = makeGraphConfig({
      board: [
        { id: "start", name: "Start", kind: "start" },
        { id: "left", name: "Left", kind: "path" },
        { id: "right", name: "Right", kind: "path" },
      ],
      edges: [
        { id: "e-left", fromNodeId: "start", toNodeId: "left", gateCost: 0, weight: 1 },
        { id: "e-right", fromNodeId: "start", toNodeId: "right", gateCost: 0, weight: 1 },
      ],
    });
    const rounds = [makeRound("r1")];
    const before = createInitialGameState(config);

    const paused = rollTurn(before, rounds, 1);
    expect(paused.pendingPathChoice).not.toBeNull();
    expect(paused.players[0]?.currentNodeId).toBe("start");

    const selected = selectPathEdge(paused, "e-right", rounds);
    expect(selected.pendingPathChoice).toBeNull();
    expect(selected.players[0]?.currentNodeId).toBe("right");
  });

  it("auto-selects fork edge on timeout with edge weights", () => {
    const config = makeGraphConfig({
      board: [
        { id: "start", name: "Start", kind: "start" },
        { id: "heavy", name: "Heavy", kind: "path" },
        { id: "light", name: "Light", kind: "path" },
      ],
      edges: [
        { id: "e-heavy", fromNodeId: "start", toNodeId: "heavy", gateCost: 0, weight: 9 },
        { id: "e-light", fromNodeId: "start", toNodeId: "light", gateCost: 0, weight: 1 },
      ],
    });
    const rounds = [makeRound("r1")];
    const paused = rollTurn(createInitialGameState(config), rounds, 1);
    expect(paused.pendingPathChoice).not.toBeNull();

    vi.spyOn(Math, "random").mockReturnValue(0);
    const resolved = resolvePathChoiceTimeout(paused, rounds);
    expect(resolved.players[0]?.currentNodeId).toBe("heavy");
    expect(resolved.pendingPathChoice).toBeNull();
  });

  it("blocks gated edges when funds are insufficient and deducts on successful pass", () => {
    const blockedConfig = makeGraphConfig({
      board: [
        { id: "start", name: "Start", kind: "start" },
        { id: "paid", name: "Paid", kind: "path" },
        { id: "free", name: "Free", kind: "path" },
      ],
      edges: [
        { id: "e-paid", fromNodeId: "start", toNodeId: "paid", gateCost: 200, weight: 1 },
        { id: "e-free", fromNodeId: "start", toNodeId: "free", gateCost: 0, weight: 1 },
      ],
    });
    const rounds = [makeRound("r1")];
    const blockedState = rollTurn(createInitialGameState(blockedConfig), rounds, 1);
    expect(blockedState.players[0]?.currentNodeId).toBe("free");
    expect(blockedState.players[0]?.money).toBe(120);

    const paidConfig = makeGraphConfig({
      board: [
        { id: "start", name: "Start", kind: "start" },
        { id: "paid", name: "Paid", kind: "path" },
      ],
      edges: [{ id: "e-paid", fromNodeId: "start", toNodeId: "paid", gateCost: 20, weight: 1 }],
    });
    const paidState = rollTurn(createInitialGameState(paidConfig), rounds, 1);
    expect(paidState.players[0]?.currentNodeId).toBe("paid");
    expect(paidState.players[0]?.money).toBe(100);
  });

  it("stops immediately at first safe point and grants a bonus roll", () => {
    const config = makeGraphConfig({
      board: [
        { id: "start", name: "Start", kind: "start" },
        { id: "safe", name: "Safe", kind: "safePoint" },
        { id: "after", name: "After", kind: "path" },
      ],
      edges: [
        { id: "e1", fromNodeId: "start", toNodeId: "safe", gateCost: 0, weight: 1 },
        { id: "e2", fromNodeId: "safe", toNodeId: "after", gateCost: 0, weight: 1 },
      ],
    });
    const state = rollTurn(createInitialGameState(config), [makeRound("r1")], 2);
    expect(state.players[0]?.currentNodeId).toBe("safe");
    expect(state.bonusRolls).toBe(1);
  });

  it("interrupts traversal when entering a forced-stop round", () => {
    const config = makeGraphConfig({
      board: [
        { id: "start", name: "Start", kind: "start" },
        { id: "round-1", name: "Round 1", kind: "round", fixedRoundId: "round-1", forceStop: true },
        { id: "after", name: "After", kind: "path" },
      ],
      edges: [
        { id: "e1", fromNodeId: "start", toNodeId: "round-1", gateCost: 0, weight: 1 },
        { id: "e2", fromNodeId: "round-1", toNodeId: "after", gateCost: 0, weight: 1 },
      ],
    });

    const state = rollTurn(createInitialGameState(config), [makeRound("round-1")], 2);
    expect(state.players[0]?.currentNodeId).toBe("round-1");
    expect(state.queuedRound?.roundId).toBe("round-1");
    expect(state.bonusRolls).toBe(0);
  });

  it("passes over normal round nodes when force stop is disabled", () => {
    const config = makeGraphConfig({
      board: [
        { id: "start", name: "Start", kind: "start" },
        { id: "round-1", name: "Round 1", kind: "round", fixedRoundId: "round-1", forceStop: false },
        { id: "after", name: "After", kind: "path" },
      ],
      edges: [
        { id: "e1", fromNodeId: "start", toNodeId: "round-1", gateCost: 0, weight: 1 },
        { id: "e2", fromNodeId: "round-1", toNodeId: "after", gateCost: 0, weight: 1 },
      ],
    });

    const state = rollTurn(createInitialGameState(config), [makeRound("round-1")], 2);
    expect(state.players[0]?.currentNodeId).toBe("after");
    expect(state.queuedRound).toBeNull();
  });

  it("prefers unplayed random pool rounds and falls back to full pool when exhausted", () => {
    const config = makeGraphConfig({
      board: [
        { id: "start", name: "Start", kind: "start" },
        { id: "rng", name: "Random", kind: "randomRound", randomPoolId: "pool-a" },
      ],
      edges: [{ id: "e1", fromNodeId: "start", toNodeId: "rng", gateCost: 0, weight: 1 }],
      randomPoolsById: {
        "pool-a": {
          id: "pool-a",
          candidates: [
            { roundId: "round-1", weight: 1 },
            { roundId: "round-2", weight: 1 },
          ],
        },
      },
    });
    const rounds = [makeRound("round-1"), makeRound("round-2")];

    const withHistory = createInitialGameState(config, {
      playedRoundIdsByPool: { "pool-a": ["round-1"] },
    });
    const first = rollTurn(withHistory, rounds, 1);
    expect(first.queuedRound?.roundId).toBe("round-2");

    const exhausted = createInitialGameState(config, {
      playedRoundIdsByPool: { "pool-a": ["round-1", "round-2"] },
    });
    vi.spyOn(Math, "random").mockReturnValue(0);
    const second = rollTurn(exhausted, rounds, 1);
    expect(second.queuedRound?.roundId).toBe("round-1");
  });

  it("supports loops without crashing", () => {
    const config = makeGraphConfig({
      board: [
        { id: "start", name: "Start", kind: "start" },
        { id: "loop-a", name: "Loop A", kind: "path" },
        { id: "loop-b", name: "Loop B", kind: "path" },
      ],
      edges: [
        { id: "e1", fromNodeId: "start", toNodeId: "loop-a", gateCost: 0, weight: 1 },
        { id: "e2", fromNodeId: "loop-a", toNodeId: "loop-b", gateCost: 0, weight: 1 },
        { id: "e3", fromNodeId: "loop-b", toNodeId: "loop-a", gateCost: 0, weight: 1 },
      ],
    });
    const state = rollTurn(createInitialGameState(config), [makeRound("r1")], 3);
    expect(state.players[0]?.currentNodeId).toBe("loop-a");
    expect(state.pendingPathChoice).toBeNull();
  });

  it("starts cum phase immediately when landing on an end node", () => {
    const config = makeGraphConfig({
      board: [
        { id: "start", name: "Start", kind: "start" },
        { id: "end", name: "End", kind: "end" },
      ],
      edges: [{ id: "e1", fromNodeId: "start", toNodeId: "end", gateCost: 0, weight: 1 }],
    });
    config.singlePlayer.cumRoundIds = ["cum-1"];

    const rounds = [makeRound("cum-1", "Cum 1", "Cum")];

    const state = rollTurn(createInitialGameState(config), rounds, 1);
    expect(state.players[0]?.currentNodeId).toBe("end");
    expect(state.sessionPhase).toBe("cum");
    expect(state.queuedRound?.roundId).toBe("cum-1");
  });

  it("finishes immediately when landing on an end node without cum rounds", () => {
    const config = makeGraphConfig({
      board: [
        { id: "start", name: "Start", kind: "start" },
        { id: "end", name: "End", kind: "end" },
      ],
      edges: [{ id: "e1", fromNodeId: "start", toNodeId: "end", gateCost: 0, weight: 1 }],
    });

    const state = rollTurn(createInitialGameState(config), [makeRound("r1")], 1);
    expect(state.players[0]?.currentNodeId).toBe("end");
    expect(state.sessionPhase).toBe("completed");
    expect(state.completionReason).toBe("finished");
  });

  it("interrupts traversal on a forced-stop round reached through path choice", () => {
    const rounds = [makeRound("round-1")];
    const config = makeGraphConfig({
      board: [
        { id: "start", name: "Start", kind: "start" },
        { id: "fork-left", name: "Fork Left", kind: "path" },
        { id: "fork-right", name: "Fork Right", kind: "path" },
        { id: "round-1", name: "Round 1", kind: "round", fixedRoundId: "round-1", forceStop: true },
        { id: "after", name: "After", kind: "path" },
      ],
      edges: [
        { id: "e-left", fromNodeId: "start", toNodeId: "fork-left", gateCost: 0, weight: 1 },
        { id: "e-right", fromNodeId: "start", toNodeId: "fork-right", gateCost: 0, weight: 1 },
        { id: "e-round", fromNodeId: "fork-right", toNodeId: "round-1", gateCost: 0, weight: 1 },
        { id: "e-after", fromNodeId: "round-1", toNodeId: "after", gateCost: 0, weight: 1 },
      ],
    });

    const paused = rollTurn(createInitialGameState(config), rounds, 2);
    expect(paused.pendingPathChoice).not.toBeNull();

    const selected = selectPathEdge(paused, "e-right", rounds);
    expect(selected.players[0]?.currentNodeId).toBe("round-1");
    expect(selected.queuedRound?.roundId).toBe("round-1");
    expect(selected.bonusRolls).toBe(0);
  });

  it("does not rely on graph dead ends after completing a round when explicit end nodes exist", () => {
    const config = makeGraphConfig({
      board: [
        { id: "start", name: "Start", kind: "start" },
        { id: "round-1", name: "Round 1", kind: "round", fixedRoundId: "round-1" },
        { id: "end", name: "End", kind: "end" },
      ],
      edges: [
        { id: "e1", fromNodeId: "start", toNodeId: "round-1", gateCost: 0, weight: 1 },
        { id: "e2", fromNodeId: "round-1", toNodeId: "end", gateCost: 0, weight: 1 },
      ],
    });
    config.singlePlayer.cumRoundIds = ["cum-1"];

    const rounds = [makeRound("round-1", "Round 1"), makeRound("cum-1", "Cum 1", "Cum")];
    const rolled = rollTurn(createInitialGameState(config), rounds, 1);
    const started = triggerQueuedRound(rolled);
    const completed = completeRound(started, { intermediaryCount: 0, activeAntiPerkCount: 0 }, rounds);

    expect(completed.sessionPhase).toBe("normal");
    expect(completed.queuedRound).toBeNull();
    expect(completed.activeRound).toBeNull();
  });
});
