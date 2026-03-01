import { describe, expect, it } from "vitest";
import type { InstalledRound } from "../../services/db";
import type { RoundRenderRow } from "../../routes/roundRows";
import { buildRoundLibraryShelves } from "./roundLibraryShelves";

function makeRound(id: string, name = id): InstalledRound {
  const timestamp = "2026-03-27T00:00:00.000Z";
  return {
    id,
    name,
    description: null,
    author: null,
    type: "Normal",
    difficulty: 1,
    bpm: null,
    startTime: null,
    endTime: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    heroId: null,
    hero: null,
    resources: [],
    installSourceKey: null,
    previewImage: null,
    phash: null,
    heroSourceType: null,
    sourceType: null,
  } as unknown as InstalledRound;
}

describe("buildRoundLibraryShelves", () => {
  it("packs standalone rounds into card rows by column count", () => {
    const rows: RoundRenderRow[] = [
      { kind: "standalone", round: makeRound("a") },
      { kind: "standalone", round: makeRound("b") },
      { kind: "standalone", round: makeRound("c") },
      { kind: "standalone", round: makeRound("d") },
    ];

    const shelves = buildRoundLibraryShelves(rows, 3, new Set());

    expect(shelves).toHaveLength(2);
    expect(shelves[0]).toMatchObject({
      kind: "card-row",
      items: [
        { key: "a", renderIndex: 0 },
        { key: "b", renderIndex: 1 },
        { key: "c", renderIndex: 2 },
      ],
    });
    expect(shelves[1]).toMatchObject({
      kind: "card-row",
      items: [{ key: "d", renderIndex: 3 }],
    });
  });

  it("adds group header shelves and only includes group rounds when expanded", () => {
    const rows: RoundRenderRow[] = [
      {
        kind: "hero-group",
        groupKey: "hero:one",
        heroName: "Hero One",
        rounds: [makeRound("r1"), makeRound("r2")],
      },
      { kind: "standalone", round: makeRound("solo") },
    ];

    const collapsedShelves = buildRoundLibraryShelves(rows, 2, new Set());
    expect(collapsedShelves).toEqual([
      expect.objectContaining({ kind: "group-header", key: "hero:one:header" }),
      expect.objectContaining({
        kind: "card-row",
        items: [expect.objectContaining({ key: "solo", renderIndex: 0 })],
      }),
    ]);

    const expandedShelves = buildRoundLibraryShelves(rows, 2, new Set(["hero:one"]));
    expect(expandedShelves).toEqual([
      expect.objectContaining({ kind: "group-header", key: "hero:one:header" }),
      expect.objectContaining({
        key: "hero:one:row:0",
        kind: "card-row",
        items: [
          expect.objectContaining({ key: "hero:one:r1", renderIndex: 0 }),
          expect.objectContaining({ key: "hero:one:r2", renderIndex: 1 }),
        ],
      }),
      expect.objectContaining({
        key: "standalone:row:0",
        kind: "card-row",
        items: [expect.objectContaining({ key: "solo", renderIndex: 2 })],
      }),
    ]);
  });

  it("keeps standalone shelf keys unique across multiple standalone batches", () => {
    const rows: RoundRenderRow[] = [
      { kind: "standalone", round: makeRound("solo-a") },
      {
        kind: "hero-group",
        groupKey: "hero:one",
        heroName: "Hero One",
        rounds: [makeRound("r1")],
      },
      { kind: "standalone", round: makeRound("solo-b") },
    ];

    const shelves = buildRoundLibraryShelves(rows, 1, new Set(["hero:one"]));

    expect(shelves.map((shelf) => shelf.key)).toEqual([
      "standalone:row:0",
      "hero:one:header",
      "hero:one:row:0",
      "standalone:row:1",
    ]);
  });

  it("keeps duplicate playlist memberships in separate shelves", () => {
    const shared = makeRound("shared");
    const rows: RoundRenderRow[] = [
      {
        kind: "playlist-group",
        groupKey: "playlist:a",
        playlistId: "a",
        playlistName: "Playlist A",
        rounds: [shared],
      },
      {
        kind: "playlist-group",
        groupKey: "playlist:b",
        playlistId: "b",
        playlistName: "Playlist B",
        rounds: [shared],
      },
    ];

    const shelves = buildRoundLibraryShelves(rows, 3, new Set(["playlist:a", "playlist:b"]));

    expect(shelves).toEqual([
      expect.objectContaining({ kind: "group-header", key: "playlist:a:header" }),
      expect.objectContaining({
        kind: "card-row",
        items: [expect.objectContaining({ key: "playlist:a:shared" })],
      }),
      expect.objectContaining({ kind: "group-header", key: "playlist:b:header" }),
      expect.objectContaining({
        kind: "card-row",
        items: [expect.objectContaining({ key: "playlist:b:shared" })],
      }),
    ]);
  });
});
