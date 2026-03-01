import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GlobalHandyOverlay } from "./GlobalHandyOverlay";

const mocks = vi.hoisted(() => ({
  handy: {
    provider: "thehandy" as const,
    connected: true,
    isConnecting: false,
    connectionKey: "conn-key",
    intifaceDeviceName: null as string | null,
    error: null as string | null,
    synced: true,
    syncError: null as string | null,
    manuallyStopped: false,
    offsetMs: 75,
    strokeMin: 0.12,
    strokeMax: 0.88,
    strokePercent: 76,
    strokeLoading: false,
    strokeError: null as string | null,
    adjustOffset: vi.fn(async (deltaMs: number) => deltaMs),
    resetOffset: vi.fn(async () => undefined),
    setStrokePercent: vi.fn(async () => undefined),
    setStrokeBounds: vi.fn(async () => undefined),
    resetStroke: vi.fn(async () => undefined),
    toggleManualStop: vi.fn(async (): Promise<"stopped" | "resumed" | "unavailable"> => "stopped"),
    connect: vi.fn(async () => true),
    connectIntiface: vi.fn(async () => true),
    disconnect: vi.fn(async () => undefined),
    reconnect: vi.fn(async () => true),
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
    mocks.handy.provider = "thehandy";
    mocks.handy.isConnecting = false;
    mocks.handy.connectionKey = "conn-key";
    mocks.handy.error = null;
    mocks.handy.synced = true;
    mocks.handy.syncError = null;
    mocks.handy.manuallyStopped = false;
    mocks.handy.offsetMs = 75;
    mocks.handy.strokeMin = 0.12;
    mocks.handy.strokeMax = 0.88;
    mocks.handy.strokePercent = 76;
    mocks.handy.strokeLoading = false;
    mocks.handy.strokeError = null;
    mocks.handy.toggleManualStop.mockResolvedValue("stopped");
    mocks.handy.reconnect.mockResolvedValue(true);
  });

  it("opens from Ctrl+H and renders the offset controls", () => {
    render(<GlobalHandyOverlay />);

    fireEvent.keyDown(window, { key: "h", ctrlKey: true });

    expect(screen.getByRole("dialog", { name: "Global haptics controls" })).toBeTruthy();
    expect(screen.getByText("Sync Offset")).toBeTruthy();
    expect(screen.getByText("Stroke Adjustment")).toBeTruthy();
    expect(screen.getByText("Current stroke: 12% - 88%")).toBeTruthy();
  });

  it("closes when Ctrl+H is pressed again", async () => {
    render(<GlobalHandyOverlay />);

    fireEvent.keyDown(window, { key: "h", ctrlKey: true });
    expect(screen.getByRole("dialog", { name: "Global haptics controls" })).toBeTruthy();

    fireEvent.keyDown(window, { key: "h", ctrlKey: true });

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Global haptics controls" })).toBeNull();
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

    expect(screen.queryByRole("dialog", { name: "Global haptics controls" })).toBeNull();
  });

  it("adjusts and resets the offset from the overlay", async () => {
    render(<GlobalHandyOverlay />);
    fireEvent.keyDown(window, { key: "h", ctrlKey: true });

    fireEvent.change(screen.getByLabelText("Haptics global offset slider"), {
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

  it("updates and resets stroke length from the overlay", async () => {
    render(<GlobalHandyOverlay />);
    fireEvent.keyDown(window, { key: "h", ctrlKey: true });

    const minThumb = screen.getByLabelText("TheHandy stroke minimum slider");
    const maxThumb = screen.getByLabelText("TheHandy stroke maximum slider");
    fireEvent.keyDown(minThumb, { key: "ArrowRight" });
    fireEvent.keyDown(maxThumb, { key: "ArrowLeft" });
    fireEvent.click(screen.getByRole("button", { name: "Reset Stroke" }));

    await waitFor(() => {
      expect(mocks.handy.setStrokeBounds).toHaveBeenNthCalledWith(1, 13, 88);
      expect(mocks.handy.setStrokeBounds).toHaveBeenNthCalledWith(2, 13, 87);
      expect(mocks.handy.resetStroke).toHaveBeenCalledTimes(1);
    });
  });

  it("shows stroke errors inline", () => {
    mocks.handy.strokeError = "Failed to load TheHandy stroke settings.";
    render(<GlobalHandyOverlay />);
    fireEvent.keyDown(window, { key: "h", ctrlKey: true });

    expect(screen.getByText("Failed to load TheHandy stroke settings.")).toBeTruthy();
  });

  it("toggles TheHandy start and stop from the overlay", async () => {
    const view = render(<GlobalHandyOverlay />);
    fireEvent.keyDown(window, { key: "h", ctrlKey: true });

    fireEvent.click(screen.getByRole("button", { name: "Stop Haptics" }));

    await waitFor(() => {
      expect(mocks.handy.toggleManualStop).toHaveBeenCalledTimes(1);
    });
    expect(screen.getByText("Haptics stopped.")).toBeTruthy();

    mocks.handy.manuallyStopped = true;
    mocks.handy.toggleManualStop.mockResolvedValue("resumed");
    view.rerender(<GlobalHandyOverlay />);

    fireEvent.click(screen.getByRole("button", { name: "Start Haptics" }));

    await waitFor(() => {
      expect(mocks.handy.toggleManualStop).toHaveBeenCalledTimes(2);
    });
  });

  it("reconnects TheHandy from the overlay", async () => {
    render(<GlobalHandyOverlay />);
    fireEvent.keyDown(window, { key: "h", ctrlKey: true });

    fireEvent.click(screen.getByRole("button", { name: "Reconnect" }));

    await waitFor(() => {
      expect(mocks.handy.reconnect).toHaveBeenCalledTimes(1);
    });
  });

  it("reconnects TheHandy from Ctrl+R", async () => {
    render(<GlobalHandyOverlay />);

    fireEvent.keyDown(window, { key: "r", ctrlKey: true });

    await waitFor(() => {
      expect(mocks.handy.reconnect).toHaveBeenCalledTimes(1);
    });
  });

  it("ignores Ctrl+R inside editable fields", () => {
    render(
      <div>
        <input aria-label="editor" />
        <GlobalHandyOverlay />
      </div>
    );

    const input = screen.getByLabelText("editor");
    input.focus();
    fireEvent.keyDown(window, { key: "r", ctrlKey: true });

    expect(mocks.handy.reconnect).not.toHaveBeenCalled();
  });

  it("shows a success message after reconnecting", async () => {
    render(<GlobalHandyOverlay />);
    fireEvent.keyDown(window, { key: "h", ctrlKey: true });

    fireEvent.click(screen.getByRole("button", { name: "Reconnect" }));

    expect(screen.getByText("Reconnecting haptics...")).toBeTruthy();
    expect(await screen.findByText("Haptics reconnected.")).toBeTruthy();
  });

  it("shows a failure message after reconnecting fails", async () => {
    mocks.handy.reconnect.mockResolvedValue(false);
    render(<GlobalHandyOverlay />);
    fireEvent.keyDown(window, { key: "h", ctrlKey: true });

    fireEvent.click(screen.getByRole("button", { name: "Reconnect" }));

    expect(await screen.findByText("Haptics reconnect failed.")).toBeTruthy();
  });
});
