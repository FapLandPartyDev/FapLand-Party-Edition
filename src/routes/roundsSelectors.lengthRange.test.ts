import { describe, expect, it } from "vitest";

import { filterAndSortRounds, type IndexedRound, type RoundLibraryEntry } from "./roundsSelectors";

function makeIndexedRound(id: string, lengthSec: number): IndexedRound {
  return {
    round: { id, name: id } as unknown as RoundLibraryEntry,
    searchText: id,
    normalizedTags: [],
    normalizedAuthor: "",
    normalizedLibraryLabel: "",
    roundType: "Normal",
    source: "local",
    hasScript: false,
    createdAtMs: 0,
    difficultyValue: 0,
    bpmValue: 0,
    lengthSec,
  };
}

describe("filterAndSortRounds length range", () => {
  const indexedRounds = [
    makeIndexedRound("short", 60),
    makeIndexedRound("medium", 180),
    makeIndexedRound("long", 600),
  ];

  function filter(minMinutes: string, maxMinutes: string) {
    return filterAndSortRounds({
      indexedRounds,
      query: "",
      typeFilter: "all",
      scriptFilter: "all",
      lengthRangeFilter: { minMinutes, maxMinutes },
      sortMode: "name",
    }).map((round) => round.id);
  }

  it("supports inclusive lower and upper minute bounds", () => {
    expect(filter("3", "10")).toEqual(["long", "medium"]);
  });

  it("supports either open bound and normalizes reversed bounds", () => {
    expect(filter("", "3")).toEqual(["medium", "short"]);
    expect(filter("10", "3")).toEqual(["long", "medium"]);
  });
});
