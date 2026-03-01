import { useCallback, useEffect, useId, useMemo, useRef, useState, type JSX, type MouseEvent, type WheelEvent } from "react";
import type { EditorGraphConfig, EditorNode, EditorSelectionState, MapEditorTool, ViewportState } from "./EditorState";
import { getNodesIntersectingScreenRect, mergeNodeSelection, replaceNodeSelection, toggleNodeSelection } from "./editorInteractions";

type Interaction =
  | {
      kind: "pan";
      clientX: number;
      clientY: number;
      viewportX: number;
      viewportY: number;
      zoom: number;
    }
  | {
      kind: "nodeDrag";
      nodeIds: string[];
      lastWorldX: number;
      lastWorldY: number;
    }
  | {
      kind: "marquee";
      anchorX: number;
      anchorY: number;
      currentX: number;
      currentY: number;
      additive: boolean;
      baseSelection: EditorSelectionState;
    }
  | null;

type EditorCanvasProps = {
  config: EditorGraphConfig;
  selection: EditorSelectionState;
  connectFromNodeId: string | null;
  tool: MapEditorTool;
  activePlacementKind: EditorNode["kind"] | null;
  viewport: ViewportState;
  showGrid: boolean;
  spacePanActive: boolean;
  recentlyPlacedNodeIds?: string[];
  recentlyTouchedEdgeIds?: string[];
  onViewportChange: (next: ViewportState) => void;
  onSelectionChange: (next: EditorSelectionState) => void;
  onSetConnectFrom: (nodeId: string | null) => void;
  onMoveNodes: (nodeIds: string[], deltaWorldX: number, deltaWorldY: number) => void;
  onCreateEdge: (fromNodeId: string, toNodeId: string) => void;
  onDeleteEdgeBetween: (fromNodeId: string, toNodeId: string) => void;
  onDeleteSelection: () => void;
  onPlaceNodeAtWorld: (kind: EditorNode["kind"], worldX: number, worldY: number) => void;
  onBeginNodeDrag?: () => void;
  onEndNodeDrag?: () => void;
};

const NODE_MIN_WIDTH = 160;
const NODE_MIN_HEIGHT = 58;
const WORLD_ZOOM_MIN = 0.35;
const WORLD_ZOOM_MAX = 2;
const EDGE_COLOR = "#94a3b8";

const KIND_COLORS: Record<EditorNode["kind"], string> = {
  start: "#a78bfa",
  end: "#f97316",
  path: "#6b7280",
  safePoint: "#22c55e",
  round: "#38bdf8",
  randomRound: "#f59e0b",
  perk: "#ec4899",
  event: "#8b5cf6",
};

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

const trimOrNull = (value: string | undefined): string | null => {
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const toScreenSpace = (world: { x: number; y: number }, viewport: ViewportState): { x: number; y: number } => ({
  x: world.x * viewport.zoom + viewport.x,
  y: world.y * viewport.zoom + viewport.y,
});

const toWorldSpace = (screen: { x: number; y: number }, viewport: ViewportState): { x: number; y: number } => ({
  x: (screen.x - viewport.x) / viewport.zoom,
  y: (screen.y - viewport.y) / viewport.zoom,
});

const getRectCenter = (rect: { x: number; y: number; width: number; height: number }): { x: number; y: number } => ({
  x: rect.x + (rect.width * 0.5),
  y: rect.y + (rect.height * 0.5),
});

const getRectConnectionPoint = (
  rect: { x: number; y: number; width: number; height: number },
  target: { x: number; y: number },
): { x: number; y: number } => {
  const center = getRectCenter(rect);
  const dx = target.x - center.x;
  const dy = target.y - center.y;
  if (Math.abs(dx) < 0.001 && Math.abs(dy) < 0.001) {
    return center;
  }

  const halfWidth = rect.width * 0.5;
  const halfHeight = rect.height * 0.5;
  const scale = 1 / Math.max(Math.abs(dx) / Math.max(halfWidth, 1), Math.abs(dy) / Math.max(halfHeight, 1));

  return {
    x: center.x + (dx * scale),
    y: center.y + (dy * scale),
  };
};

const getTrimmedEdgePoints = (
  sourceRect: { x: number; y: number; width: number; height: number },
  targetRect: { x: number; y: number; width: number; height: number },
): { x1: number; y1: number; x2: number; y2: number } | null => {
  const sourceCenter = getRectCenter(sourceRect);
  const targetCenter = getRectCenter(targetRect);
  const start = getRectConnectionPoint(sourceRect, targetCenter);
  const end = getRectConnectionPoint(targetRect, sourceCenter);

  if (Math.hypot(end.x - start.x, end.y - start.y) < 1) {
    return null;
  }

  return {
    x1: start.x,
    y1: start.y,
    x2: end.x,
    y2: end.y,
  };
};

const EMPTY_SELECTION: EditorSelectionState = {
  selectedNodeIds: [],
  primaryNodeId: null,
  selectedEdgeId: null,
};

export function EditorCanvas({
  config,
  selection,
  connectFromNodeId,
  tool,
  activePlacementKind,
  viewport,
  showGrid,
  spacePanActive,
  recentlyPlacedNodeIds = [],
  recentlyTouchedEdgeIds = [],
  onViewportChange,
  onSelectionChange,
  onSetConnectFrom,
  onMoveNodes,
  onCreateEdge,
  onDeleteEdgeBetween,
  onDeleteSelection,
  onPlaceNodeAtWorld,
  onBeginNodeDrag,
  onEndNodeDrag,
}: EditorCanvasProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [interaction, setInteraction] = useState<Interaction>(null);
  const [previewPointer, setPreviewPointer] = useState<{ x: number; y: number } | null>(null);
  const arrowMarkerId = `${useId().replace(/:/g, "")}-editor-edge-arrow`;

  const placedNodeIds = useMemo(() => new Set(recentlyPlacedNodeIds), [recentlyPlacedNodeIds]);
  const flashedEdgeIds = useMemo(() => new Set(recentlyTouchedEdgeIds), [recentlyTouchedEdgeIds]);

  const nodesById = useMemo(() => {
    const map = new Map<string, EditorNode>();
    for (const node of config.nodes) {
      map.set(node.id, node);
    }
    return map;
  }, [config.nodes]);

  const getContainerRect = useCallback(() => containerRef.current?.getBoundingClientRect() ?? null, []);

  const toLocal = useCallback(
    (clientX: number, clientY: number): { x: number; y: number } => {
      const containerRect = getContainerRect();
      if (!containerRect) return { x: clientX, y: clientY };
      return {
        x: clientX - containerRect.left,
        y: clientY - containerRect.top,
      };
    },
    [getContainerRect],
  );

  const toLocalWorld = useCallback(
    (clientX: number, clientY: number): { x: number; y: number } => {
      const local = toLocal(clientX, clientY);
      return toWorldSpace(local, viewport);
    },
    [toLocal, viewport],
  );

  const addPan = useCallback(
    (event: MouseEvent<HTMLElement | SVGSVGElement>) => {
      setInteraction({
        kind: "pan",
        clientX: event.clientX,
        clientY: event.clientY,
        viewportX: viewport.x,
        viewportY: viewport.y,
        zoom: viewport.zoom,
      });
    },
    [viewport.x, viewport.y, viewport.zoom],
  );

  const handleGlobalMouseMove = useCallback((event: globalThis.MouseEvent) => {
    setInteraction((current) => {
      if (!current) return current;

      if (current.kind === "pan") {
        const dx = event.clientX - current.clientX;
        const dy = event.clientY - current.clientY;
        onViewportChange({
          x: current.viewportX + dx,
          y: current.viewportY + dy,
          zoom: current.zoom,
        });
        return current;
      }

      if (current.kind === "nodeDrag") {
        const world = toLocalWorld(event.clientX, event.clientY);
        const deltaWorldX = world.x - current.lastWorldX;
        const deltaWorldY = world.y - current.lastWorldY;
        if (Math.abs(deltaWorldX) > 0 || Math.abs(deltaWorldY) > 0) {
          onMoveNodes(current.nodeIds, deltaWorldX, deltaWorldY);
        }
        return {
          ...current,
          lastWorldX: world.x,
          lastWorldY: world.y,
        };
      }

      if (current.kind === "marquee") {
        const local = toLocal(event.clientX, event.clientY);
        return {
          ...current,
          currentX: local.x,
          currentY: local.y,
        };
      }

      return current;
    });

    if (tool === "connect" && connectFromNodeId) {
      setPreviewPointer(toLocal(event.clientX, event.clientY));
    }
  }, [connectFromNodeId, onMoveNodes, onViewportChange, toLocal, toLocalWorld, tool]);

  const handleGlobalMouseUp = useCallback(() => {
    setInteraction((current) => {
      if (!current) return null;

      if (current.kind === "nodeDrag") {
        onEndNodeDrag?.();
      } else if (current.kind === "marquee") {
        const intersectingNodeIds = getNodesIntersectingScreenRect(
          config.nodes,
          viewport,
          {
            startX: current.anchorX,
            startY: current.anchorY,
            endX: current.currentX,
            endY: current.currentY,
          },
          {
            nodeMinWidth: NODE_MIN_WIDTH,
            nodeMinHeight: NODE_MIN_HEIGHT,
          },
        );

        const nextSelection = current.additive
          ? mergeNodeSelection(current.baseSelection, intersectingNodeIds, intersectingNodeIds[0] ?? null)
          : replaceNodeSelection(current.baseSelection, intersectingNodeIds, intersectingNodeIds[0] ?? null);
        onSelectionChange(nextSelection);
      }

      return null;
    });
    setPreviewPointer(null);
  }, [config.nodes, onEndNodeDrag, onSelectionChange, viewport]);

  useEffect(() => {
    if (!interaction) return;
    window.addEventListener("mousemove", handleGlobalMouseMove);
    window.addEventListener("mouseup", handleGlobalMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleGlobalMouseMove);
      window.removeEventListener("mouseup", handleGlobalMouseUp);
    };
  }, [handleGlobalMouseMove, handleGlobalMouseUp, interaction]);

  const handleCanvasMouseDown = useCallback(
    (event: MouseEvent<SVGSVGElement | HTMLDivElement>) => {
      const target = event.target;
      if (!(target instanceof Element)) return;

      if (event.button === 2 || event.button === 1 || (event.button === 0 && spacePanActive)) {
        event.preventDefault();
        addPan(event);
        return;
      }

      const isCanvasNode = target.closest("[data-node-id]");
      const isCanvasEdge = target.closest("[data-edge-id]");
      if (isCanvasNode || isCanvasEdge) return;
      if (event.button !== 0) return;

      if (tool === "place" && activePlacementKind) {
        const world = toLocalWorld(event.clientX, event.clientY);
        onPlaceNodeAtWorld(activePlacementKind, world.x, world.y);
        return;
      }

      if (tool === "select") {
        const local = toLocal(event.clientX, event.clientY);
        const baseSelection = event.shiftKey ? selection : EMPTY_SELECTION;
        setInteraction({
          kind: "marquee",
          anchorX: local.x,
          anchorY: local.y,
          currentX: local.x,
          currentY: local.y,
          additive: event.shiftKey,
          baseSelection,
        });
        onSetConnectFrom(null);
        return;
      }

      onSetConnectFrom(null);
      onSelectionChange(EMPTY_SELECTION);
    },
    [activePlacementKind, addPan, onPlaceNodeAtWorld, onSelectionChange, onSetConnectFrom, selection, spacePanActive, toLocal, toLocalWorld, tool],
  );

  const handleCanvasWheel = useCallback((event: WheelEvent<SVGSVGElement>) => {
    event.preventDefault();
    const local = toLocal(event.clientX, event.clientY);
    const world = toWorldSpace(local, viewport);
    const nextZoom = clamp(viewport.zoom * (event.deltaY > 0 ? 0.92 : 1.08), WORLD_ZOOM_MIN, WORLD_ZOOM_MAX);
    onViewportChange({
      zoom: nextZoom,
      x: local.x - world.x * nextZoom,
      y: local.y - world.y * nextZoom,
    });
  }, [onViewportChange, toLocal, viewport]);

  const handleNodeMouseDown = useCallback(
    (nodeId: string, event: MouseEvent<SVGGElement>) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();

      if (tool === "connect") {
        if (connectFromNodeId && connectFromNodeId !== nodeId) {
          if (event.altKey) {
            onDeleteEdgeBetween(connectFromNodeId, nodeId);
          } else {
            onCreateEdge(connectFromNodeId, nodeId);
          }
          onSetConnectFrom(null);
          return;
        }

        if (connectFromNodeId === nodeId) {
          onSetConnectFrom(null);
          onSelectionChange(replaceNodeSelection(selection, [nodeId], nodeId));
          return;
        }

        onSetConnectFrom(nodeId);
        onSelectionChange(replaceNodeSelection(selection, [nodeId], nodeId));
        setPreviewPointer(toLocal(event.clientX, event.clientY));
        return;
      }

      if (tool !== "select") return;

      if (event.shiftKey) {
        onSelectionChange(toggleNodeSelection(selection, nodeId));
        return;
      }

      const selectedNodeIds = selection.selectedNodeIds.includes(nodeId)
        ? selection.selectedNodeIds
        : [nodeId];
      onSelectionChange(replaceNodeSelection(selection, selectedNodeIds, nodeId));

      const world = toLocalWorld(event.clientX, event.clientY);
      onBeginNodeDrag?.();
      setInteraction({
        kind: "nodeDrag",
        nodeIds: selectedNodeIds,
        lastWorldX: world.x,
        lastWorldY: world.y,
      });
      onSetConnectFrom(null);
    },
    [connectFromNodeId, onBeginNodeDrag, onCreateEdge, onDeleteEdgeBetween, onSelectionChange, onSetConnectFrom, selection, toLocal, toLocalWorld, tool],
  );

  const handleNodeMouseOver = useCallback(
    (nodeId: string, event: MouseEvent<SVGGElement>) => {
      if (tool !== "connect" || !connectFromNodeId || connectFromNodeId === nodeId) return;
      event.preventDefault();
      setPreviewPointer(toLocal(event.clientX, event.clientY));
    },
    [connectFromNodeId, toLocal, tool],
  );

  const handleEdgeMouseDown = useCallback((edgeId: string, event: MouseEvent<SVGLineElement>) => {
    event.preventDefault();
    event.stopPropagation();
    onSetConnectFrom(null);
    onSelectionChange({
      selectedNodeIds: [],
      primaryNodeId: null,
      selectedEdgeId: edgeId,
    });
  }, [onSelectionChange, onSetConnectFrom]);

  const marqueeRect = interaction?.kind === "marquee"
    ? {
        x: Math.min(interaction.anchorX, interaction.currentX),
        y: Math.min(interaction.anchorY, interaction.currentY),
        width: Math.abs(interaction.currentX - interaction.anchorX),
        height: Math.abs(interaction.currentY - interaction.anchorY),
      }
    : null;

  return (
    <div
      ref={containerRef}
      className="relative h-full w-full overflow-hidden rounded-xl border border-zinc-500/25 bg-zinc-950/55"
    >
      <svg
        className="h-full w-full select-none"
        role="application"
        aria-label="map editor canvas"
        tabIndex={0}
        onContextMenu={(event) => event.preventDefault()}
        onMouseDown={handleCanvasMouseDown}
        onKeyDown={(event) => {
          if (event.key.toLowerCase() === "x") {
            event.preventDefault();
            onDeleteSelection();
          }
        }}
        onWheel={handleCanvasWheel}
      >
        <defs>
          <marker
            id={arrowMarkerId}
            markerWidth="10"
            markerHeight="10"
            refX="8"
            refY="5"
            orient="auto"
            markerUnits="userSpaceOnUse"
          >
            <path d="M 0 1 L 8 5 L 0 9 z" fill="context-stroke" />
          </marker>
          {showGrid && (
            <pattern id="editor-grid-pattern" x="0" y="0" width="48" height="48" patternUnits="userSpaceOnUse">
              <rect width="48" height="48" fill="none" stroke="rgba(148,163,184,0.15)" strokeWidth="1" />
            </pattern>
          )}
        </defs>

        {showGrid && (
          <>
            <rect width="100%" height="100%" fill="url(#editor-grid-pattern)" />
          </>
        )}

        {config.edges.map((edge) => {
          const source = nodesById.get(edge.fromNodeId);
          const target = nodesById.get(edge.toNodeId);
          if (!source?.styleHint || !target?.styleHint) return null;
          if (
            !isFiniteNumber(source.styleHint.x)
            || !isFiniteNumber(source.styleHint.y)
            || !isFiniteNumber(target.styleHint.x)
            || !isFiniteNumber(target.styleHint.y)
          ) {
            return null;
          }

          const sourceWidth = Math.max(NODE_MIN_WIDTH, isFiniteNumber(source.styleHint.width) ? source.styleHint.width : 180);
          const sourceHeight = Math.max(NODE_MIN_HEIGHT, isFiniteNumber(source.styleHint.height) ? source.styleHint.height : 78);
          const targetWidth = Math.max(NODE_MIN_WIDTH, isFiniteNumber(target.styleHint.width) ? target.styleHint.width : 180);
          const targetHeight = Math.max(NODE_MIN_HEIGHT, isFiniteNumber(target.styleHint.height) ? target.styleHint.height : 78);
          const sourcePos = toScreenSpace({ x: source.styleHint.x, y: source.styleHint.y }, viewport);
          const targetPos = toScreenSpace({ x: target.styleHint.x, y: target.styleHint.y }, viewport);
          const edgePoints = getTrimmedEdgePoints(
            {
              x: sourcePos.x,
              y: sourcePos.y,
              width: sourceWidth * viewport.zoom,
              height: sourceHeight * viewport.zoom,
            },
            {
              x: targetPos.x,
              y: targetPos.y,
              width: targetWidth * viewport.zoom,
              height: targetHeight * viewport.zoom,
            },
          );
          if (!edgePoints) return null;

          const isSelected = edge.id === selection.selectedEdgeId;
          const strokeColor = isSelected ? "#c4b5fd" : EDGE_COLOR;

          return (
            <g key={edge.id} data-edge-id={edge.id}>
              <line
                x1={edgePoints.x1}
                y1={edgePoints.y1}
                x2={edgePoints.x2}
                y2={edgePoints.y2}
                className={`editor-edge-line ${flashedEdgeIds.has(edge.id) ? "is-flash" : ""}`}
                stroke={strokeColor}
                strokeWidth={isSelected ? 3 : 2}
                strokeOpacity={0.9}
                strokeLinecap="round"
                markerEnd={`url(#${arrowMarkerId})`}
                onMouseDown={(event) => handleEdgeMouseDown(edge.id, event)}
              />
              <line
                x1={edgePoints.x1}
                y1={edgePoints.y1}
                x2={edgePoints.x2}
                y2={edgePoints.y2}
                stroke="transparent"
                strokeWidth={10}
                onMouseDown={(event) => handleEdgeMouseDown(edge.id, event)}
              />
              {(edge.label || (edge.gateCost ?? 0) > 0) && (
                <text
                  x={(edgePoints.x1 + edgePoints.x2) / 2}
                  y={(edgePoints.y1 + edgePoints.y2) / 2 - 6}
                  fill="#f1f5f9"
                  textAnchor="middle"
                  fontSize={11}
                  fontFamily="var(--font-jetbrains-mono)"
                  className="pointer-events-none"
                >
                  {edge.label ?? ""}{edge.label ? " " : ""}{(edge.gateCost ?? 0) > 0 ? `$${edge.gateCost}` : ""}
                </text>
              )}
            </g>
          );
        })}

        {config.nodes.map((node) => {
          if (!node.styleHint || !isFiniteNumber(node.styleHint.x) || !isFiniteNumber(node.styleHint.y)) return null;
          const width = Math.max(NODE_MIN_WIDTH, isFiniteNumber(node.styleHint.width) ? node.styleHint.width : 180);
          const height = Math.max(NODE_MIN_HEIGHT, isFiniteNumber(node.styleHint.height) ? node.styleHint.height : 78);
          const color = KIND_COLORS[node.kind] ?? KIND_COLORS.path;
          const isSelected = selection.selectedNodeIds.includes(node.id);
          const isPrimary = selection.primaryNodeId === node.id;
          const position = toScreenSpace({ x: node.styleHint.x, y: node.styleHint.y }, viewport);
          const rectWidth = width * viewport.zoom;
          const rectHeight = height * viewport.zoom;
          const isFresh = placedNodeIds.has(node.id);
          const selectedRoundName = trimOrNull(node.roundRef?.name);
          const primaryLabel = node.kind === "round" ? selectedRoundName ?? node.name : node.name;
          const secondaryLabel = node.kind === "round" ? "round" : node.kind;

          return (
            <g
              key={node.id}
              data-node-id={node.id}
              className={`editor-node-group ${isFresh ? "is-fresh" : ""}`}
              transform={`translate(${position.x}, ${position.y})`}
              onMouseDown={(event) => handleNodeMouseDown(node.id, event)}
              onMouseOver={(event) => handleNodeMouseOver(node.id, event)}
              style={{ cursor: tool === "place" ? "copy" : "grab" }}
            >
              <rect
                width={rectWidth}
                height={rectHeight}
                rx={18}
                fill="rgba(15,23,42,0.86)"
                stroke={isSelected ? "#c4b5fd" : color}
                strokeWidth={isPrimary ? 3.5 : isSelected ? 3 : 2}
                className={`editor-node-border ${isSelected ? "is-selected" : ""}`}
              />
              <rect
                x={isSelected ? 3 : 2}
                y={isSelected ? 3 : 2}
                width={Math.max(0, rectWidth - (isSelected ? 6 : 4))}
                height={Math.max(0, rectHeight - (isSelected ? 6 : 4))}
                rx={16}
                fill="rgba(8,12,20,0.75)"
                stroke="none"
              />
              <text
                x={rectWidth / 2}
                y={rectHeight * 0.42}
                fill="#e2e8f0"
                textAnchor="middle"
                fontSize={Math.max(10, Math.min(22, Math.floor(14 * viewport.zoom)))}
                fontFamily="var(--font-jetbrains-mono)"
              >
                {primaryLabel}
              </text>
              <text
                x={rectWidth / 2}
                y={rectHeight * 0.72}
                fill={color}
                textAnchor="middle"
                fontSize={Math.max(9, Math.min(18, Math.floor(12 * viewport.zoom)))}
                fontFamily="var(--font-jetbrains-mono)"
              >
                {secondaryLabel}
              </text>
            </g>
          );
        })}

        {marqueeRect && (
          <rect
            className="editor-marquee"
            x={marqueeRect.x}
            y={marqueeRect.y}
            width={marqueeRect.width}
            height={marqueeRect.height}
            fill="rgba(14,165,233,0.12)"
            stroke="rgba(56,189,248,0.7)"
            strokeWidth={1.5}
            strokeDasharray="5 4"
          />
        )}

        {tool === "connect" && connectFromNodeId && previewPointer && (() => {
          const startNode = nodesById.get(connectFromNodeId);
          if (!startNode?.styleHint || !isFiniteNumber(startNode.styleHint.x) || !isFiniteNumber(startNode.styleHint.y)) {
            return null;
          }
          const startWidth = Math.max(NODE_MIN_WIDTH, isFiniteNumber(startNode.styleHint.width) ? startNode.styleHint.width : 180);
          const startHeight = Math.max(NODE_MIN_HEIGHT, isFiniteNumber(startNode.styleHint.height) ? startNode.styleHint.height : 78);
          const startPos = toScreenSpace({ x: startNode.styleHint.x, y: startNode.styleHint.y }, viewport);
          const startRect = {
            x: startPos.x,
            y: startPos.y,
            width: startWidth * viewport.zoom,
            height: startHeight * viewport.zoom,
          };
          const fromPoint = getRectConnectionPoint(startRect, previewPointer);
          return (
            <line
              x1={fromPoint.x}
              y1={fromPoint.y}
              x2={previewPointer.x}
              y2={previewPointer.y}
              stroke="#f472b6"
              strokeWidth={2}
              strokeDasharray="5 6"
              strokeLinecap="round"
              markerEnd={`url(#${arrowMarkerId})`}
            />
          );
        })()}
      </svg>
    </div>
  );
}
