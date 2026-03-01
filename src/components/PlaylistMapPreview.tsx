import { useMemo } from "react";
import type { PlaylistConfig } from "../game/playlistSchema";
import { layoutLinearGraphFromPlaylist, toEditorGraphConfig } from "../features/map-editor/EditorState";
import { clampPreviewNodeScale, getNodeDisplayColor, getNodeScale } from "../features/map-editor/nodeVisuals";

type PreviewNode = {
  id: string;
  kind: string;
  x: number;
  y: number;
  color: string;
  radius: number;
};

type PreviewTextAnnotation = {
  id: string;
  text: string;
  x: number;
  y: number;
  color: string;
  fontSize: number;
};

const PREVIEW_WIDTH = 320;
const PREVIEW_HEIGHT = 220;
const PREVIEW_PADDING = 18;

const PREVIEW_NODE_RADIUS = 4.2;
const PREVIEW_TEXT_COLOR = "#f8fafc";

function toFiniteNumber(value: unknown): number | null {
  if (typeof value !== "number") return null;
  if (!Number.isFinite(value)) return null;
  return value;
}

function getPreviewGraph(config: PlaylistConfig) {
  if (config.boardConfig.mode === "graph") {
    return toEditorGraphConfig(config.boardConfig);
  }
  return layoutLinearGraphFromPlaylist(config.boardConfig);
}

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

export function PlaylistMapPreview({
  config,
  className,
}: {
  config: PlaylistConfig;
  className?: string;
}) {
  const graph = useMemo(() => getPreviewGraph(config), [config]);
  const positionedNodes = useMemo<PreviewNode[]>(() => (
    graph.nodes.map((node, index) => ({
      id: node.id,
      kind: node.kind,
      x: toFiniteNumber(node.styleHint?.x) ?? (index * 220),
      y: toFiniteNumber(node.styleHint?.y) ?? 0,
      color: getNodeDisplayColor(node),
      radius: PREVIEW_NODE_RADIUS * clampPreviewNodeScale(getNodeScale(node)),
    }))
  ), [graph.nodes]);
  const positionedTextAnnotations = useMemo<PreviewTextAnnotation[]>(() => (
    graph.textAnnotations
      .map((annotation) => {
        const x = toFiniteNumber(annotation.styleHint.x);
        const y = toFiniteNumber(annotation.styleHint.y);
        if (x === null || y === null) return null;
        return {
          id: annotation.id,
          text: annotation.text,
          x,
          y,
          color: annotation.styleHint.color ?? PREVIEW_TEXT_COLOR,
          fontSize: clamp((annotation.styleHint.size ?? 18) * 0.45, 7, 14),
        };
      })
      .filter((annotation): annotation is PreviewTextAnnotation => Boolean(annotation))
  ), [graph.textAnnotations]);

  const bounds = useMemo(() => {
    if (positionedNodes.length === 0 && positionedTextAnnotations.length === 0) {
      return {
        minX: 0,
        minY: 0,
        maxX: 1,
        maxY: 1,
      };
    }

    const xValues = [
      ...positionedNodes.map((node) => node.x),
      ...positionedTextAnnotations.map((annotation) => annotation.x),
    ];
    const yValues = [
      ...positionedNodes.map((node) => node.y),
      ...positionedTextAnnotations.map((annotation) => annotation.y),
    ];

    return {
      minX: Math.min(...xValues),
      minY: Math.min(...yValues),
      maxX: Math.max(...xValues),
      maxY: Math.max(...yValues),
    };
  }, [positionedNodes, positionedTextAnnotations]);

  const projectedNodes = useMemo(() => {
    const rangeX = Math.max(1, bounds.maxX - bounds.minX);
    const rangeY = Math.max(1, bounds.maxY - bounds.minY);
    const scale = Math.min(
      (PREVIEW_WIDTH - (PREVIEW_PADDING * 2)) / rangeX,
      (PREVIEW_HEIGHT - (PREVIEW_PADDING * 2)) / rangeY,
    );

    return positionedNodes.map((node) => ({
      ...node,
      px: PREVIEW_PADDING + ((node.x - bounds.minX) * scale),
      py: PREVIEW_PADDING + ((node.y - bounds.minY) * scale),
    }));
  }, [bounds.maxX, bounds.maxY, bounds.minX, bounds.minY, positionedNodes]);

  const projectedTextAnnotations = useMemo(() => {
    const rangeX = Math.max(1, bounds.maxX - bounds.minX);
    const rangeY = Math.max(1, bounds.maxY - bounds.minY);
    const scale = Math.min(
      (PREVIEW_WIDTH - (PREVIEW_PADDING * 2)) / rangeX,
      (PREVIEW_HEIGHT - (PREVIEW_PADDING * 2)) / rangeY,
    );

    return positionedTextAnnotations.map((annotation) => ({
      ...annotation,
      px: PREVIEW_PADDING + ((annotation.x - bounds.minX) * scale),
      py: PREVIEW_PADDING + ((annotation.y - bounds.minY) * scale),
    }));
  }, [bounds.maxX, bounds.maxY, bounds.minX, bounds.minY, positionedTextAnnotations]);

  const projectedNodeById = useMemo(
    () => new Map(projectedNodes.map((node) => [node.id, node])),
    [projectedNodes],
  );

  const projectedEdges = useMemo(() => (
    graph.edges
      .map((edge) => {
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
      .filter((edge): edge is { id: string; x1: number; y1: number; x2: number; y2: number } => Boolean(edge))
  ), [graph.edges, projectedNodeById]);

  if (projectedNodes.length === 0 && projectedTextAnnotations.length === 0) {
    return (
      <div className={className}>
        <div className="flex h-full items-center justify-center rounded-xl border border-zinc-700/70 bg-zinc-900/65 text-xs uppercase tracking-[0.14em] text-zinc-400">
          Empty map
        </div>
      </div>
    );
  }

  return (
    <div className={className}>
      <svg
        data-testid="playlist-map-preview"
        viewBox={`0 0 ${PREVIEW_WIDTH} ${PREVIEW_HEIGHT}`}
        className="h-full w-full rounded-xl border border-zinc-700/70 bg-zinc-950/85"
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

        {projectedTextAnnotations.map((annotation) => (
          <text
            key={annotation.id}
            data-testid="playlist-map-text-annotation"
            x={annotation.px}
            y={annotation.py}
            fill={annotation.color}
            fontSize={annotation.fontSize}
            fontFamily="var(--font-jetbrains-mono)"
            paintOrder="stroke"
            stroke="rgba(0,0,0,0.72)"
            strokeWidth={2}
          >
            {annotation.text}
          </text>
        ))}
      </svg>
    </div>
  );
}
