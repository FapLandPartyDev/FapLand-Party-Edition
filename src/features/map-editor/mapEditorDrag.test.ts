import { describe, expect, it } from "vitest";
import { parseMapEditorDragItem, serializeMapEditorDragItem } from "./mapEditorDrag";

describe("map editor drag data", () => {
  it("round-trips node and round payloads", () => {
    expect(
      parseMapEditorDragItem(serializeMapEditorDragItem({ type: "node", nodeKind: "path" }))
    ).toEqual({
      type: "node",
      nodeKind: "path",
    });
    expect(
      parseMapEditorDragItem(serializeMapEditorDragItem({ type: "round", roundId: "round-12" }))
    ).toEqual({ type: "round", roundId: "round-12" });
    expect(
      parseMapEditorDragItem(serializeMapEditorDragItem({ type: "hero", heroId: "hero-4" }))
    ).toEqual({ type: "hero", heroId: "hero-4" });
  });

  it("rejects malformed and unknown payloads", () => {
    expect(parseMapEditorDragItem("not json")).toBeNull();
    expect(parseMapEditorDragItem('{"type":"node","nodeKind":"unknown"}')).toBeNull();
    expect(parseMapEditorDragItem('{"type":"round","roundId":""}')).toBeNull();
    expect(parseMapEditorDragItem('{"type":"hero","heroId":""}')).toBeNull();
  });
});
