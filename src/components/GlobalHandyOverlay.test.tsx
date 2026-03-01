import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GlobalHandyOverlay } from "./GlobalHandyOverlay";

const mocks = vi.hoisted(() => ({
  handy: {
    connected: true,
    synced: true,
    syncError: null as string | null,
    manuallyStopped: false,
    offsetMs: 75,
    adjustOffset: vi.fn(async (deltaMs: number) => deltaMs),
    resetOffset: vi.fn(async () => undefined),
    toggleManualStop: vi.fn(async () => "stopped" as const),
  },
}));

vi.mock("../contexts/HandyContext", () => ({
  useHandy: () => mocks.handy,
}));

vi.mock("../utils/audio", () => ({
  playHoverSound: vi.fn(),
  playSelectSound: vi.fn(),
}));

describe("GlobalHandyOverlay", () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    mocks.handy.connected = true;
    mocks.handy.synced = true;
    mocks.handy.syncError = null;
    mocks.handy.manuallyStopped = false;
    mocks.handy.offsetMs = 75;
    mocks.handy.toggleManualStop.mockResolvedValue("stopped");
  });

  it("opens from Ctrl+H and renders the offset controls", () => {
    render(<GlobalHandyOverlay />);

    fireEvent.keyDown(window, { key: "h", ctrlKey: true });

    expect(screen.getByRole("dialog", { name: "Global TheHandy controls" })).toBeTruthy();
    expect(screen.getByText("Sync Offset")).toBeTruthy();
  });

  it("closes when Ctrl+H is pressed again", async () => {
    render(<GlobalHandyOverlay />);

    fireEvent.keyDown(window, { key: "h", ctrlKey: true });
    expect(screen.getByRole("dialog", { name: "Global TheHandy controls" })).toBeTruthy();

    fireEvent.keyDown(window, { key: "h", ctrlKey: true });

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Global TheHandy controls" })).toBeNull();
    });
  });

  it("ignores the shortcut inside editable fields", () => {
    render(
      <div>
        <input aria-label="editor" />
        <GlobalHandyOverlay />
      </div>
    );

    const input = screen.getByLabelText("editor");
    input.focus();
    fireEvent.keyDown(window, { key: "h", ctrlKey: true });

    expect(screen.queryByRole("dialog", { name: "Global TheHandy controls" })).toBeNull();
  });

  it("adjusts and resets the offset from the overlay", async () => {
    render(<GlobalHandyOverlay />);
    fireEvent.keyDown(window, { key: "h", ctrlKey: true });

    fireEvent.change(screen.getByLabelText("TheHandy global offset slider"), {
      target: { value: "120" },
    });
    fireEvent.click(screen.getByRole("button", { name: "-25ms" }));
    fireEvent.click(screen.getByRole("button", { name: "-1ms" }));
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    fireEvent.click(screen.getByRole("button", { name: "+1ms" }));
    fireEvent.click(screen.getByRole("button", { name: "+25ms" }));

    await waitFor(() => {
      expect(mocks.handy.adjustOffset).toHaveBeenNthCalledWith(1, 45);
      expect(mocks.handy.adjustOffset).toHaveBeenNthCalledWith(2, -25);
      expect(mocks.handy.adjustOffset).toHaveBeenNthCalledWith(3, -1);
      expect(mocks.handy.resetOffset).toHaveBeenCalledTimes(1);
      expect(mocks.handy.adjustOffset).toHaveBeenNthCalledWith(4, 1);
      expect(mocks.handy.adjustOffset).toHaveBeenNthCalledWith(5, 25);
    });
  });

  it("toggles TheHandy start and stop from the overlay", async () => {
    const view = render(<GlobalHandyOverlay />);
    fireEvent.keyDown(window, { key: "h", ctrlKey: true });

    fireEvent.click(screen.getByRole("button", { name: "Stop TheHandy" }));

    await waitFor(() => {
      expect(mocks.handy.toggleManualStop).toHaveBeenCalledTimes(1);
    });
    expect(screen.getByText("TheHandy stopped.")).toBeTruthy();

    mocks.handy.manuallyStopped = true;
    mocks.handy.toggleManualStop.mockResolvedValue("resumed");
    view.rerender(<GlobalHandyOverlay />);

    fireEvent.click(screen.getByRole("button", { name: "Start TheHandy" }));

    await waitFor(() => {
      expect(mocks.handy.toggleManualStop).toHaveBeenCalledTimes(2);
    });
  });
});
