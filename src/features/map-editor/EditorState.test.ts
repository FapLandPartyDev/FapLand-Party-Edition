import { describe, expect, it } from "vitest";
import {
  convertEditorGraphToLinearBoardConfig,
  normalizeGraphBackgroundMedia,
  normalizeRoadPalette,
  sanitizeNodeKind,
  toEditorGraphConfig,
  toGraphBoardConfig,
  type EditorGraphConfig,
} from "./EditorState";

function makeEditorConfig(overrides: Partial<EditorGraphConfig> = {}): EditorGraphConfig {
  return {
    mode: "graph",
    startNodeId: "start",
    nodes: [
      { id: "start", name: "Start", kind: "start" },
      { id: "end", name: "End", kind: "end" },
    ],
    edges: [{ id: "edge-start-end", fromNodeId: "start", toNodeId: "end" }],
    textAnnotations: [],
    randomRoundPools: [],
    cumRoundRefs: [],
    pathChoiceTimeoutMs: 6000,
    perkSelection: { optionsPerPick: 3, triggerChancePerCompletedRound: 0.35 },
    perkPool: { enabledPerkIds: [], enabledAntiPerkIds: [] },
    probabilityScaling: {
      initialIntermediaryProbability: 0.1,
      initialAntiPerkProbability: 0.1,
      intermediaryIncreasePerRound: 0.02,
      antiPerkIncreasePerRound: 0.015,
      maxIntermediaryProbability: 1,
      maxAntiPerkProbability: 0.75,
    },
    economy: {
      startingMoney: 120,
      scorePerCumRoundSuccess: 420,
    },
    dice: { min: 1, max: 6 },
    saveMode: "none",
    style: {},
    music: { tracks: [], loop: true },
    ...overrides,
  };
}

describe("EditorState", () => {
  it("falls back legacy event nodes to path", () => {
    expect(sanitizeNodeKind("event")).toBe("path");
  });

  it("preserves campfire nodes and pause bonuses when round-tripping graph configs", () => {
    const graph = toGraphBoardConfig(
      makeEditorConfig({
        nodes: [
          { id: "start", name: "Start", kind: "start" },
          { id: "camp-1", name: "Campfire", kind: "campfire", pauseBonusMs: 1750 },
          { id: "end", name: "End", kind: "end" },
        ],
        edges: [
          { id: "edge-start-camp", fromNodeId: "start", toNodeId: "camp-1" },
          { id: "edge-camp-end", fromNodeId: "camp-1", toNodeId: "end" },
        ],
      })
    );

    const roundTripped = toEditorGraphConfig(graph);
    expect(roundTripped.nodes.find((node) => node.id === "camp-1")).toMatchObject({
      kind: "campfire",
      pauseBonusMs: 1750,
    });
  });

  it("normalizes legacy event graph nodes when loading editor state", () => {
    const config = toEditorGraphConfig({
      mode: "graph",
      startNodeId: "start",
      nodes: [
        { id: "start", name: "Start", kind: "start" },
        { id: "legacy-event", name: "Legacy Event", kind: "event" },
        { id: "end", name: "End", kind: "end" },
      ],
      edges: [
        { id: "edge-1", fromNodeId: "start", toNodeId: "legacy-event" },
        { id: "edge-2", fromNodeId: "legacy-event", toNodeId: "end" },
      ],
      textAnnotations: [],
      randomRoundPools: [],
      cumRoundRefs: [],
      pathChoiceTimeoutMs: 6000,
    });

    expect(config.nodes.find((node) => node.id === "legacy-event")?.kind).toBe("path");
  });

  it("preserves starting money in editor economy state", () => {
    const config = toEditorGraphConfig({
      mode: "graph",
      startNodeId: "start",
      nodes: [
        { id: "start", name: "Start", kind: "start" },
        { id: "end", name: "End", kind: "end" },
      ],
      edges: [{ id: "edge-1", fromNodeId: "start", toNodeId: "end" }],
      textAnnotations: [],
      randomRoundPools: [],
      cumRoundRefs: [],
      pathChoiceTimeoutMs: 6000,
    });

    expect(config.economy.startingMoney).toBe(120);
  });

  it("preserves and sanitizes text annotations", () => {
    const config = toEditorGraphConfig({
      mode: "graph",
      startNodeId: "start",
      nodes: [
        { id: "start", name: "Start", kind: "start" },
        { id: "end", name: "End", kind: "end" },
      ],
      edges: [{ id: "edge-1", fromNodeId: "start", toNodeId: "end" }],
      textAnnotations: [
        {
          id: "text-1",
          text: "  Go left  ",
          styleHint: { x: 12, y: 24, color: " #10b981 ", size: 120 },
        },
        {
          id: "text-invalid",
          text: "Missing position",
          styleHint: { x: Number.NaN, y: 40 },
        },
      ],
      randomRoundPools: [],
      cumRoundRefs: [],
      pathChoiceTimeoutMs: 6000,
    });

    expect(config.textAnnotations).toEqual([
      {
        id: "text-1",
        text: "Go left",
        styleHint: { x: 12, y: 24, color: "#10b981", size: 72 },
      },
    ]);
  });

  it("normalizes graph background media defaults and clamps numeric controls", () => {
    expect(
      normalizeGraphBackgroundMedia({
        uri: "app://media/%2Ftmp%2Fbackground.mp4",
        opacity: 2,
        dim: -1,
        blur: 99,
        scale: 10,
        parallaxStrength: 2,
        motion: "parallax",
      })
    ).toMatchObject({
      kind: "video",
      fit: "cover",
      position: "center",
      opacity: 1,
      dim: 0,
      blur: 24,
      scale: 4,
      offsetX: 0,
      offsetY: 0,
      motion: "parallax",
      parallaxStrength: 1,
    });

    expect(normalizeGraphBackgroundMedia({ uri: "   " })).toBeUndefined();
  });

  it("normalizes road palettes to defaults for missing or invalid fields", () => {
    expect(
      normalizeRoadPalette({
        presetId: "custom",
        body: "#123456",
        railA: "not-a-color",
      })
    ).toMatchObject({
      presetId: "custom",
      body: "#123456",
      railA: "#79ddff",
      railB: "#ff71ca",
    });
  });

  it("converts a simple graph round path to a linear board", () => {
    const result = convertEditorGraphToLinearBoardConfig(
      makeEditorConfig({
        nodes: [
          { id: "start", name: "Start", kind: "start" },
          {
            id: "round-1",
            name: "Round 1",
            kind: "round",
            roundRef: { idHint: "round-1", name: "Round 1" },
          },
          { id: "end", name: "End", kind: "end" },
        ],
        edges: [
          { id: "edge-start-round-1", fromNodeId: "start", toNodeId: "round-1" },
          { id: "edge-round-1-end", fromNodeId: "round-1", toNodeId: "end" },
        ],
        cumRoundRefs: [{ idHint: "cum-1", name: "Cum 1", type: "Cum" }],
      })
    );

    expect(result.boardConfig).toMatchObject({
      mode: "linear",
      totalIndices: 1,
      safePointIndices: [],
      normalRoundOrder: [],
      cumRoundRefs: [{ idHint: "cum-1", name: "Cum 1", type: "Cum" }],
    });
    expect(result.boardConfig.normalRoundRefsByIndex["1"]).toEqual({
      idHint: "round-1",
      name: "Round 1",
    });
    expect(result.keptNodeIds).toEqual(["round-1"]);
  });

  it("converts path and safe point nodes to linear field positions", () => {
    const result = convertEditorGraphToLinearBoardConfig(
      makeEditorConfig({
        nodes: [
          { id: "start", name: "Start", kind: "start" },
          { id: "path-1", name: "Path 1", kind: "path" },
          { id: "safe-1", name: "Safe 1", kind: "safePoint", checkpointRestMs: 4500 },
          { id: "end", name: "End", kind: "end" },
        ],
        edges: [
          { id: "edge-start-path-1", fromNodeId: "start", toNodeId: "path-1" },
          { id: "edge-path-1-safe-1", fromNodeId: "path-1", toNodeId: "safe-1" },
          { id: "edge-safe-1-end", fromNodeId: "safe-1", toNodeId: "end" },
        ],
      })
    );

    expect(result.boardConfig.totalIndices).toBe(2);
    expect(result.boardConfig.safePointIndices).toEqual([2]);
    expect(result.boardConfig.safePointRestMsByIndex).toEqual({ "2": 4500 });
    expect(result.keptNodeIds).toEqual(["path-1", "safe-1"]);
  });

  it("follows only the first outgoing edge and reports dropped branches", () => {
    const result = convertEditorGraphToLinearBoardConfig(
      makeEditorConfig({
        nodes: [
          { id: "start", name: "Start", kind: "start" },
          { id: "round-main", name: "Main", kind: "round", roundRef: { name: "Main" } },
          { id: "round-branch", name: "Branch", kind: "round", roundRef: { name: "Branch" } },
          { id: "end", name: "End", kind: "end" },
        ],
        edges: [
          { id: "edge-start-main", fromNodeId: "start", toNodeId: "round-main" },
          { id: "edge-start-branch", fromNodeId: "start", toNodeId: "round-branch" },
          { id: "edge-main-end", fromNodeId: "round-main", toNodeId: "end" },
          { id: "edge-branch-end", fromNodeId: "round-branch", toNodeId: "end" },
        ],
      })
    );

    expect(result.boardConfig.normalRoundRefsByIndex["1"]).toEqual({ name: "Main" });
    expect(result.droppedNodeIds).toContain("round-branch");
    expect(result.droppedEdgeIds).toEqual(["edge-start-branch", "edge-branch-end"]);
    expect(result.warnings.some((warning) => warning.includes("Branches"))).toBe(true);
  });

  it("drops graph-only nodes and reports graph-only loss", () => {
    const result = convertEditorGraphToLinearBoardConfig(
      makeEditorConfig({
        nodes: [
          { id: "start", name: "Start", kind: "start" },
          { id: "perk-1", name: "Perk", kind: "perk" },
          { id: "random-1", name: "Random", kind: "randomRound" },
          { id: "catapult-1", name: "Catapult", kind: "catapult", catapultForward: 2 },
          { id: "end", name: "End", kind: "end" },
        ],
        edges: [
          { id: "edge-start-perk-1", fromNodeId: "start", toNodeId: "perk-1" },
          { id: "edge-perk-1-random-1", fromNodeId: "perk-1", toNodeId: "random-1" },
          { id: "edge-random-1-catapult-1", fromNodeId: "random-1", toNodeId: "catapult-1" },
          { id: "edge-catapult-1-end", fromNodeId: "catapult-1", toNodeId: "end" },
        ],
      })
    );

    expect(result.boardConfig.totalIndices).toBe(1);
    expect(result.boardConfig.normalRoundRefsByIndex).toEqual({});
    expect(result.droppedNodeIds).toEqual(["perk-1", "random-1", "catapult-1"]);
    expect(result.warnings.some((warning) => warning.includes("Graph-only"))).toBe(true);
  });

  it("drops campfire nodes when converting to a linear board", () => {
    const result = convertEditorGraphToLinearBoardConfig(
      makeEditorConfig({
        nodes: [
          { id: "start", name: "Start", kind: "start" },
          { id: "camp-1", name: "Campfire", kind: "campfire", pauseBonusMs: 1750 },
          { id: "end", name: "End", kind: "end" },
        ],
        edges: [
          { id: "edge-start-camp", fromNodeId: "start", toNodeId: "camp-1" },
          { id: "edge-camp-end", fromNodeId: "camp-1", toNodeId: "end" },
        ],
      })
    );

    expect(result.boardConfig.safePointRestMsByIndex).toEqual({});
    expect(result.droppedNodeIds).toEqual(["camp-1"]);
    expect(result.warnings.some((warning) => warning.includes("Graph-only"))).toBe(true);
  });

  it("terminates graph conversion when a cycle is detected", () => {
    const result = convertEditorGraphToLinearBoardConfig(
      makeEditorConfig({
        nodes: [
          { id: "start", name: "Start", kind: "start" },
          { id: "path-1", name: "Path", kind: "path" },
          { id: "end", name: "End", kind: "end" },
        ],
        edges: [
          { id: "edge-start-path-1", fromNodeId: "start", toNodeId: "path-1" },
          { id: "edge-path-1-path-1", fromNodeId: "path-1", toNodeId: "path-1" },
        ],
      })
    );

    expect(result.boardConfig.totalIndices).toBe(1);
    expect(result.keptNodeIds).toEqual(["path-1"]);
    expect(result.droppedNodeIds).toContain("end");
    expect(result.warnings.some((warning) => warning.includes("Cycle"))).toBe(true);
  });
});
