import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RecoveryMode } from "./RecoveryMode";

const mocks = vi.hoisted(() => ({
  clearAllData: vi.fn(async () => {}),
  startNormally: vi.fn(async () => {}),
}));

vi.mock("./services/db", () => ({
  db: {
    install: {
      clearAllData: mocks.clearAllData,
    },
  },
}));

describe("RecoveryMode", () => {
  beforeEach(() => {
    mocks.clearAllData.mockClear();
    mocks.startNormally.mockClear();
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
});
