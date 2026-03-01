import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { PlaylistMapPreview } from "./PlaylistMapPreview";
import type { GraphBoardConfig, PlaylistConfig } from "../game/playlistSchema";

const baseEconomy = {
  startingMoney: 120,
  moneyPerCompletedRound: 50,
  startingScore: 0,
  scorePerCompletedRound: 100,
  scorePerIntermediary: 30,
  scorePerActiveAntiPerk: 25,
  scorePerCumRoundSuccess: 420,
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
  maxIntermediaryProbability: 1,
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
      {
        id: "round-1",
        name: "Round",
        kind: "round",
        roundRef: { name: "Round 1" },
        styleHint: { x: 460, y: 100 },
      },
      { id: "end", name: "End", kind: "end", styleHint: { x: 640, y: 100 } },
    ],
    edges: [
      { id: "edge-a", fromNodeId: "start", toNodeId: "path-1", gateCost: 0, weight: 1 },
      { id: "edge-b", fromNodeId: "path-1", toNodeId: "round-1", gateCost: 0, weight: 1 },
      { id: "edge-c", fromNodeId: "round-1", toNodeId: "end", gateCost: 0, weight: 1 },
    ],
    textAnnotations: [
      {
        id: "text-1",
        text: "Choose wisely",
        styleHint: { x: 280, y: 60, color: "#10b981", size: 22 },
      },
    ],
    randomRoundPools: [],
    cumRoundRefs: [],
    pathChoiceTimeoutMs: 6000,
  },
  perkSelection: basePerkSelection,
  perkPool: basePerkPool,
  probabilityScaling: baseProbabilityScaling,
  economy: baseEconomy,
  roundStartDelayMs: 20000,
  dice: { min: 1, max: 6 },
  saveMode: "none",
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
  roundStartDelayMs: 20000,
  dice: { min: 1, max: 6 },
  saveMode: "none",
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

  it("adds an explicit end node for linear playlists", () => {
    render(<PlaylistMapPreview config={linearConfig} />);

    const nodes = screen.getAllByTestId("playlist-map-node");
    expect(nodes.length).toBe(14);
    expect(screen.getAllByTestId("playlist-map-edge")).toHaveLength(13);
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
        textAnnotations: [],
        randomRoundPools: [],
        cumRoundRefs: [],
        pathChoiceTimeoutMs: 6000,
      },
    };

    render(<PlaylistMapPreview config={missingHints} />);

    expect(screen.getByTestId("playlist-map-preview")).toBeDefined();
    expect(screen.getAllByTestId("playlist-map-node").length).toBe(3);
  });

  it("applies custom node color and size overrides", () => {
    const graphBoard = graphConfig.boardConfig as GraphBoardConfig;
    const config: PlaylistConfig = {
      ...graphConfig,
      boardConfig: {
        ...graphBoard,
        nodes: graphBoard.nodes.map((node) =>
          node.id === "path-1"
            ? { ...node, styleHint: { ...node.styleHint, color: "#10b981", size: 2 } }
            : node
        ),
      },
    };

    render(<PlaylistMapPreview config={config} />);

    const nodes = screen.getAllByTestId("playlist-map-node");
    const pathNode = nodes[1];
    expect(pathNode?.getAttribute("fill")).toBe("#10b981");
    expect(pathNode?.getAttribute("r")).toBe("8.4");
  });

  it("renders graph text annotations", () => {
    render(<PlaylistMapPreview config={graphConfig} />);

    const annotation = screen.getByTestId("playlist-map-text-annotation");
    expect(annotation.textContent).toBe("Choose wisely");
    expect(annotation.getAttribute("fill")).toBe("#10b981");
  });

  it("includes distant text annotations in preview bounds", () => {
    const graphBoard = graphConfig.boardConfig as GraphBoardConfig;
    const config: PlaylistConfig = {
      ...graphConfig,
      boardConfig: {
        ...graphBoard,
        textAnnotations: [
          {
            id: "text-far",
            text: "Far note",
            styleHint: { x: 2000, y: 100, color: "#f8fafc", size: 18 },
          },
        ],
      },
    };

    render(<PlaylistMapPreview config={config} />);

    const annotation = screen.getByTestId("playlist-map-text-annotation");
    expect(Number(annotation.getAttribute("x"))).toBeLessThanOrEqual(302);
  });
});
