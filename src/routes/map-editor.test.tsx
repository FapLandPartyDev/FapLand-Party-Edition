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
          { id: "start", name: "Start", kind: "start" as const, styleHint: { x: 120, y: 210, width: 190, height: 84 } },
          { id: "path-1", name: "Path", kind: "path" as const, styleHint: { x: 430, y: 210, width: 190, height: 84 } },
          { id: "round-1", name: "Round 1", kind: "round" as const, roundRef: { name: "Round 1" }, styleHint: { x: 740, y: 210, width: 190, height: 84 } },
          { id: "end", name: "End", kind: "end" as const, styleHint: { x: 1050, y: 210, width: 190, height: 84 } },
        ],
        edges: [
          { id: "edge-start-path-1", fromNodeId: "start", toNodeId: "path-1", gateCost: 0, weight: 1 },
          { id: "edge-path-1-round-1", fromNodeId: "path-1", toNodeId: "round-1", gateCost: 0, weight: 1 },
          { id: "edge-round-1-end", fromNodeId: "round-1", toNodeId: "end", gateCost: 0, weight: 1 },
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
    analyzeImportFile: vi.fn(),
    importFromFile: vi.fn(),
    exportToFile: vi.fn(),
    setActive: vi.fn(),
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
    db: new Proxy({}, { get: () => ({ query: vi.fn(), mutate: vi.fn() }) }),
    playlist: new Proxy({}, { get: () => ({ query: vi.fn(), mutate: vi.fn() }) }),
  },
}));

vi.mock("../components/MenuButton", () => ({
  MenuButton: ({ label, onClick }: { label: string; onClick?: () => void }) => (
    <button type="button" onClick={onClick}>{label}</button>
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
            const onPlaceNodeAtWorld = props.onPlaceNodeAtWorld as ((kind: string, x: number, y: number) => void) | undefined;
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

vi.mock("../utils/audio", () => ({
  playHoverSound: vi.fn(),
  playSelectSound: vi.fn(),
  playMapConnectNodesSound: vi.fn(),
  playMapDeleteNodeSound: vi.fn(),
  playMapDisconnectNodesSound: vi.fn(),
  playMapInvalidActionSound: vi.fn(),
  playMapPlaceNodeSound: vi.fn(),
  playMapUndoRedoSound: vi.fn(),
}));

import { MapEditorRoute } from "./map-editor";

function getCanvasNodePositions() {
  const props = mocks.canvasProps as { config: { nodes: Array<{ id: string; styleHint?: { x?: number; y?: number } }> } } | null;
  return (props?.config.nodes ?? []).map((node) => ({
    id: node.id,
    x: node.styleHint?.x ?? null,
    y: node.styleHint?.y ?? null,
  }));
}

async function enterEditor() {
  const label = await screen.findByText("Edit Test Playlist");
  fireEvent.click(label);
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

  mocks.playlists.create.mockImplementation(async ({ name }: { name: string }) => makePlaylist("playlist-new", name));
  mocks.playlists.list.mockResolvedValue(mocks.loaderData.availablePlaylists);
  mocks.playlists.getActive.mockResolvedValue(mocks.loaderData.activePlaylist);
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
  mocks.playlists.update.mockImplementation(async ({ playlistId, config }: { playlistId: string; config: unknown }) => ({
    ...makePlaylist(playlistId, "Test Playlist"),
    config,
  }));
  mocks.playlists.exportToFile.mockResolvedValue(undefined);
  mocks.playlists.setActive.mockResolvedValue(undefined);
  vi.mocked(window.electronAPI.dialog.selectPlaylistImportFile).mockResolvedValue(null);
  vi.mocked(window.electronAPI.dialog.selectPlaylistExportPath).mockResolvedValue(null);
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

    fireEvent.keyDown(window, { key: "z", code: "KeyZ", ctrlKey: true });
    await waitFor(() => {
      expect(screen.getByTestId("node-count").textContent).toBe("5");
    });
  });

  it("shows layout controls and applies the selected layout strategy", async () => {
    render(<MapEditorRoute />);
    await enterEditor();

    const before = getCanvasNodePositions();
    fireEvent.change(screen.getByLabelText("Layout strategy"), { target: { value: "layeredVertical" } });
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
      expect(mocks.navigate).toHaveBeenCalledWith({ to: "/game" });
    });
  });

  it("imports a .fplay playlist into the graph editor", async () => {
    vi.mocked(window.electronAPI.dialog.selectPlaylistImportFile).mockResolvedValue("/tmp/imported.fplay");

    render(<MapEditorRoute />);

    fireEvent.click(screen.getByRole("button", { name: "Import .fplay" }));

    await waitFor(() => {
      expect(mocks.playlists.analyzeImportFile).toHaveBeenCalledWith("/tmp/imported.fplay");
      expect(mocks.playlists.importFromFile).toHaveBeenCalledWith({ filePath: "/tmp/imported.fplay" });
      expect(screen.getByText("Imported Playlist")).toBeDefined();
      expect(screen.getByTestId("tool-value")).toBeDefined();
    });
  });

  it("exports the current graph playlist after persisting dirty changes", async () => {
    vi.mocked(window.electronAPI.dialog.selectPlaylistExportPath).mockResolvedValue("/tmp/test-playlist.fplay");

    render(<MapEditorRoute />);
    await enterEditor();

    fireEvent.change(screen.getByLabelText("Layout strategy"), { target: { value: "layeredVertical" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply Layout" }));
    await waitFor(() => {
      expect(screen.getByText(/unsaved/i)).toBeDefined();
    });

    fireEvent.click(screen.getByRole("button", { name: "Export" }));

    await waitFor(() => {
      expect(mocks.playlists.update).toHaveBeenCalledTimes(1);
      expect(mocks.playlists.exportToFile).toHaveBeenCalledWith("playlist-1", "/tmp/test-playlist.fplay");
    });
  });

  it("persists graph perk settings and enabled perks", async () => {
    render(<MapEditorRoute />);
    await enterEditor();

    fireEvent.click(screen.getByRole("button", { name: "Settings" }));

    fireEvent.change(screen.getByLabelText("Random perk selection chance"), { target: { value: "55" } });
    fireEvent.change(screen.getByLabelText("Intermediary initial"), { target: { value: "4" } });
    fireEvent.change(screen.getByLabelText("Intermediary increase"), { target: { value: "7" } });
    fireEvent.change(screen.getByLabelText("Intermediary max"), { target: { value: "88" } });
    fireEvent.change(screen.getByLabelText("Anti-perk initial"), { target: { value: "3" } });
    fireEvent.change(screen.getByLabelText("Anti-perk increase"), { target: { value: "9" } });
    fireEvent.change(screen.getByLabelText("Anti-perk max"), { target: { value: "77" } });
    fireEvent.change(screen.getByLabelText("Cum round bonus score"), { target: { value: "180" } });

    fireEvent.click(screen.getByRole("button", { name: /Loaded Dice/i }));
    fireEvent.click(screen.getByRole("button", { name: /Jammed Dice/i }));

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(mocks.playlists.update).toHaveBeenCalledTimes(1);
    });

    const updateCall = mocks.playlists.update.mock.calls[0]?.[0] as { config: ReturnType<typeof makePlaylist>["config"] };
    expect(updateCall.config.perkSelection.triggerChancePerCompletedRound).toBe(0.55);
    expect(updateCall.config.probabilityScaling.initialIntermediaryProbability).toBe(0.04);
    expect(updateCall.config.probabilityScaling.intermediaryIncreasePerRound).toBe(0.07);
    expect(updateCall.config.probabilityScaling.maxIntermediaryProbability).toBe(0.88);
    expect(updateCall.config.probabilityScaling.initialAntiPerkProbability).toBe(0.03);
    expect(updateCall.config.probabilityScaling.antiPerkIncreasePerRound).toBe(0.09);
    expect(updateCall.config.probabilityScaling.maxAntiPerkProbability).toBe(0.77);
    expect(updateCall.config.economy.scorePerCumRoundSuccess).toBe(180);
    expect(updateCall.config.perkPool.enabledPerkIds).toContain("loaded-dice");
    expect(updateCall.config.perkPool.enabledAntiPerkIds).toContain("jammed-dice");
  });

  it("shows and persists force stop for round nodes only", async () => {
    render(<MapEditorRoute />);
    await enterEditor();

    const canvasProps = mocks.canvasProps as { onSelectionChange?: (selection: unknown) => void } | null;
    await act(async () => {
      canvasProps?.onSelectionChange?.({
        selectedNodeIds: ["round-1"],
        primaryNodeId: "round-1",
        selectedEdgeId: null,
      });
    });

    const forceStopCheckbox = await screen.findByRole("checkbox");
    expect(screen.getByText("Force stop")).toBeDefined();
    fireEvent.click(forceStopCheckbox);

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(mocks.playlists.update).toHaveBeenCalledTimes(1);
    });

    const updateCall = mocks.playlists.update.mock.calls[0]?.[0] as { config: ReturnType<typeof makePlaylist>["config"] };
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

  it("does not reset the graph when reset confirmation is cancelled", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);

    render(<MapEditorRoute />);
    await enterEditor();

    fireEvent.click(screen.getAllByRole("button", { name: /Path/i })[0]!);
    fireEvent.click(screen.getByRole("button", { name: "Place Via Canvas" }));
    await waitFor(() => {
      expect(screen.getByTestId("node-count").textContent).toBe("5");
    });

    fireEvent.click(screen.getByRole("button", { name: "Reset Graph" }));

    expect(confirmSpy).toHaveBeenCalledWith(
      "Are you sure you want to reset the graph? This will delete all progress made.",
    );
    expect(screen.getByTestId("node-count").textContent).toBe("5");

    confirmSpy.mockRestore();
  });

  it("resets the graph after explicit confirmation", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);

    render(<MapEditorRoute />);
    await enterEditor();

    fireEvent.click(screen.getAllByRole("button", { name: /Path/i })[0]!);
    fireEvent.click(screen.getByRole("button", { name: "Place Via Canvas" }));
    await waitFor(() => {
      expect(screen.getByTestId("node-count").textContent).toBe("5");
    });

    fireEvent.click(screen.getByRole("button", { name: "Reset Graph" }));

    await waitFor(() => {
      expect(screen.getByTestId("node-count").textContent).toBe("4");
    });

    confirmSpy.mockRestore();
  });
});
