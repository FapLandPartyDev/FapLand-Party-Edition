import type { ReactElement } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  loaderData: {
    localHighscore: 900,
    localHighscoreCheatMode: false,
    localHighscoreAssisted: false,
    localHighscoreAssistedSaveMode: null,
    singleRuns: [
      {
        id: "run-1",
        finishedAt: "2026-03-20T10:00:00.000Z",
        score: 540,
        survivedDurationSec: 812,
        highscoreBefore: 500,
        highscoreAfter: 540,
        wasNewHighscore: true,
        completionReason: "finished",
        playlistId: "playlist-1",
        playlistName: "Default Playlist",
        playlistFormatVersion: 1,
        endingPosition: 100,
        turn: 42,
        cheatModeActive: false,
        assistedActive: false,
        assistedSaveMode: null,
        createdAt: "2026-03-20T10:00:00.000Z",
      },
      {
        id: "run-2",
        finishedAt: "2026-03-20T09:00:00.000Z",
        score: 320,
        survivedDurationSec: null,
        highscoreBefore: 540,
        highscoreAfter: 540,
        wasNewHighscore: false,
        completionReason: "self_reported_cum",
        playlistId: "playlist-2",
        playlistName: "",
        playlistFormatVersion: 1,
        endingPosition: 74,
        turn: 28,
        cheatModeActive: false,
        assistedActive: false,
        assistedSaveMode: null,
        createdAt: "2026-03-20T09:00:00.000Z",
      },
    ],
    cachedViews: [],
    initialSyncQueueCount: 0,
    gameplayStats: {
      summary: {
        activePlayMs: 7200000,
        watchedDurationMs: 3600000,
        scheduledDurationMs: 5400000,
        sessionCount: 2,
        roundPlayCount: 3,
        interjectionPlayCount: 1,
        cumLosses: 2,
        cameAsTold: 1,
      },
      coverage: {
        hasLegacyData: true,
        watchedPlayCount: 2,
        scheduledPlayCount: 2,
        totalPlayCount: 3,
      },
      unassignedLegacyOutcomes: 1,
      rounds: [
        {
          roundId: "round-1",
          roundName: "Hard Round",
          roundType: "Normal",
          modes: ["single_player"],
          playCount: 3,
          watchedDurationMs: 3600000,
          scheduledDurationMs: 5400000,
          watchedCoverageCount: 2,
          scheduledCoverageCount: 2,
          cumLosses: 2,
          cameAsTold: 1,
          didNotCum: 0,
          lastPlayedAt: "2026-03-20T10:00:00.000Z",
        },
      ],
    },
    gameplaySessions: { sessions: [], nextCursor: null },
  },
  navigate: vi.fn(),
  db: {
    gameProfile: {
      getLocalHighscore: vi.fn().mockResolvedValue({
        highscore: 900,
        highscoreCheatMode: false,
        highscoreAssisted: false,
        highscoreAssistedSaveMode: null,
      }),
    },
    singlePlayerHistory: {
      listRuns: vi.fn().mockResolvedValue([]),
      deleteRun: vi.fn().mockResolvedValue({
        highscore: 320,
        highscoreCheatMode: false,
        highscoreAssisted: false,
        highscoreAssistedSaveMode: null,
      }),
    },
    gameplayStats: {
      getStats: vi.fn(),
      listSessions: vi.fn(),
    },
    multiplayer: {
      listResultSyncLobbies: vi.fn().mockResolvedValue([]),
      listMatchCache: vi.fn().mockResolvedValue([]),
      upsertMatchCache: vi.fn(),
      removeResultSyncLobby: vi.fn(),
      touchResultSyncLobby: vi.fn(),
    },
  },
  multiplayer: {
    listMatchHistory: vi.fn().mockResolvedValue([]),
    getMatchHistoryByLobby: vi.fn(),
    parseHistoryStandings: vi.fn(),
    parseStandingsJson: vi.fn().mockReturnValue([]),
  },
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (config: Record<string, unknown>) => ({
    ...config,
    useLoaderData: () => mocks.loaderData,
  }),
  useNavigate: () => mocks.navigate,
}));

vi.mock("../services/db", () => ({
  db: mocks.db,
}));

vi.mock("../services/multiplayer", () => mocks.multiplayer);

vi.mock("../components/AnimatedBackground", () => ({
  AnimatedBackground: () => null,
}));

vi.mock("../components/MenuButton", () => ({
  MenuButton: ({ label, onClick }: { label: string; onClick?: () => void }) => (
    <button type="button" onClick={onClick}>
      {label}
    </button>
  ),
}));

vi.mock("../hooks/useSfwMode", () => ({
  useSfwMode: () => false,
}));

vi.mock("../utils/audio", () => ({
  resolveAssetUrl: (path: string) => path,
  playHoverSound: vi.fn(),
  playSelectSound: vi.fn(),
}));

class AudioMock {
  volume = 1;
  loop = false;
  play() {
    return Promise.resolve();
  }
  pause() {}
}

import { Route } from "./highscores";

const Component = (Route as unknown as { component: () => ReactElement }).component;

describe("HighscoresRoute", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    mocks.loaderData.singleRuns = [
      {
        id: "run-1",
        finishedAt: "2026-03-20T10:00:00.000Z",
        score: 540,
        survivedDurationSec: 812,
        highscoreBefore: 500,
        highscoreAfter: 540,
        wasNewHighscore: true,
        completionReason: "finished",
        playlistId: "playlist-1",
        playlistName: "Default Playlist",
        playlistFormatVersion: 1,
        endingPosition: 100,
        turn: 42,
        cheatModeActive: false,
        assistedActive: false,
        assistedSaveMode: null,
        createdAt: "2026-03-20T10:00:00.000Z",
      },
      {
        id: "run-2",
        finishedAt: "2026-03-20T09:00:00.000Z",
        score: 320,
        survivedDurationSec: null,
        highscoreBefore: 540,
        highscoreAfter: 540,
        wasNewHighscore: false,
        completionReason: "self_reported_cum",
        playlistId: "playlist-2",
        playlistName: "",
        playlistFormatVersion: 1,
        endingPosition: 74,
        turn: 28,
        cheatModeActive: false,
        assistedActive: false,
        assistedSaveMode: null,
        createdAt: "2026-03-20T09:00:00.000Z",
      },
    ];
    mocks.navigate.mockReset();
    mocks.db.gameProfile.getLocalHighscore.mockResolvedValue({
      highscore: 900,
      highscoreCheatMode: false,
      highscoreAssisted: false,
      highscoreAssistedSaveMode: null,
    });
    mocks.db.singlePlayerHistory.listRuns.mockResolvedValue(mocks.loaderData.singleRuns);
    mocks.db.gameplayStats.getStats.mockResolvedValue(mocks.loaderData.gameplayStats);
    mocks.db.gameplayStats.listSessions.mockResolvedValue(mocks.loaderData.gameplaySessions);
    mocks.db.singlePlayerHistory.deleteRun.mockReset();
    mocks.db.singlePlayerHistory.deleteRun.mockImplementation(async (id: string) => {
      mocks.loaderData.singleRuns = mocks.loaderData.singleRuns.filter((run) => run.id !== id);
      mocks.db.singlePlayerHistory.listRuns.mockResolvedValue(mocks.loaderData.singleRuns);
      mocks.db.gameProfile.getLocalHighscore.mockResolvedValue({
        highscore: 320,
        highscoreCheatMode: false,
        highscoreAssisted: false,
        highscoreAssistedSaveMode: null,
      });
      return {
        highscore: 320,
        highscoreCheatMode: false,
        highscoreAssisted: false,
        highscoreAssistedSaveMode: null,
      };
    });
    vi.stubGlobal("Audio", AudioMock);
  });

  it("renders survived duration for new rows and fallback for legacy rows", () => {
    render(<Component />);
    fireEvent.click(screen.getByRole("button", { name: "Single-Player" }));

    expect(screen.getAllByText(/Survived:/)).toHaveLength(2);
    expect(screen.getAllByText("13:32")).toHaveLength(2);
    expect(screen.getByText("Legacy run")).toBeTruthy();
    expect(screen.getAllByText(/Playlist:/)).toHaveLength(2);
    expect(screen.getByText("Default Playlist")).toBeTruthy();
    expect(screen.getByText("playlist-2")).toBeTruthy();
  });

  it("renders highscore hub section labels beside the icons", () => {
    render(<Component />);

    expect(screen.getByRole("button", { name: "Overview" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Statistics" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Single-Player" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Multiplayer" })).toBeTruthy();
  });

  it("shows combined gameplay totals and loss-ranked rounds", () => {
    render(<Component />);
    fireEvent.click(screen.getByRole("button", { name: "Statistics" }));

    expect(screen.getByText("Personal Gameplay Totals")).toBeTruthy();
    expect(screen.getByText("Hard Round")).toBeTruthy();
    expect(screen.getByText(/legacy cum outcomes could not be assigned/i)).toBeTruthy();
    expect(
      (screen.getByRole("combobox", { name: "Round ranking sort" }) as HTMLSelectElement).value
    ).toBe("losses");
  });

  it("deletes a run from the single-player history view", async () => {
    render(<Component />);
    fireEvent.click(screen.getAllByRole("button", { name: "Single-Player" })[0]!);
    fireEvent.click(screen.getByRole("button", { name: "Delete run 540" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm Deletion" }));

    await waitFor(() => {
      expect(mocks.db.singlePlayerHistory.deleteRun).toHaveBeenCalledWith("run-1");
      expect(screen.queryByRole("button", { name: "Confirm Deletion" })).toBeNull();
    });
  });

  it("does not delete a run when confirmation is cancelled", async () => {
    render(<Component />);
    fireEvent.click(screen.getAllByRole("button", { name: "Single-Player" })[0]!);
    fireEvent.click(screen.getByRole("button", { name: "Delete run 540" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    await waitFor(() => {
      expect(mocks.db.singlePlayerHistory.deleteRun).not.toHaveBeenCalled();
    });
    expect(screen.getByRole("button", { name: "Delete run 540" })).toBeTruthy();
  });
});
