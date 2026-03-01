/**
 * GameScene — Full-screen PixiJS canvas that renders the entire game.
 * Nothing is rendered in the DOM except the canvas and a thin React wrapper
 * for the perk-selection overlay (which uses HTML for accessibility/ease).
 */

import {
    Application,
    Container,
    Graphics,
    Text,
    TextStyle,
} from "pixi.js";
import { memo, useEffect, useRef, useState } from "react";
import {
    DICE_RESULT_REVEAL_DURATION,
    DICE_ROLL_DURATION,
    LANDING_DURATION,
    PERK_REVEAL_DURATION,
    ROUND_COUNTDOWN_DURATION,
    STEP_DURATION,
    type AnimPhase,
    useGameAnimation,
} from "../../game/useGameAnimation";
import type { BoardField, GameState } from "../../game/types";
import { PERK_RARITY_META, resolvePerkRarity } from "../../game/data/perkRarity";
import type { InstalledRound } from "../../services/db";
import { describePerkEffects } from "../../game/engine";
import { playRoundRewardSound, playRoundRewardTickSound } from "../../utils/audio";
import { RoundVideoOverlay } from "./RoundVideoOverlay";
import { getPerkIconGlyph } from "./PerkIcon";

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
    width: number;
    height: number;
};

function hasFiniteStyleHintXY(field: BoardField): boolean {
    const x = field.styleHint?.x;
    const y = field.styleHint?.y;
    return typeof x === "number" && Number.isFinite(x) && typeof y === "number" && Number.isFinite(y);
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
            width: TILE_W + GRAPH_PAD_X * 2,
            height: TILE_H + GRAPH_PAD_Y * 2,
        };
    }

    const fallbackOrigins = buildFallbackTileOrigins(board.length);
    const hasGraphCoords = board.some(hasFiniteStyleHintXY);
    if (hasGraphCoords) {
        const graphOrigins = board.map((field, index) => (
            hasFiniteStyleHintXY(field)
                ? {
                    x: field.styleHint!.x as number,
                    y: field.styleHint!.y as number,
                }
                : fallbackOrigins[index]!
        ));
        const xs = graphOrigins.map((point) => point.x);
        const ys = graphOrigins.map((point) => point.y);
        const minX = Math.min(...xs);
        const minY = Math.min(...ys);
        const maxX = Math.max(...xs);
        const maxY = Math.max(...ys);
        const normalizedOrigins = graphOrigins.map((point) => ({
            x: point.x - minX + GRAPH_PAD_X,
            y: point.y - minY + GRAPH_PAD_Y,
        }));
        return {
            origins: normalizedOrigins,
            width: (maxX - minX) + TILE_W + GRAPH_PAD_X * 2,
            height: (maxY - minY) + TILE_H + GRAPH_PAD_Y * 2,
        };
    }

    const origins = fallbackOrigins;
    if (ACTIVE_LAYOUT === "vertical") {
        return {
            origins,
            width: BOARD_PAD_VX * 2 + TILE_W,
            height: BOARD_PAD_H * 2 + (board.length - 1) * TILE_STEP_V + TILE_H,
        };
    }
    const rows = Math.ceil(board.length / COL_COUNT);
    return {
        origins,
        width: PAD_X_SN * 2 + (COL_COUNT - 1) * GAP_X_SN + TILE_W,
        height: PAD_Y_SN * 2 + (rows - 1) * GAP_Y_SN + TILE_H,
    };
}

function resolveEffectiveRestPauseSec(state: GameState): number {
    const currentPlayer = state.players[state.currentPlayerIndex];
    if (!currentPlayer) return 20;
    const currentField = state.config.board.find((field) => field.id === currentPlayer.currentNodeId);
    const checkpointRestMs = currentField?.kind === "safePoint" ? currentField.checkpointRestMs ?? 0 : 0;
    return Math.max(currentPlayer.stats.roundPauseMs ?? 20000, checkpointRestMs) / 1000;
}

function tileOrigin(layout: TileLayout, index: number): { x: number; y: number } {
    const total = layout.origins.length;
    if (total === 0) return { x: GRAPH_PAD_X, y: GRAPH_PAD_Y };
    return layout.origins[wrapIndex(index, total)] ?? layout.origins[0]!;
}

function tileCentre(layout: TileLayout, index: number): { x: number; y: number } {
    const { x, y } = tileOrigin(layout, index);
    return { x: x + TILE_W / 2, y: y + TILE_H / 2 };
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
    x: number, y: number,
    field: BoardField,
    isActive: boolean,
    isHighlighted: boolean,
    phase: number,
): void {
    const c = TILE_COLOURS[field.kind] ?? TILE_COLOURS.path;
    const pulse = 0.5 + 0.5 * Math.sin(phase * 2.1);
    const outerX = x + 8;
    const outerY = y + 10;
    const outerW = TILE_W - 16;
    const outerH = TILE_H - 18;
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

    const cx = x + TILE_W / 2;
    const cy = y + TILE_H / 2 + 5;
    if (field.kind === "start") {
        g.poly([cx - 7, cy - 7, cx + 8, cy, cx - 7, cy + 7]);
        g.fill({ color: 0xe9fbff, alpha: 0.95 });
    } else if (field.kind === "event") {
        g.poly([cx, cy - 9, cx + 8, cy - 1, cx + 2, cy - 1, cx + 6, cy + 8, cx - 3, cy + 2, cx + 1, cy + 2]);
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

function drawTileHighlight(g: Graphics, x: number, y: number, color: number, alpha: number): void {
    g.roundRect(x - 6, y - 6, TILE_W + 12, TILE_H + 12, 18);
    g.fill({ color, alpha: alpha * 0.18 });
    g.roundRect(x - 1, y - 1, TILE_W + 2, TILE_H + 2, 12);
    g.stroke({ color, alpha: alpha * 0.85, width: 2.2 });
}

/**
 * Futuristic road segment connecting spaces.
 */
function drawNeonRoadConnector(
    g: Graphics,
    x1: number, y1: number,
    x2: number, y2: number,
    t: number,
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

function drawPlayerAvatarToken(
    g: Graphics,
    cx: number, cy: number,
    playerIndex: number,
    bob: number,
    stretchScale: number,
    t: number,
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
        cx, centerY - crystalH * 0.58,
        cx + crystalW * 0.5, centerY - 2,
        cx, centerY + crystalH * 0.48,
        cx - crystalW * 0.5, centerY - 2,
    ]);
    g.fill({ color: blendColor(color, 0xffffff, 0.24), alpha: 0.95 });
    g.stroke({ color: 0xe6f7ff, alpha: 0.85, width: 1.5 });

    g.poly([
        cx - crystalW * 0.12, centerY - crystalH * 0.3,
        cx + crystalW * 0.28, centerY - 2,
        cx - crystalW * 0.06, centerY + crystalH * 0.28,
        cx - crystalW * 0.26, centerY - 2,
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
    accent: number,
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
    cx: number, cy: number,
    value: number,
    t: number,
    w: number, h: number,
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
    cx: number, cy: number,
    value: number,
    t: number,
    w: number, h: number,
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
        2: [[m, m], [1 - m, 1 - m]],
        3: [[m, m], [c, c], [1 - m, 1 - m]],
        4: [[m, m], [1 - m, m], [m, 1 - m], [1 - m, 1 - m]],
        5: [[m, m], [1 - m, m], [c, c], [m, 1 - m], [1 - m, 1 - m]],
        6: [[m, m], [1 - m, m], [m, c], [1 - m, c], [m, 1 - m], [1 - m, 1 - m]],
    };
    return map[Math.min(6, Math.max(1, value))] ?? map[1]!;
}

/**
 * Dark futuristic background with neon mist and soft vignette.
 */
function drawBackground(g: Graphics, w: number, h: number, t: number): void {
    const top = 0x070711;
    const mid = 0x0f0a1f;
    const bottom = 0x06060d;
    const bands = 24;
    const bandH = h / bands;
    for (let i = 0; i < bands; i++) {
        const p = i / (bands - 1);
        const col = p < 0.6
            ? blendColor(top, mid, p / 0.6)
            : blendColor(mid, bottom, (p - 0.6) / 0.4);
        g.rect(0, i * bandH, w, bandH + 1);
        g.fill({ color: col, alpha: 1 });
    }

    const fogBlobs: [number, number, number, number, number, number][] = [
        [0.16, 0.23, 320, 0xff56ba, 0.18, 0.21],
        [0.71, 0.17, 290, 0x64d8ff, 0.17, 0.18],
        [0.44, 0.76, 420, 0x8f66ff, 0.15, 0.24],
        [0.86, 0.66, 260, 0xff4f82, 0.14, 0.27],
    ];
    fogBlobs.forEach(([xf, yf, r, col, alpha, speed], idx) => {
        const driftX = Math.sin(t * speed + idx * 1.3) * 40;
        const driftY = Math.cos(t * speed * 0.8 + idx) * 26;
        g.circle(w * xf + driftX, h * yf + driftY, r);
        g.fill({ color: col, alpha: alpha + 0.05 * Math.sin(t * 0.4 + idx) });
    });

    g.rect(0, 0, w, h);
    g.fill({ color: 0x000000, alpha: 0.16 });
}

/**
 * Perspective grid lines for subtle depth.
 */
function drawGrid(g: Graphics, w: number, h: number): void {
    const horizonY = h * 0.24;
    const baseY = h + 10;
    const centerX = w * 0.5;
    for (let i = -8; i <= 8; i++) {
        const x = centerX + i * 120;
        g.moveTo(centerX, horizonY);
        g.lineTo(x, baseY);
        g.stroke({ color: 0x6d6ab8, alpha: 0.08, width: 1 });
    }
    for (let y = 0; y < 9; y++) {
        const p = y / 8;
        const yy = horizonY + Math.pow(p, 1.8) * (h - horizonY);
        g.moveTo(0, yy);
        g.lineTo(w, yy);
        g.stroke({ color: 0x7f86ff, alpha: 0.05 + p * 0.07, width: 1 });
    }
}

function drawStars(
    g: Graphics,
    stars: { x: number; y: number; r: number; twinkle: number }[],
    t: number,
): void {
    stars.forEach((s, idx) => {
        const alpha = 0.16 + 0.5 * Math.abs(Math.sin(t * s.twinkle));
        const col = idx % 2 === 0 ? 0x8fc3ff : 0xff86d6;
        g.circle(s.x, s.y, s.r);
        g.fill({ color: col, alpha });
    });
}

const HUD_W = 348;
const HUD_H = 322;
const HUD_MARGIN = 16;
const HUD_TEXT_X_PAD = 24;
const ROUND_REWARD_FX_DURATION = 2.25;

function drawHUD(
    hudG: Graphics,
    state: GameState,
    w: number,
    rewardPulse = 0,
): void {
    const player = state.players[state.currentPlayerIndex];
    const pulse = 0.5 + 0.5 * Math.sin(performance.now() * 0.003);

    const px = w - HUD_W - HUD_MARGIN;
    const py = 12;
    const score = player?.score ?? 0;
    const money = player?.money ?? 0;
    const boardProgress =
        (player?.position ?? 0) / Math.max(1, state.config.singlePlayer.totalIndices);
    const highscore = Math.max(1, state.highscore, score);
    const scoreRatio = Math.max(0, Math.min(1, score / highscore));
    const moneyCap = Math.max(1, state.config.economy.startingMoney * 2);
    const moneyRatio = Math.max(0, Math.min(1, money / moneyCap));
    const intermediaryRatio = Math.max(0, Math.min(1, state.intermediaryProbability));
    const antiRatio = Math.max(0, Math.min(1, state.antiPerkProbability));

    const outerX = px - 8;
    const outerY = py - 8;
    hudG.roundRect(outerX, outerY, HUD_W + 16, HUD_H + 16, 30);
    hudG.fill({ color: 0x71c6ff, alpha: 0.06 + pulse * 0.03 });

    hudG.roundRect(px, py, HUD_W, HUD_H, 24);
    hudG.fill({ color: 0x050c1b, alpha: 0.95 });
    hudG.stroke({ color: 0x3e5d8f, alpha: 0.9, width: 1.8 });

    hudG.roundRect(px + 2, py + 2, HUD_W - 4, HUD_H - 4, 22);
    hudG.stroke({ color: 0x6f8fcb, alpha: 0.28, width: 1 });

    const headerX = px + 12;
    const headerY = py + 12;
    const headerW = HUD_W - 24;
    const headerH = 64;
    hudG.roundRect(headerX, headerY, headerW, headerH, 14);
    hudG.fill({ color: 0x0b1427, alpha: 0.94 });
    hudG.stroke({ color: 0x4665a1, alpha: 0.62, width: 1 });

    const progressCardX = px + 12;
    const progressCardY = py + 86;
    const progressCardW = 202;
    const progressCardH = 78;
    hudG.roundRect(progressCardX, progressCardY, progressCardW, progressCardH, 12);
    hudG.fill({ color: 0x0a1326, alpha: 0.94 });
    hudG.stroke({ color: 0x4463a2, alpha: 0.56, width: 1 });

    const diceCardX = px + 224;
    const diceCardY = py + 86;
    const diceCardW = 112;
    const diceCardH = 78;
    hudG.roundRect(diceCardX, diceCardY, diceCardW, diceCardH, 12);
    hudG.fill({ color: 0x091224, alpha: 0.95 });
    hudG.stroke({ color: 0x4f6cb0, alpha: 0.58, width: 1 });
    hudG.roundRect(diceCardX + 9, diceCardY + 10, diceCardW - 18, diceCardH - 20, 10);
    hudG.stroke({ color: 0x8eb4ff, alpha: 0.42 + pulse * 0.14, width: 1.2 });

    const statCardY = py + 172;
    const statCardW = 154;
    const scoreCardX = px + 12;
    const moneyCardX = px + 182;
    if (rewardPulse > 0) {
        hudG.roundRect(scoreCardX - 6, statCardY - 6, statCardW + 12, 74, 14);
        hudG.fill({ color: 0x77dcff, alpha: 0.12 + rewardPulse * 0.22 });
        hudG.roundRect(moneyCardX - 6, statCardY - 6, statCardW + 12, 74, 14);
        hudG.fill({ color: 0x79ffd0, alpha: 0.12 + rewardPulse * 0.24 });
    }
    hudG.roundRect(scoreCardX, statCardY, statCardW, 62, 12);
    hudG.fill({ color: 0x0a1325, alpha: 0.94 });
    hudG.stroke({ color: 0x3d5d9f, alpha: 0.56, width: 1 });
    hudG.roundRect(moneyCardX, statCardY, statCardW, 62, 12);
    hudG.fill({ color: 0x08172a, alpha: 0.94 });
    hudG.stroke({ color: 0x238e97, alpha: 0.62, width: 1 });

    const probCardX = px + 12;
    const probCardY = py + 242;
    const probCardW = HUD_W - 24;
    const probCardH = 56;
    hudG.roundRect(probCardX, probCardY, probCardW, probCardH, 12);
    hudG.fill({ color: 0x081225, alpha: 0.94 });
    hudG.stroke({ color: 0x3d5f99, alpha: 0.52, width: 1 });

    hudG.roundRect(px + HUD_W - 114, py + 22, 90, 20, 8);
    hudG.fill({ color: 0x101a31, alpha: 0.95 });
    hudG.stroke({ color: 0x5a76b6, alpha: 0.58, width: 1 });

    const progressBarX = progressCardX + 14;
    const progressBarY = progressCardY + 52;
    const progressBarW = progressCardW - 28;
    hudG.roundRect(progressBarX, progressBarY, progressBarW, 8, 4);
    hudG.fill({ color: 0x071629, alpha: 1 });
    hudG.roundRect(progressBarX, progressBarY, progressBarW * boardProgress, 8, 4);
    hudG.fill({ color: 0x75cfff, alpha: 0.95 });

    const scoreBarX = scoreCardX + 12;
    const scoreBarY = statCardY + 42;
    const statBarW = statCardW - 24;
    hudG.roundRect(scoreBarX, scoreBarY, statBarW, 7, 4);
    hudG.fill({ color: 0x0b213e, alpha: 1 });
    hudG.roundRect(scoreBarX, scoreBarY, statBarW * scoreRatio, 7, 4);
    hudG.fill({ color: 0x67d7ff, alpha: 0.95 });

    const moneyBarX = moneyCardX + 12;
    const moneyBarY = statCardY + 42;
    hudG.roundRect(moneyBarX, moneyBarY, statBarW, 7, 4);
    hudG.fill({ color: 0x06322b, alpha: 1 });
    hudG.roundRect(moneyBarX, moneyBarY, statBarW * moneyRatio, 7, 4);
    hudG.fill({ color: 0x6ff3d2, alpha: 0.96 });

    const probBarX = probCardX + 14;
    const probBarW = probCardW - 28;
    hudG.roundRect(probBarX, probCardY + 24, probBarW, 7, 4);
    hudG.fill({ color: 0x11182d, alpha: 1 });
    hudG.roundRect(probBarX, probCardY + 24, probBarW * intermediaryRatio, 7, 4);
    hudG.fill({ color: 0xd15be9, alpha: 0.96 });

    hudG.roundRect(probBarX, probCardY + 40, probBarW, 7, 4);
    hudG.fill({ color: 0x11182d, alpha: 1 });
    hudG.roundRect(probBarX, probCardY + 40, probBarW * antiRatio, 7, 4);
    hudG.fill({ color: 0xf06399, alpha: 0.96 });
}

function drawRoundRewardOverlay(
    g: Graphics,
    w: number,
    h: number,
    elapsed: number,
): void {
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

// ─── Props ────────────────────────────────────────────────────────────────────

interface GameSceneProps {
    initialState: GameState;
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
    intermediaryLoadingPrompt: string;
    intermediaryLoadingDurationSec: number;
    intermediaryReturnPauseSec: number;
}

// ─── Component ────────────────────────────────────────────────────────────────

export const GameScene = memo(function GameScene({
    initialState,
    installedRounds,
    onGiveUp,
    giveUpLabel = "Give Up",
    optionsActions = [],
    allowDebugRoundControls = false,
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
    applyPerkDirectly = true,
    onApplyPerkDirectlyChange,
    onRoundOverlayUiVisibilityChange,
    intermediaryLoadingPrompt,
    intermediaryLoadingDurationSec,
    intermediaryReturnPauseSec,
    showMultiplayerPlayerNames = false,
}: GameSceneProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const appRef = useRef<Application | null>(null);

    const {
        state,
        animPhase,
        nextAutoRollInSec,
        pathChoiceRemainingMs,
        handleRoll,
        handleStartQueuedRound,
        handleCompleteRound,
        handleReportCum,
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
    const handleReportCumRef = useRef(handleReportCum);
    handleReportCumRef.current = handleReportCum;
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
    const [showCumConfirm, setShowCumConfirm] = useState(false);
    const [showOptionsMenu, setShowOptionsMenu] = useState(false);

    const isLastCumRoundActive =
        state.sessionPhase === "cum" &&
        state.activeRound?.phaseKind === "cum" &&
        state.nextCumRoundIndex >= state.config.singlePlayer.cumRoundIds.length;

    const requestCumConfirmation = () => {
        if (stateRef.current.sessionPhase === "completed") return;
        setShowCumConfirm(true);
    };

    useEffect(() => {
        onHighscoreChange?.(state.highscore);
    }, [onHighscoreChange, state.highscore]);

    useEffect(() => {
        if (!onStateChange) return;
        if (state.sessionPhase !== "completed" || animPhase.kind === "idle") {
            onStateChange(state);
        }
    }, [animPhase.kind, onStateChange, state]);

    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            const target = event.target as HTMLElement | null;
            if (target && (target.isContentEditable || target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
            if (event.repeat) return;
            if (event.key === "Escape") {
                event.preventDefault();
                setShowOptionsMenu(true);
                return;
            }
            if (event.code === "Space" || event.key === " " || event.key === "Spacebar") {
                event.preventDefault();
                handleRollRef.current();
                return;
            }
            if (event.key.toLowerCase() !== "c") return;
            event.preventDefault();
            requestCumConfirmation();
        };

        window.addEventListener("keydown", onKeyDown);
        return () => {
            window.removeEventListener("keydown", onKeyDown);
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
        onRoundPlayed?.({
            roundId: activeRound.roundId,
            nodeId: activeRound.nodeId,
            poolId: activeRound.poolId,
        });
    }, [onRoundPlayed, state.activeRound]);

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

        // Board scale: intentionally keep a minimum zoom so long campaigns don't look crowded.
        const MIN_BOARD_ZOOM = 0.68;
        const MAX_BOARD_ZOOM = 2.1;
        const ZOOM_BIAS = 1.2;
        const boardLayout = buildTileLayout(stateRef.current.config.board);
        const rawBoardW = boardLayout.width;
        const rawBoardH = boardLayout.height;
        const availW = W - 60;  // only edge padding — board uses full width
        const availH = H - 80;  // leave room for roll button at bottom
        let boardScale = clampNum(Math.min(availW / rawBoardW, availH / rawBoardH, MAX_BOARD_ZOOM) * ZOOM_BIAS, MIN_BOARD_ZOOM, MAX_BOARD_ZOOM);

        (async () => {
            await app.init({
                backgroundAlpha: 0,
                antialias: true,
                width: W,
                height: H,
                resolution: Math.min(window.devicePixelRatio ?? 1, 1.5),
                autoDensity: true,
            });

            if (disposed || !containerRef.current) { app.destroy(true); return; }
            appRef.current = app;
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
            const initPlayerPos = stateRef.current.players[stateRef.current.currentPlayerIndex]?.position ?? 0;
            const initTile = tileCentre(boardLayout, initPlayerPos);
            let camX = W / 2 - initTile.x * boardScale;
            let camY = H / 2 - initTile.y * boardScale;
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
                    MAX_BOARD_ZOOM,
                );
                boardContainer.scale.set(boardScale);
                boardContainer.x = (W - rawBoardW * boardScale) / 2;
                boardContainer.y = (H - 80 - rawBoardH * boardScale) / 2 + 20;
            });
            ro.observe(container);

            const connG = new Graphics();
            connG.interactiveChildren = false;
            boardContainer.addChild(connG);

            const tileG = new Graphics();
            tileG.interactiveChildren = false;
            boardContainer.addChild(tileG);

            const tileFxG = new Graphics();
            tileFxG.interactiveChildren = false;
            boardContainer.addChild(tileFxG);

            // Text labels for tiles
            const textContainer = new Container();
            boardContainer.addChild(textContainer);

            type LabelSet = { name: Text; kind: Text; num: Text };
            const labelMap = new Map<string, LabelSet>();

            const brd = stateRef.current.config.board;
            const runtimeGraph = stateRef.current.config.runtimeGraph;
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

                const KIND_MAP: Record<string, string> = { start: "START", path: "PATH", event: "EVENT★", perk: "✦ PERK" };
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
                textContainer.addChild(kindT);
                textContainer.addChild(numT);
                labelMap.set(field.id, { name: nameT, kind: kindT, num: numT });
            });

            // Static board geometry and labels are drawn once.
            const drawStaticBoard = () => {
                connG.clear();
                runtimeGraph.edges.forEach((edge) => {
                    const fromIndex = runtimeGraph.nodeIndexById[edge.fromNodeId];
                    const toIndex = runtimeGraph.nodeIndexById[edge.toNodeId];
                    if (
                        typeof fromIndex !== "number"
                        || typeof toIndex !== "number"
                        || fromIndex < 0
                        || fromIndex >= brd.length
                        || toIndex < 0
                        || toIndex >= brd.length
                    ) {
                        return;
                    }
                    const from = tileCentre(boardLayout, fromIndex);
                    const to = tileCentre(boardLayout, toIndex);
                    drawNeonRoadConnector(connG, from.x, from.y, to.x, to.y, 0);
                });

                tileG.clear();
                brd.forEach((f: BoardField, i: number) => {
                    const { x, y } = tileOrigin(boardLayout, i);
                    drawTile(tileG, x, y, f, false, false, 0);

                    const pair = labelMap.get(f.id);
                    if (!pair) return;
                    pair.name.x = x + TILE_W / 2;
                    pair.name.y = y + TILE_H / 2 - 8;
                    pair.kind.x = x + TILE_W / 2;
                    pair.kind.y = y + TILE_H - 21;
                    pair.num.x = x + TILE_W / 2;
                    pair.num.y = y + 7;
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
            brd.forEach((_f: BoardField, idx: number) => {
                const { x, y } = tileOrigin(boardLayout, idx);
                const hit = new Graphics();
                hit.rect(x, y, TILE_W, TILE_H);
                hit.fill({ alpha: 0 });
                hit.interactive = true;
                hit.eventMode = "static";
                hitContainer.addChild(hit);
            });

            // ── Roll Dice button ───────────────────────────────────────────────────
            const rollBtn = new Graphics();
            const rollBtnX = W / 2 - 70;
            const rollBtnY = H - 72;
            const rollBtnW = 140;
            const rollBtnH = 46;

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
            rollBtn.on("pointerup", () => { drawRollBtn(false, true); handleRollRef.current(); });
            btnContainer.addChild(rollBtn);

            const rollBtnLabel = new Text({
                text: "ROLL DICE",
                style: new TextStyle({ fontFamily: "Inter,sans-serif", fontSize: 12, fill: 0xe8e2ff, fontWeight: "700", letterSpacing: 1.2 }),
            });
            rollBtnLabel.anchor.set(0.5, 0.5);
            rollBtnLabel.x = rollBtnX + rollBtnW / 2;
            rollBtnLabel.y = rollBtnY + rollBtnH / 2;
            btnContainer.addChild(rollBtnLabel);

            // Finish Round button
            const finishBtn = new Graphics();
            const finishBtnX = W / 2 - 70;
            const finishBtnY = H - 72;

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
                style: new TextStyle({ fontFamily: "Inter,sans-serif", fontSize: 12, fill: 0xd9fff4, fontWeight: "700", letterSpacing: 1 }),
            });
            finishLabel.anchor.set(0.5, 0.5);
            finishLabel.x = finishBtnX + 70;
            finishLabel.y = finishBtnY + 23;
            btnContainer.addChild(finishLabel);

            // Start queued round button
            const startRoundBtn = new Graphics();
            const startRoundBtnX = W / 2 - 86;
            const startRoundBtnY = H - 72;

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
                text: "START VIDEO",
                style: new TextStyle({ fontFamily: "Inter,sans-serif", fontSize: 12, fill: 0xf8dfff, fontWeight: "700", letterSpacing: 1.2 }),
            });
            startRoundLabel.anchor.set(0.5, 0.5);
            startRoundLabel.x = startRoundBtnX + 86;
            startRoundLabel.y = startRoundBtnY + 23;
            btnContainer.addChild(startRoundLabel);

            // ── HUD text objects ───────────────────────────────────────────────────
            const hudTurnLabel = new Text({
                text: "",
                style: new TextStyle({ fontFamily: "JetBrains Mono,monospace", fontSize: 10, fill: 0x97b7ee, letterSpacing: 1.6 }),
            });
            hudTurnLabel.x = W - HUD_W - HUD_MARGIN + HUD_TEXT_X_PAD;
            hudTurnLabel.y = 26;
            hudText.addChild(hudTurnLabel);

            const hudPhaseLabel = new Text({
                text: "",
                style: new TextStyle({ fontFamily: "JetBrains Mono,monospace", fontSize: 10, fill: 0xc8d7ff, fontWeight: "700", letterSpacing: 1.2 }),
            });
            hudPhaseLabel.anchor.set(1, 0);
            hudPhaseLabel.x = W - HUD_MARGIN - 24;
            hudPhaseLabel.y = 26;
            hudText.addChild(hudPhaseLabel);

            const hudPlayerLabel = new Text({
                text: "",
                style: new TextStyle({ fontFamily: "Inter,sans-serif", fontSize: 20, fill: 0xf4f8ff, fontWeight: "800" }),
            });
            hudPlayerLabel.x = W - HUD_W - HUD_MARGIN + HUD_TEXT_X_PAD;
            hudPlayerLabel.y = 44;
            hudText.addChild(hudPlayerLabel);

            const hudFieldLabel = new Text({
                text: "",
                style: new TextStyle({ fontFamily: "Inter,sans-serif", fontSize: 11, fill: 0xafc2e7, wordWrap: true, wordWrapWidth: 206 }),
            });
            hudFieldLabel.x = W - HUD_W - HUD_MARGIN + HUD_TEXT_X_PAD;
            hudFieldLabel.y = 70;
            hudText.addChild(hudFieldLabel);

            const hudProgressLabel = new Text({
                text: "",
                style: new TextStyle({ fontFamily: "JetBrains Mono,monospace", fontSize: 11, fill: 0x8fd0ff, fontWeight: "700", letterSpacing: 1.1 }),
            });
            hudProgressLabel.x = W - HUD_W - HUD_MARGIN + HUD_TEXT_X_PAD;
            hudProgressLabel.y = 108;
            hudText.addChild(hudProgressLabel);

            const hudDiceLabel = new Text({
                text: "",
                style: new TextStyle({ fontFamily: "JetBrains Mono,monospace", fontSize: 40, fill: 0xf2f7ff, fontWeight: "800", align: "center" }),
            });
            hudDiceLabel.anchor.set(0.5, 0);
            hudDiceLabel.x = W - HUD_W - HUD_MARGIN + HUD_TEXT_X_PAD;
            hudDiceLabel.y = 103;
            hudText.addChild(hudDiceLabel);

            const hudMoneyLabel = new Text({
                text: "",
                style: new TextStyle({ fontFamily: "JetBrains Mono,monospace", fontSize: 12, fill: 0x76f3d5, fontWeight: "700" }),
            });
            hudMoneyLabel.x = W - HUD_W - HUD_MARGIN + HUD_TEXT_X_PAD;
            hudMoneyLabel.y = 190;
            hudText.addChild(hudMoneyLabel);

            const hudScoreLabel = new Text({
                text: "",
                style: new TextStyle({ fontFamily: "JetBrains Mono,monospace", fontSize: 12, fill: 0x81dbff, fontWeight: "700" }),
            });
            hudScoreLabel.x = W - HUD_W - HUD_MARGIN + HUD_TEXT_X_PAD;
            hudScoreLabel.y = 190;
            hudText.addChild(hudScoreLabel);

            const hudHighscoreLabel = new Text({
                text: "",
                style: new TextStyle({ fontFamily: "JetBrains Mono,monospace", fontSize: 11, fill: 0xd5ddff, fontWeight: "700" }),
            });
            hudHighscoreLabel.x = W - HUD_W - HUD_MARGIN + HUD_TEXT_X_PAD;
            hudHighscoreLabel.y = 229;
            hudText.addChild(hudHighscoreLabel);

            const hudProbabilityLabel = new Text({
                text: "",
                style: new TextStyle({ fontFamily: "JetBrains Mono,monospace", fontSize: 10, fill: 0xd9c4ff, wordWrap: true, wordWrapWidth: HUD_W - 52 }),
            });
            hudProbabilityLabel.x = W - HUD_W - HUD_MARGIN + HUD_TEXT_X_PAD;
            hudProbabilityLabel.y = 257;
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
            autoRollLabel.y = H - 112;
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
            const perkHeaderLabel = new Text({ text: "✦ PICK A PERK ✦", style: new TextStyle({ fontFamily: "Inter,sans-serif", fontSize: 18, fill: 0xf0b0ff, fontWeight: "800", letterSpacing: 3 }) });
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
            const perkCardOptionIds: Array<string | null> = Array.from({ length: MAX_PERKS }, () => null);

            for (let pi = 0; pi < MAX_PERKS; pi++) {
                const pc = new Container();
                pc.interactive = true;
                pc.eventMode = "static";
                pc.cursor = "pointer";
                pc.visible = false;
                stage.addChild(pc);
                perkCards.push(pc);

                const pg = new Graphics();
                pc.addChild(pg);
                perkCardGs.push(pg);

                const pnt = new Text({ text: "", style: new TextStyle({ fontFamily: "Inter,sans-serif", fontSize: 13, fill: 0xffffff, fontWeight: "700", wordWrap: true, wordWrapWidth: 170 }) });
                pnt.x = 16;
                pnt.y = 16;
                pc.addChild(pnt);
                perkNameTs.push(pnt);

                const pdt = new Text({ text: "", style: new TextStyle({ fontFamily: "Inter,sans-serif", fontSize: 10, fill: 0xddddee, wordWrap: true, wordWrapWidth: 170 }) });
                pdt.x = 16;
                pdt.y = 38;
                pc.addChild(pdt);
                perkDescTs.push(pdt);

                const pet = new Text({ text: "", style: new TextStyle({ fontFamily: "JetBrains Mono,monospace", fontSize: 9, fill: 0xd0a0ff }) });
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
                    if (!perkId) return;
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
                style: new TextStyle({ fontFamily: "JetBrains Mono,monospace", fontSize: 11, fill: 0xffe4f1, fontWeight: "700", letterSpacing: 1.2 }),
            });
            skipPerkLabel.anchor.set(0.5, 0.5);
            skipPerkLabel.visible = false;
            stage.addChild(skipPerkLabel);

            // Dice label in middle of screen during roll
            const bigDiceText = new Text({ text: "", style: new TextStyle({ fontFamily: "JetBrains Mono,monospace", fontSize: 72, fill: 0xeaf3ff, fontWeight: "800", dropShadow: { color: 0xff72ce, blur: 18, distance: 0, alpha: 0.9 } }) });
            bigDiceText.anchor.set(0.5, 0.5);
            bigDiceText.x = W / 2;
            bigDiceText.y = H / 2;
            bigDiceText.visible = false;
            stage.addChild(bigDiceText);

            // ── Star field ─────────────────────────────────────────────────────────
            const stars = generateStars(W, H, 120);

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
                const showRoundReward = roundRewardElapsed >= 0 && roundRewardElapsed <= ROUND_REWARD_FX_DURATION;
                const roundRewardPulse = showRoundReward
                    ? Math.sin(clampNum(roundRewardElapsed / ROUND_REWARD_FX_DURATION, 0, 1) * Math.PI)
                    : 0;

                // Find the currently visible token position (may be mid-hop)
                let tokenDisplayPos: { x: number; y: number } = tileCentre(boardLayout, currentPos);
                let tokenBob = Math.sin(bobT) * 5;
                let tokenScaleY = 1;

                if (phase.kind === "diceResultReveal") {
                    const startNodeId = s.lastTraversalPathNodeIds[0];
                    const startIdx = wrapIndex(
                        typeof startNodeId === "string"
                            ? s.config.runtimeGraph.nodeIndexById[startNodeId] ?? currentPos
                            : currentPos,
                        total,
                    );
                    tokenDisplayPos = tileCentre(boardLayout, startIdx);
                }

                if (phase.kind === "movingToken") {
                    const stepT = Math.min(1, phase.stepElapsed / STEP_DURATION);
                    // Smooth X movement with cubic ease; bouncy Y for the arc
                    const easedX = easeInOutCubic(stepT);
                    const easedY = easeOutCubic(stepT);
                    const startNodeId = s.lastTraversalPathNodeIds[0];
                    const startIdx = wrapIndex(
                        typeof startNodeId === "string"
                            ? s.config.runtimeGraph.nodeIndexById[startNodeId] ?? currentPos
                            : currentPos,
                        total,
                    );
                    const fromIdx = phase.stepIndex === 0
                        ? startIdx
                        : phase.path[phase.stepIndex - 1] ?? 0;
                    const toIdx = wrapIndex(phase.path[phase.stepIndex] ?? phase.path[phase.path.length - 1] ?? currentPos, total);
                    const from = tileCentre(boardLayout, fromIdx);
                    const to = tileCentre(boardLayout, toIdx);
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
                const targetCamX = W / 2 - targetScenePos.x * boardScale;
                const targetCamY = H / 2 - targetScenePos.y * boardScale + 30; // +30 = sit slightly above center
                // Fast during hop, slow gentle drift otherwise
                const camLerp = phase.kind === "movingToken" ? 0.08 : 0.035;
                camX = lerp(camX, targetCamX, camLerp);
                camY = lerp(camY, targetCamY, camLerp);
                boardContainer.x = camX;
                boardContainer.y = camY;

                // ── BG ──────────────────────────────────────────────────────────
                bgG.clear();
                drawBackground(bgG, W, H, t);

                starG.clear();
                drawStars(starG, stars, t);

                // ── Dynamic tile highlights only (static board geometry is cached) ──
                const hopHighlight = phase.kind === "movingToken" ? phase.path[phase.stepIndex] : -1;
                tileFxG.clear();
                if (phase.kind !== "movingToken") {
                    const activeField = board[currentPos];
                    if (activeField) {
                        const { x, y } = tileOrigin(boardLayout, currentPos);
                        const color = TILE_COLOURS[activeField.kind]?.glow ?? 0x9ab1ff;
                        const pulse = 0.65 + 0.35 * Math.sin(t * 2.1);
                        drawTileHighlight(tileFxG, x, y, color, pulse);
                    }
                }
                if (hopHighlight >= 0 && hopHighlight < total) {
                    const hopField = board[hopHighlight];
                    if (hopField) {
                        const { x, y } = tileOrigin(boardLayout, hopHighlight);
                        const color = TILE_COLOURS[hopField.kind]?.accent ?? 0xffffff;
                        const pulse = 0.72 + 0.28 * Math.sin(t * 5.2);
                        drawTileHighlight(tileFxG, x, y, color, pulse);
                    }
                }

                // ── Token ─────────────────────────────────────────────────────────────
                tokenG.clear();
                const localTX = tokenDisplayPos.x;
                const localTY = tokenDisplayPos.y;
                const activeTokenLabelIds = new Set<string>();

                const localPlayerId = currentPlayer?.id ?? "local-player";
                const offsetByPlayerId = (playerId: string): { x: number; y: number } => {
                    const hash = hashString(playerId);
                    const angle = (hash % 360) * (Math.PI / 180);
                    const radius = 8 + (hash % 3) * 6;
                    return {
                        x: Math.cos(angle) * radius,
                        y: Math.sin(angle) * radius,
                    };
                };
                const labelPlayerToken = (playerId: string, playerName: string, x: number, y: number) => {
                    if (!showMultiplayerPlayerNamesRef.current) return;
                    const trimmedName = playerName.trim();
                    if (!trimmedName) return;
                    const displayName = trimmedName.length > MAX_PLAYER_LABEL_LENGTH
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
                labelPlayerToken(localPlayerId, currentPlayer?.name ?? "Player", localTX, localTY - tokenBob);

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
                        const progress = existing.durationSec > 0
                            ? clampNum((t - existing.startSec) / existing.durationSec, 0, 1)
                            : 1;
                        const currentIndex = lerp(existing.fromIndex, existing.toIndex, easeInOutCubic(progress));
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

                    const motionProgress = nextMotion.durationSec > 0
                        ? clampNum((t - nextMotion.startSec) / nextMotion.durationSec, 0, 1)
                        : 1;
                    const displayIndex = lerp(nextMotion.fromIndex, nextMotion.toIndex, easeInOutCubic(motionProgress));
                    const center = tileCentreAtProgress(boardLayout, displayIndex);
                    const offset = offsetByPlayerId(remote.id);
                    const hash = hashString(remote.id);
                    const travelArc = nextMotion.toIndex !== nextMotion.fromIndex
                        ? Math.sin(motionProgress * Math.PI) * 10
                        : 0;
                    const remoteScale = nextMotion.toIndex !== nextMotion.fromIndex
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
                        t + hash * 0.01,
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
                hudG.clear();
                drawHUD(hudG, s, W, roundRewardPulse);

                // Reposition HUD text to right side
                const hudPanelX = W - HUD_W - HUD_MARGIN;
                const hudX = hudPanelX + HUD_TEXT_X_PAD;
                const hudRightX = hudPanelX + 192;
                const hudDiceX = hudPanelX + 280;
                hudTurnLabel.x = hudX;
                hudPhaseLabel.x = hudPanelX + HUD_W - 24;
                hudPlayerLabel.x = hudX;
                hudFieldLabel.x = hudX;
                hudProgressLabel.x = hudX;
                hudDiceLabel.x = hudDiceX;
                hudMoneyLabel.x = hudRightX;
                hudScoreLabel.x = hudX;
                hudHighscoreLabel.x = hudX;
                hudProbabilityLabel.x = hudX;

                // Update HUD text
                hudTurnLabel.text = `TURN ${s.turn.toString().padStart(2, "0")}`;
                const phaseLabelMap: Record<AnimPhase["kind"], string> = {
                    idle: "STANDBY",
                    rollingDice: "ROLLING",
                    diceResultReveal: "RESULT",
                    movingToken: "TRAVEL",
                    landingEffect: "LANDING",
                    roundCountdown: "COUNTDOWN",
                    perkReveal: "PERK",
                };
                hudPhaseLabel.text = phaseLabelMap[phase.kind];
                hudPlayerLabel.text = currentPlayer?.name ?? "Player";
                const currentField = board[currentPos];
                hudFieldLabel.text = currentField ? `FIELD ${currentPos + 1}: ${currentField.name}` : "";
                const boardProgressPct =
                    (currentPos / Math.max(1, s.config.singlePlayer.totalIndices)) * 100;
                hudProgressLabel.text = `BOARD PROGRESS ${boardProgressPct.toFixed(0)}%`;
                hudDiceLabel.text = s.lastRoll ? `${s.lastRoll}` : "";
                hudScoreLabel.text = `SCORE ${currentPlayer?.score ?? 0}`;
                hudMoneyLabel.text = `MONEY $${currentPlayer?.money ?? 0}`;
                hudHighscoreLabel.text = `BEST ${s.highscore}`;
                hudProbabilityLabel.text = `INTERMEDIARY ${(s.intermediaryProbability * 100).toFixed(0)}%\nANTI-PERK ${(s.antiPerkProbability * 100).toFixed(0)}%`;
                const topLog = s.log[0] ?? "";
                if (topLog !== lastTopLog) {
                    lastTopLog = topLog;
                    if (topLog.includes("applied anti-perk:")) {
                        antiPerkAlertText = topLog.replace(/.*applied anti-perk:/, "ANTI-PERK APPLIED:");
                        antiPerkAlertStart = t;
                    }
                    if (topLog.startsWith("Round finished.")) {
                        const rewardMatch = topLog.match(/\+\$(\d+), \+(\d+) score/);
                        roundRewardMoney = Number(rewardMatch?.[1] ?? s.config.economy.moneyPerCompletedRound);
                        roundRewardScore = Number(rewardMatch?.[2] ?? s.config.economy.scorePerCompletedRound);
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
                    !s.queuedRound &&
                    !s.activeRound;
                const hasRound = !!s.activeRound;
                const canStartQueuedRound = phase.kind === "idle" && !!s.queuedRound && !s.pendingPerkSelection && !s.activeRound;

                rollBtn.visible = canRoll;
                rollBtnLabel.visible = canRoll;
                startRoundBtn.visible = canStartQueuedRound;
                startRoundLabel.visible = canStartQueuedRound;
                finishBtn.visible = hasRound && phase.kind === "idle";
                finishLabel.visible = hasRound && phase.kind === "idle";

                // ── Dice overlay ─────────────────────────────────────────────────────
                diceG.clear();
                bigDiceText.visible = false;
                autoRollLabel.visible = false;

                if (phase.kind === "rollingDice") {
                    const pct = phase.elapsed / DICE_ROLL_DURATION;
                    drawDiceOverlay(diceG, W / 2, H / 2, phase.displayValue, pct, W, H);
                    bigDiceText.visible = true;
                    bigDiceText.text = `${phase.displayValue}`;
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
                    bigDiceText.text = `${phase.value}`;
                    bigDiceText.x = W / 2;
                    bigDiceText.y = H / 2;
                    const entry = easeOutBack(Math.min(1, pct * 1.25));
                    const pulse = Math.sin(pct * Math.PI * 5) * (1 - pct) * 0.08;
                    bigDiceText.scale.set(1.12 + entry * 0.24 + pulse);
                }

                if (phase.kind === "roundCountdown") {
                    const pct = 1 - phase.remaining / ROUND_COUNTDOWN_DURATION;
                    const pulse = 0.7 + 0.3 * Math.sin(pct * Math.PI * 9);

                    diceG.rect(0, 0, W, H);
                    diceG.fill({ color: 0x0b1732, alpha: 0.5 });
                    diceG.circle(W / 2, H * 0.3, 92 + 14 * pulse);
                    diceG.fill({ color: 0xffca3a, alpha: 0.22 });
                    diceG.circle(W / 2, H * 0.3, 68 + 8 * pulse);
                    diceG.fill({ color: 0xffffff, alpha: 0.22 });
                    diceG.circle(W / 2, H * 0.3, 56);
                    diceG.fill({ color: 0x174a7a, alpha: 0.9 });
                    diceG.stroke({ color: 0xe6f7ff, alpha: 0.95, width: 2.2 });

                    bigDiceText.visible = true;
                    bigDiceText.text = `${Math.max(0, Math.ceil(phase.remaining))}`;
                    bigDiceText.x = W / 2;
                    bigDiceText.y = H * 0.3;
                    bigDiceText.scale.set(0.95 + 0.15 * pulse);
                }

                const autoRollRemaining = nextAutoRollInSecRef.current;
                if (typeof autoRollRemaining === "number") {
                    const pauseSecTotal = resolveEffectiveRestPauseSec(s);
                    const timeNorm = Math.max(0, Math.min(1, autoRollRemaining / Math.max(0.1, pauseSecTotal)));
                    const pulse = 0.6 + 0.4 * Math.sin(t * 5);
                    const panelW = 280;
                    const panelH = 52;
                    const panelX = W / 2 - panelW / 2;
                    const panelY = H - 138;

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
                    autoRollLabel.text = `NEXT AUTO ROLL IN ${autoRollRemaining.toFixed(1)}s`;
                }

                antiPerkAlertG.clear();
                antiPerkAlertLabel.visible = false;
                const alertElapsed = t - antiPerkAlertStart;
                const alertDuration = 3.3;
                if (alertElapsed >= 0 && alertElapsed <= alertDuration && antiPerkAlertText.length > 0) {
                    const progress = alertElapsed / alertDuration;
                    const fadeIn = Math.min(1, progress / 0.12);
                    const fadeOut = Math.min(1, (1 - progress) / 0.2);
                    const alpha = Math.min(fadeIn, fadeOut);
                    const pulse = 0.5 + 0.5 * Math.sin(t * 20);
                    const panelW = 560;
                    const panelH = 54;
                    const panelX = W / 2 - panelW / 2;
                    const panelY = 84;
                    const shake = (1 - progress) * 2.8 * Math.sin(t * 45);

                    antiPerkAlertG.roundRect(panelX - 6 + shake, panelY - 6, panelW + 12, panelH + 12, 16);
                    antiPerkAlertG.fill({ color: 0xff3f57, alpha: (0.14 + pulse * 0.08) * alpha });
                    antiPerkAlertG.roundRect(panelX + shake, panelY, panelW, panelH, 12);
                    antiPerkAlertG.fill({ color: 0x1b050c, alpha: 0.9 * alpha });
                    antiPerkAlertG.stroke({ color: 0xff6d8e, alpha: (0.82 + pulse * 0.16) * alpha, width: 2.3 });

                    antiPerkAlertLabel.visible = true;
                    antiPerkAlertLabel.text = antiPerkAlertText;
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
                    const countingMoney = Math.round(lerp(roundRewardPrevMoney, roundRewardNextMoney, countProgress));
                    const countingScore = Math.round(lerp(roundRewardPrevScore, roundRewardNextScore, countProgress));
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
                    rewardTitleLabel.text = "ROUND COMPLETE";
                    rewardTitleLabel.alpha = rewardAlpha;
                    rewardTitleLabel.x = W / 2;
                    rewardTitleLabel.y = H * 0.29 - rise * 0.6;
                    rewardTitleLabel.scale.set(0.9 + pop * 0.12 + pulse * 0.03);

                    rewardMoneyLabel.visible = true;
                    rewardMoneyLabel.text = `+$${roundRewardMoney}`;
                    rewardMoneyLabel.alpha = rewardAlpha;
                    rewardMoneyLabel.x = W / 2;
                    rewardMoneyLabel.y = H * 0.4 - rise;
                    rewardMoneyLabel.scale.set(0.92 + pop * 0.2 + pulse * 0.05);

                    rewardScoreLabel.visible = true;
                    rewardScoreLabel.text = `+${roundRewardScore} SCORE`;
                    rewardScoreLabel.alpha = rewardAlpha;
                    rewardScoreLabel.x = W / 2;
                    rewardScoreLabel.y = H * 0.49 - rise * 0.8;
                    rewardScoreLabel.scale.set(0.92 + pop * 0.16 + pulse * 0.03);

                    rewardTotalMoneyLabel.visible = true;
                    rewardTotalMoneyLabel.text = `NEW MONEY TOTAL: $${countingMoney}`;
                    rewardTotalMoneyLabel.alpha = rewardAlpha;
                    rewardTotalMoneyLabel.x = W / 2;
                    rewardTotalMoneyLabel.y = H * 0.58 - rise * 0.5;
                    rewardTotalMoneyLabel.scale.set(0.94 + pop * 0.08);

                    rewardTotalScoreLabel.visible = true;
                    rewardTotalScoreLabel.text = `NEW SCORE TOTAL: ${countingScore}`;
                    rewardTotalScoreLabel.alpha = rewardAlpha;
                    rewardTotalScoreLabel.x = W / 2;
                    rewardTotalScoreLabel.y = H * 0.63 - rise * 0.4;
                    rewardTotalScoreLabel.scale.set(0.94 + pop * 0.08);
                } else {
                    roundRewardLastTickStep = -1;
                }

                // ── Perk modal ────────────────────────────────────────────────────────
                const showPerks = (phase.kind === "perkReveal" || phase.kind === "idle") && !!s.pendingPerkSelection;
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
                    card.alpha = perkRevealT * (canAfford ? 1 : 0.6);
                    card.cursor = canAfford ? "pointer" : "not-allowed";
                    card.interactive = canAfford;

                    cardG.clear();
                    cardG.roundRect(0, 0, CARD_W, CARD_H, 14);
                    cardG.fill({ color: 0x0d0d2e, alpha: 0.97 });
                    cardG.stroke({ color: rarityMeta.pixi.stroke, alpha: 0.86, width: 2 });

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

                    const directLabel = applyPerkDirectlyRef.current && perk.kind === "perk" ? "Direct apply" : "Stored in inventory";
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
                skipPerkBtn.clear();
                skipPerkBtn.roundRect(skipBtnX, skipBtnY, skipBtnW, skipBtnH, 12);
                skipPerkBtn.fill({ color: 0x2a0d28, alpha: 0.96 });
                skipPerkBtn.stroke({ color: 0xff8fd0, alpha: 0.85, width: 1.8 });
                skipPerkBtn.visible = showPerks;

                skipPerkLabel.x = W / 2;
                skipPerkLabel.y = skipBtnY + skipBtnH / 2;
                skipPerkLabel.visible = showPerks;

                // Dim background when perk modal is open
                if (showPerks) {
                    hudG.rect(0, 0, W, H);
                    hudG.fill({ color: 0x000000, alpha: 0.45 });
                    drawHUD(hudG, s, W, roundRewardPulse); // redraw HUD on top of dim
                } else {
                    skipPerkBtn.visible = false;
                    skipPerkLabel.visible = false;
                }

                rafId = requestAnimationFrame(renderFrame);
            };

            rafId = requestAnimationFrame((ts) => {
                if (disposed) return;
                lastFrameTs = ts;
                renderFrame(ts);
            });
        })();

        return () => {
            disposed = true;
            cancelAnimationFrame(rafId);
            ro?.disconnect();
            setTimeout(() => {
                if (appRef.current) {
                    appRef.current.destroy(true, { children: true });
                    appRef.current = null;
                }
            }, 0);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const currentPlayer = state.players[state.currentPlayerIndex];
    const boardAntiPerkSequence = (
        !state.activeRound &&
        !state.pendingPathChoice &&
        !state.pendingPerkSelection &&
        !state.queuedRound &&
        state.sessionPhase === "normal" &&
        currentPlayer
    )
        ? (["milker", "jackhammer", "no-rest"] as const).find((id) => currentPlayer.antiPerks.includes(id)) ?? null
        : null;

    return (
        <>
            <div
                ref={containerRef}
                style={{ width: "100vw", height: "100vh", overflow: "hidden", display: "block", position: "relative", zIndex: 1 }}
            />
            <RoundVideoOverlay
                activeRound={state.activeRound}
                booruSearchPrompt={intermediaryLoadingPrompt}
                intermediaryLoadingDurationSec={intermediaryLoadingDurationSec}
                intermediaryReturnPauseSec={intermediaryReturnPauseSec}
                currentPlayer={currentPlayer}
                intermediaryProbability={state.intermediaryProbability}
                installedRounds={installedRounds}
                onFinishRound={handleCompleteRound}
                onRequestCum={requestCumConfirmation}
                showCumRoundOutcomeMenuOnCumRequest={isLastCumRoundActive}
                onOpenOptions={() => setShowOptionsMenu(true)}
                onUiVisibilityChange={onRoundOverlayUiVisibilityChange}
                allowDebugRoundControls={allowDebugRoundControls}
                boardSequence={boardAntiPerkSequence}
                onCompleteBoardSequence={(perkId) => {
                    if (!currentPlayer) return;
                    handleConsumeAntiPerkById({
                        playerId: currentPlayer.id,
                        perkId,
                        reason: `${perkId} finished.`,
                    });
                }}
                roundControl={{
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
                }}
            />
            {!state.activeRound && state.sessionPhase !== "completed" && (
                <div className="pointer-events-none fixed bottom-16 right-4 z-[96]">
                    <button
                        type="button"
                        className="pointer-events-auto rounded-lg border border-indigo-300/55 bg-zinc-950/88 px-4 py-2 text-sm font-semibold text-indigo-100 backdrop-blur transition-colors hover:bg-zinc-900"
                        onClick={() => setShowOptionsMenu(true)}
                    >
                        Options
                    </button>
                </div>
            )}
            {!state.activeRound && state.sessionPhase !== "completed" && (
                <div className="pointer-events-none fixed bottom-4 right-4 z-[96]">
                    <button
                        type="button"
                        className="pointer-events-auto rounded-lg border border-rose-400/70 bg-rose-500/20 px-4 py-2 text-sm font-semibold text-rose-100 transition-colors hover:bg-rose-500/35"
                        onClick={requestCumConfirmation}
                    >
                        Cum (C)
                    </button>
                </div>
            )}
            {state.pendingPerkSelection && onApplyPerkDirectlyChange && (
                <div className="pointer-events-auto fixed left-1/2 top-6 z-[95] -translate-x-1/2 rounded-xl border border-cyan-300/45 bg-zinc-950/90 px-4 py-2 text-sm text-cyan-100 backdrop-blur">
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
            {state.pendingPathChoice && (
                <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-black/55 px-4">
                    <div className="pointer-events-auto w-full max-w-xl rounded-2xl border border-zinc-600 bg-zinc-950/95 p-5 shadow-2xl">
                        <h2 className="text-lg font-bold text-zinc-100">Choose Your Path</h2>
                        <p className="mt-1 text-sm text-zinc-300">
                            Pick a route. If time runs out, the game selects one automatically.
                        </p>
                        <p className="mt-2 font-[family-name:var(--font-jetbrains-mono)] text-xs uppercase tracking-[0.14em] text-violet-200">
                            {pathChoiceRemainingMs !== null
                                ? `Auto-select in ${(pathChoiceRemainingMs / 1000).toFixed(1)}s`
                                : "Auto-select pending"}
                        </p>
                        <div className="mt-4 grid gap-2">
                            {state.pendingPathChoice.options.map((option) => (
                                <button
                                    key={option.edgeId}
                                    type="button"
                                    onClick={() => handleSelectPathEdgeRef.current(option.edgeId)}
                                    className="w-full rounded-lg border border-violet-300/35 bg-zinc-900/80 px-4 py-3 text-left text-sm text-zinc-100 transition-colors hover:border-violet-200/70 hover:bg-zinc-800"
                                >
                                    <div className="font-semibold">{option.label ?? option.toFieldName}</div>
                                    <div className="mt-1 text-xs text-zinc-300">
                                        Destination: {option.toFieldName}
                                        {option.gateCost > 0 ? ` • Gate Cost: $${option.gateCost}` : " • No Gate Cost"}
                                    </div>
                                </button>
                            ))}
                        </div>
                    </div>
                </div>
            )}
            {showCumConfirm && (
                <div className="pointer-events-none fixed inset-0 z-[140] flex items-center justify-center bg-black/70 px-4">
                    <div className="pointer-events-auto w-full max-w-md rounded-2xl border border-rose-300/50 bg-zinc-950/95 p-5 shadow-2xl">
                        <h2 className="text-lg font-bold text-rose-100">Cum Confirmation</h2>
                        <p className="mt-2 text-sm text-zinc-200">
                            Did you cum? Confirming ends this run immediately.
                        </p>
                        <div className="mt-4 grid grid-cols-2 gap-2">
                            <button
                                type="button"
                                className="rounded-lg border border-zinc-500 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 hover:border-zinc-300"
                                onClick={() => setShowCumConfirm(false)}
                            >
                                No
                            </button>
                            <button
                                type="button"
                                className="rounded-lg border border-rose-400/70 bg-rose-500/20 px-3 py-2 text-sm font-semibold text-rose-100 hover:bg-rose-500/35"
                                onClick={() => {
                                    setShowCumConfirm(false);
                                    handleReportCumRef.current();
                                }}
                            >
                                Yes, End Run
                            </button>
                        </div>
                    </div>
                </div>
            )}
            {showOptionsMenu && (
                <div className="pointer-events-none fixed inset-0 z-[141] flex items-center justify-center bg-black/60 px-4">
                    <div className="pointer-events-auto w-full max-w-sm rounded-2xl border border-indigo-300/45 bg-zinc-950/95 p-5 shadow-2xl">
                        <h2 className="text-lg font-bold text-indigo-100">Options</h2>
                        <p className="mt-2 text-sm text-zinc-200">
                            The game keeps running in the background.
                        </p>
                        <div className="mt-4 space-y-2">
                            <button
                                type="button"
                                className="w-full rounded-lg border border-zinc-500 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 hover:border-zinc-300"
                                onClick={() => setShowOptionsMenu(false)}
                            >
                                Proceed
                            </button>
                            {optionsActions.map((action) => (
                                <button
                                    key={action.id}
                                    type="button"
                                    disabled={action.disabled}
                                    className={`w-full rounded-lg border px-3 py-2 text-sm font-semibold disabled:opacity-60 ${
                                        action.tone === "danger"
                                            ? "border-rose-400/70 bg-rose-500/20 text-rose-100 hover:bg-rose-500/35"
                                            : "border-amber-400/60 bg-amber-500/15 text-amber-100 hover:bg-amber-500/25"
                                    }`}
                                    onClick={() => {
                                        setShowOptionsMenu(false);
                                        action.onClick();
                                    }}
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
                            >
                                {giveUpLabel}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
});
