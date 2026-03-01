import type { RoundLibraryEntry, RoundRenderRow } from "../../routes/roundRows";

export type RoundLibraryCardItem = {
  key: string;
  round: RoundLibraryEntry;
  renderIndex: number;
};

export type RoundLibraryShelf =
  | {
      kind: "group-header";
      key: string;
      row: Extract<RoundRenderRow, { kind: "hero-group" | "playlist-group" }>;
    }
  | {
      kind: "card-row";
      key: string;
      items: RoundLibraryCardItem[];
    };

export function buildRoundLibraryShelves(
  rows: RoundRenderRow[],
  columns: number,
  expandedGroupKeys: ReadonlySet<string>
): RoundLibraryShelf[] {
  const safeColumns = Math.max(1, Math.floor(columns));
  const shelves: RoundLibraryShelf[] = [];
  let pendingStandalone: RoundLibraryCardItem[] = [];
  let nextRenderIndex = 0;
  let nextShelfRowIndex = 0;

  const flushStandalone = () => {
    if (pendingStandalone.length === 0) return;
    const { shelves: nextShelves, nextRowIndex } = chunkCardItems(
      pendingStandalone,
      safeColumns,
      "standalone",
      nextShelfRowIndex
    );
    shelves.push(...nextShelves);
    nextShelfRowIndex = nextRowIndex;
    pendingStandalone = [];
  };

  for (const row of rows) {
    if (row.kind === "standalone") {
      pendingStandalone.push({
        key: row.round.id,
        round: row.round,
        renderIndex: nextRenderIndex,
      });
      nextRenderIndex += 1;
      continue;
    }

    flushStandalone();
    shelves.push({
      kind: "group-header",
      key: `${row.groupKey}:header`,
      row,
    });

    if (!expandedGroupKeys.has(row.groupKey)) {
      continue;
    }

    const { shelves: nextShelves } = chunkCardItems(
      row.rounds.map((round) => {
        const item: RoundLibraryCardItem = {
          key: `${row.groupKey}:${round.id}`,
          round,
          renderIndex: nextRenderIndex,
        };
        nextRenderIndex += 1;
        return item;
      }),
      safeColumns,
      row.groupKey,
      0
    );
    shelves.push(...nextShelves);
  }

  flushStandalone();
  return shelves;
}

function chunkCardItems(
  items: RoundLibraryCardItem[],
  columns: number,
  keyPrefix: string,
  startRowIndex: number
): { shelves: RoundLibraryShelf[]; nextRowIndex: number } {
  const shelves: RoundLibraryShelf[] = [];
  let nextRowIndex = startRowIndex;

  for (let index = 0; index < items.length; index += columns) {
    shelves.push({
      kind: "card-row",
      key: `${keyPrefix}:row:${nextRowIndex}`,
      items: items.slice(index, index + columns),
    });
    nextRowIndex += 1;
  }

  return { shelves, nextRowIndex };
}
