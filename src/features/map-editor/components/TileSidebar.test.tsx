import { cleanup, fireEvent, render } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TileSidebar } from "./TileSidebar";

vi.mock("../../../hooks/useSfwMode", () => ({ useSfwMode: () => false }));
vi.mock("../../../utils/audio", () => ({
  playHoverSound: vi.fn(),
  playSelectSound: vi.fn(),
}));
vi.mock("../../../components/SfwGuard", () => ({
  SfwGuard: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("../../../hooks/useInstalledRoundMedia", () => ({
  useInstalledRoundMedia: () => ({
    mediaResources: { resources: [{ videoUri: "file:///preview.mp4" }] },
    isLoading: false,
    loadMediaResources: vi.fn(),
  }),
}));
vi.mock("../../rounds/library/components/RoundCardPreviewVideo", () => ({
  RoundCardPreviewVideo: () => <div data-testid="round-preview-video" />,
}));

describe("TileSidebar", () => {
  afterEach(cleanup);

  it("filters rounds independently by name, author, or type", () => {
    const Harness = () => {
      const [roundSearch, setRoundSearch] = useState("");
      return (
        <TileSidebar
          activeTab="rounds"
          categoryTabs={[{ id: "all", label: "All" }]}
          activeCategory="all"
          tileSearch=""
          roundSearch={roundSearch}
          roundTypeFilter="all"
          roundSort="name"
          heroSearch=""
          heroSort="name"
          filteredTiles={[]}
          activePlacementKind="path"
          heroGroups={[]}
          armedHeroId={null}
          isHeroPlacementActive={false}
          rounds={[
            {
              roundId: "one",
              name: "Alpha Run",
              author: "Jane",
              type: "Normal",
              difficulty: 2,
              durationSec: 60,
              previewImage: null,
              startTime: 0,
              endTime: 60_000,
            },
            {
              roundId: "two",
              name: "Beta Break",
              author: "Alex",
              type: "Interjection",
              difficulty: 4,
              durationSec: 120,
              previewImage: null,
              startTime: 0,
              endTime: 120_000,
            },
          ]}
          armedRoundId={null}
          isRoundPlacementActive={false}
          onTabChange={vi.fn()}
          onCategoryChange={vi.fn()}
          onTileSearchChange={vi.fn()}
          onRoundSearchChange={setRoundSearch}
          onRoundTypeFilterChange={vi.fn()}
          onRoundSortChange={vi.fn()}
          onHeroSearchChange={vi.fn()}
          onHeroSortChange={vi.fn()}
          onArmTile={vi.fn()}
          onArmHero={vi.fn()}
          onArmRound={vi.fn()}
        />
      );
    };
    const view = render(<Harness />);

    const search = view.getByPlaceholderText("Search rounds");
    fireEvent.change(search, { target: { value: "alex" } });

    expect(view.queryByText("Alpha Run")).toBeNull();
    expect(view.getByText("Beta Break")).not.toBeNull();

    fireEvent.change(search, { target: { value: "normal" } });
    expect(view.getByText("Alpha Run")).not.toBeNull();
    expect(view.queryByText("Beta Break")).toBeNull();
  });

  it("shows image and video previews for rounds", () => {
    const view = render(
      <TileSidebar
        activeTab="rounds"
        categoryTabs={[{ id: "all", label: "All" }]}
        activeCategory="all"
        tileSearch=""
        roundSearch=""
        roundTypeFilter="all"
        roundSort="name"
        heroSearch=""
        heroSort="name"
        filteredTiles={[]}
        activePlacementKind="path"
        heroGroups={[]}
        armedHeroId={null}
        isHeroPlacementActive={false}
        rounds={[
          {
            roundId: "preview-round",
            name: "Preview Round",
            author: "Author",
            type: "Normal",
            difficulty: 3,
            durationSec: 90,
            previewImage: "data:image/png;base64,preview",
            startTime: 1_000,
            endTime: 91_000,
          },
        ]}
        armedRoundId={null}
        isRoundPlacementActive={false}
        onTabChange={vi.fn()}
        onCategoryChange={vi.fn()}
        onTileSearchChange={vi.fn()}
        onRoundSearchChange={vi.fn()}
        onRoundTypeFilterChange={vi.fn()}
        onRoundSortChange={vi.fn()}
        onHeroSearchChange={vi.fn()}
        onHeroSortChange={vi.fn()}
        onArmTile={vi.fn()}
        onArmHero={vi.fn()}
        onArmRound={vi.fn()}
      />
    );

    expect(view.getByAltText("Preview Round preview")).not.toBeNull();
    expect(view.getByTestId("round-preview-video")).not.toBeNull();
  });

  it("exposes keyboard-navigable Tiles, Rounds, and Heroes tabs", () => {
    const Harness = () => {
      const [activeTab, setActiveTab] = useState<"tiles" | "rounds" | "heroes">("tiles");
      return (
        <TileSidebar
          activeTab={activeTab}
          categoryTabs={[{ id: "all", label: "All" }]}
          activeCategory="all"
          tileSearch=""
          roundSearch=""
          roundTypeFilter="all"
          roundSort="name"
          heroSearch=""
          heroSort="name"
          filteredTiles={[]}
          activePlacementKind="path"
          heroGroups={[]}
          armedHeroId={null}
          isHeroPlacementActive={false}
          rounds={[]}
          armedRoundId={null}
          isRoundPlacementActive={false}
          onTabChange={setActiveTab}
          onCategoryChange={vi.fn()}
          onTileSearchChange={vi.fn()}
          onRoundSearchChange={vi.fn()}
          onRoundTypeFilterChange={vi.fn()}
          onRoundSortChange={vi.fn()}
          onHeroSearchChange={vi.fn()}
          onHeroSortChange={vi.fn()}
          onArmTile={vi.fn()}
          onArmHero={vi.fn()}
          onArmRound={vi.fn()}
        />
      );
    };
    const view = render(<Harness />);
    const tiles = view.getByRole("tab", { name: "Tiles" });
    fireEvent.keyDown(tiles, { key: "ArrowRight" });
    expect(view.getByRole("tab", { name: /Rounds/ }).getAttribute("aria-selected")).toBe("true");
    expect(view.getByRole("tabpanel").getAttribute("aria-labelledby")).toBe(
      "map-library-tab-rounds"
    );
  });

  it("constrains the sidebar so library panels can scroll within the editor", () => {
    const view = render(
      <TileSidebar
        activeTab="rounds"
        categoryTabs={[{ id: "all", label: "All" }]}
        activeCategory="all"
        tileSearch=""
        roundSearch=""
        roundTypeFilter="all"
        roundSort="name"
        heroSearch=""
        heroSort="name"
        filteredTiles={[]}
        activePlacementKind="path"
        heroGroups={[]}
        armedHeroId={null}
        isHeroPlacementActive={false}
        rounds={[]}
        armedRoundId={null}
        isRoundPlacementActive={false}
        onTabChange={vi.fn()}
        onCategoryChange={vi.fn()}
        onTileSearchChange={vi.fn()}
        onRoundSearchChange={vi.fn()}
        onRoundTypeFilterChange={vi.fn()}
        onRoundSortChange={vi.fn()}
        onHeroSearchChange={vi.fn()}
        onHeroSortChange={vi.fn()}
        onArmTile={vi.fn()}
        onArmHero={vi.fn()}
        onArmRound={vi.fn()}
      />
    );

    const sidebar = view.getByRole("tablist").closest("aside");
    expect(sidebar?.classList.contains("h-full")).toBe(true);
    expect(sidebar?.classList.contains("overflow-hidden")).toBe(true);
    expect(view.getByRole("tabpanel").lastElementChild?.classList.contains("overflow-y-auto")).toBe(
      true
    );
  });
});
