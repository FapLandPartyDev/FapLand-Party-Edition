import { describe, expect, it } from "vitest";
import type { RoundLibraryEntry, RoundRenderRow } from "@/routes/roundRows";
import { applyRoundSelectionClick, collectVisibleSelectableRoundIds } from "./selectionRange";

function round(id: string) {
  return { id } as unknown as RoundLibraryEntry;
}

describe("collectVisibleSelectableRoundIds", () => {
  it("follows rendered order and excludes rounds in collapsed groups", () => {
    const rows = [
      { kind: "standalone", round: round("standalone") },
      {
        kind: "hero-group",
        groupKey: "expanded",
        heroName: "Expanded",
        rounds: [round("hero-1"), round("hero-2")],
      },
      {
        kind: "playlist-group",
        groupKey: "collapsed",
        playlistId: "playlist-1",
        playlistName: "Collapsed",
        rounds: [round("hidden")],
      },
    ] as RoundRenderRow[];

    expect(collectVisibleSelectableRoundIds(rows, new Set(["expanded"]))).toEqual([
      "standalone",
      "hero-1",
      "hero-2",
    ]);
  });
});

describe("applyRoundSelectionClick", () => {
  it("toggles a plain click and establishes the anchor", () => {
    const result = applyRoundSelectionClick({
      selectedIds: new Set(["one"]),
      clickedId: "one",
      anchorId: null,
      visibleIds: ["one", "two"],
      shiftKey: false,
    });

    expect([...result.selectedIds]).toEqual([]);
    expect(result.anchorId).toBe("one");
  });

  it("additively selects the inclusive visible range without moving the anchor", () => {
    const result = applyRoundSelectionClick({
      selectedIds: new Set(["outside"]),
      clickedId: "four",
      anchorId: "two",
      visibleIds: ["one", "two", "three", "four", "five"],
      shiftKey: true,
    });

    expect(result.selectedIds).toEqual(new Set(["outside", "two", "three", "four"]));
    expect(result.anchorId).toBe("two");
  });

  it("falls back to a plain toggle when the anchor is no longer visible", () => {
    const result = applyRoundSelectionClick({
      selectedIds: new Set(["one"]),
      clickedId: "three",
      anchorId: "hidden",
      visibleIds: ["one", "two", "three"],
      shiftKey: true,
    });

    expect(result.selectedIds).toEqual(new Set(["one", "three"]));
    expect(result.anchorId).toBe("three");
  });
});
