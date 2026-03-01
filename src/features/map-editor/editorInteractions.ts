import type { EditorGraphConfig, EditorNode, EditorSelectionState, ViewportState } from "./EditorState";
import { getNodeRenderHeight, getNodeRenderWidth } from "./nodeVisuals";

type SelectionRect = {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
};

const normalizeRect = (rect: SelectionRect): { left: number; right: number; top: number; bottom: number } => ({
  left: Math.min(rect.startX, rect.endX),
  right: Math.max(rect.startX, rect.endX),
  top: Math.min(rect.startY, rect.endY),
  bottom: Math.max(rect.startY, rect.endY),
});

export const isTextInputElement = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return target.isContentEditable || tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
};

export const buildTileHotkeyMap = <T extends { id: string }>(tiles: T[]): Record<string, string> => {
  const map: Record<string, string> = {};
  for (let index = 0; index < Math.min(9, tiles.length); index += 1) {
    const tile = tiles[index];
    if (!tile) continue;
    map[String(index + 1)] = tile.id;
  }
  return map;
};

export const replaceNodeSelection = (
  _selection: EditorSelectionState,
  nodeIds: string[],
  primaryNodeId: string | null,
): EditorSelectionState => {
  return {
    selectedNodeIds: Array.from(new Set(nodeIds)),
    primaryNodeId,
    selectedEdgeId: null,
    selectedTextAnnotationId: null,
  };
};

export const mergeNodeSelection = (
  selection: EditorSelectionState,
  nodeIds: string[],
  fallbackPrimaryNodeId: string | null,
): EditorSelectionState => {
  const merged = new Set(selection.selectedNodeIds);
  for (const nodeId of nodeIds) {
    merged.add(nodeId);
  }

  const mergedIds = Array.from(merged);
  return {
    selectedNodeIds: mergedIds,
    primaryNodeId: selection.primaryNodeId ?? fallbackPrimaryNodeId ?? mergedIds[0] ?? null,
    selectedEdgeId: null,
    selectedTextAnnotationId: null,
  };
};

export const toggleNodeSelection = (selection: EditorSelectionState, nodeId: string): EditorSelectionState => {
  const selected = new Set(selection.selectedNodeIds);
  if (selected.has(nodeId)) {
    selected.delete(nodeId);
  } else {
    selected.add(nodeId);
  }

  const selectedNodeIds = Array.from(selected);
  const primaryNodeId = selectedNodeIds.length === 0
    ? null
    : selection.primaryNodeId === nodeId && !selected.has(nodeId)
      ? selectedNodeIds[0] ?? null
      : selection.primaryNodeId ?? nodeId;

  return {
    selectedNodeIds,
    primaryNodeId,
    selectedEdgeId: null,
    selectedTextAnnotationId: null,
  };
};

export const getNodesIntersectingScreenRect = (
  nodes: EditorNode[],
  viewport: ViewportState,
  rect: SelectionRect,
): string[] => {
  const normalized = normalizeRect(rect);
  const hits: string[] = [];

  for (const node of nodes) {
    if (!node.styleHint) continue;
    const x = Number(node.styleHint.x);
    const y = Number(node.styleHint.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;

    const width = getNodeRenderWidth(node);
    const height = getNodeRenderHeight(node);

    const left = x * viewport.zoom + viewport.x;
    const top = y * viewport.zoom + viewport.y;
    const right = left + width * viewport.zoom;
    const bottom = top + height * viewport.zoom;

    const overlaps = right >= normalized.left
      && left <= normalized.right
      && bottom >= normalized.top
      && top <= normalized.bottom;
    if (overlaps) {
      hits.push(node.id);
    }
  }

  return hits;
};

export const deleteSelectionFromConfig = (
  config: EditorGraphConfig,
  selection: EditorSelectionState,
): EditorGraphConfig => {
  if (selection.selectedNodeIds.length > 0) {
    const selected = new Set(selection.selectedNodeIds);
    const nextNodes = config.nodes.filter((node) => !selected.has(node.id));
    const nextEdges = config.edges.filter((edge) => !selected.has(edge.fromNodeId) && !selected.has(edge.toNodeId));

    if (nextNodes.length === config.nodes.length && nextEdges.length === config.edges.length) {
      return config;
    }

    const hasStart = nextNodes.some((node) => node.id === config.startNodeId);
    return {
      ...config,
      startNodeId: hasStart ? config.startNodeId : nextNodes.find((node) => node.kind === "start")?.id ?? nextNodes[0]?.id ?? "",
      nodes: nextNodes,
      edges: nextEdges,
    };
  }

  if (selection.selectedEdgeId) {
    const nextEdges = config.edges.filter((edge) => edge.id !== selection.selectedEdgeId);
    if (nextEdges.length === config.edges.length) return config;
    return {
      ...config,
      edges: nextEdges,
    };
  }

  if (selection.selectedTextAnnotationId) {
    const nextTextAnnotations = config.textAnnotations.filter(
      (annotation) => annotation.id !== selection.selectedTextAnnotationId
    );
    if (nextTextAnnotations.length === config.textAnnotations.length) return config;
    return {
      ...config,
      textAnnotations: nextTextAnnotations,
    };
  }

  return config;
};
