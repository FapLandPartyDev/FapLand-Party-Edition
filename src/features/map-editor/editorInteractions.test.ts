import { describe, expect, it } from "vitest";
import type { EditorGraphConfig, EditorNode } from "./EditorState";
import {
  buildTileHotkeyMap,
  deleteSelectionFromConfig,
  getNodesIntersectingScreenRect,
  mergeNodeSelection,
  replaceNodeSelection,
  toggleNodeSelection,
} from "./editorInteractions";

const sampleNode = (
  id: string,
  x: number,
  y: number,
  kind: EditorNode["kind"] = "path"
): EditorNode => ({
  id,
  name: id,
  kind,
  styleHint: {
    x,
    y,
    width: 190,
    height: 84,
  },
});

const makeConfig = (): EditorGraphConfig => ({
  mode: "graph",
  startNodeId: "start",
  nodes: [
    sampleNode("start", 100, 100, "start"),
    sampleNode("path-1", 420, 120, "path"),
    sampleNode("end", 740, 120, "end"),
  ],
  edges: [
    {
      id: "edge-start-path-1",
      fromNodeId: "start",
      toNodeId: "path-1",
      gateCost: 0,
      weight: 1,
    },
    {
      id: "edge-path-1-end",
      fromNodeId: "path-1",
      toNodeId: "end",
      gateCost: 0,
      weight: 1,
    },
  ],
  textAnnotations: [
    {
      id: "text-1",
      text: "Read this",
      styleHint: { x: 260, y: 80, color: "#f8fafc", size: 18 },
    },
  ],
  randomRoundPools: [],
  cumRoundRefs: [],
  pathChoiceTimeoutMs: 6000,
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
  economy: { startingMoney: 120, scorePerCumRoundSuccess: 420 },
  dice: { min: 1, max: 6 },
  saveMode: "none",
});

describe("editorInteractions", () => {
  it("toggles a node in selection and preserves selectedEdge reset", () => {
    const base = replaceNodeSelection(
      {
        selectedNodeIds: [],
        primaryNodeId: null,
        selectedEdgeId: "edge-a",
        selectedTextAnnotationId: null,
      },
      ["node-a"],
      "node-a"
    );
    const toggledOff = toggleNodeSelection(base, "node-a");
    expect(toggledOff.selectedNodeIds).toEqual([]);
    expect(toggledOff.primaryNodeId).toBeNull();
    expect(toggledOff.selectedEdgeId).toBeNull();

    const toggledOn = toggleNodeSelection(toggledOff, "node-b");
    expect(toggledOn.selectedNodeIds).toEqual(["node-b"]);
    expect(toggledOn.primaryNodeId).toBe("node-b");
  });

  it("merges marquee selection in additive mode", () => {
    const base = replaceNodeSelection(
      {
        selectedNodeIds: [],
        primaryNodeId: null,
        selectedEdgeId: null,
        selectedTextAnnotationId: null,
      },
      ["node-a"],
      "node-a"
    );
    const merged = mergeNodeSelection(base, ["node-b", "node-c"], "node-b");
    expect(merged.selectedNodeIds).toEqual(["node-a", "node-b", "node-c"]);
    expect(merged.primaryNodeId).toBe("node-a");
  });

  it("returns intersecting node ids from marquee rectangle in screen space", () => {
    const nodes = [sampleNode("node-a", 100, 100), sampleNode("node-b", 460, 120)];
    const hits = getNodesIntersectingScreenRect(
      nodes,
      { x: 0, y: 0, zoom: 1 },
      {
        startX: 80,
        startY: 80,
        endX: 360,
        endY: 260,
      }
    );
    expect(hits).toEqual(["node-a"]);
  });

  it("deletes selected nodes and incident edges", () => {
    const config = makeConfig();
    const next = deleteSelectionFromConfig(config, {
      selectedNodeIds: ["path-1"],
      primaryNodeId: "path-1",
      selectedEdgeId: null,
      selectedTextAnnotationId: null,
    });
    expect(next.nodes.map((node) => node.id)).toEqual(["start", "end"]);
    expect(next.edges).toEqual([]);
  });

  it("deletes selected text annotations without changing nodes or edges", () => {
    const config = makeConfig();
    const next = deleteSelectionFromConfig(config, {
      selectedNodeIds: [],
      primaryNodeId: null,
      selectedEdgeId: null,
      selectedTextAnnotationId: "text-1",
    });

    expect(next.textAnnotations).toEqual([]);
    expect(next.nodes).toEqual(config.nodes);
    expect(next.edges).toEqual(config.edges);
  });

  it("builds numeric hotkey mapping for first nine tiles", () => {
    const tiles = Array.from({ length: 11 }, (_, index) => ({
      id: `tile-${index + 1}`,
    }));
    const map = buildTileHotkeyMap(tiles);
    expect(map["1"]).toBe("tile-1");
    expect(map["9"]).toBe("tile-9");
    expect(map["10"]).toBeUndefined();
  });
});
