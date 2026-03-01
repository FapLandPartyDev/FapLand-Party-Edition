import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { VideoDownloadProgress } from "@/services/db";
import type { RoundLibraryEntry } from "../types";
import { RoundCard } from "./RoundCard";

vi.mock("@/hooks/useSfwMode", () => ({
  useSfwMode: () => false,
}));

const round = {
  id: "round-themed",
  name: "Themed round",
  author: "Creator",
  description: null,
  tags: [],
  type: "Normal",
  bpm: null,
  difficulty: 2,
  startTime: 0,
  endTime: 60_000,
  excludeFromRandom: false,
  primaryResourceId: null,
  resources: [],
  funscriptUri: null,
  funscriptOffsetMs: 0,
  invertFunscript: false,
  hero: null,
  heroId: null,
  installedAt: 0,
  isTemplate: false,
  scriptReady: false,
  source: "local",
  videoDurationSec: 60,
  websiteVideoCacheStatus: null,
} as unknown as RoundLibraryEntry;

describe("RoundCard theme styling", () => {
  it("uses theme-aware hooks for focus, selection, and download progress", () => {
    const { container, getByRole } = render(
      <div className="round-library-page" data-app-theme="ember">
        <RoundCard
          round={round}
          index={0}
          onHoverSfx={vi.fn()}
          onPlay={vi.fn()}
          showDisabledBadge={false}
          selected
          selectionMode
          onToggleSelection={vi.fn()}
          onInspect={vi.fn()}
          downloadProgress={{ percent: 42 } as VideoDownloadProgress}
        />
      </div>
    );

    expect(container.querySelector(".round-poster-card")?.classList.contains("is-selected")).toBe(
      true
    );
    expect(getByRole("button", { name: "Select Themed round" }).classList).toContain(
      "round-library-card-focus"
    );
    expect(container.querySelector(".round-library-progress")).not.toBeNull();
    expect(container.querySelector('[class*="cyan"]')).toBeNull();
  });

  it("passes Shift-click modifiers through the selection callback", () => {
    const onToggleSelection = vi.fn();
    const { container } = render(
      <RoundCard
        round={round}
        index={0}
        onHoverSfx={vi.fn()}
        onPlay={vi.fn()}
        showDisabledBadge={false}
        selectionMode
        onToggleSelection={onToggleSelection}
        onInspect={vi.fn()}
      />
    );

    const selectionButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Select Themed round"]'
    );
    if (!selectionButton) throw new Error("Selection button was not rendered");
    fireEvent.click(selectionButton, { shiftKey: true });

    expect(onToggleSelection).toHaveBeenCalledWith(round, { shiftKey: true });
  });
});
