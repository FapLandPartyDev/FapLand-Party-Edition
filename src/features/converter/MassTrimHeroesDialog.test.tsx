import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MassTrimHeroesDialog } from "./MassTrimHeroesDialog";

const mocks = vi.hoisted(() => ({
  massTrimHeroes: vi.fn(),
}));

vi.mock("../../services/converter", () => ({
  converter: {
    massTrimHeroes: mocks.massTrimHeroes,
  },
}));

vi.mock("../../utils/audio", () => ({
  playHoverSound: vi.fn(),
  playSelectSound: vi.fn(),
}));

describe("MassTrimHeroesDialog", () => {
  beforeEach(() => {
    mocks.massTrimHeroes.mockReset();
    mocks.massTrimHeroes.mockResolvedValue({
      selectedHeroCount: 1,
      sectionCount: 2,
      trimmedSectionCount: 1,
      unchangedSectionCount: 0,
      skippedSectionCount: 1,
    });
  });

  it("selects heroes and submits the default one-second allowance", async () => {
    const onCompleted = vi.fn();
    render(
      <MassTrimHeroesDialog
        open
        heroes={[
          { id: "hero-a", name: "Alpha", author: "Author A", roundCount: 2 },
          { id: "hero-b", name: "Beta", author: null, roundCount: 3 },
        ]}
        onClose={() => {}}
        onCompleted={onCompleted}
      />
    );

    const submit = screen.getByRole("button", { name: "Trim Selected Heroes" });
    const dialog = screen.getByRole("dialog");
    expect(dialog.parentElement).toBe(document.body);
    expect(dialog.firstElementChild?.className).toContain("max-h-[calc(100dvh-1rem)]");
    expect((submit as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(screen.getByRole("checkbox", { name: /Alpha/ }));
    expect(screen.getByText("1 heroes selected · 2 sections")).toBeDefined();
    expect((submit as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(submit);

    await waitFor(() => {
      expect(mocks.massTrimHeroes).toHaveBeenCalledWith({
        heroIds: ["hero-a"],
        allowanceMs: 1_000,
      });
    });
    expect(onCompleted).toHaveBeenCalledTimes(1);
    expect(
      screen.getByText("Trimmed 1 sections. 0 were already trimmed and 1 were skipped.")
    ).toBeDefined();
  });

  it("can select all currently visible heroes", () => {
    render(
      <MassTrimHeroesDialog
        open
        heroes={[
          { id: "hero-a", name: "Alpha", author: null, roundCount: 2 },
          { id: "hero-b", name: "Beta", author: null, roundCount: 3 },
        ]}
        onClose={() => {}}
        onCompleted={() => {}}
      />
    );

    const dialogs = screen.getAllByRole("dialog");
    const dialog = dialogs[dialogs.length - 1]!;
    fireEvent.change(within(dialog).getByPlaceholderText("Search heroes..."), {
      target: { value: "beta" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Select visible" }));

    expect(dialog.textContent).toContain("1 heroes selected · 3 sections");
  });
});
