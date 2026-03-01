import type { EditorNodeKind } from "./EditorState";

export const MAP_EDITOR_DRAG_TYPE = "application/x-f-land-map-editor-item";

export type MapEditorDragItem =
  | { type: "node"; nodeKind: EditorNodeKind }
  | { type: "round"; roundId: string }
  | { type: "hero"; heroId: string };

const NODE_KINDS = new Set<EditorNodeKind>([
  "start",
  "end",
  "path",
  "safePoint",
  "campfire",
  "round",
  "randomRound",
  "perk",
  "event",
  "catapult",
]);

export const serializeMapEditorDragItem = (item: MapEditorDragItem): string => JSON.stringify(item);

export const parseMapEditorDragItem = (value: string): MapEditorDragItem | null => {
  if (!value) return null;

  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== "object") return null;

    if (
      "type" in parsed &&
      parsed.type === "node" &&
      "nodeKind" in parsed &&
      typeof parsed.nodeKind === "string" &&
      NODE_KINDS.has(parsed.nodeKind as EditorNodeKind)
    ) {
      return { type: "node", nodeKind: parsed.nodeKind as EditorNodeKind };
    }

    if (
      "type" in parsed &&
      parsed.type === "round" &&
      "roundId" in parsed &&
      typeof parsed.roundId === "string" &&
      parsed.roundId.length > 0
    ) {
      return { type: "round", roundId: parsed.roundId };
    }

    if (
      "type" in parsed &&
      parsed.type === "hero" &&
      "heroId" in parsed &&
      typeof parsed.heroId === "string" &&
      parsed.heroId.length > 0
    ) {
      return { type: "hero", heroId: parsed.heroId };
    }
  } catch {
    return null;
  }

  return null;
};
