import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { InstalledRound } from "../../../services/db";
import type { RoundRenderRow } from "../../../routes/roundRows";
import { VirtualizedRoundLibraryGrid } from "./VirtualizedRoundLibraryGrid";

const useVirtualizerMock = vi.fn();

vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: (...args: unknown[]) => useVirtualizerMock(...args),
}));

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

describe("VirtualizedRoundLibraryGrid", () => {
  beforeEach(() => {
    useVirtualizerMock.mockReset();

    class ResizeObserverMock {
      static instances: ResizeObserverMock[] = [];
      callback: ResizeObserverCallback;

      constructor(callback: ResizeObserverCallback) {
        this.callback = callback;
        ResizeObserverMock.instances.push(this);
      }

      observe() {}
      disconnect() {}

      trigger() {
        this.callback([], this as unknown as ResizeObserver);
      }
    }

    vi.stubGlobal("ResizeObserver", ResizeObserverMock);
  });

  it("uses stable shelf keys and remeasures when a group expands", async () => {
    const measure = vi.fn();
    const container = document.createElement("div");
    Object.defineProperty(container, "clientWidth", { configurable: true, value: 1280 });
    Object.defineProperty(container, "clientHeight", { configurable: true, value: 900 });

    let latestOptions: Record<string, unknown> | null = null;
    useVirtualizerMock.mockImplementation((options: Record<string, unknown>) => {
      latestOptions = options;
      const count = Number(options.count ?? 0);
      return {
        measure,
        getTotalSize: () => 0,
        getVirtualItems: () =>
          Array.from({ length: count }, (_, index) => ({
            index,
            start: index * 100,
          })),
      };
    });

    const rows: RoundRenderRow[] = [
      {
        kind: "hero-group",
        groupKey: "hero:one",
        heroName: "Hero One",
        rounds: [makeRound("r1"), makeRound("r2")],
      },
      { kind: "standalone", round: makeRound("solo") },
    ];

    const renderCard = vi.fn((item: { key: string }) => <div key={item.key}>{item.key}</div>);
    const renderGroupHeader = vi.fn((shelf: { key: string }) => (
      <div key={shelf.key}>{shelf.key}</div>
    ));

    const { rerender } = render(
      <VirtualizedRoundLibraryGrid
        rows={rows}
        expandedGroupKeys={new Set()}
        scrollContainer={container}
        renderCard={renderCard}
        renderGroupHeader={renderGroupHeader}
      />
    );

    await waitFor(() => {
      expect(useVirtualizerMock).toHaveBeenCalled();
    });

    expect(latestOptions!["getItemKey"]).toBeTypeOf("function");
    expect((latestOptions!["getItemKey"] as (index: number) => string | number)(0)).toBe(
      "hero:one:header"
    );
    expect((latestOptions!["getItemKey"] as (index: number) => string | number)(1)).toBe(
      "standalone:row:0"
    );

    rerender(
      <VirtualizedRoundLibraryGrid
        rows={rows}
        expandedGroupKeys={new Set(["hero:one"])}
        scrollContainer={container}
        renderCard={renderCard}
        renderGroupHeader={renderGroupHeader}
      />
    );

    await waitFor(() => {
      expect((latestOptions!["getItemKey"] as (index: number) => string | number)(1)).toBe(
        "hero:one:row:0"
      );
    });

    expect(measure).not.toHaveBeenCalled();
  });

  it("virtualizes large grouped libraries", async () => {
    const measure = vi.fn();
    const container = document.createElement("div");
    Object.defineProperty(container, "clientWidth", { configurable: true, value: 1280 });
    Object.defineProperty(container, "clientHeight", { configurable: true, value: 900 });

    let latestOptions: Record<string, unknown> | null = null;
    useVirtualizerMock.mockImplementation((options: Record<string, unknown>) => {
      latestOptions = options;
      const count = Number(options.count ?? 0);
      return {
        measure,
        measureElement: vi.fn(),
        getTotalSize: () => count * 100,
        getVirtualItems: () =>
          Array.from({ length: Math.min(count, 4) }, (_, index) => ({
            index,
            start: index * 100,
          })),
      };
    });

    const rows: Extract<RoundRenderRow, { kind: "hero-group" }>[] = Array.from(
      { length: 6 },
      (_, index) => ({
        kind: "hero-group",
        groupKey: `hero:${index}`,
        heroName: `Hero ${index}`,
        rounds: [makeRound(`r-${index}-1`), makeRound(`r-${index}-2`), makeRound(`r-${index}-3`)],
      })
    );

    render(
      <VirtualizedRoundLibraryGrid
        rows={rows}
        expandedGroupKeys={new Set(rows.map((row) => row.groupKey))}
        scrollContainer={container}
        renderCard={(item) => <div key={item.key}>{item.key}</div>}
        renderGroupHeader={(shelf) => <div key={shelf.key}>{shelf.key}</div>}
      />
    );

    await waitFor(() => {
      expect(useVirtualizerMock).toHaveBeenCalled();
      expect(latestOptions?.enabled).toBe(true);
      expect(measure).toHaveBeenCalled();
    });
  });

  it("accounts for its offset inside the scroll container", async () => {
    const container = document.createElement("div");
    Object.defineProperty(container, "clientWidth", { configurable: true, value: 1280 });
    Object.defineProperty(container, "clientHeight", { configurable: true, value: 900 });
    Object.defineProperty(container, "scrollTop", { configurable: true, value: 200 });
    vi.spyOn(container, "getBoundingClientRect").mockReturnValue({
      top: 100,
    } as DOMRect);

    let latestOptions: Record<string, unknown> | null = null;
    useVirtualizerMock.mockImplementation((options: Record<string, unknown>) => {
      latestOptions = options;
      const scrollMargin = Number(options.scrollMargin ?? 0);
      return {
        measure: vi.fn(),
        measureElement: vi.fn(),
        getTotalSize: () => 1200,
        getVirtualItems: () => [{ index: 0, start: scrollMargin }],
      };
    });

    const rows = Array.from({ length: 12 }, (_, index) => ({
      kind: "hero-group" as const,
      groupKey: `hero:${index}`,
      heroName: `Hero ${index}`,
      rounds: [makeRound(`round-${index}`)],
    }));

    const { container: rendered } = render(
      <VirtualizedRoundLibraryGrid
        rows={rows}
        expandedGroupKeys={new Set()}
        scrollContainer={container}
        renderCard={(item) => <div key={item.key}>{item.key}</div>}
        renderGroupHeader={(shelf) => <div>{shelf.key}</div>}
      />
    );

    const layoutContainer = rendered.firstElementChild as HTMLDivElement;
    vi.spyOn(layoutContainer, "getBoundingClientRect").mockReturnValue({
      top: 650,
    } as DOMRect);

    const ResizeObserverMock = globalThis.ResizeObserver as unknown as {
      instances: Array<{ trigger: () => void }>;
    };
    ResizeObserverMock.instances[0]?.trigger();

    await waitFor(() => {
      expect(latestOptions?.scrollMargin).toBe(750);
      expect((layoutContainer.firstElementChild as HTMLElement).style.transform).toBe(
        "translateY(0px)"
      );
    });
  });

  it("remeasures a virtualized shelf when media finishes loading", async () => {
    const measure = vi.fn();
    const measureElement = vi.fn();
    const container = document.createElement("div");
    Object.defineProperty(container, "clientWidth", { configurable: true, value: 900 });
    Object.defineProperty(container, "clientHeight", { configurable: true, value: 900 });

    useVirtualizerMock.mockImplementation((options: Record<string, unknown>) => {
      const count = Number(options.count ?? 0);
      return {
        measure,
        measureElement,
        getTotalSize: () => count * 100,
        getVirtualItems: () =>
          Array.from({ length: count }, (_, index) => ({
            index,
            start: index * 100,
          })),
      };
    });

    render(
      <VirtualizedRoundLibraryGrid
        rows={Array.from({ length: 30 }, (_, index) => ({
          kind: "standalone" as const,
          round: makeRound(index === 0 ? "media-round" : `round-${index}`),
        }))}
        expandedGroupKeys={new Set()}
        scrollContainer={container}
        renderCard={(item) => <img key={item.key} alt={item.key} src={`/${item.key}.jpg`} />}
        renderGroupHeader={() => null}
      />
    );

    await waitFor(() => {
      expect(useVirtualizerMock).toHaveBeenCalled();
      expect(measureElement).toHaveBeenCalled();
    });

    const initialMeasureCalls = measure.mock.calls.length;
    fireEvent.load(screen.getByAltText("media-round"));

    await waitFor(() => {
      expect(measure.mock.calls.length).toBeGreaterThan(initialMeasureCalls);
    });
  });

  it("remeasures virtualized shelves when the container width changes", async () => {
    const measure = vi.fn();
    const container = document.createElement("div");
    Object.defineProperty(container, "clientWidth", { configurable: true, value: 900 });
    Object.defineProperty(container, "clientHeight", { configurable: true, value: 900 });

    useVirtualizerMock.mockImplementation((options: Record<string, unknown>) => {
      const count = Number(options.count ?? 0);
      return {
        measure,
        measureElement: vi.fn(),
        getTotalSize: () => count * 100,
        getVirtualItems: () =>
          Array.from({ length: count }, (_, index) => ({
            index,
            start: index * 100,
          })),
      };
    });

    render(
      <VirtualizedRoundLibraryGrid
        rows={Array.from({ length: 30 }, (_, index) => ({
          kind: "standalone" as const,
          round: makeRound(index === 0 ? "resize-round" : `round-${index}`),
        }))}
        expandedGroupKeys={new Set()}
        scrollContainer={container}
        renderCard={(item) => <div key={item.key}>{item.key}</div>}
        renderGroupHeader={() => null}
      />
    );

    await waitFor(() => {
      expect(useVirtualizerMock).toHaveBeenCalled();
      expect(measure).toHaveBeenCalled();
    });

    const ResizeObserverMock = globalThis.ResizeObserver as unknown as {
      instances: Array<{ trigger: () => void }>;
    };
    const measureCallsBeforeResize = measure.mock.calls.length;

    Object.defineProperty(container, "clientWidth", { configurable: true, value: 640 });
    ResizeObserverMock.instances[0]?.trigger();

    await waitFor(() => {
      expect(measure.mock.calls.length).toBeGreaterThan(measureCallsBeforeResize);
    });
  });

  it("does not render the full card list before the scroll container is ready", () => {
    useVirtualizerMock.mockImplementation(() => ({
      measure: vi.fn(),
      measureElement: vi.fn(),
      getTotalSize: () => 0,
      getVirtualItems: () => [],
    }));

    const renderCard = vi.fn((item: { key: string }) => <div key={item.key}>{item.key}</div>);

    render(
      <VirtualizedRoundLibraryGrid
        rows={Array.from({ length: 40 }, (_, index) => ({
          kind: "standalone" as const,
          round: makeRound(`round-${index}`),
        }))}
        expandedGroupKeys={new Set()}
        scrollContainer={null}
        renderCard={renderCard}
        renderGroupHeader={() => null}
      />
    );

    expect(useVirtualizerMock).toHaveBeenCalled();
    expect(renderCard).not.toHaveBeenCalled();
  });

  it("emits visible round ids for the currently rendered virtual shelves", async () => {
    const onVisibleRoundIdsChange = vi.fn();
    const container = document.createElement("div");
    Object.defineProperty(container, "clientWidth", { configurable: true, value: 900 });
    Object.defineProperty(container, "clientHeight", { configurable: true, value: 900 });
    const rows = Array.from({ length: 30 }, (_, index) => ({
      kind: "standalone" as const,
      round: makeRound(`round-${index}`),
    }));
    let virtualItems = [
      { index: 0, start: 0 },
      { index: 1, start: 100 },
    ];

    useVirtualizerMock.mockImplementation((options: Record<string, unknown>) => {
      const count = Number(options.count ?? 0);
      return {
        measure: vi.fn(),
        measureElement: vi.fn(),
        getTotalSize: () => count * 100,
        getVirtualItems: () => virtualItems,
      };
    });

    const { rerender } = render(
      <VirtualizedRoundLibraryGrid
        rows={rows}
        expandedGroupKeys={new Set()}
        scrollContainer={container}
        renderCard={(item) => <div key={item.key}>{item.key}</div>}
        renderGroupHeader={() => null}
        onVisibleRoundIdsChange={onVisibleRoundIdsChange}
      />
    );

    await waitFor(() => {
      expect(onVisibleRoundIdsChange).toHaveBeenCalledWith([
        "round-0",
        "round-1",
        "round-2",
        "round-3",
      ]);
    });

    virtualItems = [
      { index: 2, start: 200 },
      { index: 3, start: 300 },
    ];

    rerender(
      <VirtualizedRoundLibraryGrid
        rows={rows}
        expandedGroupKeys={new Set()}
        scrollContainer={container}
        renderCard={(item) => <div key={item.key}>{item.key}</div>}
        renderGroupHeader={() => null}
        onVisibleRoundIdsChange={onVisibleRoundIdsChange}
      />
    );

    await waitFor(() => {
      expect(onVisibleRoundIdsChange).toHaveBeenLastCalledWith([
        "round-4",
        "round-5",
        "round-6",
        "round-7",
      ]);
    });
  });

  it("does not emit round ids for visible group headers without rendered card rows", async () => {
    const onVisibleRoundIdsChange = vi.fn();
    const container = document.createElement("div");
    Object.defineProperty(container, "clientWidth", { configurable: true, value: 900 });
    Object.defineProperty(container, "clientHeight", { configurable: true, value: 900 });
    const rows = Array.from({ length: 12 }, (_, index) => ({
      kind: "hero-group" as const,
      groupKey: `hero:${index}`,
      heroName: `Hero ${index}`,
      rounds: [
        makeRound(`round-${index}-1`),
        makeRound(`round-${index}-2`),
        makeRound(`round-${index}-3`),
      ],
    }));
    let virtualItems = [{ index: 0, start: 0 }];

    useVirtualizerMock.mockImplementation((options: Record<string, unknown>) => {
      const count = Number(options.count ?? 0);
      return {
        measure: vi.fn(),
        measureElement: vi.fn(),
        getTotalSize: () => count * 100,
        getVirtualItems: () => virtualItems,
      };
    });

    const { rerender } = render(
      <VirtualizedRoundLibraryGrid
        rows={rows}
        expandedGroupKeys={new Set(rows.map((row) => row.groupKey))}
        scrollContainer={container}
        renderCard={(item) => <div key={item.key}>{item.key}</div>}
        renderGroupHeader={() => <div>Hero Header</div>}
        onVisibleRoundIdsChange={onVisibleRoundIdsChange}
      />
    );

    await waitFor(() => {
      expect(onVisibleRoundIdsChange).not.toHaveBeenCalled();
    });

    virtualItems = [
      { index: 1, start: 100 },
      { index: 2, start: 200 },
    ];

    rerender(
      <VirtualizedRoundLibraryGrid
        rows={rows}
        expandedGroupKeys={new Set(rows.map((row) => row.groupKey))}
        scrollContainer={container}
        renderCard={(item) => <div key={item.key}>{item.key}</div>}
        renderGroupHeader={() => <div>Hero Header</div>}
        onVisibleRoundIdsChange={onVisibleRoundIdsChange}
      />
    );

    await waitFor(() => {
      expect(onVisibleRoundIdsChange).toHaveBeenLastCalledWith([
        "round-0-1",
        "round-0-2",
        "round-0-3",
      ]);
    });
  });
});
