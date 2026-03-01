import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function makePlaylist(id: string, name: string) {
  return {
    id,
    name,
    description: null,
    formatVersion: 1,
    config: {
      playlistVersion: 1,
      boardConfig: {
        mode: "linear" as const,
        totalIndices: 10,
        safePointIndices: [5],
        normalRoundRefsByIndex: {},
        normalRoundOrder: [],
        cumRoundRefs: [],
      },
      perkSelection: {
        optionsPerPick: 3,
        triggerChancePerCompletedRound: 0.35,
      },
      perkPool: {
        enabledPerkIds: [],
        enabledAntiPerkIds: [],
      },
      probabilityScaling: {
        initialIntermediaryProbability: 0,
        initialAntiPerkProbability: 0,
        intermediaryIncreasePerRound: 0.02,
        antiPerkIncreasePerRound: 0.015,
        maxIntermediaryProbability: 0.85,
        maxAntiPerkProbability: 0.75,
      },
      economy: {
        startingMoney: 120,
        moneyPerCompletedRound: 50,
        startingScore: 0,
        scorePerCompletedRound: 100,
        scorePerIntermediary: 30,
        scorePerActiveAntiPerk: 25,
        scorePerCumRoundSuccess: 120,
      },
    },
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
  };
}

const mocks = vi.hoisted(() => ({
  loaderData: {
    availablePlaylists: [] as unknown[],
    activePlaylist: null as unknown,
  },
  navigate: vi.fn(),
  playlists: {
    setActive: vi.fn(),
  },
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => () => ({
    useLoaderData: () => mocks.loaderData,
  }),
  useNavigate: () => mocks.navigate,
}));

vi.mock("../components/AnimatedBackground", () => ({
  AnimatedBackground: () => null,
}));

vi.mock("../components/MenuButton", () => ({
  MenuButton: ({ label, onClick }: { label: string; onClick?: () => void }) => (
    <button type="button" onClick={onClick}>{label}</button>
  ),
}));

vi.mock("../components/PlaylistMapPreview", () => ({
  PlaylistMapPreview: () => <div data-testid="playlist-preview" />,
}));

vi.mock("../services/playlists", () => ({
  playlists: mocks.playlists,
}));

vi.mock("../utils/audio", () => ({
  playHoverSound: vi.fn(),
  playSelectSound: vi.fn(),
}));

import { SinglePlayerSetupRoute } from "./single-player-setup";

beforeEach(() => {
  mocks.playlists.setActive.mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("SinglePlayerSetupRoute", () => {
  it("uses active playlist as default selection when starting", async () => {
    const first = makePlaylist("playlist-1", "First Playlist");
    const second = makePlaylist("playlist-2", "Second Playlist");
    mocks.loaderData = {
      availablePlaylists: [first, second],
      activePlaylist: second,
    };

    render(<SinglePlayerSetupRoute />);
    fireEvent.click(screen.getByRole("button", { name: "Start Selected Playlist" }));

    await waitFor(() => {
      expect(mocks.playlists.setActive).toHaveBeenCalledWith("playlist-2");
      expect(mocks.navigate).toHaveBeenCalledWith({ to: "/game" });
    });
  });

  it("opens workshop with the selected playlist", async () => {
    const first = makePlaylist("playlist-1", "First Playlist");
    const second = makePlaylist("playlist-2", "Second Playlist");
    mocks.loaderData = {
      availablePlaylists: [first, second],
      activePlaylist: first,
    };

    render(<SinglePlayerSetupRoute />);
    fireEvent.click(screen.getByRole("button", { name: /Second Playlist/i }));
    fireEvent.click(screen.getByRole("button", { name: "Open Playlist Workshop" }));

    await waitFor(() => {
      expect(mocks.playlists.setActive).toHaveBeenCalledWith("playlist-2");
      expect(mocks.navigate).toHaveBeenCalledWith({ to: "/playlist-workshop" });
    });
  });

  it("falls back to active playlist when active is not in list", async () => {
    const first = makePlaylist("playlist-1", "First Playlist");
    const active = makePlaylist("playlist-active", "Active Playlist");
    mocks.loaderData = {
      availablePlaylists: [first],
      activePlaylist: active,
    };

    render(<SinglePlayerSetupRoute />);
    expect(screen.getByTestId("playlist-preview")).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "Start Selected Playlist" }));

    await waitFor(() => {
      expect(mocks.playlists.setActive).toHaveBeenCalledWith("playlist-active");
    });
  });

  it("shows an empty state when no playlists exist", () => {
    mocks.loaderData = {
      availablePlaylists: [],
      activePlaylist: null,
    };

    render(<SinglePlayerSetupRoute />);

    expect(screen.getByText("No Playlist Yet")).toBeDefined();
    expect(screen.getByRole("button", { name: "Open Playlist Workshop" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Open Map Editor" })).toBeDefined();
  });
});
