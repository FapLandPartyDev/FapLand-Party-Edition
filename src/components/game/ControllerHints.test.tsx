import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ControllerHints from "./ControllerHints";

vi.mock("../../utils/audio", () => ({
  playHoverSound: vi.fn(),
}));

vi.mock("../../controller", () => ({
  useControllerSurface: vi.fn(),
}));

describe("ControllerHints", () => {
  beforeEach(() => {
    Object.defineProperty(window.navigator, "getGamepads", {
      configurable: true,
      value: vi.fn(() => [{ id: "pad-1" }]),
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("can disable hints without triggering render-phase updates", async () => {
    const { rerender } = render(
      <ControllerHints
        contextId="game-board"
        enabled={true}
        hints={[{ label: "Options", action: "START" }]}
      />
    );

    expect(await screen.findByRole("button", { name: /options/i })).toBeDefined();

    rerender(
      <ControllerHints
        contextId="game-board"
        enabled={false}
        hints={[{ label: "Options", action: "START" }]}
      />
    );

    expect(screen.queryByRole("button", { name: /options/i })).toBeNull();
  });
});
