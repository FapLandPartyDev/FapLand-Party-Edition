/**
 * GameScene — Full-screen PixiJS canvas that renders the entire game.
 * Nothing is rendered in the DOM except the canvas and a thin React wrapper
 * for the perk-selection overlay (which uses HTML for accessibility/ease).
 */

import "pixi.js/browser";
import "pixi.js/unsafe-eval";
import { Application, Container, Graphics, Rectangle, Text, TextStyle } from "pixi.js";
import "pixi.js/events";
import { memo, useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import { useControllerSurface } from "../../controller";
import {
  CONTROLLER_SUPPORT_ENABLED_EVENT,
  CONTROLLER_SUPPORT_ENABLED_KEY,
  normalizeControllerSupportEnabled,
} from "../../constants/experimentalFeatures";
import { useHandy } from "../../contexts/HandyContext";
import {
  getPerkById,
  getSinglePlayerAntiPerkPool,
  getSinglePlayerPerkPool,
} from "../../game/data/perks";
import {
  DICE_RESULT_REVEAL_DURATION,
  DICE_ROLL_DURATION,
  LANDING_DURATION,
  PERK_REVEAL_DURATION,
  STEP_DURATION,
  type AnimPhase,
  useGameAnimation,
} from "../../game/useGameAnimation";
import type { BoardField, GameState, PlayerState } from "../../game/types";
import { PERK_RARITY_META, resolvePerkRarity } from "../../game/data/perkRarity";
import type { InstalledRound } from "../../services/db";
import { trpc } from "../../services/trpc";
import { describePerkEffects } from "../../game/engine";
import { useSfwMode } from "../../hooks/useSfwMode";
import {
  THEHANDY_OFFSET_FINE_STEP_MS,
  THEHANDY_OFFSET_STEP_MS,
} from "../../constants/theHandy";
import { playRoundRewardSound, playRoundRewardTickSound } from "../../utils/audio";

import { formatDurationLabel } from "../../utils/duration";
import { abbreviateNsfwText } from "../../utils/sfwText";
import { RoundVideoOverlay } from "./RoundVideoOverlay";
import { buildGameplayRoundVideoOverlayProps } from "./buildRoundVideoOverlayProps";
import { RoundStartTransition } from "./RoundStartTransition";
import { getPerkIconGlyph } from "./PerkIcon";
import { InventoryDockButton } from "./InventoryDockButton";
import { PerkInventoryPanel } from "./PerkInventoryPanel";
import { buildTileDurationLabelByFieldId } from "./tileDurationLabels";
import { getNodeScale, parseHexColorToNumber } from "../../features/map-editor/nodeVisuals";
import ControllerHints from "./ControllerHints";

// ─── Board layout strategy ────────────────────────────────────────────────────
// Switch ACTIVE_LAYOUT to change how the board positions tiles.
// "vertical" = single column, tile 0 at bottom, ascending upward.
// "snake"    = multi-column snaking grid (classic board game).
type BoardLayout = "vertical" | "snake";
const ACTIVE_LAYOUT: BoardLayout = "snake";

// ─── Tile geometry ────────────────────────────────────────────────────────────
const TILE_W = 108;
const TILE_H = 108;

// Vertical layout spacing
const TILE_STEP_V = 122;
const BOARD_PAD_H = 48;
const BOARD_PAD_VX = 44;

// Snake layout spacing
const COL_COUNT = 4;
const GAP_X_SN = 168;
const GAP_Y_SN = 146;
const PAD_X_SN = 74;
const PAD_Y_SN = 78;
const GRAPH_PAD_X = 90;
const GRAPH_PAD_Y = 90;

// ─── Colour palette ───────────────────────────────────────────────────────────

type TileC = {
  /** Main bright accent colour used for text, highlights */
  accent: number;
  /** Darker variant for fills */
  dark: number;
  /** Outer glow / border ring colour */
  glow: number;
  /** Very dark base (tile body background) */
  base: number;
};

const TILE_COLOURS: Record<string, TileC> = {
  start: { accent: 0x6ef4ff, dark: 0x1f7b98, glow: 0x8de6ff, base: 0x071523 },
  path: { accent: 0x4c87ff, dark: 0x2c4aa5, glow: 0x7a9dff, base: 0x090f21 },
  event: { accent: 0xff5d8d, dark: 0xaa2859, glow: 0xff78a5, base: 0x220913 },
  perk: { accent: 0xf266ff, dark: 0x8c2cb8, glow: 0xf7a3ff, base: 0x1d0a2a },
};

const PLAYER_COLOURS = [0xff5d8d, 0x6ef4ff, 0xb08dff, 0x6ff2bf] as const;

// ─── Layout helpers ───────────────────────────────────────────────────────────

/** Vertical layout: tile 0 at bottom, ascending upward. */
function indexToVertical(i: number, total: number): { x: number; y: number } {
  // row 0 = bottom; row (total-1) = top
  const y = BOARD_PAD_H + (total - 1 - i) * TILE_STEP_V;
  return { x: BOARD_PAD_VX, y };
}

/** Snake layout (kept for future configs). */
function indexToSnake(i: number, total: number): { x: number; y: number } {
  const row = Math.floor(i / COL_COUNT);
  const col = row % 2 === 0 ? i % COL_COUNT : COL_COUNT - 1 - (i % COL_COUNT);
  const flippedRow = Math.floor((total - 1) / COL_COUNT) - row;
  return {
    x: PAD_X_SN + col * GAP_X_SN,
    y: PAD_Y_SN + flippedRow * GAP_Y_SN,
  };
}

type TileLayout = {
  origins: Array<{ x: number; y: number }>;
  dimensions: Array<{ width: number; height: number }>;
  centres: Array<{ x: number; y: number }>;
  width: number;
  height: number;
};

type Point = { x: number; y: number };
type PathPreviewSegment = { from: Point; to: Point };

function hasFiniteStyleHintXY(field: BoardField): boolean {
  const x = field.styleHint?.x;
  const y = field.styleHint?.y;
  return typeof x === "number" && Number.isFinite(x) && typeof y === "number" && Number.isFinite(y);
}

function getFieldTileWidth(field: BoardField): number {
  return TILE_W * getNodeScale(field);
}

function getFieldTileHeight(field: BoardField): number {
  return TILE_H * getNodeScale(field);
}

function buildFallbackTileOrigins(total: number): Array<{ x: number; y: number }> {
  return Array.from({ length: total }, (_, index) => {
    if (ACTIVE_LAYOUT === "vertical") return indexToVertical(index, total);
    return indexToSnake(index, total);
  });
}

function buildTileLayout(board: BoardField[]): TileLayout {
  if (board.length === 0) {
    return {
      origins: [],
      dimensions: [],
      centres: [],
      width: TILE_W + GRAPH_PAD_X * 2,
      height: TILE_H + GRAPH_PAD_Y * 2,
    };
  }

  const fallbackOrigins = buildFallbackTileOrigins(board.length);
  const dimensions = board.map((field) => ({
    width: getFieldTileWidth(field),
    height: getFieldTileHeight(field),
  }));
  const hasGraphCoords = board.some(hasFiniteStyleHintXY);
  if (hasGraphCoords) {
    const graphOrigins = board.map((field, index) =>
      hasFiniteStyleHintXY(field)
        ? {
          x: field.styleHint!.x as number,
          y: field.styleHint!.y as number,
        }
        : fallbackOrigins[index]!
    );
    const xs = graphOrigins.map((point) => point.x);
    const ys = graphOrigins.map((point) => point.y);
    const minX = Math.min(...xs);
    const minY = Math.min(...ys);
    Math.max(...xs);
    Math.max(...ys);
    const normalizedOrigins = graphOrigins.map((point) => ({
      x: point.x - minX + GRAPH_PAD_X,
      y: point.y - minY + GRAPH_PAD_Y,
    }));
    const maxRight = normalizedOrigins.reduce(
      (max, point, index) => Math.max(max, point.x + (dimensions[index]?.width ?? TILE_W)),
      0
    );
    const maxBottom = normalizedOrigins.reduce(
      (max, point, index) => Math.max(max, point.y + (dimensions[index]?.height ?? TILE_H)),
      0
    );
    const centres = normalizedOrigins.map((point, index) => ({
      x: point.x + (dimensions[index]?.width ?? TILE_W) / 2,
      y: point.y + (dimensions[index]?.height ?? TILE_H) / 2,
    }));
    return {
      origins: normalizedOrigins,
      dimensions,
      centres,
      width: maxRight + GRAPH_PAD_X,
      height: maxBottom + GRAPH_PAD_Y,
    };
  }

  const origins = fallbackOrigins;
  const centres = origins.map((point, index) => ({
    x: point.x + (dimensions[index]?.width ?? TILE_W) / 2,
    y: point.y + (dimensions[index]?.height ?? TILE_H) / 2,
  }));
  const maxRight = origins.reduce(
    (max, point, index) => Math.max(max, point.x + (dimensions[index]?.width ?? TILE_W)),
    0
  );
  const maxBottom = origins.reduce(
    (max, point, index) => Math.max(max, point.y + (dimensions[index]?.height ?? TILE_H)),
    0
  );
  if (ACTIVE_LAYOUT === "vertical") {
    return {
      origins,
      dimensions,
      centres,
      width: Math.max(BOARD_PAD_VX * 2 + TILE_W, maxRight + BOARD_PAD_VX),
      height: Math.max(
        BOARD_PAD_H * 2 + (board.length - 1) * TILE_STEP_V + TILE_H,
        maxBottom + BOARD_PAD_H
      ),
    };
  }
  return {
    origins,
    dimensions,
    centres,
    width: Math.max(PAD_X_SN * 2 + (COL_COUNT - 1) * GAP_X_SN + TILE_W, maxRight + PAD_X_SN),
    height: Math.max(PAD_Y_SN * 2 + TILE_H, maxBottom + PAD_Y_SN),
  };
}

function resolveEffectiveRestPauseSec(state: GameState): number {
  const currentPlayer = state.players[state.currentPlayerIndex];
  if (!currentPlayer) return 20;
  const currentField = state.config.board.find((field) => field.id === currentPlayer.currentNodeId);
  const checkpointRestMs =
    currentField?.kind === "safePoint" ? (currentField.checkpointRestMs ?? 0) : 0;
  const roundPauseMs = Number.isFinite(currentPlayer.stats.roundPauseMs)
    ? currentPlayer.stats.roundPauseMs
    : 20000;
  return Math.max(roundPauseMs, checkpointRestMs) / 1000;
}

function tileOrigin(layout: TileLayout, index: number): { x: number; y: number } {
  const total = layout.origins.length;
  if (total === 0) return { x: GRAPH_PAD_X, y: GRAPH_PAD_Y };
  return layout.origins[wrapIndex(index, total)] ?? layout.origins[0]!;
}

function tileDimensions(layout: TileLayout, index: number): { width: number; height: number } {
  const total = layout.dimensions.length;
  if (total === 0) return { width: TILE_W, height: TILE_H };
  return (
    layout.dimensions[wrapIndex(index, total)] ??
    layout.dimensions[0] ?? { width: TILE_W, height: TILE_H }
  );
}

function tileCentre(layout: TileLayout, index: number): { x: number; y: number } {
  const { x, y } = tileOrigin(layout, index);
  const { width, height } = tileDimensions(layout, index);
  return { x: x + width / 2, y: y + height / 2 };
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function wrapIndex(i: number, total: number): number {
  const mod = i % total;
  return mod < 0 ? mod + total : mod;
}

function tileCentreAtProgress(layout: TileLayout, indexProgress: number): { x: number; y: number } {
  const total = layout.origins.length;
  if (total <= 0) return { x: GRAPH_PAD_X + TILE_W / 2, y: GRAPH_PAD_Y + TILE_H / 2 };
  const maxIndex = Math.max(0, total - 1);
  const clamped = clampNum(indexProgress, 0, maxIndex);
  const fromIndex = Math.floor(clamped);
  const toIndex = Math.min(maxIndex, fromIndex + 1);
  const t = clamped - fromIndex;
  const from = tileCentre(layout, fromIndex);
  if (toIndex === fromIndex || t <= 0) return from;
  const to = tileCentre(layout, toIndex);
  return {
    x: lerp(from.x, to.x, t),
    y: lerp(from.y, to.y, t),
  };
}

function getBoardProgressRatio(state: GameState, position: number | undefined): number {
  if (state.sessionPhase === "completed") return 1;
  const finalBoardIndex = Math.max(1, state.config.board.length - 1);
  return clampNum((position ?? 0) / finalBoardIndex, 0, 1);
}

function easeOutBack(t: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

/** Smooth S-curve ease for XY translation */
function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/** Deceleration curve — fast at start, slow at end */
function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

function blendColor(a: number, b: number, t: number): number {
  const lerpc = (c1: number, c2: number) => Math.round(c1 + (c2 - c1) * t);
  const r = lerpc((a >> 16) & 0xff, (b >> 16) & 0xff);
  const g = lerpc((a >> 8) & 0xff, (b >> 8) & 0xff);
  const bl = lerpc(a & 0xff, b & 0xff);
  return (r << 16) | (g << 8) | bl;
}

function clampNum(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function clampBoardOffset(
  viewportSize: number,
  boardSize: number,
  preferredOffset: number,
  margin: number
): number {
  const centeredOffset = (viewportSize - boardSize) / 2;
  if (boardSize + margin * 2 <= viewportSize) {
    return centeredOffset;
  }
  const minOffset = viewportSize - boardSize - margin;
  const maxOffset = margin;
  return clampNum(preferredOffset, minOffset, maxOffset);
}

function resolveTileColours(field: BoardField): TileC {
  const customColor = parseHexColorToNumber(field.styleHint?.color);
  if (customColor === null) {
    return TILE_COLOURS[field.kind] ?? TILE_COLOURS.path;
  }
  return {
    accent: customColor,
    dark: blendColor(customColor, 0x000000, 0.38),
    glow: blendColor(customColor, 0xffffff, 0.24),
    base: blendColor(customColor, 0x050816, 0.84),
  };
}

function buildPendingPathPreviewSegments(state: GameState, edgeId: string): PathPreviewSegment[] {
  const pending = state.pendingPathChoice;
  if (!pending) return [];

  const graph = state.config.runtimeGraph;
  const board = state.config.board;
  const layout = buildTileLayout(board);
  const centres = layout.centres;
  const segments: PathPreviewSegment[] = [];

  let selectedEdge = graph.edgesById[edgeId];
  let currentNodeId = pending.fromNodeId;
  let remainingSteps = pending.remainingSteps;
  let remainingMoney = state.players[state.currentPlayerIndex]?.money ?? 0;
  let safety = Math.max(4, remainingSteps + 4);

  while (selectedEdge && remainingSteps > 0 && safety > 0) {
    safety -= 1;
    if (selectedEdge.fromNodeId !== currentNodeId || remainingMoney < selectedEdge.gateCost) break;

    const fromIndex = graph.nodeIndexById[selectedEdge.fromNodeId];
    const toIndex = graph.nodeIndexById[selectedEdge.toNodeId];
    const from = typeof fromIndex === "number" ? centres[fromIndex] : undefined;
    const to = typeof toIndex === "number" ? centres[toIndex] : undefined;
    if (from && to) {
      segments.push({ from, to });
    }

    remainingMoney -= selectedEdge.gateCost;
    currentNodeId = selectedEdge.toNodeId;
    remainingSteps -= 1;
    if (remainingSteps <= 0) break;

    const currentField = board[graph.nodeIndexById[currentNodeId] ?? -1];
    if (!currentField) break;
    if (
      currentField.forceStop ||
      currentField.kind === "safePoint" ||
      currentField.kind === "end"
    ) {
      break;
    }

    const outgoing = (graph.outgoingEdgeIdsByNodeId[currentNodeId] ?? [])
      .map((candidateEdgeId) => graph.edgesById[candidateEdgeId])
      .filter((edge): edge is NonNullable<typeof edge> => Boolean(edge))
      .filter((edge) => remainingMoney >= edge.gateCost);
    if (outgoing.length !== 1) break;
    selectedEdge = outgoing[0];
  }

  return segments;
}

function hashString(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash << 5) - hash + input.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

/**
 * Futuristic board tile with glass body and neon accent strips.
 */
function drawTile(
  g: Graphics,
  x: number,
  y: number,
  width: number,
  height: number,
  field: BoardField,
  isActive: boolean,
  isHighlighted: boolean,
  phase: number
): void {
  const c = resolveTileColours(field);
  const pulse = 0.5 + 0.5 * Math.sin(phase * 2.1);
  const outerX = x + 8;
  const outerY = y + 10;
  const outerW = Math.max(28, width - 16);
  const outerH = Math.max(28, height - 18);
  const innerX = outerX + 4;
  const innerY = outerY + 4;
  const innerW = outerW - 8;
  const innerH = outerH - 8;
  const bevel = 14;

  g.roundRect(outerX + 1, outerY + outerH - 4, outerW - 2, 12, 6);
  g.fill({ color: 0x000000, alpha: 0.28 });

  if (isActive || isHighlighted) {
    g.roundRect(outerX - 10, outerY - 10, outerW + 20, outerH + 20, bevel + 6);
    g.fill({ color: c.glow, alpha: isActive ? 0.22 + 0.18 * pulse : 0.14 });
  }

  g.roundRect(outerX, outerY, outerW, outerH, bevel);
  g.fill({ color: blendColor(c.base, 0x000000, 0.26), alpha: 0.95 });
  g.stroke({
    color: isActive ? 0xffffff : c.dark,
    alpha: isActive ? 0.95 : 0.72,
    width: isActive ? 2.4 : 1.7,
  });

  g.roundRect(innerX, innerY, innerW, innerH * 0.7, bevel - 4);
  g.fill({ color: blendColor(c.base, c.accent, 0.18), alpha: 0.78 });

  g.roundRect(innerX + 2, innerY + 2, innerW - 4, innerH * 0.28, bevel - 6);
  g.fill({ color: 0xffffff, alpha: 0.08 + 0.05 * pulse });

  g.roundRect(innerX + 5, outerY + outerH - 20, innerW - 10, 8, 4);
  g.fill({ color: c.accent, alpha: 0.38 + pulse * 0.24 });

  const cx = x + width / 2;
  const cy = y + height / 2 + 5;
  if (field.kind === "start") {
    g.poly([cx - 7, cy - 7, cx + 8, cy, cx - 7, cy + 7]);
    g.fill({ color: 0xe9fbff, alpha: 0.95 });
  } else if (field.kind === "event") {
    g.poly([
      cx,
      cy - 9,
      cx + 8,
      cy - 1,
      cx + 2,
      cy - 1,
      cx + 6,
      cy + 8,
      cx - 3,
      cy + 2,
      cx + 1,
      cy + 2,
    ]);
    g.fill({ color: 0xffd7e5, alpha: 0.93 });
  } else if (field.kind === "perk") {
    g.poly([cx, cy - 10, cx + 9, cy, cx, cy + 10, cx - 9, cy]);
    g.fill({ color: 0xf5d4ff, alpha: 0.95 });
    g.circle(cx, cy, 2.2);
    g.fill({ color: c.accent, alpha: 1 });
  } else {
    g.circle(cx - 5.5, cy, 3);
    g.fill({ color: 0xd6e5ff, alpha: 0.9 });
    g.circle(cx + 5.5, cy, 3);
    g.fill({ color: 0xd6e5ff, alpha: 0.9 });
  }
}

function drawTileHighlight(
  g: Graphics,
  x: number,
  y: number,
  width: number,
  height: number,
  color: number,
  alpha: number
): void {
  g.roundRect(x - 6, y - 6, width + 12, height + 12, 18);
  g.fill({ color, alpha: alpha * 0.18 });
  g.roundRect(x - 1, y - 1, width + 2, height + 2, 12);
  g.stroke({ color, alpha: alpha * 0.85, width: 2.2 });
}

/**
 * Futuristic road segment connecting spaces.
 */
function drawNeonRoadConnector(
  g: Graphics,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  t: number
): void {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  if (len < 1) return;

  const nx = -dy / len;
  const ny = dx / len;
  const edgeOffset = 12;
  const pulse = 0.5 + 0.5 * Math.sin(t * 2.2);

  // Soft outer glow
  g.moveTo(x1, y1);
  g.lineTo(x2, y2);
  g.stroke({ color: 0x8a4dff, alpha: 0.08 + pulse * 0.06, width: 42 });

  // Asphalt / lane body
  g.moveTo(x1, y1);
  g.lineTo(x2, y2);
  g.stroke({ color: 0x151a2a, alpha: 0.95, width: 26 });

  // Neon edge rails
  g.moveTo(x1 + nx * edgeOffset, y1 + ny * edgeOffset);
  g.lineTo(x2 + nx * edgeOffset, y2 + ny * edgeOffset);
  g.stroke({ color: 0x79ddff, alpha: 0.78 + pulse * 0.16, width: 2.4 });

  g.moveTo(x1 - nx * edgeOffset, y1 - ny * edgeOffset);
  g.lineTo(x2 - nx * edgeOffset, y2 - ny * edgeOffset);
  g.stroke({ color: 0xff71ca, alpha: 0.72 + pulse * 0.16, width: 2.2 });

  // Center lane accent
  g.moveTo(x1, y1);
  g.lineTo(x2, y2);
  g.stroke({ color: 0xb0baff, alpha: 0.28, width: 2.6 });

  // Traveling marker lights for movement
  for (let i = 0; i < 4; i++) {
    const p = (t * 0.34 + i * 0.25) % 1;
    const mx = x1 + dx * p;
    const my = y1 + dy * p;
    g.circle(mx, my, 2.1);
    g.fill({ color: 0xdce7ff, alpha: 0.7 });
  }
}

function drawConnectorFlow(
  g: Graphics,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  t: number,
  color: number,
  alpha = 1
): void {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  if (len < 1) return;

  g.moveTo(x1, y1);
  g.lineTo(x2, y2);
  g.stroke({ color, alpha: 0.1 * alpha, width: 2 });

  for (let i = 0; i < 3; i++) {
    const progress = (t * 0.22 + i * 0.31) % 1;
    const px = x1 + dx * progress;
    const py = y1 + dy * progress;
    const r = 3.5 - i * 0.6;
    g.circle(px, py, r * 1.9);
    g.fill({ color, alpha: (0.08 - i * 0.015) * alpha });
    g.circle(px, py, r);
    g.fill({ color: 0xf6fbff, alpha: (0.7 - i * 0.16) * alpha });
  }
}

function drawRoadGate(
  g: Graphics,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  t: number
): { x: number; y: number; normalX: number; normalY: number } | null {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  if (len < 1) return null;

  const ux = dx / len;
  const uy = dy / len;
  const nx = -uy;
  const ny = ux;
  const gateX = x1 + dx * 0.5;
  const gateY = y1 + dy * 0.5;
  const pulse = 0.5 + 0.5 * Math.sin(t * 2.4);

  const frameWidth = 38;
  const frameHeight = 32;
  const pillarWidth = 8;
  const lintelHeight = 7;
  const innerWidth = 24;
  const innerHeight = 20;
  const pillarRadius = 3;

  g.circle(gateX, gateY + 2, 28);
  g.fill({ color: 0xff79b4, alpha: 0.05 + pulse * 0.04 });

  g.roundRect(
    gateX - frameWidth / 2,
    gateY - frameHeight / 2,
    pillarWidth,
    frameHeight,
    pillarRadius
  );
  g.fill({ color: 0x182235, alpha: 0.98 });
  g.stroke({ color: 0xaed9ff, alpha: 0.55, width: 1.1 });

  g.roundRect(
    gateX + frameWidth / 2 - pillarWidth,
    gateY - frameHeight / 2,
    pillarWidth,
    frameHeight,
    pillarRadius
  );
  g.fill({ color: 0x182235, alpha: 0.98 });
  g.stroke({ color: 0xaed9ff, alpha: 0.55, width: 1.1 });

  g.roundRect(gateX - frameWidth / 2 - 3, gateY + frameHeight / 2 - 5, pillarWidth + 6, 6, 3);
  g.fill({ color: 0x0d1322, alpha: 0.94 });
  g.roundRect(
    gateX + frameWidth / 2 - pillarWidth - 3,
    gateY + frameHeight / 2 - 5,
    pillarWidth + 6,
    6,
    3
  );
  g.fill({ color: 0x0d1322, alpha: 0.94 });

  g.roundRect(gateX - frameWidth / 2, gateY - frameHeight / 2, frameWidth, lintelHeight, 4);
  g.fill({ color: 0x243651, alpha: 0.98 });
  g.stroke({ color: 0x8fd0ff, alpha: 0.7, width: 1.2 });

  g.roundRect(gateX - innerWidth / 2, gateY - innerHeight / 2 + 2, innerWidth, innerHeight, 4);
  g.fill({ color: 0x0f1728, alpha: 0.96 });
  g.stroke({ color: 0xffc96d, alpha: 0.75 + pulse * 0.12, width: 1.3 });

  for (let bar = -1; bar <= 1; bar++) {
    const barX = gateX + bar * 6;
    g.moveTo(barX, gateY - innerHeight / 2 + 5);
    g.lineTo(barX, gateY + innerHeight / 2 - 3);
    g.stroke({ color: 0xffd978, alpha: 0.85, width: 1.7, cap: "round" });
  }

  g.moveTo(gateX - innerWidth / 2 + 3, gateY - 1);
  g.lineTo(gateX + innerWidth / 2 - 3, gateY - 1);
  g.stroke({ color: 0xffd978, alpha: 0.65, width: 1.4, cap: "round" });

  g.circle(gateX, gateY + 2, 3.5);
  g.fill({ color: 0xff89bb, alpha: 0.95 });
  g.circle(gateX, gateY + 2, 7);
  g.stroke({ color: 0xff89bb, alpha: 0.24 + pulse * 0.12, width: 1.6 });

  return { x: gateX, y: gateY, normalX: nx, normalY: ny };
}

function drawTileBeacon(
  g: Graphics,
  cx: number,
  cy: number,
  color: number,
  t: number,
  alpha = 1
): void {
  const pulse = 0.5 + 0.5 * Math.sin(t * 3.2);
  for (let i = 0; i < 3; i++) {
    const radius = 34 + i * 15 + pulse * (8 + i * 3);
    g.circle(cx, cy, radius);
    g.stroke({
      color,
      alpha: (0.24 - i * 0.06) * alpha,
      width: 2 - i * 0.35,
    });
  }

  for (let i = 0; i < 5; i++) {
    const ang = t * 1.5 + i * ((Math.PI * 2) / 5);
    const orbit = 24 + pulse * 6;
    const px = cx + Math.cos(ang) * orbit;
    const py = cy + Math.sin(ang) * orbit;
    g.circle(px, py, 2.4);
    g.fill({ color: 0xf4fbff, alpha: 0.8 * alpha });
  }
}

function drawTokenTrail(
  g: Graphics,
  from: { x: number; y: number },
  to: { x: number; y: number },
  color: number,
  progress: number
): void {
  const clamped = clampNum(progress, 0, 1);
  const dx = to.x - from.x;
  const dy = to.y - from.y;

  for (let i = 0; i < 6; i++) {
    const step = clampNum(clamped - i * 0.09, 0, 1);
    const px = from.x + dx * step;
    const py = from.y + dy * step - Math.sin(step * Math.PI) * 18;
    const alpha = (0.26 - i * 0.035) * clamped;
    if (alpha <= 0) continue;
    g.circle(px, py, 18 - i * 2.2);
    g.fill({ color, alpha });
  }
}

function drawBoardSweep(g: Graphics, width: number, height: number, t: number, alpha = 1): void {
  const sweepX = ((t * 180) % (width + 260)) - 130;
  g.poly([sweepX - 90, -30, sweepX + 70, -30, sweepX + 180, height + 30, sweepX + 20, height + 30]);
  g.fill({ color: 0x8ad6ff, alpha: 0.05 * alpha });
}

function drawPlayerAvatarToken(
  g: Graphics,
  cx: number,
  cy: number,
  playerIndex: number,
  bob: number,
  stretchScale: number,
  t: number
): void {
  const color = PLAYER_COLOURS[playerIndex % PLAYER_COLOURS.length];
  const pulse = 0.5 + 0.5 * Math.sin(t * 4.1);
  const centerY = cy - bob - 8;
  const auraR = 24 + 4 * pulse;

  g.ellipse(cx, centerY + 34, 20, 6);
  g.fill({ color: 0x000000, alpha: 0.33 });

  g.circle(cx, centerY, auraR + 8);
  g.fill({ color, alpha: 0.09 + pulse * 0.08 });
  g.circle(cx, centerY, auraR);
  g.fill({ color, alpha: 0.17 + pulse * 0.09 });

  const crystalH = 46 * stretchScale;
  const crystalW = 26 * (1 / stretchScale);
  g.poly([
    cx,
    centerY - crystalH * 0.58,
    cx + crystalW * 0.5,
    centerY - 2,
    cx,
    centerY + crystalH * 0.48,
    cx - crystalW * 0.5,
    centerY - 2,
  ]);
  g.fill({ color: blendColor(color, 0xffffff, 0.24), alpha: 0.95 });
  g.stroke({ color: 0xe6f7ff, alpha: 0.85, width: 1.5 });

  g.poly([
    cx - crystalW * 0.12,
    centerY - crystalH * 0.3,
    cx + crystalW * 0.28,
    centerY - 2,
    cx - crystalW * 0.06,
    centerY + crystalH * 0.28,
    cx - crystalW * 0.26,
    centerY - 2,
  ]);
  g.fill({ color: 0xffffff, alpha: 0.24 });

  g.circle(cx, centerY + crystalH * 0.52, 11);
  g.fill({ color: blendColor(color, 0x000000, 0.24), alpha: 1 });
  g.stroke({ color: 0xffffff, alpha: 0.52, width: 1.1 });
}

function drawDiceFrame(
  g: Graphics,
  cx: number,
  cy: number,
  value: number,
  pulse: number,
  scale: number,
  accent: number
): void {
  const w = 190 * scale;
  const h = 190 * scale;
  const x = cx - w / 2;
  const y = cy - h / 2;

  g.roundRect(x - 12, y - 12, w + 24, h + 24, 24);
  g.fill({ color: accent, alpha: 0.15 + pulse * 0.1 });
  g.roundRect(x, y, w, h, 20);
  g.fill({ color: 0x0d1428, alpha: 0.96 });
  g.stroke({ color: blendColor(accent, 0xffffff, 0.2), alpha: 0.95, width: 2.2 });

  g.roundRect(x + 10, y + 10, w - 20, h - 20, 14);
  g.stroke({ color: 0x79c9ff, alpha: 0.45 + pulse * 0.2, width: 1.3 });

  const dots = getDiceDots(value);
  dots.forEach(([dx, dy]: [number, number]) => {
    const px = x + w * dx;
    const py = y + h * dy;
    g.circle(px, py, 12 * scale);
    g.fill({ color: accent, alpha: 0.17 + pulse * 0.1 });
    g.circle(px, py, 7 * scale);
    g.fill({ color: 0xe8f4ff, alpha: 0.95 });
  });
}

function drawDiceOverlay(
  g: Graphics,
  cx: number,
  cy: number,
  value: number,
  t: number,
  w: number,
  h: number
): void {
  const pulse = 0.5 + 0.5 * Math.sin(t * Math.PI * 8);
  const settle = easeOutBack(Math.min(1, t * 1.3));

  g.rect(0, 0, w, h);
  g.fill({ color: 0x05050c, alpha: 0.66 });

  for (let i = 0; i < 4; i++) {
    const ringR = 114 + i * 30 + Math.sin(t * Math.PI * 6 + i) * 9;
    g.circle(cx, cy, ringR);
    g.stroke({
      color: i % 2 === 0 ? 0x7de0ff : 0xff6ec6,
      alpha: 0.25 - i * 0.04 + pulse * 0.1,
      width: 2.4 - i * 0.4,
    });
  }

  drawDiceFrame(g, cx, cy, value, pulse, 0.95 + settle * 0.12, 0x7de0ff);
}

function drawDiceResultOverlay(
  g: Graphics,
  cx: number,
  cy: number,
  value: number,
  t: number,
  w: number,
  h: number
): void {
  const pulse = 0.5 + 0.5 * Math.sin(t * Math.PI * 10);
  const entry = easeOutBack(Math.min(1, t * 1.45));

  g.rect(0, 0, w, h);
  g.fill({ color: 0x05050c, alpha: 0.64 });

  for (let i = 0; i < 14; i++) {
    const ang = (i / 14) * Math.PI * 2;
    const r1 = 62 + entry * 20;
    const r2 = 138 + entry * 28;
    g.moveTo(cx + Math.cos(ang) * r1, cy + Math.sin(ang) * r1);
    g.lineTo(cx + Math.cos(ang) * r2, cy + Math.sin(ang) * r2);
    g.stroke({
      color: i % 2 === 0 ? 0xff70c8 : 0x83dfff,
      alpha: 0.24 + pulse * 0.28,
      width: 2.5,
    });
  }

  drawDiceFrame(g, cx, cy, value, pulse, 1.02 + entry * 0.1, 0xff70c8);
}

/** Returns normalised [0..1] dot positions for a standard dice face */
function getDiceDots(value: number): [number, number][] {
  const m = 0.22;
  const c = 0.5;
  const map: Record<number, [number, number][]> = {
    1: [[c, c]],
    2: [
      [m, m],
      [1 - m, 1 - m],
    ],
    3: [
      [m, m],
      [c, c],
      [1 - m, 1 - m],
    ],
    4: [
      [m, m],
      [1 - m, m],
      [m, 1 - m],
      [1 - m, 1 - m],
    ],
    5: [
      [m, m],
      [1 - m, m],
      [c, c],
      [m, 1 - m],
      [1 - m, 1 - m],
    ],
    6: [
      [m, m],
      [1 - m, m],
      [m, c],
      [1 - m, c],
      [m, 1 - m],
      [1 - m, 1 - m],
    ],
  };
  return map[Math.min(6, Math.max(1, value))] ?? map[1]!;
}

/**
 * Perfect balance of fun and calm: Constellation network + Floating Triangles and Hexagons.
 */
function drawBackground(g: Graphics, w: number, h: number, t: number): void {
  // 1. Deep space base backdrop
  const baseTop = 0x060714;
  const baseBottom = 0x1d0a2b;
  const bands = Math.max(12, Math.floor(h / 30));
  const bandH = h / bands;

  // Smooth vertical gradient
  for (let i = 0; i < bands; i++) {
    const p = i / (bands - 1);
    const col = blendColor(baseTop, baseBottom, p);
    g.rect(0, i * bandH, w, bandH + 1);
    g.fill({ color: col, alpha: 1 });
  }

  // 2. Dynamic Constellation Network
  const numNodes = 75;
  const maxDist = 200;
  const nodes: { x: number; y: number; r: number; c: number }[] = [];

  for (let i = 0; i < numNodes; i++) {
    const sx = Math.sin(i * 12.5) * 10000;
    const sy = Math.cos(i * 4.3) * 10000;
    const startX = (sx - Math.floor(sx)) * w;
    const startY = (sy - Math.floor(sy)) * h;

    // Complex movement: drifting and swirling
    const speed = 15 + (i % 10);
    const moveX = Math.sin(t * 0.4 + i) * speed;
    const moveY = Math.cos(t * 0.3 + i * 1.2) * speed;

    // Wrap around logic
    let nx = startX + moveX + ((t * 8) % w);
    if (nx > w + 50) nx = (nx % w) - 50;
    else if (nx < -50) nx = w + 50 - (-nx % w);

    let ny = startY + moveY + ((t * (4 + (i % 4))) % h);
    if (ny > h + 50) ny = (ny % h) - 50;
    else if (ny < -50) ny = h + 50 - (-ny % h);

    const r = 2.0 + (i % 4);
    const col = i % 2 === 0 ? 0x00f3ff : 0xff3b99;
    nodes.push({ x: nx, y: ny, r, c: col });
  }

  // Draw Constellation Lines + Nodes
  for (let i = 0; i < numNodes; i++) {
    const n1 = nodes[i];
    if (!n1) continue;
    for (let j = i + 1; j < numNodes; j++) {
      const n2 = nodes[j];
      if (!n2) continue;

      const dx = n2.x - n1.x;
      const dy = n2.y - n1.y;
      const dist = Math.hypot(dx, dy);
      if (dist < maxDist) {
        const alpha = Math.pow(1 - dist / maxDist, 2) * 0.55;
        g.moveTo(n1.x, n1.y);
        g.lineTo(n2.x, n2.y);
        g.stroke({ color: blendColor(n1.c, n2.c, 0.5), alpha, width: 2.0 });
      }
    }
  }

  // Draw Nodes over lines
  nodes.forEach((n) => {
    g.circle(n.x, n.y, n.r);
    g.fill({ color: n.c, alpha: 0.95 });
    g.circle(n.x, n.y, n.r * 2.5);
    g.fill({ color: n.c, alpha: 0.25 });
  });

  // 3. Floating Geometric Polygons (Hexagons and Triangles)
  const numShapes = 12;
  for (let i = 0; i < numShapes; i++) {
    const sx = Math.sin(i * 33.1) * 10000;
    const startX = (sx - Math.floor(sx)) * w;

    // Float upwards while rotating
    const floatSpeed = 12 + (i % 8);
    const my = h + 150 - ((t * floatSpeed + i * 200) % (h + 300));
    const mx = startX + Math.sin(t * 0.5 + i) * 60;

    const size = 20 + (i % 4) * 15;
    const col = i % 3 === 0 ? 0xff00b3 : i % 3 === 1 ? 0x00f3ff : 0x7b2cbf;
    const rot = t * (0.3 + (i % 2) * 0.2) + i;

    const shapePulse = 0.5 + 0.5 * Math.sin(t * 1.5 + i);
    const alpha = 0.12 + shapePulse * 0.08;

    if (i % 2 === 0) {
      // Hexagon
      const pts = [];
      for (let a = 0; a < 6; a++) {
        const ang = rot + a * (Math.PI / 3);
        pts.push(mx + Math.cos(ang) * size);
        pts.push(my + Math.sin(ang) * size);
      }
      g.poly(pts);
      g.stroke({ color: col, alpha, width: 2.5 });
      g.fill({ color: col, alpha: alpha * 0.2 });
    } else {
      // Triangle
      const pts = [];
      for (let a = 0; a < 3; a++) {
        pts.push(mx + Math.cos(rot + a * ((Math.PI * 2) / 3)) * size);
        pts.push(my + Math.sin(rot + a * ((Math.PI * 2) / 3)) * size);
      }
      g.poly(pts);
      g.stroke({ color: col, alpha, width: 2.5 });
      g.fill({ color: col, alpha: alpha * 0.2 });
    }
  }
}

/**
 * Empty static grid (now drawn dynamically in drawBackground context)
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function drawGrid(_g: Graphics, _w: number, _h: number): void {
  // Dynamic grid implementation moved to drawBackground for animation sync
}

function drawStars(
  g: Graphics,
  stars: { x: number; y: number; r: number; twinkle: number }[],
  t: number
): void {
  stars.forEach((s, idx) => {
    const alpha = 0.16 + 0.5 * Math.abs(Math.sin(t * s.twinkle));
    const col = idx % 2 === 0 ? 0x8fc3ff : 0xff86d6;
    g.circle(s.x, s.y, s.r);
    g.fill({ color: col, alpha });
  });
}

const HUD_W = 348;
const HUD_H = 390;
const HUD_MARGIN = 16;

function formatHudDurationRounds(rounds: number | null | undefined): string {
  if (rounds === null) return "perm";
  if (typeof rounds !== "number" || !Number.isFinite(rounds) || rounds <= 0) return "active";
  return `${rounds}r`;
}

function buildHudActiveEffectLines(player: PlayerState | undefined): string[] {
  if (!player) return [];

  const entries: string[] = [];
  const seenIds = new Set<string>();

  for (const effect of player.activePerkEffects) {
    const name = effect.name ?? getPerkById(effect.id)?.name ?? effect.id;
    entries.push(`${name} (${formatHudDurationRounds(effect.remainingRounds)})`);
    seenIds.add(effect.id);
  }

  for (const antiPerkId of player.antiPerks) {
    if (seenIds.has(antiPerkId)) continue;
    const antiPerk = getPerkById(antiPerkId);
    entries.push(`${antiPerk?.name ?? antiPerkId} (active)`);
  }

  if ((player.shieldRoundsRemaining ?? 0) > 0) {
    entries.push(`Shield (${player.shieldRoundsRemaining}r)`);
  }
  if ((player.pendingRollMultiplier ?? 0) > 0) {
    entries.push(`Next roll x${player.pendingRollMultiplier}`);
  }
  if ((player.pendingRollCeiling ?? 0) > 0) {
    entries.push(`Roll cap ${player.pendingRollCeiling}`);
  }
  if ((player.pendingIntensityCap ?? 0) > 0) {
    entries.push(`Intensity <= ${Math.round((player.pendingIntensityCap ?? 0) * 100)}%`);
  }

  const pauseCharges = Math.max(0, player.roundControl?.pauseCharges ?? 0);
  const skipCharges = Math.max(0, player.roundControl?.skipCharges ?? 0);
  if (pauseCharges > 0 || skipCharges > 0) {
    entries.push(`Controls P${pauseCharges} S${skipCharges}`);
  }

  return entries;
}

function formatHudActiveEffects(player: PlayerState | undefined): string {
  const entries = buildHudActiveEffectLines(player);
  if (entries.length === 0) return "ACTIVE EFFECTS\nNone";

  const visible = entries.slice(0, 3);
  if (entries.length > visible.length) {
    visible.push(`+${entries.length - visible.length} more`);
  }
  return `ACTIVE EFFECTS ${entries.length}\n${visible.join("\n")}`;
}

function formatHudDiceMeta(player: PlayerState | undefined): string {
  if (!player) return "RANGE 1-6";

  const parts = [`RANGE ${player.stats.diceMin}-${player.stats.diceMax}`];
  if ((player.pendingRollMultiplier ?? 0) > 0) {
    parts.push(`NEXT x${player.pendingRollMultiplier}`);
  }
  if ((player.pendingRollCeiling ?? 0) > 0) {
    parts.push(`CAP ${player.pendingRollCeiling}`);
  }

  return parts.join("  ");
}
const ROUND_REWARD_FX_DURATION = 2.25;

function drawHUD(hudG: Graphics, state: GameState, w: number, rewardPulse = 0): void {
  const player = state.players[state.currentPlayerIndex];
  const pulse = 0.5 + 0.5 * Math.sin(performance.now() * 0.003);

  const px = w - HUD_W - HUD_MARGIN;
  const py = 12;
  const score = player?.score ?? 0;
  const money = player?.money ?? 0;
  const boardProgress = getBoardProgressRatio(state, player?.position);
  const highscore = Math.max(1, state.highscore, score);
  const scoreRatio = Math.max(0, Math.min(1, score / highscore));
  const moneyCap = Math.max(1, state.config.economy.startingMoney * 2);
  const moneyRatio = Math.max(0, Math.min(1, money / moneyCap));
  const intermediaryRatio = Math.max(0, Math.min(1, state.intermediaryProbability));
  const antiRatio = Math.max(0, Math.min(1, state.antiPerkProbability));

  const outerX = px - 6;
  const outerY = py - 6;

  // Outer glow
  hudG.roundRect(outerX, outerY, HUD_W + 12, HUD_H + 12, 28);
  hudG.fill({ color: 0x9d00ff, alpha: 0.05 + pulse * 0.03 });

  // Main dark glass background
  hudG.roundRect(px, py, HUD_W, HUD_H, 20);
  hudG.fill({ color: 0x0d0614, alpha: 0.85 });

  // Sleek inner border
  hudG.stroke({ color: 0x3a1c5e, alpha: 0.8, width: 2 });

  // Top bright highlight edge (glass rim)
  hudG.roundRect(px + 1, py + 1, HUD_W - 2, HUD_H - 2, 18);
  hudG.stroke({ color: 0x613499, alpha: 0.4, width: 1 });

  const headerX = px + 16;
  const headerY = py + 16;
  const headerW = HUD_W - 32;

  // Subtle accent line under header
  hudG.moveTo(headerX, headerY + 61);
  hudG.lineTo(headerX + headerW, headerY + 61);
  hudG.stroke({ color: 0xff007f, alpha: 0.35 + pulse * 0.15, width: 1.5 });

  const section2Y = headerY + 75;

  // Track background for Board Progress
  const progressBarX = headerX;
  const progressBarY = section2Y + 28;
  const progressBarW = headerW;

  hudG.roundRect(progressBarX, progressBarY, progressBarW, 6, 3);
  hudG.fill({ color: 0x1a0b2e, alpha: 0.9 });

  // Progress fill (Cyan)
  hudG.roundRect(progressBarX, progressBarY, progressBarW * boardProgress, 6, 3);
  hudG.fill({ color: 0x00e5ff, alpha: 0.95 });

  if (boardProgress > 0) {
    hudG.circle(progressBarX + progressBarW * boardProgress, progressBarY + 3, 5 + pulse * 2);
    hudG.fill({ color: 0x00e5ff, alpha: 0.6 });
  }

  const statCardY = section2Y + 60;
  const statW = (HUD_W - 40) / 2;
  const scoreX = headerX;
  const moneyX = headerX + statW + 8;

  if (rewardPulse > 0) {
    const rewardGlow = rewardPulse * 0.25;
    hudG.roundRect(scoreX - 4, statCardY - 4, statW + 8, 48 + 8, 12);
    hudG.fill({ color: 0x00e5ff, alpha: rewardGlow });
    hudG.roundRect(moneyX - 4, statCardY - 4, statW + 8, 48 + 8, 12);
    hudG.fill({ color: 0xff007f, alpha: rewardGlow });
  }

  // Score Box
  hudG.roundRect(scoreX, statCardY, statW, 56, 10);
  hudG.fill({ color: 0x150926, alpha: 0.8 });
  hudG.stroke({ color: 0x2b144d, alpha: 0.6, width: 1 });

  const scoreBarY = statCardY + 44;
  hudG.roundRect(scoreX + 8, scoreBarY, statW - 16, 4, 2);
  hudG.fill({ color: 0x1f0d36, alpha: 1 });
  hudG.roundRect(scoreX + 8, scoreBarY, (statW - 16) * scoreRatio, 4, 2);
  hudG.fill({ color: 0x00e5ff, alpha: 0.9 });

  // Money Box
  hudG.roundRect(moneyX, statCardY, statW, 56, 10);
  hudG.fill({ color: 0x1a061c, alpha: 0.8 });
  hudG.stroke({ color: 0x4a113a, alpha: 0.6, width: 1 });

  const moneyBarY = statCardY + 44;
  hudG.roundRect(moneyX + 8, moneyBarY, statW - 16, 4, 2);
  hudG.fill({ color: 0x2d0a21, alpha: 1 });
  hudG.roundRect(moneyX + 8, moneyBarY, (statW - 16) * moneyRatio, 4, 2);
  hudG.fill({ color: 0xff007f, alpha: 0.9 });

  // Effects Area
  const effectsY = statCardY + 70;
  hudG.roundRect(headerX, effectsY, headerW, 60, 8);
  hudG.fill({ color: 0x12081f, alpha: 0.7 });
  hudG.stroke({ color: 0x24113d, alpha: 0.5, width: 1 });

  // Probabilities Area
  const probY = effectsY + 74;
  hudG.roundRect(headerX, probY, headerW, 50, 8);
  hudG.fill({ color: 0x11071c, alpha: 0.7 });
  hudG.stroke({ color: 0x2d1547, alpha: 0.5, width: 1 });

  const probBarW = headerW - 24;
  const interBarY = probY + 20;
  const antiBarY = probY + 34;

  hudG.roundRect(headerX + 12, interBarY, probBarW, 4, 2);
  hudG.fill({ color: 0x1b0c2e, alpha: 1 });
  hudG.roundRect(headerX + 12, interBarY, probBarW * intermediaryRatio, 4, 2);
  hudG.fill({ color: 0xb92b27, alpha: 0.9 });

  hudG.roundRect(headerX + 12, antiBarY, probBarW, 4, 2);
  hudG.fill({ color: 0x1b0c2e, alpha: 1 });
  hudG.roundRect(headerX + 12, antiBarY, probBarW * antiRatio, 4, 2);
  hudG.fill({ color: 0xff007f, alpha: 0.9 });

  hudG.roundRect(px + HUD_W - 86, py + 16, 70, 18, 6);
  hudG.fill({ color: 0x220e3b, alpha: 0.85 });
  hudG.stroke({ color: 0x441b75, alpha: 0.7, width: 1 });
}

function drawRoundRewardOverlay(g: Graphics, w: number, h: number, elapsed: number): void {
  const progress = clampNum(elapsed / ROUND_REWARD_FX_DURATION, 0, 1);
  const fadeIn = clampNum(progress / 0.16, 0, 1);
  const fadeOut = clampNum((1 - progress) / 0.35, 0, 1);
  const alpha = Math.min(fadeIn, fadeOut);
  const pulse = 0.5 + 0.5 * Math.sin(progress * Math.PI * 14);
  const cx = w / 2;
  const cy = h * 0.42;

  g.rect(0, 0, w, h);
  g.fill({ color: 0x07090f, alpha: alpha * 0.24 });

  for (let i = 0; i < 24; i++) {
    const angle = (i / 24) * Math.PI * 2 + progress * 2.4;
    const inner = 78 + pulse * 16;
    const outer = 240 + Math.sin(progress * 10 + i) * 26;
    g.moveTo(cx + Math.cos(angle) * inner, cy + Math.sin(angle) * inner);
    g.lineTo(cx + Math.cos(angle) * outer, cy + Math.sin(angle) * outer);
    g.stroke({
      color: i % 2 === 0 ? 0x7fe8ff : 0x89ffd8,
      alpha: (0.2 + pulse * 0.28) * alpha,
      width: 2.4,
    });
  }

  g.circle(cx, cy, 108 + pulse * 18);
  g.fill({ color: 0x66f2ff, alpha: alpha * 0.13 });
  g.circle(cx, cy, 80 + pulse * 10);
  g.fill({ color: 0xa3ffd6, alpha: alpha * 0.19 });
}

// ─── Star field (generated once) ─────────────────────────────────────────────

function generateStars(w: number, h: number, count: number) {
  return Array.from({ length: count }, () => ({
    x: Math.random() * w,
    y: Math.random() * h,
    r: Math.random() * 1.5 + 0.3,
    twinkle: Math.random() * 2 + 0.5,
  }));
}

function setTextIfChanged(textNode: Text, nextText: string): void {
  if (textNode.text !== nextText) {
    textNode.text = nextText;
  }
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface GameSceneProps {
  initialState: GameState;
  sessionStartedAtMs: number;
  installedRounds: InstalledRound[];
  onGiveUp: () => void;
  giveUpLabel?: string;
  optionsActions?: Array<{
    id: string;
    label: string;
    onClick: () => void;
    disabled?: boolean;
    tone?: "default" | "danger";
  }>;
  allowDebugRoundControls?: boolean;
  showDevPerkMenu?: boolean;
  onHighscoreChange?: (highscore: number) => void;
  onRoundPlayed?: (payload: { roundId: string; nodeId: string; poolId: string | null }) => void;
  onStateChange?: (state: GameState) => void;
  multiplayerRemotePlayers?: Array<{
    id: string;
    name: string;
    position: number;
  }>;
  showMultiplayerPlayerNames?: boolean;
  externalAntiPerkEvent?: {
    eventId: string;
    targetPlayerId: string;
    perkId: string;
    sourcePlayerName?: string;
  } | null;
  externalMoneyAdjustment?: {
    adjustmentId: string;
    playerId: string;
    delta: number;
    reason?: string;
  } | null;
  externalInventoryAction?: {
    actionId: string;
    type: "applySelf" | "consume";
    playerId: string;
    itemId: string;
    reason?: string;
  } | null;
  onExternalAntiPerkEventHandled?: (eventId: string) => void;
  onExternalMoneyAdjustmentHandled?: (adjustmentId: string) => void;
  onExternalInventoryActionHandled?: (actionId: string) => void;
  applyPerkDirectly?: boolean;
  onApplyPerkDirectlyChange?: (value: boolean) => void;
  onRoundOverlayUiVisibilityChange?: (visible: boolean) => void;
  externalNotification?: { nonce: number; message: string } | null;
  intermediaryLoadingPrompt: string;
  intermediaryLoadingDurationSec: number;
  intermediaryReturnPauseSec: number;
  initialShowProgressBarAlways?: boolean;
  initialShowAntiPerkBeatbar?: boolean;
  hideInventoryButton?: boolean;
  controllerSupportEnabled?: boolean;
}

// ─── Component ────────────────────────────────────────────────────────────────

export const GameScene = memo(function GameScene({
  initialState,
  sessionStartedAtMs,
  installedRounds,
  onGiveUp,
  giveUpLabel = "Give Up",
  optionsActions = [],
  allowDebugRoundControls = false,
  showDevPerkMenu = false,
  onHighscoreChange,
  onRoundPlayed,
  onStateChange,
  multiplayerRemotePlayers = [],
  externalAntiPerkEvent,
  externalMoneyAdjustment,
  externalInventoryAction,
  onExternalAntiPerkEventHandled,
  onExternalMoneyAdjustmentHandled,
  onExternalInventoryActionHandled,
  applyPerkDirectly = false,
  onApplyPerkDirectlyChange,
  onRoundOverlayUiVisibilityChange,
  externalNotification = null,
  intermediaryLoadingPrompt,
  intermediaryLoadingDurationSec,
  intermediaryReturnPauseSec,
  initialShowProgressBarAlways = false,
  initialShowAntiPerkBeatbar = true,
  showMultiplayerPlayerNames = false,
  hideInventoryButton = false,
  controllerSupportEnabled: initialControllerSupportEnabled = false,
}: GameSceneProps) {
  const sfwMode = useSfwMode();
  const containerRef = useRef<HTMLDivElement>(null);
  const appRef = useRef<Application | null>(null);
  const {
    connected: handyConnected,
    manuallyStopped: handyManuallyStopped,
    adjustOffset,
    resetOffset,
    offsetMs,
    toggleManualStop,
    forceStop,
  } = useHandy();

  const {
    state,
    animPhase,
    nextAutoRollInSec,
    pathChoiceRemainingMs,
    handleRoll,
    handleStartQueuedRound,
    handleCompleteRound,
    handleSelectPathEdge,
    handleSelectPerk,
    handleSkipPerk,
    handleApplyInventoryItemToSelf,
    handleConsumeInventoryItem,
    handleApplyExternalPerk,
    handleAdjustPlayerMoney,
    handleUseRoundControl,
    handleConsumeAntiPerkById,
    tickAnim,
  } = useGameAnimation(initialState, installedRounds);

  // Stable refs for RAF
  const stateRef = useRef(state);
  stateRef.current = state;
  const animPhaseRef = useRef(animPhase);
  animPhaseRef.current = animPhase;
  const handleRollRef = useRef(handleRoll);
  handleRollRef.current = handleRoll;
  const handleCompleteRoundRef = useRef(handleCompleteRound);
  handleCompleteRoundRef.current = handleCompleteRound;
  const handleStartQueuedRoundRef = useRef(handleStartQueuedRound);
  handleStartQueuedRoundRef.current = handleStartQueuedRound;
  const handleSelectPathEdgeRef = useRef(handleSelectPathEdge);
  handleSelectPathEdgeRef.current = handleSelectPathEdge;
  const handleSelectPerkRef = useRef(handleSelectPerk);
  handleSelectPerkRef.current = handleSelectPerk;
  const handleSkipPerkRef = useRef(handleSkipPerk);
  handleSkipPerkRef.current = handleSkipPerk;
  const handleApplyInventoryItemToSelfRef = useRef(handleApplyInventoryItemToSelf);
  handleApplyInventoryItemToSelfRef.current = handleApplyInventoryItemToSelf;
  const handleConsumeInventoryItemRef = useRef(handleConsumeInventoryItem);
  handleConsumeInventoryItemRef.current = handleConsumeInventoryItem;
  const handleApplyExternalPerkRef = useRef(handleApplyExternalPerk);
  handleApplyExternalPerkRef.current = handleApplyExternalPerk;
  const handleAdjustPlayerMoneyRef = useRef(handleAdjustPlayerMoney);
  handleAdjustPlayerMoneyRef.current = handleAdjustPlayerMoney;
  const tickAnimRef = useRef(tickAnim);
  tickAnimRef.current = tickAnim;
  const nextAutoRollInSecRef = useRef(nextAutoRollInSec);
  nextAutoRollInSecRef.current = nextAutoRollInSec;
  const multiplayerRemotePlayersRef = useRef(multiplayerRemotePlayers);
  multiplayerRemotePlayersRef.current = multiplayerRemotePlayers;
  const showMultiplayerPlayerNamesRef = useRef(showMultiplayerPlayerNames);
  showMultiplayerPlayerNamesRef.current = showMultiplayerPlayerNames;
  const applyPerkDirectlyRef = useRef(applyPerkDirectly);
  applyPerkDirectlyRef.current = applyPerkDirectly;
  const [showOptionsMenu, setShowOptionsMenu] = useState(false);
  const [showPerkInventoryMenu, setShowPerkInventoryMenu] = useState(false);
  const [showDevPerkMenuModal, setShowDevPerkMenuModal] = useState(false);
  const [controllerSupportEnabled, setControllerSupportEnabled] = useState(
    initialControllerSupportEnabled
  );
  const [hasConnectedGamepad, setHasConnectedGamepad] = useState(false);
  const [cumRequestSignal, setCumRequestSignal] = useState(0);
  const [showNonCumOutcomeMenu, setShowNonCumOutcomeMenu] = useState(false);
  const showNonCumOutcomeMenuRef = useRef(showNonCumOutcomeMenu);
  showNonCumOutcomeMenuRef.current = showNonCumOutcomeMenu;
  const [handyNotification, setHandyNotification] = useState<string | null>(null);
  const [roundPreviewState, setRoundPreviewState] = useState({ active: false, loading: false });
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [completedElapsedSec, setCompletedElapsedSec] = useState<number | null>(null);
  const [controllerPerkSelectionIndex, setControllerPerkSelectionIndex] = useState(0);
  const [highlightedPathEdgeId, setHighlightedPathEdgeId] = useState<string | null>(null);
  const handleRoundPreviewStateChange = useCallback(
    (nextState: { active: boolean; loading: boolean }) => {
      setRoundPreviewState((previous) =>
        previous.active === nextState.active && previous.loading === nextState.loading
          ? previous
          : nextState
      );
    },
    []
  );
  const highlightedPathEdgeIdRef = useRef<string | null>(highlightedPathEdgeId);
  highlightedPathEdgeIdRef.current = highlightedPathEdgeId;
  const nowMsRef = useRef(nowMs);
  nowMsRef.current = nowMs;
  const completedElapsedSecRef = useRef<number | null>(completedElapsedSec);
  completedElapsedSecRef.current = completedElapsedSec;
  const handyNotificationTimerRef = useRef<number | null>(null);
  const controllerPerkSelectionIndexRef = useRef(controllerPerkSelectionIndex);
  controllerPerkSelectionIndexRef.current = controllerPerkSelectionIndex;
  const showOptionsMenuRef = useRef(showOptionsMenu);
  showOptionsMenuRef.current = showOptionsMenu;
  const showPerkInventoryMenuRef = useRef(showPerkInventoryMenu);
  showPerkInventoryMenuRef.current = showPerkInventoryMenu;
  const showDevPerkMenuModalRef = useRef(showDevPerkMenuModal);
  showDevPerkMenuModalRef.current = showDevPerkMenuModal;
  const onHighscoreChangeRef = useRef(onHighscoreChange);
  onHighscoreChangeRef.current = onHighscoreChange;
  const onStateChangeRef = useRef(onStateChange);
  onStateChangeRef.current = onStateChange;
  const onRoundPlayedRef = useRef(onRoundPlayed);
  onRoundPlayedRef.current = onRoundPlayed;
  const shouldShowControllerPromptsRef = useRef(false);
  const canShowDevPerkMenu = showDevPerkMenu;
  const devPerkPool = useMemo(() => getSinglePlayerPerkPool(), []);
  const devAntiPerkPool = useMemo(() => getSinglePlayerAntiPerkPool(), []);

  const showHandyNotification = useCallback((message: string) => {
    if (handyNotificationTimerRef.current !== null) {
      window.clearTimeout(handyNotificationTimerRef.current);
    }
    setHandyNotification(message);
    handyNotificationTimerRef.current = window.setTimeout(() => {
      handyNotificationTimerRef.current = null;
      setHandyNotification(null);
    }, 2400);
  }, []);

  const isLastCumRoundActive =
    state.sessionPhase === "cum" &&
    state.activeRound?.phaseKind === "cum" &&
    state.nextCumRoundIndex >= state.config.singlePlayer.cumRoundIds.length;
  const tileDurationLabelByFieldId = useMemo(
    () => buildTileDurationLabelByFieldId(initialState.config.board, installedRounds),
    [initialState.config.board, installedRounds]
  );

  const requestCumConfirmation = useCallback(() => {
    if (stateRef.current.sessionPhase === "completed") return;
    if (stateRef.current.activeRound?.phaseKind === "cum") {
      setCumRequestSignal((previous) => previous + 1);
    } else {
      setShowNonCumOutcomeMenu(true);
    }
  }, []);

  const handleSelfReportedCum = useCallback(() => {
    void forceStop().catch((err) => console.warn("Failed to stop Handy after cum report", err));
    onStateChangeRef.current?.({
      ...stateRef.current,
      sessionPhase: "completed",
      completionReason: "self_reported_cum",
    });
  }, [forceStop]);

  const handleHandyManualToggle = useCallback(() => {
    void toggleManualStop().then((result) => {
      if (result === "stopped") {
        showHandyNotification("TheHandy stopped.");
        return;
      }
      if (result === "resumed") {
        showHandyNotification("TheHandy resumed.");
        return;
      }
      showHandyNotification("No connected TheHandy to toggle.");
    });
  }, [showHandyNotification, toggleManualStop]);

  const handleHandyOffsetAdjust = useCallback(
    (deltaMs: number) => {
      void adjustOffset(deltaMs).then((nextOffsetMs) => {
        showHandyNotification(`TheHandy offset: ${nextOffsetMs >= 0 ? "+" : ""}${nextOffsetMs}ms`);
      });
    },
    [adjustOffset, showHandyNotification]
  );

  const handleHandyOffsetReset = useCallback(() => {
    if (offsetMs === 0) {
      showHandyNotification("TheHandy offset reset");
      return;
    }
    void resetOffset().then(() => {
      showHandyNotification("TheHandy offset reset");
    });
  }, [offsetMs, resetOffset, showHandyNotification]);

  useEffect(() => {
    setControllerSupportEnabled(initialControllerSupportEnabled);
  }, [initialControllerSupportEnabled]);

  useEffect(() => {
    let mounted = true;

    void trpc.store.get
      .query({ key: CONTROLLER_SUPPORT_ENABLED_KEY })
      .then((stored) => {
        if (!mounted) return;
        setControllerSupportEnabled(normalizeControllerSupportEnabled(stored));
      })
      .catch((error) => {
        console.warn("Failed to read controller support enabled in game scene", error);
      });

    const handleControllerSupportChanged = (event: Event) => {
      const nextValue =
        event instanceof CustomEvent ? normalizeControllerSupportEnabled(event.detail) : false;
      setControllerSupportEnabled(nextValue);
    };

    window.addEventListener(CONTROLLER_SUPPORT_ENABLED_EVENT, handleControllerSupportChanged);

    return () => {
      mounted = false;
      window.removeEventListener(CONTROLLER_SUPPORT_ENABLED_EVENT, handleControllerSupportChanged);
    };
  }, []);

  useEffect(() => {
    if (!externalNotification) return;
    showHandyNotification(externalNotification.message);
  }, [externalNotification, showHandyNotification]);

  const updateHasConnectedGamepad = useEffectEvent(() => {
    const gamepads = navigator.getGamepads?.();
    if (!gamepads) {
      setHasConnectedGamepad(false);
      return;
    }
    setHasConnectedGamepad(gamepads.some((gp) => gp !== null));
  });

  useEffect(() => {
    if (!controllerSupportEnabled) {
      setHasConnectedGamepad(false);
      return;
    }

    updateHasConnectedGamepad();

    window.addEventListener("gamepadconnected", updateHasConnectedGamepad);
    window.addEventListener("gamepaddisconnected", updateHasConnectedGamepad);
    const intervalId = window.setInterval(updateHasConnectedGamepad, 500);

    return () => {
      window.removeEventListener("gamepadconnected", updateHasConnectedGamepad);
      window.removeEventListener("gamepaddisconnected", updateHasConnectedGamepad);
      window.clearInterval(intervalId);
    };
  }, [controllerSupportEnabled]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNowMs(Date.now());
    }, 1000);
    return () => {
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (state.sessionPhase === "completed") {
      setCompletedElapsedSec(
        (prev) => prev ?? Math.max(0, Math.floor((Date.now() - sessionStartedAtMs) / 1000))
      );
      return;
    }
    setCompletedElapsedSec(null);
  }, [sessionStartedAtMs, state.sessionPhase]);

  useEffect(() => {
    onHighscoreChangeRef.current?.(state.highscore);
  }, [state.highscore]);

  useEffect(() => {
    if (!onStateChangeRef.current) return;
    if (state.sessionPhase !== "completed" || animPhase.kind === "idle") {
      onStateChangeRef.current(state);
    }
  }, [animPhase.kind, state]);

  useEffect(() => {
    setControllerPerkSelectionIndex(0);
  }, [state.pendingPerkSelection]);

  useEffect(() => {
    const options = state.pendingPathChoice?.options ?? [];
    if (options.length === 0) {
      setHighlightedPathEdgeId(null);
      return;
    }
    setHighlightedPathEdgeId((previous) =>
      previous && options.some((option) => option.edgeId === previous)
        ? previous
        : (options[0]?.edgeId ?? null)
    );
  }, [state.pendingPathChoice]);

  const pendingPathPreviewByEdgeId = useMemo(() => {
    const pending = state.pendingPathChoice;
    if (!pending) return {};
    return Object.fromEntries(
      pending.options.map((option) => [
        option.edgeId,
        buildPendingPathPreviewSegments(state, option.edgeId),
      ])
    ) as Record<string, PathPreviewSegment[]>;
  }, [state]);
  const [selectedInventoryItemId, setSelectedInventoryItemId] = useState<string | null>(null);
  const currentPlayer = state.players[state.currentPlayerIndex];
  const currentPlayerRef = useRef(currentPlayer);
  currentPlayerRef.current = currentPlayer;
  const currentPlayerInventory = useMemo(
    () => currentPlayer?.inventory ?? [],
    [currentPlayer?.inventory]
  );
  const currentPlayerActiveEffects = currentPlayer?.activePerkEffects ?? [];
  const previousInventoryRef = useRef<{
    playerId: string | null;
    itemIds: Set<string>;
  }>({
    playerId: currentPlayer?.id ?? null,
    itemIds: new Set(currentPlayerInventory.map((item) => item.itemId)),
  });

  useEffect(() => {
    if (currentPlayerInventory.length === 0) {
      setSelectedInventoryItemId(null);
      return;
    }
    setSelectedInventoryItemId((previous) =>
      previous && currentPlayerInventory.some((item) => item.itemId === previous)
        ? previous
        : (currentPlayerInventory[0]?.itemId ?? null)
    );
  }, [currentPlayerInventory]);

  useEffect(() => {
    const nextPlayerId = currentPlayer?.id ?? null;
    const nextItemIds = new Set(currentPlayerInventory.map((item) => item.itemId));
    const previousInventory = previousInventoryRef.current;

    if (previousInventory.playerId !== nextPlayerId) {
      previousInventoryRef.current = {
        playerId: nextPlayerId,
        itemIds: nextItemIds,
      };
      return;
    }

    const newlyAdded = currentPlayerInventory.filter(
      (item) => !previousInventory.itemIds.has(item.itemId)
    );
    if (newlyAdded.length > 0) {
      const latestItem = newlyAdded[0];
      if (latestItem) {
        showHandyNotification(
          `Received ${latestItem.kind === "antiPerk" ? "anti-perk" : "perk"}: ${latestItem.name}.`
        );
      }
    }

    previousInventoryRef.current = {
      playerId: nextPlayerId,
      itemIds: nextItemIds,
    };
  }, [currentPlayer?.id, currentPlayerInventory, showHandyNotification]);

  const canRollViaController =
    state.sessionPhase === "normal" &&
    animPhase.kind === "idle" &&
    !state.pendingPathChoice &&
    !state.pendingPerkSelection &&
    (!state.queuedRound || Boolean(state.queuedRound.skippable)) &&
    !state.activeRound;
  const canStartQueuedRoundViaController =
    animPhase.kind === "idle" &&
    Boolean(state.queuedRound) &&
    !state.pendingPerkSelection &&
    !state.activeRound;
  const canFinishRoundViaController = Boolean(state.activeRound) && animPhase.kind === "idle";
  const perkOptionCount = state.pendingPerkSelection?.options.length ?? 0;
  const shouldPrioritiseGameplayPrimaryAction =
    !showPerkInventoryMenu &&
    !showOptionsMenu &&
    !showDevPerkMenuModal &&
    !state.pendingPathChoice &&
    !state.pendingPerkSelection;
  const shouldShowControllerPrompts = controllerSupportEnabled && hasConnectedGamepad;
  shouldShowControllerPromptsRef.current = shouldShowControllerPrompts;
  const controllerPrimaryHint =
    !showPerkInventoryMenu &&
      !showOptionsMenu &&
      !showDevPerkMenuModal &&
      !state.pendingPathChoice &&
      !state.pendingPerkSelection
      ? canRollViaController
        ? "Roll Dice"
        : canStartQueuedRoundViaController
          ? state.queuedRound?.skippable
            ? "Play"
            : "Start Video"
          : canFinishRoundViaController
            ? "Finish Round"
            : null
      : null;
  const tryHandlePrimaryGameplayAction = () => {
    if (canRollViaController) {
      handleRollRef.current();
      return true;
    }
    if (canStartQueuedRoundViaController) {
      handleStartQueuedRoundRef.current();
      return true;
    }
    if (canFinishRoundViaController) {
      handleCompleteRoundRef.current();
      return true;
    }
    return false;
  };
  const tryHandlePerkSelectionControllerAction = (action: string) => {
    if (!state.pendingPerkSelection) return false;

    if (action === "LEFT") {
      setControllerPerkSelectionIndex((previous) =>
        Math.max(0, Math.min(perkOptionCount, previous - 1))
      );
      return true;
    }
    if (action === "RIGHT") {
      setControllerPerkSelectionIndex((previous) =>
        Math.max(0, Math.min(perkOptionCount, previous + 1))
      );
      return true;
    }
    if (action === "DOWN") {
      setControllerPerkSelectionIndex(perkOptionCount);
      return true;
    }
    if (action === "UP") {
      setControllerPerkSelectionIndex((previous) => (previous >= perkOptionCount ? 0 : previous));
      return true;
    }
    if (action === "ACTION_X") {
      handleSkipPerkRef.current();
      return true;
    }
    if (action === "ACTION_Y") {
      const selectedIndex = controllerPerkSelectionIndexRef.current;
      const perkId = state.pendingPerkSelection.options[selectedIndex]?.id;
      if (!perkId) return true;
      handleSelectPerkRef.current(perkId, { applyDirectly: applyPerkDirectlyRef.current });
      return true;
    }

    return false;
  };

  useControllerSurface({
    id: "game-scene",
    priority: 70,
    initialFocusId: showPerkInventoryMenu
      ? "game-inventory-close"
      : showOptionsMenu
        ? "game-options-proceed"
        : showDevPerkMenuModal
          ? "game-dev-close"
          : state.pendingPathChoice?.options[0]
            ? `game-path-${state.pendingPathChoice.options[0].edgeId}`
            : !state.activeRound && state.sessionPhase !== "completed" && handyConnected
              ? "game-handy-toggle"
              : !state.activeRound && state.sessionPhase !== "completed"
                ? "game-options-open"
                : undefined,
    onBeforeDomAction: (action) => {
      if (tryHandlePerkSelectionControllerAction(action)) {
        return true;
      }
      if (action !== "PRIMARY" || !shouldPrioritiseGameplayPrimaryAction) {
        return false;
      }
      const activeElement =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
      const focusId = activeElement?.dataset.controllerFocusId;
      if (focusId && focusId !== "game-handy-toggle" && focusId !== "game-options-open") {
        return false;
      }
      return tryHandlePrimaryGameplayAction();
    },
    onBack: () => {
      if (showDevPerkMenuModal) {
        setShowDevPerkMenuModal(false);
        return true;
      }
      if (showPerkInventoryMenu) {
        setShowPerkInventoryMenu(false);
        return true;
      }
      if (showOptionsMenu) {
        setShowOptionsMenu(false);
        return true;
      }
      if (state.sessionPhase === "completed") {
        return false;
      }
      if (state.pendingPerkSelection) {
        return true;
      }
      setShowOptionsMenu(true);
      return true;
    },
    onUnhandledAction: (action) => {
      if (tryHandlePerkSelectionControllerAction(action)) {
        return true;
      }

      if (state.pendingPathChoice) {
        const options = state.pendingPathChoice.options;
        if (action === "ACTION_X" && options[0]) {
          handleSelectPathEdgeRef.current(options[0].edgeId);
          return true;
        }
        if (action === "ACTION_Y" && options[1]) {
          handleSelectPathEdgeRef.current(options[1].edgeId);
          return true;
        }
      }

      if (!showPerkInventoryMenu && !showOptionsMenu && !showDevPerkMenuModal) {
        if (action === "ACTION_X" && !state.activeRound && state.sessionPhase !== "completed") {
          setShowPerkInventoryMenu(true);
          return true;
        }
        if (
          action === "ACTION_Y" &&
          !state.activeRound &&
          state.sessionPhase !== "completed" &&
          handyConnected
        ) {
          handleHandyManualToggle();
          return true;
        }
        if (action === "START") {
          setShowOptionsMenu(true);
          return true;
        }
      }

      if (state.activeRound?.phaseKind === "cum") {
        if (action === "ACTION_Y") {
          requestCumConfirmation();
          return true;
        }
      }

      if (action !== "PRIMARY") return false;
      return tryHandlePrimaryGameplayAction();
    },
  });

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.isContentEditable || target.tagName === "INPUT" || target.tagName === "TEXTAREA")
      )
        return;
      if (event.repeat) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "w") {
        event.preventDefault();
        handleHandyManualToggle();
        return;
      }
      if (event.code === "BracketLeft") {
        event.preventDefault();
        handleHandyOffsetAdjust(event.shiftKey ? -THEHANDY_OFFSET_FINE_STEP_MS : -THEHANDY_OFFSET_STEP_MS);
        return;
      }
      if (event.code === "BracketRight") {
        event.preventDefault();
        handleHandyOffsetAdjust(event.shiftKey ? THEHANDY_OFFSET_FINE_STEP_MS : THEHANDY_OFFSET_STEP_MS);
        return;
      }
      if (event.code === "Backslash") {
        event.preventDefault();
        handleHandyOffsetReset();
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        if (showDevPerkMenuModalRef.current) {
          setShowDevPerkMenuModal(false);
          return;
        }
        if (showPerkInventoryMenuRef.current) {
          setShowPerkInventoryMenu(false);
          return;
        }
        setShowOptionsMenu(true);
        return;
      }
      if (["1", "2", "3"].includes(event.key)) {
        const index = parseInt(event.key, 10) - 1;
        const pending = stateRef.current.pendingPerkSelection;
        if (pending && pending.options[index]) {
          event.preventDefault();
          handleSelectPerkRef.current(pending.options[index].id, {
            applyDirectly: applyPerkDirectlyRef.current,
          });
          return;
        }
      }
      const pending = stateRef.current.pendingPerkSelection;
      if (pending) {
        const optionCount = pending.options.length;
        if (event.key === "ArrowLeft") {
          event.preventDefault();
          setControllerPerkSelectionIndex((previous) => Math.max(0, Math.min(optionCount, previous - 1)));
          return;
        }
        if (event.key === "ArrowRight") {
          event.preventDefault();
          setControllerPerkSelectionIndex((previous) => Math.max(0, Math.min(optionCount, previous + 1)));
          return;
        }
        if (event.key === "ArrowDown") {
          event.preventDefault();
          setControllerPerkSelectionIndex(optionCount);
          return;
        }
        if (event.key === "ArrowUp") {
          event.preventDefault();
          setControllerPerkSelectionIndex((previous) => (previous >= optionCount ? 0 : previous));
          return;
        }
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          const selectedIndex = controllerPerkSelectionIndexRef.current;
          const perkId = pending.options[selectedIndex]?.id;
          if (!perkId) {
            handleSkipPerkRef.current();
            return;
          }
          handleSelectPerkRef.current(perkId, {
            applyDirectly: applyPerkDirectlyRef.current,
          });
          return;
        }
      }
      if (event.key.toLowerCase() !== "c") return;
      event.preventDefault();
      if (showNonCumOutcomeMenuRef.current) {
        setShowNonCumOutcomeMenu(false);
        handleSelfReportedCum();
      } else {
        requestCumConfirmation();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [
    handleHandyManualToggle,
    handleHandyOffsetAdjust,
    handleHandyOffsetReset,
    handleSelfReportedCum,
    requestCumConfirmation,
  ]);

  useEffect(() => {
    return () => {
      if (handyNotificationTimerRef.current !== null) {
        window.clearTimeout(handyNotificationTimerRef.current);
      }
    };
  }, []);

  const handledExternalAntiPerkEventRef = useRef<string | null>(null);
  useEffect(() => {
    if (!externalAntiPerkEvent) return;
    if (handledExternalAntiPerkEventRef.current === externalAntiPerkEvent.eventId) return;
    handledExternalAntiPerkEventRef.current = externalAntiPerkEvent.eventId;
    handleApplyExternalPerkRef.current({
      targetPlayerId: externalAntiPerkEvent.targetPlayerId,
      perkId: externalAntiPerkEvent.perkId,
      sourceLabel: externalAntiPerkEvent.sourcePlayerName,
    });
    onExternalAntiPerkEventHandled?.(externalAntiPerkEvent.eventId);
  }, [externalAntiPerkEvent, onExternalAntiPerkEventHandled]);

  const handledMoneyAdjustmentRef = useRef<string | null>(null);
  useEffect(() => {
    if (!externalMoneyAdjustment) return;
    if (handledMoneyAdjustmentRef.current === externalMoneyAdjustment.adjustmentId) return;
    handledMoneyAdjustmentRef.current = externalMoneyAdjustment.adjustmentId;
    handleAdjustPlayerMoneyRef.current({
      playerId: externalMoneyAdjustment.playerId,
      delta: externalMoneyAdjustment.delta,
      reason: externalMoneyAdjustment.reason,
    });
    onExternalMoneyAdjustmentHandled?.(externalMoneyAdjustment.adjustmentId);
  }, [externalMoneyAdjustment, onExternalMoneyAdjustmentHandled]);

  const handledInventoryActionRef = useRef<string | null>(null);
  useEffect(() => {
    if (!externalInventoryAction) return;
    if (handledInventoryActionRef.current === externalInventoryAction.actionId) return;
    handledInventoryActionRef.current = externalInventoryAction.actionId;

    if (externalInventoryAction.type === "applySelf") {
      handleApplyInventoryItemToSelfRef.current({
        playerId: externalInventoryAction.playerId,
        itemId: externalInventoryAction.itemId,
      });
    } else {
      handleConsumeInventoryItemRef.current({
        playerId: externalInventoryAction.playerId,
        itemId: externalInventoryAction.itemId,
        reason: externalInventoryAction.reason,
      });
    }
    onExternalInventoryActionHandled?.(externalInventoryAction.actionId);
  }, [externalInventoryAction, onExternalInventoryActionHandled]);

  const lastRecordedRoundRef = useRef<string | null>(null);
  useEffect(() => {
    const activeRound = state.activeRound;
    if (!activeRound) return;
    const key = `${activeRound.roundId}:${activeRound.nodeId}:${activeRound.poolId ?? ""}`;
    if (lastRecordedRoundRef.current === key) return;
    lastRecordedRoundRef.current = key;
    onRoundPlayedRef.current?.({
      roundId: activeRound.roundId,
      nodeId: activeRound.nodeId,
      poolId: activeRound.poolId,
    });
  }, [state.activeRound]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // ── Responsive sizing ────────────────────────────────────────────────
    // Read the *actual* container size, fallback to window
    let W = container.clientWidth || window.innerWidth;
    let H = container.clientHeight || window.innerHeight;

    const app = new Application();
    let rafId: number;
    let ro: ResizeObserver;
    let disposed = false;
    let destroyed = false;
    let initialized = false;
    const destroyApp = () => {
      if (destroyed) return;
      destroyed = true;
      if (appRef.current === app) {
        appRef.current = null;
      }
      if (!initialized) return;
      try {
        app.destroy(true, { children: true });
      } catch (error) {
        console.warn("Failed to destroy Pixi game scene", error);
      }
    };

    // Board scale: intentionally keep a minimum zoom so long campaigns don't look crowded.
    const MIN_BOARD_ZOOM = 0.68;
    const MAX_BOARD_ZOOM = 2.1;
    const ZOOM_BIAS = 1.2;
    const CAMERA_MARGIN_X = 36;
    const CAMERA_MARGIN_Y = 52;
    const boardLayout = buildTileLayout(stateRef.current.config.board);
    const rawBoardW = boardLayout.width;
    const rawBoardH = boardLayout.height;
    const availW = W - 60; // only edge padding — board uses full width
    const availH = H - 80; // leave room for roll button at bottom
    let boardScale = clampNum(
      Math.min(availW / rawBoardW, availH / rawBoardH, MAX_BOARD_ZOOM) * ZOOM_BIAS,
      MIN_BOARD_ZOOM,
      MAX_BOARD_ZOOM
    );

    (async () => {
      try {
        await app.init({
          backgroundAlpha: 0,
          antialias: true,
          width: W,
          height: H,
          resolution: Math.min(window.devicePixelRatio ?? 1, 1.5),
          autoDensity: true,
          skipExtensionImports: true,
        });

        if (disposed || !containerRef.current) {
          destroyApp();
          return;
        }
        initialized = true;
        appRef.current = app;
        app.canvas.style.display = "block";
        app.canvas.style.width = "100%";
        app.canvas.style.height = "100%";
        containerRef.current.appendChild(app.canvas);

        const stage = app.stage;

        // ── Layer stack ────────────────────────────────────────────────────────

        // 1. Background (stars + nebula)
        const bgG = new Graphics();
        bgG.interactiveChildren = false;
        stage.addChild(bgG);

        const starG = new Graphics();
        starG.interactiveChildren = false;
        stage.addChild(starG);

        // Static sparkle stripe overlay (drawn once)
        const gridG = new Graphics();
        gridG.interactiveChildren = false;
        drawGrid(gridG, W, H);
        stage.addChild(gridG);

        const tileOrigins = boardLayout.origins;
        const tileDimensionsByIndex = boardLayout.dimensions;
        const tileCentres = boardLayout.centres;
        const validatedRuntimeEdges = stateRef.current.config.runtimeGraph.edges.flatMap((edge) => {
          const fromIndex = stateRef.current.config.runtimeGraph.nodeIndexById[edge.fromNodeId];
          const toIndex = stateRef.current.config.runtimeGraph.nodeIndexById[edge.toNodeId];
          if (
            typeof fromIndex !== "number" ||
            typeof toIndex !== "number" ||
            fromIndex < 0 ||
            fromIndex >= stateRef.current.config.board.length ||
            toIndex < 0 ||
            toIndex >= stateRef.current.config.board.length
          ) {
            return [];
          }
          return [
            {
              edgeId: edge.id,
              gateCost: edge.gateCost,
              from: tileCentres[fromIndex]!,
              to: tileCentres[toIndex]!,
            },
          ];
        });

        // Board area — centred in the full viewport, scaled up
        const scaledBoardW = rawBoardW * boardScale;
        const scaledBoardH = rawBoardH * boardScale;
        // True centre: leave 30px margin on each side for the HUD floating overlay
        const boardOffsetX = (W - scaledBoardW) / 2;
        const boardOffsetY = (H - 80 - scaledBoardH) / 2 + 20;

        const boardContainer = new Container();
        boardContainer.x = boardOffsetX;
        boardContainer.y = boardOffsetY;
        boardContainer.scale.set(boardScale);
        stage.addChild(boardContainer);

        // ── Camera state (smooth follow) ────────────────────────────────
        // Camera target = screen centre minus player tile centre * scale.
        // Updated every frame with a lerp factor for cinematic smoothness.
        const initPlayerPos =
          stateRef.current.players[stateRef.current.currentPlayerIndex]?.position ?? 0;
        const initTile = tileCentre(boardLayout, initPlayerPos);
        let camX = clampBoardOffset(
          W,
          scaledBoardW,
          W / 2 - initTile.x * boardScale,
          CAMERA_MARGIN_X
        );
        let camY = clampBoardOffset(
          H,
          scaledBoardH,
          H / 2 - initTile.y * boardScale + 30,
          CAMERA_MARGIN_Y
        );
        boardContainer.x = camX;
        boardContainer.y = camY;

        // ── ResizeObserver — keep canvas size matching viewport ────────────
        ro = new ResizeObserver(() => {
          if (!containerRef.current || !appRef.current) return;
          W = containerRef.current.clientWidth || window.innerWidth;
          H = containerRef.current.clientHeight || window.innerHeight;
          appRef.current.renderer.resize(W, H);
          gridG.clear();
          drawGrid(gridG, W, H);
          const newAvailW = W - 60;
          const newAvailH = H - 80;
          boardScale = clampNum(
            Math.min(newAvailW / rawBoardW, newAvailH / rawBoardH, MAX_BOARD_ZOOM) * ZOOM_BIAS,
            MIN_BOARD_ZOOM,
            MAX_BOARD_ZOOM
          );
          boardContainer.scale.set(boardScale);
          const scaledWidth = rawBoardW * boardScale;
          const scaledHeight = rawBoardH * boardScale;
          camX = clampBoardOffset(W, scaledWidth, camX, CAMERA_MARGIN_X);
          camY = clampBoardOffset(H, scaledHeight, camY, CAMERA_MARGIN_Y);
          boardContainer.x = camX;
          boardContainer.y = camY;
        });
        ro.observe(container);

        const connG = new Graphics();
        connG.interactiveChildren = false;
        boardContainer.addChild(connG);

        const gateG = new Graphics();
        gateG.interactiveChildren = false;
        boardContainer.addChild(gateG);

        const connFxG = new Graphics();
        connFxG.interactiveChildren = false;
        boardContainer.addChild(connFxG);

        const tileG = new Graphics();
        tileG.interactiveChildren = false;
        boardContainer.addChild(tileG);

        const tileFxG = new Graphics();
        tileFxG.interactiveChildren = false;
        boardContainer.addChild(tileFxG);

        const boardSweepG = new Graphics();
        boardSweepG.interactiveChildren = false;
        boardContainer.addChild(boardSweepG);

        // Text labels for tiles
        const textContainer = new Container();
        boardContainer.addChild(textContainer);

        type LabelSet = { name: Text; kind: Text; num: Text; duration: Text; durationBg: Graphics };
        const labelMap = new Map<string, LabelSet>();
        const gateCostLabelMap = new Map<string, Text>();

        const brd = stateRef.current.config.board;
        brd.forEach((field, idx) => {
          const nameT = new Text({
            text: field.name,
            style: new TextStyle({
              fontFamily: "Inter,sans-serif",
              fontSize: 9.5,
              fill: 0xe8efff,
              fontWeight: "700",
              align: "center",
              wordWrap: true,
              wordWrapWidth: TILE_W - 24,
            }),
          });
          nameT.anchor.set(0.5, 0.5);
          nameT.interactiveChildren = false;

          const KIND_MAP: Record<string, string> = {
            start: "START",
            path: "PATH",
            event: "EVENT★",
            perk: "✦ PERK",
          };
          const kindT = new Text({
            text: KIND_MAP[field.kind] ?? field.kind,
            style: new TextStyle({
              fontFamily: "JetBrains Mono,monospace",
              fontSize: 7,
              fill: 0x8da5d5,
              fontWeight: "700",
            }),
          });
          kindT.anchor.set(0.5, 0.5);
          kindT.alpha = 0.92;
          kindT.interactiveChildren = false;

          const durationLabel = tileDurationLabelByFieldId.get(field.id) ?? "";
          const durationT = new Text({
            text: durationLabel,
            style: new TextStyle({
              fontFamily: "JetBrains Mono,monospace",
              fontSize: 8.5,
              fill: 0xf3f8ff,
              fontWeight: "700",
              letterSpacing: 0.4,
              stroke: { color: 0x041225, width: 3, join: "round" },
            }),
          });
          durationT.anchor.set(0.5, 0.5);
          durationT.alpha = durationLabel.length > 0 ? 0.98 : 0;
          durationT.visible = durationLabel.length > 0;
          durationT.interactiveChildren = false;

          const durationBg = new Graphics();
          durationBg.visible = durationLabel.length > 0;
          durationBg.interactiveChildren = false;

          const numT = new Text({
            text: `${idx + 1}`,
            style: new TextStyle({
              fontFamily: "JetBrains Mono,monospace",
              fontSize: 8,
              fill: 0xc8d5f7,
              fontWeight: "700",
            }),
          });
          numT.anchor.set(0.5, 0);
          numT.alpha = 0.84;
          numT.interactiveChildren = false;

          textContainer.addChild(nameT);
          textContainer.addChild(durationBg);
          textContainer.addChild(durationT);
          textContainer.addChild(kindT);
          textContainer.addChild(numT);
          labelMap.set(field.id, {
            name: nameT,
            kind: kindT,
            num: numT,
            duration: durationT,
            durationBg,
          });
        });

        validatedRuntimeEdges.forEach((edge) => {
          if (edge.gateCost <= 0) return;
          const costLabel = new Text({
            text: `$${edge.gateCost}`,
            style: new TextStyle({
              fontFamily: "JetBrains Mono,monospace",
              fontSize: 11,
              fill: 0xfff3cf,
              fontWeight: "800",
              letterSpacing: 0.6,
              stroke: { color: 0x130816, width: 4, join: "round" },
              dropShadow: { color: 0xff76b1, alpha: 0.36, blur: 8, distance: 0 },
            }),
          });
          costLabel.anchor.set(0.5, 0.5);
          costLabel.interactiveChildren = false;
          textContainer.addChild(costLabel);
          gateCostLabelMap.set(edge.edgeId, costLabel);
        });

        // Static board geometry and labels are drawn once.
        const drawStaticBoard = () => {
          connG.clear();
          gateG.clear();
          validatedRuntimeEdges.forEach((edge) => {
            drawNeonRoadConnector(connG, edge.from.x, edge.from.y, edge.to.x, edge.to.y, 0);
            const pair = gateCostLabelMap.get(edge.edgeId);
            if (edge.gateCost > 0) {
              const gateAnchor = drawRoadGate(
                gateG,
                edge.from.x,
                edge.from.y,
                edge.to.x,
                edge.to.y,
                0
              );
              if (pair && gateAnchor) {
                pair.x = gateAnchor.x + gateAnchor.normalX * 34;
                pair.y = gateAnchor.y + gateAnchor.normalY * 34 - 8;
                pair.visible = true;
              }
            } else if (pair) {
              pair.visible = false;
            }
          });

          tileG.clear();
          brd.forEach((f: BoardField, i: number) => {
            const { x, y } = tileOrigins[i]!;
            const { width, height } = tileDimensionsByIndex[i] ?? { width: TILE_W, height: TILE_H };
            const tileColours = resolveTileColours(f);
            drawTile(tileG, x, y, width, height, f, false, false, 0);

            const pair = labelMap.get(f.id);
            if (!pair) return;
            pair.name.style.wordWrapWidth = Math.max(40, width - 24);
            pair.name.x = x + width / 2;
            pair.name.y = y + 27;
            pair.duration.x = x + width / 2;
            pair.duration.y = y + height - 31;
            pair.kind.style.fill = tileColours.accent;
            pair.kind.x = x + width / 2;
            pair.kind.y = y + height - 17;
            pair.num.x = x + width / 2;
            pair.num.y = y + 7;

            pair.durationBg.clear();
            if (pair.duration.visible) {
              const badgeWidth = Math.max(30, Math.ceil(pair.duration.width + 16));
              const badgeHeight = 15;
              pair.durationBg.roundRect(
                pair.duration.x - badgeWidth / 2,
                pair.duration.y - badgeHeight / 2,
                badgeWidth,
                badgeHeight,
                7
              );
              pair.durationBg.fill({ color: 0x08182d, alpha: 0.9 });
              pair.durationBg.stroke({ color: 0x8ab6ff, alpha: 0.45, width: 1 });
            }
          });
        };
        drawStaticBoard();

        // Token layer
        const tokenG = new Graphics();
        tokenG.interactiveChildren = false;
        boardContainer.addChild(tokenG);

        const tokenLabelContainer = new Container();
        tokenLabelContainer.interactiveChildren = false;
        boardContainer.addChild(tokenLabelContainer);

        const tokenLabelStyle = new TextStyle({
          fontFamily: "JetBrains Mono,monospace",
          fontSize: 10,
          fill: 0xf4f8ff,
          fontWeight: "800",
          stroke: { color: 0x04050c, width: 3 },
          dropShadow: { color: 0x000000, alpha: 0.66, blur: 4, distance: 0 },
        });
        const tokenLabelByPlayerId = new Map<string, Text>();
        const MAX_PLAYER_LABEL_LENGTH = 18;
        const ensureTokenLabel = (playerId: string): Text => {
          const existing = tokenLabelByPlayerId.get(playerId);
          if (existing) return existing;
          const label = new Text({
            text: "",
            style: tokenLabelStyle,
          });
          label.anchor.set(0.5, 1);
          label.interactiveChildren = false;
          tokenLabelContainer.addChild(label);
          tokenLabelByPlayerId.set(playerId, label);
          return label;
        };

        // Hit layer
        const hitContainer = new Container();
        boardContainer.addChild(hitContainer);

        // HUD layer
        const hudG = new Graphics();
        stage.addChild(hudG);

        const hudText = new Container();
        stage.addChild(hudText);

        // Dice overlay layer
        const diceG = new Graphics();
        diceG.interactiveChildren = false;
        stage.addChild(diceG);

        // Button container (roll dice, etc.)
        const btnContainer = new Container();
        stage.addChild(btnContainer);

        // ── Hit areas for tiles ────────────────────────────────────────────────
        brd.forEach((field: BoardField, idx: number) => {
          const { x, y } = tileOrigin(boardLayout, idx);
          const { width, height } = tileDimensions(boardLayout, idx);
          const hit = new Graphics();
          hit.rect(x, y, width, height);
          hit.fill({ alpha: 0 });
          hit.interactive = true;
          hit.eventMode = "static";
          hit.on("pointerover", () => {
            const pending = stateRef.current.pendingPathChoice;
            if (!pending) return;
            const option = pending.options.find((candidate) => candidate.toNodeId === field.id);
            if (!option) return;
            setHighlightedPathEdgeId(option.edgeId);
          });
          hit.on("pointertap", () => {
            const pending = stateRef.current.pendingPathChoice;
            if (!pending) return;
            const option = pending.options.find((candidate) => candidate.toNodeId === field.id);
            if (!option) return;
            handleSelectPathEdgeRef.current(option.edgeId);
          });
          hitContainer.addChild(hit);
        });

        const bottomActionBtnY = H - 72;
        const bottomActionBtnH = 46;
        const autoRollPanelH = 52;
        const autoRollPanelGap = 28;
        const autoRollPanelY = bottomActionBtnY - autoRollPanelH - autoRollPanelGap;

        // ── Roll Dice button ───────────────────────────────────────────────────
        const rollBtn = new Graphics();
        const rollBtnX = W / 2 - 70;
        const rollBtnY = bottomActionBtnY;
        const rollBtnW = 140;
        const rollBtnH = bottomActionBtnH;

        function drawRollBtn(pressed: boolean, hovered: boolean) {
          rollBtn.clear();
          rollBtn.roundRect(rollBtnX - 4, rollBtnY - 4, rollBtnW + 8, rollBtnH + 8, 16);
          rollBtn.fill({ color: 0x8a68ff, alpha: hovered ? 0.28 : 0.16 });
          rollBtn.roundRect(rollBtnX, rollBtnY, rollBtnW, rollBtnH, 12);
          rollBtn.fill({
            color: pressed ? 0x3b2d7d : hovered ? 0x4b379a : 0x3f307f,
            alpha: 1,
          });
          rollBtn.stroke({ color: 0xb9adff, alpha: 0.9, width: 1.6 });
          rollBtn.roundRect(rollBtnX + 3, rollBtnY + 3, rollBtnW - 6, rollBtnH * 0.42, 9);
          rollBtn.fill({ color: 0xffffff, alpha: 0.08 });
        }

        drawRollBtn(false, false);
        rollBtn.interactive = true;
        rollBtn.eventMode = "static";
        rollBtn.cursor = "pointer";
        rollBtn.on("pointerover", () => drawRollBtn(false, true));
        rollBtn.on("pointerout", () => drawRollBtn(false, false));
        rollBtn.on("pointerdown", () => drawRollBtn(true, true));
        rollBtn.on("pointerup", () => {
          drawRollBtn(false, true);
          handleRollRef.current();
        });
        btnContainer.addChild(rollBtn);

        const rollBtnLabel = new Text({
          text: "ROLL DICE (SPACE)",
          style: new TextStyle({
            fontFamily: "Inter,sans-serif",
            fontSize: 11,
            fill: 0xe8e2ff,
            fontWeight: "700",
            letterSpacing: 1.1,
          }),
        });
        rollBtnLabel.anchor.set(0.5, 0.5);
        rollBtnLabel.x = rollBtnX + rollBtnW / 2;
        rollBtnLabel.y = rollBtnY + rollBtnH / 2;
        btnContainer.addChild(rollBtnLabel);

        // Finish Round button
        const finishBtn = new Graphics();
        const finishBtnX = W / 2 - 70;
        const finishBtnY = bottomActionBtnY;

        function drawFinishBtn(hovered: boolean) {
          finishBtn.clear();
          finishBtn.roundRect(finishBtnX - 3, finishBtnY - 3, 146, 52, 14);
          finishBtn.fill({ color: 0x74ffd2, alpha: hovered ? 0.24 : 0.1 });
          finishBtn.roundRect(finishBtnX, finishBtnY, 140, 46, 12);
          finishBtn.fill({ color: hovered ? 0x1f6f63 : 0x174f49, alpha: 1 });
          finishBtn.stroke({ color: 0x8cf2d8, alpha: 0.92, width: 1.6 });
          finishBtn.roundRect(finishBtnX + 3, finishBtnY + 3, 134, 18, 8);
          finishBtn.fill({ color: 0xffffff, alpha: 0.07 });
        }

        drawFinishBtn(false);
        finishBtn.interactive = true;
        finishBtn.eventMode = "static";
        finishBtn.cursor = "pointer";
        finishBtn.on("pointerover", () => drawFinishBtn(true));
        finishBtn.on("pointerout", () => drawFinishBtn(false));
        finishBtn.on("pointertap", () => handleCompleteRoundRef.current());
        btnContainer.addChild(finishBtn);

        const finishLabel = new Text({
          text: "FINISH ROUND",
          style: new TextStyle({
            fontFamily: "Inter,sans-serif",
            fontSize: 12,
            fill: 0xd9fff4,
            fontWeight: "700",
            letterSpacing: 1,
          }),
        });
        finishLabel.anchor.set(0.5, 0.5);
        finishLabel.x = finishBtnX + 70;
        finishLabel.y = finishBtnY + 23;
        btnContainer.addChild(finishLabel);

        // Start queued round button
        const startRoundBtn = new Graphics();
        const startRoundBtnX = W / 2 - 86;
        const startRoundBtnY = bottomActionBtnY;

        function drawStartRoundBtn(hovered: boolean) {
          startRoundBtn.clear();
          startRoundBtn.roundRect(startRoundBtnX - 3, startRoundBtnY - 3, 178, 52, 14);
          startRoundBtn.fill({ color: 0xff7ad8, alpha: hovered ? 0.24 : 0.1 });
          startRoundBtn.roundRect(startRoundBtnX, startRoundBtnY, 172, 46, 12);
          startRoundBtn.fill({ color: hovered ? 0x57328a : 0x42266a, alpha: 1 });
          startRoundBtn.stroke({ color: 0xf0a7ff, alpha: 0.9, width: 1.6 });
          startRoundBtn.roundRect(startRoundBtnX + 3, startRoundBtnY + 3, 166, 18, 8);
          startRoundBtn.fill({ color: 0xffffff, alpha: 0.08 });
        }

        drawStartRoundBtn(false);
        startRoundBtn.interactive = true;
        startRoundBtn.eventMode = "static";
        startRoundBtn.cursor = "pointer";
        startRoundBtn.on("pointerover", () => drawStartRoundBtn(true));
        startRoundBtn.on("pointerout", () => drawStartRoundBtn(false));
        startRoundBtn.on("pointertap", () => handleStartQueuedRoundRef.current());
        btnContainer.addChild(startRoundBtn);

        const startRoundLabel = new Text({
          text: "PLAY",
          style: new TextStyle({
            fontFamily: "Inter,sans-serif",
            fontSize: 12,
            fill: 0xf8dfff,
            fontWeight: "700",
            letterSpacing: 1.2,
          }),
        });
        startRoundLabel.anchor.set(0.5, 0.5);
        startRoundLabel.x = startRoundBtnX + 86;
        startRoundLabel.y = startRoundBtnY + 23;
        btnContainer.addChild(startRoundLabel);

        // ── HUD text objects ───────────────────────────────────────────────────
        const hudTurnLabel = new Text({
          text: "",
          style: new TextStyle({
            fontFamily: "JetBrains Mono,monospace",
            fontSize: 10,
            fill: 0xff007f,
            letterSpacing: 2,
            fontWeight: "700",
          }),
        });
        hudText.addChild(hudTurnLabel);

        const hudPhaseLabel = new Text({
          text: "",
          style: new TextStyle({
            fontFamily: "JetBrains Mono,monospace",
            fontSize: 9,
            fill: 0xdfb8ff,
            fontWeight: "800",
            letterSpacing: 1.5,
          }),
        });
        hudPhaseLabel.anchor.set(1, 0);
        hudText.addChild(hudPhaseLabel);

        const hudPlayerLabel = new Text({
          text: "",
          style: new TextStyle({
            fontFamily: "Inter,sans-serif",
            fontSize: 24,
            fill: 0xffffff,
            fontWeight: "900",
            letterSpacing: 0.5,
          }),
        });
        hudText.addChild(hudPlayerLabel);

        const hudFieldLabel = new Text({
          text: "",
          style: new TextStyle({
            fontFamily: "Inter,sans-serif",
            fontSize: 11,
            fill: 0x9068be,
            fontWeight: "600",
            wordWrap: true,
            wordWrapWidth: 240,
          }),
        });
        hudText.addChild(hudFieldLabel);

        const hudProgressLabel = new Text({
          text: "",
          style: new TextStyle({
            fontFamily: "JetBrains Mono,monospace",
            fontSize: 11,
            fill: 0x00e5ff,
            fontWeight: "800",
            letterSpacing: 1,
          }),
        });
        hudText.addChild(hudProgressLabel);

        const hudDiceLabel = new Text({
          text: "",
          style: new TextStyle({
            fontFamily: "Inter,sans-serif",
            fontSize: 32,
            fill: 0xffffff,
            fontWeight: "900",
            align: "right",
          }),
        });
        hudDiceLabel.anchor.set(1, 0);
        hudText.addChild(hudDiceLabel);

        const hudDiceMetaLabel = new Text({
          text: "",
          style: new TextStyle({
            fontFamily: "JetBrains Mono,monospace",
            fontSize: 9,
            fill: 0x8a5cb0,
            fontWeight: "700",
            align: "right",
            wordWrap: true,
            wordWrapWidth: 100,
          }),
        });
        hudDiceMetaLabel.anchor.set(1, 0);
        hudText.addChild(hudDiceMetaLabel);

        const hudMoneyLabel = new Text({
          text: "",
          style: new TextStyle({
            fontFamily: "JetBrains Mono,monospace",
            fontSize: 13,
            fill: 0xff007f,
            fontWeight: "800",
          }),
        });
        hudText.addChild(hudMoneyLabel);

        const hudScoreLabel = new Text({
          text: "",
          style: new TextStyle({
            fontFamily: "JetBrains Mono,monospace",
            fontSize: 13,
            fill: 0x00e5ff,
            fontWeight: "800",
          }),
        });
        hudText.addChild(hudScoreLabel);

        const hudHighscoreLabel = new Text({
          text: "",
          style: new TextStyle({
            fontFamily: "JetBrains Mono,monospace",
            fontSize: 9,
            fill: 0x5e3785,
            fontWeight: "800",
          }),
        });
        hudText.addChild(hudHighscoreLabel);

        const hudTimeLabel = new Text({
          text: "",
          style: new TextStyle({
            fontFamily: "JetBrains Mono,monospace",
            fontSize: 10,
            fill: 0xffa338,
            fontWeight: "800",
            align: "right",
          }),
        });
        hudTimeLabel.anchor.set(1, 0);
        hudText.addChild(hudTimeLabel);

        const hudEffectsLabel = new Text({
          text: "",
          style: new TextStyle({
            fontFamily: "JetBrains Mono,monospace",
            fontSize: 11,
            fill: 0xdfb8ff,
            fontWeight: "600",
            wordWrap: true,
            wordWrapWidth: HUD_W - 52,
            breakWords: true,
          }),
        });
        hudText.addChild(hudEffectsLabel);

        const hudProbabilityLabel = new Text({
          text: "",
          style: new TextStyle({
            fontFamily: "JetBrains Mono,monospace",
            fontSize: 10,
            fill: 0xbd8aff,
            fontWeight: "600",
            wordWrap: true,
            wordWrapWidth: HUD_W - 52,
          }),
        });
        hudText.addChild(hudProbabilityLabel);

        const autoRollLabel = new Text({
          text: "",
          style: new TextStyle({
            fontFamily: "JetBrains Mono,monospace",
            fontSize: 12,
            fill: 0xfff4c7,
            fontWeight: "700",
            letterSpacing: 1.2,
          }),
        });
        autoRollLabel.anchor.set(0.5, 0.5);
        autoRollLabel.x = W / 2;
        autoRollLabel.y = autoRollPanelY + 16;
        autoRollLabel.visible = false;
        stage.addChild(autoRollLabel);

        const antiPerkAlertG = new Graphics();
        antiPerkAlertG.interactiveChildren = false;
        stage.addChild(antiPerkAlertG);

        const antiPerkAlertLabel = new Text({
          text: "",
          style: new TextStyle({
            fontFamily: "JetBrains Mono,monospace",
            fontSize: 13,
            fill: 0xfff2f2,
            fontWeight: "800",
            letterSpacing: 1.4,
            wordWrap: true,
            breakWords: true,
            align: "center",
          }),
        });
        antiPerkAlertLabel.anchor.set(0.5, 0.5);
        antiPerkAlertLabel.visible = false;
        stage.addChild(antiPerkAlertLabel);

        const rewardFxG = new Graphics();
        rewardFxG.interactiveChildren = false;
        stage.addChild(rewardFxG);

        const rewardTitleLabel = new Text({
          text: "",
          style: new TextStyle({
            fontFamily: "JetBrains Mono,monospace",
            fontSize: 26,
            fill: 0xd9fff4,
            fontWeight: "800",
            letterSpacing: 2.4,
            dropShadow: { color: 0x85ffe2, blur: 16, distance: 0, alpha: 0.88 },
          }),
        });
        rewardTitleLabel.anchor.set(0.5, 0.5);
        rewardTitleLabel.visible = false;
        stage.addChild(rewardTitleLabel);

        const rewardMoneyLabel = new Text({
          text: "",
          style: new TextStyle({
            fontFamily: "JetBrains Mono,monospace",
            fontSize: 48,
            fill: 0x7effd4,
            fontWeight: "900",
            letterSpacing: 1.8,
            dropShadow: { color: 0x47ffd3, blur: 24, distance: 0, alpha: 0.88 },
          }),
        });
        rewardMoneyLabel.anchor.set(0.5, 0.5);
        rewardMoneyLabel.visible = false;
        stage.addChild(rewardMoneyLabel);

        const rewardScoreLabel = new Text({
          text: "",
          style: new TextStyle({
            fontFamily: "JetBrains Mono,monospace",
            fontSize: 34,
            fill: 0x8eeaff,
            fontWeight: "800",
            letterSpacing: 1.3,
            dropShadow: { color: 0x79deff, blur: 16, distance: 0, alpha: 0.78 },
          }),
        });
        rewardScoreLabel.anchor.set(0.5, 0.5);
        rewardScoreLabel.visible = false;
        stage.addChild(rewardScoreLabel);

        const rewardTotalMoneyLabel = new Text({
          text: "",
          style: new TextStyle({
            fontFamily: "JetBrains Mono,monospace",
            fontSize: 20,
            fill: 0xb9fff0,
            fontWeight: "800",
            letterSpacing: 1.1,
            dropShadow: { color: 0x4dffe1, blur: 12, distance: 0, alpha: 0.72 },
          }),
        });
        rewardTotalMoneyLabel.anchor.set(0.5, 0.5);
        rewardTotalMoneyLabel.visible = false;
        stage.addChild(rewardTotalMoneyLabel);

        const rewardTotalScoreLabel = new Text({
          text: "",
          style: new TextStyle({
            fontFamily: "JetBrains Mono,monospace",
            fontSize: 20,
            fill: 0xb8ebff,
            fontWeight: "800",
            letterSpacing: 1.1,
            dropShadow: { color: 0x60e0ff, blur: 12, distance: 0, alpha: 0.72 },
          }),
        });
        rewardTotalScoreLabel.anchor.set(0.5, 0.5);
        rewardTotalScoreLabel.visible = false;
        stage.addChild(rewardTotalScoreLabel);

        // Perk overlay header text
        const perkHeaderLabel = new Text({
          text: "✦ PICK A PERK ✦",
          style: new TextStyle({
            fontFamily: "Inter,sans-serif",
            fontSize: 18,
            fill: 0xf0b0ff,
            fontWeight: "800",
            letterSpacing: 3,
          }),
        });
        perkHeaderLabel.anchor.set(0.5, 0);
        perkHeaderLabel.x = W / 2;
        perkHeaderLabel.y = H * 0.22;
        perkHeaderLabel.visible = false;
        stage.addChild(perkHeaderLabel);

        // Perk cards (static containers, we'll update text inside)
        const MAX_PERKS = 3;
        const perkCards: Container[] = [];
        const perkCardGs: Graphics[] = [];
        const perkNameTs: Text[] = [];
        const perkDescTs: Text[] = [];
        const perkEffectTs: Text[] = [];
        const perkRarityBadgeTs: Text[] = [];
        const perkCardOptionIds: Array<string | null> = Array.from(
          { length: MAX_PERKS },
          () => null
        );

        for (let pi = 0; pi < MAX_PERKS; pi++) {
          const pc = new Container();
          pc.eventMode = "static";
          pc.hitArea = new Rectangle(0, 0, 200, 130);
          pc.cursor = "pointer";
          pc.visible = false;
          stage.addChild(pc);
          perkCards.push(pc);

          const pg = new Graphics();
          pc.addChild(pg);
          perkCardGs.push(pg);

          const pnt = new Text({
            text: "",
            style: new TextStyle({
              fontFamily: "Inter,sans-serif",
              fontSize: 13,
              fill: 0xffffff,
              fontWeight: "700",
              wordWrap: true,
              wordWrapWidth: 170,
            }),
          });
          pnt.x = 16;
          pnt.y = 16;
          pc.addChild(pnt);
          perkNameTs.push(pnt);

          const pdt = new Text({
            text: "",
            style: new TextStyle({
              fontFamily: "Inter,sans-serif",
              fontSize: 10,
              fill: 0xddddee,
              wordWrap: true,
              wordWrapWidth: 170,
            }),
          });
          pdt.x = 16;
          pdt.y = 38;
          pc.addChild(pdt);
          perkDescTs.push(pdt);

          const pet = new Text({
            text: "",
            style: new TextStyle({
              fontFamily: "JetBrains Mono,monospace",
              fontSize: 9,
              fill: 0xd0a0ff,
            }),
          });
          pet.x = 16;
          pet.y = 26; // will be placed after desc
          pc.addChild(pet);
          perkEffectTs.push(pet);

          const prt = new Text({
            text: "",
            style: new TextStyle({
              fontFamily: "JetBrains Mono,monospace",
              fontSize: 8,
              fill: 0xffffff,
              fontWeight: "800",
              letterSpacing: 1,
            }),
          });
          prt.anchor.set(0.5, 0.5);
          prt.x = 0;
          prt.y = 0;
          pc.addChild(prt);
          perkRarityBadgeTs.push(prt);

          pc.on("pointertap", () => {
            const perkId = perkCardOptionIds[pi];
            const player = currentPlayerRef.current;
            if (!perkId) return;
            if (!player) return;
            const perk = stateRef.current.pendingPerkSelection?.options.find((option) => option.id === perkId);
            if (!perk) return;
            if (player.money < perk.cost) return;
            handleSelectPerkRef.current(perkId, { applyDirectly: applyPerkDirectlyRef.current });
          });
        }

        const skipPerkBtn = new Graphics();
        skipPerkBtn.visible = false;
        skipPerkBtn.interactive = true;
        skipPerkBtn.eventMode = "static";
        skipPerkBtn.cursor = "pointer";
        skipPerkBtn.on("pointertap", () => handleSkipPerkRef.current());
        stage.addChild(skipPerkBtn);

        const skipPerkLabel = new Text({
          text: "DON'T BUY ANY PERKS",
          style: new TextStyle({
            fontFamily: "JetBrains Mono,monospace",
            fontSize: 11,
            fill: 0xffe4f1,
            fontWeight: "700",
            letterSpacing: 1.2,
          }),
        });
        skipPerkLabel.anchor.set(0.5, 0.5);
        skipPerkLabel.interactive = true;
        skipPerkLabel.eventMode = "static";
        skipPerkLabel.cursor = "pointer";
        skipPerkLabel.on("pointertap", () => handleSkipPerkRef.current());
        skipPerkLabel.visible = false;
        stage.addChild(skipPerkLabel);

        // Dice label in middle of screen during roll
        const bigDiceText = new Text({
          text: "",
          style: new TextStyle({
            fontFamily: "JetBrains Mono,monospace",
            fontSize: 72,
            fill: 0xeaf3ff,
            fontWeight: "800",
            dropShadow: { color: 0xff72ce, blur: 18, distance: 0, alpha: 0.9 },
          }),
        });
        bigDiceText.anchor.set(0.5, 0.5);
        bigDiceText.x = W / 2;
        bigDiceText.y = H / 2;
        bigDiceText.visible = false;
        stage.addChild(bigDiceText);

        // ── Star field ─────────────────────────────────────────────────────────
        const stars = generateStars(W, H, 120);
        const offsetByPlayerIdCache = new Map<string, Point>();
        const getOffsetByPlayerId = (playerId: string): Point => {
          const cached = offsetByPlayerIdCache.get(playerId);
          if (cached) return cached;
          const hash = hashString(playerId);
          const angle = (hash % 360) * (Math.PI / 180);
          const radius = 8 + (hash % 3) * 6;
          const offset = {
            x: Math.cos(angle) * radius,
            y: Math.sin(angle) * radius,
          };
          offsetByPlayerIdCache.set(playerId, offset);
          return offset;
        };
        const BG_REDRAW_INTERVAL = 1 / 24;
        const BOARD_FX_REDRAW_INTERVAL = 1 / 30;
        const HUD_REDRAW_INTERVAL = 1 / 30;
        let lastBgRedrawAt = Number.NEGATIVE_INFINITY;
        let lastBoardFxRedrawAt = Number.NEGATIVE_INFINITY;
        let lastHudRedrawAt = Number.NEGATIVE_INFINITY;
        let previousShowRoundReward = false;
        let previousCanRoll: boolean | null = null;
        let previousCanFinishRound: boolean | null = null;
        let previousCanStartQueuedRound: boolean | null = null;

        // ── Main RAF loop ──────────────────────────────────────────────────────
        let t = 0;
        let bobT = 0;
        let lastFrameTs = performance.now();
        let lastTopLog = "";
        let antiPerkAlertStart = -100;
        let antiPerkAlertText = "";
        let roundRewardStart = -100;
        let roundRewardMoney = 0;
        let roundRewardScore = 0;
        let roundRewardPrevMoney = 0;
        let roundRewardPrevScore = 0;
        let roundRewardNextMoney = 0;
        let roundRewardNextScore = 0;
        let roundRewardLastTickStep = -1;
        type RemoteMotion = {
          fromIndex: number;
          toIndex: number;
          startSec: number;
          durationSec: number;
          lastSeenSec: number;
        };
        const remoteMotionById = new Map<string, RemoteMotion>();

        const renderFrame = (now: number) => {
          if (disposed) return;
          try {
            const rawDt = Math.max(0, (now - lastFrameTs) / 1000);
            // Clamp long stalls (tab switch, debugger pause) to avoid giant simulation jumps.
            const dt = Math.min(0.1, rawDt);
            lastFrameTs = now;

            t += dt;
            bobT += dt * 2.4;

            const phase = tickAnimRef.current(dt);
            const s = stateRef.current;
            const total = s.config.board.length;
            const board = s.config.board;
            const currentPlayer = s.players[s.currentPlayerIndex];
            const currentPos = currentPlayer?.position ?? 0;
            const roundRewardElapsed = t - roundRewardStart;
            const showRoundReward =
              roundRewardElapsed >= 0 && roundRewardElapsed <= ROUND_REWARD_FX_DURATION;
            const didRoundRewardVisibilityChange = previousShowRoundReward !== showRoundReward;
            const roundRewardPulse = showRoundReward
              ? Math.sin(clampNum(roundRewardElapsed / ROUND_REWARD_FX_DURATION, 0, 1) * Math.PI)
              : 0;

            // Find the currently visible token position (may be mid-hop)
            let tokenDisplayPos: Point =
              tileCentres[currentPos] ?? tileCentre(boardLayout, currentPos);
            let tokenBob = Math.sin(bobT) * 5;
            let tokenScaleY = 1;

            if (phase.kind === "diceResultReveal") {
              const startNodeId = s.lastTraversalPathNodeIds[0];
              const startIdx = wrapIndex(
                typeof startNodeId === "string"
                  ? (s.config.runtimeGraph.nodeIndexById[startNodeId] ?? currentPos)
                  : currentPos,
                total
              );
              tokenDisplayPos = tileCentres[startIdx] ?? tileCentre(boardLayout, startIdx);
            }

            if (phase.kind === "movingToken") {
              const stepT = Math.min(1, phase.stepElapsed / STEP_DURATION);
              // Smooth X movement with cubic ease; bouncy Y for the arc
              const easedX = easeInOutCubic(stepT);
              const easedY = easeOutCubic(stepT);
              const startNodeId = s.lastTraversalPathNodeIds[0];
              const startIdx = wrapIndex(
                typeof startNodeId === "string"
                  ? (s.config.runtimeGraph.nodeIndexById[startNodeId] ?? currentPos)
                  : currentPos,
                total
              );
              const fromIdx =
                phase.stepIndex === 0 ? startIdx : (phase.path[phase.stepIndex - 1] ?? 0);
              const toIdx = wrapIndex(
                phase.path[phase.stepIndex] ?? phase.path[phase.path.length - 1] ?? currentPos,
                total
              );
              const from = tileCentres[fromIdx] ?? tileCentre(boardLayout, fromIdx);
              const to = tileCentres[toIdx] ?? tileCentre(boardLayout, toIdx);
              // Arc: sine bell curve peaks at midpoint of the hop
              const arc = Math.sin(stepT * Math.PI) * 36;

              tokenDisplayPos = {
                x: lerp(from.x, to.x, easedX),
                y: lerp(from.y, to.y, easedY) - arc,
              };
              tokenBob = 0;
              // Stretch vertically while airborne, squash on landing
              tokenScaleY = 1 + 0.35 * Math.sin(stepT * Math.PI);
            }

            if (phase.kind === "landingEffect") {
              const landT = phase.elapsed / LANDING_DURATION;
              // Decaying wobble: 4 half-oscillations that fade out
              tokenBob = Math.sin(landT * Math.PI * 4) * 10 * (1 - landT);
            }

            // ── Camera follow — lerp toward player tile (or mid-hop pos) ───
            const targetScenePos = tokenDisplayPos; // already board-local
            const scaledWidth = rawBoardW * boardScale;
            const scaledHeight = rawBoardH * boardScale;
            const targetCamX = clampBoardOffset(
              W,
              scaledWidth,
              W / 2 - targetScenePos.x * boardScale,
              CAMERA_MARGIN_X
            );
            const targetCamY = clampBoardOffset(
              H,
              scaledHeight,
              H / 2 - targetScenePos.y * boardScale + 30,
              CAMERA_MARGIN_Y
            );
            // Fast during hop, slow gentle drift otherwise
            const camLerp = phase.kind === "movingToken" ? 0.08 : 0.035;
            camX = lerp(camX, targetCamX, camLerp);
            camY = lerp(camY, targetCamY, camLerp);
            boardContainer.x = clampBoardOffset(
              W,
              scaledWidth,
              camX + Math.sin(t * 0.42) * 6,
              CAMERA_MARGIN_X
            );
            boardContainer.y = clampBoardOffset(
              H,
              scaledHeight,
              camY + Math.cos(t * 0.35) * 4,
              CAMERA_MARGIN_Y
            );
            const ambientScale = 1 + Math.sin(t * 0.55) * 0.008;
            boardContainer.scale.set(boardScale * ambientScale);
            boardContainer.rotation = Math.sin(t * 0.22) * 0.008;

            // ── BG ──────────────────────────────────────────────────────────
            const shouldRedrawBackground = t - lastBgRedrawAt >= BG_REDRAW_INTERVAL;
            if (shouldRedrawBackground) {
              lastBgRedrawAt = t;
              bgG.clear();
              drawBackground(bgG, W, H, t);

              starG.clear();
              drawStars(starG, stars, t);
            }

            // ── Dynamic tile highlights only (static board geometry is cached) ──
            const shouldRedrawBoardFx = t - lastBoardFxRedrawAt >= BOARD_FX_REDRAW_INTERVAL;
            const hopHighlight = phase.kind === "movingToken" ? phase.path[phase.stepIndex] : -1;
            if (shouldRedrawBoardFx) {
              const pendingPathChoice = s.pendingPathChoice;
              lastBoardFxRedrawAt = t;
              connFxG.clear();
              tileFxG.clear();
              boardSweepG.clear();
              drawBoardSweep(boardSweepG, rawBoardW, rawBoardH, t);
              validatedRuntimeEdges.forEach((edge, index) => {
                drawConnectorFlow(
                  connFxG,
                  edge.from.x,
                  edge.from.y,
                  edge.to.x,
                  edge.to.y,
                  t + index * 0.17,
                  index % 2 === 0 ? 0x79ddff : 0xff71ca,
                  0.9
                );
              });
              if (phase.kind !== "movingToken") {
                const activeField = board[currentPos];
                if (activeField) {
                  const { x, y } = tileOrigins[currentPos] ?? tileOrigin(boardLayout, currentPos);
                  const { width, height } = tileDimensions(boardLayout, currentPos);
                  const color = resolveTileColours(activeField).glow;
                  const pulse = 0.65 + 0.35 * Math.sin(t * 2.1);
                  drawTileHighlight(tileFxG, x, y, width, height, color, pulse);
                  drawTileBeacon(tileFxG, x + width / 2, y + height / 2, color, t, 0.75);
                }
              }
              if (pendingPathChoice) {
                const focusEdgeId =
                  highlightedPathEdgeIdRef.current ?? pendingPathChoice.options[0]?.edgeId ?? null;
                const fromIndex =
                  s.config.runtimeGraph.nodeIndexById[pendingPathChoice.fromNodeId] ?? -1;
                if (fromIndex >= 0) {
                  const { x, y } = tileOrigins[fromIndex] ?? tileOrigin(boardLayout, fromIndex);
                  const { width, height } = tileDimensions(boardLayout, fromIndex);
                  const pulse = 0.8 + 0.2 * Math.sin(t * 4.4);
                  drawTileHighlight(tileFxG, x, y, width, height, 0xffd36a, pulse);
                  drawTileBeacon(tileFxG, x + width / 2, y + height / 2, 0xffd36a, t * 1.2, 1.05);
                }

                pendingPathChoice.options.forEach((option, optionIndex) => {
                  const toIndex = s.config.runtimeGraph.nodeIndexById[option.toNodeId] ?? -1;
                  if (toIndex < 0) return;

                  const previewSegments = pendingPathPreviewByEdgeId[option.edgeId] ?? [];
                  const isFocused = option.edgeId === focusEdgeId;
                  const optionColor = isFocused
                    ? 0xffd36a
                    : optionIndex % 2 === 0
                      ? 0x7addff
                      : 0xff8ac5;
                  const optionPulse = isFocused
                    ? 0.95 + 0.05 * Math.sin(t * 6.4)
                    : 0.52 + 0.12 * Math.sin(t * 3.1 + optionIndex);

                  previewSegments.forEach((segment, previewIndex) => {
                    drawConnectorFlow(
                      connFxG,
                      segment.from.x,
                      segment.from.y,
                      segment.to.x,
                      segment.to.y,
                      t * (isFocused ? 1.5 : 1.1) + previewIndex * 0.23,
                      optionColor,
                      isFocused ? 1.6 : 0.62
                    );
                  });

                  const { x, y } = tileOrigins[toIndex] ?? tileOrigin(boardLayout, toIndex);
                  const { width, height } = tileDimensions(boardLayout, toIndex);
                  drawTileHighlight(tileFxG, x, y, width, height, optionColor, optionPulse);
                  drawTileBeacon(
                    tileFxG,
                    x + width / 2,
                    y + height / 2,
                    optionColor,
                    t * (isFocused ? 1.7 : 1.1),
                    isFocused ? 1.1 : 0.78
                  );
                });
              }
              if (hopHighlight >= 0 && hopHighlight < total) {
                const hopField = board[hopHighlight];
                if (hopField) {
                  const { x, y } =
                    tileOrigins[hopHighlight] ?? tileOrigin(boardLayout, hopHighlight);
                  const { width, height } = tileDimensions(boardLayout, hopHighlight);
                  const color = resolveTileColours(hopField).accent;
                  const pulse = 0.72 + 0.28 * Math.sin(t * 5.2);
                  drawTileHighlight(tileFxG, x, y, width, height, color, pulse);
                  drawTileBeacon(tileFxG, x + width / 2, y + height / 2, color, t * 1.4, 0.95);
                }
              }
            }

            // ── Token ─────────────────────────────────────────────────────────────
            tokenG.clear();
            if (phase.kind === "movingToken") {
              const startNodeId = s.lastTraversalPathNodeIds[0];
              const startIdx = wrapIndex(
                typeof startNodeId === "string"
                  ? (s.config.runtimeGraph.nodeIndexById[startNodeId] ?? currentPos)
                  : currentPos,
                total
              );
              const fromIdx =
                phase.stepIndex === 0 ? startIdx : (phase.path[phase.stepIndex - 1] ?? 0);
              const toIdx = wrapIndex(
                phase.path[phase.stepIndex] ?? phase.path[phase.path.length - 1] ?? currentPos,
                total
              );
              const from = tileCentres[fromIdx] ?? tileCentre(boardLayout, fromIdx);
              const to = tileCentres[toIdx] ?? tileCentre(boardLayout, toIdx);
              const stepT = Math.min(1, phase.stepElapsed / STEP_DURATION);
              const trailColor = board[toIdx] ? resolveTileColours(board[toIdx]!).accent : 0x7de0ff;
              drawTokenTrail(tokenG, from, to, trailColor, stepT);
            }
            const localTX = tokenDisplayPos.x;
            const localTY = tokenDisplayPos.y;
            const activeTokenLabelIds = new Set<string>();

            const localPlayerId = currentPlayer?.id ?? "local-player";
            const labelPlayerToken = (
              playerId: string,
              playerName: string,
              x: number,
              y: number
            ) => {
              if (!showMultiplayerPlayerNamesRef.current) return;
              const trimmedName = playerName.trim();
              if (!trimmedName) return;
              const displayName =
                trimmedName.length > MAX_PLAYER_LABEL_LENGTH
                  ? `${trimmedName.slice(0, MAX_PLAYER_LABEL_LENGTH - 1)}…`
                  : trimmedName;
              const label = ensureTokenLabel(playerId);
              label.text = displayName;
              label.x = x;
              label.y = y - 42;
              label.visible = true;
              activeTokenLabelIds.add(playerId);
            };

            drawPlayerAvatarToken(tokenG, localTX, localTY, 0, tokenBob, tokenScaleY, t);
            labelPlayerToken(
              localPlayerId,
              currentPlayer?.name ?? "Player",
              localTX,
              localTY - tokenBob
            );

            const seenRemoteIds = new Set<string>();
            for (const remote of multiplayerRemotePlayersRef.current) {
              if (remote.id === localPlayerId) continue;
              const targetIndex = wrapIndex(Math.floor(remote.position), total);
              seenRemoteIds.add(remote.id);

              const existing = remoteMotionById.get(remote.id);
              let nextMotion: RemoteMotion;
              if (!existing) {
                nextMotion = {
                  fromIndex: targetIndex,
                  toIndex: targetIndex,
                  startSec: t,
                  durationSec: 0,
                  lastSeenSec: t,
                };
              } else {
                const progress =
                  existing.durationSec > 0
                    ? clampNum((t - existing.startSec) / existing.durationSec, 0, 1)
                    : 1;
                const currentIndex = lerp(
                  existing.fromIndex,
                  existing.toIndex,
                  easeInOutCubic(progress)
                );
                if (existing.toIndex !== targetIndex) {
                  const jumpDistance = Math.abs(targetIndex - currentIndex);
                  nextMotion = {
                    fromIndex: currentIndex,
                    toIndex: targetIndex,
                    startSec: t,
                    durationSec: clampNum(0.14 + jumpDistance * 0.16, 0.2, 1.15),
                    lastSeenSec: t,
                  };
                } else {
                  nextMotion = {
                    ...existing,
                    lastSeenSec: t,
                  };
                }
              }
              remoteMotionById.set(remote.id, nextMotion);

              const motionProgress =
                nextMotion.durationSec > 0
                  ? clampNum((t - nextMotion.startSec) / nextMotion.durationSec, 0, 1)
                  : 1;
              const displayIndex = lerp(
                nextMotion.fromIndex,
                nextMotion.toIndex,
                easeInOutCubic(motionProgress)
              );
              const center = tileCentreAtProgress(boardLayout, displayIndex);
              const offset = getOffsetByPlayerId(remote.id);
              const hash = hashString(remote.id);
              const travelArc =
                nextMotion.toIndex !== nextMotion.fromIndex
                  ? Math.sin(motionProgress * Math.PI) * 10
                  : 0;
              const remoteScale =
                nextMotion.toIndex !== nextMotion.fromIndex
                  ? 1 + Math.sin(motionProgress * Math.PI) * 0.16
                  : 1;
              const remoteTokenX = center.x + offset.x;
              const remoteTokenY = center.y + offset.y;
              const remoteBob = Math.sin(t * 1.35 + hash) * 2.2 + travelArc;
              drawPlayerAvatarToken(
                tokenG,
                remoteTokenX,
                remoteTokenY,
                1 + (hash % Math.max(1, PLAYER_COLOURS.length - 1)),
                remoteBob,
                remoteScale,
                t + hash * 0.01
              );
              labelPlayerToken(remote.id, remote.name, remoteTokenX, remoteTokenY - remoteBob);
            }
            for (const [remoteId, motion] of remoteMotionById.entries()) {
              if (seenRemoteIds.has(remoteId)) continue;
              if (t - motion.lastSeenSec > 2.5) {
                remoteMotionById.delete(remoteId);
              }
            }
            if (showMultiplayerPlayerNamesRef.current) {
              for (const [playerId, label] of tokenLabelByPlayerId.entries()) {
                if (activeTokenLabelIds.has(playerId)) continue;
                label.destroy();
                tokenLabelByPlayerId.delete(playerId);
              }
            } else if (tokenLabelByPlayerId.size > 0) {
              for (const label of tokenLabelByPlayerId.values()) {
                label.destroy();
              }
              tokenLabelByPlayerId.clear();
            }

            // ── HUD — always in screen space ───────────────────────────────────────
            const shouldRedrawHud = t - lastHudRedrawAt >= HUD_REDRAW_INTERVAL;
            if (shouldRedrawHud) {
              lastHudRedrawAt = t;
              hudG.clear();
              drawHUD(hudG, s, W, roundRewardPulse);
            }

            // Reposition HUD text to right side
            const hudPanelX = W - HUD_W - HUD_MARGIN;
            const py = 12; // Base panel Y
            const headerX = hudPanelX + 16;
            const headerY = py + 16;
            const section2Y = headerY + 75;
            const statCardY = section2Y + 60;
            const effectsY = statCardY + 70;
            const probY = effectsY + 74;
            const statW = (HUD_W - 40) / 2;

            hudTurnLabel.x = headerX;
            hudTurnLabel.y = headerY;

            hudPhaseLabel.x = hudPanelX + HUD_W - 19;
            hudPhaseLabel.y = headerY + 2;

            hudPlayerLabel.x = headerX;
            hudPlayerLabel.y = headerY + 16;

            hudFieldLabel.x = headerX;
            hudFieldLabel.y = headerY + 44;

            hudProgressLabel.x = headerX;
            hudProgressLabel.y = section2Y + 8;

            hudDiceLabel.x = hudPanelX + HUD_W - 16;
            hudDiceLabel.y = section2Y - 4;

            hudDiceMetaLabel.x = hudPanelX + HUD_W - 16;
            hudDiceMetaLabel.y = section2Y + 34;

            hudScoreLabel.x = headerX + 8;
            hudScoreLabel.y = statCardY + 10;

            hudHighscoreLabel.x = headerX + 8;
            hudHighscoreLabel.y = statCardY + 26;

            hudMoneyLabel.x = headerX + statW + 16;
            hudMoneyLabel.y = statCardY + 10;

            hudTimeLabel.x = headerX + statW + 8 + statW - 8;
            hudTimeLabel.y = statCardY + 26;

            hudEffectsLabel.x = headerX + 12;
            hudEffectsLabel.y = effectsY + 8;

            hudProbabilityLabel.x = headerX + 12;
            hudProbabilityLabel.y = probY + 9;

            // Update HUD text
            setTextIfChanged(hudTurnLabel, `TURN ${s.turn.toString().padStart(2, "0")}`);
            const phaseLabelMap: Record<AnimPhase["kind"], string> = {
              idle: "STANDBY",
              rollingDice: "ROLLING",
              diceResultReveal: "RESULT",
              movingToken: "TRAVEL",
              landingEffect: "LANDING",
              roundCountdown: "COUNTDOWN",
              perkReveal: "PERK",
            };
            setTextIfChanged(hudPhaseLabel, phaseLabelMap[phase.kind]);
            setTextIfChanged(hudPlayerLabel, currentPlayer?.name ?? "Player");
            const currentField = board[currentPos];
            setTextIfChanged(
              hudFieldLabel,
              currentField ? `FIELD ${currentPos}: ${currentField.name}` : ""
            );
            const boardProgressPct = getBoardProgressRatio(s, currentPos) * 100;
            setTextIfChanged(hudProgressLabel, `BOARD PROGRESS ${boardProgressPct.toFixed(0)}%`);
            setTextIfChanged(hudDiceLabel, s.lastRoll ? `${s.lastRoll}` : "");
            setTextIfChanged(hudDiceMetaLabel, formatHudDiceMeta(currentPlayer));
            setTextIfChanged(hudScoreLabel, `SCORE ${currentPlayer?.score ?? 0}`);
            setTextIfChanged(hudMoneyLabel, `MONEY $${currentPlayer?.money ?? 0}`);
            setTextIfChanged(hudHighscoreLabel, `BEST ${s.highscore}`);
            const elapsedSec =
              completedElapsedSecRef.current ??
              Math.max(0, Math.floor((nowMsRef.current - sessionStartedAtMs) / 1000));
            setTextIfChanged(hudTimeLabel, `TIME ${formatDurationLabel(elapsedSec)}`);
            setTextIfChanged(hudEffectsLabel, formatHudActiveEffects(currentPlayer));
            setTextIfChanged(
              hudProbabilityLabel,
              `INTERMEDIARY ${(s.intermediaryProbability * 100).toFixed(0)}%\nANTI-PERK ${(s.antiPerkProbability * 100).toFixed(0)}%`
            );
            const topLog = s.log[0] ?? "";
            if (topLog !== lastTopLog) {
              lastTopLog = topLog;
              if (topLog.includes("applied anti-perk:")) {
                antiPerkAlertText = topLog.replace(/.*applied anti-perk:/, "ANTI-PERK APPLIED:");
                antiPerkAlertStart = t;
              }
              if (topLog.startsWith("Round finished.")) {
                const rewardMatch = topLog.match(/\+\$(\d+), \+(\d+) score/);
                roundRewardMoney = Number(
                  rewardMatch?.[1] ?? s.config.economy.moneyPerCompletedRound
                );
                roundRewardScore = Number(
                  rewardMatch?.[2] ?? s.config.economy.scorePerCompletedRound
                );
                roundRewardNextMoney = currentPlayer?.money ?? roundRewardMoney;
                roundRewardNextScore = currentPlayer?.score ?? roundRewardScore;
                roundRewardPrevMoney = Math.max(0, roundRewardNextMoney - roundRewardMoney);
                roundRewardPrevScore = Math.max(0, roundRewardNextScore - roundRewardScore);
                roundRewardLastTickStep = -1;
                roundRewardStart = t;
                playRoundRewardSound();
              }
            }

            // ── Buttons ───────────────────────────────────────────────────────────
            const canRoll =
              s.sessionPhase === "normal" &&
              phase.kind === "idle" &&
              !s.pendingPathChoice &&
              !s.pendingPerkSelection &&
              (!s.queuedRound || Boolean(s.queuedRound.skippable)) &&
              !s.activeRound;
            const hasRound = !!s.activeRound;
            const canStartQueuedRound =
              phase.kind === "idle" && !!s.queuedRound && !s.pendingPerkSelection && !s.activeRound;
            const controllerPrimaryTarget =
              showOptionsMenuRef.current ||
                showDevPerkMenuModalRef.current ||
                s.pendingPathChoice ||
                s.pendingPerkSelection
                ? null
                : canRoll
                  ? "roll"
                  : canStartQueuedRound
                    ? "start"
                    : hasRound && phase.kind === "idle"
                      ? "finish"
                      : null;

            const primaryActionSuffix = shouldShowControllerPromptsRef.current ? " (A)" : "";
            setTextIfChanged(
              rollBtnLabel,
              `ROLL DICE${shouldShowControllerPromptsRef.current ? " (A)" : " (SPACE)"}`
            );
            setTextIfChanged(finishLabel, `FINISH ROUND${primaryActionSuffix}`);
            setTextIfChanged(
              startRoundLabel,
              `${s.queuedRound?.skippable ? "PLAY" : "START VIDEO"}${primaryActionSuffix}`
            );

            if (previousCanRoll !== canRoll) {
              previousCanRoll = canRoll;
              rollBtn.visible = canRoll;
              rollBtnLabel.visible = canRoll;
            }
            if (canRoll) {
              drawRollBtn(false, controllerPrimaryTarget === "roll");
            }
            if (previousCanStartQueuedRound !== canStartQueuedRound) {
              previousCanStartQueuedRound = canStartQueuedRound;
              startRoundBtn.visible = canStartQueuedRound;
              startRoundLabel.visible = canStartQueuedRound;
            }
            if (canStartQueuedRound) {
              drawStartRoundBtn(controllerPrimaryTarget === "start");
            }
            const canFinishRound = hasRound && phase.kind === "idle";
            if (previousCanFinishRound !== canFinishRound) {
              previousCanFinishRound = canFinishRound;
              finishBtn.visible = canFinishRound;
              finishLabel.visible = canFinishRound;
            }
            if (canFinishRound) {
              drawFinishBtn(controllerPrimaryTarget === "finish");
            }

            // ── Dice overlay ─────────────────────────────────────────────────────
            diceG.clear();
            bigDiceText.visible = false;
            autoRollLabel.visible = false;

            if (phase.kind === "rollingDice") {
              const pct = phase.elapsed / DICE_ROLL_DURATION;
              drawDiceOverlay(diceG, W / 2, H / 2, phase.displayValue, pct, W, H);
              bigDiceText.visible = true;
              setTextIfChanged(bigDiceText, `${phase.displayValue}`);
              // Harmonic shake looks energetic without noisy jitter.
              const shake = 7 * Math.pow(1 - Math.min(1, pct), 1.7);
              bigDiceText.x = W / 2 + Math.sin(t * 44) * shake;
              bigDiceText.y = H / 2 + Math.cos(t * 37) * shake * 0.62;
              // Charge up then settle toward final value.
              const charge = Math.sin(Math.min(1, pct) * Math.PI);
              bigDiceText.scale.set(0.96 + charge * 0.22 + (1 - Math.min(1, pct)) * 0.08);
            }
            if (phase.kind === "diceResultReveal") {
              const pct = Math.min(1, phase.elapsed / DICE_RESULT_REVEAL_DURATION);
              drawDiceResultOverlay(diceG, W / 2, H / 2, phase.value, pct, W, H);
              bigDiceText.visible = true;
              setTextIfChanged(bigDiceText, `${phase.value}`);
              bigDiceText.x = W / 2;
              bigDiceText.y = H / 2;
              const entry = easeOutBack(Math.min(1, pct * 1.25));
              const pulse = Math.sin(pct * Math.PI * 5) * (1 - pct) * 0.08;
              bigDiceText.scale.set(1.12 + entry * 0.24 + pulse);
            }

            const autoRollRemaining = nextAutoRollInSecRef.current;
            if (typeof autoRollRemaining === "number" && Number.isFinite(autoRollRemaining)) {
              const pauseSecTotal = resolveEffectiveRestPauseSec(s);
              if (!Number.isFinite(pauseSecTotal)) {
                rafId = requestAnimationFrame(renderFrame);
                return;
              }
              const timeNorm = Math.max(
                0,
                Math.min(1, autoRollRemaining / Math.max(0.1, pauseSecTotal))
              );
              const pulse = 0.6 + 0.4 * Math.sin(t * 5);
              const panelW = 280;
              const panelH = autoRollPanelH;
              const panelX = W / 2 - panelW / 2;
              const panelY = autoRollPanelY;

              diceG.roundRect(panelX, panelY, panelW, panelH, 12);
              diceG.fill({ color: 0x12182b, alpha: 0.88 });
              diceG.stroke({ color: 0x7d86be, alpha: 0.55 + pulse * 0.22, width: 1.3 });

              const barX = panelX + 12;
              const barY = panelY + 32;
              const barW = panelW - 24;
              const barH = 8;
              diceG.roundRect(barX, barY, barW, barH, 4);
              diceG.fill({ color: 0x0c1120, alpha: 0.95 });
              diceG.roundRect(barX, barY, barW * timeNorm, barH, 4);
              diceG.fill({ color: 0xf168c6, alpha: 0.9 });
              diceG.roundRect(barX, barY, Math.max(0, barW * timeNorm * 0.4), barH, 4);
              diceG.fill({ color: 0xffffff, alpha: 0.28 });

              autoRollLabel.visible = true;
              autoRollLabel.x = W / 2;
              autoRollLabel.y = panelY + 16;
              setTextIfChanged(autoRollLabel, `NEXT AUTO ROLL IN ${autoRollRemaining.toFixed(1)}s`);
            }

            antiPerkAlertG.clear();
            antiPerkAlertLabel.visible = false;
            const alertElapsed = t - antiPerkAlertStart;
            const alertDuration = 3.3;
            if (
              alertElapsed >= 0 &&
              alertElapsed <= alertDuration &&
              antiPerkAlertText.length > 0
            ) {
              const progress = alertElapsed / alertDuration;
              const fadeIn = Math.min(1, progress / 0.12);
              const fadeOut = Math.min(1, (1 - progress) / 0.2);
              const alpha = Math.min(fadeIn, fadeOut);
              const pulse = 0.5 + 0.5 * Math.sin(t * 20);
              const panelW = Math.min(640, Math.max(360, W - 80));
              const panelPaddingX = 24;
              const panelPaddingY = 14;
              const panelX = W / 2 - panelW / 2;
              const panelY = 84;
              const shake = (1 - progress) * 2.8 * Math.sin(t * 45);

              antiPerkAlertLabel.scale.set(1);
              antiPerkAlertLabel.style.wordWrapWidth = panelW - panelPaddingX * 2;
              setTextIfChanged(antiPerkAlertLabel, antiPerkAlertText);
              const labelBounds = antiPerkAlertLabel.getLocalBounds();
              const panelH = Math.max(54, Math.ceil(labelBounds.height + panelPaddingY * 2));

              antiPerkAlertG.roundRect(
                panelX - 6 + shake,
                panelY - 6,
                panelW + 12,
                panelH + 12,
                16
              );
              antiPerkAlertG.fill({ color: 0xff3f57, alpha: (0.14 + pulse * 0.08) * alpha });
              antiPerkAlertG.roundRect(panelX + shake, panelY, panelW, panelH, 12);
              antiPerkAlertG.fill({ color: 0x1b050c, alpha: 0.9 * alpha });
              antiPerkAlertG.stroke({
                color: 0xff6d8e,
                alpha: (0.82 + pulse * 0.16) * alpha,
                width: 2.3,
              });

              antiPerkAlertLabel.visible = true;
              antiPerkAlertLabel.alpha = alpha;
              antiPerkAlertLabel.x = W / 2 + shake;
              antiPerkAlertLabel.y = panelY + panelH / 2;
              antiPerkAlertLabel.scale.set(1 + (1 - progress) * 0.05 + pulse * 0.02);
            }

            rewardFxG.clear();
            rewardTitleLabel.visible = false;
            rewardMoneyLabel.visible = false;
            rewardScoreLabel.visible = false;
            rewardTotalMoneyLabel.visible = false;
            rewardTotalScoreLabel.visible = false;
            if (showRoundReward) {
              const rewardProgress = clampNum(roundRewardElapsed / ROUND_REWARD_FX_DURATION, 0, 1);
              const rewardFadeIn = clampNum(rewardProgress / 0.16, 0, 1);
              const rewardFadeOut = clampNum((1 - rewardProgress) / 0.34, 0, 1);
              const rewardAlpha = Math.min(rewardFadeIn, rewardFadeOut);
              const rise = (1 - rewardProgress) * 24;
              const pop = easeOutBack(Math.min(1, rewardProgress * 1.4));
              const pulse = 0.5 + 0.5 * Math.sin(rewardProgress * Math.PI * 11);
              const countProgress = easeOutCubic(clampNum(rewardProgress / 0.74, 0, 1));
              const countingMoney = Math.round(
                lerp(roundRewardPrevMoney, roundRewardNextMoney, countProgress)
              );
              const countingScore = Math.round(
                lerp(roundRewardPrevScore, roundRewardNextScore, countProgress)
              );
              const tickStep = Math.floor(countProgress * 10);
              if (tickStep > roundRewardLastTickStep) {
                roundRewardLastTickStep = tickStep;
                if (tickStep > 0 && tickStep < 10) {
                  playRoundRewardTickSound();
                }
              }

              drawRoundRewardOverlay(rewardFxG, W, H, roundRewardElapsed);
              rewardFxG.alpha = rewardAlpha;

              rewardTitleLabel.visible = true;
              setTextIfChanged(rewardTitleLabel, "ROUND COMPLETE");
              rewardTitleLabel.alpha = rewardAlpha;
              rewardTitleLabel.x = W / 2;
              rewardTitleLabel.y = H * 0.29 - rise * 0.6;
              rewardTitleLabel.scale.set(0.9 + pop * 0.12 + pulse * 0.03);

              rewardMoneyLabel.visible = true;
              setTextIfChanged(rewardMoneyLabel, `+$${roundRewardMoney}`);
              rewardMoneyLabel.alpha = rewardAlpha;
              rewardMoneyLabel.x = W / 2;
              rewardMoneyLabel.y = H * 0.4 - rise;
              rewardMoneyLabel.scale.set(0.92 + pop * 0.2 + pulse * 0.05);

              rewardScoreLabel.visible = true;
              setTextIfChanged(rewardScoreLabel, `+${roundRewardScore} SCORE`);
              rewardScoreLabel.alpha = rewardAlpha;
              rewardScoreLabel.x = W / 2;
              rewardScoreLabel.y = H * 0.49 - rise * 0.8;
              rewardScoreLabel.scale.set(0.92 + pop * 0.16 + pulse * 0.03);

              rewardTotalMoneyLabel.visible = true;
              setTextIfChanged(rewardTotalMoneyLabel, `NEW MONEY TOTAL: $${countingMoney}`);
              rewardTotalMoneyLabel.alpha = rewardAlpha;
              rewardTotalMoneyLabel.x = W / 2;
              rewardTotalMoneyLabel.y = H * 0.58 - rise * 0.5;
              rewardTotalMoneyLabel.scale.set(0.94 + pop * 0.08);

              rewardTotalScoreLabel.visible = true;
              setTextIfChanged(rewardTotalScoreLabel, `NEW SCORE TOTAL: ${countingScore}`);
              rewardTotalScoreLabel.alpha = rewardAlpha;
              rewardTotalScoreLabel.x = W / 2;
              rewardTotalScoreLabel.y = H * 0.63 - rise * 0.4;
              rewardTotalScoreLabel.scale.set(0.94 + pop * 0.08);
            } else {
              roundRewardLastTickStep = -1;
            }
            previousShowRoundReward = showRoundReward;

            // ── Perk modal ────────────────────────────────────────────────────────
            const showPerks =
              (phase.kind === "perkReveal" || phase.kind === "idle") && !!s.pendingPerkSelection;
            perkHeaderLabel.visible = showPerks;

            const perkOptions = s.pendingPerkSelection?.options ?? [];
            const numPerks = perkOptions.length;
            const CARD_W = 200;
            const CARD_H = 130;
            const totalPerkW = numPerks * CARD_W + (numPerks - 1) * 20;
            const perkStartX = W / 2 - totalPerkW / 2;
            const perkY = H * 0.32;

            // Reveal animation: use PERK_REVEAL_DURATION constant
            let perkRevealT = 1;
            if (phase.kind === "perkReveal") {
              perkRevealT = Math.min(1, phase.elapsed / PERK_REVEAL_DURATION);
            }

            for (let pi = 0; pi < MAX_PERKS; pi++) {
              const perk = perkOptions[pi];
              const card = perkCards[pi];
              const cardG = perkCardGs[pi];
              if (!card || !cardG) continue;

              if (!perk || !showPerks) {
                card.visible = false;
                perkCardOptionIds[pi] = null;
                continue;
              }

              card.visible = true;
              perkCardOptionIds[pi] = perk.id;
              const cardX = perkStartX + pi * (CARD_W + 20);
              const slideY = lerp(-60, 0, easeOutBack(perkRevealT));
              card.x = cardX;
              card.y = perkY + slideY;
              const canAfford = (currentPlayer?.money ?? 0) >= perk.cost;
              const rarity = resolvePerkRarity(perk);
              const rarityMeta = PERK_RARITY_META[rarity];
              const isControllerSelected = controllerPerkSelectionIndexRef.current === pi;
              card.alpha = perkRevealT * (canAfford ? 1 : 0.6);
              card.cursor = canAfford ? "pointer" : "not-allowed";
              card.eventMode = canAfford ? "static" : "none";

              cardG.clear();
              cardG.roundRect(0, 0, CARD_W, CARD_H, 14);
              cardG.fill({ color: 0x0d0d2e, alpha: 0.97 });
              cardG.stroke({ color: rarityMeta.pixi.stroke, alpha: 0.86, width: 2 });

              if (isControllerSelected) {
                cardG.roundRect(-8, -8, CARD_W + 16, CARD_H + 16, 20);
                cardG.stroke({ color: 0xe5f9ff, alpha: 0.95, width: 3.2 });
              }

              // Subtle glow
              cardG.roundRect(-4, -4, CARD_W + 8, CARD_H + 8, 18);
              cardG.fill({ color: rarityMeta.pixi.glow, alpha: 0.2 });

              const nameT = perkNameTs[pi];
              const descT = perkDescTs[pi];
              const effectT = perkEffectTs[pi];
              const rarityT = perkRarityBadgeTs[pi];
              if (!nameT || !descT || !effectT || !rarityT) continue;

              nameT.text = `${getPerkIconGlyph(perk.iconKey)} ${perk.name}`;
              nameT.style.fill = rarityMeta.pixi.nameText;

              descT.y = nameT.y + nameT.height + 6;

              effectT.text = `⚡ ${describePerkEffects(perk)}`;
              effectT.y = CARD_H - 42;
              effectT.style.fill = rarityMeta.pixi.effectText;

              const directLabel =
                applyPerkDirectlyRef.current && perk.kind === "perk"
                  ? "Direct apply"
                  : "Stored in inventory";
              const costText = `💰 $${perk.cost}${canAfford ? "" : " (too expensive)"} • ${directLabel}`;
              descT.text = `${perk.description}\n${costText}`;
              descT.style.fill = canAfford ? 0xddddee : 0xffb6b6;

              rarityT.text = rarityMeta.label;
              rarityT.style.fill = rarityMeta.pixi.badgeText;
              const badgePaddingX = 7;
              const badgePaddingY = 3;
              const badgeWidth = rarityT.width + badgePaddingX * 2;
              const badgeHeight = rarityT.height + badgePaddingY * 2;
              const badgeX = CARD_W - badgeWidth - 12;
              const badgeY = 12;
              cardG.roundRect(badgeX, badgeY, badgeWidth, badgeHeight, 7);
              cardG.fill({ color: rarityMeta.pixi.badgeFill, alpha: 0.9 });
              cardG.roundRect(badgeX, badgeY, badgeWidth, badgeHeight, 7);
              cardG.stroke({ color: rarityMeta.pixi.badgeStroke, alpha: 0.8, width: 1.2 });
              rarityT.x = badgeX + badgeWidth / 2;
              rarityT.y = badgeY + badgeHeight / 2;
            }

            const skipBtnW = 280;
            const skipBtnH = 42;
            const skipBtnX = W / 2 - skipBtnW / 2;
            const skipBtnY = perkY + CARD_H + 26;
            const skipSelected = controllerPerkSelectionIndexRef.current >= numPerks;
            skipPerkBtn.clear();
            skipPerkBtn.roundRect(skipBtnX, skipBtnY, skipBtnW, skipBtnH, 12);
            skipPerkBtn.fill({ color: skipSelected ? 0x4a153f : 0x2a0d28, alpha: 0.96 });
            skipPerkBtn.stroke({
              color: skipSelected ? 0xffd8ef : 0xff8fd0,
              alpha: 0.92,
              width: skipSelected ? 2.8 : 1.8,
            });
            skipPerkBtn.hitArea = new Rectangle(skipBtnX, skipBtnY, skipBtnW, skipBtnH);
            skipPerkBtn.visible = showPerks;

            skipPerkLabel.x = W / 2;
            skipPerkLabel.y = skipBtnY + skipBtnH / 2;
            skipPerkLabel.visible = showPerks;

            // Dim background when perk modal is open
            if (showPerks) {
              hudG.clear();
              hudG.rect(0, 0, W, H);
              hudG.fill({ color: 0x000000, alpha: 0.45 });
              drawHUD(hudG, s, W, roundRewardPulse); // redraw HUD on top of dim
              lastHudRedrawAt = t;
            } else {
              skipPerkBtn.hitArea = null;
              skipPerkBtn.visible = false;
              skipPerkLabel.visible = false;
              if (didRoundRewardVisibilityChange && !shouldRedrawHud) {
                hudG.clear();
                drawHUD(hudG, s, W, roundRewardPulse);
                lastHudRedrawAt = t;
              }
            }

            rafId = requestAnimationFrame(renderFrame);
          } catch (error) {
            console.error("Pixi game scene render failed", error);
          }
        };

        rafId = requestAnimationFrame((ts) => {
          if (disposed) return;
          lastFrameTs = ts;
          renderFrame(ts);
        });
      } catch (error) {
        console.error("Pixi game scene init failed", error);
        destroyApp();
      }
    })();

    return () => {
      disposed = true;
      cancelAnimationFrame(rafId);
      ro?.disconnect();
      destroyApp();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const activePathChoiceOption =
    state.pendingPathChoice?.options.find((option) => option.edgeId === highlightedPathEdgeId) ??
    state.pendingPathChoice?.options[0] ??
    null;
  const boardAntiPerkSequence =
    !state.activeRound &&
      !state.pendingPathChoice &&
      !state.pendingPerkSelection &&
      !state.queuedRound &&
      state.sessionPhase === "normal" &&
      currentPlayer
      ? ((["milker", "jackhammer"] as const).find((id) => currentPlayer.antiPerks.includes(id)) ??
        null)
      : null;

  const idleBoardSequence =
    !state.activeRound &&
      !state.queuedRound &&
      state.sessionPhase === "normal" &&
      currentPlayer &&
      !currentPlayer.antiPerks.includes("milker") &&
      !currentPlayer.antiPerks.includes("jackhammer")
      ? currentPlayer.antiPerks.includes("no-rest")
        ? "no-rest"
        : null
      : null;
  const isRoundCountdown = animPhase.kind === "roundCountdown";
  const boardOpacity = roundPreviewState.loading
    ? 0.24
    : roundPreviewState.active
      ? 0.52
      : isRoundCountdown
        ? 0.24
        : 1;
  const boardFilter = roundPreviewState.loading
    ? "blur(5px) saturate(0.75) brightness(0.7)"
    : roundPreviewState.active
      ? "blur(2px) saturate(0.9) brightness(0.82)"
      : isRoundCountdown
        ? "blur(8px) saturate(0.68) brightness(0.48)"
        : "none";
  const boardTransform = roundPreviewState.active || isRoundCountdown ? "scale(1.015)" : "scale(1)";

  return (
    <>
      <div
        ref={containerRef}
        style={{
          width: "100vw",
          height: "100vh",
          overflow: "hidden",
          display: "block",
          position: "relative",
          zIndex: 1,
          opacity: boardOpacity,
          filter: boardFilter,
          transform: boardTransform,
          transition: "opacity 260ms ease, filter 260ms ease, transform 260ms ease",
        }}
      />
      {animPhase.kind === "roundCountdown" && (
        <RoundStartTransition
          queuedRound={state.queuedRound}
          remaining={animPhase.remaining}
          duration={animPhase.duration}
        />
      )}
      <RoundVideoOverlay
        {...buildGameplayRoundVideoOverlayProps({
          activeRound: state.activeRound,
          booruSearchPrompt: intermediaryLoadingPrompt,
          intermediaryLoadingDurationSec,
          intermediaryReturnPauseSec,
          currentPlayer,
          intermediaryProbability: state.intermediaryProbability,
          installedRounds,
          onFinishRound: handleCompleteRound,
          onRequestCum: requestCumConfirmation,
          cumRequestSignal,
          showCumRoundOutcomeMenuOnCumRequest: isLastCumRoundActive,
          onOpenOptions: () => setShowOptionsMenu(true),
          onUiVisibilityChange: onRoundOverlayUiVisibilityChange,
          onPreviewStateChange: handleRoundPreviewStateChange,
          initialShowProgressBarAlways,
          initialShowAntiPerkBeatbar,
          allowDebugRoundControls,
          lastLogMessage: state.log[0],
          boardSequence: boardAntiPerkSequence,
          idleBoardSequence,
          continuousMoaningActive: state.activeRoundAudioEffect?.kind === "continuousMoaning",
          onCompleteBoardSequence: (perkId) => {
            if (!currentPlayer) return;
            handleConsumeAntiPerkById({
              playerId: currentPlayer.id,
              perkId,
              reason: `${perkId} finished.`,
            });
          },
          roundControl: {
            pauseCharges: Math.max(0, currentPlayer?.roundControl?.pauseCharges ?? 0),
            skipCharges: Math.max(0, currentPlayer?.roundControl?.skipCharges ?? 0),
            onUsePause: () => {
              if (!currentPlayer) return;
              handleUseRoundControl({ playerId: currentPlayer.id, control: "pause" });
            },
            onUseSkip: () => {
              if (!currentPlayer) return;
              handleUseRoundControl({ playerId: currentPlayer.id, control: "skip" });
            },
          },
        })}
      />
      {handyNotification && (
        <div className="pointer-events-none fixed left-1/2 top-6 z-[142] -translate-x-1/2">
          <div className="rounded-xl border border-cyan-300/45 bg-zinc-950/92 px-4 py-2 text-sm font-semibold text-cyan-100 shadow-2xl backdrop-blur">
            {handyNotification}
          </div>
        </div>
      )}

      {!hideInventoryButton &&
        !state.activeRound &&
        !isRoundCountdown &&
        state.sessionPhase !== "completed" &&
        !state.pendingPerkSelection && (
          <InventoryDockButton
            count={currentPlayerInventory.length}
            isOpen={showPerkInventoryMenu}
            onClick={() => setShowPerkInventoryMenu(true)}
            position={boardAntiPerkSequence || idleBoardSequence ? "video-view" : "default"}
          />
        )}
      {!state.activeRound &&
        !isRoundCountdown &&
        state.sessionPhase !== "completed" &&
        !state.pendingPerkSelection && (
          <div className="pointer-events-none fixed bottom-4 right-4 z-[96] flex gap-2">
            {handyConnected && (
              <button
                type="button"
                className="pointer-events-auto flex h-12 items-center rounded-lg border border-rose-400/70 bg-rose-500/35 px-4 text-sm font-semibold text-rose-100 backdrop-blur transition-colors hover:bg-rose-500/45"
                onClick={() => {
                  handleHandyManualToggle();
                }}
                data-controller-focus-id="game-handy-toggle"
                data-controller-initial="true"
              >
                {handyManuallyStopped ? "Resume Handy" : "Force Stop Handy"}
              </button>
            )}
            <button
              type="button"
              className="pointer-events-auto flex h-12 items-center rounded-lg border border-rose-300/55 bg-rose-950/88 px-4 text-sm font-semibold text-rose-100 backdrop-blur transition-colors hover:bg-rose-900"
              onClick={() => requestCumConfirmation()}
              data-controller-focus-id="game-cum-open"
            >
              {abbreviateNsfwText("Cum (C)", sfwMode)}
            </button>
            <button
              type="button"
              className="pointer-events-auto flex h-12 items-center rounded-lg border border-indigo-300/55 bg-zinc-950/88 px-4 text-sm font-semibold text-indigo-100 backdrop-blur transition-colors hover:bg-zinc-900"
              onClick={() => setShowOptionsMenu(true)}
              data-controller-focus-id="game-options-open"
            >
              Options
            </button>
          </div>
        )}
      {state.pendingPerkSelection && onApplyPerkDirectlyChange && (
        <div
          className="pointer-events-auto fixed left-1/2 top-6 z-[95] -translate-x-1/2 rounded-xl border border-cyan-300/45 bg-zinc-950/90 px-4 py-2 text-sm text-cyan-100 backdrop-blur"
          data-controller-skip="true"
        >
          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              checked={applyPerkDirectly}
              onChange={(event) => onApplyPerkDirectlyChange(event.target.checked)}
              className="h-4 w-4 accent-cyan-300"
            />
            <span>Apply directly</span>
          </label>
        </div>
      )}
      {!hideInventoryButton && showPerkInventoryMenu && currentPlayer && (
        <div className="pointer-events-none fixed inset-0 z-[141] flex items-center justify-center bg-black/60 px-4">
          <div className="pointer-events-auto w-full max-w-5xl">
            <div className="flex items-start justify-between gap-4">
              <button
                type="button"
                className="absolute right-7 top-5 z-[1] rounded-xl border border-white/10 bg-black/35 px-3 py-2 text-sm text-zinc-100 backdrop-blur hover:border-zinc-300"
                onClick={() => setShowPerkInventoryMenu(false)}
                data-controller-focus-id="game-inventory-close"
                data-controller-initial="true"
                data-controller-back="true"
              >
                Close
              </button>
            </div>
            <PerkInventoryPanel
              title="Perk Inventory"
              subtitle="Apply stored perks to your run or clear out items you do not want to keep."
              inventory={currentPlayerInventory}
              activeEffects={currentPlayerActiveEffects}
              selectedItemId={selectedInventoryItemId}
              onSelectItem={setSelectedInventoryItemId}
              onUseSelectedItem={(item) => {
                if (item.kind !== "perk") return;
                handleApplyInventoryItemToSelfRef.current({
                  playerId: currentPlayer.id,
                  itemId: item.itemId,
                });
              }}
              onDiscardSelectedItem={(item) => {
                handleConsumeInventoryItemRef.current({
                  playerId: currentPlayer.id,
                  itemId: item.itemId,
                  reason: `Discarded item: ${item.name}.`,
                });
              }}
              useActionLabel="Apply Perk"
              useDisabled={
                !currentPlayerInventory.some(
                  (item) => item.itemId === selectedInventoryItemId && item.kind === "perk"
                )
              }
              useDisabledReason={
                currentPlayerInventory.some(
                  (item) => item.itemId === selectedInventoryItemId && item.kind === "antiPerk"
                )
                  ? "Anti-perk items cannot be applied to yourself in singleplayer."
                  : null
              }
              emptyStateLabel="No stored perks yet."
              headerBadge={`Score ${currentPlayer.score}`}
              applyDirectly={applyPerkDirectly}
              onApplyDirectlyChange={onApplyPerkDirectlyChange}
            />
          </div>
        </div>
      )}
      {state.pendingPathChoice && (
        <div className="pointer-events-none fixed inset-x-0 bottom-5 z-50 flex justify-center px-4">
          <div className="pointer-events-auto w-full max-w-5xl rounded-[30px] border border-amber-200/30 bg-[linear-gradient(135deg,rgba(10,18,31,0.88),rgba(17,27,46,0.96))] p-4 shadow-[0_30px_90px_rgba(0,0,0,0.45)] backdrop-blur-xl">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <div className="font-[family-name:var(--font-jetbrains-mono)] text-[11px] uppercase tracking-[0.22em] text-amber-200/80">
                  Split Ahead
                </div>
                <h2 className="mt-1 text-xl font-black tracking-[0.04em] text-white">
                  Choose your route
                </h2>
                <p className="mt-1 text-sm text-slate-200/85">
                  Hover, focus, or click a route to preview it on the board. You can also click the
                  glowing destination tiles.
                </p>
              </div>
              <div className="self-start rounded-full border border-amber-300/35 bg-amber-300/10 px-4 py-2 font-[family-name:var(--font-jetbrains-mono)] text-xs uppercase tracking-[0.18em] text-amber-100">
                {pathChoiceRemainingMs !== null
                  ? `Auto-pick in ${(pathChoiceRemainingMs / 1000).toFixed(1)}s`
                  : "Auto-pick pending"}
              </div>
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {state.pendingPathChoice.options.map((option, index) => {
                const isActive = option.edgeId === activePathChoiceOption?.edgeId;
                const previewLength = pendingPathPreviewByEdgeId[option.edgeId]?.length ?? 0;
                return (
                  <button
                    key={option.edgeId}
                    type="button"
                    onClick={() => handleSelectPathEdgeRef.current(option.edgeId)}
                    onMouseEnter={() => setHighlightedPathEdgeId(option.edgeId)}
                    onFocus={() => setHighlightedPathEdgeId(option.edgeId)}
                    className={`rounded-[24px] border px-4 py-4 text-left transition-all duration-150 ${isActive
                        ? "border-amber-200/70 bg-amber-300/12 text-white shadow-[0_0_0_1px_rgba(253,224,71,0.28)]"
                        : "border-slate-300/15 bg-slate-950/40 text-slate-100 hover:border-cyan-200/45 hover:bg-slate-900/70"
                      }`}
                    data-controller-focus-id={`game-path-${option.edgeId}`}
                    data-controller-initial={index === 0 ? "true" : undefined}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="font-[family-name:var(--font-jetbrains-mono)] text-[11px] uppercase tracking-[0.18em] text-cyan-100/70">
                          Route {index + 1}
                        </div>
                        <div className="mt-1 text-lg font-bold">
                          {option.label ?? option.toFieldName}
                        </div>
                      </div>
                      <div
                        className={`rounded-full px-3 py-1 text-[11px] font-bold uppercase tracking-[0.18em] ${isActive ? "bg-amber-200/20 text-amber-100" : "bg-slate-200/10 text-slate-200/80"}`}
                      >
                        {isActive ? "Previewing" : "Preview"}
                      </div>
                    </div>
                    <div className="mt-3 text-sm text-slate-200/88">
                      Destination:{" "}
                      <span className="font-semibold text-white">{option.toFieldName}</span>
                    </div>
                    <div className="mt-1 text-xs uppercase tracking-[0.14em] text-slate-300/70">
                      {option.gateCost > 0 ? `Gate cost $${option.gateCost}` : "No gate cost"}
                      {previewLength > 1 ? ` • ${previewLength} visible steps` : ""}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
      {state.pendingPathChoice && activePathChoiceOption && (
        <div className="pointer-events-none fixed left-1/2 top-5 z-[51] -translate-x-1/2 px-4">
          <div className="rounded-full border border-cyan-200/35 bg-slate-950/78 px-4 py-2 text-center shadow-xl backdrop-blur-md">
            <div className="font-[family-name:var(--font-jetbrains-mono)] text-[10px] uppercase tracking-[0.22em] text-cyan-100/70">
              Current Preview
            </div>
            <div className="mt-1 text-sm font-semibold text-white">
              {activePathChoiceOption.label ?? activePathChoiceOption.toFieldName}
              {activePathChoiceOption.gateCost > 0
                ? ` • $${activePathChoiceOption.gateCost}`
                : " • Free"}
            </div>
          </div>
        </div>
      )}
      {showNonCumOutcomeMenu && (
        <div className="pointer-events-none fixed inset-0 z-[200] flex items-center justify-center bg-black/80 px-4">
          <div className="pointer-events-auto w-full max-w-xl rounded-2xl border border-rose-300/45 bg-[linear-gradient(145deg,rgba(38,6,6,0.96),rgba(36,8,8,0.96))] p-6 text-zinc-100 shadow-[0_0_55px_rgba(248,56,56,0.25)] backdrop-blur-xl">
            <p className="font-[family-name:var(--font-jetbrains-mono)] text-[11px] uppercase tracking-[0.28em] text-rose-200/85">
              Self-Reported Finish
            </p>
            <h3 className="mt-2 text-2xl font-black tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-rose-100 via-red-100 to-orange-100">
              {abbreviateNsfwText("Did you cum?", sfwMode)}
            </h3>
            <p className="mt-2 text-sm text-zinc-200/90">
              {abbreviateNsfwText(
                "Confirm your orgasm. Because this is not a cum round, this will immediately end the round and the entire game as a loss.",
                sfwMode
              )}
            </p>
            <div className="mt-5 grid gap-2">
              <button
                type="button"
                className="rounded-lg border border-rose-300/60 bg-rose-500/20 px-4 py-3 text-left text-sm font-semibold text-rose-100 hover:bg-rose-500/35 flex items-center justify-between"
                onClick={() => {
                  setShowNonCumOutcomeMenu(false);
                  handleSelfReportedCum();
                }}
                data-controller-focus-id="non-cum-outcome-came"
                data-controller-initial="true"
              >
                <span>{abbreviateNsfwText("Confirm you came", sfwMode)}</span>
                <span className="opacity-60 text-xs">Press C</span>
              </button>
            </div>
            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <button
                type="button"
                className="rounded-lg border border-zinc-300/35 bg-zinc-500/10 px-4 py-2.5 text-sm font-semibold text-zinc-100 hover:bg-zinc-500/20"
                onClick={() => {
                  setShowNonCumOutcomeMenu(false);
                  handleCompleteRoundRef.current();
                }}
                data-controller-focus-id="non-cum-outcome-close"
              >
                Proceed
              </button>
            </div>
          </div>
        </div>
      )}
      {showOptionsMenu && (
        <div className="pointer-events-none fixed inset-0 z-[141] flex items-center justify-center bg-black/60 px-4">
          <div className="pointer-events-auto w-full max-w-sm rounded-2xl border border-indigo-300/45 bg-zinc-950/95 p-5 shadow-2xl">
            <h2 className="text-lg font-bold text-indigo-100">Options</h2>
            <p className="mt-2 text-sm text-zinc-200">The game keeps running in the background.</p>
            <div className="mt-4 space-y-2">
              <button
                type="button"
                className="w-full rounded-lg border border-zinc-500 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 hover:border-zinc-300"
                onClick={() => setShowOptionsMenu(false)}
                data-controller-focus-id="game-options-proceed"
                data-controller-initial="true"
                data-controller-back="true"
              >
                Proceed
              </button>
              <button
                type="button"
                className="w-full rounded-lg border border-cyan-400/60 bg-cyan-500/15 px-3 py-2 text-sm font-semibold text-cyan-100 hover:bg-cyan-500/25"
                onClick={() => {
                  setShowOptionsMenu(false);
                  setShowPerkInventoryMenu(true);
                }}
                data-controller-focus-id="game-options-inventory"
              >
                Perk Inventory
              </button>
              {canShowDevPerkMenu && currentPlayer && (
                <button
                  type="button"
                  className="w-full rounded-lg border border-cyan-400/60 bg-cyan-500/15 px-3 py-2 text-sm font-semibold text-cyan-100 hover:bg-cyan-500/25"
                  onClick={() => {
                    setShowOptionsMenu(false);
                    setShowDevPerkMenuModal(true);
                  }}
                  data-controller-focus-id="game-options-dev-perks"
                >
                  Dev Perks
                </button>
              )}
              {optionsActions.map((action) => (
                <button
                  key={action.id}
                  type="button"
                  disabled={action.disabled}
                  className={`w-full rounded-lg border px-3 py-2 text-sm font-semibold disabled:opacity-60 ${action.tone === "danger"
                      ? "border-rose-400/70 bg-rose-500/20 text-rose-100 hover:bg-rose-500/35"
                      : "border-amber-400/60 bg-amber-500/15 text-amber-100 hover:bg-amber-500/25"
                    }`}
                  onClick={() => {
                    setShowOptionsMenu(false);
                    action.onClick();
                  }}
                  data-controller-focus-id={`game-options-${action.id}`}
                >
                  {action.label}
                </button>
              ))}
              <button
                type="button"
                className="w-full rounded-lg border border-rose-400/70 bg-rose-500/20 px-3 py-2 text-sm font-semibold text-rose-100 hover:bg-rose-500/35"
                onClick={() => {
                  setShowOptionsMenu(false);
                  onGiveUp();
                }}
                data-controller-focus-id="game-options-give-up"
              >
                {giveUpLabel}
              </button>
            </div>
          </div>
        </div>
      )}
      {showDevPerkMenuModal && currentPlayer && (
        <div className="pointer-events-none fixed inset-0 z-[142] flex items-center justify-center bg-black/70 px-4">
          <div className="pointer-events-auto w-full max-w-5xl rounded-2xl border border-cyan-300/45 bg-zinc-950/95 p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-bold text-cyan-100">Dev Perks</h2>
                <p className="mt-2 text-sm text-zinc-200">
                  Trigger perks and anti-perks for {currentPlayer.name} in development mode.
                </p>
              </div>
              <button
                type="button"
                className="rounded-lg border border-zinc-500 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 hover:border-zinc-300"
                onClick={() => setShowDevPerkMenuModal(false)}
                data-controller-focus-id="game-dev-close"
                data-controller-initial="true"
                data-controller-back="true"
              >
                Close
              </button>
            </div>
            <div className="mt-4 grid max-h-[70vh] gap-4 overflow-y-auto lg:grid-cols-2">
              <section>
                <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-emerald-200">
                  Perks
                </h3>
                <div className="mt-3 grid gap-2">
                  {devPerkPool.map((perk) => (
                    <button
                      key={perk.id}
                      type="button"
                      className="rounded-xl border border-emerald-400/35 bg-zinc-900/80 px-4 py-3 text-left hover:border-emerald-300/70 hover:bg-zinc-900"
                      onClick={() => {
                        handleApplyExternalPerkRef.current({
                          targetPlayerId: currentPlayer.id,
                          perkId: perk.id,
                          sourceLabel: "Dev menu",
                        });
                      }}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <span className="font-semibold text-emerald-100">{perk.name}</span>
                        <span className="text-xs uppercase tracking-[0.14em] text-emerald-300">
                          {perk.rarity}
                        </span>
                      </div>
                      <p className="mt-1 text-sm text-zinc-300">{perk.description}</p>
                    </button>
                  ))}
                </div>
              </section>
              <section>
                <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-rose-200">
                  Anti-Perks
                </h3>
                <div className="mt-3 grid gap-2">
                  {devAntiPerkPool.map((perk) => (
                    <button
                      key={perk.id}
                      type="button"
                      className="rounded-xl border border-rose-400/35 bg-zinc-900/80 px-4 py-3 text-left hover:border-rose-300/70 hover:bg-zinc-900"
                      onClick={() => {
                        handleApplyExternalPerkRef.current({
                          targetPlayerId: currentPlayer.id,
                          perkId: perk.id,
                          sourceLabel: "Dev menu",
                        });
                      }}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <span className="font-semibold text-rose-100">{perk.name}</span>
                        <span className="text-xs uppercase tracking-[0.14em] text-rose-300">
                          {perk.rarity}
                        </span>
                      </div>
                      <p className="mt-1 text-sm text-zinc-300">{perk.description}</p>
                    </button>
                  ))}
                </div>
              </section>
            </div>
          </div>
        </div>
      )}
      {!state.activeRound &&
        !isRoundCountdown &&
        state.sessionPhase !== "completed" &&
        !showPerkInventoryMenu &&
        !state.pendingPerkSelection && (
          <ControllerHints
            contextId="game-board"
            enabled={controllerSupportEnabled}
            bottomClassName={handyConnected ? "bottom-40" : "bottom-28"}
            hints={[
              ...(shouldShowControllerPrompts && controllerPrimaryHint
                ? [{ label: controllerPrimaryHint, action: "PRIMARY" as const }]
                : []),
              { label: "Inventory", action: "ACTION_X" as const },
              ...(handyConnected ? [{ label: "Toggle Handy", action: "ACTION_Y" as const }] : []),
              { label: "Options", action: "START" as const },
            ]}
          />
        )}
      {state.pendingPerkSelection && (
        <ControllerHints
          contextId="perk-selection"
          enabled={controllerSupportEnabled}
          hints={[
            { label: "Skip Perk", action: "ACTION_X" as const },
            { label: "Select Perk", action: "ACTION_Y" as const },
          ]}
        />
      )}
    </>
  );
});
