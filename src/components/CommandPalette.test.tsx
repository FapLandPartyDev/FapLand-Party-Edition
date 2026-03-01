import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CommandPalette } from "./CommandPalette";
import {
  BlockCommandPalette,
  CommandPaletteGuardProvider,
} from "../contexts/CommandPaletteGuardContext";

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  openGlobalMusicOverlay: vi.fn(),
  openGlobalHandyOverlay: vi.fn(),
  handy: {
    manuallyStopped: false,
    toggleManualStop: vi.fn(async () => "stopped" as const),
  },
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mocks.navigate,
}));

vi.mock("./globalMusicOverlayControls", () => ({
  openGlobalMusicOverlay: mocks.openGlobalMusicOverlay,
}));

vi.mock("./globalHandyOverlayControls", () => ({
  openGlobalHandyOverlay: mocks.openGlobalHandyOverlay,
}));

vi.mock("../contexts/HandyContext", () => ({
  useHandy: () => mocks.handy,
}));

vi.mock("../utils/audio", () => ({
  playHoverSound: vi.fn(),
  playSelectSound: vi.fn(),
}));

describe("CommandPalette", () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    mocks.handy.manuallyStopped = false;
    mocks.handy.toggleManualStop.mockResolvedValue("stopped");
  });

  afterEach(() => {
    cleanup();
  });

  it("opens the music menu from the command palette", async () => {
    render(
      <CommandPaletteGuardProvider>
        <CommandPalette />
      </CommandPaletteGuardProvider>
    );

    fireEvent.keyDown(window, { key: "k", ctrlKey: true });

    const input = await screen.findByPlaceholderText("Search pages, settings, actions...");
    fireEvent.change(input, { target: { value: "music" } });
    fireEvent.click(screen.getByRole("button", { name: /Music Menu/i }));

    await waitFor(() => {
      expect(mocks.openGlobalMusicOverlay).toHaveBeenCalledTimes(1);
    });
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it("opens the TheHandy menu from the command palette", async () => {
    render(
      <CommandPaletteGuardProvider>
        <CommandPalette />
      </CommandPaletteGuardProvider>
    );

    fireEvent.keyDown(window, { key: "k", ctrlKey: true });

    const input = await screen.findByPlaceholderText("Search pages, settings, actions...");
    fireEvent.change(input, { target: { value: "handy menu" } });
    fireEvent.click(screen.getByRole("button", { name: /TheHandy Menu/i }));

    await waitFor(() => {
      expect(mocks.openGlobalHandyOverlay).toHaveBeenCalledTimes(1);
    });
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it("toggles TheHandy manual stop state from the command palette", async () => {
    render(
      <CommandPaletteGuardProvider>
        <CommandPalette />
      </CommandPaletteGuardProvider>
    );

    fireEvent.keyDown(window, { key: "k", ctrlKey: true });

    const input = await screen.findByPlaceholderText("Search pages, settings, actions...");
    fireEvent.change(input, { target: { value: "thehandy" } });
    fireEvent.click(screen.getByRole("button", { name: /Stop TheHandy/i }));

    await waitFor(() => {
      expect(mocks.handy.toggleManualStop).toHaveBeenCalledTimes(1);
    });
    expect(await screen.findByText("TheHandy stopped.")).toBeTruthy();
  });

  it("opens install from web from the command palette as a short link", async () => {
    render(
      <CommandPaletteGuardProvider>
        <CommandPalette />
      </CommandPaletteGuardProvider>
    );

    fireEvent.keyDown(window, { key: "k", ctrlKey: true });

    const input = await screen.findByPlaceholderText("Search pages, settings, actions...");
    fireEvent.change(input, { target: { value: "install from web" } });
    fireEvent.click(screen.getByRole("button", { name: /Install From Web/i }));

    await waitFor(() => {
      expect(mocks.navigate).toHaveBeenCalledWith({
        to: "/rounds",
        search: { open: "install-web" },
      });
    });
  });

  it("opens install rounds from the command palette as a short link", async () => {
    render(
      <CommandPaletteGuardProvider>
        <CommandPalette />
      </CommandPaletteGuardProvider>
    );

    fireEvent.keyDown(window, { key: "k", ctrlKey: true });

    const input = await screen.findByPlaceholderText("Search pages, settings, actions...");
    fireEvent.change(input, { target: { value: "install rounds" } });
    fireEvent.click(screen.getByRole("button", { name: /Install Rounds/i }));

    await waitFor(() => {
      expect(mocks.navigate).toHaveBeenCalledWith({
        to: "/rounds",
        search: { open: "install-rounds" },
      });
    });
  });

  it("blocks opening the command palette when the current route disables it", async () => {
    render(
      <CommandPaletteGuardProvider>
        <BlockCommandPalette reason="Blocked in active game.">
          <div>Game route</div>
        </BlockCommandPalette>
        <CommandPalette />
      </CommandPaletteGuardProvider>
    );

    fireEvent.keyDown(window, { key: "k", ctrlKey: true });

    expect(screen.queryByPlaceholderText("Search pages, settings, actions...")).toBeNull();
    expect(await screen.findByText("Blocked in active game.")).toBeTruthy();
  });
});
