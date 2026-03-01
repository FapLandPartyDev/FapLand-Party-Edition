import { collectPlaylistRefs, createPortableRoundRefResolver } from "../game/playlistResolution";
import type {
  InstalledRound,
  InstalledRoundCatalogEntry,
  VideoDownloadProgress,
} from "../services/db";
import type { StoredPlaylist } from "../services/playlists";
import { getRoundDurationSec } from "../utils/duration";

export type RoundLibraryEntry = InstalledRound | InstalledRoundCatalogEntry;
export type TypeFilter = "all" | NonNullable<RoundLibraryEntry["type"]>;
export type ScriptFilter = "all" | "installed" | "missing";
export type SortMode = "newest" | "oldest" | "difficulty" | "bpm" | "length" | "name" | "excluded";

export type IndexedRound = {
  round: RoundLibraryEntry;
  searchText: string;
  roundType: NonNullable<RoundLibraryEntry["type"]>;
  hasScript: boolean;
  createdAtMs: number;
  difficultyValue: number;
  bpmValue: number;
  lengthSec: number;
};

export type PlaylistMembership = {
  playlistId: string;
  playlistName: string;
};

export type SourceHeroOption = {
  heroId: string;
  heroName: string;
  rounds: RoundLibraryEntry[];
};

export type PlaylistGroupingData = {
  playlistsByRoundId: Map<string, PlaylistMembership[]>;
};

const roundNameCollator = new Intl.Collator();

function resourceHasFunscript(
  resource: RoundLibraryEntry["resources"][number] | undefined
): boolean {
  if (!resource) return false;
  if ("funscriptUri" in resource && Boolean(resource.funscriptUri)) return true;
  return "hasFunscript" in resource && resource.hasFunscript === true;
}

export function toIndexedRound(round: RoundLibraryEntry): IndexedRound {
  return {
    round,
    searchText: [round.name, round.author ?? "", round.hero?.name ?? "", round.description ?? ""]
      .join("\n")
      .toLowerCase(),
    roundType: round.type ?? "Normal",
    hasScript: resourceHasFunscript(round.resources[0]),
    createdAtMs: Date.parse(String(round.createdAt)) || 0,
    difficultyValue: round.difficulty ?? 0,
    bpmValue: round.bpm ?? 0,
    lengthSec: getRoundDurationSec(round),
  };
}

export function buildDownloadProgressByUri(
  downloadProgresses: VideoDownloadProgress[]
): Map<string, VideoDownloadProgress> {
  const map = new Map<string, VideoDownloadProgress>();
  for (const progress of downloadProgresses) {
    map.set(progress.url, progress);
  }
  return map;
}

export function buildAggregateDownloadProgress(downloadProgresses: VideoDownloadProgress[]) {
  if (downloadProgresses.length === 0) return null;

  const totalPercent = downloadProgresses.reduce((sum, progress) => sum + progress.percent, 0);
  const totalDownloaded = downloadProgresses.reduce(
    (sum, progress) => sum + (progress.downloadedBytes ?? 0),
    0
  );
  const totalSize = downloadProgresses.reduce(
    (sum, progress) => sum + (progress.totalBytes ?? 0),
    0
  );

  return {
    count: downloadProgresses.length,
    avgPercent: Math.round(totalPercent / downloadProgresses.length),
    totalDownloaded,
    totalSize,
  };
}

export function filterAndSortRounds({
  indexedRounds,
  query,
  typeFilter,
  scriptFilter,
  sortMode,
}: {
  indexedRounds: IndexedRound[];
  query: string;
  typeFilter: TypeFilter;
  scriptFilter: ScriptFilter;
  sortMode: SortMode;
}): RoundLibraryEntry[] {
  const normalizedQuery = query.trim().toLowerCase();
  const filtered =
    normalizedQuery.length === 0 && typeFilter === "all" && scriptFilter === "all"
      ? [...indexedRounds]
      : indexedRounds.filter((entry) => {
          if (typeFilter !== "all" && entry.roundType !== typeFilter) {
            return false;
          }
          if (scriptFilter !== "all" && entry.hasScript !== (scriptFilter === "installed")) {
            return false;
          }
          return normalizedQuery.length === 0 || entry.searchText.includes(normalizedQuery);
        });

  filtered.sort((left, right) => {
    if (sortMode === "oldest") {
      return left.createdAtMs - right.createdAtMs;
    }
    if (sortMode === "difficulty") {
      return right.difficultyValue - left.difficultyValue;
    }
    if (sortMode === "bpm") {
      return right.bpmValue - left.bpmValue;
    }
    if (sortMode === "length") {
      return right.lengthSec - left.lengthSec;
    }
    if (sortMode === "name") {
      return roundNameCollator.compare(left.round.name, right.round.name);
    }
    if (sortMode === "excluded") {
      const leftExcluded = left.round.excludeFromRandom ? 0 : 1;
      const rightExcluded = right.round.excludeFromRandom ? 0 : 1;
      const diff = leftExcluded - rightExcluded;
      return diff !== 0 ? diff : right.createdAtMs - left.createdAtMs;
    }
    return right.createdAtMs - left.createdAtMs;
  });

  return filtered.map((entry) => entry.round);
}

export function buildPlaylistsByRoundId(
  playlists: StoredPlaylist[],
  rounds: RoundLibraryEntry[]
): Map<string, PlaylistMembership[]> {
  return buildPlaylistGroupingData(playlists, rounds).playlistsByRoundId;
}

export function buildPlaylistGroupingData(
  playlists: StoredPlaylist[],
  rounds: RoundLibraryEntry[]
): PlaylistGroupingData {
  const roundResolver = createPortableRoundRefResolver(rounds);
  const memberships = new Map<string, PlaylistMembership[]>();

  for (const playlist of playlists) {
    const seenRoundIds = new Set<string>();

    for (const entry of collectPlaylistRefs(playlist.config)) {
      const resolved = roundResolver.resolve(entry.ref);
      if (!resolved || seenRoundIds.has(resolved.id)) continue;

      seenRoundIds.add(resolved.id);
      const membership = { playlistId: playlist.id, playlistName: playlist.name };
      const existing = memberships.get(resolved.id);
      if (existing) {
        existing.push(membership);
      } else {
        memberships.set(resolved.id, [membership]);
      }
    }
  }

  return {
    playlistsByRoundId: memberships,
  };
}

export function buildSourceHeroOptions(rounds: RoundLibraryEntry[]): SourceHeroOption[] {
  const groups = new Map<string, SourceHeroOption>();

  for (const round of rounds) {
    if (!round.heroId || !round.hero || round.resources.length === 0) {
      continue;
    }

    const existing = groups.get(round.heroId);
    if (existing) {
      existing.rounds.push(round);
      continue;
    }

    groups.set(round.heroId, {
      heroId: round.heroId,
      heroName: round.hero.name,
      rounds: [round],
    });
  }

  return [...groups.values()].sort((left, right) => left.heroName.localeCompare(right.heroName));
}
