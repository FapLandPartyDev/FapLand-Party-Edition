import React, {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type JSX,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent,
  type WheelEvent,
} from "react";
import type {
  EditorGraphConfig,
  EditorNode,
  EditorNodeKind,
  EditorSelectionState,
  MapEditorTool,
  ViewportState,
} from "./EditorState";
import { normalizeRoadPalette } from "./EditorState";
import {
  getNodesIntersectingScreenRect,
  mergeNodeSelection,
  replaceNodeSelection,
  toggleNodeSelection,
} from "./editorInteractions";
import { getNodeDisplayColor, getNodeRenderHeight, getNodeRenderWidth } from "./nodeVisuals";
import { getPerkById } from "../../game/data/perks";
import { MapBackgroundMedia } from "../../components/MapBackgroundMedia";
import {
  computeAlignmentGuides,
  computeNodeBounds,
  EDITOR_GRID_SIZE,
  findSmartPlacementSlot,
  getNodeCenter,
  snapPointToGrid,
} from "./editorGeometry";

export interface QuickAddTileOption {
  kind: EditorNodeKind;
  label: string;
  icon?: string;
  color?: string;
  description?: string;
}

export type ContextMenuTarget =
  | { kind: "node"; nodeId: string; screenX: number; screenY: number }
  | { kind: "edge"; edgeId: string; screenX: number; screenY: number }
  | { kind: "text"; annotationId: string; screenX: number; screenY: number }
  | { kind: "canvas"; worldX: number; worldY: number; screenX: number; screenY: number };

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
      duplicate: boolean;
    }
  | {
      kind: "textDrag";
      annotationId: string;
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
  | {
      kind: "handleDrag";
      sourceNodeId: string;
      anchorScreenX: number;
      anchorScreenY: number;
      lastScreenX: number;
      lastScreenY: number;
    }
  | null;

type AlignmentGuides = {
  x: { value: number; from: number; to: number } | null;
  y: { value: number; from: number; to: number } | null;
};

type EditorCanvasProps = {
  config: EditorGraphConfig;
  selection: EditorSelectionState;
  connectFromNodeId: string | null;
  tool: MapEditorTool;
  activePlacementKind: EditorNode["kind"] | null;
  viewport: ViewportState;
  showGrid: boolean;
  snapToGrid?: boolean;
  spacePanActive: boolean;
  recentlyPlacedNodeIds?: string[];
  recentlyTouchedEdgeIds?: string[];
  quickAddTileOptions?: ReadonlyArray<QuickAddTileOption>;
  enableMinimap?: boolean;
  onViewportChange: (next: ViewportState) => void;
  onSelectionChange: (next: EditorSelectionState) => void;
  onSetConnectFrom: (nodeId: string | null) => void;
  onMoveNodes: (nodeIds: string[], deltaWorldX: number, deltaWorldY: number) => void;
  onMoveTextAnnotation: (annotationId: string, deltaWorldX: number, deltaWorldY: number) => void;
  onCreateEdge: (fromNodeId: string, toNodeId: string) => void;
  onDeleteEdgeBetween: (fromNodeId: string, toNodeId: string) => void;
  onDeleteSelection: () => void;
  onPlaceNodeAtWorld: (kind: EditorNode["kind"], worldX: number, worldY: number) => void;
  onPlaceHeroChainAtWorld: (worldX: number, worldY: number) => void;
  isHeroPlacementActive: boolean;
  onPlaceTextAtWorld: (worldX: number, worldY: number) => void;
  onBeginNodeDrag?: () => void;
  onEndNodeDrag?: () => void;
  onQuickAddConnectedNode?: (
    sourceNodeId: string,
    kind: EditorNode["kind"],
    worldX: number,
    worldY: number
  ) => void;
  onRenameNode?: (nodeId: string, name: string) => void;
  onDuplicateNode?: (nodeId: string, worldX: number, worldY: number) => void;
  onNudgeSelection?: (deltaWorldX: number, deltaWorldY: number) => void;
  onContextMenu?: (target: ContextMenuTarget) => void;
};

const WORLD_ZOOM_MIN = 0.35;
const WORLD_ZOOM_MAX = 2;
const DEFAULT_TEXT_COLOR = "#f8fafc";
const DEFAULT_TEXT_SIZE = 18;

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

const trimOrNull = (value: string | undefined): string | null => {
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const toScreenSpace = (
  world: { x: number; y: number },
  viewport: ViewportState
): { x: number; y: number } => ({
  x: world.x * viewport.zoom + viewport.x,
  y: world.y * viewport.zoom + viewport.y,
});

const toWorldSpace = (
  screen: { x: number; y: number },
  viewport: ViewportState
): { x: number; y: number } => ({
  x: (screen.x - viewport.x) / viewport.zoom,
  y: (screen.y - viewport.y) / viewport.zoom,
});

const getRectCenter = (rect: {
  x: number;
  y: number;
  width: number;
  height: number;
}): { x: number; y: number } => ({
  x: rect.x + rect.width * 0.5,
  y: rect.y + rect.height * 0.5,
});

const getRectConnectionPoint = (
  rect: { x: number; y: number; width: number; height: number },
  target: { x: number; y: number }
): { x: number; y: number } => {
  const center = getRectCenter(rect);
  const dx = target.x - center.x;
  const dy = target.y - center.y;
  if (Math.abs(dx) < 0.001 && Math.abs(dy) < 0.001) {
    return center;
  }

  const halfWidth = rect.width * 0.5;
  const halfHeight = rect.height * 0.5;
  const scale =
    1 / Math.max(Math.abs(dx) / Math.max(halfWidth, 1), Math.abs(dy) / Math.max(halfHeight, 1));

  return {
    x: center.x + dx * scale,
    y: center.y + dy * scale,
  };
};

const getTrimmedEdgePoints = (
  sourceRect: { x: number; y: number; width: number; height: number },
  targetRect: { x: number; y: number; width: number; height: number }
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
  selectedTextAnnotationId: null,
};

export function EditorCanvas({
  config,
  selection,
  connectFromNodeId,
  tool,
  activePlacementKind,
  viewport,
  showGrid,
  snapToGrid = false,
  spacePanActive,
  recentlyPlacedNodeIds = [],
  recentlyTouchedEdgeIds = [],
  quickAddTileOptions = [],
  enableMinimap = true,
  onViewportChange,
  onSelectionChange,
  onSetConnectFrom,
  onMoveNodes,
  onMoveTextAnnotation,
  onCreateEdge,
  onDeleteEdgeBetween,
  onDeleteSelection,
  onPlaceNodeAtWorld,
  onPlaceHeroChainAtWorld,
  isHeroPlacementActive,
  onPlaceTextAtWorld,
  onBeginNodeDrag,
  onEndNodeDrag,
  onQuickAddConnectedNode,
  onRenameNode,
  onDuplicateNode,
  onNudgeSelection,
  onContextMenu,
}: EditorCanvasProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [interaction, setInteraction] = useState<Interaction>(null);
  const [previewPointer, setPreviewPointer] = useState<{ x: number; y: number } | null>(null);
  const [quickAdd, setQuickAdd] = useState<{
    sourceNodeId: string;
    screenX: number;
    screenY: number;
  } | null>(null);
  const [handleDragPreview, setHandleDragPreview] = useState<{
    sourceNodeId: string;
    pointer: { x: number; y: number };
  } | null>(null);
  const [renaming, setRenaming] = useState<{ nodeId: string; value: string } | null>(null);
  const [alignmentGuides, setAlignmentGuides] = useState<AlignmentGuides>({
    x: null,
    y: null,
  });
  const arrowMarkerId = `${useId().replace(/:/g, "")}-editor-edge-arrow`;

  const placedNodeIds = useMemo(() => new Set(recentlyPlacedNodeIds), [recentlyPlacedNodeIds]);
  const flashedEdgeIds = useMemo(() => new Set(recentlyTouchedEdgeIds), [recentlyTouchedEdgeIds]);
  const roadPalette = useMemo(
    () => normalizeRoadPalette(config.style.roadPalette),
    [config.style.roadPalette]
  );
  const gridSize = EDITOR_GRID_SIZE * viewport.zoom;
  const gridOffsetX = ((viewport.x % gridSize) + gridSize) % gridSize;
  const gridOffsetY = ((viewport.y % gridSize) + gridSize) % gridSize;

  const nodesById = useMemo(() => {
    const map = new Map<string, EditorNode>();
    for (const node of config.nodes) {
      map.set(node.id, node);
    }
    return map;
  }, [config.nodes]);

  const getContainerRect = useCallback(
    () => containerRef.current?.getBoundingClientRect() ?? null,
    []
  );

  const toLocal = useCallback(
    (clientX: number, clientY: number): { x: number; y: number } => {
      const containerRect = getContainerRect();
      if (!containerRect) return { x: clientX, y: clientY };
      return {
        x: clientX - containerRect.left,
        y: clientY - containerRect.top,
      };
    },
    [getContainerRect]
  );

  const toLocalWorld = useCallback(
    (clientX: number, clientY: number): { x: number; y: number } => {
      const local = toLocal(clientX, clientY);
      return toWorldSpace(local, viewport);
    },
    [toLocal, viewport]
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
    [viewport.x, viewport.y, viewport.zoom]
  );

  const handleGlobalMouseMove = useCallback(
    (event: globalThis.MouseEvent) => {
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
          let deltaWorldX = world.x - current.lastWorldX;
          let deltaWorldY = world.y - current.lastWorldY;
          if (Math.abs(deltaWorldX) === 0 && Math.abs(deltaWorldY) === 0) return current;

          // Compute alignment guides against the primary dragged node.
          const primaryId = current.nodeIds[0];
          const primaryNode = primaryId ? nodesById.get(primaryId) : null;
          if (primaryNode) {
            const baseCenter = getNodeCenter(primaryNode);
            const draggedCenter = { x: baseCenter.x + deltaWorldX, y: baseCenter.y + deltaWorldY };
            const draggedIds = new Set(current.nodeIds);
            const guides = computeAlignmentGuides(draggedIds, config.nodes, draggedCenter);
            if (guides.x) {
              deltaWorldX += guides.x.value - draggedCenter.x;
            }
            if (guides.y) {
              deltaWorldY += guides.y.value - draggedCenter.y;
            }
            setAlignmentGuides(guides);
          }

          if (Math.abs(deltaWorldX) > 0 || Math.abs(deltaWorldY) > 0) {
            onMoveNodes(current.nodeIds, deltaWorldX, deltaWorldY);
          }
          return {
            ...current,
            lastWorldX: world.x,
            lastWorldY: world.y,
          };
        }

        if (current.kind === "textDrag") {
          const world = toLocalWorld(event.clientX, event.clientY);
          const deltaWorldX = world.x - current.lastWorldX;
          const deltaWorldY = world.y - current.lastWorldY;
          if (Math.abs(deltaWorldX) > 0 || Math.abs(deltaWorldY) > 0) {
            onMoveTextAnnotation(current.annotationId, deltaWorldX, deltaWorldY);
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

        if (current.kind === "handleDrag") {
          const local = toLocal(event.clientX, event.clientY);
          setHandleDragPreview({
            sourceNodeId: current.sourceNodeId,
            pointer: local,
          });
          return {
            ...current,
            lastScreenX: local.x,
            lastScreenY: local.y,
          };
        }

        return current;
      });

      if (tool === "connect" && connectFromNodeId) {
        setPreviewPointer(toLocal(event.clientX, event.clientY));
      }
    },
    [
      config.nodes,
      connectFromNodeId,
      nodesById,
      onMoveNodes,
      onMoveTextAnnotation,
      onViewportChange,
      toLocal,
      toLocalWorld,
      tool,
    ]
  );

  const handleGlobalMouseUp = useCallback(
    (event: globalThis.MouseEvent) => {
      setInteraction((current) => {
        if (!current) return null;

        if (current.kind === "nodeDrag" || current.kind === "textDrag") {
          onEndNodeDrag?.();
          setAlignmentGuides({ x: null, y: null });
        } else if (current.kind === "marquee") {
          const intersectingNodeIds = getNodesIntersectingScreenRect(config.nodes, viewport, {
            startX: current.anchorX,
            startY: current.anchorY,
            endX: current.currentX,
            endY: current.currentY,
          });

          const nextSelection = current.additive
            ? mergeNodeSelection(
                current.baseSelection,
                intersectingNodeIds,
                intersectingNodeIds[0] ?? null
              )
            : replaceNodeSelection(
                current.baseSelection,
                intersectingNodeIds,
                intersectingNodeIds[0] ?? null
              );
          onSelectionChange(nextSelection);
        } else if (current.kind === "handleDrag") {
          // Determine drop target — another node or empty/short click.
          const target = event.target;
          let targetNodeId: string | null = null;
          if (target instanceof Element) {
            const nodeEl = target.closest("[data-node-id]");
            if (nodeEl) {
              targetNodeId = nodeEl.getAttribute("data-node-id");
            }
          }

          if (targetNodeId && targetNodeId !== current.sourceNodeId) {
            // Dropped on another node → wire an edge.
            onCreateEdge(current.sourceNodeId, targetNodeId);
          } else {
            // Short click on the handle OR drop on empty canvas → open quick-add.
            const sourceNode = nodesById.get(current.sourceNodeId);
            const releaseScreen = toLocal(event.clientX, event.clientY);
            if (
              sourceNode?.styleHint &&
              isFiniteNumber(sourceNode.styleHint.x) &&
              isFiniteNumber(sourceNode.styleHint.y)
            ) {
              const dragDistance = Math.hypot(
                releaseScreen.x - current.anchorScreenX,
                releaseScreen.y - current.anchorScreenY
              );
              if (dragDistance < 6) {
                // Short click → anchor menu beside the handle.
                const width = getNodeRenderWidth(sourceNode);
                const height = getNodeRenderHeight(sourceNode);
                const position = toScreenSpace(
                  { x: sourceNode.styleHint.x ?? 0, y: sourceNode.styleHint.y ?? 0 },
                  viewport
                );
                setQuickAdd({
                  sourceNodeId: current.sourceNodeId,
                  screenX: position.x + width * viewport.zoom + 18,
                  screenY: position.y + (height * viewport.zoom) / 2,
                });
              } else {
                // Dragged to empty canvas → open menu at release, and pre-place a node there.
                const releaseWorld = toWorldSpace(releaseScreen, viewport);
                const snapped = snapToGrid ? snapPointToGrid(releaseWorld) : releaseWorld;
                if (onQuickAddConnectedNode) {
                  onQuickAddConnectedNode(current.sourceNodeId, "path", snapped.x, snapped.y);
                } else {
                  onPlaceNodeAtWorld("path", snapped.x, snapped.y);
                }
              }
            }
          }
          setHandleDragPreview(null);
        }

        return null;
      });
      setPreviewPointer(null);
    },
    [
      config.nodes,
      nodesById,
      onCreateEdge,
      onEndNodeDrag,
      onPlaceNodeAtWorld,
      onQuickAddConnectedNode,
      onSelectionChange,
      snapToGrid,
      toLocal,
      viewport,
    ]
  );

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
      const isCanvasText = target.closest("[data-text-annotation-id]");
      if (isCanvasNode || isCanvasEdge || isCanvasText) return;
      if (event.button !== 0) return;

      // Dismiss quick-add popover when clicking the canvas.
      if (quickAdd) {
        setQuickAdd(null);
      }

      if (tool === "place" && isHeroPlacementActive) {
        const world = toLocalWorld(event.clientX, event.clientY);
        const snapped = snapToGrid ? snapPointToGrid(world) : world;
        onPlaceHeroChainAtWorld(snapped.x, snapped.y);
        return;
      }

      if (tool === "place" && activePlacementKind) {
        const world = toLocalWorld(event.clientX, event.clientY);
        const snapped = snapToGrid ? snapPointToGrid(world) : world;
        onPlaceNodeAtWorld(activePlacementKind, snapped.x, snapped.y);
        return;
      }

      if (tool === "text") {
        const world = toLocalWorld(event.clientX, event.clientY);
        const snapped = snapToGrid ? snapPointToGrid(world) : world;
        onPlaceTextAtWorld(snapped.x, snapped.y);
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
    [
      activePlacementKind,
      addPan,
      isHeroPlacementActive,
      onPlaceNodeAtWorld,
      onPlaceHeroChainAtWorld,
      onPlaceTextAtWorld,
      onSelectionChange,
      onSetConnectFrom,
      quickAdd,
      selection,
      snapToGrid,
      spacePanActive,
      toLocal,
      toLocalWorld,
      tool,
    ]
  );

  const handleCanvasWheel = useCallback(
    (event: WheelEvent<SVGSVGElement>) => {
      event.preventDefault();
      const local = toLocal(event.clientX, event.clientY);
      const world = toWorldSpace(local, viewport);
      const nextZoom = clamp(
        viewport.zoom * (event.deltaY > 0 ? 0.92 : 1.08),
        WORLD_ZOOM_MIN,
        WORLD_ZOOM_MAX
      );
      onViewportChange({
        zoom: nextZoom,
        x: local.x - world.x * nextZoom,
        y: local.y - world.y * nextZoom,
      });
    },
    [onViewportChange, toLocal, viewport]
  );

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

      // Alt+drag duplicates the node at an offset, then begins dragging the clone.
      if (event.altKey && onDuplicateNode && selectedNodeIds.length === 1) {
        onDuplicateNode(nodeId, world.x + 24, world.y + 24);
        return;
      }

      onBeginNodeDrag?.();
      setInteraction({
        kind: "nodeDrag",
        nodeIds: selectedNodeIds,
        lastWorldX: world.x,
        lastWorldY: world.y,
        duplicate: event.altKey,
      });
      onSetConnectFrom(null);
    },
    [
      connectFromNodeId,
      onBeginNodeDrag,
      onCreateEdge,
      onDeleteEdgeBetween,
      onDuplicateNode,
      onSelectionChange,
      onSetConnectFrom,
      selection,
      toLocal,
      toLocalWorld,
      tool,
    ]
  );

  const handleNodeDoubleClick = useCallback(
    (nodeId: string, event: MouseEvent<SVGGElement>) => {
      if (tool !== "select") return;
      if (!onRenameNode) return;
      event.preventDefault();
      event.stopPropagation();
      const node = nodesById.get(nodeId);
      if (!node) return;
      setRenaming({ nodeId, value: node.name });
    },
    [nodesById, onRenameNode, tool]
  );

  const handleNodeContextMenu = useCallback(
    (nodeId: string, event: MouseEvent<SVGGElement>) => {
      if (!onContextMenu) return;
      event.preventDefault();
      event.stopPropagation();
      const local = toLocal(event.clientX, event.clientY);
      onSelectionChange(replaceNodeSelection(selection, [nodeId], nodeId));
      onContextMenu({ kind: "node", nodeId, screenX: local.x, screenY: local.y });
    },
    [onContextMenu, onSelectionChange, selection, toLocal]
  );

  const handleAddHandleMouseDown = useCallback(
    (nodeId: string, event: MouseEvent<SVGGElement>) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      const local = toLocal(event.clientX, event.clientY);
      onSelectionChange(replaceNodeSelection(selection, [nodeId], nodeId));
      setInteraction({
        kind: "handleDrag",
        sourceNodeId: nodeId,
        anchorScreenX: local.x,
        anchorScreenY: local.y,
        lastScreenX: local.x,
        lastScreenY: local.y,
      });
      setHandleDragPreview({ sourceNodeId: nodeId, pointer: local });
    },
    [onSelectionChange, selection, toLocal]
  );

  const handleQuickAddPick = useCallback(
    (kind: EditorNodeKind) => {
      const current = quickAdd;
      setQuickAdd(null);
      if (!current) return;
      if (!onQuickAddConnectedNode) return;
      const sourceNode = nodesById.get(current.sourceNodeId);
      if (!sourceNode) return;

      // Compute a smart target slot for the new node.
      const outgoing = config.edges
        .filter((edge) => edge.fromNodeId === current.sourceNodeId)
        .map((edge) => edge.toNodeId);
      const occupied = new Set(outgoing);
      const slot = findSmartPlacementSlot({
        sourceNode,
        existingNodes: config.nodes,
        occupiedTargetNodeIds: occupied,
        snap: snapToGrid,
      });
      onQuickAddConnectedNode(current.sourceNodeId, kind, slot.center.x, slot.center.y);
    },
    [config.edges, config.nodes, nodesById, onQuickAddConnectedNode, quickAdd, snapToGrid]
  );

  const handleEdgeContextMenu = useCallback(
    (edgeId: string, event: MouseEvent<SVGLineElement>) => {
      if (!onContextMenu) return;
      event.preventDefault();
      event.stopPropagation();
      const local = toLocal(event.clientX, event.clientY);
      onSelectionChange({
        selectedNodeIds: [],
        primaryNodeId: null,
        selectedEdgeId: edgeId,
        selectedTextAnnotationId: null,
      });
      onContextMenu({ kind: "edge", edgeId, screenX: local.x, screenY: local.y });
    },
    [onContextMenu, onSelectionChange, toLocal]
  );

  const handleCanvasContextMenu = useCallback(
    (event: MouseEvent<SVGSVGElement | HTMLDivElement>) => {
      if (!onContextMenu) {
        event.preventDefault();
        return;
      }
      const target = event.target;
      if (!(target instanceof Element)) return;
      // Let node/edge/text handlers take precedence.
      if (
        target.closest("[data-node-id]") ||
        target.closest("[data-edge-id]") ||
        target.closest("[data-text-annotation-id]")
      ) {
        return;
      }
      event.preventDefault();
      const local = toLocal(event.clientX, event.clientY);
      const world = toWorldSpace(local, viewport);
      onContextMenu({
        kind: "canvas",
        worldX: world.x,
        worldY: world.y,
        screenX: local.x,
        screenY: local.y,
      });
    },
    [onContextMenu, toLocal, viewport]
  );

  const handleRenameCommit = useCallback(() => {
    setRenaming((current) => {
      if (current && onRenameNode) {
        const trimmed = current.value.trim();
        if (trimmed.length > 0) {
          onRenameNode(current.nodeId, trimmed);
        }
      }
      return null;
    });
  }, [onRenameNode]);

  const handleKeyDown = useCallback(
    (event: ReactKeyboardEvent<SVGSVGElement>) => {
      const key = event.key.toLowerCase();
      if (key === "x") {
        event.preventDefault();
        onDeleteSelection();
        return;
      }
      if (key === "escape") {
        if (quickAdd) {
          setQuickAdd(null);
          event.preventDefault();
          return;
        }
        if (renaming) {
          setRenaming(null);
          event.preventDefault();
          return;
        }
      }
      if (key === "enter" && renaming) {
        handleRenameCommit();
        event.preventDefault();
        return;
      }
      // Arrow-key nudging for selected nodes.
      if (
        onNudgeSelection &&
        (event.key === "ArrowUp" ||
          event.key === "ArrowDown" ||
          event.key === "ArrowLeft" ||
          event.key === "ArrowRight")
      ) {
        const step = event.shiftKey ? 24 : snapToGrid ? 48 : 4;
        let dx = 0;
        let dy = 0;
        if (event.key === "ArrowUp") dy = -step;
        else if (event.key === "ArrowDown") dy = step;
        else if (event.key === "ArrowLeft") dx = -step;
        else if (event.key === "ArrowRight") dx = step;
        event.preventDefault();
        onNudgeSelection(dx, dy);
      }
    },
    [onDeleteSelection, handleRenameCommit, onNudgeSelection, quickAdd, renaming, snapToGrid]
  );

  const handleNodeMouseOver = useCallback(
    (nodeId: string, event: MouseEvent<SVGGElement>) => {
      if (tool !== "connect" || !connectFromNodeId || connectFromNodeId === nodeId) return;
      event.preventDefault();
      setPreviewPointer(toLocal(event.clientX, event.clientY));
    },
    [connectFromNodeId, toLocal, tool]
  );

  const handleEdgeMouseDown = useCallback(
    (edgeId: string, event: MouseEvent<SVGLineElement>) => {
      event.preventDefault();
      event.stopPropagation();
      onSetConnectFrom(null);
      onSelectionChange({
        selectedNodeIds: [],
        primaryNodeId: null,
        selectedEdgeId: edgeId,
        selectedTextAnnotationId: null,
      });
    },
    [onSelectionChange, onSetConnectFrom]
  );

  const handleTextMouseDown = useCallback(
    (annotationId: string, event: MouseEvent<SVGGElement>) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      onSetConnectFrom(null);
      onSelectionChange({
        selectedNodeIds: [],
        primaryNodeId: null,
        selectedEdgeId: null,
        selectedTextAnnotationId: annotationId,
      });

      if (tool !== "select") return;

      const world = toLocalWorld(event.clientX, event.clientY);
      onBeginNodeDrag?.();
      setInteraction({
        kind: "textDrag",
        annotationId,
        lastWorldX: world.x,
        lastWorldY: world.y,
      });
    },
    [onBeginNodeDrag, onSelectionChange, onSetConnectFrom, toLocalWorld, tool]
  );

  const marqueeRect =
    interaction?.kind === "marquee"
      ? {
          x: Math.min(interaction.anchorX, interaction.currentX),
          y: Math.min(interaction.anchorY, interaction.currentY),
          width: Math.abs(interaction.currentX - interaction.anchorX),
          height: Math.abs(interaction.currentY - interaction.anchorY),
        }
      : null;
  const backgroundParallaxOffset = useMemo(() => {
    const background = config.style.background;
    if (!background || background.motion !== "parallax") return { x: 0, y: 0 };
    return {
      x: -viewport.x * background.parallaxStrength,
      y: -viewport.y * background.parallaxStrength,
    };
  }, [config.style.background, viewport.x, viewport.y]);

  return (
    <div
      ref={containerRef}
      className="relative h-full w-full overflow-hidden rounded-xl border border-zinc-500/25 bg-zinc-950/55"
    >
      <MapBackgroundMedia
        background={config.style.background}
        parallaxOffset={backgroundParallaxOffset}
      />
      <svg
        className="relative z-10 h-full w-full select-none"
        role="application"
        aria-label="map editor canvas"
        tabIndex={0}
        onContextMenu={handleCanvasContextMenu}
        onMouseDown={handleCanvasMouseDown}
        onKeyDown={handleKeyDown}
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
            <pattern
              id="editor-grid-pattern"
              x={gridOffsetX}
              y={gridOffsetY}
              width={gridSize}
              height={gridSize}
              patternUnits="userSpaceOnUse"
            >
              <rect
                width={gridSize}
                height={gridSize}
                fill="none"
                stroke="rgba(148,163,184,0.15)"
                strokeWidth="1"
              />
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
            !isFiniteNumber(source.styleHint.x) ||
            !isFiniteNumber(source.styleHint.y) ||
            !isFiniteNumber(target.styleHint.x) ||
            !isFiniteNumber(target.styleHint.y)
          ) {
            return null;
          }

          const sourceWidth = getNodeRenderWidth(source);
          const sourceHeight = getNodeRenderHeight(source);
          const targetWidth = getNodeRenderWidth(target);
          const targetHeight = getNodeRenderHeight(target);
          const sourcePos = toScreenSpace(
            { x: source.styleHint.x, y: source.styleHint.y },
            viewport
          );
          const targetPos = toScreenSpace(
            { x: target.styleHint.x, y: target.styleHint.y },
            viewport
          );
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
            }
          );
          if (!edgePoints) return null;

          const isSelected = edge.id === selection.selectedEdgeId;
          const strokeColor = isSelected ? "#c4b5fd" : roadPalette.center;

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
                onContextMenu={(event) => handleEdgeContextMenu(edge.id, event)}
              />
              <line
                x1={edgePoints.x1}
                y1={edgePoints.y1}
                x2={edgePoints.x2}
                y2={edgePoints.y2}
                stroke="transparent"
                strokeWidth={10}
                onMouseDown={(event) => handleEdgeMouseDown(edge.id, event)}
                onContextMenu={(event) => handleEdgeContextMenu(edge.id, event)}
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
                  {edge.label ?? ""}
                  {edge.label ? " " : ""}
                  {(edge.gateCost ?? 0) > 0 ? `$${edge.gateCost}` : ""}
                </text>
              )}
            </g>
          );
        })}

        {/* ── Smart alignment guides (during node drag) ─────────── */}
        {alignmentGuides.x && (
          <line
            x1={
              toScreenSpace({ x: alignmentGuides.x.value, y: alignmentGuides.x.from }, viewport).x
            }
            y1={
              toScreenSpace({ x: alignmentGuides.x.value, y: alignmentGuides.x.from }, viewport).y
            }
            x2={toScreenSpace({ x: alignmentGuides.x.value, y: alignmentGuides.x.to }, viewport).x}
            y2={toScreenSpace({ x: alignmentGuides.x.value, y: alignmentGuides.x.to }, viewport).y}
            stroke="#ec4899"
            strokeWidth={1}
            strokeDasharray="4 3"
            className="pointer-events-none"
          />
        )}
        {alignmentGuides.y && (
          <line
            x1={
              toScreenSpace({ x: alignmentGuides.y.from, y: alignmentGuides.y.value }, viewport).x
            }
            y1={
              toScreenSpace({ x: alignmentGuides.y.from, y: alignmentGuides.y.value }, viewport).y
            }
            x2={toScreenSpace({ x: alignmentGuides.y.to, y: alignmentGuides.y.value }, viewport).x}
            y2={toScreenSpace({ x: alignmentGuides.y.to, y: alignmentGuides.y.value }, viewport).y}
            stroke="#ec4899"
            strokeWidth={1}
            strokeDasharray="4 3"
            className="pointer-events-none"
          />
        )}

        {config.nodes.map((node) => {
          if (
            !node.styleHint ||
            !isFiniteNumber(node.styleHint.x) ||
            !isFiniteNumber(node.styleHint.y)
          )
            return null;
          const width = getNodeRenderWidth(node);
          const height = getNodeRenderHeight(node);
          const color = getNodeDisplayColor(node);
          const isSelected = selection.selectedNodeIds.includes(node.id);
          const isPrimary = selection.primaryNodeId === node.id;
          const position = toScreenSpace({ x: node.styleHint.x, y: node.styleHint.y }, viewport);
          const rectWidth = width * viewport.zoom;
          const rectHeight = height * viewport.zoom;
          const isFresh = placedNodeIds.has(node.id);
          const selectedRoundName = trimOrNull(node.roundRef?.name);
          const primaryLabel = node.kind === "round" ? (selectedRoundName ?? node.name) : node.name;
          const perkDef = node.kind === "perk" && node.visualId ? getPerkById(node.visualId) : null;
          const secondaryLabel =
            node.kind === "round"
              ? "round"
              : perkDef?.kind === "antiPerk"
                ? "anti-perk"
                : node.kind;
          const isRenaming = renaming?.nodeId === node.id;
          const showHandle =
            !isRenaming &&
            (tool === "select" || tool === "connect") &&
            node.kind !== "end" &&
            onQuickAddConnectedNode;
          const isConnectSource = connectFromNodeId === node.id;

          return (
            <g
              key={node.id}
              data-node-id={node.id}
              className={`editor-node-group ${isFresh ? "is-fresh" : ""} ${
                showHandle ? "has-handle" : ""
              }`}
              transform={`translate(${position.x}, ${position.y})`}
              onMouseDown={(event) => handleNodeMouseDown(node.id, event)}
              onMouseOver={(event) => {
                handleNodeMouseOver(node.id, event);
              }}
              onDoubleClick={(event) => handleNodeDoubleClick(node.id, event)}
              onContextMenu={(event) => handleNodeContextMenu(node.id, event)}
              style={{ cursor: tool === "place" ? "copy" : "grab" }}
            >
              <rect
                width={rectWidth}
                height={rectHeight}
                rx={18}
                fill="rgba(15,23,42,0.86)"
                stroke={isSelected ? "#c4b5fd" : color}
                strokeWidth={isPrimary ? 3.5 : isSelected ? 3 : 2}
                className={`editor-node-border ${isSelected ? "is-selected" : ""} ${
                  isConnectSource ? "is-connect-source" : ""
                }`}
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
              {isRenaming ? (
                <foreignObject
                  x={4}
                  y={rectHeight * 0.18}
                  width={Math.max(60, rectWidth - 8)}
                  height={rectHeight * 0.5}
                >
                  <input
                    // eslint-disable-next-line jsx-a11y/no-autofocus
                    autoFocus
                    value={renaming.value}
                    onChange={(event) =>
                      setRenaming((current) =>
                        current && current.nodeId === node.id
                          ? { ...current, value: event.target.value }
                          : current
                      )
                    }
                    onBlur={handleRenameCommit}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        handleRenameCommit();
                      } else if (event.key === "Escape") {
                        event.preventDefault();
                        setRenaming(null);
                      }
                      event.stopPropagation();
                    }}
                    className="editor-rename-input w-full rounded-md border border-cyan-400/60 bg-zinc-950/95 px-2 py-1 text-center font-mono text-sm text-cyan-100 outline-none"
                    style={{
                      fontSize: Math.max(11, Math.floor(14 * viewport.zoom)),
                    }}
                  />
                </foreignObject>
              ) : (
                <>
                  <text
                    x={rectWidth / 2}
                    y={rectHeight * 0.42}
                    fill="#e2e8f0"
                    textAnchor="middle"
                    fontSize={Math.max(10, Math.min(22, Math.floor(14 * viewport.zoom)))}
                    fontFamily="var(--font-jetbrains-mono)"
                    className="pointer-events-none"
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
                    className="pointer-events-none"
                  >
                    {secondaryLabel}
                  </text>
                </>
              )}

              {/* + handle for quick-add/connect */}
              {showHandle && (
                <g
                  className="editor-node-add-handle"
                  onMouseDown={(event) => handleAddHandleMouseDown(node.id, event)}
                >
                  {/* Larger invisible hit target */}
                  <circle
                    cx={rectWidth + 4}
                    cy={rectHeight / 2}
                    r={16}
                    fill="transparent"
                    className="editor-node-add-handle-hit"
                  />
                  <circle
                    cx={rectWidth + 4}
                    cy={rectHeight / 2}
                    r={11}
                    fill={isSelected ? "#c4b5fd" : color}
                    stroke="rgba(15,23,42,0.95)"
                    strokeWidth={2}
                    className="editor-node-add-handle-circle"
                  />
                  {/* + glyph */}
                  <g
                    pointerEvents="none"
                    stroke="rgba(15,23,42,0.95)"
                    strokeWidth={2.2}
                    strokeLinecap="round"
                  >
                    <line
                      x1={rectWidth + 4 - 5}
                      y1={rectHeight / 2}
                      x2={rectWidth + 4 + 5}
                      y2={rectHeight / 2}
                    />
                    <line
                      x1={rectWidth + 4}
                      y1={rectHeight / 2 - 5}
                      x2={rectWidth + 4}
                      y2={rectHeight / 2 + 5}
                    />
                  </g>
                </g>
              )}
            </g>
          );
        })}

        {config.textAnnotations.map((annotation) => {
          const x = Number(annotation.styleHint.x);
          const y = Number(annotation.styleHint.y);
          if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
          const position = toScreenSpace({ x, y }, viewport);
          const fontSize = Math.max(
            8,
            Math.min(96, (annotation.styleHint.size ?? DEFAULT_TEXT_SIZE) * viewport.zoom)
          );
          const lineHeight = fontSize * 1.25;
          const lines = annotation.text.split("\n");
          const isSelected = selection.selectedTextAnnotationId === annotation.id;

          return (
            <g
              key={annotation.id}
              data-text-annotation-id={annotation.id}
              transform={`translate(${position.x}, ${position.y})`}
              onMouseDown={(event) => handleTextMouseDown(annotation.id, event)}
              style={{ cursor: tool === "select" ? "grab" : "pointer" }}
            >
              <text
                data-testid="editor-map-text-annotation"
                fill={annotation.styleHint.color ?? DEFAULT_TEXT_COLOR}
                fontSize={fontSize}
                fontFamily="var(--font-jetbrains-mono)"
                paintOrder="stroke"
                stroke="rgba(0,0,0,0.72)"
                strokeWidth={4}
                strokeLinejoin="round"
              >
                {lines.map((line, index) => (
                  <tspan key={`${annotation.id}-${index}`} x={0} dy={index === 0 ? 0 : lineHeight}>
                    {line}
                  </tspan>
                ))}
              </text>
              {isSelected && (
                <rect
                  x={-8}
                  y={-fontSize}
                  width={Math.max(
                    36,
                    annotation.text
                      .split("\n")
                      .reduce((max, line) => Math.max(max, line.length), 0) *
                      fontSize *
                      0.65 +
                      16
                  )}
                  height={Math.max(lineHeight, lines.length * lineHeight)}
                  fill="none"
                  stroke="#c4b5fd"
                  strokeWidth={1.5}
                  strokeDasharray="4 4"
                  pointerEvents="none"
                />
              )}
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

        {tool === "connect" &&
          connectFromNodeId &&
          previewPointer &&
          (() => {
            const startNode = nodesById.get(connectFromNodeId);
            if (
              !startNode?.styleHint ||
              !isFiniteNumber(startNode.styleHint.x) ||
              !isFiniteNumber(startNode.styleHint.y)
            ) {
              return null;
            }
            const startWidth = getNodeRenderWidth(startNode);
            const startHeight = getNodeRenderHeight(startNode);
            const startPos = toScreenSpace(
              { x: startNode.styleHint.x, y: startNode.styleHint.y },
              viewport
            );
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
                stroke={roadPalette.railB}
                strokeWidth={2}
                strokeDasharray="5 6"
                strokeLinecap="round"
                markerEnd={`url(#${arrowMarkerId})`}
              />
            );
          })()}

        {/* ── Live edge preview while dragging from a + handle ─────────── */}
        {handleDragPreview &&
          (() => {
            const sourceNode = nodesById.get(handleDragPreview.sourceNodeId);
            if (!sourceNode?.styleHint) return null;
            const startWidth = getNodeRenderWidth(sourceNode);
            const startHeight = getNodeRenderHeight(sourceNode);
            const startPos = toScreenSpace(
              { x: sourceNode.styleHint.x ?? 0, y: sourceNode.styleHint.y ?? 0 },
              viewport
            );
            const startRect = {
              x: startPos.x,
              y: startPos.y,
              width: startWidth * viewport.zoom,
              height: startHeight * viewport.zoom,
            };
            const fromPoint = getRectConnectionPoint(startRect, handleDragPreview.pointer);
            return (
              <g pointerEvents="none">
                <line
                  x1={fromPoint.x}
                  y1={fromPoint.y}
                  x2={handleDragPreview.pointer.x}
                  y2={handleDragPreview.pointer.y}
                  stroke={roadPalette.railA}
                  strokeWidth={2.5}
                  strokeDasharray="6 5"
                  strokeLinecap="round"
                  markerEnd={`url(#${arrowMarkerId})`}
                />
                <circle
                  cx={handleDragPreview.pointer.x}
                  cy={handleDragPreview.pointer.y}
                  r={6}
                  fill={roadPalette.railA}
                  fillOpacity={0.4}
                  stroke={roadPalette.railA}
                  strokeWidth={1.5}
                />
              </g>
            );
          })()}
      </svg>

      {/* ── Quick-add radial/popover menu (HTML overlay) ─────────── */}
      {quickAdd && quickAddTileOptions.length > 0 && (
        <QuickAddPopover
          options={quickAddTileOptions}
          screenX={quickAdd.screenX}
          screenY={quickAdd.screenY}
          onPick={handleQuickAddPick}
          onClose={() => setQuickAdd(null)}
        />
      )}

      {/* ── Minimap (corner overview) ─────────── */}
      {enableMinimap && config.nodes.length >= 4 && (
        <MiniMap
          nodes={config.nodes}
          textAnnotations={config.textAnnotations}
          viewport={viewport}
          containerRef={containerRef}
          onViewportChange={onViewportChange}
        />
      )}
    </div>
  );
}

/* ──────────────────────── Quick-add popover ──────────── */

interface QuickAddPopoverProps {
  options: ReadonlyArray<QuickAddTileOption>;
  screenX: number;
  screenY: number;
  onPick: (kind: EditorNodeKind) => void;
  onClose: () => void;
}

const QuickAddPopover: React.FC<QuickAddPopoverProps> = ({
  options,
  screenX,
  screenY,
  onPick,
  onClose,
}) => {
  useEffect(() => {
    const handle = (event: globalThis.MouseEvent) => {
      const target = event.target;
      if (target instanceof Element && target.closest("[data-quick-add-popover]")) return;
      onClose();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("mousedown", handle);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", handle);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  // Clamp position so the popover stays inside the container.
  const style = {
    left: screenX,
    top: screenY,
  };

  return (
    <div
      data-quick-add-popover
      className="editor-quick-add-popover absolute z-30 flex flex-col gap-1 -translate-y-1/2 rounded-xl border border-cyan-300/30 bg-zinc-950/95 p-1.5 shadow-2xl backdrop-blur-xl"
      style={style}
      role="menu"
      aria-label="Quick add node"
    >
      <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
        Add connected node
      </div>
      <div className="grid grid-cols-2 gap-1" style={{ maxWidth: 240 }}>
        {options.map((option) => (
          <button
            key={option.kind}
            type="button"
            role="menuitem"
            title={option.description ?? option.label}
            onMouseDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
            }}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onPick(option.kind);
            }}
            className="editor-quick-add-item flex items-center gap-2 rounded-lg border border-white/8 bg-white/4 px-2 py-1.5 text-left text-[11px] font-semibold text-zinc-200 transition-all hover:border-cyan-400/50 hover:bg-cyan-500/15 hover:text-cyan-100"
          >
            <span
              className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full text-[11px] font-bold"
              style={{
                backgroundColor: option.color ? `${option.color}33` : "rgba(148,163,184,0.2)",
                color: option.color ?? "#94a3b8",
              }}
            >
              {option.icon ?? option.label.slice(0, 1)}
            </span>
            <span className="truncate">{option.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
};

/* ──────────────────────── Mini-map ──────────── */

interface MiniMapProps {
  nodes: ReadonlyArray<EditorNode>;
  textAnnotations: ReadonlyArray<{ id: string; styleHint: { x: number; y: number } }>;
  viewport: ViewportState;
  containerRef: React.RefObject<HTMLDivElement | null>;
  onViewportChange: (next: ViewportState) => void;
}

const MINIMAP_WIDTH = 168;
const MINIMAP_HEIGHT = 120;
const MINIMAP_PADDING = 8;

const MiniMap: React.FC<MiniMapProps> = ({
  nodes,
  textAnnotations,
  viewport,
  containerRef,
  onViewportChange,
}) => {
  const bounds = useMemo(() => computeNodeBounds(nodes, textAnnotations), [nodes, textAnnotations]);
  const [containerSize, setContainerSize] = useState({ width: 800, height: 600 });

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;

    const updateSize = () => {
      const rect = element.getBoundingClientRect();
      setContainerSize({
        width: rect.width || 800,
        height: rect.height || 600,
      });
    };

    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(element);
    return () => observer.disconnect();
  }, [containerRef]);

  const containerWidth = containerSize.width;
  const containerHeight = containerSize.height;

  if (!bounds) return null;

  const worldWidth = Math.max(1, bounds.maxX - bounds.minX + 200);
  const worldHeight = Math.max(1, bounds.maxY - bounds.minY + 200);
  const boundsMinX = bounds.minX - 100;
  const boundsMinY = bounds.minY - 100;

  const scaleX = (MINIMAP_WIDTH - MINIMAP_PADDING * 2) / worldWidth;
  const scaleY = (MINIMAP_HEIGHT - MINIMAP_PADDING * 2) / worldHeight;
  const scale = Math.min(scaleX, scaleY);

  const offsetX = MINIMAP_PADDING + (MINIMAP_WIDTH - MINIMAP_PADDING * 2 - worldWidth * scale) / 2;
  const offsetY =
    MINIMAP_PADDING + (MINIMAP_HEIGHT - MINIMAP_PADDING * 2 - worldHeight * scale) / 2;

  const worldToMini = (worldX: number, worldY: number): { x: number; y: number } => ({
    x: offsetX + (worldX - boundsMinX) * scale,
    y: offsetY + (worldY - boundsMinY) * scale,
  });

  // Visible viewport rectangle in world space.
  const viewWorldMinX = -viewport.x / viewport.zoom;
  const viewWorldMinY = -viewport.y / viewport.zoom;
  const viewWorldMaxX = viewWorldMinX + containerWidth / viewport.zoom;
  const viewWorldMaxY = viewWorldMinY + containerHeight / viewport.zoom;
  const viewMiniMin = worldToMini(viewWorldMinX, viewWorldMinY);
  const viewMiniMax = worldToMini(viewWorldMaxX, viewWorldMaxY);

  const handleMouseDown = (event: React.MouseEvent<SVGSVGElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    const recenter = (clientX: number, clientY: number) => {
      const miniX = clientX - rect.left;
      const miniY = clientY - rect.top;
      const worldX = boundsMinX + (miniX - offsetX) / scale;
      const worldY = boundsMinY + (miniY - offsetY) / scale;
      onViewportChange({
        x: containerWidth / 2 - worldX * viewport.zoom,
        y: containerHeight / 2 - worldY * viewport.zoom,
        zoom: viewport.zoom,
      });
    };
    recenter(event.clientX, event.clientY);
    const move = (e: globalThis.MouseEvent) => recenter(e.clientX, e.clientY);
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  return (
    <div className="editor-minimap pointer-events-auto absolute bottom-3 right-3 z-20 rounded-lg border border-white/10 bg-zinc-950/80 shadow-2xl backdrop-blur-md">
      <svg
        width={MINIMAP_WIDTH}
        height={MINIMAP_HEIGHT}
        className="block cursor-pointer rounded-lg"
        onMouseDown={handleMouseDown}
        role="application"
        aria-label="map minimap"
      >
        <rect width={MINIMAP_WIDTH} height={MINIMAP_HEIGHT} fill="rgba(2,6,23,0.5)" />
        {nodes.map((node) => {
          const center = getNodeCenter(node);
          const mini = worldToMini(center.x, center.y);
          const color = node.styleHint?.color ?? getNodeDisplayColor(node);
          return (
            <rect
              key={node.id}
              x={mini.x - 2}
              y={mini.y - 1}
              width={4}
              height={2.5}
              rx={1}
              fill={color}
            />
          );
        })}
        <rect
          x={viewMiniMin.x}
          y={viewMiniMin.y}
          width={Math.max(2, viewMiniMax.x - viewMiniMin.x)}
          height={Math.max(2, viewMiniMax.y - viewMiniMin.y)}
          fill="rgba(196,181,253,0.18)"
          stroke="rgba(196,181,253,0.85)"
          strokeWidth={1}
          pointerEvents="none"
        />
      </svg>
    </div>
  );
};
