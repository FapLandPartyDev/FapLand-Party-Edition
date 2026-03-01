import type { ReactElement } from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { fireEvent } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function makeLinearPlaylist(id: string, name: string, startingMoney = 120) {
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
        safePointIndices: [],
        safePointRestMsByIndex: {},
        normalRoundRefsByIndex: {},
        normalRoundOrder: [],
        cumRoundRefs: [],
      },
      saveMode: "none" as const,
      roundStartDelayMs: 20000,
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
        maxIntermediaryProbability: 1,
        maxAntiPerkProbability: 0.75,
      },
      economy: {
        startingMoney,
        moneyPerCompletedRound: 50,
        startingScore: 0,
        scorePerCompletedRound: 100,
        scorePerIntermediary: 30,
        scorePerActiveAntiPerk: 25,
        scorePerCumRoundSuccess: 420,
      },
      dice: {
        min: 1,
        max: 6,
      },
    },
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
  };
}

function makeGraphPlaylist(id: string, name: string) {
  return {
    id,
    name,
    description: null,
    formatVersion: 1,
    config: {
      playlistVersion: 1,
      boardConfig: {
        mode: "graph" as const,
        startNodeId: "start",
        nodes: [],
        edges: [],
        randomRoundPools: [],
        cumRoundRefs: [],
        pathChoiceTimeoutMs: 6000,
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
        maxIntermediaryProbability: 1,
        maxAntiPerkProbability: 0.75,
      },
      economy: {
        startingMoney: 120,
        moneyPerCompletedRound: 50,
        startingScore: 0,
        scorePerCompletedRound: 100,
        scorePerIntermediary: 30,
        scorePerActiveAntiPerk: 25,
        scorePerCumRoundSuccess: 420,
      },
    },
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
  };
}

const mocks = vi.hoisted(() => ({
  loaderData: {
    installedRounds: [] as unknown[],
    availablePlaylists: [] as unknown[],
    activePlaylist: null as unknown,
  },
  searchData: {} as Record<string, unknown>,
  navigate: vi.fn(),
  playlists: {
    list: vi.fn(),
    getActive: vi.fn(),
    setActive: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    analyzeImportFile: vi.fn(),
    importFromFile: vi.fn(),
    getExportPackageStatus: vi.fn(),
    abortExportPackage: vi.fn(),
  },
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (config: Record<string, unknown>) => ({
    ...config,
    useLoaderData: () => mocks.loaderData,
    useSearch: () => mocks.searchData,
  }),
  useNavigate: () => mocks.navigate,
}));

vi.mock("../components/AnimatedBackground", () => ({
  AnimatedBackground: () => null,
}));

vi.mock("../components/MenuButton", () => ({
  MenuButton: ({
    label,
    onClick,
    disabled,
  }: {
    label: string;
    onClick?: () => void;
    disabled?: boolean;
  }) => (
    <button type="button" onClick={onClick} disabled={disabled}>
      {label}
    </button>
  ),
}));

vi.mock("../components/PlaylistPackExportDialog", () => ({
  PlaylistPackExportDialog: () => null,
}));

vi.mock("../components/PlaylistExportOverlay", () => ({
  PlaylistExportOverlay: () => null,
}));

vi.mock("../components/PlaylistResolutionModal", () => ({
  PlaylistResolutionModal: () => null,
}));

vi.mock("../components/game/RoundVideoOverlay", () => ({
  RoundVideoOverlay: () => null,
}));

vi.mock("../features/map-editor/testSession", async () => {
  const actual = await vi.importActual("../features/map-editor/testSession");
  return actual;
});

vi.mock("../game/playlistResolution", () => ({
  analyzePlaylistResolution: vi.fn(() => ({
    issues: [],
    counts: { missing: 0, suggested: 0, exact: 0 },
  })),
  applyPlaylistResolutionMapping: vi.fn(),
}));

vi.mock("../game/playlistRuntime", () => ({
  createDefaultPlaylistConfig: vi.fn(() => ({
    playlistVersion: 1,
    boardConfig: {
      mode: "linear",
      totalIndices: 10,
      safePointIndices: [],
      safePointRestMsByIndex: {},
      normalRoundRefsByIndex: {},
      normalRoundOrder: [],
      cumRoundRefs: [],
    },
    perkSelection: { optionsPerPick: 3, triggerChancePerCompletedRound: 0.35 },
    perkPool: { enabledPerkIds: [], enabledAntiPerkIds: [] },
    probabilityScaling: {
      initialIntermediaryProbability: 0,
      initialAntiPerkProbability: 0,
      intermediaryIncreasePerRound: 0,
      antiPerkIncreasePerRound: 0,
      maxIntermediaryProbability: 0,
      maxAntiPerkProbability: 0,
    },
    economy: {
      startingMoney: 0,
      moneyPerCompletedRound: 0,
      startingScore: 0,
      scorePerCompletedRound: 0,
      scorePerIntermediary: 0,
      scorePerActiveAntiPerk: 0,
      scorePerCumRoundSuccess: 0,
    },
  })),
  resolvePortableRoundRef: vi.fn(() => null),
  toPortableRoundRef: vi.fn(),
}));

vi.mock("../game/data/perks", () => ({
  getSinglePlayerPerkPool: vi.fn(() => []),
  getSinglePlayerAntiPerkPool: vi.fn(() => []),
}));

vi.mock("../game/data/perkRarity", () => ({
  PERK_RARITY_META: {},
  resolvePerkRarity: vi.fn(() => "common"),
}));

vi.mock("../hooks/usePlayableVideoFallback", () => ({
  usePlayableVideoFallback: vi.fn(() => null),
}));

vi.mock("../hooks/useSfwMode", () => ({
  useSfwMode: vi.fn(() => false),
}));

vi.mock("../services/db", () => ({
  db: {
    round: {
      findInstalled: vi.fn(),
    },
  },
}));

vi.mock("../services/playlists", () => ({
  playlists: mocks.playlists,
}));

vi.mock("../utils/audio", () => ({
  playHoverSound: vi.fn(),
  playSelectSound: vi.fn(),
}));

import { Route } from "./playlist-workshop";

const Component = (Route as unknown as { component: () => ReactElement }).component;

beforeEach(() => {
  window.sessionStorage.clear();
  const playlist = makeGraphPlaylist("graph-playlist", "Graph Playlist");
  mocks.loaderData = {
    installedRounds: [],
    availablePlaylists: [playlist],
    activePlaylist: playlist,
  };
  mocks.searchData = {};
  mocks.playlists.list.mockResolvedValue([playlist]);
  mocks.playlists.getActive.mockResolvedValue(playlist);
  mocks.playlists.setActive.mockResolvedValue(undefined);
  mocks.playlists.create.mockResolvedValue(makeGraphPlaylist("created-playlist", "Created Playlist"));
  mocks.playlists.update.mockImplementation(async ({ playlistId, config }: { playlistId: string; config: unknown }) => ({
    ...makeLinearPlaylist(playlistId, "Updated Playlist"),
    config,
  }));
  mocks.playlists.analyzeImportFile.mockResolvedValue({
    metadata: { name: "Imported Playlist", description: null, exportedAt: null },
    config: makeGraphPlaylist("imported-playlist", "Imported Playlist").config,
    resolution: {
      issues: [],
      counts: { missing: 0, suggested: 0, exact: 0 },
      exactMapping: {},
      suggestedMapping: {},
    },
  });
  mocks.playlists.importFromFile.mockResolvedValue({
    playlist: makeGraphPlaylist("imported-playlist", "Imported Playlist"),
    report: {
      issues: [],
      counts: { missing: 0, suggested: 0, exact: 0 },
      exactMapping: {},
      suggestedMapping: {},
      appliedMapping: {},
    },
  });
  mocks.playlists.getExportPackageStatus.mockResolvedValue({ state: "idle" });
  mocks.playlists.abortExportPackage.mockResolvedValue({ state: "idle" });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("PlaylistWorkshopRoute", () => {
  it("shows an empty state when no playlist exists", async () => {
    mocks.loaderData = {
      installedRounds: [],
      availablePlaylists: [],
      activePlaylist: null,
    };

    render(<Component />);

    expect(screen.getByText(/no playlist exists yet\./i)).toBeDefined();
    expect(screen.getByRole("button", { name: "Create Playlist" })).toBeDefined();
    expect(screen.queryByRole("button", { name: "Import .fplay" })).toBeNull();
  });

  it("directs graph playlists to the advanced map editor", async () => {
    mocks.searchData = { open: "active" };
    render(<Component />);

    expect(screen.getByText("Opening Graph Editor")).toBeDefined();
    expect(
      screen.getByText(/this playlist uses a graph board, so it opens in the advanced map editor/i)
    ).toBeDefined();

    await waitFor(() => {
      expect(mocks.playlists.setActive).toHaveBeenCalledWith("graph-playlist");
      expect(mocks.navigate).toHaveBeenCalledWith({ to: "/map-editor" });
    });

    expect(window.sessionStorage.getItem("mapEditor.testPlaylistId")).toBe("graph-playlist");
  });

  it("keeps the workshop overview accessible for graph playlists by default", async () => {
    render(<Component />);

    expect(screen.getByText("Select Playlist")).toBeDefined();
    expect(screen.getByText("Open A Playlist")).toBeDefined();
    expect(screen.getByRole("button", { name: /graph playlist/i })).toBeDefined();

    await waitFor(() => {
      expect(mocks.navigate).not.toHaveBeenCalledWith({ to: "/map-editor" });
    });
  });

  it("loads and saves starting money for linear playlists", async () => {
    const playlist = makeLinearPlaylist("linear-playlist", "Linear Playlist", 275);
    mocks.loaderData = {
      installedRounds: [],
      availablePlaylists: [playlist],
      activePlaylist: playlist,
    };
    mocks.playlists.list.mockResolvedValue([playlist]);
    mocks.playlists.getActive.mockResolvedValue(playlist);

    render(<Component />);

    fireEvent.click(screen.getByRole("button", { name: /linear playlist.*open/i }));
    fireEvent.click(screen.getByRole("button", { name: /timing & probabilities/i }));

    const startingMoneyInput = await screen.findByDisplayValue("275");
    expect(startingMoneyInput).toBeDefined();

    fireEvent.change(startingMoneyInput, { target: { value: "410" } });
    fireEvent.click(screen.getByRole("button", { name: "💾 Save" }));

    await waitFor(() => {
      expect(mocks.playlists.update).toHaveBeenCalledTimes(1);
    });

    const updateCall = mocks.playlists.update.mock.calls[0]?.[0] as {
      config: ReturnType<typeof makeLinearPlaylist>["config"];
    };
    expect(updateCall.config.economy.startingMoney).toBe(410);
  });
});
