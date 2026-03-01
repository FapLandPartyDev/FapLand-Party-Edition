import "pixi.js/browser";
import "pixi.js/unsafe-eval";
import {
  Application,
  Container,
  Graphics,
  Text,
  TextStyle,
  type FederatedPointerEvent,
} from "pixi.js";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import type { BoardField, GameState } from "../../game/types";

// ─── Layout ───────────────────────────────────────────────────────────────────

const TILE_W = 88;
const TILE_H = 52;
const TILE_DEPTH = 16;
const TILE_DEPTH_SIDE = 10;
const COL_COUNT = 4;
const TILE_GAP_X = 110;
const TILE_GAP_Y = 80;
const PAD_X = 56;
const PAD_Y = 56;

// ─── Colours ──────────────────────────────────────────────────────────────────

type TileColours = { top: number; side: number; sideR: number; stroke: number };

const COLOURS: Record<string, TileColours> = {
  start: { top: 0x38ef7d, side: 0x0d8c3c, sideR: 0x0a7030, stroke: 0x00ff7c },
  path: { top: 0x3b45d4, side: 0x1e2180, sideR: 0x161760, stroke: 0x7b84ff },
  event: { top: 0xf7b731, side: 0x9c7000, sideR: 0x7a5900, stroke: 0xffe066 },
  perk: { top: 0xc862f0, side: 0x6b1294, sideR: 0x550f78, stroke: 0xf0b0ff },
};

const PLAYER_COLOURS = [0xff4da6, 0x4df0ff, 0xffd700, 0x7fff7f] as const;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function indexToGrid(index: number, total: number): { col: number; row: number } {
  const row = Math.floor(index / COL_COUNT);
  const col = row % 2 === 0 ? index % COL_COUNT : COL_COUNT - 1 - (index % COL_COUNT);
  const maxRow = Math.floor((total - 1) / COL_COUNT);
  return { col, row: maxRow - row };
}

function gridToPixel(col: number, row: number): { x: number; y: number } {
  return { x: PAD_X + col * TILE_GAP_X, y: PAD_Y + row * TILE_GAP_Y };
}

function blendColor(a: number, b: number, t: number): number {
  const lerp = (c1: number, c2: number) => Math.round(c1 + (c2 - c1) * t);
  const r = lerp((a >> 16) & 0xff, (b >> 16) & 0xff);
  const g = lerp((a >> 8) & 0xff, (b >> 8) & 0xff);
  const bl = lerp(a & 0xff, b & 0xff);
  return (r << 16) | (g << 8) | bl;
}

function drawTile(
  g: Graphics,
  x: number,
  y: number,
  field: BoardField,
  isActive: boolean,
  phase: number
): void {
  const c = COLOURS[field.kind] ?? COLOURS.path;
  const pulse = 0.5 + 0.5 * Math.sin(phase);

  // Outer glow ring
  if (isActive) {
    g.circle(x + TILE_W / 2, y + TILE_H / 2 + 4, TILE_W * 0.7);
    g.fill({ color: c.stroke, alpha: 0.18 + 0.18 * pulse });
  }

  // Front extrusion (bottom face)
  g.poly([
    x,
    y + TILE_H,
    x + TILE_W,
    y + TILE_H,
    x + TILE_W,
    y + TILE_H + TILE_DEPTH,
    x,
    y + TILE_H + TILE_DEPTH,
  ]);
  g.fill(c.side);
  g.stroke({ color: 0x000000, alpha: 0.6, width: 1 });

  // Right side extrusion
  g.poly([
    x + TILE_W,
    y,
    x + TILE_W + TILE_DEPTH_SIDE,
    y - TILE_DEPTH_SIDE * 0.5,
    x + TILE_W + TILE_DEPTH_SIDE,
    y + TILE_H - TILE_DEPTH_SIDE * 0.5,
    x + TILE_W,
    y + TILE_H,
  ]);
  g.fill(c.sideR);
  g.stroke({ color: 0x000000, alpha: 0.5, width: 1 });

  // Top face
  const topColor = isActive ? blendColor(c.top, 0xffffff, 0.2 + 0.12 * pulse) : c.top;
  g.roundRect(x, y, TILE_W, TILE_H, 8);
  g.fill(topColor);
  g.stroke({
    color: isActive ? c.stroke : 0x000000,
    alpha: isActive ? 0.95 : 0.45,
    width: isActive ? 2.5 : 1.5,
  });

  // Index number tag (top-left corner)
  // not drawn here – let text layer handle it
}

function drawConnector(g: Graphics, x1: number, y1: number, x2: number, y2: number): void {
  const cx1 = x1 + TILE_W / 2;
  const cy1 = y1 + TILE_H / 2;
  const cx2 = x2 + TILE_W / 2;
  const cy2 = y2 + TILE_H / 2;
  g.moveTo(cx1, cy1);
  g.lineTo(cx2, cy2);
  g.stroke({ color: 0xffffff, alpha: 0.1, width: 3 });

  // Arrow dot in the center
  const mx = (cx1 + cx2) / 2;
  const my = (cy1 + cy2) / 2;
  g.circle(mx, my, 2.5);
  g.fill({ color: 0xffffff, alpha: 0.2 });
}

function drawToken(g: Graphics, x: number, y: number, playerIndex: number, phase: number): void {
  const color = PLAYER_COLOURS[playerIndex % PLAYER_COLOURS.length];
  const bob = Math.sin(phase) * 5;
  const px = x + TILE_W / 2;
  const py = y + TILE_H / 2 + bob;

  // Drop shadow
  g.ellipse(px, y + TILE_H - 1, 14 - Math.abs(bob) * 0.3, 4);
  g.fill({ color: 0x000000, alpha: 0.4 });

  // Body circle
  g.circle(px, py - 14, 13);
  g.fill(color);
  g.stroke({ color: 0xffffff, alpha: 0.85, width: 2 });

  // Star/crown shape on top as a simple highlight arc
  g.circle(px, py - 22, 4);
  g.fill({ color: 0xffffff, alpha: 0.5 });
}

// ─── Kind label mapping ───────────────────────────────────────────────────────

const KIND_LABELS: Record<string, string> = {
  start: "START",
  path: "PATH",
  event: "EVENT★",
  perk: "✦ PERK",
};

// ─── Component ────────────────────────────────────────────────────────────────

interface GameBoardRendererProps {
  state: GameState;
  onTileClick?: (fieldIndex: number) => void;
}

export const GameBoardRenderer = memo(function GameBoardRenderer({
  state,
  onTileClick,
}: GameBoardRendererProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const appRef = useRef<Application | null>(null);
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  });

  const [tooltip, setTooltip] = useState<{
    x: number;
    y: number;
    field: BoardField;
  } | null>(null);

  const onTileClickRef = useRef(onTileClick);
  useEffect(() => {
    onTileClickRef.current = onTileClick;
  });

  const board = state.config.board;
  const rows = Math.ceil(board.length / COL_COUNT);
  const stageW = PAD_X * 2 + COL_COUNT * TILE_GAP_X + TILE_DEPTH_SIDE + 8;
  const stageH = PAD_Y * 2 + rows * TILE_GAP_Y + TILE_DEPTH + 20;

  // Hover handler is stable (uses ref)
  const handleOver = useCallback((e: FederatedPointerEvent, field: BoardField) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    setTooltip({ x: e.clientX - rect.left, y: e.clientY - rect.top, field });
  }, []);
  const handleOut = useCallback(() => setTooltip(null), []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let rafId: number;
    let phase = 0;
    let bobPhase = 0;

    const app = new Application();
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
        console.warn("Failed to destroy Pixi board renderer", error);
      }
    };

    (async () => {
      try {
        await app.init({
          backgroundAlpha: 0,
          antialias: true,
          width: stageW,
          height: stageH,
          resolution: window.devicePixelRatio ?? 1,
          autoDensity: true,
          skipExtensionImports: true,
        });

        if (!containerRef.current) {
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

        // ── Connector layer (static-ish, redrawn each frame) ─────────────────
        const connectorLayer = new Graphics();
        connectorLayer.interactiveChildren = false;
        stage.addChild(connectorLayer);

        // ── Tile layer ────────────────────────────────────────────────────────
        const tileLayer = new Graphics();
        tileLayer.interactiveChildren = false;
        stage.addChild(tileLayer);

        // ── Token layer ───────────────────────────────────────────────────────
        const tokenLayer = new Graphics();
        tokenLayer.interactiveChildren = false;
        stage.addChild(tokenLayer);

        // ── Text layer (static positions, re-positioned each render) ──────────
        const textLayer = new Container();
        stage.addChild(textLayer);

        type LabelPair = { name: Text; kind: Text; index: Text };
        const labelMap = new Map<string, LabelPair>();

        const brd = stateRef.current.config.board;
        brd.forEach((field, idx) => {
          const nameText = new Text({
            text: field.name,
            style: new TextStyle({
              fontFamily: "Inter, sans-serif",
              fontSize: 9,
              fill: 0xffffff,
              fontWeight: "700",
              align: "center",
              wordWrap: true,
              wordWrapWidth: TILE_W - 10,
            }),
          });
          nameText.anchor.set(0.5, 0.5);
          nameText.interactiveChildren = false;

          const kindText = new Text({
            text: KIND_LABELS[field.kind] ?? field.kind,
            style: new TextStyle({
              fontFamily: "JetBrains Mono, monospace",
              fontSize: 7,
              fill: 0xffffff,
              align: "center",
            }),
          });
          kindText.anchor.set(0.5, 0.5);
          kindText.alpha = 0.65;
          kindText.interactiveChildren = false;

          const indexText = new Text({
            text: `${idx}`,
            style: new TextStyle({
              fontFamily: "JetBrains Mono, monospace",
              fontSize: 8,
              fill: 0xffffff,
            }),
          });
          indexText.alpha = 0.4;
          indexText.interactiveChildren = false;

          textLayer.addChild(nameText);
          textLayer.addChild(kindText);
          textLayer.addChild(indexText);
          labelMap.set(field.id, { name: nameText, kind: kindText, index: indexText });
        });

        // ── Invisible hit-targets (interactive) ───────────────────────────────
        const hitLayer = new Container();
        stage.addChild(hitLayer);

        brd.forEach((field, idx) => {
          const { col, row } = indexToGrid(idx, brd.length);
          const { x, y } = gridToPixel(col, row);
          const hit = new Graphics();
          hit.rect(x, y, TILE_W + TILE_DEPTH_SIDE, TILE_H + TILE_DEPTH);
          hit.fill({ alpha: 0 }); // invisible
          hit.interactive = true;
          hit.eventMode = "static";
          hit.cursor = "pointer";
          hit.on("pointerover", (e: FederatedPointerEvent) => handleOver(e, field));
          hit.on("pointerout", handleOut);
          hit.on("pointertap", () => onTileClickRef.current?.(idx));
          hitLayer.addChild(hit);
        });

        // ── Render loop ───────────────────────────────────────────────────────
        const renderFrame = () => {
          phase += 0.042;
          bobPhase += 0.038;

          const s = stateRef.current;
          const currentPos = s.players[s.currentPlayerIndex]?.position ?? 0;
          const boardData = s.config.board;
          const total = boardData.length;

          connectorLayer.clear();
          tileLayer.clear();
          tokenLayer.clear();

          // Connectors
          s.config.runtimeGraph.edges.forEach((edge) => {
            const fromIndex = s.config.runtimeGraph.nodeIndexById[edge.fromNodeId];
            const toIndex = s.config.runtimeGraph.nodeIndexById[edge.toNodeId];
            if (
              typeof fromIndex !== "number" ||
              typeof toIndex !== "number" ||
              fromIndex < 0 ||
              fromIndex >= total ||
              toIndex < 0 ||
              toIndex >= total
            ) {
              return;
            }
            const p1 = gridToPixel(...gridToPixelArgs(fromIndex, total));
            const p2 = gridToPixel(...gridToPixelArgs(toIndex, total));
            drawConnector(connectorLayer, p1.x, p1.y, p2.x, p2.y);
          });

          // Tiles (depth-sorted: low row → draw first → appears behind high row tiles)
          const drawOrder = boardData
            .map((f, i) => ({ f, i, ...indexToGrid(i, total) }))
            .sort((a, b) => a.row - b.row);

          drawOrder.forEach(({ f, i, col, row }) => {
            const { x, y } = gridToPixel(col, row);
            drawTile(tileLayer, x, y, f, i === currentPos, phase);

            const pair = labelMap.get(f.id);
            if (!pair) return;
            pair.name.x = x + TILE_W / 2;
            pair.name.y = y + TILE_H / 2 - 7;
            pair.kind.x = x + TILE_W / 2;
            pair.kind.y = y + TILE_H / 2 + 8;
            pair.index.x = x + 4;
            pair.index.y = y + 3;
          });

          // Tokens
          s.players.forEach((player, pi) => {
            const { col, row } = indexToGrid(player.position, total);
            const { x, y } = gridToPixel(col, row);
            drawToken(tokenLayer, x, y, pi, bobPhase + pi * 1.3);
          });

          rafId = requestAnimationFrame(renderFrame);
        };

        rafId = requestAnimationFrame(renderFrame);
      } catch (error) {
        console.error("Pixi board renderer init failed", error);
        destroyApp();
      }
    })();

    return () => {
      cancelAnimationFrame(rafId);
      destroyApp();
    };
  }, [board.length, stageW, stageH, handleOver, handleOut]);

  return (
    <div className="relative select-none">
      <div
        ref={containerRef}
        className="overflow-hidden rounded-2xl"
        style={{ width: stageW, height: stageH, maxWidth: "100%" }}
      />

      {tooltip && (
        <div
          className="pointer-events-none absolute z-20 rounded-xl border border-violet-300/40 bg-zinc-950/95 px-3 py-2 shadow-xl backdrop-blur-md"
          style={{ left: tooltip.x + 14, top: tooltip.y - 10 }}
        >
          <p className="text-xs font-bold text-white">{tooltip.field.name}</p>
          <p className="mt-0.5 text-[10px] uppercase tracking-widest text-violet-300">
            {tooltip.field.kind}
          </p>
          {tooltip.field.round && (
            <p className="mt-0.5 text-[10px] text-amber-300">
              Round Slot {tooltip.field.round.slot + 1}
            </p>
          )}
        </div>
      )}
    </div>
  );
});

// ─── Util: unpack indexToGrid into args tuple for gridToPixel ─────────────────

function gridToPixelArgs(index: number, total: number): [number, number] {
  const { col, row } = indexToGrid(index, total);
  return [col, row];
}
