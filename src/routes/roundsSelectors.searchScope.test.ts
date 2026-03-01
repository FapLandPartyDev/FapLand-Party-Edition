import { describe, expect, it } from "vitest";

import { filterAndSortRounds, toIndexedRound, type RoundLibraryEntry } from "./roundsSelectors";

const rounds = [
  {
    id: "hero-round",
    name: "Moonlit scene",
    hero: { id: "hero", name: "Alice", tags: ["warrior"], author: "Hero Artist" },
    tags: ["outdoors"],
    resources: [],
  },
  {
    id: "standalone",
    name: "Alice solo round",
    tags: [],
    resources: [],
  },
] as unknown as RoundLibraryEntry[];

function search(query: string, searchScope: "all" | "heroes" | "rounds") {
  return filterAndSortRounds({
    indexedRounds: rounds.map(toIndexedRound),
    query,
    searchScope,
    typeFilter: "all",
    scriptFilter: "all",
    sortMode: "name",
  }).map((round) => round.id);
}

describe("filterAndSortRounds search scope", () => {
  it("searches hero metadata only when scoped to heroes", () => {
    expect(search("alice", "heroes")).toEqual(["hero-round"]);
    expect(search("warrior", "heroes")).toEqual(["hero-round"]);
    expect(search("moonlit", "heroes")).toEqual([]);
  });

  it("searches round metadata only when scoped to rounds", () => {
    expect(search("alice", "rounds")).toEqual(["standalone"]);
    expect(search("moonlit", "rounds")).toEqual([]);
    expect(search("warrior", "rounds")).toEqual([]);
  });

  it("filters by entity type without a query", () => {
    expect(search("", "heroes")).toEqual(["hero-round"]);
    expect(search("", "rounds")).toEqual(["standalone"]);
    expect(search("", "all")).toEqual(["standalone", "hero-round"]);
  });

  it("retains combined search as the default scope", () => {
    expect(search("alice", "all")).toEqual(["standalone", "hero-round"]);
  });
});
