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
export type MetadataFilter = "all" | string;
export type SourceFilter = "all" | "stash" | "web" | "local";
export type SearchScope = "all" | "heroes" | "rounds";
export type LengthRangeFilter = {
  minMinutes: string;
  maxMinutes: string;
};
export type AddedDateFilter =
  | { mode: "all" }
  | { mode: "since"; fromDate: string }
  | { mode: "before"; toDate: string }
  | { mode: "between"; fromDate: string; toDate: string };

export type IndexedRound = {
  round: RoundLibraryEntry;
  searchText: string;
  heroSearchText: string;
  roundSearchText: string;
  normalizedTags: string[];
  normalizedAuthor: string;
  normalizedLibraryLabel: string;
  roundType: NonNullable<RoundLibraryEntry["type"]>;
  source: Exclude<SourceFilter, "all">;
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

export type RoundLibraryIndex = {
  indexedRounds: IndexedRound[];
  metadataOptions: {
    tags: string[];
    authorNames: string[];
    libraryLabels: string[];
  };
  standaloneRoundCount: number;
  heroGroupCount: number;
  roundsWithScriptCount: number;
  sourceHeroOptions: SourceHeroOption[];
};

const roundNameCollator = new Intl.Collator();

function resourceHasFunscript(
  resource: RoundLibraryEntry["resources"][number] | undefined
): boolean {
  if (!resource) return false;
  if ("funscriptUri" in resource && Boolean(resource.funscriptUri)) return true;
  return "hasFunscript" in resource && resource.hasFunscript === true;
}

export function getRoundSource(
  round: Pick<RoundLibraryEntry, "installSourceKey">
): Exclude<SourceFilter, "all"> {
  if (round.installSourceKey?.startsWith("stash:")) {
    return "stash";
  }
  if (round.installSourceKey?.startsWith("website:")) {
    return "web";
  }
  return "local";
}

function parseLocalDateStart(value: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day, 0, 0, 0, 0);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return null;
  }
  return date.getTime();
}

function parseLocalDateEnd(value: string): number | null {
  const start = parseLocalDateStart(value);
  if (start === null) return null;
  const date = new Date(start);
  date.setHours(23, 59, 59, 999);
  return date.getTime();
}

function isWithinAddedDateFilter(
  createdAtMs: number,
  filter: AddedDateFilter | undefined
): boolean {
  if (!filter || filter.mode === "all" || createdAtMs <= 0) {
    return true;
  }
  if (filter.mode === "since") {
    const from = parseLocalDateStart(filter.fromDate);
    return from === null || (createdAtMs >= from && createdAtMs <= Date.now());
  }
  if (filter.mode === "before") {
    const to = parseLocalDateEnd(filter.toDate);
    return to === null || createdAtMs <= to;
  }

  const firstStart = parseLocalDateStart(filter.fromDate);
  const firstEnd = parseLocalDateEnd(filter.fromDate);
  const secondStart = parseLocalDateStart(filter.toDate);
  const secondEnd = parseLocalDateEnd(filter.toDate);
  if (firstStart === null || firstEnd === null || secondStart === null || secondEnd === null) {
    return true;
  }
  const from = Math.min(firstStart, secondStart);
  const to = Math.max(firstEnd, secondEnd);
  return createdAtMs >= from && createdAtMs <= to;
}

function parseLengthMinutes(value: string | undefined): number | null {
  if (!value?.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function isWithinLengthRange(lengthSec: number, filter: LengthRangeFilter | undefined): boolean {
  if (!filter) return true;
  const first = parseLengthMinutes(filter.minMinutes);
  const second = parseLengthMinutes(filter.maxMinutes);
  const minMinutes = first !== null && second !== null ? Math.min(first, second) : first;
  const maxMinutes = first !== null && second !== null ? Math.max(first, second) : second;
  if (minMinutes !== null && lengthSec < minMinutes * 60) return false;
  if (maxMinutes !== null && lengthSec > maxMinutes * 60) return false;
  return true;
}

export function toIndexedRound(round: RoundLibraryEntry): IndexedRound {
  const normalizedTags = [
    ...(round.tags ?? []).map((tag) => tag.toLowerCase()),
    ...((round.hero?.tags ?? []).map((tag) => tag.toLowerCase()) ?? []),
  ];
  const roundSearchText = [
    round.name,
    round.author ?? "",
    ...(round.tags ?? []),
    round.libraryLabel ?? "",
    round.description ?? "",
  ]
    .join("\n")
    .toLowerCase();
  const heroSearchText = round.hero
    ? [
        round.hero.name,
        round.hero.author ?? "",
        ...(round.hero.tags ?? []),
        round.hero.description ?? "",
      ]
        .join("\n")
        .toLowerCase()
    : "";
  return {
    round,
    searchText: `${roundSearchText}\n${heroSearchText}`,
    heroSearchText,
    roundSearchText,
    normalizedTags,
    normalizedAuthor: (round.author ?? round.hero?.author ?? "").toLowerCase(),
    normalizedLibraryLabel: (round.libraryLabel ?? "").toLowerCase(),
    roundType: round.type ?? "Normal",
    source: getRoundSource(round),
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

export function getWebsiteVideoTargetFromPlaybackUri(uri: string): string | null {
  if (uri.startsWith("http://") || uri.startsWith("https://")) {
    try {
      return new URL(uri).toString();
    } catch {
      return null;
    }
  }

  if (!uri.startsWith("app://external/web-url?")) return null;
  try {
    const target = new URL(uri).searchParams.get("target");
    if (!target || !(target.startsWith("http://") || target.startsWith("https://"))) return null;
    return new URL(target).toString();
  } catch {
    return null;
  }
}

export function getDownloadProgressForPlaybackUri(
  downloadProgressByUri: ReadonlyMap<string, VideoDownloadProgress>,
  uri: string | null | undefined
): VideoDownloadProgress | null {
  if (!uri) return null;
  const targetUrl = getWebsiteVideoTargetFromPlaybackUri(uri);
  return targetUrl ? (downloadProgressByUri.get(targetUrl) ?? null) : null;
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
  searchScope = "all",
  typeFilter,
  scriptFilter,
  tagFilter,
  actorFilter,
  libraryFilter,
  sourceFilter,
  addedDateFilter,
  lengthRangeFilter,
  sortMode,
}: {
  indexedRounds: IndexedRound[];
  query: string;
  searchScope?: SearchScope;
  typeFilter: TypeFilter;
  scriptFilter: ScriptFilter;
  tagFilter?: MetadataFilter;
  actorFilter?: MetadataFilter;
  libraryFilter?: MetadataFilter;
  sourceFilter?: SourceFilter;
  addedDateFilter?: AddedDateFilter;
  lengthRangeFilter?: LengthRangeFilter;
  sortMode: SortMode;
}): RoundLibraryEntry[] {
  const normalizedQuery = query.trim().toLowerCase();
  const normalizedTag = tagFilter && tagFilter !== "all" ? tagFilter.trim().toLowerCase() : "";
  const normalizedActor =
    actorFilter && actorFilter !== "all" ? actorFilter.trim().toLowerCase() : "";
  const normalizedLibrary =
    libraryFilter && libraryFilter !== "all" ? libraryFilter.trim().toLowerCase() : "";
  const filtered =
    normalizedQuery.length === 0 &&
    searchScope === "all" &&
    typeFilter === "all" &&
    scriptFilter === "all" &&
    (!sourceFilter || sourceFilter === "all") &&
    (!addedDateFilter || addedDateFilter.mode === "all") &&
    !lengthRangeFilter?.minMinutes.trim() &&
    !lengthRangeFilter?.maxMinutes.trim() &&
    !normalizedTag &&
    !normalizedActor &&
    !normalizedLibrary
      ? [...indexedRounds]
      : indexedRounds.filter((entry) => {
          if (searchScope === "heroes" && !entry.round.hero) {
            return false;
          }
          if (searchScope === "rounds" && entry.round.hero) {
            return false;
          }
          if (typeFilter !== "all" && entry.roundType !== typeFilter) {
            return false;
          }
          if (scriptFilter !== "all" && entry.hasScript !== (scriptFilter === "installed")) {
            return false;
          }
          if (sourceFilter && sourceFilter !== "all" && entry.source !== sourceFilter) {
            return false;
          }
          if (!isWithinAddedDateFilter(entry.createdAtMs, addedDateFilter)) {
            return false;
          }
          if (!isWithinLengthRange(entry.lengthSec, lengthRangeFilter)) {
            return false;
          }
          if (normalizedTag) {
            if (!entry.normalizedTags.includes(normalizedTag)) return false;
          }
          if (normalizedActor) {
            if (entry.normalizedAuthor !== normalizedActor) return false;
          }
          if (normalizedLibrary) {
            if (entry.normalizedLibraryLabel !== normalizedLibrary) return false;
          }
          const scopedSearchText =
            searchScope === "heroes"
              ? entry.heroSearchText
              : searchScope === "rounds"
                ? entry.roundSearchText
                : entry.searchText;
          return normalizedQuery.length === 0 || scopedSearchText.includes(normalizedQuery);
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

export function extractRoundMetadataOptions(rounds: RoundLibraryEntry[]): {
  tags: string[];
  authorNames: string[];
  libraryLabels: string[];
} {
  const tags = new Set<string>();
  const authorNames = new Set<string>();
  const libraryLabels = new Set<string>();
  for (const round of rounds) {
    for (const tag of round.tags ?? []) tags.add(tag);
    for (const tag of round.hero?.tags ?? []) tags.add(tag);
    const authorName = (round.author ?? round.hero?.author ?? "").trim();
    if (authorName) authorNames.add(authorName);
    const libraryLabel = (round.libraryLabel ?? "").trim();
    if (libraryLabel) libraryLabels.add(libraryLabel);
  }
  return {
    tags: [...tags].sort(),
    authorNames: [...authorNames].sort(),
    libraryLabels: [...libraryLabels].sort(),
  };
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

export function buildRoundLibraryIndex(rounds: RoundLibraryEntry[]): RoundLibraryIndex {
  const tags = new Set<string>();
  const authorNames = new Set<string>();
  const libraryLabels = new Set<string>();
  const heroGroupKeys = new Set<string>();
  const sourceHeroGroups = new Map<string, SourceHeroOption>();
  let standaloneRoundCount = 0;
  let roundsWithScriptCount = 0;

  const indexedRounds = rounds.map((round) => {
    for (const tag of round.tags ?? []) tags.add(tag);
    for (const tag of round.hero?.tags ?? []) tags.add(tag);
    const authorName = (round.author ?? round.hero?.author ?? "").trim();
    if (authorName) authorNames.add(authorName);
    const libraryLabel = (round.libraryLabel ?? "").trim();
    if (libraryLabel) libraryLabels.add(libraryLabel);

    if (!round.heroId && !round.hero) {
      standaloneRoundCount += 1;
    } else {
      const heroKey = round.heroId ?? round.hero?.name;
      if (heroKey) heroGroupKeys.add(heroKey);
    }

    if (resourceHasFunscript(round.resources[0])) {
      roundsWithScriptCount += 1;
    }

    if (round.heroId && round.hero && round.resources.length > 0) {
      const existing = sourceHeroGroups.get(round.heroId);
      if (existing) {
        existing.rounds.push(round);
      } else {
        sourceHeroGroups.set(round.heroId, {
          heroId: round.heroId,
          heroName: round.hero.name,
          rounds: [round],
        });
      }
    }

    return toIndexedRound(round);
  });

  return {
    indexedRounds,
    metadataOptions: {
      tags: [...tags].sort(),
      authorNames: [...authorNames].sort(),
      libraryLabels: [...libraryLabels].sort(),
    },
    standaloneRoundCount,
    heroGroupCount: heroGroupKeys.size,
    roundsWithScriptCount,
    sourceHeroOptions: [...sourceHeroGroups.values()].sort((left, right) =>
      left.heroName.localeCompare(right.heroName)
    ),
  };
}
