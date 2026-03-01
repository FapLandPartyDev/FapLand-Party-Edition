import type {
  GraphBoardConfig,
  LinearBoardConfig,
  PlaylistConfig,
  PortableRoundRef,
} from "../../game/playlistSchema";

const DEFAULT_NODE_WIDTH = 190;
const DEFAULT_NODE_HEIGHT = 84;
const DEFAULT_LAYOUT_SPACING_X = 320;
const DEFAULT_LAYOUT_SPACING_Y = 180;
const DEFAULT_NODE_SCALE = 1;

export type EditorNodeKind =
  | "start"
  | "end"
  | "path"
  | "safePoint"
  | "round"
  | "randomRound"
  | "perk"
  | "event";

export interface EditorStyleHint {
  x?: number;
  y?: number;
  color?: string;
  icon?: string;
  size?: number;
  width?: number;
  height?: number;
}

export interface EditorNode {
  id: string;
  name: string;
  kind: EditorNodeKind;
  roundRef?: PortableRoundRef;
  forceStop?: boolean;
  randomPoolId?: string;
  checkpointRestMs?: number;
  visualId?: string;
  styleHint?: EditorStyleHint;
}

export interface EditorEdge {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  gateCost?: number;
  weight?: number;
  label?: string;
}

export interface EditorRandomPoolCandidate {
  roundRef: PortableRoundRef;
  weight: number;
}

export interface EditorRandomPool {
  id: string;
  name?: string;
  candidates: EditorRandomPoolCandidate[];
}

export interface EditorGraphConfig {
  mode: "graph";
  startNodeId: string;
  nodes: EditorNode[];
  edges: EditorEdge[];
  randomRoundPools: EditorRandomPool[];
  cumRoundRefs: PortableRoundRef[];
  pathChoiceTimeoutMs: number;
  perkSelection: PlaylistConfig["perkSelection"];
  perkPool: PlaylistConfig["perkPool"];
  probabilityScaling: PlaylistConfig["probabilityScaling"];
  economy: Pick<PlaylistConfig["economy"], "scorePerCumRoundSuccess">;
}

export interface ViewportState {
  x: number;
  y: number;
  zoom: number;
}

export type MapEditorTool = "select" | "place" | "connect";

export interface EditorSelectionState {
  selectedNodeIds: string[];
  primaryNodeId: string | null;
  selectedEdgeId: string | null;
}

export const EMPTY_EDITOR_SELECTION: EditorSelectionState = {
  selectedNodeIds: [],
  primaryNodeId: null,
  selectedEdgeId: null,
};

const toFiniteNumber = (value: unknown): number | null => {
  if (typeof value !== "number") return null;
  if (!Number.isFinite(value)) return null;
  return value;
};

const clamp = (value: number, min: number, max: number): number => {
  return Math.min(max, Math.max(min, value));
};

export const createEditorId = (prefix: string): string => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

export const buildDefaultNodeStyleHint = (position: { x: number; y: number }): EditorStyleHint => ({
  x: position.x,
  y: position.y,
  width: DEFAULT_NODE_WIDTH,
  height: DEFAULT_NODE_HEIGHT,
  size: DEFAULT_NODE_SCALE,
});

const normalizeStyleHint = (styleHint?: EditorStyleHint): EditorStyleHint | undefined => {
  if (!styleHint) return undefined;

  const next: EditorStyleHint = {};

  const x = toFiniteNumber(styleHint.x);
  const y = toFiniteNumber(styleHint.y);
  const size = toFiniteNumber(styleHint.size);
  const width = toFiniteNumber(styleHint.width);
  const height = toFiniteNumber(styleHint.height);

  if (x !== null) next.x = x;
  if (y !== null) next.y = y;
  if (size !== null) next.size = Math.max(0.5, size);
  if (width !== null) next.width = Math.max(64, width);
  if (height !== null) next.height = Math.max(40, height);

  if (typeof styleHint.color === "string" && styleHint.color.trim().length > 0) {
    next.color = styleHint.color.trim();
  }
  if (typeof styleHint.icon === "string" && styleHint.icon.trim().length > 0) {
    next.icon = styleHint.icon.trim();
  }

  if (Object.keys(next).length === 0) return undefined;
  return next;
};

export const sanitizeNodeKind = (kind: string | undefined): EditorNodeKind => {
  if (
    kind === "start"
    || kind === "end"
    || kind === "path"
    || kind === "safePoint"
    || kind === "round"
    || kind === "randomRound"
    || kind === "perk"
    || kind === "event"
  ) {
    return kind;
  }

  return "path";
};

export const toEditorGraphConfig = (input: GraphBoardConfig): EditorGraphConfig => {
  const nodes: EditorNode[] = input.nodes.map((node, index) => ({
    id: node.id,
    name: node.name,
    kind: sanitizeNodeKind(node.kind),
    roundRef: node.roundRef ? { ...node.roundRef } : undefined,
    forceStop: node.forceStop,
    randomPoolId: node.randomPoolId,
    checkpointRestMs: typeof node.checkpointRestMs === "number" ? node.checkpointRestMs : undefined,
    visualId: node.visualId,
    styleHint: {
      x: toFiniteNumber(node.styleHint?.x) ?? index * 220,
      y: toFiniteNumber(node.styleHint?.y) ?? 0,
      ...normalizeStyleHint(node.styleHint),
    },
  }));

  const edges = input.edges.map((edge) => ({
    id: edge.id,
    fromNodeId: edge.fromNodeId,
    toNodeId: edge.toNodeId,
    gateCost: edge.gateCost,
    weight: edge.weight,
    label: edge.label,
  }));

  const randomRoundPools = input.randomRoundPools.map((pool) => ({
    id: pool.id,
    name: pool.name,
    candidates: pool.candidates.map((candidate) => ({
      roundRef: { ...candidate.roundRef },
      weight: candidate.weight,
    })),
  }));

  return {
    mode: "graph",
    startNodeId: input.startNodeId,
    nodes,
    edges,
    randomRoundPools,
    cumRoundRefs: input.cumRoundRefs.map((ref) => ({ ...ref })),
    pathChoiceTimeoutMs: clamp(Math.floor(input.pathChoiceTimeoutMs), 1000, 30000),
    perkSelection: {
      optionsPerPick: 3,
      triggerChancePerCompletedRound: 0.35,
    },
    perkPool: {
      enabledPerkIds: [],
      enabledAntiPerkIds: [],
    },
    probabilityScaling: {
      initialIntermediaryProbability: 0,
      initialAntiPerkProbability: 0,
      intermediaryIncreasePerRound: 0.02,
      antiPerkIncreasePerRound: 0.015,
      maxIntermediaryProbability: 0.85,
      maxAntiPerkProbability: 0.75,
    },
    economy: {
      scorePerCumRoundSuccess: 120,
    },
  };
};

export const layoutLinearGraphFromPlaylist = (config: LinearBoardConfig): EditorGraphConfig => {
  const explicitRefs = Object.entries(config.normalRoundRefsByIndex)
    .map(([rawIndex, ref]) => {
      const index = Number.parseInt(rawIndex, 10);
      if (!Number.isInteger(index) || index < 1) return null;
      return [index, ref] as const;
    })
    .filter((entry): entry is [number, PortableRoundRef] => Boolean(entry))
    .reduce<Record<number, PortableRoundRef>>((acc, [index, ref]) => {
      acc[index] = { ...ref };
      return acc;
    }, {});

  const queue = [...config.normalRoundOrder];
  const nodes: EditorNode[] = [
    {
      id: "start",
      name: "Start",
      kind: "start",
      styleHint: buildDefaultNodeStyleHint({ x: 160, y: 360 }),
    },
  ];

  const safeSet = new Set<number>(config.safePointIndices);
  let queueCursor = 0;

  for (let index = 1; index <= Math.max(1, config.totalIndices); index += 1) {
    const column = Math.floor((index - 1) / 8);
    const row = (index - 1) % 8;
    const x = 360 + column * DEFAULT_LAYOUT_SPACING_X;
    const y = 150 + row * DEFAULT_LAYOUT_SPACING_Y;
    const explicitRef = explicitRefs[index];
    const hasQueuedRoundRef = queueCursor < queue.length;

    if (safeSet.has(index)) {
      nodes.push({
        id: `safe-${index}`,
        name: `Safe Point ${index}`,
        kind: "safePoint",
        checkpointRestMs: config.safePointRestMsByIndex[String(index)],
        styleHint: buildDefaultNodeStyleHint({ x, y }),
      });
      continue;
    }

    if (explicitRef || hasQueuedRoundRef) {
      const activeRoundRef = explicitRef ?? queue[queueCursor];
      if (!explicitRef) {
        queueCursor += 1;
      }
      nodes.push({
        id: `round-${index}`,
        name: index === config.totalIndices ? `Final Round ${index}` : `Round ${index}`,
        kind: "round",
        roundRef: activeRoundRef,
        styleHint: buildDefaultNodeStyleHint({ x, y }),
      });
      continue;
    }

    nodes.push({
      id: `path-${index}`,
      name: index === config.totalIndices ? "End Path" : `Path ${index}`,
      kind: "path",
      styleHint: buildDefaultNodeStyleHint({ x, y }),
    });
  }

  const edges = nodes.slice(0, -1).map((node, index) => ({
    id: `edge-${node.id}-${nodes[index + 1]?.id ?? "end"}`,
    fromNodeId: node.id,
    toNodeId: nodes[index + 1]?.id ?? node.id,
    gateCost: 0,
    weight: 1,
  }));

  return {
    mode: "graph",
    startNodeId: "start",
    nodes,
    edges,
    randomRoundPools: [],
    cumRoundRefs: config.cumRoundRefs.map((ref) => ({ ...ref })),
    pathChoiceTimeoutMs: 6000,
    perkSelection: {
      optionsPerPick: 3,
      triggerChancePerCompletedRound: 0.35,
    },
    perkPool: {
      enabledPerkIds: [],
      enabledAntiPerkIds: [],
    },
    probabilityScaling: {
      initialIntermediaryProbability: 0,
      initialAntiPerkProbability: 0,
      intermediaryIncreasePerRound: 0.02,
      antiPerkIncreasePerRound: 0.015,
      maxIntermediaryProbability: 0.85,
      maxAntiPerkProbability: 0.75,
    },
    economy: {
      scorePerCumRoundSuccess: 120,
    },
  };
};

export const toGraphBoardConfig = (input: EditorGraphConfig): GraphBoardConfig => ({
  mode: "graph",
  startNodeId: input.startNodeId,
  nodes: input.nodes.map((node) => ({
    id: node.id,
    name: node.name,
    kind: sanitizeNodeKind(node.kind),
    roundRef: node.roundRef ? { ...node.roundRef } : undefined,
    forceStop: node.kind === "round" ? node.forceStop : undefined,
    randomPoolId: node.randomPoolId,
    checkpointRestMs: typeof node.checkpointRestMs === "number" ? Math.max(0, Math.floor(node.checkpointRestMs)) : undefined,
    visualId: node.visualId,
    styleHint: normalizeStyleHint(node.styleHint),
  })),
  edges: input.edges.map((edge) => ({
    id: edge.id,
    fromNodeId: edge.fromNodeId,
    toNodeId: edge.toNodeId,
    gateCost: edge.gateCost,
    weight: edge.weight,
    label: edge.label,
  })),
  randomRoundPools: input.randomRoundPools
    .map((pool) => ({
      id: pool.id,
      name: pool.name,
      candidates: pool.candidates
        .filter((candidate) => Boolean(candidate.roundRef.name || candidate.roundRef.idHint || candidate.roundRef.phash))
        .map((candidate) => ({
          roundRef: { ...candidate.roundRef },
          weight: Number.isFinite(candidate.weight) ? candidate.weight : 1,
        })),
    }))
    .filter((pool) => pool.id.length > 0),
  cumRoundRefs: input.cumRoundRefs.map((ref) => ({ ...ref })),
  pathChoiceTimeoutMs: clamp(Math.floor(input.pathChoiceTimeoutMs), 1000, 30000),
});
