import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StartupGate } from "./StartupGate";

const mocks = vi.hoisted(() => ({
  enterRecovery: vi.fn(async () => {}),
  startNormally: vi.fn(async () => {}),
}));

vi.mock("./NormalApp", () => ({
  NormalApp: () => <div>Normal App Loaded</div>,
}));

vi.mock("./RecoveryMode", () => ({
  RecoveryMode: () => (
    <div>
      <h1>Emergency Recovery Mode</h1>
    </div>
  ),
}));

describe("StartupGate", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mocks.enterRecovery.mockReset();
    mocks.startNormally.mockReset();
    window.electronAPI = {
      startupRecovery: {
        enterRecovery: mocks.enterRecovery,
        startNormally: mocks.startNormally,
      },
    } as unknown as typeof window.electronAPI;
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("opens recovery when R is pressed during the startup window", async () => {
    let resolveStartup: () => void = () => {};
    mocks.startNormally.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveStartup = resolve;
        })
    );

    render(<StartupGate />);

    fireEvent.keyDown(window, { key: "r" });
    resolveStartup();
    await act(async () => {
      await vi.dynamicImportSettled();
    });

    await vi.waitFor(() => {
      expect(screen.getByRole("heading", { name: "Emergency Recovery Mode" })).toBeDefined();
    });
    expect(mocks.enterRecovery).toHaveBeenCalledTimes(1);
    expect(mocks.startNormally).toHaveBeenCalledTimes(1);
  });

  it("starts normally immediately on mount", async () => {
    render(<StartupGate />);

    await act(async () => {
      await vi.runAllTimersAsync();
      await vi.dynamicImportSettled();
    });

    await vi.waitFor(() => {
      expect(screen.getByText("Normal App Loaded")).toBeDefined();
    });
    expect(mocks.startNormally).toHaveBeenCalledTimes(1);
    expect(mocks.enterRecovery).not.toHaveBeenCalled();
  });

  it("does not double-call startNormally", async () => {
    render(<StartupGate />);

    await act(async () => {
      await vi.dynamicImportSettled();
    });
    expect(mocks.startNormally).toHaveBeenCalledTimes(1);
  });

  it("shows error UI when startup fails", async () => {
    mocks.startNormally.mockRejectedValue(new Error("Database connection failed"));

    render(<StartupGate />);

    await act(async () => {
      await vi.runAllTimersAsync();
      await vi.dynamicImportSettled();
    });

    await vi.waitFor(() => {
      expect(screen.getByText("Startup failed")).toBeDefined();
    });
    expect(screen.getByText("Database connection failed")).toBeDefined();
    expect(mocks.startNormally).toHaveBeenCalledTimes(1);
  });

  it("can enter recovery directly after startup fails", async () => {
    mocks.startNormally.mockRejectedValue(new Error("Database is corrupt"));
    render(<StartupGate />);

    await act(async () => {
      await vi.runAllTimersAsync();
      await vi.dynamicImportSettled();
    });
    fireEvent.click(screen.getByRole("button", { name: "Open Recovery" }));

    await act(async () => {
      await vi.dynamicImportSettled();
    });
    expect(mocks.enterRecovery).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("heading", { name: "Emergency Recovery Mode" })).toBeDefined();
  });

  it("can retry after startup error", async () => {
    mocks.startNormally.mockRejectedValueOnce(new Error("First attempt failed"));

    render(<StartupGate />);

    await act(async () => {
      await vi.runAllTimersAsync();
      await vi.dynamicImportSettled();
    });

    await vi.waitFor(() => {
      expect(screen.getByText("Startup failed")).toBeDefined();
    });

    mocks.startNormally.mockResolvedValueOnce(undefined);

    fireEvent.click(screen.getByText("Retry"));
    await act(async () => {
      await vi.runAllTimersAsync();
      await vi.dynamicImportSettled();
    });

    await vi.waitFor(() => {
      expect(screen.getByText("Normal App Loaded")).toBeDefined();
    });
    expect(mocks.startNormally).toHaveBeenCalledTimes(2);
  });

  it("stops listening for R after the shortcut window", async () => {
    render(<StartupGate />);

    await act(async () => {
      vi.advanceTimersByTime(5000);
      await vi.dynamicImportSettled();
    });

    expect(screen.getByText("Normal App Loaded")).toBeDefined();

    fireEvent.keyDown(window, { key: "r" });
    await act(async () => {
      await vi.dynamicImportSettled();
    });

    expect(mocks.enterRecovery).not.toHaveBeenCalled();
    expect(screen.getByText("Normal App Loaded")).toBeDefined();
  });
});
