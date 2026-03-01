import { useMemo } from "react";
import { MapBackgroundMedia } from "./MapBackgroundMedia";
import type { PlaylistConfig } from "../game/playlistSchema";
import {
  layoutLinearGraphFromPlaylist,
  toEditorGraphConfig,
} from "../features/map-editor/EditorState";
import {
  clampPreviewNodeScale,
  getNodeDisplayColor,
  getNodeScale,
} from "../features/map-editor/nodeVisuals";

type PreviewNode = {
  id: string;
  kind: string;
  x: number;
  y: number;
  color: string;
  radius: number;
};

const PREVIEW_WIDTH = 320;
const PREVIEW_HEIGHT = 220;
const PREVIEW_PADDING = 18;

const PREVIEW_NODE_RADIUS = 4.2;

function toFiniteNumber(value: unknown): number | null {
  if (typeof value !== "number") return null;
  if (!Number.isFinite(value)) return null;
  return value;
}

function getPreviewGraph(config: PlaylistConfig) {
  if (config.boardConfig.mode === "graph") {
    return toEditorGraphConfig(config.boardConfig);
  }
  if (config.boardConfig.mode === "endless") {
    return layoutLinearGraphFromPlaylist({
      mode: "linear",
      totalIndices: config.boardConfig.initialBatchSize,
      safePointIndices: [],
      safePointRestMsByIndex: {},
      normalRoundRefsByIndex: {},
      normalRoundOrder: [],
      cumRoundRefs: [],
    });
  }
  return layoutLinearGraphFromPlaylist(config.boardConfig);
}

export function PlaylistMapPreview({
  config,
  className,
}: {
  config: PlaylistConfig;
  className?: string;
}) {
  const graph = useMemo(() => getPreviewGraph(config), [config]);
  const visibleNodeIds = useMemo(
    () => new Set(graph.nodes.filter((node) => !node.hiddenFromMap).map((node) => node.id)),
    [graph.nodes]
  );
  const positionedNodes = useMemo<PreviewNode[]>(
    () =>
      graph.nodes
        .filter((node) => visibleNodeIds.has(node.id))
        .map((node, index) => ({
          id: node.id,
          kind: node.kind,
          x: toFiniteNumber(node.styleHint?.x) ?? index * 220,
          y: toFiniteNumber(node.styleHint?.y) ?? 0,
          color: getNodeDisplayColor(node),
          radius: PREVIEW_NODE_RADIUS * clampPreviewNodeScale(getNodeScale(node)),
        })),
    [graph.nodes, visibleNodeIds]
  );

  const bounds = useMemo(() => {
    if (positionedNodes.length === 0) {
      return { minX: 0, minY: 0, maxX: 1, maxY: 1 };
    }

    const allX = positionedNodes.map((node) => node.x);
    const allY = positionedNodes.map((node) => node.y);
    return {
      minX: Math.min(...allX),
      minY: Math.min(...allY),
      maxX: Math.max(...allX),
      maxY: Math.max(...allY),
    };
  }, [positionedNodes]);

  const projectedNodes = useMemo(() => {
    const rangeX = Math.max(1, bounds.maxX - bounds.minX);
    const rangeY = Math.max(1, bounds.maxY - bounds.minY);
    const scale = Math.min(
      (PREVIEW_WIDTH - PREVIEW_PADDING * 2) / rangeX,
      (PREVIEW_HEIGHT - PREVIEW_PADDING * 2) / rangeY
    );

    return positionedNodes.map((node) => ({
      ...node,
      px: PREVIEW_PADDING + (node.x - bounds.minX) * scale,
      py: PREVIEW_PADDING + (node.y - bounds.minY) * scale,
    }));
  }, [bounds.maxX, bounds.maxY, bounds.minX, bounds.minY, positionedNodes]);
  const projectedNodeById = useMemo(
    () => new Map(projectedNodes.map((node) => [node.id, node])),
    [projectedNodes]
  );

  const projectedEdges = useMemo(
    () =>
      graph.edges
        .map((edge) => {
          if (!visibleNodeIds.has(edge.fromNodeId) || !visibleNodeIds.has(edge.toNodeId))
            return null;
          const fromNode = projectedNodeById.get(edge.fromNodeId);
          const toNode = projectedNodeById.get(edge.toNodeId);
          if (!fromNode || !toNode) return null;
          return {
            id: edge.id,
            x1: fromNode.px,
            y1: fromNode.py,
            x2: toNode.px,
            y2: toNode.py,
          };
        })
        .filter((edge): edge is { id: string; x1: number; y1: number; x2: number; y2: number } =>
          Boolean(edge)
        ),
    [graph.edges, projectedNodeById, visibleNodeIds]
  );

  if (projectedNodes.length === 0) {
    return (
      <div className={className}>
        <div className="flex h-full items-center justify-center rounded-xl border border-zinc-700/70 bg-zinc-900/65 text-xs uppercase tracking-[0.14em] text-zinc-400">
          Empty map
        </div>
      </div>
    );
  }

  return (
    <div className={`relative overflow-hidden rounded-xl ${className ?? ""}`}>
      <MapBackgroundMedia
        background={graph.style.background}
        className="z-0"
        testId="playlist-map-preview-background"
      />
      <svg
        data-testid="playlist-map-preview"
        viewBox={`0 0 ${PREVIEW_WIDTH} ${PREVIEW_HEIGHT}`}
        className="relative z-10 h-full w-full rounded-xl border border-zinc-700/70 bg-zinc-950/75"
        aria-label="Playlist map preview"
      >
        <rect x={0} y={0} width={PREVIEW_WIDTH} height={PREVIEW_HEIGHT} fill="#09090b" />

        {projectedEdges.map((edge) => (
          <line
            key={edge.id}
            data-testid="playlist-map-edge"
            x1={edge.x1}
            y1={edge.y1}
            x2={edge.x2}
            y2={edge.y2}
            stroke="#64748b"
            strokeOpacity={0.68}
            strokeWidth={1.4}
          />
        ))}

        {projectedNodes.map((node) => (
          <g key={node.id}>
            <circle
              data-testid="playlist-map-node"
              cx={node.px}
              cy={node.py}
              r={node.radius}
              fill={node.color}
              stroke="#e2e8f0"
              strokeOpacity={0.5}
              strokeWidth={0.85}
            />
          </g>
        ))}
      </svg>
    </div>
  );
}
