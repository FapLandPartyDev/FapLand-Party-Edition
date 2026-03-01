import type { RoundRenderRow } from "@/routes/roundRows";

export function collectVisibleSelectableRoundIds(
  rows: ReadonlyArray<RoundRenderRow>,
  expandedGroupKeys: ReadonlySet<string>
): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();

  const add = (id: string) => {
    if (seen.has(id)) return;
    seen.add(id);
    ids.push(id);
  };

  for (const row of rows) {
    if (row.kind === "standalone") {
      add(row.round.id);
      continue;
    }
    if (!expandedGroupKeys.has(row.groupKey)) continue;
    for (const round of row.rounds) add(round.id);
  }

  return ids;
}

export function applyRoundSelectionClick(input: {
  selectedIds: ReadonlySet<string>;
  clickedId: string;
  anchorId: string | null;
  visibleIds: ReadonlyArray<string>;
  shiftKey: boolean;
}): { selectedIds: Set<string>; anchorId: string } {
  const next = new Set(input.selectedIds);
  const anchorIndex = input.anchorId === null ? -1 : input.visibleIds.indexOf(input.anchorId);
  const clickedIndex = input.visibleIds.indexOf(input.clickedId);

  if (input.shiftKey && anchorIndex >= 0 && clickedIndex >= 0) {
    const start = Math.min(anchorIndex, clickedIndex);
    const end = Math.max(anchorIndex, clickedIndex);
    for (const id of input.visibleIds.slice(start, end + 1)) next.add(id);
    return { selectedIds: next, anchorId: input.anchorId! };
  }

  if (next.has(input.clickedId)) next.delete(input.clickedId);
  else next.add(input.clickedId);
  return { selectedIds: next, anchorId: input.clickedId };
}
