import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TileSidebar } from "./TileSidebar";

vi.mock("../../../hooks/useSfwMode", () => ({ useSfwMode: () => false }));

describe("TileSidebar", () => {
  afterEach(cleanup);

  it("filters rounds independently by name, author, or type", () => {
    const view = render(
      <TileSidebar
        categoryTabs={[{ id: "all", label: "All" }]}
        activeCategory="all"
        tileSearch=""
        filteredTiles={[]}
        activePlacementKind="path"
        heroGroups={[]}
        isHeroPlacementActive={false}
        rounds={[
          { roundId: "one", name: "Alpha Run", author: "Jane", type: "Normal" },
          { roundId: "two", name: "Beta Break", author: "Alex", type: "Interjection" },
        ]}
        armedRoundId={null}
        isRoundPlacementActive={false}
        onCategoryChange={vi.fn()}
        onSearchChange={vi.fn()}
        onArmTile={vi.fn()}
        onArmHero={vi.fn()}
        onArmRound={vi.fn()}
      />
    );

    fireEvent.click(view.getByRole("button", { name: /Rounds/ }));
    const search = view.getByPlaceholderText("Search rounds");
    fireEvent.change(search, { target: { value: "alex" } });

    expect(view.queryByText("Alpha Run")).toBeNull();
    expect(view.getByText("Beta Break")).not.toBeNull();

    fireEvent.change(search, { target: { value: "normal" } });
    expect(view.getByText("Alpha Run")).not.toBeNull();
    expect(view.queryByText("Beta Break")).toBeNull();
  });
});
