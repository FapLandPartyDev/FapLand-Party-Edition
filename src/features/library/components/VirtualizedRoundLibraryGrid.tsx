import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type SyntheticEvent } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { buildRoundLibraryShelves, type RoundLibraryCardItem, type RoundLibraryShelf } from "../roundLibraryShelves";
import type { RoundRenderRow } from "../../../routes/roundRows";

const GROUP_HEADER_ESTIMATE_PX = 88;
const CARD_ROW_ESTIMATE_PX = 480;
const SHELF_GAP_PX = 20;
const CARD_MIN_WIDTH_PX = 320;
const MAX_COLUMNS = 2;

type VirtualizedRoundLibraryGridProps = {
  rows: RoundRenderRow[];
  expandedGroupKeys: ReadonlySet<string>;
  scrollContainer: HTMLElement | null;
  renderCard: (item: RoundLibraryCardItem) => ReactNode;
  renderGroupHeader: (shelf: Extract<RoundLibraryShelf, { kind: "group-header" }>) => ReactNode;
};

export function VirtualizedRoundLibraryGrid({
  rows,
  expandedGroupKeys,
  scrollContainer,
  renderCard,
  renderGroupHeader,
}: VirtualizedRoundLibraryGridProps) {
  const [columns, setColumns] = useState(1);
  const [shouldVirtualize, setShouldVirtualize] = useState(false);
  const layoutContainerRef = useRef<HTMLDivElement | null>(null);
  const hasGroupedRows = useMemo(() => rows.some((row) => row.kind !== "standalone"), [rows]);

  useEffect(() => {
    if (!scrollContainer) {
      setShouldVirtualize(false);
      return;
    }

    const updateLayout = () => {
      const width =
        layoutContainerRef.current?.clientWidth || scrollContainer.clientWidth || window.innerWidth || 0;
      const nextColumns = Math.max(
        1,
        Math.min(MAX_COLUMNS, Math.floor((width + SHELF_GAP_PX) / (CARD_MIN_WIDTH_PX + SHELF_GAP_PX))),
      );
      setColumns(nextColumns);
      setShouldVirtualize(scrollContainer.clientHeight > 0);
    };

    updateLayout();

    if (typeof ResizeObserver === "undefined") {
      return;
    }

    const observer = new ResizeObserver(updateLayout);
    observer.observe(scrollContainer);
    if (layoutContainerRef.current) {
      observer.observe(layoutContainerRef.current);
    }
    return () => observer.disconnect();
  }, [scrollContainer]);

  const shelves = useMemo(
    () => buildRoundLibraryShelves(rows, columns, expandedGroupKeys),
    [columns, expandedGroupKeys, rows],
  );
  const canVirtualize = shouldVirtualize && !hasGroupedRows;

  const shelfRenderer = useMemo(
    () => (shelf: RoundLibraryShelf) => {
      if (shelf.kind === "group-header") {
        return renderGroupHeader(shelf);
      }

      const fillerCount = Math.max(0, columns - shelf.items.length);

      return (
        <div
          className="grid justify-center gap-5"
          style={{
            gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
          }}
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
    [columns, renderCard, renderGroupHeader],
  );

  const virtualizer = useVirtualizer({
    count: shelves.length,
    getScrollElement: () => scrollContainer,
    getItemKey: (index) => shelves[index]?.key ?? index,
    estimateSize: (index) => {
      const shelf = shelves[index];
      return shelf?.kind === "group-header"
        ? GROUP_HEADER_ESTIMATE_PX + SHELF_GAP_PX
        : CARD_ROW_ESTIMATE_PX + SHELF_GAP_PX;
    },
    overscan: 4,
    measureElement: (element) => element.getBoundingClientRect().height,
    useAnimationFrameWithResizeObserver: true,
    enabled: canVirtualize,
  });
  const handleShelfMediaStateChange = useCallback(
    (event: SyntheticEvent<HTMLDivElement>) => {
      if (!canVirtualize) return;
      virtualizer.measureElement(event.currentTarget);
    },
    [canVirtualize, virtualizer],
  );

  useEffect(() => {
    if (!canVirtualize) {
      return;
    }

    virtualizer.measure();

    const frame = window.requestAnimationFrame(() => {
      virtualizer.measure();
    });

    return () => window.cancelAnimationFrame(frame);
  }, [canVirtualize, columns, shelves, virtualizer]);

  useEffect(() => {
    if (!canVirtualize || typeof document === "undefined" || !document.fonts?.ready) {
      return;
    }

    let cancelled = false;
    void document.fonts.ready.then(() => {
      if (!cancelled) {
        virtualizer.measure();
      }
    });

    return () => {
      cancelled = true;
    };
  }, [canVirtualize, virtualizer]);

  if (!canVirtualize) {
    return (
      <div
        ref={layoutContainerRef}
        className="space-y-5"
      >
        {shelves.map((shelf) => (
          <div
            key={shelf.key}
            className={shelf.kind === "group-header" ? "relative z-10 focus-within:z-[60] hover:z-20" : undefined}
          >
            {shelfRenderer(shelf)}
          </div>
        ))}
      </div>
    );
  }

  return (
    <div
      ref={layoutContainerRef}
      className="relative"
      style={{ height: `${virtualizer.getTotalSize()}px` }}
    >
      {virtualizer.getVirtualItems().map((item) => {
        const shelf = shelves[item.index];
        if (!shelf) return null;

        return (
          <div
            key={shelf.key}
            ref={virtualizer.measureElement}
            data-index={item.index}
            className={`absolute left-0 top-0 w-full pb-5 ${shelf.kind === "group-header" ? "z-10 focus-within:z-[60] hover:z-20" : ""}`}
            style={{ transform: `translateY(${item.start}px)` }}
            onErrorCapture={handleShelfMediaStateChange}
            onLoadCapture={handleShelfMediaStateChange}
            onLoadedMetadataCapture={handleShelfMediaStateChange}
          >
            {shelfRenderer(shelf)}
          </div>
        );
      })}
    </div>
  );
}
