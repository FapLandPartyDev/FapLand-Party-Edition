import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { PlaylistMapPreview } from "./PlaylistMapPreview";
import type { PlaylistConfig } from "../game/playlistSchema";

const baseEconomy = {
  startingMoney: 120,
  moneyPerCompletedRound: 50,
  startingScore: 0,
  scorePerCompletedRound: 100,
  scorePerIntermediary: 30,
  scorePerActiveAntiPerk: 25,
  scorePerCumRoundSuccess: 120,
};

const basePerkSelection = {
  optionsPerPick: 3,
  triggerChancePerCompletedRound: 0.35,
};

const basePerkPool = {
  enabledPerkIds: [],
  enabledAntiPerkIds: [],
};

const baseProbabilityScaling = {
  initialIntermediaryProbability: 0,
  initialAntiPerkProbability: 0,
  intermediaryIncreasePerRound: 0.02,
  antiPerkIncreasePerRound: 0.015,
  maxIntermediaryProbability: 0.85,
  maxAntiPerkProbability: 0.75,
};

const graphConfig: PlaylistConfig = {
  playlistVersion: 1,
  boardConfig: {
    mode: "graph",
    startNodeId: "start",
    nodes: [
      { id: "start", name: "Start", kind: "start", styleHint: { x: 100, y: 100 } },
      { id: "path-1", name: "Path", kind: "path", styleHint: { x: 280, y: 100 } },
      { id: "round-1", name: "Round", kind: "round", roundRef: { name: "Round 1" }, styleHint: { x: 460, y: 100 } },
      { id: "end", name: "End", kind: "end", styleHint: { x: 640, y: 100 } },
    ],
    edges: [
      { id: "edge-a", fromNodeId: "start", toNodeId: "path-1", gateCost: 0, weight: 1 },
      { id: "edge-b", fromNodeId: "path-1", toNodeId: "round-1", gateCost: 0, weight: 1 },
      { id: "edge-c", fromNodeId: "round-1", toNodeId: "end", gateCost: 0, weight: 1 },
    ],
    randomRoundPools: [],
    cumRoundRefs: [],
    pathChoiceTimeoutMs: 6000,
  },
  perkSelection: basePerkSelection,
  perkPool: basePerkPool,
  probabilityScaling: baseProbabilityScaling,
  economy: baseEconomy,
};

const linearConfig: PlaylistConfig = {
  playlistVersion: 1,
  boardConfig: {
    mode: "linear",
    totalIndices: 12,
    safePointIndices: [4, 8],
    safePointRestMsByIndex: {},
    normalRoundRefsByIndex: {},
    normalRoundOrder: [],
    cumRoundRefs: [],
  },
  perkSelection: basePerkSelection,
  perkPool: basePerkPool,
  probabilityScaling: baseProbabilityScaling,
  economy: baseEconomy,
};

describe("PlaylistMapPreview", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders graph playlist nodes and edges", () => {
    render(<PlaylistMapPreview config={graphConfig} />);

    expect(screen.getByTestId("playlist-map-preview")).toBeDefined();
    expect(screen.getAllByTestId("playlist-map-node").length).toBeGreaterThan(0);
    expect(screen.getAllByTestId("playlist-map-edge").length).toBeGreaterThan(0);
  });

  it("renders linear playlist preview from transformed graph", () => {
    render(<PlaylistMapPreview config={linearConfig} />);

    expect(screen.getByTestId("playlist-map-preview")).toBeDefined();
    expect(screen.getAllByTestId("playlist-map-node").length).toBeGreaterThan(3);
    expect(screen.getAllByTestId("playlist-map-edge").length).toBeGreaterThan(3);
  });

  it("handles graph nodes without style hints", () => {
    const missingHints: PlaylistConfig = {
      ...graphConfig,
      boardConfig: {
        mode: "graph",
        startNodeId: "start",
        nodes: [
          { id: "start", name: "Start", kind: "start" },
          { id: "path-1", name: "Path", kind: "path" },
          { id: "end", name: "End", kind: "end" },
        ],
        edges: [
          { id: "edge-a", fromNodeId: "start", toNodeId: "path-1", gateCost: 0, weight: 1 },
          { id: "edge-b", fromNodeId: "path-1", toNodeId: "end", gateCost: 0, weight: 1 },
        ],
        randomRoundPools: [],
        cumRoundRefs: [],
        pathChoiceTimeoutMs: 6000,
      },
    };

    render(<PlaylistMapPreview config={missingHints} />);

    expect(screen.getByTestId("playlist-map-preview")).toBeDefined();
    expect(screen.getAllByTestId("playlist-map-node").length).toBe(3);
  });
});
