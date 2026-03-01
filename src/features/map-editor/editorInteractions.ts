import type { EditorGraphConfig, EditorNode, EditorSelectionState, ViewportState } from "./EditorState";

type SelectionRect = {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
};

type NodeIntersectionOptions = {
  nodeMinWidth?: number;
  nodeMinHeight?: number;
};

const DEFAULT_NODE_MIN_WIDTH = 160;
const DEFAULT_NODE_MIN_HEIGHT = 58;

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
  };
};

export const getNodesIntersectingScreenRect = (
  nodes: EditorNode[],
  viewport: ViewportState,
  rect: SelectionRect,
  options?: NodeIntersectionOptions,
): string[] => {
  const normalized = normalizeRect(rect);
  const minWidth = options?.nodeMinWidth ?? DEFAULT_NODE_MIN_WIDTH;
  const minHeight = options?.nodeMinHeight ?? DEFAULT_NODE_MIN_HEIGHT;
  const hits: string[] = [];

  for (const node of nodes) {
    if (!node.styleHint) continue;
    const x = Number(node.styleHint.x);
    const y = Number(node.styleHint.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;

    const width = Math.max(minWidth, Number.isFinite(node.styleHint.width) ? Number(node.styleHint.width) : 180);
    const height = Math.max(minHeight, Number.isFinite(node.styleHint.height) ? Number(node.styleHint.height) : 78);

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

  return config;
};
