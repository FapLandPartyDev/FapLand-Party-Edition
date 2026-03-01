import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RecoveryMode } from "./RecoveryMode";

const mocks = vi.hoisted(() => ({
  clearAllData: vi.fn(async () => {}),
  backupDatabaseNow: vi.fn(async () => {}),
  backupSettingsNow: vi.fn(async () => {}),
  createPlaintextSettingsFile: vi.fn(async () => {}),
  recoveryBackupDatabase: vi.fn(async () => "/tmp/database-backup.db"),
  getRecoveryStatus: vi.fn(async () => ({
    databasePath: "/tmp/dev.db",
    databaseExists: true,
    databaseBytes: 1024,
    integrity: "ok" as const,
    integrityMessage: "Database integrity check passed.",
  })),
  listDatabaseBackups: vi.fn<
    () => Promise<
      Array<{
        id: string;
        createdAt: string;
        bytes: number;
        integrity: "ok" | "corrupt";
        integrityMessage: string;
      }>
    >
  >(async () => []),
  restoreDatabaseBackup: vi.fn(async () => ({
    restoredBackupId: "f-land-db-backup-2026.db",
    safetyBackupPath: "/tmp/pre-restore.db",
    integrityMessage: "ok",
  })),
  startNormally: vi.fn(async () => {}),
  setLogLevel: vi.fn(async () => {}),
  getDebugState: vi.fn(async () => ({ logLevel: "off", logFilePath: "" })),
  openLogFolder: vi.fn(async () => {}),
}));

vi.mock("./services/db", () => ({
  db: {
    install: {
      clearAllData: mocks.clearAllData,
      backupDatabaseNow: mocks.backupDatabaseNow,
      backupSettingsNow: mocks.backupSettingsNow,
      createPlaintextSettingsFile: mocks.createPlaintextSettingsFile,
    },
  },
}));

vi.mock("./services/trpc", () => ({
  trpc: {
    debug: {
      setLogLevel: { mutate: mocks.setLogLevel },
      getState: { query: mocks.getDebugState },
      openLogFolder: { mutate: mocks.openLogFolder },
    },
  },
}));

describe("RecoveryMode", () => {
  beforeEach(() => {
    mocks.clearAllData.mockClear();
    mocks.backupDatabaseNow.mockClear();
    mocks.backupSettingsNow.mockClear();
    mocks.createPlaintextSettingsFile.mockClear();
    mocks.recoveryBackupDatabase.mockClear();
    mocks.getRecoveryStatus.mockClear();
    mocks.listDatabaseBackups.mockReset();
    mocks.listDatabaseBackups.mockResolvedValue([]);
    mocks.restoreDatabaseBackup.mockClear();
    mocks.startNormally.mockClear();
    mocks.setLogLevel.mockClear();
    mocks.openLogFolder.mockClear();
    mocks.getDebugState.mockResolvedValue({ logLevel: "off", logFilePath: "" });
    window.electronAPI = {
      startupRecovery: {
        startNormally: mocks.startNormally,
        getStatus: mocks.getRecoveryStatus,
        backupDatabase: mocks.recoveryBackupDatabase,
        listDatabaseBackups: mocks.listDatabaseBackups,
        restoreDatabaseBackup: mocks.restoreDatabaseBackup,
      },
    } as unknown as typeof window.electronAPI;
  });

  afterEach(() => {
    cleanup();
  });

  it("shows emergency recovery controls and reuses the clear-data categories", () => {
    render(<RecoveryMode />);

    expect(screen.getByRole("heading", { name: "Emergency Recovery Mode" })).toBeDefined();
    expect(screen.getByTestId("recovery-scroll-container").className).toContain("overflow-y-auto");
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
    expect(screen.getByRole("button", { name: "Create Plaintext Settings File" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Open Log File" })).toBeDefined();
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
      expect(mocks.recoveryBackupDatabase).toHaveBeenCalled();
    });
    expect(screen.getByText("Database backup created at /tmp/database-backup.db.")).toBeDefined();
  });

  it("lists verified backups and restores only after confirmation", async () => {
    mocks.listDatabaseBackups.mockResolvedValue([
      {
        id: "f-land-db-backup-2026.db",
        createdAt: "2026-08-05T10:00:00.000Z",
        bytes: 1024 * 1024,
        integrity: "ok",
        integrityMessage: "Database integrity check passed.",
      },
    ]);
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<RecoveryMode />);

    fireEvent.click(await screen.findByRole("button", { name: "Restore" }));

    await waitFor(() => {
      expect(mocks.restoreDatabaseBackup).toHaveBeenCalledWith("f-land-db-backup-2026.db");
    });
    expect(
      await screen.findByText(/pre-restore database is archived at \/tmp\/pre-restore.db/i)
    ).toBeDefined();
  });

  it("backs up the settings", async () => {
    render(<RecoveryMode />);

    fireEvent.click(screen.getByRole("button", { name: "Backup Settings" }));

    await waitFor(() => {
      expect(mocks.backupSettingsNow).toHaveBeenCalled();
    });
    expect(screen.getByText("Settings backup created.")).toBeDefined();
  });

  it("creates a plaintext settings file", async () => {
    render(<RecoveryMode />);

    fireEvent.click(screen.getByRole("button", { name: "Create Plaintext Settings File" }));

    await waitFor(() => {
      expect(mocks.createPlaintextSettingsFile).toHaveBeenCalled();
    });
    expect(screen.getByText("Plaintext settings file created.")).toBeDefined();
  });

  it("opens the log file folder", async () => {
    render(<RecoveryMode />);

    fireEvent.click(screen.getByRole("button", { name: "Open Log File" }));

    await waitFor(() => {
      expect(mocks.openLogFolder).toHaveBeenCalled();
    });
  });
});
