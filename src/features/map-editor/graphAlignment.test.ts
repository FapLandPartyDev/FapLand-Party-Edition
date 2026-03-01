import { describe, expect, it } from "vitest";
import type { EditorGraphConfig } from "./EditorState";
import { realignGraph } from "./graphAlignment";

const makeGraph = (): EditorGraphConfig => ({
  mode: "graph",
  startNodeId: "start",
  nodes: [
    {
      id: "start",
      name: "Start",
      kind: "start",
      styleHint: { x: 80, y: 320, width: 190, height: 84, color: "#fff" },
    },
    {
      id: "mid",
      name: "Mid",
      kind: "path",
      styleHint: { x: 480, y: 190, width: 190, height: 84, icon: "m" },
    },
    {
      id: "end",
      name: "End",
      kind: "end",
      styleHint: { x: 920, y: 450, width: 190, height: 84, size: 1.2 },
    },
  ],
  edges: [
    { id: "edge-start-mid", fromNodeId: "start", toNodeId: "mid", weight: 1, gateCost: 0 },
    { id: "edge-mid-end", fromNodeId: "mid", toNodeId: "end", weight: 1, gateCost: 0 },
  ],
  textAnnotations: [],
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

describe("realignGraph", () => {
  it("places a simple chain on increasing x for horizontal layered layout", () => {
    const result = realignGraph(makeGraph(), "layeredHorizontal");
    const [start, mid, end] = result.nodes;

    expect(result.changed).toBe(true);
    expect((start?.styleHint?.x ?? 0) < (mid?.styleHint?.x ?? 0)).toBe(true);
    expect((mid?.styleHint?.x ?? 0) < (end?.styleHint?.x ?? 0)).toBe(true);
    expect(start?.styleHint?.y).toBe(mid?.styleHint?.y);
    expect(mid?.styleHint?.y).toBe(end?.styleHint?.y);
  });

  it("places a simple chain on increasing y for vertical layered layout", () => {
    const result = realignGraph(makeGraph(), "layeredVertical");
    const [start, mid, end] = result.nodes;

    expect((start?.styleHint?.y ?? 0) < (mid?.styleHint?.y ?? 0)).toBe(true);
    expect((mid?.styleHint?.y ?? 0) < (end?.styleHint?.y ?? 0)).toBe(true);
    expect(start?.styleHint?.x).toBe(mid?.styleHint?.x);
    expect(mid?.styleHint?.x).toBe(end?.styleHint?.x);
  });

  it("places a simple chain upward for layered up layout", () => {
    const result = realignGraph(makeGraph(), "layeredUp");
    const [start, mid, end] = result.nodes;

    expect((start?.styleHint?.y ?? 0) > (mid?.styleHint?.y ?? 0)).toBe(true);
    expect((mid?.styleHint?.y ?? 0) > (end?.styleHint?.y ?? 0)).toBe(true);
    expect(start?.styleHint?.x).toBe(mid?.styleHint?.x);
    expect(mid?.styleHint?.x).toBe(end?.styleHint?.x);
  });

  it("keeps branching siblings on the same rank without overlap", () => {
    const graph = makeGraph();
    graph.nodes.splice(2, 0, {
      id: "branch",
      name: "Branch",
      kind: "path",
      styleHint: { x: 460, y: 520, width: 190, height: 84 },
    });
    graph.edges = [
      { id: "edge-start-mid", fromNodeId: "start", toNodeId: "mid", weight: 1, gateCost: 0 },
      { id: "edge-start-branch", fromNodeId: "start", toNodeId: "branch", weight: 1, gateCost: 0 },
      { id: "edge-mid-end", fromNodeId: "mid", toNodeId: "end", weight: 1, gateCost: 0 },
      { id: "edge-branch-end", fromNodeId: "branch", toNodeId: "end", weight: 1, gateCost: 0 },
    ];

    const result = realignGraph(graph, "layeredHorizontal");
    const mid = result.nodes.find((node) => node.id === "mid");
    const branch = result.nodes.find((node) => node.id === "branch");

    expect(mid?.styleHint?.x).toBe(branch?.styleHint?.x);
    expect(Math.abs((mid?.styleHint?.y ?? 0) - (branch?.styleHint?.y ?? 0))).toBeGreaterThanOrEqual(
      180
    );
  });

  it("returns finite positions for cyclic graphs", () => {
    const graph = makeGraph();
    graph.edges.push({
      id: "edge-end-start",
      fromNodeId: "end",
      toNodeId: "start",
      weight: 1,
      gateCost: 0,
    });

    const result = realignGraph(graph, "layeredHorizontal");

    expect(result.nodes.map((node) => node.id)).toEqual(graph.nodes.map((node) => node.id));
    for (const node of result.nodes) {
      expect(Number.isFinite(node.styleHint?.x)).toBe(true);
      expect(Number.isFinite(node.styleHint?.y)).toBe(true);
    }
  });

  it("lays out disconnected nodes deterministically after reachable ones", () => {
    const graph = makeGraph();
    graph.nodes.push({
      id: "orphan",
      name: "Orphan",
      kind: "path",
      styleHint: { x: 30, y: 30, width: 190, height: 84 },
    });

    const result = realignGraph(graph, "layeredHorizontal");
    const end = result.nodes.find((node) => node.id === "end");
    const orphan = result.nodes.find((node) => node.id === "orphan");

    expect((orphan?.styleHint?.x ?? 0) > (end?.styleHint?.x ?? 0)).toBe(true);
  });

  it("snaps nodes into a tidy grid while preserving broad order", () => {
    const graph = makeGraph();
    graph.nodes = [
      { id: "a", name: "A", kind: "start", styleHint: { x: 10, y: 15, width: 190, height: 84 } },
      { id: "b", name: "B", kind: "path", styleHint: { x: 265, y: 20, width: 190, height: 84 } },
      { id: "c", name: "C", kind: "end", styleHint: { x: 18, y: 160, width: 190, height: 84 } },
    ];
    graph.startNodeId = "a";
    graph.edges = [
      { id: "ab", fromNodeId: "a", toNodeId: "b", weight: 1, gateCost: 0 },
      { id: "ac", fromNodeId: "a", toNodeId: "c", weight: 1, gateCost: 0 },
    ];

    const result = realignGraph(graph, "gridCleanup");
    const a = result.nodes.find((node) => node.id === "a");
    const b = result.nodes.find((node) => node.id === "b");
    const c = result.nodes.find((node) => node.id === "c");

    expect((b?.styleHint?.x ?? 0) > (a?.styleHint?.x ?? 0)).toBe(true);
    expect((c?.styleHint?.y ?? 0) > (a?.styleHint?.y ?? 0)).toBe(true);
    expect(((b?.styleHint?.x ?? 0) - (a?.styleHint?.x ?? 0)) % 240).toBe(0);
  });

  it("lays nodes out in a snaking grid order", () => {
    const graph = makeGraph();
    graph.nodes = Array.from({ length: 6 }, (_, index) => ({
      id: `node-${index}`,
      name: `Node ${index}`,
      kind: index === 0 ? ("start" as const) : index === 5 ? ("end" as const) : ("path" as const),
      styleHint: { x: 50 + index * 50, y: 50 + index * 20, width: 190, height: 84 },
    }));
    graph.startNodeId = "node-0";
    graph.edges = graph.nodes.slice(0, -1).map((node, index) => ({
      id: `edge-${index}`,
      fromNodeId: node.id,
      toNodeId: graph.nodes[index + 1]!.id,
      weight: 1,
      gateCost: 0,
    }));

    const result = realignGraph(graph, "snake");
    const node0 = result.nodes.find((node) => node.id === "node-0");
    const node1 = result.nodes.find((node) => node.id === "node-1");
    const node3 = result.nodes.find((node) => node.id === "node-3");
    const node4 = result.nodes.find((node) => node.id === "node-4");
    const node5 = result.nodes.find((node) => node.id === "node-5");

    expect((node1?.styleHint?.x ?? 0) > (node0?.styleHint?.x ?? 0)).toBe(true);
    expect((node4?.styleHint?.y ?? 0) < (node3?.styleHint?.y ?? 0)).toBe(true);
    expect((node5?.styleHint?.x ?? 0) < (node4?.styleHint?.x ?? 0)).toBe(true);
  });

  it("preserves non-position node metadata", () => {
    const graph = makeGraph();
    const result = realignGraph(graph, "layeredHorizontal");
    const start = result.nodes.find((node) => node.id === "start");
    const mid = result.nodes.find((node) => node.id === "mid");
    const end = result.nodes.find((node) => node.id === "end");

    expect(start?.styleHint?.color).toBe("#fff");
    expect(mid?.styleHint?.icon).toBe("m");
    expect(end?.styleHint?.size).toBe(1.2);
  });
});
