import { describe, expect, it } from "vitest";
import {
  normalizeGraphBackgroundMedia,
  normalizeRoadPalette,
  sanitizeNodeKind,
  toEditorGraphConfig,
} from "./EditorState";

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
});
