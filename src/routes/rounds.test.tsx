import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { InstalledRound } from "../services/db";

const mocks = vi.hoisted(() => ({
  loaderData: {
    rounds: [] as InstalledRound[],
    intermediaryLoadingPrompt: "animated gif webm",
    intermediaryLoadingDurationSec: 10,
    intermediaryReturnPauseSec: 4,
  },
  navigate: vi.fn(),
  db: {
    hero: {
      update: vi.fn(),
      delete: vi.fn(),
    },
    round: {
      findInstalled: vi.fn(),
      getDisabledIds: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      convertHeroGroupToRound: vi.fn(),
    },
    install: {
      getScanStatus: vi.fn(),
      abortScan: vi.fn(),
      scanNow: vi.fn(),
      inspectFolder: vi.fn(),
      importSidecarFile: vi.fn(),
      importLegacyWithPlan: vi.fn(),
      scanFolderOnce: vi.fn(),
      exportDatabase: vi.fn(),
      openExportFolder: vi.fn(),
    },
  },
  playlists: {
    create: vi.fn(),
    importFromFile: vi.fn(),
    setActive: vi.fn(),
  },
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => () => ({
    useLoaderData: () => mocks.loaderData,
  }),
  useNavigate: () => mocks.navigate,
}));

vi.mock("../services/db", () => ({
  db: mocks.db,
}));

vi.mock("../services/playlists", () => ({
  playlists: mocks.playlists,
}));

vi.mock("../services/trpc", () => ({
  trpc: {
    store: {
      get: {
        query: vi.fn(),
      },
    },
  },
}));

vi.mock("../utils/audio", () => ({
  playHoverSound: vi.fn(),
  playSelectSound: vi.fn(),
}));

vi.mock("../components/AnimatedBackground", () => ({
  AnimatedBackground: () => null,
}));

vi.mock("../components/game/RoundVideoOverlay", () => ({
  RoundVideoOverlay: () => null,
}));

vi.mock("../components/MenuButton", () => ({
  MenuButton: ({ label, onClick }: { label: string; onClick?: () => void }) => (
    <button type="button" onClick={onClick}>{label}</button>
  ),
}));

import { InstalledRoundsPage } from "./rounds";
import { buildRoundRenderRows } from "./roundRows";

function makeRound({
  id,
  name,
  createdAt,
  hero,
  startTime,
}: {
  id: string;
  name: string;
  createdAt: string;
  hero?: { id?: string | null; name?: string | null } | null;
  startTime?: number | null;
}): InstalledRound {
  const heroId = hero?.id ?? (hero?.name ? `hero-${hero.name}` : null);
  return {
    id,
    name,
    description: null,
    author: null,
    type: "Normal",
    difficulty: 2,
    bpm: 120,
    startTime: startTime ?? null,
    endTime: null,
    createdAt,
    heroId,
    hero: hero
      ? {
        id: heroId ?? "hero-unknown",
        name: hero.name ?? "",
        createdAt,
        updatedAt: createdAt,
        sourceKey: null,
        sourceType: null,
      }
      : null,
    resources: [
      {
        id: `res-${id}`,
        roundId: id,
        videoUri: null,
        funscriptUri: null,
        phash: null,
        disabled: false,
        createdAt,
        updatedAt: createdAt,
      },
    ],
    installSourceKey: null,
    phash: null,
    heroSourceType: null,
    sourceType: null,
    updatedAt: createdAt,
  } as unknown as InstalledRound;
}

beforeEach(() => {
  window.electronAPI = {
    file: {
      convertFileSrc: vi.fn(),
    },
    dialog: {
      selectFolders: vi.fn(),
      selectInstallImportFile: vi.fn(),
      selectPlaylistImportFile: vi.fn(),
      selectPlaylistExportPath: vi.fn(),
      selectConverterVideoFile: vi.fn(),
      selectConverterFunscriptFile: vi.fn(),
    },
    window: {
      isFullscreen: vi.fn(),
      setFullscreen: vi.fn(),
      toggleFullscreen: vi.fn(),
    },
    updates: {
      subscribe: vi.fn(() => () => {}),
    },
    appOpen: {
      consumePendingFiles: vi.fn(async () => []),
      subscribe: vi.fn(() => () => {}),
    },
  };
  mocks.loaderData.rounds = [];
  mocks.db.round.findInstalled.mockImplementation(async () => mocks.loaderData.rounds);
  mocks.db.round.getDisabledIds.mockResolvedValue([]);
  mocks.db.round.update.mockResolvedValue({});
  mocks.db.round.delete.mockResolvedValue({ deleted: true });
  mocks.db.round.convertHeroGroupToRound.mockResolvedValue({
    keptRoundId: "kept",
    removedRoundCount: 0,
    deletedHero: false,
  });
  mocks.db.hero.update.mockResolvedValue({});
  mocks.db.hero.delete.mockResolvedValue({ deleted: true });
  mocks.db.install.getScanStatus.mockResolvedValue({
    state: "idle",
    triggeredBy: "manual",
    startedAt: null,
    finishedAt: null,
    stats: {
      scannedFolders: 0,
      sidecarsSeen: 0,
      installed: 0,
      updated: 0,
      skipped: 0,
      failed: 0,
    },
    lastMessage: null,
    lastErrors: [],
  });
  mocks.db.install.abortScan.mockResolvedValue({
    state: "running",
    triggeredBy: "manual",
    startedAt: "2026-03-06T00:00:00.000Z",
    finishedAt: null,
    stats: {
      scannedFolders: 1,
      sidecarsSeen: 0,
      installed: 0,
      updated: 0,
      skipped: 0,
      failed: 0,
    },
    lastMessage: "Abort requested. Waiting for the current import step to finish...",
    lastErrors: [],
  });
  mocks.db.install.scanFolderOnce.mockResolvedValue({
    status: {
      state: "done",
      triggeredBy: "manual",
      startedAt: "2026-03-06T00:00:00.000Z",
      finishedAt: "2026-03-06T00:00:02.000Z",
      stats: {
        scannedFolders: 1,
        sidecarsSeen: 0,
        installed: 0,
        updated: 0,
        skipped: 0,
        failed: 0,
      },
      lastMessage: "Done",
      lastErrors: [],
    },
  });
  mocks.db.install.inspectFolder.mockResolvedValue({
    kind: "sidecar",
    folderPath: "/tmp/round-pack",
    playlistNameHint: "round-pack",
    sidecarCount: 1,
  });
  mocks.db.install.importLegacyWithPlan.mockResolvedValue({
    status: {
      state: "done",
      triggeredBy: "manual",
      startedAt: "2026-03-06T00:00:00.000Z",
      finishedAt: "2026-03-06T00:00:02.000Z",
      stats: {
        scannedFolders: 1,
        sidecarsSeen: 0,
        installed: 2,
        updated: 0,
        skipped: 0,
        failed: 0,
      },
      lastMessage: "Legacy import finished.",
      lastErrors: [],
    },
    legacyImport: {
      roundIds: ["r1", "r2"],
      playlistNameHint: "Legacy Pack",
      orderedSlots: [
        { kind: "round", ref: { name: "1", type: "Normal" } },
        { kind: "checkpoint", label: "2 checkpoint", restDurationMs: null },
        { kind: "round", ref: { name: "10", type: "Normal" } },
      ],
    },
  });
  mocks.db.install.importSidecarFile.mockResolvedValue({
    status: {
      state: "done",
      triggeredBy: "manual",
      startedAt: "2026-03-06T00:00:00.000Z",
      finishedAt: "2026-03-06T00:00:02.000Z",
      stats: {
        scannedFolders: 0,
        sidecarsSeen: 1,
        installed: 1,
        updated: 0,
        skipped: 0,
        failed: 0,
      },
      lastMessage: "Import finished.",
      lastErrors: [],
    },
  });
  mocks.playlists.create.mockResolvedValue({ id: "playlist-1" });
  mocks.playlists.importFromFile.mockResolvedValue({
    playlist: { id: "playlist-2", name: "Imported Playlist" },
    report: {
      exactMapping: {},
      suggestedMapping: {},
      issues: [],
      counts: {
        exact: 0,
        suggested: 0,
        missing: 0,
      },
      appliedMapping: {},
    },
  });
  mocks.playlists.setActive.mockResolvedValue({ id: "playlist-1" });
  mocks.db.install.exportDatabase.mockResolvedValue({
    exportDir: "/tmp/f-land/export/2026-03-05T20-00-00.000Z",
    heroFiles: 1,
    roundFiles: 1,
    exportedRounds: 2,
    includeResourceUris: false,
  });
  mocks.db.install.openExportFolder.mockResolvedValue({
    path: "/tmp/f-land/export",
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("buildRoundRenderRows", () => {
  it("groups hero rounds and preserves first-seen order", () => {
    const rows = buildRoundRenderRows([
      makeRound({ id: "a", name: "Hero A 1", createdAt: "2026-03-03T10:00:00.000Z", hero: { id: "h-a", name: "Hero A" } }),
      makeRound({ id: "solo", name: "Solo", createdAt: "2026-03-03T09:00:00.000Z" }),
      makeRound({ id: "b", name: "Hero A 2", createdAt: "2026-03-03T08:00:00.000Z", hero: { id: "h-a", name: "Hero A" } }),
    ]);

    expect(rows).toHaveLength(2);
    expect(rows[0]?.kind).toBe("hero-group");
    expect(rows[1]?.kind).toBe("standalone");
    if (rows[0]?.kind === "hero-group") {
      expect(rows[0].rounds.map((round) => round.id)).toEqual(["a", "b"]);
    }
  });
});

describe("InstalledRoundsPage hero grouping", () => {
  it("shows a go back button in the header and falls back to home navigation", () => {
    render(<InstalledRoundsPage />);

    fireEvent.click(screen.getByRole("button", { name: "Go Back" }));

    expect(mocks.navigate).toHaveBeenCalledWith({ to: "/" });
  });

  it("renders hero groups collapsed by default and toggles expansion", async () => {
    mocks.loaderData.rounds = [
      makeRound({ id: "r1", name: "Hero Round 1", createdAt: "2026-03-03T12:00:00.000Z", hero: { id: "h1", name: "Hero One" } }),
      makeRound({ id: "solo", name: "Solo Round", createdAt: "2026-03-03T11:00:00.000Z" }),
      makeRound({ id: "r2", name: "Hero Round 2", createdAt: "2026-03-03T10:00:00.000Z", hero: { id: "h1", name: "Hero One" } }),
    ];

    render(<InstalledRoundsPage />);

    expect(screen.getByRole("heading", { name: "Solo Round" })).toBeDefined();
    expect(screen.queryByRole("heading", { name: "Hero Round 1" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Hero Round 2" })).toBeNull();

    const header = screen.getByRole("button", { name: "Hero One (2 rounds)" });
    fireEvent.click(header);

    expect(await screen.findByRole("heading", { name: "Hero Round 1" })).toBeDefined();
    expect(await screen.findByRole("heading", { name: "Hero Round 2" })).toBeDefined();

    fireEvent.click(header);
    expect(screen.queryByRole("heading", { name: "Hero Round 1" })).toBeNull();
  });

  it("keeps first-seen order across hero groups and standalone rounds", () => {
    mocks.loaderData.rounds = [
      makeRound({ id: "beta", name: "Beta Round", createdAt: "2026-03-03T12:00:00.000Z", hero: { id: "hb", name: "Hero Beta" } }),
      makeRound({ id: "solo", name: "Solo Round", createdAt: "2026-03-03T11:00:00.000Z" }),
      makeRound({ id: "alpha", name: "Alpha Round", createdAt: "2026-03-03T10:00:00.000Z", hero: { id: "ha", name: "Hero Alpha" } }),
    ];

    render(<InstalledRoundsPage />);

    const betaHeader = screen.getByRole("button", { name: "Hero Beta (1 rounds)" });
    const soloHeading = screen.getByRole("heading", { name: "Solo Round" });
    const alphaHeader = screen.getByRole("button", { name: "Hero Alpha (1 rounds)" });

    expect(Boolean(betaHeader.compareDocumentPosition(soloHeading) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
    expect(Boolean(soloHeading.compareDocumentPosition(alphaHeader) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
  });

  it("updates grouped rows via filtering and preserves empty state", () => {
    mocks.loaderData.rounds = [
      makeRound({ id: "hero", name: "Hero Filter Round", createdAt: "2026-03-03T12:00:00.000Z", hero: { id: "h1", name: "Hero One" } }),
      makeRound({ id: "solo", name: "Solo Target", createdAt: "2026-03-03T11:00:00.000Z" }),
    ];

    render(<InstalledRoundsPage />);

    fireEvent.change(screen.getByPlaceholderText("Search title, hero, author"), {
      target: { value: "solo" },
    });

    expect(screen.getByRole("heading", { name: "Solo Target" })).toBeDefined();
    expect(screen.queryByRole("button", { name: "Hero One (1 rounds)" })).toBeNull();

    fireEvent.change(screen.getByPlaceholderText("Search title, hero, author"), {
      target: { value: "does-not-exist" },
    });

    expect(screen.getByText("No rounds match this filter")).toBeDefined();
  });

  it("shows convert button for rounds without hero and navigates to converter with prefill", () => {
    mocks.loaderData.rounds = [
      makeRound({ id: "solo", name: "Solo Target", createdAt: "2026-03-03T11:00:00.000Z" }),
    ];

    render(<InstalledRoundsPage />);

    const convertButton = screen.getByRole("button", { name: "Convert to Hero" });
    fireEvent.click(convertButton);

    expect(mocks.navigate).toHaveBeenCalledWith({
      to: "/converter",
      search: {
        sourceRoundId: "solo",
        heroName: "Solo Target",
      },
    });
  });

  it("converts a hero group back to a standalone round after explicit confirmation", async () => {
    mocks.loaderData.rounds = [
      makeRound({ id: "r1", name: "Hero Round 1", createdAt: "2026-03-03T12:00:00.000Z", hero: { id: "h1", name: "Hero One" } }),
      makeRound({ id: "r2", name: "Hero Round 2", createdAt: "2026-03-03T13:00:00.000Z", hero: { id: "h1", name: "Hero One" } }),
    ];

    const confirmSpy = vi.spyOn(window, "confirm");
    const promptSpy = vi.spyOn(window, "prompt");
    confirmSpy.mockReturnValueOnce(true).mockReturnValueOnce(true);
    promptSpy.mockReturnValue("Hero One");

    render(<InstalledRoundsPage />);

    fireEvent.click(screen.getByRole("button", { name: "Convert Hero One to round" }));

    await waitFor(() => {
      expect(mocks.db.round.convertHeroGroupToRound).toHaveBeenCalledWith({
        keepRoundId: "r1",
        roundIds: ["r2", "r1"],
        heroId: "h1",
        roundName: "Hero One",
      });
    });

    confirmSpy.mockRestore();
    promptSpy.mockRestore();
  });

  it("converts a hero group back to the first attached round instead of the earliest start time", async () => {
    mocks.loaderData.rounds = [
      makeRound({
        id: "r1",
        name: "Hero Round 1",
        createdAt: "2026-03-03T10:00:00.000Z",
        startTime: 4000,
        hero: { id: "h1", name: "Hero One" },
      }),
      makeRound({
        id: "r2",
        name: "Hero Round 2",
        createdAt: "2026-03-03T11:00:00.000Z",
        startTime: 1000,
        hero: { id: "h1", name: "Hero One" },
      }),
    ];

    const confirmSpy = vi.spyOn(window, "confirm");
    const promptSpy = vi.spyOn(window, "prompt");
    confirmSpy.mockReturnValueOnce(true).mockReturnValueOnce(true);
    promptSpy.mockReturnValue("Hero One");

    render(<InstalledRoundsPage />);

    fireEvent.click(screen.getByRole("button", { name: "Convert Hero One to round" }));

    await waitFor(() => {
      expect(mocks.db.round.convertHeroGroupToRound).toHaveBeenCalledWith({
        keepRoundId: "r1",
        roundIds: ["r2", "r1"],
        heroId: "h1",
        roundName: "Hero One",
      });
    });

    confirmSpy.mockRestore();
    promptSpy.mockRestore();
  });

  it("edits a standalone round inside a popup", async () => {
    mocks.loaderData.rounds = [
      makeRound({ id: "solo", name: "Solo Round", createdAt: "2026-03-03T11:00:00.000Z" }),
    ];

    render(<InstalledRoundsPage />);

    fireEvent.click(screen.getByRole("button", { name: "Edit Round" }));
    fireEvent.change(screen.getByDisplayValue("Solo Round"), {
      target: { value: "Solo Round Updated" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Save Round" }));

    await waitFor(() => {
      expect(mocks.db.round.update).toHaveBeenCalledWith(expect.objectContaining({
        id: "solo",
        name: "Solo Round Updated",
      }));
    });
  });

  it("edits a hero group inside a popup", async () => {
    mocks.loaderData.rounds = [
      makeRound({ id: "r1", name: "Hero Round 1", createdAt: "2026-03-03T12:00:00.000Z", hero: { id: "h1", name: "Hero One" } }),
    ];

    render(<InstalledRoundsPage />);

    fireEvent.click(screen.getByRole("button", { name: "Edit Hero" }));
    fireEvent.change(screen.getByDisplayValue("Hero One"), {
      target: { value: "Hero Prime" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Save Hero" }));

    await waitFor(() => {
      expect(mocks.db.hero.update).toHaveBeenCalledWith(expect.objectContaining({
        id: "h1",
        name: "Hero Prime",
      }));
    });
  });

  it("deletes a standalone round from the edit dialog without touching files", async () => {
    mocks.loaderData.rounds = [
      makeRound({ id: "solo", name: "Solo Round", createdAt: "2026-03-03T11:00:00.000Z" }),
    ];

    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);

    render(<InstalledRoundsPage />);

    fireEvent.click(screen.getByRole("button", { name: "Edit Round" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete Round" }));

    await waitFor(() => {
      expect(mocks.db.round.delete).toHaveBeenCalledWith("solo");
    });

    expect(confirmSpy).toHaveBeenCalledWith(expect.stringContaining("Files on disk will be left untouched"));
    confirmSpy.mockRestore();
  });

  it("deletes a hero from the edit dialog and leaves attached rounds installed", async () => {
    mocks.loaderData.rounds = [
      makeRound({ id: "r1", name: "Hero Round 1", createdAt: "2026-03-03T12:00:00.000Z", hero: { id: "h1", name: "Hero One" } }),
    ];

    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);

    render(<InstalledRoundsPage />);

    fireEvent.click(screen.getByRole("button", { name: "Edit Hero" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete Hero" }));

    await waitFor(() => {
      expect(mocks.db.hero.delete).toHaveBeenCalledWith("h1");
    });

    expect(confirmSpy).toHaveBeenCalledWith(expect.stringContaining("attached rounds will remain installed"));
    confirmSpy.mockRestore();
  });

  it("exports with default safe mode when URI inclusion is not confirmed", async () => {
    mocks.loaderData.rounds = [
      makeRound({ id: "solo", name: "Solo Target", createdAt: "2026-03-03T11:00:00.000Z" }),
    ];

    const confirmSpy = vi.spyOn(window, "confirm");
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => undefined);
    confirmSpy.mockReturnValue(false);

    render(<InstalledRoundsPage />);
    fireEvent.click(screen.getByRole("button", { name: "Export Database" }));

    await waitFor(() => {
      expect(mocks.db.install.exportDatabase).toHaveBeenCalledWith(false);
    });

    alertSpy.mockRestore();
    confirmSpy.mockRestore();
  });

  it("requires explicit warning confirmation when exporting with resource URIs", async () => {
    mocks.loaderData.rounds = [
      makeRound({ id: "solo", name: "Solo Target", createdAt: "2026-03-03T11:00:00.000Z" }),
    ];

    const confirmSpy = vi.spyOn(window, "confirm");
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => undefined);
    confirmSpy.mockReturnValueOnce(true).mockReturnValueOnce(true);

    render(<InstalledRoundsPage />);
    fireEvent.click(screen.getByRole("button", { name: "Export Database" }));

    await waitFor(() => {
      expect(mocks.db.install.exportDatabase).toHaveBeenCalledWith(true);
    });
    expect(confirmSpy.mock.calls[1]?.[0]).toContain("remotely hosted");

    alertSpy.mockRestore();
    confirmSpy.mockRestore();
  });

  it("aborts URI export when warning is canceled", async () => {
    mocks.loaderData.rounds = [
      makeRound({ id: "solo", name: "Solo Target", createdAt: "2026-03-03T11:00:00.000Z" }),
    ];

    const confirmSpy = vi.spyOn(window, "confirm");
    confirmSpy.mockReturnValueOnce(true).mockReturnValueOnce(false);

    render(<InstalledRoundsPage />);
    fireEvent.click(screen.getByRole("button", { name: "Export Database" }));

    await waitFor(() => {
      expect(confirmSpy).toHaveBeenCalledTimes(2);
    });
    expect(mocks.db.install.exportDatabase).not.toHaveBeenCalled();

    confirmSpy.mockRestore();
  });

  it("opens the install export folder from the header action", async () => {
    render(<InstalledRoundsPage />);
    fireEvent.click(screen.getByRole("button", { name: "Open Export Folder" }));

    await waitFor(() => {
      expect(mocks.db.install.openExportFolder).toHaveBeenCalledTimes(1);
    });
  });

  it("shows a long-running import overlay and allows aborting the import", async () => {
    let resolveImport: ((value: unknown) => void) | null = null;
    mocks.db.install.scanFolderOnce.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveImport = resolve;
        }),
    );
    vi.mocked(window.electronAPI.dialog.selectFolders).mockResolvedValue(["/tmp/legacy-pack"]);

    render(<InstalledRoundsPage />);
    fireEvent.click(screen.getByRole("button", { name: "Install Rounds" }));

    expect(await screen.findByText("Installing rounds can take a very long time.")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Abort Import" }));

    await waitFor(() => {
      expect(mocks.db.install.abortScan).toHaveBeenCalledTimes(1);
    });

    const settleImport = resolveImport as ((value: unknown) => void) | null;
    if (settleImport) {
      settleImport({
        status: {
          state: "aborted",
          triggeredBy: "manual",
          startedAt: "2026-03-06T00:00:00.000Z",
          finishedAt: "2026-03-06T00:00:04.000Z",
          stats: {
            scannedFolders: 1,
            sidecarsSeen: 0,
            installed: 0,
            updated: 0,
            skipped: 0,
            failed: 0,
          },
          lastMessage: "Import aborted by user.",
          lastErrors: [],
        },
      });
    }

    await waitFor(() => {
      expect(screen.queryByText("Installing rounds can take a very long time.")).toBeNull();
    });
  });

  it("reviews legacy import before importing and keeps natural slot order for playlist creation", async () => {
    vi.mocked(window.electronAPI.dialog.selectFolders).mockResolvedValue(["/tmp/legacy-pack"]);
    mocks.db.install.inspectFolder.mockResolvedValue({
      kind: "legacy",
      folderPath: "/tmp/legacy-pack",
      playlistNameHint: "Legacy Pack",
      legacySlots: [
        { id: "slot-0", sourcePath: "/tmp/legacy-pack/1.mp4", sourceLabel: "1", originalOrder: 0, defaultCheckpoint: false },
        { id: "slot-1", sourcePath: "/tmp/legacy-pack/2 checkpoint.mp4", sourceLabel: "2 checkpoint", originalOrder: 1, defaultCheckpoint: true },
        { id: "slot-2", sourcePath: "/tmp/legacy-pack/10.mp4", sourceLabel: "10", originalOrder: 2, defaultCheckpoint: false },
      ],
    });

    render(<InstalledRoundsPage />);
    fireEvent.click(screen.getByRole("button", { name: "Install Rounds" }));

    expect(await screen.findByRole("heading", { name: "Review Legacy Import" })).toBeDefined();
    expect(screen.getByText(/Ordered by filename \(natural sort\)/)).toBeDefined();
    expect(screen.getAllByText("Checkpoint: No")).toHaveLength(2);
    fireEvent.change(screen.getByPlaceholderText("Legacy Playlist"), {
      target: { value: "Imported Legacy Run" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Import and Create Playlist" }));

    await waitFor(() => {
      expect(mocks.playlists.create).toHaveBeenCalledWith(expect.objectContaining({
        name: "Imported Legacy Run",
        config: expect.objectContaining({
          boardConfig: expect.objectContaining({
            safePointIndices: [2],
            normalRoundRefsByIndex: {
              "1": { name: "1", type: "Normal" },
              "3": { name: "10", type: "Normal" },
            },
          }),
        }),
      }));
    });
    expect(mocks.db.install.importLegacyWithPlan).toHaveBeenCalledWith("/tmp/legacy-pack", [
      { id: "slot-0", sourcePath: "/tmp/legacy-pack/1.mp4", originalOrder: 0, selectedAsCheckpoint: false, excludedFromImport: false },
      { id: "slot-1", sourcePath: "/tmp/legacy-pack/2 checkpoint.mp4", originalOrder: 1, selectedAsCheckpoint: true, excludedFromImport: false },
      { id: "slot-2", sourcePath: "/tmp/legacy-pack/10.mp4", originalOrder: 2, selectedAsCheckpoint: false, excludedFromImport: false },
    ]);
    expect(mocks.playlists.setActive).toHaveBeenCalledWith("playlist-1");
  });

  it("can import a reviewed legacy folder without creating a playlist", async () => {
    vi.mocked(window.electronAPI.dialog.selectFolders).mockResolvedValue(["/tmp/legacy-pack"]);
    mocks.db.install.inspectFolder.mockResolvedValue({
      kind: "legacy",
      folderPath: "/tmp/legacy-pack",
      playlistNameHint: "Legacy Pack",
      legacySlots: [
        { id: "slot-0", sourcePath: "/tmp/legacy-pack/1.mp4", sourceLabel: "1", originalOrder: 0, defaultCheckpoint: false },
        { id: "slot-1", sourcePath: "/tmp/legacy-pack/2.mp4", sourceLabel: "2", originalOrder: 1, defaultCheckpoint: false },
      ],
    });

    render(<InstalledRoundsPage />);
    fireEvent.click(screen.getByRole("button", { name: "Install Rounds" }));

    expect(await screen.findByRole("heading", { name: "Review Legacy Import" })).toBeDefined();
    fireEvent.click(screen.getAllByRole("checkbox", { name: "Import" })[1]!);
    fireEvent.click(screen.getByRole("checkbox", { name: /create a playlist after import/i }));
    fireEvent.click(screen.getByRole("button", { name: "Import Without Playlist" }));

    await waitFor(() => {
      expect(mocks.db.install.importLegacyWithPlan).toHaveBeenCalledWith("/tmp/legacy-pack", [
        { id: "slot-0", sourcePath: "/tmp/legacy-pack/1.mp4", originalOrder: 0, selectedAsCheckpoint: false, excludedFromImport: false },
        { id: "slot-1", sourcePath: "/tmp/legacy-pack/2.mp4", originalOrder: 1, selectedAsCheckpoint: false, excludedFromImport: true },
      ]);
    });
    expect(mocks.playlists.create).not.toHaveBeenCalled();
    expect(mocks.playlists.setActive).not.toHaveBeenCalled();
  });

  it("imports a selected .round or .hero file from the rounds page", async () => {
    vi.mocked(window.electronAPI.dialog.selectInstallImportFile).mockResolvedValue("/tmp/imported.round");

    render(<InstalledRoundsPage />);
    fireEvent.click(screen.getByRole("button", { name: "Import File" }));

    await waitFor(() => {
      expect(mocks.db.install.importSidecarFile).toHaveBeenCalledWith("/tmp/imported.round");
    });
    expect(mocks.navigate).not.toHaveBeenCalledWith({ to: "/playlist-workshop" });
  });

  it("imports a selected .fplay file from the rounds page and navigates to playlist workshop", async () => {
    vi.mocked(window.electronAPI.dialog.selectInstallImportFile).mockResolvedValue("/tmp/imported.fplay");

    render(<InstalledRoundsPage />);
    fireEvent.click(screen.getByRole("button", { name: "Import File" }));

    await waitFor(() => {
      expect(mocks.playlists.importFromFile).toHaveBeenCalledWith({ filePath: "/tmp/imported.fplay" });
    });
    expect(mocks.playlists.setActive).toHaveBeenCalledWith("playlist-2");
    expect(mocks.navigate).toHaveBeenCalledWith({ to: "/playlist-workshop" });
  });
});
