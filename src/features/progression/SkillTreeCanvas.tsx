import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent,
  type Ref,
} from "react";
import { useLingui } from "@lingui/react/macro";
import type { SkillBranchId } from "../../game/progression";
import {
  BRANCH_VISUALS,
  CORE_RADIUS,
  NODE_RADIUS,
  TIER_RADII,
  TREE_VIEWBOX,
  getRequirementProgress,
  getSkillNodeState,
  hexagonPoints,
  wrapSkillName,
  type SkillNodeLayout,
  type SkillNodeState,
  type SkillTreeLayout,
} from "./skillTree";
import {
  clampSkillTreeScale,
  createLatestFrameScheduler,
  getReadableSkillTreeScale,
  measureSkillTreeViewport,
  skillTreeScreenDeltaToWorld,
  skillTreeScreenToWorld,
  zoomSkillTreeAt,
  type SkillTreeCamera,
  type SkillTreeViewport,
} from "./skillTreeCamera";

export type CameraRequest = {
  x: number;
  y: number;
  scale: number;
  /** Bump to re-trigger a camera move to the same spot. */
  nonce: number;
};

export type SkillTreeCanvasProps = {
  layout: SkillTreeLayout;
  skillRanks: Readonly<Record<string, number>>;
  disabledSkillIds: ReadonlySet<string>;
  branchRanks: Record<SkillBranchId, number>;
  spentSkillPoints: number;
  unspentSkillPoints: number;
  branchNames: Record<SkillBranchId, string>;
  level: number;
  levelRatio: number;
  selectedSkillId: string | null;
  hoveredBranch: SkillBranchId | null;
  burstSkillId: string | null;
  cameraRequest: CameraRequest;
  onSelectSkill: (skillId: string) => void;
  onPurchaseSkill: (skillId: string) => void;
  onRecenter: () => void;
};

const NODE_STATE_OPACITY: Record<SkillNodeState, number> = {
  locked: 0.4,
  available: 1,
  ranked: 1,
  maxed: 1,
  muted: 0.65,
};

const HEX_OUTER = hexagonPoints(NODE_RADIUS);
const HEX_INNER = hexagonPoints(NODE_RADIUS - 7);

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true
  );
}

export function SkillTreeCanvas({
  layout,
  skillRanks,
  disabledSkillIds,
  branchRanks,
  spentSkillPoints,
  unspentSkillPoints,
  branchNames,
  level,
  levelRatio,
  selectedSkillId,
  hoveredBranch,
  burstSkillId,
  cameraRequest,
  onSelectSkill,
  onPurchaseSkill,
  onRecenter,
}: SkillTreeCanvasProps) {
  const { t } = useLingui();
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const cameraGroupRef = useRef<SVGGElement | null>(null);
  const cameraRef = useRef<SkillTreeCamera>({ x: 0, y: 0, scale: 1 });
  const queuedCameraRef = useRef<SkillTreeCamera | null>(null);
  const viewportRef = useRef<SkillTreeViewport | null>(null);
  const initialCameraAppliedRef = useRef(false);
  const cameraSchedulerRef = useRef<ReturnType<
    typeof createLatestFrameScheduler<SkillTreeCamera>
  > | null>(null);
  const cameraAnimationFrameRef = useRef(0);
  const wheelSettledTimeoutRef = useRef(0);
  const movementReasonsRef = useRef(new Set<"drag" | "wheel" | "animation">());
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const cursorRef = useRef({ x: 0, y: 0, flip: false });
  const dragRef = useRef<{ pointerId: number; clientX: number; clientY: number; moved: boolean }>({
    pointerId: -1,
    clientX: 0,
    clientY: 0,
    moved: false,
  });
  const [isPanning, setIsPanning] = useState(false);
  const [hoveredSkillId, setHoveredSkillId] = useState<string | null>(null);

  const progressContext = useMemo(
    () => ({ branchRanks, spentSkillPoints }),
    [branchRanks, spentSkillPoints]
  );

  const nodeStates = useMemo(() => {
    const states = new Map<
      string,
      { rank: number; state: SkillNodeState; unlocked: boolean; canBuy: boolean }
    >();
    for (const node of layout.nodes) {
      const rank = Math.max(0, Math.floor(skillRanks[node.id] ?? 0));
      const { unlocked } = getRequirementProgress(node.skill, progressContext);
      const state = getSkillNodeState(node.skill, {
        rank,
        isDisabled: disabledSkillIds.has(node.id),
        unlocked,
      });
      states.set(node.id, {
        rank,
        state,
        unlocked,
        canBuy: unlocked && rank < node.skill.maxRank && unspentSkillPoints > 0,
      });
    }
    return states;
  }, [layout.nodes, skillRanks, disabledSkillIds, progressContext, unspentSkillPoints]);

  /* ─── Camera ─────────────────────────────────────────────── */

  /**
   * A whole-tree fit is unreadable on short screens, so the first framing zooms
   * to a fixed on-screen node size instead. `scale: 0` asks for that framing.
   */
  const updateViewportMeasurement = useCallback((): SkillTreeViewport | null => {
    const svg = svgRef.current;
    if (!svg) return null;
    const viewport = measureSkillTreeViewport(svg.getBoundingClientRect());
    viewportRef.current = viewport;
    return viewport;
  }, []);

  const setCameraMoving = useCallback(
    (reason: "drag" | "wheel" | "animation", moving: boolean): void => {
      if (moving) movementReasonsRef.current.add(reason);
      else movementReasonsRef.current.delete(reason);
      canvasRef.current?.classList.toggle(
        "skill-tree-camera-moving",
        movementReasonsRef.current.size > 0
      );
    },
    []
  );

  // Camera movement stays outside React state so the filter-heavy tree is never
  // reconciled at pointer frequency.
  const commitCamera = useCallback((next: SkillTreeCamera): void => {
    queuedCameraRef.current = null;
    cameraRef.current = next;
    cameraGroupRef.current?.setAttribute(
      "transform",
      `scale(${next.scale}) translate(${-next.x} ${-next.y})`
    );
  }, []);

  useLayoutEffect(() => {
    const scheduler = createLatestFrameScheduler<SkillTreeCamera>(
      requestAnimationFrame,
      cancelAnimationFrame,
      commitCamera
    );
    cameraSchedulerRef.current = scheduler;
    return () => {
      scheduler.cancel();
      cameraSchedulerRef.current = null;
    };
  }, [commitCamera]);

  const scheduleCamera = useCallback((next: SkillTreeCamera): void => {
    queuedCameraRef.current = next;
    cameraSchedulerRef.current?.schedule(next);
  }, []);

  const flushScheduledCamera = useCallback((): void => {
    cameraSchedulerRef.current?.flush();
  }, []);

  useLayoutEffect(() => {
    updateViewportMeasurement();
    const svg = svgRef.current;
    if (!svg || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(updateViewportMeasurement);
    observer.observe(svg);
    return () => observer.disconnect();
  }, [updateViewportMeasurement]);

  useLayoutEffect(() => {
    flushScheduledCamera();
    if (cameraAnimationFrameRef.current !== 0) {
      cancelAnimationFrame(cameraAnimationFrameRef.current);
      cameraAnimationFrameRef.current = 0;
    }
    const viewport = viewportRef.current ?? updateViewportMeasurement();
    const target = {
      x: cameraRequest.x,
      y: cameraRequest.y,
      scale:
        cameraRequest.scale <= 0
          ? getReadableSkillTreeScale(viewport?.rendered ?? 0)
          : clampSkillTreeScale(cameraRequest.scale),
    };
    // The initial frame must be immediately usable. Later navigation requests retain
    // their glide animation unless the user requested reduced motion.
    if (!initialCameraAppliedRef.current || !viewport || prefersReducedMotion()) {
      initialCameraAppliedRef.current = true;
      commitCamera(target);
      setCameraMoving("animation", false);
      return;
    }
    setCameraMoving("animation", true);
    const step = (): void => {
      const current = queuedCameraRef.current ?? cameraRef.current;
      const next = {
        x: current.x + (target.x - current.x) * 0.18,
        y: current.y + (target.y - current.y) * 0.18,
        scale: current.scale + (target.scale - current.scale) * 0.18,
      };
      const settled =
        Math.abs(target.x - next.x) < 0.5 &&
        Math.abs(target.y - next.y) < 0.5 &&
        Math.abs(target.scale - next.scale) < 0.002;
      commitCamera(settled ? target : next);
      if (settled) {
        cameraAnimationFrameRef.current = 0;
        setCameraMoving("animation", false);
      } else {
        cameraAnimationFrameRef.current = requestAnimationFrame(step);
      }
    };
    cameraAnimationFrameRef.current = requestAnimationFrame(step);
    return () => {
      if (cameraAnimationFrameRef.current !== 0) {
        cancelAnimationFrame(cameraAnimationFrameRef.current);
        cameraAnimationFrameRef.current = 0;
      }
      setCameraMoving("animation", false);
    };
  }, [
    cameraRequest,
    commitCamera,
    flushScheduledCamera,
    setCameraMoving,
    updateViewportMeasurement,
  ]);

  useEffect(
    () => () => {
      if (cameraAnimationFrameRef.current !== 0) {
        cancelAnimationFrame(cameraAnimationFrameRef.current);
      }
      if (wheelSettledTimeoutRef.current !== 0) {
        window.clearTimeout(wheelSettledTimeoutRef.current);
      }
    },
    []
  );

  const screenToWorld = useCallback(
    (
      clientX: number,
      clientY: number,
      camera: SkillTreeCamera = cameraRef.current
    ): { x: number; y: number } | null => {
      const viewport = viewportRef.current;
      return viewport ? skillTreeScreenToWorld(clientX, clientY, viewport, camera) : null;
    },
    []
  );

  const screenDeltaToWorld = useCallback(
    (deltaX: number, deltaY: number, camera: SkillTreeCamera) => {
      const viewport = viewportRef.current;
      return viewport
        ? skillTreeScreenDeltaToWorld(deltaX, deltaY, viewport, camera)
        : { x: deltaX, y: deltaY };
    },
    []
  );

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const handleWheel = (event: WheelEvent): void => {
      event.preventDefault();
      const current = queuedCameraRef.current ?? cameraRef.current;
      const nextScale = clampSkillTreeScale(current.scale * (event.deltaY > 0 ? 0.88 : 1.14));
      if (nextScale === current.scale) return;
      const anchor = screenToWorld(event.clientX, event.clientY, current);
      setCameraMoving("wheel", true);
      if (wheelSettledTimeoutRef.current !== 0) {
        window.clearTimeout(wheelSettledTimeoutRef.current);
      }
      wheelSettledTimeoutRef.current = window.setTimeout(() => {
        wheelSettledTimeoutRef.current = 0;
        setCameraMoving("wheel", false);
      }, 120);
      if (!anchor) {
        scheduleCamera({ ...current, scale: nextScale });
        return;
      }
      scheduleCamera(zoomSkillTreeAt(current, anchor, nextScale));
    };
    svg.addEventListener("wheel", handleWheel, { passive: false });
    return () => svg.removeEventListener("wheel", handleWheel);
  }, [scheduleCamera, screenToWorld, setCameraMoving]);

  const handlePointerDown = (event: PointerEvent<SVGSVGElement>): void => {
    if (event.button !== 0) return;
    flushScheduledCamera();
    updateViewportMeasurement();
    dragRef.current = {
      pointerId: event.pointerId,
      clientX: event.clientX,
      clientY: event.clientY,
      moved: false,
    };
    setIsPanning(true);
    setCameraMoving("drag", true);
  };

  const handlePointerMove = (event: PointerEvent<SVGSVGElement>): void => {
    const drag = dragRef.current;
    if (drag.pointerId !== event.pointerId) return;
    const deltaX = event.clientX - drag.clientX;
    const deltaY = event.clientY - drag.clientY;
    if (!drag.moved && Math.hypot(deltaX, deltaY) < 4) return;
    drag.moved = true;
    drag.clientX = event.clientX;
    drag.clientY = event.clientY;
    const previous = queuedCameraRef.current ?? cameraRef.current;
    const worldDelta = screenDeltaToWorld(deltaX, deltaY, previous);
    scheduleCamera({
      x: previous.x - worldDelta.x,
      y: previous.y - worldDelta.y,
      scale: previous.scale,
    });
  };

  const endPointer = (event: PointerEvent<SVGSVGElement>): void => {
    if (dragRef.current.pointerId !== event.pointerId) return;
    dragRef.current.pointerId = -1;
    flushScheduledCamera();
    setIsPanning(false);
    setCameraMoving("drag", false);
  };

  const zoomBy = (factor: number): void => {
    flushScheduledCamera();
    const previous = cameraRef.current;
    commitCamera({ ...previous, scale: clampSkillTreeScale(previous.scale * factor) });
  };

  const moveTooltip = (x: number, y: number, flip: boolean): void => {
    cursorRef.current = { x, y, flip };
    const tooltip = tooltipRef.current;
    if (!tooltip) return;
    tooltip.style.left = `${x}px`;
    tooltip.style.top = `${y}px`;
    tooltip.style.transform = `translate(${flip ? "calc(-100% - 22px)" : "22px"}, -50%)`;
  };

  const setTooltipElement = useCallback((tooltip: HTMLDivElement | null): void => {
    tooltipRef.current = tooltip;
    if (!tooltip) return;
    const { x, y, flip } = cursorRef.current;
    tooltip.style.left = `${x}px`;
    tooltip.style.top = `${y}px`;
    tooltip.style.transform = `translate(${flip ? "calc(-100% - 22px)" : "22px"}, -50%)`;
  }, []);

  /* ─── Rendering ──────────────────────────────────────────── */

  const renderNode = (node: SkillNodeLayout) => {
    const info = nodeStates.get(node.id)!;
    const visual = BRANCH_VISUALS[node.branch];
    const isSelected = selectedSkillId === node.id;
    const isHovered = hoveredSkillId === node.id;
    const isDimmed = hoveredBranch !== null && hoveredBranch !== node.branch;
    const fillRatio = info.rank / node.skill.maxRank;
    const rimColor =
      info.state === "muted"
        ? "#fb7185"
        : info.state === "maxed"
          ? "#fde68a"
          : info.state === "locked"
            ? "rgba(148,163,184,0.55)"
            : visual.accent;
    const labelLines = wrapSkillName(node.skill.name);
    const ariaLabel =
      info.state === "locked"
        ? t`${node.skill.name}. Locked. Requires more ranks.`
        : t`${node.skill.name}. Rank ${info.rank} of ${node.skill.maxRank}.`;

    return (
      <g
        key={node.id}
        transform={`translate(${node.x} ${node.y})`}
        opacity={(isDimmed ? 0.25 : 1) * NODE_STATE_OPACITY[info.state]}
        className="skill-node"
        role="button"
        tabIndex={0}
        aria-label={ariaLabel}
        aria-pressed={isSelected}
        onClick={() => {
          if (dragRef.current.moved) return;
          onSelectSkill(node.id);
        }}
        onDoubleClick={() => info.canBuy && onPurchaseSkill(node.id)}
        onContextMenu={(event) => {
          event.preventDefault();
          onSelectSkill(node.id);
          if (info.canBuy) onPurchaseSkill(node.id);
        }}
        onKeyDown={(event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          onSelectSkill(node.id);
          if (info.canBuy) onPurchaseSkill(node.id);
        }}
        onPointerEnter={() => setHoveredSkillId(node.id)}
        onPointerLeave={() =>
          setHoveredSkillId((current) => (current === node.id ? null : current))
        }
      >
        {info.canBuy && (
          <circle
            r={NODE_RADIUS + 10}
            fill="none"
            stroke={visual.accent}
            strokeWidth={2}
            className="skill-node-ready"
          />
        )}
        {burstSkillId === node.id && (
          <circle
            r={NODE_RADIUS}
            fill="none"
            stroke={visual.accent}
            strokeWidth={3}
            className="skill-node-burst"
          />
        )}
        <polygon
          points={HEX_OUTER}
          fill="rgba(8,7,18,0.92)"
          stroke={rimColor}
          strokeWidth={isSelected ? 3.5 : info.rank > 0 ? 2.6 : 1.6}
          style={{
            filter: info.rank > 0 || isHovered ? `drop-shadow(0 0 10px ${rimColor})` : undefined,
            transformBox: "fill-box",
            transformOrigin: "center",
            transform: isHovered || isSelected ? "scale(1.08)" : undefined,
            transition: "transform 140ms ease-out",
          }}
        />
        <polygon
          points={HEX_INNER}
          fill={info.rank > 0 ? `${visual.accent}22` : "transparent"}
          stroke="rgba(255,255,255,0.06)"
        />
        {/* Rank fill arc */}
        {info.rank > 0 && (
          <circle
            r={NODE_RADIUS + 5}
            fill="none"
            stroke={info.state === "maxed" ? "#fde68a" : visual.accent}
            strokeWidth={3}
            strokeLinecap="round"
            strokeDasharray={`${fillRatio * 2 * Math.PI * (NODE_RADIUS + 5)} ${2 * Math.PI * (NODE_RADIUS + 5)}`}
            transform="rotate(-90)"
            opacity={0.9}
          />
        )}
        {isSelected && (
          <circle
            r={NODE_RADIUS + 14}
            fill="none"
            stroke="rgba(255,255,255,0.75)"
            strokeWidth={1.5}
            strokeDasharray="6 8"
            className="skill-node-selection"
          />
        )}
        <text
          textAnchor="middle"
          y={9}
          fontSize={26}
          style={{ pointerEvents: "none" }}
          opacity={info.state === "locked" ? 0.5 : 1}
        >
          {node.icon}
        </text>
        {info.state === "locked" && (
          <text textAnchor="middle" x={NODE_RADIUS - 6} y={-NODE_RADIUS + 12} fontSize={15}>
            🔒
          </text>
        )}
        {info.state === "muted" && (
          <text textAnchor="middle" x={NODE_RADIUS - 6} y={-NODE_RADIUS + 12} fontSize={15}>
            🚫
          </text>
        )}
        {node.skill.maxRank > 1 && info.rank > 0 && (
          <g transform={`translate(0 ${NODE_RADIUS + 3})`}>
            <rect
              x={-21}
              y={-12}
              width={42}
              height={21}
              rx={10.5}
              fill="rgba(6,5,14,0.95)"
              stroke={rimColor}
              strokeWidth={1.2}
            />
            <text textAnchor="middle" y={4} fontSize={13.5} fill="#f4f4f5" fontWeight={700}>
              {info.rank}/{node.skill.maxRank}
            </text>
          </g>
        )}
        <g transform={`translate(0 ${NODE_RADIUS + 32})`} style={{ pointerEvents: "none" }}>
          {labelLines.map((line, index) => (
            <text
              key={line}
              textAnchor="middle"
              y={index * 16}
              fontSize={14}
              fill={info.state === "locked" ? "#94a3b8" : "#e4e4e7"}
              fontWeight={600}
              style={{ paintOrder: "stroke", stroke: "rgba(3,2,10,0.9)", strokeWidth: 3 }}
            >
              {line}
            </text>
          ))}
        </g>
      </g>
    );
  };

  const hoveredNode = hoveredSkillId ? layout.nodeById.get(hoveredSkillId) : null;

  return (
    <div
      ref={canvasRef}
      className="skill-tree-canvas relative h-full w-full overflow-hidden rounded-3xl border border-white/10 bg-[radial-gradient(circle_at_center,rgba(76,29,149,0.28),rgba(3,2,12,0.94)_70%)]"
    >
      <svg
        ref={svgRef}
        viewBox={`${TREE_VIEWBOX.minX} ${TREE_VIEWBOX.minY} ${TREE_VIEWBOX.size} ${TREE_VIEWBOX.size}`}
        className={`h-full w-full touch-none select-none ${isPanning ? "cursor-grabbing" : "cursor-grab"}`}
        onPointerDown={handlePointerDown}
        onPointerMove={(event) => {
          handlePointerMove(event);
          const rect = event.currentTarget.getBoundingClientRect();
          const x = event.clientX - rect.left;
          moveTooltip(x, event.clientY - rect.top, x > rect.width * 0.6);
        }}
        onPointerUp={endPointer}
        onPointerCancel={endPointer}
        onPointerLeave={endPointer}
        role="application"
        aria-label={t`Skill tree canvas`}
      >
        <defs>
          <radialGradient id="skill-core-glow">
            <stop offset="0%" stopColor="rgba(167,139,250,0.55)" />
            <stop offset="100%" stopColor="rgba(167,139,250,0)" />
          </radialGradient>
        </defs>

        <g ref={cameraGroupRef} transform="scale(1) translate(0 0)">
          {/* Orbit rings give the tree a readable tier structure */}
          {TIER_RADII.map((radius) => (
            <circle
              key={radius}
              r={radius}
              fill="none"
              stroke="rgba(255,255,255,0.05)"
              strokeDasharray="3 12"
            />
          ))}

          {layout.edges.map((edge) => {
            const targetInfo = nodeStates.get(edge.toId)!;
            const sourceRanked =
              edge.fromId === null || (nodeStates.get(edge.fromId)?.rank ?? 0) > 0;
            const energized = sourceRanked && targetInfo.rank > 0;
            const visual = BRANCH_VISUALS[edge.branch];
            const dimmed = hoveredBranch !== null && hoveredBranch !== edge.branch;
            return (
              <line
                key={edge.id}
                x1={edge.x1}
                y1={edge.y1}
                x2={edge.x2}
                y2={edge.y2}
                stroke={energized ? visual.accent : "rgba(148,163,184,0.35)"}
                strokeWidth={energized ? 3 : 1.4}
                strokeLinecap="round"
                opacity={dimmed ? 0.12 : energized ? 0.85 : targetInfo.unlocked ? 0.5 : 0.22}
                className={energized ? "skill-edge-live" : undefined}
                style={energized ? { filter: `drop-shadow(0 0 6px ${visual.accent})` } : undefined}
              />
            );
          })}

          {layout.gates.map((gate) => {
            const current =
              gate.requirement.kind === "total" ? spentSkillPoints : branchRanks[gate.branch];
            // Satisfied gates disappear so only the walls you still have to break show up.
            if (current >= gate.requirement.ranks) return null;
            const dimmed = hoveredBranch !== null && hoveredBranch !== gate.branch;
            return (
              <g
                key={gate.id}
                transform={`translate(${gate.x} ${gate.y})`}
                opacity={dimmed ? 0.15 : 0.95}
                style={{ pointerEvents: "none" }}
              >
                <rect
                  x={-30}
                  y={-13}
                  width={60}
                  height={26}
                  rx={13}
                  fill="rgba(4,3,12,0.92)"
                  stroke="rgba(251,191,36,0.6)"
                />
                <text textAnchor="middle" y={5} fontSize={13} fontWeight={700} fill="#fde68a">
                  🔒 {current}/{gate.requirement.ranks}
                </text>
              </g>
            );
          })}

          {layout.nodes.map(renderNode)}

          {layout.branches.map((branch) => {
            const visual = BRANCH_VISUALS[branch.id];
            const dimmed = hoveredBranch !== null && hoveredBranch !== branch.id;
            return (
              <g
                key={branch.id}
                transform={`translate(${branch.labelX} ${branch.labelY})`}
                opacity={dimmed ? 0.2 : 1}
                style={{ pointerEvents: "none" }}
              >
                <text
                  textAnchor="middle"
                  fontSize={22}
                  fontWeight={900}
                  fill={visual.accent}
                  style={{ paintOrder: "stroke", stroke: "rgba(3,2,10,0.95)", strokeWidth: 5 }}
                >
                  {visual.icon} {branchNames[branch.id].toUpperCase()}
                </text>
                <text
                  textAnchor="middle"
                  y={20}
                  fontSize={13}
                  fill="rgba(226,232,240,0.7)"
                  style={{ paintOrder: "stroke", stroke: "rgba(3,2,10,0.95)", strokeWidth: 4 }}
                >
                  {branchRanks[branch.id]} {t`ranks`}
                </text>
              </g>
            );
          })}

          {/* Core */}
          <g style={{ pointerEvents: "none" }}>
            <circle
              r={CORE_RADIUS * 2.2}
              fill="url(#skill-core-glow)"
              className="skill-core-glow"
            />
            <circle
              r={CORE_RADIUS}
              fill="rgba(8,6,20,0.95)"
              stroke="rgba(167,139,250,0.6)"
              strokeWidth={2}
            />
            <circle
              r={CORE_RADIUS - 10}
              fill="none"
              stroke="rgba(255,255,255,0.08)"
              strokeWidth={8}
            />
            <circle
              r={CORE_RADIUS - 10}
              fill="none"
              stroke="#a78bfa"
              strokeWidth={8}
              strokeLinecap="round"
              transform="rotate(-90)"
              strokeDasharray={`${Math.max(0, Math.min(1, levelRatio)) * 2 * Math.PI * (CORE_RADIUS - 10)} ${2 * Math.PI * (CORE_RADIUS - 10)}`}
            />
            <text
              textAnchor="middle"
              y={-8}
              fontSize={16}
              fill="rgba(196,181,253,0.9)"
              fontWeight={700}
            >
              {t`LEVEL`}
            </text>
            <text textAnchor="middle" y={30} fontSize={46} fill="#f5f3ff" fontWeight={900}>
              {level}
            </text>
            {unspentSkillPoints > 0 && (
              <g transform={`translate(0 ${CORE_RADIUS + 26})`}>
                <g className="skill-core-points">
                  <rect
                    x={-72}
                    y={-16}
                    width={144}
                    height={32}
                    rx={16}
                    fill="rgba(16,10,4,0.95)"
                    stroke="#fbbf24"
                    strokeWidth={2}
                  />
                  <text textAnchor="middle" y={6} fontSize={16} fontWeight={800} fill="#fde68a">
                    {unspentSkillPoints} {t`points`}
                  </text>
                </g>
              </g>
            )}
          </g>
        </g>
      </svg>

      {hoveredNode && !isPanning && (
        <SkillTooltip node={hoveredNode} nodeStates={nodeStates} tooltipRef={setTooltipElement} />
      )}

      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between gap-3 p-3">
        <p className="rounded-xl border border-white/10 bg-black/60 px-3 py-1.5 text-[11px] text-zinc-400 backdrop-blur">
          {t`Drag to pan · Scroll to zoom · Click a node to inspect · Double-click to spend a point`}
        </p>
        <div className="pointer-events-auto flex gap-2">
          <CanvasButton label="−" title={t`Zoom out`} onClick={() => zoomBy(0.85)} />
          <CanvasButton label="+" title={t`Zoom in`} onClick={() => zoomBy(1.18)} />
          <CanvasButton label="⌖" title={t`Recenter the tree`} onClick={onRecenter} />
        </div>
      </div>
    </div>
  );
}

function CanvasButton({
  label,
  title,
  onClick,
}: {
  label: string;
  title: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      className="h-9 w-9 rounded-xl border border-white/15 bg-black/60 text-lg font-bold text-zinc-200 backdrop-blur transition hover:border-violet-300/50 hover:bg-violet-500/20"
    >
      {label}
    </button>
  );
}

function SkillTooltip({
  node,
  nodeStates,
  tooltipRef,
}: {
  node: SkillNodeLayout;
  nodeStates: Map<string, { rank: number; state: SkillNodeState; unlocked: boolean }>;
  tooltipRef: Ref<HTMLDivElement>;
}) {
  const { t } = useLingui();
  const info = nodeStates.get(node.id);
  if (!info) return null;
  const visual = BRANCH_VISUALS[node.branch];
  return (
    <div
      ref={tooltipRef}
      className="pointer-events-none absolute z-10 w-64 rounded-2xl border border-white/15 bg-black/90 p-3 backdrop-blur-md"
    >
      <p className="flex items-center gap-2 text-sm font-black" style={{ color: visual.accent }}>
        <span>{node.icon}</span>
        {node.skill.name}
      </p>
      <p className="mt-1 text-xs text-zinc-300">{node.skill.description}</p>
      <p className="mt-2 font-mono text-[11px] uppercase tracking-widest text-zinc-500">
        {t`Tier ${node.tier}`} · {t`Rank`} {info.rank}/{node.skill.maxRank}
      </p>
    </div>
  );
}
