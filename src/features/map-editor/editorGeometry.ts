import type { EditorGraphConfig, EditorNode } from "./EditorState";

export const EDITOR_GRID_SIZE = 48;
export const SNAP_TOLERANCE_PX = 6;

export const snapToGrid = (value: number, gridSize: number = EDITOR_GRID_SIZE): number =>
  Math.round(value / gridSize) * gridSize;

export const snapPointToGrid = (
  point: { x: number; y: number },
  gridSize: number = EDITOR_GRID_SIZE
): { x: number; y: number } => ({
  x: snapToGrid(point.x, gridSize),
  y: snapToGrid(point.y, gridSize),
});

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

export const getNodeWidth = (node: EditorNode): number =>
  Math.max(64, isFiniteNumber(node.styleHint?.width) ? node.styleHint.width : 180);

export const getNodeHeight = (node: EditorNode): number =>
  Math.max(40, isFiniteNumber(node.styleHint?.height) ? node.styleHint.height : 78);

export const getNodeCenter = (node: EditorNode): { x: number; y: number } => {
  const width = getNodeWidth(node);
  const height = getNodeHeight(node);
  const x = isFiniteNumber(node.styleHint?.x) ? node.styleHint.x : 0;
  const y = isFiniteNumber(node.styleHint?.y) ? node.styleHint.y : 0;
  return { x: x + width / 2, y: y + height / 2 };
};

export const getNodeRect = (node: EditorNode): { x: number; y: number; width: number; height: number } => {
  const width = getNodeWidth(node);
  const height = getNodeHeight(node);
  const x = isFiniteNumber(node.styleHint?.x) ? node.styleHint.x : 0;
  const y = isFiniteNumber(node.styleHint?.y) ? node.styleHint.y : 0;
  return { x, y, width, height };
};

const rectsOverlap = (
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
  padding: number
): boolean =>
  a.x - padding < b.x + b.width &&
  a.x + a.width + padding > b.x &&
  a.y - padding < b.y + b.height &&
  a.y + a.height + padding > b.y;

const SMART_PLACE_DISTANCE = 280;
const SMART_PLACE_MIN_DISTANCE = 240;
const SMART_PLACE_PADDING = 24;
const SMART_PLACE_MAX_ATTEMPTS = 16;
const SMART_PLACE_ANGLE_SLICE = Math.PI / 6; // 30°

export interface SmartPlacementInput {
  sourceNode: EditorNode;
  existingNodes: ReadonlyArray<EditorNode>;
  occupiedTargetNodeIds: ReadonlySet<string>;
  snap: boolean;
  preferredDirection?: { x: number; y: number };
}

export interface SmartPlacementResult {
  center: { x: number; y: number };
}

/**
 * Finds a free slot around a source node for placing a new connected node.
 * Searches a fan of angles radiating from the source's center, preferring the
 * supplied direction (defaults to "right"). The fan widens until it finds an
 * unobstructed slot.
 */
export const findSmartPlacementSlot = (input: SmartPlacementInput): SmartPlacementResult => {
  const sourceCenter = getNodeCenter(input.sourceNode);
  const sourceWidth = getNodeWidth(input.sourceNode);
  const sourceHeight = getNodeHeight(input.sourceNode);

  const direction = input.preferredDirection ?? { x: 1, y: 0 };
  const directionMagnitude = Math.hypot(direction.x, direction.y) || 1;
  const baseAngle = Math.atan2(direction.y / directionMagnitude, direction.x / directionMagnitude);

  const blockedRects = input.existingNodes
    .filter((node) => node.id !== input.sourceNode.id)
    .map((node) => getNodeRect(node));

  const sourceRect = {
    x: sourceCenter.x - sourceWidth / 2,
    y: sourceCenter.y - sourceHeight / 2,
    width: sourceWidth,
    height: sourceHeight,
  };

  for (let attempt = 0; attempt < SMART_PLACE_MAX_ATTEMPTS; attempt += 1) {
    const ringIndex = Math.floor(attempt / 5);
    const slotIndex = attempt % 5;
    const angleOffset =
      slotIndex === 0 ? 0 : (slotIndex % 2 === 0 ? 1 : -1) * Math.ceil(slotIndex / 2) * SMART_PLACE_ANGLE_SLICE;
    const angle = baseAngle + angleOffset;
    const distance = SMART_PLACE_DISTANCE + ringIndex * 80;

    const candidateCenter = {
      x: sourceCenter.x + Math.cos(angle) * distance,
      y: sourceCenter.y + Math.sin(angle) * distance,
    };

    if (input.snap) {
      const snapped = snapPointToGrid(candidateCenter);
      candidateCenter.x = snapped.x;
      candidateCenter.y = snapped.y;
    }

    const candidateRect = {
      x: candidateCenter.x - sourceWidth / 2,
      y: candidateCenter.y - sourceHeight / 2,
      width: sourceWidth,
      height: sourceHeight,
    };

    if (rectsOverlap(candidateRect, sourceRect, SMART_PLACE_PADDING)) continue;

    const collides = blockedRects.some((rect) =>
      rectsOverlap(candidateRect, rect, SMART_PLACE_PADDING)
    );
    if (collides) continue;

    // ensure minimum distance from source so we don't tuck in too close
    const distFromSource = Math.hypot(
      candidateCenter.x - sourceCenter.x,
      candidateCenter.y - sourceCenter.y
    );
    if (distFromSource < SMART_PLACE_MIN_DISTANCE * 0.75) continue;

    return { center: candidateCenter };
  }

  // Fallback: just place to the right of the source, regardless of overlap.
  const fallback = {
    x: sourceCenter.x + sourceWidth / 2 + SMART_PLACE_DISTANCE,
    y: sourceCenter.y,
  };
  return {
    center: input.snap ? snapPointToGrid(fallback) : fallback,
  };
};

export interface NodeBoundsResult {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export const computeNodeBounds = (
  nodes: ReadonlyArray<EditorNode>,
  textAnnotations: ReadonlyArray<{ styleHint: { x: number; y: number; size?: number } }> = []
): NodeBoundsResult | null => {
  if (nodes.length === 0 && textAnnotations.length === 0) return null;

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const node of nodes) {
    const rect = getNodeRect(node);
    if (rect.x < minX) minX = rect.x;
    if (rect.y < minY) minY = rect.y;
    if (rect.x + rect.width > maxX) maxX = rect.x + rect.width;
    if (rect.y + rect.height > maxY) maxY = rect.y + rect.height;
  }

  for (const annotation of textAnnotations) {
    const x = annotation.styleHint.x;
    const y = annotation.styleHint.y;
    const size = annotation.styleHint.size ?? 18;
    if (x < minX) minX = x;
    if (y - size < minY) minY = y - size;
    if (x + size * 6 > maxX) maxX = x + size * 6;
    if (y + size > maxY) maxY = y + size;
  }

  if (!Number.isFinite(minX) || !Number.isFinite(maxX)) return null;

  return { minX, minY, maxX, maxY };
};

export const computeAlignmentGuides = (
  draggedNodeIds: ReadonlySet<string>,
  nodes: ReadonlyArray<EditorNode>,
  draggedCenter: { x: number; y: number },
  tolerance: number = SNAP_TOLERANCE_PX
): { x: { value: number; from: number; to: number } | null; y: { value: number; from: number; to: number } | null } => {
  let xGuide: { value: number; from: number; to: number } | null = null;
  let yGuide: { value: number; from: number; to: number } | null = null;

  for (const node of nodes) {
    if (draggedNodeIds.has(node.id)) continue;
    const center = getNodeCenter(node);
    if (Math.abs(center.x - draggedCenter.x) <= tolerance) {
      const yMin = Math.min(center.y, draggedCenter.y);
      const yMax = Math.max(center.y, draggedCenter.y);
      xGuide = { value: center.x, from: yMin, to: yMax };
    }
    if (Math.abs(center.y - draggedCenter.y) <= tolerance) {
      const xMin = Math.min(center.x, draggedCenter.x);
      const xMax = Math.max(center.x, draggedCenter.x);
      yGuide = { value: center.y, from: xMin, to: xMax };
    }
    if (xGuide && yGuide) break;
  }

  return { x: xGuide, y: yGuide };
};

export const cloneNodeWithOffset = (
  node: EditorNode,
  offsetX: number,
  offsetY: number,
  generateId: (prefix: string) => string
): EditorNode => {
  const baseX = isFiniteNumber(node.styleHint?.x) ? node.styleHint.x : 0;
  const baseY = isFiniteNumber(node.styleHint?.y) ? node.styleHint.y : 0;
  return {
    ...node,
    id: generateId(node.kind),
    name: `${node.name} Copy`,
    styleHint: {
      ...node.styleHint,
      x: baseX + offsetX,
      y: baseY + offsetY,
    },
    roundPlaylistRefs: node.roundPlaylistRefs?.map((ref) => ({ ...ref })),
  };
};

export const computeFitViewport = (
  bounds: NodeBoundsResult,
  containerSize: { width: number; height: number },
  padding: number = 80
): { x: number; y: number; zoom: number } => {
  const width = Math.max(1, bounds.maxX - bounds.minX);
  const height = Math.max(1, bounds.maxY - bounds.minY);
  const availableWidth = Math.max(64, containerSize.width - padding * 2);
  const availableHeight = Math.max(64, containerSize.height - padding * 2);
  const zoom = Math.min(2, Math.max(0.35, Math.min(availableWidth / width, availableHeight / height)));
  return {
    zoom,
    x: padding + (availableWidth - width * zoom) / 2 - bounds.minX * zoom,
    y: padding + (availableHeight - height * zoom) / 2 - bounds.minY * zoom,
  };
};

export const nodesOverlapRect = (
  nodes: ReadonlyArray<EditorNode>,
  rect: { x: number; y: number; width: number; height: number },
  viewport: { x: number; y: number; zoom: number }
): string[] => {
  const result: string[] = [];
  for (const node of nodes) {
    const center = getNodeCenter(node);
    const width = getNodeWidth(node) * viewport.zoom;
    const height = getNodeHeight(node) * viewport.zoom;
    const screenX = center.x * viewport.zoom + viewport.x;
    const screenY = center.y * viewport.zoom + viewport.y;
    if (
      screenX + width / 2 >= rect.x &&
      screenX - width / 2 <= rect.x + rect.width &&
      screenY + height / 2 >= rect.y &&
      screenY - height / 2 <= rect.y + rect.height
    ) {
      result.push(node.id);
    }
  }
  return result;
};

export const getReachableFrontier = (config: EditorGraphConfig, nodeId: string): string[] => {
  const visited = new Set<string>([nodeId]);
  const queue = [nodeId];
  const outgoing = new Map<string, string[]>();
  for (const edge of config.edges) {
    const list = outgoing.get(edge.fromNodeId) ?? [];
    list.push(edge.toNodeId);
    outgoing.set(edge.fromNodeId, list);
  }
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) continue;
    for (const next of outgoing.get(current) ?? []) {
      if (!visited.has(next)) {
        visited.add(next);
        queue.push(next);
      }
    }
  }
  return [...visited];
};
