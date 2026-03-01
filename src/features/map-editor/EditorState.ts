import { getSinglePlayerAntiPerkPool, getSinglePlayerPerkPool } from "../../game/data/perks";
import type {
  GraphBackgroundFit,
  GraphBackgroundMedia,
  GraphBackgroundPosition,
  GraphBoardConfig,
  GraphBoardStyle,
  GraphRoadPalette,
  LinearBoardConfig,
  PlaylistConfig,
  PlaylistMusicTrack,
  PortableRoundRef,
} from "../../game/playlistSchema";

const DEFAULT_NODE_WIDTH = 190;
const DEFAULT_NODE_HEIGHT = 84;
const DEFAULT_LAYOUT_SPACING_X = 320;
const DEFAULT_LAYOUT_SPACING_Y = 180;
const DEFAULT_NODE_SCALE = 1;
const DEFAULT_TEXT_SIZE = 18;
const MIN_TEXT_SIZE = 10;
const MAX_TEXT_SIZE = 72;
const MAX_TEXT_LENGTH = 500;
const HEX_COLOR_PATTERN = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

const DEFAULT_BACKGROUND: Omit<GraphBackgroundMedia, "kind" | "uri" | "name"> = {
  fit: "cover",
  position: "center",
  opacity: 0.55,
  blur: 0,
  dim: 0.35,
  scale: 1,
  offsetX: 0,
  offsetY: 0,
  motion: "fixed",
  parallaxStrength: 0.18,
};

export const ROAD_PALETTE_PRESETS = [
  {
    id: "neon",
    name: "Neon",
    palette: {
      presetId: "neon",
      body: "#151a2a",
      railA: "#79ddff",
      railB: "#ff71ca",
      glow: "#8a4dff",
      center: "#b0baff",
      gate: "#ff79b4",
      marker: "#dce7ff",
    },
  },
  {
    id: "candy",
    name: "Candy",
    palette: {
      presetId: "candy",
      body: "#24131f",
      railA: "#f9a8d4",
      railB: "#67e8f9",
      glow: "#fb7185",
      center: "#fde68a",
      gate: "#f472b6",
      marker: "#ffffff",
    },
  },
  {
    id: "synth",
    name: "Synth",
    palette: {
      presetId: "synth",
      body: "#111827",
      railA: "#a78bfa",
      railB: "#22d3ee",
      glow: "#7c3aed",
      center: "#c4b5fd",
      gate: "#38bdf8",
      marker: "#f8fafc",
    },
  },
  {
    id: "mono",
    name: "Mono",
    palette: {
      presetId: "mono",
      body: "#18181b",
      railA: "#d4d4d8",
      railB: "#a1a1aa",
      glow: "#71717a",
      center: "#e4e4e7",
      gate: "#f4f4f5",
      marker: "#ffffff",
    },
  },
] as const satisfies ReadonlyArray<{ id: string; name: string; palette: GraphRoadPalette }>;

export type EditorNodeKind =
  | "start"
  | "end"
  | "path"
  | "safePoint"
  | "campfire"
  | "round"
  | "randomRound"
  | "perk"
  | "catapult";

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
  skippable?: boolean;
  randomPoolId?: string;
  checkpointRestMs?: number;
  pauseBonusMs?: number;
  visualId?: string;
  giftGuaranteedPerk?: boolean;
  catapultForward?: number;
  catapultLandingOnly?: boolean;
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

export interface EditorTextAnnotation {
  id: string;
  text: string;
  styleHint: {
    x: number;
    y: number;
    color?: string;
    size?: number;
  };
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

export type EditorGraphStyle = GraphBoardStyle;

export interface EditorGraphConfig {
  mode: "graph";
  startNodeId: string;
  nodes: EditorNode[];
  edges: EditorEdge[];
  textAnnotations: EditorTextAnnotation[];
  randomRoundPools: EditorRandomPool[];
  cumRoundRefs: PortableRoundRef[];
  pathChoiceTimeoutMs: number;
  perkSelection: PlaylistConfig["perkSelection"];
  perkPool: PlaylistConfig["perkPool"];
  probabilityScaling: PlaylistConfig["probabilityScaling"];
  economy: Pick<PlaylistConfig["economy"], "startingMoney" | "scorePerCumRoundSuccess">;
  dice: PlaylistConfig["dice"];
  saveMode: PlaylistConfig["saveMode"];
  style: EditorGraphStyle;
  music: {
    tracks: PlaylistMusicTrack[];
    loop: boolean;
  };
}

export interface GraphToLinearConversionResult {
  boardConfig: LinearBoardConfig;
  keptNodeIds: string[];
  droppedNodeIds: string[];
  droppedEdgeIds: string[];
  warnings: string[];
}

export interface ViewportState {
  x: number;
  y: number;
  zoom: number;
}

export type MapEditorTool = "select" | "place" | "connect" | "text";
export type MapRoundBulkAction = "order" | "random" | "progressive" | "difficulty";

export interface EditorSelectionState {
  selectedNodeIds: string[];
  primaryNodeId: string | null;
  selectedEdgeId: string | null;
  selectedTextAnnotationId: string | null;
}

export const EMPTY_EDITOR_SELECTION: EditorSelectionState = {
  selectedNodeIds: [],
  primaryNodeId: null,
  selectedEdgeId: null,
  selectedTextAnnotationId: null,
};

const toFiniteNumber = (value: unknown): number | null => {
  if (typeof value !== "number") return null;
  if (!Number.isFinite(value)) return null;
  return value;
};

const clamp = (value: number, min: number, max: number): number => {
  return Math.min(max, Math.max(min, value));
};

const isHexColor = (value: unknown): value is string =>
  typeof value === "string" && HEX_COLOR_PATTERN.test(value.trim());

export const getDefaultRoadPalette = (): GraphRoadPalette => ({
  ...ROAD_PALETTE_PRESETS[0].palette,
});

const normalizeColor = (value: unknown, fallback: string): string => {
  return isHexColor(value) ? value.trim() : fallback;
};

export const normalizeRoadPalette = (
  input?: Partial<GraphRoadPalette> | null
): GraphRoadPalette => {
  const fallback = getDefaultRoadPalette();
  if (!input) return fallback;
  const presetId =
    typeof input.presetId === "string" && input.presetId.trim().length > 0
      ? input.presetId.trim()
      : "custom";
  return {
    presetId,
    body: normalizeColor(input.body, fallback.body),
    railA: normalizeColor(input.railA, fallback.railA),
    railB: normalizeColor(input.railB, fallback.railB),
    glow: normalizeColor(input.glow, fallback.glow),
    center: normalizeColor(input.center, fallback.center),
    gate: normalizeColor(input.gate, fallback.gate),
    marker: normalizeColor(input.marker, fallback.marker),
  };
};

const inferBackgroundKind = (uri: string, fallback?: "image" | "video"): "image" | "video" => {
  const cleanUri = uri.split(/[?#]/u)[0]?.toLowerCase() ?? uri.toLowerCase();
  if (/\.(mp4|webm|mov|m4v|mkv)$/u.test(cleanUri)) return "video";
  if (/\.(png|jpe?g|webp|gif|avif|bmp|svg)$/u.test(cleanUri)) return "image";
  return fallback ?? "image";
};

export const normalizeGraphBackgroundMedia = (
  input?: Partial<GraphBackgroundMedia> | null
): GraphBackgroundMedia | undefined => {
  if (!input || typeof input.uri !== "string") return undefined;
  const uri = input.uri.trim();
  if (!uri) return undefined;
  const kind = inferBackgroundKind(uri, input.kind === "video" ? "video" : "image");
  const fit: GraphBackgroundFit =
    input.fit === "contain" || input.fit === "stretch" || input.fit === "tile"
      ? input.fit
      : "cover";
  const position: GraphBackgroundPosition =
    input.position === "top" ||
    input.position === "bottom" ||
    input.position === "left" ||
    input.position === "right"
      ? input.position
      : "center";
  return {
    kind,
    uri,
    ...(typeof input.name === "string" && input.name.trim().length > 0
      ? { name: input.name.trim() }
      : {}),
    fit,
    position,
    opacity: clamp(toFiniteNumber(input.opacity) ?? DEFAULT_BACKGROUND.opacity, 0, 1),
    blur: clamp(toFiniteNumber(input.blur) ?? DEFAULT_BACKGROUND.blur, 0, 24),
    dim: clamp(toFiniteNumber(input.dim) ?? DEFAULT_BACKGROUND.dim, 0, 1),
    scale: clamp(toFiniteNumber(input.scale) ?? DEFAULT_BACKGROUND.scale, 0.25, 4),
    offsetX: toFiniteNumber(input.offsetX) ?? DEFAULT_BACKGROUND.offsetX,
    offsetY: toFiniteNumber(input.offsetY) ?? DEFAULT_BACKGROUND.offsetY,
    motion: input.motion === "parallax" ? "parallax" : "fixed",
    parallaxStrength: clamp(
      toFiniteNumber(input.parallaxStrength) ?? DEFAULT_BACKGROUND.parallaxStrength,
      0,
      1
    ),
  };
};

const normalizeGraphStyle = (style?: GraphBoardStyle): EditorGraphStyle => {
  const background = normalizeGraphBackgroundMedia(style?.background);
  const roadPalette = style?.roadPalette ? normalizeRoadPalette(style.roadPalette) : undefined;
  return {
    ...(background ? { background } : {}),
    ...(roadPalette ? { roadPalette } : {}),
  };
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

const normalizeTextAnnotation = (annotation: unknown): EditorTextAnnotation | null => {
  if (typeof annotation !== "object" || annotation === null) return null;
  const candidate = annotation as {
    id?: unknown;
    text?: unknown;
    styleHint?: {
      x?: unknown;
      y?: unknown;
      color?: unknown;
      size?: unknown;
    };
  };
  if (typeof candidate.id !== "string") return null;
  const id = candidate.id.trim();
  if (!id) return null;
  if (typeof candidate.text !== "string") return null;
  const text = candidate.text.trim().slice(0, MAX_TEXT_LENGTH);
  if (!text) return null;
  const x = toFiniteNumber(candidate.styleHint?.x);
  const y = toFiniteNumber(candidate.styleHint?.y);
  if (x === null || y === null) return null;

  const styleHint: EditorTextAnnotation["styleHint"] = { x, y };
  if (
    typeof candidate.styleHint?.color === "string" &&
    candidate.styleHint.color.trim().length > 0
  ) {
    styleHint.color = candidate.styleHint.color.trim();
  }
  const size = toFiniteNumber(candidate.styleHint?.size);
  styleHint.size = size === null ? DEFAULT_TEXT_SIZE : clamp(size, MIN_TEXT_SIZE, MAX_TEXT_SIZE);

  return {
    id,
    text,
    styleHint,
  };
};

export const sanitizeNodeKind = (kind: string | undefined): EditorNodeKind => {
  if (
    kind === "start" ||
    kind === "end" ||
    kind === "path" ||
    kind === "safePoint" ||
    kind === "campfire" ||
    kind === "round" ||
    kind === "randomRound" ||
    kind === "perk" ||
    kind === "catapult"
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
    skippable: node.skippable,
    randomPoolId: node.randomPoolId,
    checkpointRestMs: typeof node.checkpointRestMs === "number" ? node.checkpointRestMs : undefined,
    pauseBonusMs: typeof node.pauseBonusMs === "number" ? node.pauseBonusMs : undefined,
    visualId: node.visualId,
    giftGuaranteedPerk: node.giftGuaranteedPerk,
    catapultForward:
      typeof (node as { catapultForward?: unknown }).catapultForward === "number"
        ? Math.max(1, Math.floor((node as { catapultForward: number }).catapultForward))
        : undefined,
    catapultLandingOnly:
      typeof (node as { catapultLandingOnly?: unknown }).catapultLandingOnly === "boolean"
        ? (node as { catapultLandingOnly: boolean }).catapultLandingOnly
        : undefined,
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

  const textAnnotations = (input.textAnnotations ?? [])
    .map((annotation) => normalizeTextAnnotation(annotation))
    .filter((annotation): annotation is EditorTextAnnotation => Boolean(annotation));

  return {
    mode: "graph",
    startNodeId: input.startNodeId,
    nodes,
    edges,
    textAnnotations,
    randomRoundPools,
    cumRoundRefs: input.cumRoundRefs.map((ref) => ({ ...ref })),
    pathChoiceTimeoutMs: clamp(Math.floor(input.pathChoiceTimeoutMs), 1000, 30000),
    perkSelection: {
      optionsPerPick: 3,
      triggerChancePerCompletedRound: 0.35,
    },
    perkPool: {
      enabledPerkIds: getSinglePlayerPerkPool().map((p) => p.id),
      enabledAntiPerkIds: getSinglePlayerAntiPerkPool().map((p) => p.id),
    },
    probabilityScaling: {
      initialIntermediaryProbability: 0.1,
      initialAntiPerkProbability: 0.1,
      intermediaryIncreasePerRound: 0.02,
      antiPerkIncreasePerRound: 0.015,
      maxIntermediaryProbability: 1,
      maxAntiPerkProbability: 0.75,
    },
    economy: {
      startingMoney: 120,
      scorePerCumRoundSuccess: 420,
    },
    dice: {
      min: 1,
      max: 6,
    },
    saveMode: "none",
    style: normalizeGraphStyle(input.style),
    music: {
      tracks: [],
      loop: true,
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

  const finalNode = nodes[nodes.length - 1];
  const finalX = toFiniteNumber(finalNode?.styleHint?.x) ?? 160;
  const finalY = toFiniteNumber(finalNode?.styleHint?.y) ?? 360;
  nodes.push({
    id: "end",
    name: "End",
    kind: "end",
    styleHint: buildDefaultNodeStyleHint({ x: finalX + DEFAULT_LAYOUT_SPACING_X, y: finalY }),
  });

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
    textAnnotations: [],
    randomRoundPools: [],
    cumRoundRefs: config.cumRoundRefs.map((ref) => ({ ...ref })),
    pathChoiceTimeoutMs: 12000,
    perkSelection: {
      optionsPerPick: 3,
      triggerChancePerCompletedRound: 0.35,
    },
    perkPool: {
      enabledPerkIds: getSinglePlayerPerkPool().map((p) => p.id),
      enabledAntiPerkIds: getSinglePlayerAntiPerkPool().map((p) => p.id),
    },
    probabilityScaling: {
      initialIntermediaryProbability: 0.1,
      initialAntiPerkProbability: 0.1,
      intermediaryIncreasePerRound: 0.02,
      antiPerkIncreasePerRound: 0.015,
      maxIntermediaryProbability: 1,
      maxAntiPerkProbability: 0.75,
    },
    economy: {
      startingMoney: 120,
      scorePerCumRoundSuccess: 420,
    },
    dice: {
      min: 1,
      max: 6,
    },
    saveMode: "none",
    style: {},
    music: {
      tracks: [],
      loop: true,
    },
  };
};

const isLinearConvertibleNodeKind = (
  kind: EditorNodeKind
): kind is "path" | "round" | "safePoint" =>
  kind === "path" || kind === "round" || kind === "safePoint";

export function convertEditorGraphToLinearBoardConfig(
  input: EditorGraphConfig
): GraphToLinearConversionResult {
  const nodeById = new Map(input.nodes.map((node) => [node.id, node]));
  const usedEdgeIds = new Set<string>();
  const visitedNodeIds = new Set<string>();
  const representedNodeIds = new Set<string>();
  const reachedEndNodeIds = new Set<string>();
  const warnings = new Set<string>();
  const safePointIndices: number[] = [];
  const safePointRestMsByIndex: Record<string, number> = {};
  const normalRoundRefsByIndex: Record<string, PortableRoundRef> = {};
  let totalIndices = 0;
  let currentNode = nodeById.get(input.startNodeId) ?? null;

  if (!currentNode) {
    warnings.add("Missing start node.");
  }

  while (currentNode) {
    if (visitedNodeIds.has(currentNode.id)) {
      warnings.add("Cycle detected while following the first path from Start.");
      break;
    }

    visitedNodeIds.add(currentNode.id);

    if (currentNode.kind === "end") {
      reachedEndNodeIds.add(currentNode.id);
      break;
    }

    if (isLinearConvertibleNodeKind(currentNode.kind)) {
      if (totalIndices < 500) {
        totalIndices += 1;
        representedNodeIds.add(currentNode.id);

        if (currentNode.kind === "round" && currentNode.roundRef) {
          normalRoundRefsByIndex[String(totalIndices)] = { ...currentNode.roundRef };
        }

        if (currentNode.kind === "safePoint") {
          safePointIndices.push(totalIndices);
          if (typeof currentNode.checkpointRestMs === "number") {
            safePointRestMsByIndex[String(totalIndices)] = Math.max(
              0,
              Math.floor(currentNode.checkpointRestMs)
            );
          }
        }
      } else {
        warnings.add("Linear playlists support at most 500 fields; extra path nodes were dropped.");
      }
    } else if (currentNode.kind !== "start") {
      warnings.add("Graph-only nodes were dropped during conversion.");
    }

    const outgoingEdges = input.edges.filter((edge) => edge.fromNodeId === currentNode?.id);
    if (outgoingEdges.length > 1) {
      warnings.add("Branches were dropped; conversion followed the first outgoing edge.");
    }

    const nextEdge = outgoingEdges[0];
    if (!nextEdge) {
      warnings.add("Path ended before reaching an end node.");
      break;
    }

    usedEdgeIds.add(nextEdge.id);
    const nextNode = nodeById.get(nextEdge.toNodeId);
    if (!nextNode) {
      warnings.add("Path references a missing node.");
      break;
    }

    currentNode = nextNode;
  }

  const keptNodeIds = [...representedNodeIds];
  const droppedNodeIds = input.nodes
    .filter((node) => {
      if (representedNodeIds.has(node.id)) return false;
      if (node.kind === "start") return false;
      if (node.kind === "end" && reachedEndNodeIds.has(node.id)) return false;
      return true;
    })
    .map((node) => node.id);
  const droppedEdgeIds = input.edges
    .filter((edge) => !usedEdgeIds.has(edge.id))
    .map((edge) => edge.id);

  if (
    droppedNodeIds.some((nodeId) => {
      const node = nodeById.get(nodeId);
      return node ? !isLinearConvertibleNodeKind(node.kind) && node.kind !== "end" : false;
    })
  ) {
    warnings.add("Graph-only nodes were dropped during conversion.");
  }

  return {
    boardConfig: {
      mode: "linear",
      totalIndices: Math.max(1, totalIndices),
      safePointIndices,
      safePointRestMsByIndex,
      normalRoundRefsByIndex,
      normalRoundOrder: [],
      cumRoundRefs: input.cumRoundRefs.map((ref) => ({ ...ref })),
    },
    keptNodeIds,
    droppedNodeIds,
    droppedEdgeIds,
    warnings: [...warnings],
  };
}

export const toGraphBoardConfig = (input: EditorGraphConfig): GraphBoardConfig => {
  const style = normalizeGraphStyle(input.style);
  return {
    mode: "graph",
    startNodeId: input.startNodeId,
    nodes: input.nodes.map((node) => ({
      id: node.id,
      name: node.name,
      kind: sanitizeNodeKind(node.kind),
      roundRef: node.roundRef ? { ...node.roundRef } : undefined,
      forceStop: node.kind === "round" || node.kind === "perk" ? node.forceStop : undefined,
      skippable: node.kind === "round" ? node.skippable : undefined,
      randomPoolId: node.randomPoolId,
      checkpointRestMs:
        node.kind === "safePoint" && typeof node.checkpointRestMs === "number"
          ? Math.max(0, Math.floor(node.checkpointRestMs))
          : undefined,
      pauseBonusMs:
        node.kind === "campfire" && typeof node.pauseBonusMs === "number"
          ? Math.max(0, Math.floor(node.pauseBonusMs))
          : undefined,
      visualId: node.visualId,
      giftGuaranteedPerk: node.kind === "perk" ? node.giftGuaranteedPerk : undefined,
      catapultForward:
        node.kind === "catapult"
          ? typeof node.catapultForward === "number"
            ? Math.max(1, Math.floor(node.catapultForward))
            : undefined
          : undefined,
      catapultLandingOnly: node.kind === "catapult" ? node.catapultLandingOnly : undefined,
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
    textAnnotations: input.textAnnotations
      .map((annotation) => normalizeTextAnnotation(annotation))
      .filter((annotation): annotation is EditorTextAnnotation => Boolean(annotation))
      .map((annotation) => ({
        id: annotation.id,
        text: annotation.text,
        styleHint: { ...annotation.styleHint },
      })),
    randomRoundPools: input.randomRoundPools
      .map((pool) => ({
        id: pool.id,
        name: pool.name,
        candidates: pool.candidates
          .filter((candidate) =>
            Boolean(
              candidate.roundRef.name || candidate.roundRef.idHint || candidate.roundRef.phash
            )
          )
          .map((candidate) => ({
            roundRef: { ...candidate.roundRef },
            weight: Number.isFinite(candidate.weight) ? candidate.weight : 1,
          })),
      }))
      .filter((pool) => pool.id.length > 0),
    cumRoundRefs: input.cumRoundRefs.map((ref) => ({ ...ref })),
    pathChoiceTimeoutMs: clamp(Math.floor(input.pathChoiceTimeoutMs), 1000, 30000),
    ...(style.background || style.roadPalette ? { style } : {}),
  };
};
