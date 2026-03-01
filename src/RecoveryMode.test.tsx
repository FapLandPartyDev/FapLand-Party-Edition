import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RecoveryMode } from "./RecoveryMode";

const mocks = vi.hoisted(() => ({
  clearAllData: vi.fn(async () => {}),
  backupDatabaseNow: vi.fn(async () => {}),
  backupSettingsNow: vi.fn(async () => {}),
  startNormally: vi.fn(async () => {}),
  setLogLevel: vi.fn(async () => {}),
  getDebugState: vi.fn(async () => ({ logLevel: "off", logFilePath: "" })),
}));

vi.mock("./services/db", () => ({
  db: {
    install: {
      clearAllData: mocks.clearAllData,
      backupDatabaseNow: mocks.backupDatabaseNow,
      backupSettingsNow: mocks.backupSettingsNow,
    },
  },
}));

vi.mock("./services/trpc", () => ({
  trpc: {
    debug: {
      setLogLevel: { mutate: mocks.setLogLevel },
      getState: { query: mocks.getDebugState },
    },
  },
}));

describe("RecoveryMode", () => {
  beforeEach(() => {
    mocks.clearAllData.mockClear();
    mocks.backupDatabaseNow.mockClear();
    mocks.backupSettingsNow.mockClear();
    mocks.startNormally.mockClear();
    mocks.setLogLevel.mockClear();
    mocks.getDebugState.mockResolvedValue({ logLevel: "off", logFilePath: "" });
    window.electronAPI = {
      startupRecovery: {
        startNormally: mocks.startNormally,
      },
    } as typeof window.electronAPI;
  });

  afterEach(() => {
    cleanup();
  });

  it("shows emergency recovery controls and reuses the clear-data categories", () => {
    render(<RecoveryMode />);

    expect(screen.getByRole("heading", { name: "Emergency Recovery Mode" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Start Normally" })).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "Manage & Clear Data" }));

    for (const label of [
      "Installed Rounds & Heroes",
      "Playlists",
      "Run History",
      "Global Stats",
      "Multiplayer Cache",
      "Video Cache",
      "Music Cache",
      ".fpack Extractions",
      "EroScripts Cache",
      "App Settings & Preferences",
    ]) {
      expect(screen.getByText(label)).toBeDefined();
    }
  });

  it("clears selected data and stays in recovery when settings are not selected", async () => {
    render(<RecoveryMode />);

    fireEvent.click(screen.getByRole("button", { name: "Manage & Clear Data" }));
    fireEvent.click(screen.getByRole("button", { name: /App Settings & Preferences/i }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm Deletion" }));

    await waitFor(() => {
      expect(mocks.clearAllData).toHaveBeenCalledWith({
        rounds: true,
        playlists: true,
        stats: true,
        history: true,
        cache: true,
        videoCache: true,
        musicCache: true,
        fpackExtraction: true,
        eroscriptsCache: true,
        settings: false,
      });
    });
    expect(screen.getByText("Selected recovery data was cleared.")).toBeDefined();
  });

  it("renders the log level selector and backup buttons", () => {
    render(<RecoveryMode />);

    expect(screen.getByLabelText("Log Level")).toBeDefined();
    expect(screen.getByRole("button", { name: "Backup Database" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Backup Settings" })).toBeDefined();
  });

  it("changes the log level when a new level is selected", async () => {
    render(<RecoveryMode />);

    fireEvent.change(screen.getByLabelText("Log Level"), { target: { value: "debug" } });

    await waitFor(() => {
      expect(mocks.setLogLevel).toHaveBeenCalledWith({ level: "debug" });
    });
    expect(screen.getByText('Log level changed to "debug".')).toBeDefined();
  });

  it("backs up the database", async () => {
    render(<RecoveryMode />);

    fireEvent.click(screen.getByRole("button", { name: "Backup Database" }));

    await waitFor(() => {
      expect(mocks.backupDatabaseNow).toHaveBeenCalled();
    });
    expect(screen.getByText("Database backup created.")).toBeDefined();
  });

  it("backs up the settings", async () => {
    render(<RecoveryMode />);

    fireEvent.click(screen.getByRole("button", { name: "Backup Settings" }));

    await waitFor(() => {
      expect(mocks.backupSettingsNow).toHaveBeenCalled();
    });
    expect(screen.getByText("Settings backup created.")).toBeDefined();
  });
});
