import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { HotkeyOverlay } from "./HotkeyOverlay";

describe("HotkeyOverlay", () => {
  it("renders grouped converter shortcuts", () => {
    render(<HotkeyOverlay visible />);

    expect(screen.getByText("Playback")).toBeDefined();
    expect(screen.getByText("Segment Navigation")).toBeDefined();
    expect(screen.getByText("Detection & Save")).toBeDefined();
    expect(screen.getByText("Ctrl/Cmd+S")).toBeDefined();
    expect(screen.getByText("Save converted rounds to the current hero.")).toBeDefined();
    expect(screen.getByText("Shift+A")).toBeDefined();
  });
});
