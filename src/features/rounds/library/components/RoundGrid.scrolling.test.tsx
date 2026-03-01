import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type VirtualItemStub = {
  index: number;
  key: string;
  start: number;
};

const mocks = vi.hoisted(() => ({
  options: null as { overscan?: number } | null,
  virtualItems: [{ index: 0, key: "row-0", start: 0 }] as VirtualItemStub[],
  virtualizer: {
    getVirtualItems: vi.fn(() => mocks.virtualItems),
    getTotalSize: vi.fn(() => 1000),
    measure: vi.fn(),
    measureElement: vi.fn(),
  },
}));

vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: vi.fn((options: { overscan?: number }) => {
    mocks.options = options;
    return mocks.virtualizer;
  }),
}));

import type { RoundRenderRow } from "@/routes/roundRows";
import { RoundGrid } from "./RoundGrid";

describe("RoundGrid scrolling fast path", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mocks.virtualItems = [{ index: 0, key: "row-0", start: 0 }];
    mocks.options = null;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("uses a small overscan and defers visible-id updates until scrolling settles", async () => {
    const scrollContainer = document.createElement("div");
    document.body.appendChild(scrollContainer);
    const rows = [
      { kind: "standalone", round: { id: "round-1" } },
      { kind: "standalone", round: { id: "round-2" } },
      { kind: "standalone", round: { id: "round-3" } },
    ] as RoundRenderRow[];
    const onVisibleRoundIdsChange = vi.fn();
    const onScrollingChange = vi.fn();

    const view = render(
      <RoundGrid
        rows={rows}
        expandedGroupKeys={new Set()}
        scrollContainer={scrollContainer}
        renderCard={() => null}
        renderGroupHeader={() => null}
        onVisibleRoundIdsChange={onVisibleRoundIdsChange}
        onScrollingChange={onScrollingChange}
      />
    );

    await act(async () => {
      await Promise.resolve();
    });
    expect(onVisibleRoundIdsChange).toHaveBeenCalledWith(expect.arrayContaining(["round-1"]));
    expect(mocks.options?.overscan).toBe(2);
    onVisibleRoundIdsChange.mockClear();

    mocks.virtualItems = [{ index: 1, key: "row-1", start: 500 }];
    act(() => {
      scrollContainer.dispatchEvent(new Event("scroll"));
    });
    view.rerender(
      <RoundGrid
        rows={rows}
        expandedGroupKeys={new Set()}
        scrollContainer={scrollContainer}
        renderCard={() => null}
        renderGroupHeader={() => null}
        onVisibleRoundIdsChange={onVisibleRoundIdsChange}
        onScrollingChange={onScrollingChange}
      />
    );

    expect(onVisibleRoundIdsChange).not.toHaveBeenCalled();
    expect(onScrollingChange).toHaveBeenLastCalledWith(true);

    act(() => {
      vi.advanceTimersByTime(150);
    });

    expect(onVisibleRoundIdsChange).toHaveBeenCalledWith(["round-2"]);
    expect(onScrollingChange).toHaveBeenLastCalledWith(false);

    view.unmount();
    scrollContainer.remove();
  });
});
