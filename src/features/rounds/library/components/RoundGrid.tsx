import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { RoundRenderRow } from "@/routes/roundRows";
import type { RoundLibraryEntry } from "@/routes/roundRows";

export type RoundCardItem = {
  key: string;
  round: RoundLibraryEntry;
  renderIndex: number;
};

export type RoundGridShelf =
  | { kind: "group-header"; key: string; row: Extract<RoundRenderRow, { kind: "hero-group" | "playlist-group" }> }
  | { kind: "card-row"; key: string; items: RoundCardItem[] };

const GROUP_HEADER_ESTIMATE_PX = 96;
const CARD_ROW_CHROME_ESTIMATE_PX = 340;
const SHELF_GAP_PX = 20;
const CARD_MIN_WIDTH_PX = 320;
const MAX_COLUMNS = 2;

function buildShelves(
  rows: RoundRenderRow[],
  columns: number,
  expandedGroupKeys: ReadonlySet<string>
): RoundGridShelf[] {
  const safeColumns = Math.max(1, Math.floor(columns));
  const shelves: RoundGridShelf[] = [];
  let pendingStandalone: RoundCardItem[] = [];
  let nextRenderIndex = 0;
  let nextStandaloneRowIndex = 0;

  const flushStandalone = () => {
    if (pendingStandalone.length === 0) return;
    for (let index = 0; index < pendingStandalone.length; index += safeColumns) {
      const slice = pendingStandalone.slice(index, index + safeColumns);
      shelves.push({
        kind: "card-row",
        key: `standalone:row:${nextStandaloneRowIndex}`,
        items: slice,
      });
      nextStandaloneRowIndex += 1;
    }
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

    if (!expandedGroupKeys.has(row.groupKey)) continue;

    const groupRounds = row.rounds.map((round: RoundLibraryEntry) => {
      const item: RoundCardItem = {
        key: `${row.groupKey}:${round.id}`,
        round,
        renderIndex: nextRenderIndex,
      };
      nextRenderIndex += 1;
      return item;
    });

    for (let index = 0; index < groupRounds.length; index += safeColumns) {
      const slice = groupRounds.slice(index, index + safeColumns);
      shelves.push({
        kind: "card-row",
        key: `${row.groupKey}:row:${Math.floor(index / safeColumns)}`,
        items: slice,
      });
    }
  }

  flushStandalone();
  return shelves;
}

function estimateCardRowHeight(columns: number, containerWidth: number): number {
  const safeColumns = Math.max(1, columns);
  const safeWidth = Math.max(CARD_MIN_WIDTH_PX, containerWidth);
  const totalGapWidth = SHELF_GAP_PX * Math.max(0, safeColumns - 1);
  const columnWidth = Math.max(
    CARD_MIN_WIDTH_PX,
    Math.floor((safeWidth - totalGapWidth) / safeColumns)
  );
  const mediaHeight = Math.round((columnWidth * 9) / 16);
  return mediaHeight + CARD_ROW_CHROME_ESTIMATE_PX + SHELF_GAP_PX;
}

function collectRoundIdsFromShelf(shelf: RoundGridShelf | undefined): string[] {
  if (!shelf || shelf.kind === "group-header") return [];
  return shelf.items.map((item) => item.round.id);
}

function collectAllRoundIds(rows: RoundRenderRow[]): string[] {
  const ids: string[] = [];
  for (const row of rows) {
    if (row.kind === "standalone") {
      ids.push(row.round.id);
      continue;
    }
    for (const round of row.rounds) ids.push(round.id);
  }
  return [...new Set(ids)];
}

export type RoundGridProps = {
  rows: RoundRenderRow[];
  expandedGroupKeys: ReadonlySet<string>;
  scrollContainer: HTMLElement | null;
  renderCard: (item: RoundCardItem) => ReactNode;
  renderGroupHeader: (shelf: Extract<RoundGridShelf, { kind: "group-header" }>) => ReactNode;
  onVisibleRoundIdsChange?: (roundIds: string[]) => void;
};

export function RoundGrid({
  rows,
  expandedGroupKeys,
  scrollContainer,
  renderCard,
  renderGroupHeader,
  onVisibleRoundIdsChange,
}: RoundGridProps) {
  const layoutContainerRef = useRef<HTMLDivElement | null>(null);
  const [columns, setColumns] = useState(MAX_COLUMNS);
  const [containerWidth, setContainerWidth] = useState(0);
  const [scrollMargin, setScrollMargin] = useState(0);
  const lastVisibleKeyRef = useRef<string>("");

  // Compute the offset between the scroll container's content origin and the
  // grid's content origin. This is recomputed on every scroll tick (cheap, via
  // rAF throttle) AND on resize — the original implementation only updated on
  // resize, which is why items vanished when the layout above the grid shifted
  // (filter bar collapse, dialog open/close). Updating on scroll fixes that.
  useEffect(() => {
    if (!scrollContainer) return;
    let rafId: number | null = null;

    const measure = () => {
      rafId = null;
      const layoutContainer = layoutContainerRef.current;
      if (!layoutContainer) return;
      const next =
        layoutContainer.getBoundingClientRect().top -
        scrollContainer.getBoundingClientRect().top +
        scrollContainer.scrollTop;
      setScrollMargin((prev) => (Math.abs(prev - next) < 1 ? prev : next));
    };

    const schedule = () => {
      if (rafId !== null) return;
      rafId = window.requestAnimationFrame(measure);
    };

    measure();
    scrollContainer.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);

    let observer: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver(schedule);
      observer.observe(scrollContainer);
      if (layoutContainerRef.current) observer.observe(layoutContainerRef.current);
    }

    return () => {
      if (rafId !== null) window.cancelAnimationFrame(rafId);
      scrollContainer.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      observer?.disconnect();
    };
  }, [scrollContainer]);

  // Update column count + width based on the layout container's actual size.
  useEffect(() => {
    const layoutContainer = layoutContainerRef.current;
    if (!layoutContainer) return;

    const updateLayout = () => {
      const width = layoutContainer.clientWidth || 0;
      const nextColumns = Math.max(
        1,
        Math.min(
          MAX_COLUMNS,
          Math.floor((width + SHELF_GAP_PX) / (CARD_MIN_WIDTH_PX + SHELF_GAP_PX))
        )
      );
      setContainerWidth(width);
      setColumns((prev) => (prev === nextColumns ? prev : nextColumns));
    };

    updateLayout();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(updateLayout);
    observer.observe(layoutContainer);
    return () => observer.disconnect();
  }, [scrollContainer]);

  const shelves = useMemo(
    () => buildShelves(rows, columns, expandedGroupKeys),
    [columns, expandedGroupKeys, rows]
  );
  const shelfSignature = useMemo(
    () => shelves.map((shelf) => shelf.key).join("|"),
    [shelves]
  );

  const hasGroupedRows = useMemo(
    () => rows.some((row) => row.kind !== "standalone"),
    [rows]
  );

  const virtualizer = useVirtualizer({
    count: shelves.length,
    getScrollElement: () => scrollContainer,
    getItemKey: (index) => shelves[index]?.key ?? index,
    estimateSize: (index) => {
      const shelf = shelves[index];
      return shelf?.kind === "group-header"
        ? GROUP_HEADER_ESTIMATE_PX + SHELF_GAP_PX
        : estimateCardRowHeight(columns, containerWidth);
    },
    // scrollMargin is recomputed on every scroll tick (see effect above) so that
    // layout shifts above the grid no longer cause items to vanish.
    scrollMargin,
    overscan: 6,
    measureElement: (element) => element.getBoundingClientRect().height,
  });

  const virtualItems = virtualizer.getVirtualItems();

  // Re-measure when the shelf layout or column count changes.
  useEffect(() => {
    if (!scrollContainer) return;
    const frame = window.requestAnimationFrame(() => virtualizer.measure());
    return () => window.cancelAnimationFrame(frame);
  }, [columns, scrollContainer, shelfSignature, virtualizer]);

  // Re-measure once webfonts settle (card text height changes).
  useEffect(() => {
    if (typeof document === "undefined" || !document.fonts?.ready) return;
    let cancelled = false;
    void document.fonts.ready.then(() => {
      if (!cancelled) virtualizer.measure();
    });
    return () => {
      cancelled = true;
    };
  }, [virtualizer]);

  // Surface visible round ids so the parent can lazy-load card assets.
  useEffect(() => {
    if (!onVisibleRoundIdsChange) return;
    const next = [
      ...new Set(virtualItems.flatMap((item) => collectRoundIdsFromShelf(shelves[item.index]))),
    ];
    const key = next.join("|");
    if (lastVisibleKeyRef.current === key) return;
    lastVisibleKeyRef.current = key;
    onVisibleRoundIdsChange(next);
  }, [onVisibleRoundIdsChange, shelves, virtualItems]);

  // When no scroll container is available yet (initial mount), still surface all ids.
  useEffect(() => {
    if (!onVisibleRoundIdsChange || scrollContainer) return;
    const next = collectAllRoundIds(rows);
    const key = next.join("|");
    if (lastVisibleKeyRef.current === key) return;
    lastVisibleKeyRef.current = key;
    onVisibleRoundIdsChange(next);
  }, [onVisibleRoundIdsChange, rows, scrollContainer]);

  const renderShelf = useCallback(
    (shelf: RoundGridShelf) => {
      if (shelf.kind === "group-header") {
        return renderGroupHeader(shelf);
      }
      const fillerCount = Math.max(0, columns - shelf.items.length);
      return (
        <div
          className="grid gap-5"
          style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
        >
          {shelf.items.map((item) => renderCard(item))}
          {Array.from({ length: fillerCount }, (_, index) => (
            <div
              key={`${shelf.key}:filler:${index}`}
              aria-hidden="true"
              className="pointer-events-none invisible"
            />
          ))}
        </div>
      );
    },
    [columns, renderCard, renderGroupHeader]
  );

  // No scroll container mounted yet: render a stable, non-measured placeholder so
  // layout/scroll-container detection can settle without flicker.
  if (!scrollContainer) {
    return (
      <div ref={layoutContainerRef} className="relative min-h-px" aria-hidden="true" />
    );
  }

  // Virtualized path (also used for grouped lists so headers + card rows stay aligned).
  if (rows.length > 0) {
    return (
      <div
        ref={layoutContainerRef}
        className="relative"
        style={{ height: `${virtualizer.getTotalSize()}px` }}
      >
        {virtualItems.map((item) => {
          const shelf = shelves[item.index];
          if (!shelf) return null;
          return (
            <div
              key={shelf.key}
              ref={virtualizer.measureElement}
              data-index={item.index}
              className={`absolute left-0 top-0 w-full pb-5 ${
                shelf.kind === "group-header" ? "z-10 focus-within:z-[60] hover:z-20" : ""
              }`}
              style={{ transform: `translateY(${item.start - scrollMargin}px)` }}
            >
              {renderShelf(shelf)}
            </div>
          );
        })}
      </div>
    );
  }

  // Empty state: nothing to virtualize.
  return (
    <div ref={layoutContainerRef} className="space-y-5">
      {hasGroupedRows ? null : null}
    </div>
  );
}
