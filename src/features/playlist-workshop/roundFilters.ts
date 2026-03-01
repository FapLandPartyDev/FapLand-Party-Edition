import type { InstalledRound, InstalledRoundCatalogEntry } from "../../services/db";
import { getRoundDurationSec } from "../../utils/duration";

export type WorkshopFilterRound = InstalledRound | InstalledRoundCatalogEntry;
export type WorkshopRoundType = "Normal" | "Interjection" | "Cum";
export type WorkshopRoundSource = "local" | "web" | "stash";
export type WorkshopDurationFilter = "any" | "short" | "medium" | "long" | "unknown";
export type WorkshopScriptFilter = "any" | "installed" | "missing";
export type WorkshopHeroFilter = "any" | "hero" | "standalone";
export type WorkshopRandomEligibilityFilter = "any" | "eligible" | "excluded";
export type WorkshopDifficultyFilter = 1 | 2 | 3 | 4 | 5 | "unknown";
export type WorkshopRoundSort =
  | "name-asc"
  | "name-desc"
  | "author"
  | "difficulty-asc"
  | "difficulty-desc"
  | "duration-asc"
  | "duration-desc"
  | "bpm-asc"
  | "bpm-desc"
  | "newest"
  | "oldest";

export type WorkshopAddedDateFilter =
  | { mode: "any" }
  | { mode: "since"; fromDate: string }
  | { mode: "before"; toDate: string }
  | { mode: "between"; fromDate: string; toDate: string };

export type WorkshopRoundFilters = {
  includedTypes: WorkshopRoundType[];
  difficulties: WorkshopDifficultyFilter[];
  duration: WorkshopDurationFilter;
  bpmMin: string;
  bpmMax: string;
  includeUnknownBpm: boolean;
  sources: WorkshopRoundSource[];
  script: WorkshopScriptFilter;
  heroStatus: WorkshopHeroFilter;
  randomEligibility: WorkshopRandomEligibilityFilter;
  addedDate: WorkshopAddedDateFilter;
  heroIds: string[];
  tags: string[];
  authors: string[];
  libraryLabels: string[];
};

export type WorkshopRoundMetadataOptions = {
  heroes: Array<{ id: string; name: string }>;
  tags: string[];
  authors: string[];
  libraryLabels: string[];
};

const ALL_TYPES: WorkshopRoundType[] = ["Normal", "Interjection", "Cum"];
const ALL_DIFFICULTIES: WorkshopDifficultyFilter[] = [1, 2, 3, 4, 5, "unknown"];
const ALL_SOURCES: WorkshopRoundSource[] = ["local", "web", "stash"];
const collator = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });

function getWorkshopRoundSource(round: WorkshopFilterRound): WorkshopRoundSource {
  if (round.installSourceKey?.startsWith("stash:")) return "stash";
  if (round.installSourceKey?.startsWith("website:")) return "web";
  return "local";
}

export function createDefaultWorkshopRoundFilters(): WorkshopRoundFilters {
  return {
    includedTypes: ["Normal"],
    difficulties: [...ALL_DIFFICULTIES],
    duration: "any",
    bpmMin: "",
    bpmMax: "",
    includeUnknownBpm: true,
    sources: [...ALL_SOURCES],
    script: "any",
    heroStatus: "any",
    randomEligibility: "any",
    addedDate: { mode: "any" },
    heroIds: [],
    tags: [],
    authors: [],
    libraryLabels: [],
  };
}

export function createInclusiveWorkshopRoundFilters(): WorkshopRoundFilters {
  return {
    ...createDefaultWorkshopRoundFilters(),
    includedTypes: [...ALL_TYPES],
  };
}

export function workshopRoundHasPrimaryFunscript(round: WorkshopFilterRound): boolean {
  const resource = round.resources[0];
  if (!resource) return false;
  if ("funscriptUri" in resource && Boolean(resource.funscriptUri)) return true;
  return "hasFunscript" in resource && resource.hasFunscript === true;
}

function normalizedRoundAuthor(round: WorkshopFilterRound): string {
  return (round.author ?? round.hero?.author ?? "").trim();
}

export function extractWorkshopRoundMetadataOptions(
  rounds: WorkshopFilterRound[]
): WorkshopRoundMetadataOptions {
  const heroes = new Map<string, string>();
  const tags = new Map<string, string>();
  const authors = new Map<string, string>();
  const libraryLabels = new Map<string, string>();

  for (const round of rounds) {
    if (round.heroId && round.hero?.name) heroes.set(round.heroId, round.hero.name);
    for (const tag of [...(round.tags ?? []), ...(round.hero?.tags ?? [])]) {
      const trimmed = tag.trim();
      if (trimmed) tags.set(trimmed.toLocaleLowerCase(), trimmed);
    }
    const author = normalizedRoundAuthor(round);
    if (author) authors.set(author.toLocaleLowerCase(), author);
    const libraryLabel = (round.libraryLabel ?? "").trim();
    if (libraryLabel) libraryLabels.set(libraryLabel.toLocaleLowerCase(), libraryLabel);
  }

  return {
    heroes: [...heroes]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => collator.compare(a.name, b.name)),
    tags: [...tags.values()].sort(collator.compare),
    authors: [...authors.values()].sort(collator.compare),
    libraryLabels: [...libraryLabels.values()].sort(collator.compare),
  };
}

function parseLocalDateStart(value: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
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

function matchesAddedDate(createdAt: Date | string | undefined, filter: WorkshopAddedDateFilter) {
  if (filter.mode === "any") return true;
  const createdAtMs = Date.parse(String(createdAt ?? ""));
  if (!Number.isFinite(createdAtMs)) return true;
  if (filter.mode === "since") {
    const from = parseLocalDateStart(filter.fromDate);
    return from === null || createdAtMs >= from;
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
  return (
    createdAtMs >= Math.min(firstStart, secondStart) && createdAtMs <= Math.max(firstEnd, secondEnd)
  );
}

function matchesDuration(round: WorkshopFilterRound, filter: WorkshopDurationFilter): boolean {
  if (filter === "any") return true;
  const duration = getRoundDurationSec(round);
  if (duration <= 0) return filter === "unknown";
  if (filter === "unknown") return false;
  if (filter === "short") return duration < 180;
  if (filter === "medium") return duration >= 180 && duration <= 600;
  return duration > 600;
}

function parseOptionalNumber(value: string): number | null {
  if (!value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizedSet(values: string[]): Set<string> {
  return new Set(values.map((value) => value.toLocaleLowerCase()));
}

export function filterWorkshopRounds({
  rounds,
  query,
  filters,
}: {
  rounds: WorkshopFilterRound[];
  query: string;
  filters: WorkshopRoundFilters;
}): WorkshopFilterRound[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const includedTypes = new Set(filters.includedTypes);
  const difficulties = new Set(filters.difficulties);
  const sources = new Set(filters.sources);
  const heroIds = new Set(filters.heroIds);
  const tags = normalizedSet(filters.tags);
  const authors = normalizedSet(filters.authors);
  const libraryLabels = normalizedSet(filters.libraryLabels);
  const bpmMin = parseOptionalNumber(filters.bpmMin);
  const bpmMax = parseOptionalNumber(filters.bpmMax);
  const hasBpmBounds = bpmMin !== null || bpmMax !== null;

  return rounds.filter((round) => {
    const type = round.type ?? "Normal";
    if (!includedTypes.has(type)) return false;
    const difficulty = round.difficulty;
    if (
      !difficulties.has(
        difficulty === null || difficulty === undefined
          ? "unknown"
          : (difficulty as WorkshopDifficultyFilter)
      )
    ) {
      return false;
    }
    if (!matchesDuration(round, filters.duration)) return false;
    if (!sources.has(getWorkshopRoundSource(round))) return false;
    const hasScript = workshopRoundHasPrimaryFunscript(round);
    if (filters.script === "installed" && !hasScript) return false;
    if (filters.script === "missing" && hasScript) return false;
    if (filters.heroStatus === "hero" && !round.heroId) return false;
    if (filters.heroStatus === "standalone" && round.heroId) return false;
    if (filters.randomEligibility === "eligible" && round.excludeFromRandom) return false;
    if (filters.randomEligibility === "excluded" && !round.excludeFromRandom) return false;
    if (!matchesAddedDate(round.createdAt, filters.addedDate)) return false;

    if (hasBpmBounds) {
      if (round.bpm === null || round.bpm === undefined) {
        if (!filters.includeUnknownBpm) return false;
      } else {
        if (bpmMin !== null && round.bpm < bpmMin) return false;
        if (bpmMax !== null && round.bpm > bpmMax) return false;
      }
    }

    if (heroIds.size > 0 && (!round.heroId || !heroIds.has(round.heroId))) return false;
    const roundTags = normalizedSet([...(round.tags ?? []), ...(round.hero?.tags ?? [])]);
    if (tags.size > 0 && ![...tags].some((tag) => roundTags.has(tag))) return false;
    if (authors.size > 0 && !authors.has(normalizedRoundAuthor(round).toLocaleLowerCase())) {
      return false;
    }
    if (
      libraryLabels.size > 0 &&
      !libraryLabels.has((round.libraryLabel ?? "").trim().toLocaleLowerCase())
    ) {
      return false;
    }

    if (!normalizedQuery) return true;
    return [
      round.name,
      round.description ?? "",
      round.author ?? "",
      round.hero?.author ?? "",
      round.hero?.name ?? "",
      ...(round.tags ?? []),
      ...(round.hero?.tags ?? []),
      round.libraryLabel ?? "",
      type,
    ]
      .join("\n")
      .toLocaleLowerCase()
      .includes(normalizedQuery);
  });
}

function compareKnownNumbers(
  left: number | null | undefined,
  right: number | null | undefined,
  direction: 1 | -1
): number {
  const leftKnown = typeof left === "number" && Number.isFinite(left);
  const rightKnown = typeof right === "number" && Number.isFinite(right);
  if (leftKnown !== rightKnown) return leftKnown ? -1 : 1;
  if (!leftKnown || !rightKnown) return 0;
  return (left - right) * direction;
}

export function sortWorkshopRounds(
  rounds: WorkshopFilterRound[],
  sort: WorkshopRoundSort
): WorkshopFilterRound[] {
  const byName = (left: WorkshopFilterRound, right: WorkshopFilterRound) =>
    collator.compare(left.name, right.name);
  return [...rounds].sort((left, right) => {
    let result = 0;
    if (sort === "name-asc") result = byName(left, right);
    else if (sort === "name-desc") result = byName(right, left);
    else if (sort === "author") {
      result = collator.compare(normalizedRoundAuthor(left), normalizedRoundAuthor(right));
    } else if (sort === "difficulty-asc") {
      result = compareKnownNumbers(left.difficulty, right.difficulty, 1);
    } else if (sort === "difficulty-desc") {
      result = compareKnownNumbers(left.difficulty, right.difficulty, -1);
    } else if (sort === "duration-asc") {
      const leftDuration = getRoundDurationSec(left);
      const rightDuration = getRoundDurationSec(right);
      result = compareKnownNumbers(
        leftDuration > 0 ? leftDuration : null,
        rightDuration > 0 ? rightDuration : null,
        1
      );
    } else if (sort === "duration-desc") {
      const leftDuration = getRoundDurationSec(left);
      const rightDuration = getRoundDurationSec(right);
      result = compareKnownNumbers(
        leftDuration > 0 ? leftDuration : null,
        rightDuration > 0 ? rightDuration : null,
        -1
      );
    } else if (sort === "bpm-asc") {
      result = compareKnownNumbers(left.bpm, right.bpm, 1);
    } else if (sort === "bpm-desc") {
      result = compareKnownNumbers(left.bpm, right.bpm, -1);
    } else {
      const leftCreated = Date.parse(String(left.createdAt ?? ""));
      const rightCreated = Date.parse(String(right.createdAt ?? ""));
      result = compareKnownNumbers(
        Number.isFinite(leftCreated) ? leftCreated : null,
        Number.isFinite(rightCreated) ? rightCreated : null,
        sort === "oldest" ? 1 : -1
      );
    }
    return result || byName(left, right);
  });
}

export function filterAndSortWorkshopRounds(input: {
  rounds: WorkshopFilterRound[];
  query: string;
  filters: WorkshopRoundFilters;
  sort: WorkshopRoundSort;
}): WorkshopFilterRound[] {
  return sortWorkshopRounds(filterWorkshopRounds(input), input.sort);
}

export function countActiveWorkshopRoundFilters(filters: WorkshopRoundFilters): number {
  let count = ALL_TYPES.filter((type) => !filters.includedTypes.includes(type)).length;
  count += ALL_DIFFICULTIES.filter(
    (difficulty) => !filters.difficulties.includes(difficulty)
  ).length;
  count += filters.duration === "any" ? 0 : 1;
  count += filters.bpmMin.trim() || filters.bpmMax.trim() ? 1 : 0;
  count += ALL_SOURCES.filter((source) => !filters.sources.includes(source)).length;
  count += filters.script === "any" ? 0 : 1;
  count += filters.heroStatus === "any" ? 0 : 1;
  count += filters.randomEligibility === "any" ? 0 : 1;
  count += filters.addedDate.mode === "any" ? 0 : 1;
  count += filters.heroIds.length;
  count += filters.tags.length;
  count += filters.authors.length;
  count += filters.libraryLabels.length;
  return count;
}
