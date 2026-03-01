import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EditorCanvas } from "./EditorCanvas";
import type { EditorGraphConfig, EditorSelectionState, ViewportState } from "./EditorState";

const baseConfig: EditorGraphConfig = {
  mode: "graph",
  startNodeId: "start",
  nodes: [
    {
      id: "start",
      name: "Start",
      kind: "start",
      styleHint: { x: 100, y: 100, width: 200, height: 80 },
    },
    {
      id: "end",
      name: "End",
      kind: "end",
      styleHint: { x: 400, y: 100, width: 200, height: 80 },
    },
  ],
  edges: [
    {
      id: "edge-1",
      fromNodeId: "start",
      toNodeId: "end",
      gateCost: 0,
      weight: 1,
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
};

const selection: EditorSelectionState = {
  selectedNodeIds: [],
  primaryNodeId: null,
  selectedEdgeId: null,
};

const viewport: ViewportState = {
  x: 0,
  y: 0,
  zoom: 1,
};

describe("EditorCanvas", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders directional edges trimmed to node borders", () => {
    const { container } = render(
      <EditorCanvas
        config={baseConfig}
        selection={selection}
        connectFromNodeId={null}
        tool="select"
        activePlacementKind={null}
        viewport={viewport}
        showGrid={false}
        spacePanActive={false}
        onViewportChange={vi.fn()}
        onSelectionChange={vi.fn()}
        onSetConnectFrom={vi.fn()}
        onMoveNodes={vi.fn()}
        onCreateEdge={vi.fn()}
        onDeleteEdgeBetween={vi.fn()}
        onDeleteSelection={vi.fn()}
        onPlaceNodeAtWorld={vi.fn()}
      />
    );

    const edgeLine = container.querySelector<SVGLineElement>(
      '[data-edge-id="edge-1"] .editor-edge-line'
    );
    expect(edgeLine).not.toBeNull();
    expect(edgeLine?.getAttribute("x1")).toBe("300");
    expect(edgeLine?.getAttribute("y1")).toBe("140");
    expect(edgeLine?.getAttribute("x2")).toBe("400");
    expect(edgeLine?.getAttribute("y2")).toBe("140");
    expect(edgeLine?.getAttribute("marker-end")).toMatch(/^url\(#.+-editor-edge-arrow\)$/);
  });

  it("applies custom node color overrides", () => {
    const config: EditorGraphConfig = {
      ...baseConfig,
      nodes: baseConfig.nodes.map((node) =>
        node.id === "start" ? { ...node, styleHint: { ...node.styleHint, color: "#10b981" } } : node
      ),
    };

    const { container } = render(
      <EditorCanvas
        config={config}
        selection={selection}
        connectFromNodeId={null}
        tool="select"
        activePlacementKind={null}
        viewport={viewport}
        showGrid={false}
        spacePanActive={false}
        onViewportChange={vi.fn()}
        onSelectionChange={vi.fn()}
        onSetConnectFrom={vi.fn()}
        onMoveNodes={vi.fn()}
        onCreateEdge={vi.fn()}
        onDeleteEdgeBetween={vi.fn()}
        onDeleteSelection={vi.fn()}
        onPlaceNodeAtWorld={vi.fn()}
      />
    );

    const borderRect = container.querySelector<SVGRectElement>(
      '[data-node-id="start"] .editor-node-border'
    );
    const secondaryLabel = container.querySelectorAll<SVGTextElement>(
      '[data-node-id="start"] text'
    )[1];
    expect(borderRect?.getAttribute("stroke")).toBe("#10b981");
    expect(secondaryLabel?.getAttribute("fill")).toBe("#10b981");
  });

  it("scales node geometry and edge trimming from styleHint.size", () => {
    const config: EditorGraphConfig = {
      ...baseConfig,
      nodes: [
        {
          ...baseConfig.nodes[0]!,
          styleHint: { ...baseConfig.nodes[0]!.styleHint, size: 1.5 },
        },
        {
          ...baseConfig.nodes[1]!,
          styleHint: { ...baseConfig.nodes[1]!.styleHint, x: 520 },
        },
      ],
    };

    const { container } = render(
      <EditorCanvas
        config={config}
        selection={selection}
        connectFromNodeId={null}
        tool="select"
        activePlacementKind={null}
        viewport={viewport}
        showGrid={false}
        spacePanActive={false}
        onViewportChange={vi.fn()}
        onSelectionChange={vi.fn()}
        onSetConnectFrom={vi.fn()}
        onMoveNodes={vi.fn()}
        onCreateEdge={vi.fn()}
        onDeleteEdgeBetween={vi.fn()}
        onDeleteSelection={vi.fn()}
        onPlaceNodeAtWorld={vi.fn()}
      />
    );

    const borderRect = container.querySelector<SVGRectElement>(
      '[data-node-id="start"] .editor-node-border'
    );
    const edgeLine = container.querySelector<SVGLineElement>(
      '[data-edge-id="edge-1"] .editor-edge-line'
    );

    expect(borderRect?.getAttribute("width")).toBe("300");
    expect(borderRect?.getAttribute("height")).toBe("120");
    expect(edgeLine).not.toBeNull();
    expect(Number(edgeLine?.getAttribute("x1"))).toBe(400);
    expect(Number(edgeLine?.getAttribute("x2"))).toBe(520);
    expect(Number(edgeLine?.getAttribute("y1"))).toBeGreaterThan(140);
    expect(Number(edgeLine?.getAttribute("y2"))).toBeGreaterThan(140);
  });
});
