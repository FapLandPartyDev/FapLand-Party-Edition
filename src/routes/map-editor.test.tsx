import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
        mode: "graph" as const,
        startNodeId: "start",
        nodes: [
          {
            id: "start",
            name: "Start",
            kind: "start" as const,
            styleHint: { x: 120, y: 210, width: 190, height: 84 },
          },
          {
            id: "path-1",
            name: "Path",
            kind: "path" as const,
            styleHint: { x: 430, y: 210, width: 190, height: 84 },
          },
          {
            id: "round-1",
            name: "Round 1",
            kind: "round" as const,
            roundRef: { name: "Round 1" },
            styleHint: { x: 740, y: 210, width: 190, height: 84 },
          },
          {
            id: "end",
            name: "End",
            kind: "end" as const,
            styleHint: { x: 1050, y: 210, width: 190, height: 84 },
          },
        ],
        edges: [
          {
            id: "edge-start-path-1",
            fromNodeId: "start",
            toNodeId: "path-1",
            gateCost: 0,
            weight: 1,
          },
          {
            id: "edge-path-1-round-1",
            fromNodeId: "path-1",
            toNodeId: "round-1",
            gateCost: 0,
            weight: 1,
          },
          {
            id: "edge-round-1-end",
            fromNodeId: "round-1",
            toNodeId: "end",
            gateCost: 0,
            weight: 1,
          },
        ],
        randomRoundPools: [],
        cumRoundRefs: [],
        pathChoiceTimeoutMs: 6000,
      },
      perkSelection: { optionsPerPick: 3, triggerChancePerCompletedRound: 0.35 },
      perkPool: { enabledPerkIds: [], enabledAntiPerkIds: [] },
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
  navigate: vi.fn(),
  db: {
    install: {
      getScanStatus: vi.fn(),
    },
  },
  playlists: {
    list: vi.fn(),
    getActive: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    duplicate: vi.fn(),
    remove: vi.fn(),
    analyzeImportFile: vi.fn(),
    analyzeExportPackage: vi.fn(),
    importFromFile: vi.fn(),
    exportToFile: vi.fn(),
    exportPackage: vi.fn(),
    getExportPackageStatus: vi.fn(),
    abortExportPackage: vi.fn(),
    setActive: vi.fn(),
  },
  audio: {
    playHoverSound: vi.fn(),
    playSelectSound: vi.fn(),
    playMapConnectNodesSound: vi.fn(),
    playMapDeleteNodeSound: vi.fn(),
    playMapDisconnectNodesSound: vi.fn(),
    playMapInvalidActionSound: vi.fn(),
    playMapPlaceNodeSound: vi.fn(),
    playMapUndoRedoSound: vi.fn(),
  },
  canvasProps: null as null | Record<string, unknown>,
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
        query: vi.fn().mockResolvedValue(false),
      },
    },
    db: new Proxy({}, { get: () => ({ query: vi.fn(), mutate: vi.fn() }) }),
    playlist: new Proxy({}, { get: () => ({ query: vi.fn(), mutate: vi.fn() }) }),
  },
}));

vi.mock("../components/MenuButton", () => ({
  MenuButton: ({ label, onClick }: { label: string; onClick?: () => void }) => (
    <button type="button" onClick={onClick}>
      {label}
    </button>
  ),
}));

vi.mock("../components/AnimatedBackground", () => ({
  AnimatedBackground: () => <div data-testid="animated-background" />,
}));

vi.mock("../features/map-editor/EditorCanvas", () => ({
  EditorCanvas: (props: Record<string, unknown>) => {
    mocks.canvasProps = props;
    return (
      <div data-testid="mock-editor-canvas">
        <button
          type="button"
          onClick={() => {
            const onPlaceNodeAtWorld = props.onPlaceNodeAtWorld as
              | ((kind: string, x: number, y: number) => void)
              | undefined;
            const activePlacementKind = props.activePlacementKind as string | undefined;
            onPlaceNodeAtWorld?.(activePlacementKind ?? "path", 320, 220);
          }}
        >
          Place Via Canvas
        </button>
      </div>
    );
  },
}));

vi.mock("../features/map-editor/tileCatalog", () => ({
  loadTileCatalog: vi.fn(async () => ({
    version: 1,
    categories: [{ id: "core", label: "Core" }],
    tiles: [
      {
        id: "path-node",
        kind: "path",
        visualId: "path",
        label: "Path",
        description: "Simple path node",
        category: "core",
        defaultName: "Path",
        width: 190,
        height: 84,
      },
      {
        id: "round-node",
        kind: "round",
        visualId: "round",
        label: "Round",
        description: "Round node",
        category: "core",
        defaultName: "Round",
        width: 190,
        height: 84,
      },
      {
        id: "end-node",
        kind: "end",
        visualId: "end",
        label: "End",
        description: "Terminal end node",
        category: "core",
        defaultName: "End",
        width: 190,
        height: 84,
      },
    ],
  })),
}));

vi.mock("../utils/audio", () => mocks.audio);

import { MapEditorRoute } from "./map-editor";

function getCanvasNodePositions() {
  const props = mocks.canvasProps as {
    config: { nodes: Array<{ id: string; styleHint?: { x?: number; y?: number } }> };
  } | null;
  return (props?.config.nodes ?? []).map((node) => ({
    id: node.id,
    x: node.styleHint?.x ?? null,
    y: node.styleHint?.y ?? null,
  }));
}

async function enterEditor() {
  fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
  await screen.findByPlaceholderText("Search tiles");
}

beforeEach(() => {
  window.sessionStorage.clear();
  window.electronAPI = {
    file: {
      convertFileSrc: vi.fn(),
    },
    dialog: {
      selectFolders: vi.fn(),
      selectInstallImportFile: vi.fn(),
      selectPlaylistImportFile: vi.fn(),
      selectPlaylistExportPath: vi.fn(),
      selectPlaylistExportDirectory: vi.fn(),
      selectWebsiteVideoCacheDirectory: vi.fn(),
      selectMusicCacheDirectory: vi.fn(),
      selectMoaningCacheDirectory: vi.fn(),
      selectConverterVideoFile: vi.fn(),
      selectMusicFiles: vi.fn(),
      selectMoaningFiles: vi.fn(),
      addMusicFromUrl: vi.fn(),
      addMusicPlaylistFromUrl: vi.fn(),
      addMoaningFromUrl: vi.fn(),
      addMoaningPlaylistFromUrl: vi.fn(),
      selectConverterFunscriptFile: vi.fn(),
    },
    window: {
      isFullscreen: vi.fn(),
      setFullscreen: vi.fn(),
      toggleFullscreen: vi.fn(),
      close: vi.fn(),
    },
    updates: {
      subscribe: vi.fn(() => () => {}),
    },
    appOpen: {
      consumePendingFiles: vi.fn(async () => []),
      subscribe: vi.fn(() => () => {}),
    },
  };
  const playlist = makePlaylist("playlist-1", "Test Playlist");
  mocks.loaderData = {
    installedRounds: [],
    availablePlaylists: [playlist],
    activePlaylist: playlist,
  };

  mocks.db.install.getScanStatus.mockResolvedValue({
    state: "idle",
    stats: {
      discovered: 0,
      installed: 0,
      updated: 0,
      failed: 0,
      disabled: 0,
      roundsCreated: 0,
      roundsUpdated: 0,
      roundsLinked: 0,
      resourcesCreated: 0,
      resourcesUpdated: 0,
      heroesCreated: 0,
      heroesUpdated: 0,
    },
    startedAt: null,
    finishedAt: null,
    message: null,
    error: null,
  });

  mocks.playlists.create.mockImplementation(async ({ name }: { name: string }) => {
    const created = makePlaylist("playlist-new", name);
    mocks.loaderData.availablePlaylists = [created, ...(mocks.loaderData.availablePlaylists as typeof mocks.loaderData.availablePlaylists)];
    return created;
  });
  mocks.playlists.duplicate.mockImplementation(async (playlistId: string) => {
    const duplicated = makePlaylist(`${playlistId}-copy`, "Test Playlist Copy");
    mocks.loaderData.availablePlaylists = [
      duplicated,
      ...(mocks.loaderData.availablePlaylists as typeof mocks.loaderData.availablePlaylists),
    ];
    return duplicated;
  });
  mocks.playlists.remove.mockImplementation(async (playlistId: string) => {
    mocks.loaderData.availablePlaylists = (
      mocks.loaderData.availablePlaylists as Array<{ id: string }>
    ).filter((playlist) => playlist.id !== playlistId);
    if ((mocks.loaderData.activePlaylist as { id: string } | null)?.id === playlistId) {
      mocks.loaderData.activePlaylist = null;
    }
  });
  mocks.playlists.list.mockImplementation(async () => mocks.loaderData.availablePlaylists);
  mocks.playlists.getActive.mockImplementation(async () => mocks.loaderData.activePlaylist);
  mocks.playlists.analyzeImportFile.mockImplementation(async () => ({
    metadata: {
      name: "Imported Playlist",
      description: null,
      exportedAt: null,
    },
    config: makePlaylist("playlist-imported", "Imported Playlist").config,
    resolution: {
      exactMapping: {},
      suggestedMapping: {},
      issues: [],
      counts: {
        exact: 0,
        suggested: 0,
        missing: 0,
      },
    },
  }));
  mocks.playlists.importFromFile.mockImplementation(async () => ({
    playlist: makePlaylist("playlist-imported", "Imported Playlist"),
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
  }));
  mocks.playlists.analyzeExportPackage.mockResolvedValue({
    videoTotals: {
      uniqueVideos: 1,
      localVideos: 1,
      remoteVideos: 0,
      alreadyAv1Videos: 0,
      estimatedReencodeVideos: 1,
    },
    compression: {
      supported: true,
      defaultMode: "av1",
      encoderName: "av1_nvenc",
      encoderKind: "hardware",
      warning: null,
      strength: 80,
      estimate: {
        sourceVideoBytes: 200 * 1024 * 1024,
        expectedVideoBytes: 90 * 1024 * 1024,
        savingsBytes: 110 * 1024 * 1024,
        estimatedCompressionSeconds: 600,
        approximate: false,
      },
    },
    settings: {
      outputContainer: "mp4",
      audioCodec: "aac",
      audioBitrateKbps: 128,
      lowPriority: true,
      parallelJobs: 2,
    },
    estimate: {
      sourceVideoBytes: 200 * 1024 * 1024,
      expectedVideoBytes: 90 * 1024 * 1024,
      savingsBytes: 110 * 1024 * 1024,
      estimatedCompressionSeconds: 600,
      approximate: false,
    },
  });
  mocks.playlists.update.mockImplementation(
    async ({ playlistId, name, config }: { playlistId: string; name?: string; config: unknown }) => ({
      ...makePlaylist(playlistId, name ?? "Test Playlist"),
      config,
    })
  );
  mocks.playlists.exportToFile.mockResolvedValue(undefined);
  mocks.playlists.exportPackage.mockResolvedValue({
    exportDir: "/tmp/test-playlist",
    playlistFilePath: "/tmp/test-playlist/Test Playlist.fplay",
    sidecarFiles: 1,
    videoFiles: 1,
    funscriptFiles: 0,
    referencedRounds: 1,
    compression: {
      enabled: true,
      encoderName: "av1_nvenc",
      encoderKind: "hardware",
      strength: 80,
      reencodedVideos: 1,
      alreadyAv1Copied: 0,
      actualVideoBytes: 90 * 1024 * 1024,
    },
  });
  mocks.playlists.getExportPackageStatus.mockResolvedValue({
    state: "idle",
    phase: "idle",
    startedAt: null,
    finishedAt: null,
    lastMessage: null,
    progress: {
      completed: 0,
      total: 0,
    },
    stats: {
      playlistFiles: 0,
      sidecarFiles: 0,
      videoFiles: 0,
      funscriptFiles: 0,
    },
    compression: null,
  });
  mocks.playlists.abortExportPackage.mockResolvedValue({
    state: "aborted",
    phase: "aborted",
    startedAt: "2026-03-18T00:00:00.000Z",
    finishedAt: "2026-03-18T00:00:01.000Z",
    lastMessage: "Export aborted by user.",
    progress: {
      completed: 1,
      total: 4,
    },
    stats: {
      playlistFiles: 0,
      sidecarFiles: 0,
      videoFiles: 1,
      funscriptFiles: 0,
    },
    compression: null,
  });
  mocks.playlists.setActive.mockResolvedValue(undefined);
  vi.mocked(window.electronAPI.dialog.selectPlaylistImportFile).mockResolvedValue(null);
  vi.mocked(window.electronAPI.dialog.selectPlaylistExportPath).mockResolvedValue(null);
  vi.mocked(window.electronAPI.dialog.selectPlaylistExportDirectory).mockResolvedValue(null);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("MapEditorRoute", () => {
  it("requires selecting a playlist before opening the editor", async () => {
    render(<MapEditorRoute />);
    expect(screen.getByText("Select Playlist")).toBeDefined();
    expect(screen.queryByTestId("tool-value")).toBeNull();
  });

  it("copies an advanced playlist from the picker and opens the duplicate", async () => {
    render(<MapEditorRoute />);

    fireEvent.click(screen.getByRole("button", { name: "Copy" }));

    await waitFor(() => {
      expect(mocks.playlists.duplicate).toHaveBeenCalledWith("playlist-1");
    });
    expect(await screen.findByDisplayValue("Test Playlist Copy")).toBeDefined();
  });

  it("deletes an advanced playlist from the picker after confirmation", async () => {
    render(<MapEditorRoute />);

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(screen.getByText("Delete Playlist?")).toBeDefined();

    fireEvent.click(screen.getAllByRole("button", { name: "Delete" })[1]!);

    await waitFor(() => {
      expect(mocks.playlists.remove).toHaveBeenCalledWith("playlist-1");
    });
    expect(screen.queryByText("Test Playlist")).toBeNull();
    expect(screen.getByText('Deleted "Test Playlist".')).toBeDefined();
  });

  it("auto-opens tested playlist when returning from game", async () => {
    window.sessionStorage.setItem("mapEditor.testPlaylistId", "playlist-1");
    render(<MapEditorRoute />);
    await screen.findByTestId("tool-value");
    expect(screen.queryByText("Select Playlist")).toBeNull();
  });

  it("arms place mode and keeps sticky placement active", async () => {
    render(<MapEditorRoute />);
    await enterEditor();

    fireEvent.click(screen.getAllByRole("button", { name: /Path/i })[0]!);
    expect(screen.getByTestId("tool-value").textContent).toBe("Place");

    fireEvent.click(screen.getByRole("button", { name: "Place Via Canvas" }));
    await waitFor(() => {
      expect(screen.getByTestId("node-count").textContent).toBe("5");
    });

    fireEvent.click(screen.getByRole("button", { name: "Place Via Canvas" }));
    await waitFor(() => {
      expect(screen.getByTestId("node-count").textContent).toBe("6");
    });
  });

  it("ignores tool shortcuts while typing in search input", async () => {
    render(<MapEditorRoute />);
    await enterEditor();

    const searchInput = await screen.findByPlaceholderText("Search tiles");
    searchInput.focus();
    fireEvent.keyDown(searchInput, { key: "c", code: "KeyC" });
    expect(screen.getByTestId("tool-value").textContent).toBe("Select");

    fireEvent.keyDown(window, { key: "c", code: "KeyC" });
    expect(screen.getByTestId("tool-value").textContent).toBe("Connect");
  });

  it("deletes selection and restores with undo shortcut", async () => {
    render(<MapEditorRoute />);
    await enterEditor();

    fireEvent.click(screen.getAllByRole("button", { name: /Path/i })[0]!);
    fireEvent.click(screen.getByRole("button", { name: "Place Via Canvas" }));
    await waitFor(() => {
      expect(screen.getByTestId("node-count").textContent).toBe("5");
    });

    fireEvent.keyDown(window, { key: "x", code: "KeyX" });
    await waitFor(() => {
      expect(screen.getByTestId("node-count").textContent).toBe("4");
    });

    expect(mocks.audio.playMapDeleteNodeSound).not.toHaveBeenCalled();
    expect(mocks.audio.playMapInvalidActionSound).not.toHaveBeenCalled();

    fireEvent.keyDown(window, { key: "z", code: "KeyZ", ctrlKey: true });
    await waitFor(() => {
      expect(screen.getByTestId("node-count").textContent).toBe("5");
    });
  });

  it("deletes a selected edge from the edge inspector", async () => {
    render(<MapEditorRoute />);
    await enterEditor();

    await act(async () => {
      (
        mocks.canvasProps as { onSelectionChange?: (selection: unknown) => void } | null
      )?.onSelectionChange?.({
        selectedNodeIds: [],
        primaryNodeId: null,
        selectedEdgeId: "edge-start-path-1",
      });
    });

    fireEvent.click(screen.getByRole("button", { name: "Edge" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete Edge" }));

    await waitFor(() => {
      const props = mocks.canvasProps as { config: { edges: Array<{ id: string }> } } | null;
      expect(props?.config.edges.map((edge) => edge.id)).not.toContain("edge-start-path-1");
    });

    expect(mocks.audio.playMapDisconnectNodesSound).not.toHaveBeenCalled();
  });

  it("shows layout controls and applies the selected layout strategy", async () => {
    render(<MapEditorRoute />);
    await enterEditor();

    const before = getCanvasNodePositions();
    fireEvent.click(screen.getByRole("button", { name: "Apply Layout" }));

    await waitFor(() => {
      const after = getCanvasNodePositions();
      expect(after).not.toEqual(before);
    });
  });

  it("applies layout shortcut when not typing and ignores it while typing", async () => {
    render(<MapEditorRoute />);
    await enterEditor();

    const searchInput = screen.getByPlaceholderText("Search tiles");
    const before = getCanvasNodePositions();

    searchInput.focus();
    fireEvent.keyDown(searchInput, { key: "l", code: "KeyL" });
    expect(getCanvasNodePositions()).toEqual(before);

    fireEvent.keyDown(window, { key: "l", code: "KeyL" });
    await waitFor(() => {
      expect(getCanvasNodePositions()).not.toEqual(before);
    });
  });

  it("undoes and redoes a layout apply as one history step", async () => {
    render(<MapEditorRoute />);
    await enterEditor();

    const original = getCanvasNodePositions();
    fireEvent.click(screen.getByRole("button", { name: "Apply Layout" }));

    let laidOut = getCanvasNodePositions();
    await waitFor(() => {
      laidOut = getCanvasNodePositions();
      expect(laidOut).not.toEqual(original);
    });

    fireEvent.keyDown(window, { key: "z", code: "KeyZ", ctrlKey: true });
    await waitFor(() => {
      expect(getCanvasNodePositions()).toEqual(original);
    });

    fireEvent.keyDown(window, { key: "y", code: "KeyY", ctrlKey: true });
    await waitFor(() => {
      expect(getCanvasNodePositions()).toEqual(laidOut);
    });
  });

  it("tests the map by saving, activating playlist, and navigating to game", async () => {
    render(<MapEditorRoute />);
    await enterEditor();

    fireEvent.click(screen.getByRole("button", { name: "Test Map" }));

    await waitFor(() => {
      expect(mocks.playlists.update).toHaveBeenCalledTimes(1);
      expect(mocks.playlists.setActive).toHaveBeenCalledWith("playlist-1");
      expect(mocks.navigate).toHaveBeenCalledWith({
        to: "/game",
        search: {
          playlistId: "playlist-1",
          launchNonce: expect.any(Number),
        },
      });
    });
  });

  it("does not show a playlist import button in the graph editor", async () => {
    render(<MapEditorRoute />);

    expect(screen.queryByRole("button", { name: "Import .fplay" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Import" })).toBeNull();
  });

  it("exports the current graph playlist after persisting dirty changes", async () => {
    vi.mocked(window.electronAPI.dialog.selectPlaylistExportPath).mockResolvedValue(
      "/tmp/test-playlist.fplay"
    );

    render(<MapEditorRoute />);
    await enterEditor();

    fireEvent.click(screen.getByRole("button", { name: "Apply Layout" }));
    await waitFor(() => {
      expect(screen.getByText(/unsaved/i)).toBeDefined();
    });

    fireEvent.click(screen.getByRole("button", { name: "Export Fplay" }));

    await waitFor(() => {
      expect(mocks.playlists.update).toHaveBeenCalledTimes(1);
      expect(mocks.playlists.exportToFile).toHaveBeenCalledWith(
        "playlist-1",
        "/tmp/test-playlist.fplay"
      );
    });
  });

  it("exports the current graph playlist package after persisting dirty changes", async () => {
    vi.mocked(window.electronAPI.dialog.selectPlaylistExportDirectory).mockResolvedValue("/tmp");

    render(<MapEditorRoute />);
    await enterEditor();

    fireEvent.click(screen.getByRole("button", { name: "Apply Layout" }));
    await waitFor(() => {
      expect(screen.getByText(/unsaved/i)).toBeDefined();
    });

    fireEvent.click(screen.getByRole("button", { name: "Export Pack" }));
    expect(await screen.findByText("Playlist Pack Export")).toBeDefined();
    expect(mocks.playlists.analyzeExportPackage).toHaveBeenCalledWith({
      playlistId: "playlist-1",
      compressionMode: undefined,
      compressionStrength: 80,
      includeMedia: true,
    });
    await waitFor(() => {
      const button = screen.getByRole("button", {
        name: "Choose Folder and Export",
      }) as HTMLButtonElement;
      expect(button.disabled).toBe(false);
    });

    fireEvent.click(screen.getByRole("button", { name: "Choose Folder and Export" }));

    await waitFor(() => {
      expect(mocks.playlists.update).toHaveBeenCalledTimes(1);
      expect(mocks.playlists.exportPackage).toHaveBeenCalledWith({
        playlistId: "playlist-1",
        directoryPath: "/tmp",
        compressionMode: "av1",
        compressionStrength: 80,
      });
    });
  });

  it("shows a blocking export overlay with progress and allows aborting the export", async () => {
    vi.mocked(window.electronAPI.dialog.selectPlaylistExportDirectory).mockResolvedValue("/tmp");
    mocks.playlists.exportPackage.mockImplementation(() => new Promise(() => {}));
    mocks.playlists.getExportPackageStatus.mockResolvedValue({
      state: "running",
      phase: "compressing",
      startedAt: "2026-03-18T00:00:00.000Z",
      finishedAt: null,
      lastMessage: "Downloading video pack-asset.mp4...",
      progress: {
        completed: 2,
        total: 5,
      },
      stats: {
        playlistFiles: 0,
        sidecarFiles: 0,
        videoFiles: 1,
        funscriptFiles: 0,
      },
      compression: {
        enabled: true,
        encoderName: "av1_nvenc",
        encoderKind: "hardware",
        strength: 80,
        reencodedCompleted: 1,
        reencodedTotal: 3,
        alreadyAv1Copied: 0,
        activeJobs: 2,
        expectedVideoBytes: 90 * 1024 * 1024,
        estimatedCompressionSeconds: 600,
        approximate: false,
        liveProgress: {
          completedDurationMs: 30_000,
          totalDurationMs: 120_000,
          percent: 0.25,
          etaSecondsRemaining: 450,
        },
      },
    });

    render(<MapEditorRoute />);
    await enterEditor();

    fireEvent.click(screen.getByRole("button", { name: "Export Pack" }));
    expect(await screen.findByText("Playlist Pack Export")).toBeDefined();
    await waitFor(() => {
      const button = screen.getByRole("button", {
        name: "Choose Folder and Export",
      }) as HTMLButtonElement;
      expect(button.disabled).toBe(false);
    });
    fireEvent.click(screen.getByRole("button", { name: "Choose Folder and Export" }));

    expect(await screen.findByText("Playlist Export Running")).toBeDefined();
    expect(screen.getByText("2 / 5 steps completed")).toBeDefined();
    expect(screen.getByText("Downloading video pack-asset.mp4...")).toBeDefined();
    expect(screen.getAllByText(/av1_nvenc/i).length).toBeGreaterThan(0);
    expect(screen.getByText("1 / 3")).toBeDefined();
    expect(screen.getByText("0:30 / 2:00 encoded")).toBeDefined();
    expect(screen.getByText("7 min remaining")).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "Abort Export" }));

    await waitFor(() => {
      expect(mocks.playlists.abortExportPackage).toHaveBeenCalledTimes(1);
    });
  });

  it("persists graph perk settings and enabled perks", async () => {
    render(<MapEditorRoute />);
    await enterEditor();

    fireEvent.click(screen.getByRole("button", { name: "Settings" }));

    fireEvent.change(screen.getByLabelText("Random perk selection chance"), {
      target: { value: "55" },
    });
    fireEvent.change(screen.getByLabelText("Intermediary initial"), { target: { value: "4" } });
    fireEvent.change(screen.getByLabelText("Intermediary increase"), { target: { value: "7" } });
    fireEvent.change(screen.getByLabelText("Intermediary max"), { target: { value: "88" } });
    fireEvent.change(screen.getByLabelText("Anti-perk initial"), { target: { value: "3" } });
    fireEvent.change(screen.getByLabelText("Anti-perk increase"), { target: { value: "9" } });
    fireEvent.change(screen.getByLabelText("Anti-perk max"), { target: { value: "77" } });
    fireEvent.change(screen.getByLabelText("Starting Money"), { target: { value: "275" } });
    fireEvent.change(screen.getByLabelText("Cum round bonus score"), { target: { value: "180" } });

    fireEvent.click(screen.getByRole("button", { name: /Loaded Dice/i }));
    fireEvent.click(screen.getByRole("button", { name: /Jammed Dice/i }));

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(mocks.playlists.update).toHaveBeenCalledTimes(1);
    });

    const updateCall = mocks.playlists.update.mock.calls[0]?.[0] as {
      config: ReturnType<typeof makePlaylist>["config"];
    };
    expect(updateCall.config.perkSelection.triggerChancePerCompletedRound).toBe(0.55);
    expect(updateCall.config.probabilityScaling.initialIntermediaryProbability).toBe(0.04);
    expect(updateCall.config.probabilityScaling.intermediaryIncreasePerRound).toBe(0.07);
    expect(updateCall.config.probabilityScaling.maxIntermediaryProbability).toBe(0.88);
    expect(updateCall.config.probabilityScaling.initialAntiPerkProbability).toBe(0.03);
    expect(updateCall.config.probabilityScaling.antiPerkIncreasePerRound).toBe(0.09);
    expect(updateCall.config.probabilityScaling.maxAntiPerkProbability).toBe(0.77);
    expect(updateCall.config.economy.startingMoney).toBe(275);
    expect(updateCall.config.economy.scorePerCumRoundSuccess).toBe(180);
    expect(updateCall.config.perkPool.enabledPerkIds).toContain("loaded-dice");
    expect(updateCall.config.perkPool.enabledAntiPerkIds).toContain("jammed-dice");
  });

  it("persists renamed map names from the advanced editor header", async () => {
    render(<MapEditorRoute />);
    await enterEditor();

    fireEvent.change(screen.getByLabelText("Map name"), {
      target: { value: "Renamed Test Playlist" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(mocks.playlists.update).toHaveBeenCalledTimes(1);
    });

    expect(mocks.playlists.update).toHaveBeenCalledWith(
      expect.objectContaining({
        playlistId: "playlist-1",
        name: "Renamed Test Playlist",
      })
    );
    expect(screen.getByDisplayValue("Renamed Test Playlist")).toBeDefined();
  });

  it("shows and persists force stop for round nodes only", async () => {
    mocks.loaderData = {
      ...mocks.loaderData,
      installedRounds: [
        {
          id: "installed-round-1",
          name: "Round 1",
          author: "Preview Author",
          description: null,
          type: "Normal",
          difficulty: 2,
          startTime: 1000,
          endTime: 6000,
          installSourceKey: "local:test",
          phash: null,
          previewImage: "data:image/png;base64,preview",
          resources: [{ videoUri: "file:///tmp/round-1.mp4", funscriptUri: null, phash: null }],
        },
      ],
    };

    render(<MapEditorRoute />);
    await enterEditor();

    const canvasProps = mocks.canvasProps as {
      onSelectionChange?: (selection: unknown) => void;
    } | null;
    await act(async () => {
      canvasProps?.onSelectionChange?.({
        selectedNodeIds: ["round-1"],
        primaryNodeId: "round-1",
        selectedEdgeId: null,
      });
    });

    const [forceStopCheckbox] = await screen.findAllByRole("checkbox");
    expect(screen.getByText("Force stop")).toBeDefined();
    expect(screen.getByText("Round preview")).toBeDefined();
    expect(screen.getByText("Preview Author")).toBeDefined();
    expect(screen.getByAltText("Round 1 preview")).toBeDefined();
    fireEvent.click(forceStopCheckbox);

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(mocks.playlists.update).toHaveBeenCalledTimes(1);
    });

    const updateCall = mocks.playlists.update.mock.calls[0]?.[0] as {
      config: ReturnType<typeof makePlaylist>["config"];
    };
    expect(updateCall.config.boardConfig.mode).toBe("graph");
    if (updateCall.config.boardConfig.mode !== "graph") {
      throw new Error("Expected graph board config");
    }
    const roundNode = updateCall.config.boardConfig.nodes.find((node) => node.id === "round-1");
    expect(roundNode && "forceStop" in roundNode ? roundNode.forceStop : undefined).toBe(true);

    await act(async () => {
      canvasProps?.onSelectionChange?.({
        selectedNodeIds: ["start"],
        primaryNodeId: "start",
        selectedEdgeId: null,
      });
    });

    await waitFor(() => {
      expect(screen.queryByText("Force stop")).toBeNull();
    });
  });

  it("updates and resets node color and size from the inspector", async () => {
    render(<MapEditorRoute />);
    await enterEditor();

    await act(async () => {
      (
        mocks.canvasProps as { onSelectionChange?: (selection: unknown) => void } | null
      )?.onSelectionChange?.({
        selectedNodeIds: ["start"],
        primaryNodeId: "start",
        selectedEdgeId: null,
      });
    });

    const colorInput = await screen.findByLabelText("Node color");
    const sizeInput = await screen.findByLabelText("Node size");
    const resetColorButton = screen.getByRole("button", { name: "Reset node color" });
    const resetSizeButton = screen.getByRole("button", { name: "Reset node size" });

    fireEvent.change(colorInput, { target: { value: "#10b981" } });
    await waitFor(() => {
      const startNode = (
        mocks.canvasProps as {
          config?: { nodes: Array<{ id: string; styleHint?: { color?: string; size?: number } }> };
        } | null
      )?.config?.nodes.find((node) => node.id === "start");
      expect(startNode?.styleHint?.color).toBe("#10b981");
    });

    fireEvent.change(sizeInput, { target: { value: "1.8" } });
    await waitFor(() => {
      const startNode = (
        mocks.canvasProps as {
          config?: { nodes: Array<{ id: string; styleHint?: { color?: string; size?: number } }> };
        } | null
      )?.config?.nodes.find((node) => node.id === "start");
      expect(startNode?.styleHint?.size).toBe(1.8);
    });

    fireEvent.click(resetColorButton);
    fireEvent.click(resetSizeButton);

    await waitFor(() => {
      const startNode = (
        mocks.canvasProps as {
          config?: { nodes: Array<{ id: string; styleHint?: { color?: string; size?: number } }> };
        } | null
      )?.config?.nodes.find((node) => node.id === "start");
      expect(startNode?.styleHint?.color).toBeUndefined();
      expect(startNode?.styleHint?.size).toBeUndefined();
    });
  });

  it("does not reset the graph when reset confirmation is cancelled", async () => {
    render(<MapEditorRoute />);
    await enterEditor();

    fireEvent.click(screen.getAllByRole("button", { name: /Path/i })[0]!);
    fireEvent.click(screen.getByRole("button", { name: "Place Via Canvas" }));
    await waitFor(() => {
      expect(screen.getByTestId("node-count").textContent).toBe("5");
    });

    fireEvent.click(screen.getByRole("button", { name: "Reset Graph" }));
    expect(await screen.findByText("Are you sure you want to reset the graph? This will delete all progress made.")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByTestId("node-count").textContent).toBe("5");
  });

  it("resets the graph after explicit confirmation", async () => {
    render(<MapEditorRoute />);
    await enterEditor();

    fireEvent.click(screen.getAllByRole("button", { name: /Path/i })[0]!);
    fireEvent.click(screen.getByRole("button", { name: "Place Via Canvas" }));
    await waitFor(() => {
      expect(screen.getByTestId("node-count").textContent).toBe("5");
    });

    fireEvent.click(screen.getByRole("button", { name: "Reset Graph" }));
    const confirmButtons = screen.getAllByRole("button", { name: "Reset Graph" });
    fireEvent.click(confirmButtons[confirmButtons.length - 1]!);

    await waitFor(() => {
      expect(screen.getByTestId("node-count").textContent).toBe("4");
    });
  });
});
