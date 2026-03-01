import { describe, expect, it } from "vitest";
import { sanitizeNodeKind, toEditorGraphConfig } from "./EditorState";

describe("EditorState", () => {
  it("falls back legacy event nodes to path", () => {
    expect(sanitizeNodeKind("event")).toBe("path");
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
});
