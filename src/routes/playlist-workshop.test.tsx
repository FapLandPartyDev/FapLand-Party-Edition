import type { ReactElement } from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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

function makeRound(
  id: string,
  name: string,
  options: {
    author?: string;
    difficulty?: number | null;
    type?: "Normal" | "Cum";
    durationMs?: number;
  } = {}
) {
  return {
    id,
    heroId: null,
    name,
    author: options.author ?? "Author",
    type: options.type ?? "Normal",
    difficulty: options.difficulty ?? null,
    previewImage: null,
    startTime: 0,
    endTime: options.durationMs ?? 180000,
    resources: [],
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
  installedRoundsCache: {
    getInstalledRoundCatalogCached: vi.fn(async () => []),
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
  resolvePortableRoundRef: vi.fn((ref: { idHint?: string }, installedRounds: Array<{ id: string }>) =>
    installedRounds.find((round) => round.id === ref.idHint) ?? null
  ),
  toPortableRoundRef: vi.fn((round: {
    id: string;
    name: string;
    author?: string | null;
    type?: string | null;
  }) => ({
    idHint: round.id,
    name: round.name,
    author: round.author ?? undefined,
    type: round.type ?? "Normal",
  })),
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
  usePlayableVideoFallback: vi.fn(() => ({
    getVideoSrc: (uri: string) => uri,
    ensurePlayableVideo: vi.fn(async () => null),
    handleVideoError: vi.fn(),
  })),
}));

vi.mock("../hooks/useInstalledRoundMedia", () => ({
  useInstalledRoundMedia: vi.fn(() => ({
    mediaResources: null,
    isLoading: false,
    loadMediaResources: vi.fn(async () => null),
  })),
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

vi.mock("../services/installedRoundsCache", () => ({
  getInstalledRoundCatalogCached: mocks.installedRoundsCache.getInstalledRoundCatalogCached,
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
let animationFrameQueue: Array<FrameRequestCallback | undefined> = [];

function flushAnimationFrames() {
  const callbacks = animationFrameQueue;
  animationFrameQueue = [];
  callbacks.forEach((callback) => callback?.(performance.now()));
}

async function waitForRoundsReady() {
  await waitFor(() => {
    flushAnimationFrames();
    expect(screen.getByText("Selected Rounds")).toBeDefined();
  });
}

function buildRoundRef(round: ReturnType<typeof makeRound>) {
  return {
    idHint: round.id,
    name: round.name,
    author: round.author,
    type: round.type,
  };
}

function getSectionByHeading(heading: string): HTMLElement {
  const section = screen.getByText(heading).closest("section");
  if (!section) {
    throw new Error(`Could not find section for heading: ${heading}`);
  }
  return section as HTMLElement;
}

function clickSidebarSection(sectionName: "Rounds" | "Session") {
  const sectionButton = screen
    .getAllByRole("button")
    .find((button) => button.textContent?.includes(sectionName));
  if (!sectionButton) {
    throw new Error(`Could not find section button: ${sectionName}`);
  }

  fireEvent.click(sectionButton);
}

async function openLinearPlaylistAndSection(
  playlistName: string,
  sectionName: "Rounds" | "Session"
) {
  render(<Component />);

  fireEvent.click(screen.getByRole("button", { name: new RegExp(`${playlistName}.*open`, "i") }));

  clickSidebarSection(sectionName);

  if (sectionName === "Rounds") {
    await waitForRoundsReady();
  }

  const readyHeading = sectionName === "Rounds" ? "Selected Rounds" : "Round Count";
  await waitFor(() => {
    expect(screen.getByText(readyHeading)).toBeDefined();
  });
}

beforeEach(() => {
  animationFrameQueue = [];
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    animationFrameQueue.push(callback);
    return animationFrameQueue.length;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => {
    if (id <= 0) return;
    animationFrameQueue[id - 1] = undefined;
  });
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
  mocks.installedRoundsCache.getInstalledRoundCatalogCached.mockImplementation(
    async () => mocks.loaderData.installedRounds
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
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

  it("opens a linear playlist from the overview without changing hook order", async () => {
    const playlist = makeLinearPlaylist("linear-playlist", "Linear Playlist");
    mocks.loaderData = {
      installedRounds: [],
      availablePlaylists: [playlist],
      activePlaylist: null,
    };
    mocks.playlists.list.mockResolvedValue([playlist]);
    mocks.playlists.getActive.mockResolvedValue(null);

    render(<Component />);

    expect(screen.getByText("Open A Playlist")).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: /linear playlist.*open/i }));

    await waitFor(() => {
      expect(screen.getByText("Select, create, and manage playlists.")).toBeDefined();
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

  it("switches the editable playlist when selecting from the active playlist menu", async () => {
    const alpha = makeLinearPlaylist("alpha-playlist", "Alpha Playlist");
    const beta = makeLinearPlaylist("beta-playlist", "Beta Playlist", 375);
    mocks.loaderData = {
      installedRounds: [],
      availablePlaylists: [alpha, beta],
      activePlaylist: alpha,
    };
    mocks.playlists.list.mockResolvedValue([alpha, beta]);
    mocks.playlists.getActive.mockResolvedValue(beta);

    render(<Component />);

    fireEvent.click(screen.getByRole("button", { name: /alpha playlist.*open/i }));
    fireEvent.click(screen.getByRole("button", { name: /active playlist.*alpha playlist/i }));
    fireEvent.click(screen.getByRole("button", { name: /beta playlist.*select/i }));

    await waitFor(() => {
      expect(mocks.playlists.setActive).toHaveBeenCalledWith("beta-playlist");
      expect(screen.getByRole("button", { name: /active playlist.*beta playlist/i })).toBeDefined();
    });
  });

  it("moves added rounds into the selected queue and auto-grows round count", async () => {
    const playlist = makeLinearPlaylist("linear-playlist", "Linear Playlist");
    playlist.config.boardConfig.totalIndices = 2;
    const rounds = [
      makeRound("round-1", "Round 1"),
      makeRound("round-2", "Round 2"),
      makeRound("round-3", "Round 3"),
    ];

    mocks.loaderData = {
      installedRounds: rounds,
      availablePlaylists: [playlist],
      activePlaylist: playlist,
    };
    mocks.playlists.list.mockResolvedValue([playlist]);
    mocks.playlists.getActive.mockResolvedValue(playlist);

    await openLinearPlaylistAndSection("Linear Playlist", "Rounds");

    const selectedSection = getSectionByHeading("Selected Rounds");
    const availableSection = getSectionByHeading("Available Rounds");

    for (const roundName of ["Round 1", "Round 2", "Round 3"]) {
      const roundCard = within(availableSection).getByRole("group", {
        name: `Available round ${roundName}`,
      });
      fireEvent.click(within(roundCard).getByRole("button", { name: "Add to queue" }));
    }

    expect(within(selectedSection).getByText("Round 1")).toBeDefined();
    expect(within(selectedSection).getByText("Round 2")).toBeDefined();
    expect(within(selectedSection).getByText("Round 3")).toBeDefined();
    expect(within(availableSection).queryByText("Round 1")).toBeNull();
    expect(within(availableSection).queryByText("Round 2")).toBeNull();
    expect(within(availableSection).queryByText("Round 3")).toBeNull();

    clickSidebarSection("Session");
    expect(screen.getByDisplayValue("3")).toBeDefined();
  });

  it("accounts for safe points when auto-growing queue capacity", async () => {
    const playlist = makeLinearPlaylist("linear-playlist", "Linear Playlist");
    playlist.config.boardConfig.totalIndices = 3;
    playlist.config.boardConfig.safePointIndices = [2];
    const round1 = makeRound("round-1", "Round 1");
    const round2 = makeRound("round-2", "Round 2");
    const round3 = makeRound("round-3", "Round 3");
    playlist.config.boardConfig.normalRoundOrder = [buildRoundRef(round1), buildRoundRef(round2)];

    mocks.loaderData = {
      installedRounds: [round1, round2, round3],
      availablePlaylists: [playlist],
      activePlaylist: playlist,
    };
    mocks.playlists.list.mockResolvedValue([playlist]);
    mocks.playlists.getActive.mockResolvedValue(playlist);

    await openLinearPlaylistAndSection("Linear Playlist", "Rounds");

    const availableSection = getSectionByHeading("Available Rounds");
    const roundCard = within(availableSection).getByRole("group", {
      name: "Available round Round 3",
    });
    fireEvent.click(within(roundCard).getByRole("button", { name: "Add to queue" }));

    expect(screen.getByText("Minimum Round Count: 4")).toBeDefined();

    clickSidebarSection("Session");
    expect(screen.getByDisplayValue("4")).toBeDefined();
  });

  it("clamps round count instead of pruning selected rounds", async () => {
    const playlist = makeLinearPlaylist("linear-playlist", "Linear Playlist");
    playlist.config.boardConfig.totalIndices = 10;
    playlist.config.boardConfig.safePointIndices = [2];
    const rounds = [
      makeRound("round-1", "Round 1"),
      makeRound("round-2", "Round 2"),
      makeRound("round-3", "Round 3"),
      makeRound("round-4", "Round 4"),
    ];
    playlist.config.boardConfig.normalRoundOrder = rounds.map(buildRoundRef);

    mocks.loaderData = {
      installedRounds: rounds,
      availablePlaylists: [playlist],
      activePlaylist: playlist,
    };
    mocks.playlists.list.mockResolvedValue([playlist]);
    mocks.playlists.getActive.mockResolvedValue(playlist);

    await openLinearPlaylistAndSection("Linear Playlist", "Rounds");

    clickSidebarSection("Session");
    expect(await screen.findByText("Round Count")).toBeDefined();

    const roundCountInput = screen.getByDisplayValue("10");
    fireEvent.change(roundCountInput, { target: { value: "3" } });

    expect(screen.getByDisplayValue("5")).toBeDefined();

    clickSidebarSection("Rounds");
    await waitForRoundsReady();

    expect(screen.getByText("Selected: 4")).toBeDefined();
    expect(screen.getByText("Minimum Round Count: 5")).toBeDefined();
  });

  it("sorts selected rounds by difficulty with unknown first", async () => {
    const playlist = makeLinearPlaylist("linear-playlist", "Linear Playlist");
    const hard = makeRound("round-hard", "Hard Round", { difficulty: 5 });
    const easy = makeRound("round-easy", "Easy Round", { difficulty: 1 });
    const unknown = makeRound("round-unknown", "Mystery Round", { difficulty: null });
    playlist.config.boardConfig.normalRoundOrder = [
      buildRoundRef(hard),
      buildRoundRef(easy),
      buildRoundRef(unknown),
    ];

    mocks.loaderData = {
      installedRounds: [hard, easy, unknown],
      availablePlaylists: [playlist],
      activePlaylist: playlist,
    };
    mocks.playlists.list.mockResolvedValue([playlist]);
    mocks.playlists.getActive.mockResolvedValue(playlist);

    await openLinearPlaylistAndSection("Linear Playlist", "Rounds");

    const selectedSection = getSectionByHeading("Selected Rounds");
    fireEvent.click(within(selectedSection).getByRole("button", { name: /Sort/i }));
    expect(screen.getByText("Reorder selected rounds?")).toBeDefined();
    const sortConfirmButtons = screen.getAllByRole("button", { name: "Sort by Difficulty" });
    fireEvent.click(sortConfirmButtons[sortConfirmButtons.length - 1]!);
    fireEvent.click(screen.getByRole("button", { name: "💾 Save" }));

    await waitFor(() => {
      expect(mocks.playlists.update).toHaveBeenCalledTimes(1);
    });

    const updateCall = mocks.playlists.update.mock.calls[0]?.[0] as {
      config: ReturnType<typeof makeLinearPlaylist>["config"];
    };

    expect(updateCall.config.boardConfig.normalRoundOrder).toEqual([
      buildRoundRef(unknown),
      buildRoundRef(easy),
      buildRoundRef(hard),
    ]);
  });

  it("asks for confirmation before changing the whole selected round order", async () => {
    const playlist = makeLinearPlaylist("linear-playlist", "Linear Playlist");
    const rounds = [
      makeRound("round-1", "Round 1", { difficulty: 3 }),
      makeRound("round-2", "Round 2", { difficulty: 1 }),
      makeRound("round-3", "Round 3", { difficulty: 5 }),
    ];
    playlist.config.boardConfig.normalRoundOrder = rounds.map(buildRoundRef);

    mocks.loaderData = {
      installedRounds: rounds,
      availablePlaylists: [playlist],
      activePlaylist: playlist,
    };
    mocks.playlists.list.mockResolvedValue([playlist]);
    mocks.playlists.getActive.mockResolvedValue(playlist);

    await openLinearPlaylistAndSection("Linear Playlist", "Rounds");

    const selectedSection = getSectionByHeading("Selected Rounds");
    for (const buttonName of [/Sort by Difficulty/i, /Random/i, /Progressive/i]) {
      fireEvent.click(within(selectedSection).getByRole("button", { name: buttonName }));
      expect(screen.getByText("Reorder selected rounds?")).toBeDefined();
      expect(
        screen.getByText("This changes the order of the entire selected round list. Continue?")
      ).toBeDefined();
      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    }

    fireEvent.click(within(selectedSection).getByRole("button", { name: /Clear/i }));
    expect(screen.getByText("Clear selected rounds?")).toBeDefined();
    expect(
      screen.getByText("This changes the order of the entire selected round list. Continue?")
    ).toBeDefined();
  });

  it("adds visible rounds in the current available order and saves round count", async () => {
    const playlist = makeLinearPlaylist("linear-playlist", "Linear Playlist");
    playlist.config.boardConfig.totalIndices = 2;
    const selected = makeRound("round-3", "Charlie Round");
    const alpha = makeRound("round-1", "Alpha Round");
    const bravo = makeRound("round-2", "Bravo Round");
    playlist.config.boardConfig.normalRoundOrder = [buildRoundRef(selected)];

    mocks.loaderData = {
      installedRounds: [selected, bravo, alpha],
      availablePlaylists: [playlist],
      activePlaylist: playlist,
    };
    mocks.playlists.list.mockResolvedValue([playlist]);
    mocks.playlists.getActive.mockResolvedValue(playlist);

    await openLinearPlaylistAndSection("Linear Playlist", "Rounds");

    const availableSection = getSectionByHeading("Available Rounds");
    fireEvent.click(within(availableSection).getByRole("button", { name: "Add Visible" }));
    fireEvent.click(screen.getByRole("button", { name: "💾 Save" }));

    await waitFor(() => {
      expect(mocks.playlists.update).toHaveBeenCalledTimes(1);
    });

    const updateCall = mocks.playlists.update.mock.calls[0]?.[0] as {
      config: ReturnType<typeof makeLinearPlaylist>["config"];
    };

    expect(updateCall.config.boardConfig.totalIndices).toBe(3);
    expect(updateCall.config.boardConfig.normalRoundOrder).toEqual([
      buildRoundRef(selected),
      buildRoundRef(alpha),
      buildRoundRef(bravo),
    ]);
  });

  it("returns removed rounds to the available list", async () => {
    const playlist = makeLinearPlaylist("linear-playlist", "Linear Playlist");
    const selected = makeRound("round-1", "Round 1");
    const extra = makeRound("round-2", "Round 2");
    playlist.config.boardConfig.normalRoundOrder = [buildRoundRef(selected)];

    mocks.loaderData = {
      installedRounds: [selected, extra],
      availablePlaylists: [playlist],
      activePlaylist: playlist,
    };
    mocks.playlists.list.mockResolvedValue([playlist]);
    mocks.playlists.getActive.mockResolvedValue(playlist);

    await openLinearPlaylistAndSection("Linear Playlist", "Rounds");

    const selectedSection = getSectionByHeading("Selected Rounds");
    const availableSection = getSectionByHeading("Available Rounds");
    const roundCard = within(selectedSection).getByRole("group", {
      name: "Selected round Round 1",
    });

    fireEvent.click(within(roundCard).getByRole("button", { name: "Remove from queue" }));

    expect(within(selectedSection).queryByText("Round 1")).toBeNull();
    expect(within(availableSection).getByText("Round 1")).toBeDefined();
  });

  it("shows a rounds skeleton again when re-entering the rounds section", async () => {
    const playlist = makeLinearPlaylist("linear-playlist", "Linear Playlist");
    const rounds = [makeRound("round-1", "Round 1"), makeRound("round-2", "Round 2")];

    mocks.loaderData = {
      installedRounds: rounds,
      availablePlaylists: [playlist],
      activePlaylist: playlist,
    };
    mocks.playlists.list.mockResolvedValue([playlist]);
    mocks.playlists.getActive.mockResolvedValue(playlist);

    await openLinearPlaylistAndSection("Linear Playlist", "Rounds");

    clickSidebarSection("Session");
    expect(await screen.findByText("Round Count")).toBeDefined();

    clickSidebarSection("Rounds");

    expect(screen.queryByText("Selected Rounds")).toBeNull();
    expect(document.querySelectorAll(".animate-pulse").length).toBeGreaterThan(0);

    await waitForRoundsReady();
  });

  it("does not refetch the installed round catalog when re-entering rounds", async () => {
    const playlist = makeLinearPlaylist("linear-playlist", "Linear Playlist");
    const rounds = [makeRound("round-1", "Round 1"), makeRound("round-2", "Round 2")];

    mocks.loaderData = {
      installedRounds: rounds,
      availablePlaylists: [playlist],
      activePlaylist: playlist,
    };
    mocks.playlists.list.mockResolvedValue([playlist]);
    mocks.playlists.getActive.mockResolvedValue(playlist);

    await openLinearPlaylistAndSection("Linear Playlist", "Rounds");
    expect(mocks.installedRoundsCache.getInstalledRoundCatalogCached).toHaveBeenCalledTimes(1);

    clickSidebarSection("Session");
    expect(await screen.findByText("Round Count")).toBeDefined();

    clickSidebarSection("Rounds");
    await waitForRoundsReady();
    expect(mocks.installedRoundsCache.getInstalledRoundCatalogCached).toHaveBeenCalledTimes(1);
  });

  it("renders large available round catalogs after virtualization is ready", async () => {
    const playlist = makeLinearPlaylist("linear-playlist", "Linear Playlist");
    const rounds = Array.from({ length: 75 }, (_, index) =>
      makeRound(`round-${index + 1}`, `Round ${index + 1}`)
    );

    mocks.loaderData = {
      installedRounds: rounds,
      availablePlaylists: [playlist],
      activePlaylist: playlist,
    };
    mocks.playlists.list.mockResolvedValue([playlist]);
    mocks.playlists.getActive.mockResolvedValue(playlist);

    render(<Component />);

    fireEvent.click(screen.getByRole("button", { name: /linear playlist.*open/i }));
    clickSidebarSection("Rounds");

    await waitForRoundsReady();
    await waitFor(() => {
      expect(screen.queryByLabelText("Preparing available rounds")).toBeNull();
      expect(screen.getByRole("group", { name: "Available round Round 1" })).toBeDefined();
    });
  });

  it("renders small available round catalogs without the virtualization placeholder", async () => {
    const playlist = makeLinearPlaylist("linear-playlist", "Linear Playlist");
    const rounds = Array.from({ length: 6 }, (_, index) =>
      makeRound(`round-${index + 1}`, `Round ${index + 1}`)
    );

    mocks.loaderData = {
      installedRounds: rounds,
      availablePlaylists: [playlist],
      activePlaylist: playlist,
    };
    mocks.playlists.list.mockResolvedValue([playlist]);
    mocks.playlists.getActive.mockResolvedValue(playlist);

    await openLinearPlaylistAndSection("Linear Playlist", "Rounds");

    expect(screen.queryByLabelText("Preparing available rounds")).toBeNull();
    expect(screen.getByRole("group", { name: "Available round Round 1" })).toBeDefined();
  });

  it("renders exactly fifty available rounds without the virtualization placeholder", async () => {
    const playlist = makeLinearPlaylist("linear-playlist", "Linear Playlist");
    const rounds = Array.from({ length: 50 }, (_, index) =>
      makeRound(`round-${index + 1}`, `Round ${index + 1}`)
    );

    mocks.loaderData = {
      installedRounds: rounds,
      availablePlaylists: [playlist],
      activePlaylist: playlist,
    };
    mocks.playlists.list.mockResolvedValue([playlist]);
    mocks.playlists.getActive.mockResolvedValue(playlist);

    await openLinearPlaylistAndSection("Linear Playlist", "Rounds");

    expect(screen.queryByLabelText("Preparing available rounds")).toBeNull();
    expect(screen.getByRole("group", { name: "Available round Round 1" })).toBeDefined();
    expect(screen.getByRole("group", { name: "Available round Round 50" })).toBeDefined();
  });

  it("renders fifty-one available rounds through virtualization", async () => {
    const playlist = makeLinearPlaylist("linear-playlist", "Linear Playlist");
    const rounds = Array.from({ length: 51 }, (_, index) =>
      makeRound(`round-${index + 1}`, `Round ${index + 1}`)
    );

    mocks.loaderData = {
      installedRounds: rounds,
      availablePlaylists: [playlist],
      activePlaylist: playlist,
    };
    mocks.playlists.list.mockResolvedValue([playlist]);
    mocks.playlists.getActive.mockResolvedValue(playlist);

    render(<Component />);

    fireEvent.click(screen.getByRole("button", { name: /linear playlist.*open/i }));
    clickSidebarSection("Rounds");

    await waitForRoundsReady();
    await waitFor(() => {
      expect(screen.queryByLabelText("Preparing available rounds")).toBeNull();
      expect(screen.getByRole("group", { name: "Available round Round 1" })).toBeDefined();
    });
  });
});
