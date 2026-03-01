import type { GraphRoadPalette } from "../game/playlistSchema";

export const CUSTOM_ROAD_PALETTES_KEY = "editor.customRoadPalettes";

export interface CustomRoadPalette {
  id: string;
  name: string;
  palette: GraphRoadPalette;
}

const HEX_COLOR_PATTERN = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const isHexColor = (value: unknown): value is string =>
  typeof value === "string" && HEX_COLOR_PATTERN.test(value.trim());

function isValidGraphRoadPalette(value: unknown): value is GraphRoadPalette {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    isHexColor(candidate.body) &&
    isHexColor(candidate.railA) &&
    isHexColor(candidate.railB) &&
    isHexColor(candidate.glow) &&
    isHexColor(candidate.center) &&
    isHexColor(candidate.gate) &&
    isHexColor(candidate.marker)
  );
}

function isValidCustomRoadPalette(value: unknown): value is CustomRoadPalette {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.id === "string" &&
    candidate.id.trim().length > 0 &&
    typeof candidate.name === "string" &&
    candidate.name.trim().length > 0 &&
    isValidGraphRoadPalette(candidate.palette)
  );
}

export function normalizeCustomPalettes(input: unknown): CustomRoadPalette[] {
  if (!Array.isArray(input)) return [];
  return input.filter(isValidCustomRoadPalette).map((entry) => ({
    id: entry.id.trim(),
    name: entry.name.trim(),
    palette: {
      presetId: typeof entry.palette.presetId === "string" ? entry.palette.presetId : undefined,
      body: entry.palette.body.trim(),
      railA: entry.palette.railA.trim(),
      railB: entry.palette.railB.trim(),
      glow: entry.palette.glow.trim(),
      center: entry.palette.center.trim(),
      gate: entry.palette.gate.trim(),
      marker: entry.palette.marker.trim(),
    },
  }));
}
