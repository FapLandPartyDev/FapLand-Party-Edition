import type { EditorGraphConfig, EditorNode } from "./EditorState";

export type GraphAlignmentStrategy =
  | "layeredHorizontal"
  | "layeredVertical"
  | "layeredUp"
  | "snake"
  | "gridCleanup";

export type GraphAlignmentResult = {
  nodes: EditorNode[];
  changed: boolean;
};

const LAYER_GAP = 320;
const LANE_GAP = 180;
const GRID_SNAP_X = 240;
const GRID_SNAP_Y = 140;
const CANVAS_MARGIN = 120;
const DEFAULT_WIDTH = 190;
const DEFAULT_HEIGHT = 84;
const SNAKE_COLUMNS = 4;
const SNAKE_GAP_X = 168;
const SNAKE_GAP_Y = 146;
const SNAKE_PAD_X = 74;
const SNAKE_PAD_Y = 78;

type NodeMetrics = {
  index: number;
  width: number;
  height: number;
  centerX: number;
  centerY: number;
};

type RankBuildResult = {
  finalRanks: Map<string, number>;
  laneOrderByRank: Map<number, string[]>;
  sortedRanks: number[];
};

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const getNodeMetrics = (node: EditorNode, index: number): NodeMetrics => {
  const width = Math.max(64, isFiniteNumber(node.styleHint?.width) ? node.styleHint.width : DEFAULT_WIDTH);
  const height = Math.max(40, isFiniteNumber(node.styleHint?.height) ? node.styleHint.height : DEFAULT_HEIGHT);
  const x = isFiniteNumber(node.styleHint?.x) ? node.styleHint.x : index * GRID_SNAP_X;
  const y = isFiniteNumber(node.styleHint?.y) ? node.styleHint.y : 0;
  return {
    index,
    width,
    height,
    centerX: x + (width / 2),
    centerY: y + (height / 2),
  };
};

const buildMetricsById = (nodes: EditorNode[]): Map<string, NodeMetrics> => {
  const metricsById = new Map<string, NodeMetrics>();
  nodes.forEach((node, index) => {
    metricsById.set(node.id, getNodeMetrics(node, index));
  });
  return metricsById;
};

const normalizeNodes = (nodes: EditorNode[], positions: Map<string, { x: number; y: number }>): GraphAlignmentResult => {
  let changed = false;
  const nextNodes = nodes.map((node, index) => {
    const nextPosition = positions.get(node.id);
    const metrics = getNodeMetrics(node, index);
    const nextX = nextPosition?.x ?? (metrics.centerX - (metrics.width / 2));
    const nextY = nextPosition?.y ?? (metrics.centerY - (metrics.height / 2));
    const previousX = isFiniteNumber(node.styleHint?.x) ? node.styleHint.x : metrics.centerX - (metrics.width / 2);
    const previousY = isFiniteNumber(node.styleHint?.y) ? node.styleHint.y : metrics.centerY - (metrics.height / 2);

    if (Math.abs(previousX - nextX) > 0.001 || Math.abs(previousY - nextY) > 0.001) {
      changed = true;
    }

    return {
      ...node,
      styleHint: {
        ...node.styleHint,
        x: nextX,
        y: nextY,
      },
    };
  });

  return { nodes: nextNodes, changed };
};

const buildAdjacency = (config: EditorGraphConfig) => {
  const outgoing = new Map<string, string[]>();
  const incoming = new Map<string, string[]>();

  for (const node of config.nodes) {
    outgoing.set(node.id, []);
    incoming.set(node.id, []);
  }

  for (const edge of config.edges) {
    if (!outgoing.has(edge.fromNodeId) || !incoming.has(edge.toNodeId)) continue;
    outgoing.get(edge.fromNodeId)?.push(edge.toNodeId);
    incoming.get(edge.toNodeId)?.push(edge.fromNodeId);
  }

  return { outgoing, incoming };
};

const buildRanks = (config: EditorGraphConfig, metricsById: Map<string, NodeMetrics>): RankBuildResult => {
  const { outgoing, incoming } = buildAdjacency(config);

  const reachable = new Set<string>();
  const queue = [config.startNodeId];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || reachable.has(current) || !outgoing.has(current)) continue;
    reachable.add(current);
    for (const nextId of outgoing.get(current) ?? []) {
      if (!reachable.has(nextId)) queue.push(nextId);
    }
  }

  const indegree = new Map<string, number>();
  for (const node of config.nodes) {
    indegree.set(node.id, (incoming.get(node.id) ?? []).filter((fromId) => reachable.has(fromId)).length);
  }

  const topoQueue = config.nodes
    .filter((node) => reachable.has(node.id) && (indegree.get(node.id) ?? 0) === 0)
    .map((node) => node.id);
  const reachableRanks = new Map<string, number>();

  while (topoQueue.length > 0) {
    const currentId = topoQueue.shift();
    if (!currentId) continue;
    const parents = (incoming.get(currentId) ?? []).filter((parentId) => reachableRanks.has(parentId));
    const parentRank = parents.reduce((highest, parentId) => Math.max(highest, reachableRanks.get(parentId) ?? 0), -1);
    if (!reachableRanks.has(currentId)) {
      reachableRanks.set(currentId, Math.max(0, parentRank + 1));
    }
    for (const nextId of outgoing.get(currentId) ?? []) {
      if (!reachable.has(nextId)) continue;
      indegree.set(nextId, Math.max(0, (indegree.get(nextId) ?? 0) - 1));
      if ((indegree.get(nextId) ?? 0) === 0) {
        topoQueue.push(nextId);
      }
    }
  }

  const finalRanks = new Map(reachableRanks);
  const maxReachableRank = Math.max(-1, ...Array.from(reachableRanks.values()));

  for (const node of config.nodes) {
    if (!reachable.has(node.id) || finalRanks.has(node.id)) continue;
    const parents = incoming.get(node.id) ?? [];
    const inferredRank = parents.reduce((highest, parentId) => Math.max(highest, finalRanks.get(parentId) ?? -1), -1);
    finalRanks.set(node.id, Math.max(inferredRank + 1, maxReachableRank, 0));
  }

  let disconnectedRank = Math.max(-1, ...Array.from(finalRanks.values())) + 1;
  for (const node of config.nodes) {
    if (finalRanks.has(node.id)) continue;
    const parents = incoming.get(node.id) ?? [];
    const inferredRank = parents.reduce((highest, parentId) => Math.max(highest, finalRanks.get(parentId) ?? -1), -1);
    finalRanks.set(node.id, Math.max(disconnectedRank, inferredRank + 1, 0));
    disconnectedRank += 1;
  }

  const rankGroups = new Map<number, string[]>();
  for (const node of config.nodes) {
    const rank = finalRanks.get(node.id) ?? 0;
    const group = rankGroups.get(rank) ?? [];
    group.push(node.id);
    rankGroups.set(rank, group);
  }

  const sortedRanks = Array.from(rankGroups.keys()).sort((left, right) => left - right);
  const laneOrderByRank = new Map<number, string[]>();
  const previousLaneIndex = new Map<string, number>();

  for (const rank of sortedRanks) {
    const nodeIds = [...(rankGroups.get(rank) ?? [])];
    nodeIds.sort((leftId, rightId) => {
      const leftMetrics = metricsById.get(leftId);
      const rightMetrics = metricsById.get(rightId);
      const leftNeighbors = (incoming.get(leftId) ?? []).filter((nodeId) => previousLaneIndex.has(nodeId));
      const rightNeighbors = (incoming.get(rightId) ?? []).filter((nodeId) => previousLaneIndex.has(nodeId));
      const leftBarycenter = leftNeighbors.length > 0
        ? leftNeighbors.reduce((sum, nodeId) => sum + (previousLaneIndex.get(nodeId) ?? 0), 0) / leftNeighbors.length
        : Number.POSITIVE_INFINITY;
      const rightBarycenter = rightNeighbors.length > 0
        ? rightNeighbors.reduce((sum, nodeId) => sum + (previousLaneIndex.get(nodeId) ?? 0), 0) / rightNeighbors.length
        : Number.POSITIVE_INFINITY;

      if (leftBarycenter !== rightBarycenter) return leftBarycenter - rightBarycenter;
      if ((leftMetrics?.centerY ?? 0) !== (rightMetrics?.centerY ?? 0)) return (leftMetrics?.centerY ?? 0) - (rightMetrics?.centerY ?? 0);
      if ((leftMetrics?.centerX ?? 0) !== (rightMetrics?.centerX ?? 0)) return (leftMetrics?.centerX ?? 0) - (rightMetrics?.centerX ?? 0);
      return (leftMetrics?.index ?? 0) - (rightMetrics?.index ?? 0);
    });

    nodeIds.forEach((nodeId, index) => {
      previousLaneIndex.set(nodeId, index);
    });
    laneOrderByRank.set(rank, nodeIds);
  }

  return { finalRanks, laneOrderByRank, sortedRanks };
};

const computeLayeredPositions = (
  config: EditorGraphConfig,
  orientation: "horizontal" | "down" | "up",
): GraphAlignmentResult => {
  const metricsById = buildMetricsById(config.nodes);
  const { laneOrderByRank, sortedRanks } = buildRanks(config, metricsById);
  const positions = new Map<string, { x: number; y: number }>();

  const globalMaxWidth = Math.max(DEFAULT_WIDTH, ...config.nodes.map((node, index) => getNodeMetrics(node, index).width));
  const globalMaxHeight = Math.max(DEFAULT_HEIGHT, ...config.nodes.map((node, index) => getNodeMetrics(node, index).height));
  const totalRanks = sortedRanks.length;

  for (const rank of sortedRanks) {
    const nodeIds = laneOrderByRank.get(rank) ?? [];
    const rankMaxWidth = Math.max(DEFAULT_WIDTH, ...nodeIds.map((nodeId) => metricsById.get(nodeId)?.width ?? DEFAULT_WIDTH));
    const rankMaxHeight = Math.max(DEFAULT_HEIGHT, ...nodeIds.map((nodeId) => metricsById.get(nodeId)?.height ?? DEFAULT_HEIGHT));
    const verticalRankIndex = orientation === "up" ? (totalRanks - 1 - rank) : rank;

    nodeIds.forEach((nodeId, laneIndex) => {
      const metrics = metricsById.get(nodeId);
      if (!metrics) return;

      if (orientation === "horizontal") {
        const centerX = CANVAS_MARGIN + (rank * (rankMaxWidth + LAYER_GAP)) + (rankMaxWidth / 2);
        const centerY = CANVAS_MARGIN + (laneIndex * (globalMaxHeight + LANE_GAP)) + (metrics.height / 2);
        positions.set(nodeId, {
          x: centerX - (metrics.width / 2),
          y: centerY - (metrics.height / 2),
        });
        return;
      }

      const centerX = CANVAS_MARGIN + (laneIndex * (globalMaxWidth + LANE_GAP)) + (metrics.width / 2);
      const centerY = CANVAS_MARGIN + (verticalRankIndex * (rankMaxHeight + LAYER_GAP)) + (rankMaxHeight / 2);
      positions.set(nodeId, {
        x: centerX - (metrics.width / 2),
        y: centerY - (metrics.height / 2),
      });
    });
  }

  return normalizeNodes(config.nodes, positions);
};

const buildNormalizedIndices = (values: number[], snap: number): Map<number, number> => {
  const sorted = [...values].sort((left, right) => left - right);
  const result = new Map<number, number>();
  let currentIndex = -1;
  let currentAnchor = Number.NaN;

  for (const value of sorted) {
    if (!Number.isFinite(currentAnchor) || Math.abs(value - currentAnchor) > (snap * 0.6)) {
      currentIndex += 1;
      currentAnchor = value;
    }
    if (!result.has(value)) {
      result.set(value, currentIndex);
    }
  }

  return result;
};

const computeGridCleanupPositions = (config: EditorGraphConfig): GraphAlignmentResult => {
  const metrics = config.nodes.map((node, index) => ({
    node,
    ...getNodeMetrics(node, index),
  }));
  const xGroups = buildNormalizedIndices(metrics.map((entry) => entry.centerX), GRID_SNAP_X);
  const yGroups = buildNormalizedIndices(metrics.map((entry) => entry.centerY), GRID_SNAP_Y);
  const positions = new Map<string, { x: number; y: number }>();

  for (const entry of metrics) {
    const column = xGroups.get(entry.centerX) ?? 0;
    const row = yGroups.get(entry.centerY) ?? 0;
    const centerX = CANVAS_MARGIN + (column * GRID_SNAP_X);
    const centerY = CANVAS_MARGIN + (row * GRID_SNAP_Y);
    positions.set(entry.node.id, {
      x: centerX - (entry.width / 2),
      y: centerY - (entry.height / 2),
    });
  }

  return normalizeNodes(config.nodes, positions);
};

const buildTraversalOrder = (config: EditorGraphConfig): string[] => {
  const { outgoing } = buildAdjacency(config);
  const visited = new Set<string>();
  const orderedIds: string[] = [];

  const visit = (startId: string) => {
    const queue = [startId];
    while (queue.length > 0) {
      const currentId = queue.shift();
      if (!currentId || visited.has(currentId) || !outgoing.has(currentId)) continue;
      visited.add(currentId);
      orderedIds.push(currentId);
      for (const nextId of outgoing.get(currentId) ?? []) {
        if (!visited.has(nextId)) queue.push(nextId);
      }
    }
  };

  visit(config.startNodeId);
  for (const node of config.nodes) {
    if (!visited.has(node.id)) visit(node.id);
  }

  return orderedIds;
};

const computeSnakePosition = (index: number, total: number) => {
  const row = Math.floor(index / SNAKE_COLUMNS);
  const col = row % 2 === 0 ? index % SNAKE_COLUMNS : SNAKE_COLUMNS - 1 - (index % SNAKE_COLUMNS);
  const flippedRow = Math.floor((Math.max(1, total) - 1) / SNAKE_COLUMNS) - row;
  return {
    x: SNAKE_PAD_X + col * SNAKE_GAP_X,
    y: SNAKE_PAD_Y + flippedRow * SNAKE_GAP_Y,
  };
};

const computeSnakePositions = (config: EditorGraphConfig): GraphAlignmentResult => {
  const metricsById = buildMetricsById(config.nodes);
  const orderedIds = buildTraversalOrder(config);
  const positions = new Map<string, { x: number; y: number }>();

  orderedIds.forEach((nodeId, index) => {
    const metrics = metricsById.get(nodeId);
    if (!metrics) return;
    const point = computeSnakePosition(index, orderedIds.length);
    positions.set(nodeId, {
      x: point.x - (metrics.width / 2),
      y: point.y - (metrics.height / 2),
    });
  });

  return normalizeNodes(config.nodes, positions);
};

export const realignGraph = (config: EditorGraphConfig, strategy: GraphAlignmentStrategy): GraphAlignmentResult => {
  if (config.nodes.length === 0) {
    return { nodes: config.nodes, changed: false };
  }

  switch (strategy) {
    case "layeredHorizontal":
      return computeLayeredPositions(config, "horizontal");
    case "layeredVertical":
      return computeLayeredPositions(config, "down");
    case "layeredUp":
      return computeLayeredPositions(config, "up");
    case "snake":
      return computeSnakePositions(config);
    case "gridCleanup":
      return computeGridCleanupPositions(config);
    default:
      return { nodes: config.nodes, changed: false };
  }
};
