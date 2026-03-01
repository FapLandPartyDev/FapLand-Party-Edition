export const NODE_MIN_WIDTH = 160;
export const NODE_MIN_HEIGHT = 58;
export const DEFAULT_NODE_WIDTH = 180;
export const DEFAULT_NODE_HEIGHT = 78;
export const MIN_NODE_SCALE = 0.5;
export const MAX_PREVIEW_NODE_SCALE = 3;

type NodeVisualKind =
  | "start"
  | "end"
  | "path"
  | "safePoint"
  | "campfire"
  | "round"
  | "randomRound"
  | "perk"
  | "catapult";

type StyleHintLike = {
  color?: string;
  size?: number;
  width?: number;
  height?: number;
};

type NodeVisualSource = {
  kind: string;
  styleHint?: StyleHintLike;
};

const KIND_COLORS: Record<NodeVisualKind, string> = {
  start: "#a78bfa",
  end: "#f97316",
  path: "#6b7280",
  safePoint: "#22c55e",
  campfire: "#f97316",
  round: "#38bdf8",
  randomRound: "#f59e0b",
  perk: "#ec4899",
  catapult: "#06b6d4",
};

const HEX_COLOR_PATTERN = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

export function getNodeKindColor(kind: string): string {
  return KIND_COLORS[kind as NodeVisualKind] ?? KIND_COLORS.path;
}

export function getNodeDisplayColor(node: NodeVisualSource): string {
  const explicitColor = node.styleHint?.color?.trim();
  return explicitColor && explicitColor.length > 0 ? explicitColor : getNodeKindColor(node.kind);
}

export function getNodeBaseWidth(node: Pick<NodeVisualSource, "styleHint">): number {
  return Math.max(
    NODE_MIN_WIDTH,
    isFiniteNumber(node.styleHint?.width) ? node.styleHint.width : DEFAULT_NODE_WIDTH
  );
}

export function getNodeBaseHeight(node: Pick<NodeVisualSource, "styleHint">): number {
  return Math.max(
    NODE_MIN_HEIGHT,
    isFiniteNumber(node.styleHint?.height) ? node.styleHint.height : DEFAULT_NODE_HEIGHT
  );
}

export function getNodeScale(node: Pick<NodeVisualSource, "styleHint">): number {
  return Math.max(MIN_NODE_SCALE, isFiniteNumber(node.styleHint?.size) ? node.styleHint.size : 1);
}

export function getNodeRenderWidth(node: Pick<NodeVisualSource, "styleHint">): number {
  return getNodeBaseWidth(node) * getNodeScale(node);
}

export function getNodeRenderHeight(node: Pick<NodeVisualSource, "styleHint">): number {
  return getNodeBaseHeight(node) * getNodeScale(node);
}

export function toColorInputValue(color: string | undefined, fallbackColor: string): string {
  const candidate = color?.trim();
  if (candidate && HEX_COLOR_PATTERN.test(candidate)) {
    return candidate.length === 4
      ? `#${candidate[1]}${candidate[1]}${candidate[2]}${candidate[2]}${candidate[3]}${candidate[3]}`
      : candidate;
  }
  return fallbackColor;
}

export function clampPreviewNodeScale(scale: number): number {
  return Math.min(MAX_PREVIEW_NODE_SCALE, Math.max(MIN_NODE_SCALE, scale));
}

export function parseHexColorToNumber(color: string | undefined): number | null {
  const value = color?.trim();
  if (!value || !HEX_COLOR_PATTERN.test(value)) return null;
  const normalized =
    value.length === 4
      ? `${value[1]}${value[1]}${value[2]}${value[2]}${value[3]}${value[3]}`
      : value.slice(1);
  const parsed = Number.parseInt(normalized, 16);
  return Number.isFinite(parsed) ? parsed : null;
}
