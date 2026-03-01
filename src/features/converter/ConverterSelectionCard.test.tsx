import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ConverterSelectionCard } from "./ConverterSelectionCard";

vi.mock("../../utils/audio", () => ({
  playHoverSound: vi.fn(),
  playSelectSound: vi.fn(),
}));

vi.mock("../../hooks/useSfwMode", () => ({
  useSfwMode: () => false,
  useSfwModeState: () => ({
    enabled: true,
    resolved: true,
  }),
}));

describe("ConverterSelectionCard", () => {
  it("supports keyboard activation after switching away from a native button wrapper", () => {
    const onClick = vi.fn();

    render(
      <ConverterSelectionCard
        kind="hero"
        name="Test Hero"
        roundCount={3}
        durationMs={120_000}
        onClick={onClick}
      />
    );

    fireEvent.keyDown(screen.getByRole("button", { name: /Test Hero/i }), { key: "Enter" });

    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("does not select the card when the safe-mode preview prompt is clicked", () => {
    const onClick = vi.fn();

    render(
      <ConverterSelectionCard
        kind="round"
        name="Test Round"
        previewImage="/preview.jpg"
        onClick={onClick}
      />
    );

    const revealButton = screen.getByRole("button", { name: "Show Media Once" });

    revealButton.focus();
    fireEvent.keyDown(revealButton, { key: "Enter" });
    expect(onClick).not.toHaveBeenCalled();

    fireEvent.click(revealButton);

    expect(onClick).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeDefined();
  });
});
