import { describe, expect, it } from "vitest";
import { MULTIPLAYER_MINIMUM_ROUNDS } from "../constants/experimentalFeatures";
import type { PlaylistConfig } from "./playlistSchema";
import { describePlaylistBoard, getMultiplayerRequiredRounds } from "./playlistStats";

describe("playlistStats", () => {
  const baseConfig = {
    playlistVersion: 1,
    roundStartDelayMs: 0,
    perkSelection: { optionsPerPick: 3, triggerChancePerCompletedRound: 0.35 },
    perkPool: { enabledPerkIds: [], enabledAntiPerkIds: [] },
    probabilityScaling: {
      initialIntermediaryProbability: 0,
      initialAntiPerkProbability: 0,
      intermediaryIncreasePerRound: 0.02,
      antiPerkIncreasePerRound: 0.015,
      maxIntermediaryProbability: 1,
      maxAntiPerkProbability: 0.75,
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
    dice: { min: 1, max: 6 },
  } satisfies Omit<PlaylistConfig, "boardConfig">;

  it("counts linear round nodes excluding safe points", () => {
    const result = describePlaylistBoard({
      ...baseConfig,
      boardConfig: {
        mode: "linear",
        totalIndices: 8,
        safePointIndices: [2, 5],
        safePointRestMsByIndex: {},
        normalRoundRefsByIndex: {},
        normalRoundOrder: [],
        cumRoundRefs: [],
      },
    } satisfies PlaylistConfig);

    expect(result).toEqual({
      modeLabel: "Linear",
      nodeCount: 9,
      edgeCount: 8,
      safePointCount: 2,
      roundNodeCount: 6,
      catapultNodeCount: 0,
    });
  });

  it("counts only round and random-round graph nodes", () => {
    const graphConfig = {
      ...baseConfig,
      boardConfig: {
        mode: "graph",
        startNodeId: "start",
        nodes: [
          { id: "start", name: "Start", kind: "start" },
          { id: "safe-1", name: "Safe", kind: "safePoint" },
          { id: "round-1", name: "Round", kind: "round", roundRef: { name: "Round 1" } },
          { id: "pool-1", name: "Pool", kind: "randomRound" },
          { id: "perk-1", name: "Perk", kind: "perk" },
          { id: "end-1", name: "End", kind: "end" },
        ],
        edges: [
          { id: "edge-1", fromNodeId: "start", toNodeId: "round-1" },
          { id: "edge-2", fromNodeId: "round-1", toNodeId: "pool-1" },
          { id: "edge-3", fromNodeId: "pool-1", toNodeId: "end-1" },
        ],
        randomRoundPools: [{ id: "pool-1", name: "Pool", candidates: [] }],
        cumRoundRefs: [],
      },
    } as unknown as PlaylistConfig;

    const result = describePlaylistBoard(graphConfig);

    expect(result).toEqual({
      modeLabel: "Graph",
      nodeCount: 6,
      edgeCount: 3,
      safePointCount: 1,
      roundNodeCount: 2,
      catapultNodeCount: 0,
    });
  });

  it("uses the higher of the global minimum and playlist round-node count", () => {
    const config = {
      ...baseConfig,
      boardConfig: {
        mode: "linear" as const,
        totalIndices: MULTIPLAYER_MINIMUM_ROUNDS + 40,
        safePointIndices: [],
        safePointRestMsByIndex: {},
        normalRoundRefsByIndex: {},
        normalRoundOrder: [],
        cumRoundRefs: [],
      },
    } satisfies PlaylistConfig;

    expect(getMultiplayerRequiredRounds(config)).toBe(MULTIPLAYER_MINIMUM_ROUNDS + 40);
  });
});
