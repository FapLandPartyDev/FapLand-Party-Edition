import type { StoredPlaylist } from "../../services/playlists";

export type PlaylistBoardMode = "linear" | "endless" | "graph";

export type PlaylistSortKey = "name-asc" | "name-desc" | "updated-desc" | "mode";

export type PlaylistModeFilter = "all" | PlaylistBoardMode;

const ROUND_NODE_KINDS = new Set(["round", "randomRound"]);

const MODE_ORDER: Record<PlaylistBoardMode, number> = {
  linear: 0,
  graph: 1,
  endless: 2,
};

const nameCollator = new Intl.Collator(undefined, {
  sensitivity: "base",
  numeric: true,
});

/**
 * Returns the board mode for a stored playlist. Falls back to "linear" when the
 * config shape is unexpected so the UI never crashes on malformed data.
 */
export function getPlaylistBoardMode(playlist: StoredPlaylist): PlaylistBoardMode {
  const mode = playlist.config?.boardConfig?.mode;
  if (mode === "graph" || mode === "endless" || mode === "linear") {
    return mode;
  }
  return "linear";
}

/**
 * Best-effort count of playable rounds/nodes for display on a picker card.
 * Returns 0 when the board config does not expose a meaningful count.
 */
export function getPlaylistRoundCount(playlist: StoredPlaylist): number {
  const boardConfig = playlist.config?.boardConfig;
  if (!boardConfig || typeof boardConfig !== "object") return 0;

  switch (getPlaylistBoardMode(playlist)) {
    case "linear": {
      const order = (boardConfig as { normalRoundOrder?: unknown[] }).normalRoundOrder;
      return Array.isArray(order) ? order.length : 0;
    }
    case "graph": {
      const nodes = (boardConfig as { nodes?: Array<{ kind?: string }> }).nodes;
      if (!Array.isArray(nodes)) return 0;
      return nodes.reduce<number>((total, node) => {
        if (node && typeof node.kind === "string" && ROUND_NODE_KINDS.has(node.kind)) {
          return total + 1;
        }
        return total;
      }, 0);
    }
    case "endless": {
      const batchSize = (boardConfig as { initialBatchSize?: unknown }).initialBatchSize;
      return typeof batchSize === "number" && Number.isFinite(batchSize)
        ? Math.max(0, Math.floor(batchSize))
        : 0;
    }
    default:
      return 0;
  }
}

/**
 * Returns a sortable timestamp (ms since epoch) for a playlist's last update.
 * StoredPlaylist.updatedAt is a Date, but loaders/mocks may hand us strings or
 * numbers, so we coerce defensively.
 */
export function getPlaylistUpdatedMs(playlist: StoredPlaylist): number {
  const updatedAt = (playlist as { updatedAt?: unknown }).updatedAt;
  if (updatedAt instanceof Date) return updatedAt.getTime();
  if (typeof updatedAt === "number") return updatedAt;
  if (typeof updatedAt === "string") {
    const parsed = Date.parse(updatedAt);
    if (Number.isFinite(parsed)) return parsed;
  }
  const createdAt = (playlist as { createdAt?: unknown }).createdAt;
  if (createdAt instanceof Date) return createdAt.getTime();
  if (typeof createdAt === "number") return createdAt;
  if (typeof createdAt === "string") {
    const parsed = Date.parse(createdAt);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

/**
 * Splits a timestamp into a coarse relative bucket plus a numeric value. The
 * component renders the bucket via i18n; this function stays pure so it can be
 * unit tested without a locale.
 */
export function describeRelativeTime(
  updatedMs: number,
  now: number = Date.now()
): { key: "just-now" | "minutes" | "hours" | "days" | "date"; value: number } {
  if (!Number.isFinite(updatedMs) || updatedMs <= 0 || updatedMs > now) {
    return { key: "just-now", value: 0 };
  }
  const diffMs = now - updatedMs;
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return { key: "just-now", value: 0 };
  if (minutes < 60) return { key: "minutes", value: minutes };
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return { key: "hours", value: hours };
  const days = Math.floor(hours / 24);
  if (days < 30) return { key: "days", value: days };
  return { key: "date", value: updatedMs };
}

/**
 * Case-insensitive search over a playlist's name and description. An empty
 * query matches everything.
 */
export function playlistMatchesQuery(playlist: StoredPlaylist, normalizedQuery: string): boolean {
  if (normalizedQuery.length === 0) return true;
  const name = (playlist.name ?? "").toLowerCase();
  if (name.includes(normalizedQuery)) return true;
  const description = (playlist.description ?? "").toLowerCase();
  return description.includes(normalizedQuery);
}

export function normalizeSearchQuery(query: string): string {
  return query.trim().toLowerCase();
}

export function filterPlaylists(
  playlists: ReadonlyArray<StoredPlaylist>,
  modeFilter: PlaylistModeFilter,
  normalizedQuery: string
): StoredPlaylist[] {
  return playlists.filter((playlist) => {
    if (modeFilter !== "all" && getPlaylistBoardMode(playlist) !== modeFilter) {
      return false;
    }
    return playlistMatchesQuery(playlist, normalizedQuery);
  });
}

export function sortPlaylists(
  playlists: ReadonlyArray<StoredPlaylist>,
  sortKey: PlaylistSortKey,
  activePlaylistId: string
): StoredPlaylist[] {
  const next = [...playlists];
  next.sort((a, b) => {
    const aActive = a.id === activePlaylistId;
    const bActive = b.id === activePlaylistId;
    if (aActive !== bActive) return aActive ? -1 : 1;

    switch (sortKey) {
      case "name-desc":
        return nameCollator.compare(b.name, a.name);
      case "updated-desc":
        return getPlaylistUpdatedMs(b) - getPlaylistUpdatedMs(a);
      case "mode": {
        const modeDiff = MODE_ORDER[getPlaylistBoardMode(a)] - MODE_ORDER[getPlaylistBoardMode(b)];
        if (modeDiff !== 0) return modeDiff;
        return nameCollator.compare(a.name, b.name);
      }
      case "name-asc":
      default:
        return nameCollator.compare(a.name, b.name);
    }
  });
  return next;
}

export function getVisiblePlaylists(
  playlists: ReadonlyArray<StoredPlaylist>,
  modeFilter: PlaylistModeFilter,
  normalizedQuery: string,
  sortKey: PlaylistSortKey,
  activePlaylistId: string
): StoredPlaylist[] {
  const filtered = filterPlaylists(playlists, modeFilter, normalizedQuery);
  return sortPlaylists(filtered, sortKey, activePlaylistId);
}
