import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SourceLinkDialog } from "./SourceLinkDialog";

const {
  analyzeLibraryLinksMock,
  applyLibraryLinksMock,
  getLibraryLinkAnalysisStatusMock,
  searchVideoFilesMock,
} = vi.hoisted(() => ({
  analyzeLibraryLinksMock: vi.fn(),
  applyLibraryLinksMock: vi.fn(),
  getLibraryLinkAnalysisStatusMock: vi.fn(),
  searchVideoFilesMock: vi.fn(),
}));

vi.mock("@/controller", () => ({ useControllerSurface: vi.fn() }));
vi.mock("@/services/acquisition", () => ({
  acquisition: {
    analyzeLibraryLinks: analyzeLibraryLinksMock,
    applyLibraryLinks: applyLibraryLinksMock,
    getLibraryLinkAnalysisStatus: getLibraryLinkAnalysisStatusMock,
    searchVideoFiles: searchVideoFilesMock,
  },
}));

describe("SourceLinkDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    searchVideoFilesMock.mockResolvedValue({ items: [], nextCursor: null });
    getLibraryLinkAnalysisStatusMock.mockResolvedValue({
      state: "running",
      phase: "matching",
      completed: 25,
      total: 100,
      message: "Matching files...",
      startedAt: new Date().toISOString(),
      finishedAt: null,
    });
    applyLibraryLinksMock.mockResolvedValue({ changedTargets: 1, linkedRounds: 2 });
    analyzeLibraryLinksMock.mockResolvedValue({
      scope: {
        heroes: 1,
        standaloneRounds: 1,
        linked: 1,
        ready: 1,
        needsReview: 0,
        unmatched: 0,
      },
      sources: { enabled: 1, refreshed: 0, refreshErrors: [] },
      targets: [
        {
          targetKind: "hero",
          targetId: "hero-1",
          name: "Matched Hero",
          author: "Author",
          roundIds: ["round-1", "round-2"],
          existing: [],
          mixedExistingLinks: false,
          suggestions: [
            {
              sourceId: "source-1",
              sourceName: "Torrent Collection",
              sourceKind: "torrent",
              sourcePath: "videos/Matched Hero.mp4",
              sizeBytes: 1234,
              score: 0.96,
              confidence: "high",
              collision: false,
            },
          ],
          autoSelected: true,
        },
        {
          targetKind: "round",
          targetId: "round-existing",
          name: "Already Linked",
          author: null,
          roundIds: ["round-existing"],
          existing: [
            {
              sourceId: "source-1",
              sourceName: "Torrent Collection",
              sourceKind: "torrent",
              sourcePath: "videos/Already Linked.mp4",
              sizeBytes: 4567,
            },
          ],
          mixedExistingLinks: false,
          suggestions: [],
          autoSelected: false,
        },
      ],
    });
  });

  it("preselects unique confident matches and preserves existing links", async () => {
    const onApplied = vi.fn();
    render(
      <SourceLinkDialog
        selection={{ heroIds: ["hero-1"] }}
        onClose={vi.fn()}
        onApplied={onApplied}
        onOpenSettings={vi.fn()}
      />
    );

    expect(screen.getByRole("progressbar", { name: "Preparing source analysis" })).toBeTruthy();
    expect(await screen.findByText("Matched Hero")).toBeTruthy();
    expect(screen.getByText("Keeping existing mapping")).toBeTruthy();
    // Confident matches stay collapsed; the selected suggestion is revealed on demand.
    fireEvent.click(screen.getByRole("button", { name: /Review matches/ }));
    expect(screen.getByRole("button", { name: "Hide matches" })).toBeTruthy();
    expect(
      screen.getAllByRole("button", { pressed: true }).map((button) => button.textContent)
    ).toContainEqual(expect.stringContaining("Best match"));
    fireEvent.click(screen.getByRole("button", { name: "Apply 1 links" }));

    await waitFor(() =>
      expect(applyLibraryLinksMock).toHaveBeenCalledWith([
        expect.objectContaining({
          targetKind: "hero",
          targetId: "hero-1",
          sourceId: "source-1",
          replaceExisting: false,
        }),
      ])
    );
    expect(onApplied).toHaveBeenCalledWith({ changedTargets: 1, linkedRounds: 2 });
  });
});
