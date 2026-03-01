import type { EditorNodeKind } from "./EditorState";

export type TileCategoryKey = "core" | "events" | "utility";

export type TileCatalogTile = {
  id: string;
  kind: string;
  visualId: string;
  label: string;
  description?: string;
  category: string;
  color?: string;
  icon?: string;
  defaultName?: string;
  width?: number;
  height?: number;
  size?: number;
  tags?: string[];
};

export type TileCatalogCategory = {
  id: TileCategoryKey;
  label: string;
};

export type TileCatalogData = {
  version: number;
  categories: TileCatalogCategory[];
  tiles: TileCatalogTile[];
};

export type TileCatalog = {
  version: number;
  categories: TileCatalogCategory[];
  tiles: (TileCatalogTile & { kind: EditorNodeKind })[];
};

const FALLBACK_TILES: TileCatalogTile[] = [
  {
    id: "start-node",
    kind: "start",
    visualId: "start",
    label: "Start",
    description: "Entry point for your map.",
    category: "core",
    color: "#a78bfa",
    defaultName: "Start",
    width: 190,
    height: 84,
    size: 1,
    tags: ["flow", "required", "core"],
  },
  {
    id: "end-node",
    kind: "end",
    visualId: "end",
    label: "End",
    description: "Terminal node that starts the cum phase or finishes the run.",
    category: "core",
    color: "#f97316",
    defaultName: "End",
    width: 190,
    height: 84,
    size: 1,
    tags: ["flow", "required", "terminal", "core"],
  },
  {
    id: "path-node",
    kind: "path",
    visualId: "path",
    label: "Path",
    description: "Simple transitional step.",
    category: "core",
    color: "#94a3b8",
    defaultName: "Path",
    width: 190,
    height: 84,
    size: 1,
    tags: ["flow", "safe", "core"],
  },
  {
    id: "safe-point-node",
    kind: "safePoint",
    visualId: "safe-point",
    label: "Safe Point",
    description: "Checkpoint that can optionally add extra rest time.",
    category: "core",
    color: "#22c55e",
    defaultName: "Safe Point",
    width: 200,
    height: 86,
    size: 1,
    tags: ["checkpoint", "core"],
  },
  {
    id: "campfire-node",
    kind: "campfire",
    visualId: "campfire",
    label: "Campfire",
    description: "Adds extra pause time without acting as a checkpoint.",
    category: "utility",
    color: "#f97316",
    defaultName: "Campfire",
    width: 200,
    height: 86,
    size: 1,
    tags: ["utility", "rest"],
  },
  {
    id: "round-node",
    kind: "round",
    visualId: "round",
    label: "Round",
    description: "Play a fixed round.",
    category: "core",
    color: "#38bdf8",
    defaultName: "Round",
    width: 190,
    height: 84,
    size: 1,
    tags: ["round", "core"],
  },
  {
    id: "random-round-node",
    kind: "randomRound",
    visualId: "random-round",
    label: "Random Round",
    description: "Plays a random installed round.",
    category: "core",
    color: "#eab308",
    defaultName: "Random Round",
    width: 220,
    height: 86,
    size: 1,
    tags: ["random", "core"],
  },
  {
    id: "perk-node",
    kind: "perk",
    visualId: "perk",
    label: "Perk",
    description: "Perk node placeholder.",
    category: "events",
    color: "#ec4899",
    defaultName: "Perk",
    width: 190,
    height: 84,
    size: 1,
    tags: ["event", "core"],
  },
  {
    id: "catapult-node",
    kind: "catapult",
    visualId: "catapult",
    label: "Catapult",
    description: "Launches the player forward by a configurable number of nodes.",
    category: "utility",
    color: "#06b6d4",
    defaultName: "Catapult",
    width: 190,
    height: 84,
    size: 1,
    tags: ["utility", "movement"],
  },
];

const FALLBACK_CATEGORIES: TileCatalogCategory[] = [
  { id: "core", label: "Core" },
  { id: "events", label: "Events" },
  { id: "utility", label: "Utility" },
];

const DEFAULT_CATALOG: TileCatalog = {
  version: 1,
  categories: FALLBACK_CATEGORIES,
  tiles: FALLBACK_TILES.map((tile) => ({
    ...tile,
    kind: normalizeTileKind(tile.kind),
  })),
};

const isCategoryVisible = (categoryId: string): categoryId is TileCategoryKey =>
  categoryId === "core" || categoryId === "events" || categoryId === "utility";

const clampName = (value: string): string => {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : "Node";
};

const parseCategories = (raw: unknown): TileCatalogCategory[] => {
  if (!Array.isArray(raw)) return FALLBACK_CATEGORIES;

  return raw
    .map((entry) => {
      if (typeof entry !== "object" || entry === null) return null;
      const typed = entry as { id?: unknown; label?: unknown };
      const id = String(typed.id ?? "").trim();
      const label = String(typed.label ?? id).trim();
      if (!isCategoryVisible(id) || !label) return null;
      return { id: id as TileCategoryKey, label };
    })
    .filter((entry): entry is TileCatalogCategory => Boolean(entry));
};

const parseColor = (raw: unknown): string | undefined => {
  if (typeof raw !== "string") return undefined;
  const value = raw.trim();
  if (!value) return undefined;
  return value;
};

const parseTile = (raw: unknown): TileCatalogTile | null => {
  if (typeof raw !== "object" || raw === null) return null;
  const candidate = raw as Partial<TileCatalogTile> & { kind?: unknown; id?: unknown };

  const kind = normalizeTileKind(candidate.kind);
  const id = typeof candidate.id === "string" ? candidate.id.trim() : "";
  const visualId = typeof candidate.visualId === "string" ? candidate.visualId.trim() : "";
  const label = clampName(
    typeof candidate.label === "string" ? candidate.label : (candidate.kind?.toString() ?? "Node")
  );
  const category = typeof candidate.category === "string" ? candidate.category.trim() : "";
  const defaultName =
    typeof candidate.defaultName === "string" ? candidate.defaultName.trim() : undefined;

  if (!id || !visualId || !label) return null;

  return {
    id,
    kind: kind,
    visualId,
    label,
    description:
      typeof candidate.description === "string" ? candidate.description.trim() : undefined,
    category: category.length > 0 ? category : "core",
    color: parseColor(candidate.color),
    icon: typeof candidate.icon === "string" ? candidate.icon.trim() : undefined,
    defaultName: defaultName && defaultName.length > 0 ? defaultName : undefined,
    width: Number.isFinite(candidate.width as number)
      ? Math.max(96, Math.floor(candidate.width as number))
      : undefined,
    height: Number.isFinite(candidate.height as number)
      ? Math.max(56, Math.floor(candidate.height as number))
      : undefined,
    size: Number.isFinite(candidate.size as number)
      ? Math.max(0.5, Number(candidate.size))
      : undefined,
    tags: Array.isArray(candidate.tags)
      ? candidate.tags
          .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
          .filter((entry) => entry.length > 0)
      : undefined,
  };
};

export function normalizeTileKind(kind: unknown): EditorNodeKind {
  if (
    kind === "start" ||
    kind === "end" ||
    kind === "path" ||
    kind === "safePoint" ||
    kind === "campfire" ||
    kind === "round" ||
    kind === "randomRound" ||
    kind === "perk" ||
    kind === "catapult"
  ) {
    return kind;
  }
  return "path";
}

export async function loadTileCatalog(): Promise<TileCatalog> {
  try {
    const response = await fetch("/editor-tile-catalog.json");
    if (!response.ok) {
      return DEFAULT_CATALOG;
    }

    const payload = (await response.json()) as {
      version?: unknown;
      categories?: unknown;
      tiles?: unknown;
    };

    if (!payload || typeof payload !== "object") {
      return DEFAULT_CATALOG;
    }

    const versionValue = Number(payload.version);
    const categories = parseCategories(payload.categories);
    const categoryIds = new Set(categories.map((category) => category.id));

    const tiles: (TileCatalogTile & { kind: EditorNodeKind })[] = Array.isArray(payload.tiles)
      ? payload.tiles
          .map(parseTile)
          .filter((tile): tile is TileCatalogTile => Boolean(tile))
          .filter((tile) => tile.id.length > 0)
          .map((tile) => ({
            ...tile,
            kind: normalizeTileKind(tile.kind),
            category: categoryIds.has(tile.category as TileCategoryKey) ? tile.category : "utility",
          }))
      : [];

    const fallbackByCategory =
      tiles.length > 0 ? new Map(tiles.map((tile) => [tile.id, tile])) : new Map();
    const fallbackMissing: (TileCatalogTile & { kind: EditorNodeKind })[] = FALLBACK_TILES.filter(
      (tile) => !fallbackByCategory.has(tile.id)
    ).map((tile) => ({
      ...tile,
      category: "utility",
      kind: normalizeTileKind(tile.kind),
    }));

    const mergedTiles: (TileCatalogTile & { kind: EditorNodeKind })[] = [
      ...tiles,
      ...fallbackMissing,
    ];
    return {
      version:
        Number.isFinite(versionValue) && versionValue > 0
          ? Math.floor(versionValue)
          : DEFAULT_CATALOG.version,
      categories: categories.length > 0 ? categories : FALLBACK_CATEGORIES,
      tiles: mergedTiles,
    };
  } catch (error) {
    console.warn("Failed to load editor tile catalog", error);
    return DEFAULT_CATALOG;
  }
}
