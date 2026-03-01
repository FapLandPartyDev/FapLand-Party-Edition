import { render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  virtualizer: {
    getVirtualItems: vi.fn(() => []),
    getTotalSize: vi.fn(() => 0),
    measure: vi.fn(),
    measureElement: vi.fn(),
  },
}));

vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: vi.fn(() => mocks.virtualizer),
}));

import { RoundGrid } from "./RoundGrid";
import type { RoundRenderRow } from "@/routes/roundRows";

describe("RoundGrid group expansion", () => {
  beforeEach(() => {
    mocks.virtualizer.measure.mockClear();
  });

  it("keeps measured shelf heights when a group is expanded", async () => {
    const scrollContainer = document.createElement("div");
    document.body.appendChild(scrollContainer);
    const rows = [
      {
        kind: "hero-group",
        groupKey: "hero:one",
        heroName: "Hero One",
        rounds: [{ id: "round-one" }],
      },
    ] as RoundRenderRow[];

    const view = render(
      <RoundGrid
        rows={rows}
        expandedGroupKeys={new Set()}
        scrollContainer={scrollContainer}
        renderCard={() => null}
        renderGroupHeader={() => null}
      />
    );

    await waitFor(() => expect(mocks.virtualizer.measure).toHaveBeenCalled());
    mocks.virtualizer.measure.mockClear();

    view.rerender(
      <RoundGrid
        rows={rows}
        expandedGroupKeys={new Set(["hero:one"])}
        scrollContainer={scrollContainer}
        renderCard={() => null}
        renderGroupHeader={() => null}
      />
    );

    await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
    expect(mocks.virtualizer.measure).not.toHaveBeenCalled();

    view.unmount();
    scrollContainer.remove();
  });
});
