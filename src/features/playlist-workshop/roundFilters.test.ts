import { describe, expect, it } from "vitest";
import {
  countActiveWorkshopRoundFilters,
  createDefaultWorkshopRoundFilters,
  createInclusiveWorkshopRoundFilters,
  extractWorkshopRoundMetadataOptions,
  filterAndSortWorkshopRounds,
  filterWorkshopRounds,
  sortWorkshopRounds,
  workshopRoundHasPrimaryFunscript,
  type WorkshopFilterRound,
  type WorkshopRoundFilters,
} from "./roundFilters";

function makeRound(id: string, overrides: Record<string, unknown> = {}): WorkshopFilterRound {
  return {
    id,
    name: id,
    author: "Author",
    description: null,
    tags: [],
    bpm: null,
    difficulty: null,
    phash: null,
    startTime: 0,
    endTime: 180_000,
    createdAt: new Date("2026-01-15T12:00:00Z"),
    updatedAt: new Date("2026-01-15T12:00:00Z"),
    type: "Normal",
    installSourceKey: null,
    libraryLabel: null,
    heroId: null,
    excludeFromRandom: false,
    hero: null,
    isDisabled: false,
    resources: [],
    ...overrides,
  } as WorkshopFilterRound;
}

describe("Playlist Workshop round filters", () => {
  it("uses a Normal-only default and an all-type inclusive state", () => {
    const rounds = [
      makeRound("normal"),
      makeRound("cum", { type: "Cum" }),
      makeRound("interjection", { type: "Interjection" }),
    ];

    expect(
      filterWorkshopRounds({
        rounds,
        query: "",
        filters: createDefaultWorkshopRoundFilters(),
      }).map((round) => round.id)
    ).toEqual(["normal"]);
    expect(
      filterWorkshopRounds({
        rounds,
        query: "",
        filters: createInclusiveWorkshopRoundFilters(),
      }).map((round) => round.id)
    ).toEqual(["normal", "cum", "interjection"]);
    expect(countActiveWorkshopRoundFilters(createDefaultWorkshopRoundFilters())).toBe(2);
    expect(countActiveWorkshopRoundFilters(createInclusiveWorkshopRoundFilters())).toBe(0);
  });

  it("searches catalog and hero metadata case-insensitively", () => {
    const round = makeRound("round", {
      name: "Alpha",
      description: "Special description",
      author: null,
      type: "Cum",
      tags: ["RoundTag"],
      libraryLabel: "Collection A",
      heroId: "hero",
      hero: {
        id: "hero",
        name: "Hero Name",
        author: "Hero Author",
        description: null,
        tags: ["HeroTag"],
      },
    });
    const filters = createInclusiveWorkshopRoundFilters();

    for (const query of [
      "alpha",
      "SPECIAL",
      "hero name",
      "hero author",
      "roundtag",
      "herotag",
      "collection a",
      "cum",
    ]) {
      expect(filterWorkshopRounds({ rounds: [round], query, filters })).toHaveLength(1);
    }
  });

  it("uses OR within metadata categories and AND between categories", () => {
    const rounds = [
      makeRound("one", {
        author: "Alice",
        tags: ["red"],
        libraryLabel: "A",
        heroId: "hero-1",
        hero: { id: "hero-1", name: "One", author: null, description: null, tags: [] },
      }),
      makeRound("two", {
        author: "Bob",
        tags: ["blue"],
        libraryLabel: "A",
        heroId: "hero-2",
        hero: { id: "hero-2", name: "Two", author: null, description: null, tags: [] },
      }),
      makeRound("three", { author: "Alice", tags: ["green"], libraryLabel: "B" }),
    ];
    const filters: WorkshopRoundFilters = {
      ...createDefaultWorkshopRoundFilters(),
      authors: ["Alice", "Bob"],
      tags: ["red", "blue"],
      libraryLabels: ["A"],
    };

    expect(filterWorkshopRounds({ rounds, query: "", filters }).map((round) => round.id)).toEqual([
      "one",
      "two",
    ]);
  });

  it("filters difficulty, duration, BPM, source, script, eligibility, and dates", () => {
    const matching = makeRound("matching", {
      difficulty: 4,
      bpm: 120,
      endTime: 700_000,
      installSourceKey: "website:https://example.com",
      excludeFromRandom: true,
      createdAt: new Date("2026-02-10T12:00:00Z"),
      resources: [
        {
          id: "resource",
          disabled: false,
          phash: null,
          durationMs: null,
          funscriptOffsetMs: null,
          hasFunscript: true,
          invertFunscript: false,
        },
      ] as unknown as WorkshopFilterRound["resources"],
    });
    const filters: WorkshopRoundFilters = {
      ...createDefaultWorkshopRoundFilters(),
      difficulties: [4],
      duration: "long" as const,
      bpmMin: "110",
      bpmMax: "130",
      includeUnknownBpm: false,
      sources: ["web"],
      script: "installed" as const,
      randomEligibility: "excluded" as const,
      addedDate: {
        mode: "between" as const,
        fromDate: "2026-02-28",
        toDate: "2026-02-01",
      },
    };

    expect(filterWorkshopRounds({ rounds: [matching], query: "", filters })).toEqual([matching]);
    expect(
      filterWorkshopRounds({
        rounds: [makeRound("unknown")],
        query: "",
        filters,
      })
    ).toEqual([]);
  });

  it("supports explicitly filtering unknown metadata", () => {
    const unknown = makeRound("unknown", { startTime: null, endTime: null });
    const filters: WorkshopRoundFilters = {
      ...createDefaultWorkshopRoundFilters(),
      difficulties: ["unknown"] as WorkshopRoundFilters["difficulties"],
      duration: "unknown" as const,
      bpmMin: "100",
      includeUnknownBpm: true,
    };
    expect(filterWorkshopRounds({ rounds: [unknown], query: "", filters })).toEqual([unknown]);
    expect(
      filterWorkshopRounds({
        rounds: [unknown],
        query: "",
        filters: { ...filters, includeUnknownBpm: false },
      })
    ).toEqual([]);
  });

  it("filters hero rounds only or standalone rounds only", () => {
    const heroRound = makeRound("hero", {
      heroId: "hero-1",
      hero: { id: "hero-1", name: "Hero", author: null, description: null, tags: [] },
    });
    const standaloneRound = makeRound("standalone");
    const rounds = [heroRound, standaloneRound];
    const inclusive = createInclusiveWorkshopRoundFilters();

    expect(
      filterWorkshopRounds({
        rounds,
        query: "",
        filters: { ...inclusive, heroStatus: "hero" },
      }).map((round) => round.id)
    ).toEqual(["hero"]);
    expect(
      filterWorkshopRounds({
        rounds,
        query: "",
        filters: { ...inclusive, heroStatus: "standalone" },
      }).map((round) => round.id)
    ).toEqual(["standalone"]);
    expect(
      filterWorkshopRounds({
        rounds,
        query: "",
        filters: { ...inclusive, heroStatus: "any" },
      }).map((round) => round.id)
    ).toEqual(["hero", "standalone"]);
    expect(countActiveWorkshopRoundFilters({ ...inclusive, heroStatus: "hero" })).toBe(1);
    expect(countActiveWorkshopRoundFilters({ ...inclusive, heroStatus: "any" })).toBe(0);
  });

  it("extracts unique sorted metadata and detects primary funscripts", () => {
    const round = makeRound("round", {
      author: null,
      tags: ["Zulu"],
      libraryLabel: "Library",
      heroId: "hero",
      hero: {
        id: "hero",
        name: "Hero",
        author: "Alice",
        description: null,
        tags: ["alpha"],
      },
      resources: [
        {
          id: "resource",
          disabled: false,
          phash: null,
          durationMs: null,
          funscriptOffsetMs: null,
          hasFunscript: true,
          invertFunscript: false,
        },
      ] as unknown as WorkshopFilterRound["resources"],
    });

    expect(extractWorkshopRoundMetadataOptions([round])).toEqual({
      heroes: [{ id: "hero", name: "Hero" }],
      tags: ["alpha", "Zulu"],
      authors: ["Alice"],
      libraryLabels: ["Library"],
    });
    expect(workshopRoundHasPrimaryFunscript(round)).toBe(true);
  });

  it("sorts every supported field with unknown numeric values last", () => {
    const alpha = makeRound("alpha", {
      name: "Alpha 2",
      author: "Zulu",
      difficulty: 2,
      bpm: 100,
      endTime: 120_000,
      createdAt: new Date("2026-01-01"),
    });
    const beta = makeRound("beta", {
      name: "Beta",
      author: "Alpha",
      difficulty: 5,
      bpm: 150,
      endTime: 600_000,
      createdAt: new Date("2026-02-01"),
    });
    const unknown = makeRound("unknown", {
      name: "Unknown",
      author: null,
      startTime: null,
      endTime: null,
      createdAt: new Date("invalid"),
    });
    const rounds = [unknown, beta, alpha];

    expect(sortWorkshopRounds(rounds, "name-asc").map((round) => round.id)).toEqual([
      "alpha",
      "beta",
      "unknown",
    ]);
    expect(sortWorkshopRounds(rounds, "name-desc").map((round) => round.id)).toEqual([
      "unknown",
      "beta",
      "alpha",
    ]);
    expect(sortWorkshopRounds(rounds, "author").map((round) => round.id)).toEqual([
      "unknown",
      "beta",
      "alpha",
    ]);
    for (const sort of ["difficulty-asc", "duration-asc", "bpm-asc", "oldest"] as const) {
      expect(sortWorkshopRounds(rounds, sort).at(-1)?.id).toBe("unknown");
    }
    for (const sort of ["difficulty-desc", "duration-desc", "bpm-desc", "newest"] as const) {
      expect(sortWorkshopRounds(rounds, sort).at(-1)?.id).toBe("unknown");
    }
    expect(
      filterAndSortWorkshopRounds({
        rounds,
        query: "beta",
        filters: createDefaultWorkshopRoundFilters(),
        sort: "name-asc",
      }).map((round) => round.id)
    ).toEqual(["beta"]);
  });
});
