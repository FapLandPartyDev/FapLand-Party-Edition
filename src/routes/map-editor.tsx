import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatedBackground } from "../components/AnimatedBackground";
import { PlaylistResolutionModal } from "../components/PlaylistResolutionModal";
import { getSinglePlayerAntiPerkPool, getSinglePlayerPerkPool } from "../game/data/perks";
import {
  analyzePlaylistResolution,
  applyPlaylistResolutionMapping,
  type PlaylistResolutionAnalysis,
} from "../game/playlistResolution";
import { resolvePortableRoundRef, toPortableRoundRef } from "../game/playlistRuntime";
import { EditorCanvas } from "../features/map-editor/EditorCanvas";
import { createEditorId, EMPTY_EDITOR_SELECTION, layoutLinearGraphFromPlaylist, toEditorGraphConfig, toGraphBoardConfig, type EditorEdge, type EditorGraphConfig, type EditorNode, type EditorSelectionState, type MapEditorTool, type ViewportState } from "../features/map-editor/EditorState";
import { UndoManager } from "../features/map-editor/UndoManager";
import { buildTileHotkeyMap, deleteSelectionFromConfig, isTextInputElement } from "../features/map-editor/editorInteractions";
import { loadTileCatalog, type TileCatalog, type TileCatalogCategory, type TileCatalogTile } from "../features/map-editor/tileCatalog";
import { clearMapEditorTestSession, getMapEditorTestPlaylistId, setMapEditorTestSession } from "../features/map-editor/testSession";
import { validateGraphConfig } from "../features/map-editor/validateGraphConfig";
import { db, type InstalledRound } from "../services/db";
import { playlists, type StoredPlaylist } from "../services/playlists";
import {
  playHoverSound,
  playMapConnectNodesSound,
  playMapDeleteNodeSound,
  playMapDisconnectNodesSound,
  playMapInvalidActionSound,
  playMapPlaceNodeSound,
  playMapUndoRedoSound,
  playSelectSound,
} from "../utils/audio";
import { PlaylistPickerView } from "../features/map-editor/components/PlaylistPickerView";
import { EditorToolbar } from "../features/map-editor/components/EditorToolbar";
import { TileSidebar } from "../features/map-editor/components/TileSidebar";
import { NodeInspectorPanel } from "../features/map-editor/components/NodeInspectorPanel";
import { EdgeInspectorPanel } from "../features/map-editor/components/EdgeInspectorPanel";
import { GraphSettingsPanel } from "../features/map-editor/components/GraphSettingsPanel";
import { ValidationPanel } from "../features/map-editor/components/ValidationPanel";
import { EditorStatusBar } from "../features/map-editor/components/EditorStatusBar";
import { realignGraph, type GraphAlignmentStrategy } from "../features/map-editor/graphAlignment";

const DEFAULT_TILE_CATALOG: TileCatalog = {
  version: 1,
  categories: [],
  tiles: [],
};

const DEFAULT_EDITOR_VIEWPORT: ViewportState = {
  x: 60,
  y: 60,
  zoom: 0.9,
};

type InspectorTab = "node" | "edge" | "settings" | "validation";
type ResolutionModalState =
  | {
    context: "import";
    title: string;
    filePath: string;
    analysis: PlaylistResolutionAnalysis;
  }
  | {
    context: "playlist";
    title: string;
    analysis: PlaylistResolutionAnalysis;
  };
type ImportedPlaylistReview = {
  playlistId: string;
  analysis: PlaylistResolutionAnalysis;
};

const INSPECTOR_TABS: ReadonlyArray<{ id: InspectorTab; label: string }> = [
  { id: "node", label: "Node" },
  { id: "edge", label: "Edge" },
  { id: "settings", label: "Settings" },
  { id: "validation", label: "Checks" },
];

const getInstalledRounds = async (): Promise<InstalledRound[]> => {
  try {
    return await db.round.findInstalled();
  } catch (error) {
    console.error("Failed to fetch installed rounds for map editor", error);
    return [];
  }
};

const withActivePlaylist = (playlistsToShow: StoredPlaylist[], activePlaylist: StoredPlaylist): StoredPlaylist[] => {
  if (playlistsToShow.some((playlist) => playlist.id === activePlaylist.id)) {
    return playlistsToShow;
  }
  return [activePlaylist, ...playlistsToShow];
};

const toEditorConfigFromPlaylist = (playlist: StoredPlaylist): EditorGraphConfig => {
  const board = playlist.config.boardConfig;
  const graphConfig = board.mode === "graph" ? toEditorGraphConfig(board) : layoutLinearGraphFromPlaylist(board);
  return {
    ...graphConfig,
    perkSelection: {
      optionsPerPick: playlist.config.perkSelection.optionsPerPick,
      triggerChancePerCompletedRound: playlist.config.perkSelection.triggerChancePerCompletedRound,
    },
    perkPool: {
      enabledPerkIds: [...playlist.config.perkPool.enabledPerkIds],
      enabledAntiPerkIds: [...playlist.config.perkPool.enabledAntiPerkIds],
    },
    probabilityScaling: {
      initialIntermediaryProbability: playlist.config.probabilityScaling.initialIntermediaryProbability,
      initialAntiPerkProbability: playlist.config.probabilityScaling.initialAntiPerkProbability,
      intermediaryIncreasePerRound: playlist.config.probabilityScaling.intermediaryIncreasePerRound,
      antiPerkIncreasePerRound: playlist.config.probabilityScaling.antiPerkIncreasePerRound,
      maxIntermediaryProbability: playlist.config.probabilityScaling.maxIntermediaryProbability,
      maxAntiPerkProbability: playlist.config.probabilityScaling.maxAntiPerkProbability,
    },
    economy: {
      scorePerCumRoundSuccess: playlist.config.economy.scorePerCumRoundSuccess,
    },
  };
};

export const Route = createFileRoute("/map-editor")({
  loader: async () => {
    const [installedRounds, availablePlaylists, activePlaylist] = await Promise.all([
      getInstalledRounds(),
      playlists.list(),
      playlists.getActive(),
    ]);
    return {
      installedRounds,
      availablePlaylists: withActivePlaylist(availablePlaylists, activePlaylist),
      activePlaylist,
    };
  },
  component: MapEditorRoute,
});

const makeStartingConfig = (): EditorGraphConfig => ({
  mode: "graph",
  startNodeId: "start",
  nodes: [
    {
      id: "start",
      name: "Start",
      kind: "start",
      styleHint: { x: 120, y: 210, width: 190, height: 84 },
    },
    {
      id: "path-1",
      name: "Path",
      kind: "path",
      styleHint: { x: 430, y: 210, width: 190, height: 84 },
    },
    {
      id: "round-1",
      name: "Round 1",
      kind: "round",
      roundRef: { name: "Round 1" },
      styleHint: { x: 740, y: 210, width: 190, height: 84 },
    },
    {
      id: "end",
      name: "End",
      kind: "end",
      styleHint: { x: 1050, y: 210, width: 190, height: 84 },
    },
  ],
  edges: [
    { id: "edge-start-path-1", fromNodeId: "start", toNodeId: "path-1", gateCost: 0, weight: 1 },
    { id: "edge-path-1-round-1", fromNodeId: "path-1", toNodeId: "round-1", gateCost: 0, weight: 1 },
    { id: "edge-round-1-end", fromNodeId: "round-1", toNodeId: "end", gateCost: 0, weight: 1 },
  ],
  randomRoundPools: [],
  cumRoundRefs: [],
  pathChoiceTimeoutMs: 6000,
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
    scorePerCumRoundSuccess: 120,
  },
});

const toTitleCase = (input: string): string =>
  `${input.slice(0, 1).toUpperCase()}${input.slice(1)}`;

const idsEqual = (left: string[], right: string[]): boolean => {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
};

const selectionsEqual = (left: EditorSelectionState, right: EditorSelectionState): boolean =>
  left.primaryNodeId === right.primaryNodeId
  && left.selectedEdgeId === right.selectedEdgeId
  && idsEqual(left.selectedNodeIds, right.selectedNodeIds);

type GraphUpdateFn = (previous: EditorGraphConfig) => EditorGraphConfig;

export function MapEditorRoute() {
  const navigate = useNavigate();
  const {
    installedRounds,
    availablePlaylists,
    activePlaylist,
  } = Route.useLoaderData() as {
    installedRounds: InstalledRound[];
    availablePlaylists: StoredPlaylist[];
    activePlaylist: StoredPlaylist;
  };
  const [playlistList, setPlaylistList] = useState<StoredPlaylist[]>(availablePlaylists);
  const [activePlaylistId, setActivePlaylistId] = useState(activePlaylist.id);
  const [selectedPlaylistId, setSelectedPlaylistId] = useState<string | null>(null);
  const [newPlaylistName, setNewPlaylistName] = useState("");
  const [createPlaylistPending, setCreatePlaylistPending] = useState(false);
  const [importPending, setImportPending] = useState(false);
  const [savePending, setSavePending] = useState(false);
  const [testMapPending, setTestMapPending] = useState(false);
  const [saveNotice, setSaveNotice] = useState<string | null>(null);
  const [resolutionModalState, setResolutionModalState] = useState<ResolutionModalState | null>(null);
  const [importedPlaylistReview, setImportedPlaylistReview] = useState<ImportedPlaylistReview | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  const [config, setConfig] = useState<EditorGraphConfig>(makeStartingConfig);
  const configRef = useRef(config);
  configRef.current = config;

  const [selection, setSelection] = useState<EditorSelectionState>(EMPTY_EDITOR_SELECTION);
  const [connectFromNodeId, setConnectFromNodeId] = useState<string | null>(null);
  const [tool, setTool] = useState<MapEditorTool>("select");
  const [showGrid, setShowGrid] = useState(true);
  const [alignmentStrategy, setAlignmentStrategy] = useState<GraphAlignmentStrategy>("layeredHorizontal");
  const [viewport, setViewport] = useState<ViewportState>(DEFAULT_EDITOR_VIEWPORT);
  const [spacePanActive, setSpacePanActive] = useState(false);
  const [historyState, setHistoryState] = useState({ canUndo: false, canRedo: false });

  const [tileCatalog, setTileCatalog] = useState<TileCatalog>(DEFAULT_TILE_CATALOG);
  const [tileSearch, setTileSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState<TileCatalogCategory["id"] | "all">("all");
  const [activePlacementKind, setActivePlacementKind] = useState<EditorNode["kind"]>("path");

  const [recentlyPlacedNodeIds, setRecentlyPlacedNodeIds] = useState<string[]>([]);
  const [recentlyTouchedEdgeIds, setRecentlyTouchedEdgeIds] = useState<string[]>([]);

  const [inspectorTab, setInspectorTab] = useState<InspectorTab>("node");
  const [inspectorCollapsed, setInspectorCollapsed] = useState(false);

  const undoManagerRef = useRef(new UndoManager<EditorGraphConfig>(makeStartingConfig(), {
    isEqual: (left, right) => JSON.stringify(left) === JSON.stringify(right),
  }));

  const dragSessionRef = useRef<{ active: boolean; moved: boolean }>({ active: false, moved: false });

  const syncHistoryState = useCallback(() => {
    const manager = undoManagerRef.current;
    setHistoryState({
      canUndo: manager.canUndo(),
      canRedo: manager.canRedo(),
    });
  }, []);

  const updateGraphConfig = useCallback((updater: GraphUpdateFn, commit = true): boolean => {
    const previous = configRef.current;
    const next = updater(previous);
    if (next === previous) return false;
    configRef.current = next;
    setConfig(next);
    setIsDirty(true);
    setSaveNotice(null);
    if (commit) {
      undoManagerRef.current.push(next);
      syncHistoryState();
    }
    return true;
  }, [syncHistoryState]);

  const flashPlacedNode = useCallback((nodeId: string) => {
    setRecentlyPlacedNodeIds((previous) => (previous.includes(nodeId) ? previous : [...previous, nodeId]));
    window.setTimeout(() => {
      setRecentlyPlacedNodeIds((previous) => previous.filter((id) => id !== nodeId));
    }, 220);
  }, []);

  const flashTouchedEdge = useCallback((edgeId: string) => {
    setRecentlyTouchedEdgeIds((previous) => (previous.includes(edgeId) ? previous : [...previous, edgeId]));
    window.setTimeout(() => {
      setRecentlyTouchedEdgeIds((previous) => previous.filter((id) => id !== edgeId));
    }, 260);
  }, []);

  useEffect(() => {
    let active = true;
    void loadTileCatalog()
      .then((catalog) => {
        if (!active) return;
        setTileCatalog(catalog);
        if (catalog.tiles.length > 0) {
          setActivePlacementKind((previous) => (
            catalog.tiles.some((tile) => tile.kind === previous)
              ? previous
              : catalog.tiles[0]?.kind ?? previous
          ));
        }
      })
      .catch((error) => {
        console.warn("Failed to load tile catalog", error);
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let mounted = true;
    const pollScanStatus = async () => {
      try {
        await db.install.getScanStatus();
        if (mounted) {
          // setScanStatus(status); // Removed as per instruction
        }
      } catch (error) {
        console.error("Failed to poll install scan status", error);
      }
    };
    void pollScanStatus();
    const interval = window.setInterval(() => {
      void pollScanStatus();
    }, 2000);
    return () => {
      mounted = false;
      window.clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    if (!connectFromNodeId) return;
    if (!config.nodes.some((node) => node.id === connectFromNodeId)) {
      setConnectFromNodeId(null);
    }
  }, [config.nodes, connectFromNodeId]);

  useEffect(() => {
    if (tool !== "connect") {
      setConnectFromNodeId(null);
    }
  }, [tool]);

  const selectedPlaylist = useMemo(() => (
    selectedPlaylistId
      ? playlistList.find((playlist) => playlist.id === selectedPlaylistId) ?? null
      : null
  ), [playlistList, selectedPlaylistId]);

  const applyEditorConfig = useCallback((nextConfig: EditorGraphConfig) => {
    setConfig(nextConfig);
    configRef.current = nextConfig;
    undoManagerRef.current.reset(nextConfig);
    syncHistoryState();
    setSelection(EMPTY_EDITOR_SELECTION);
    setConnectFromNodeId(null);
    setTool("select");
    setViewport(DEFAULT_EDITOR_VIEWPORT);
    setSpacePanActive(false);
    setIsDirty(false);
    setSaveNotice(null);
  }, [syncHistoryState]);

  const openPlaylistForEditing = useCallback((playlist: StoredPlaylist) => {
    playSelectSound();
    setSelectedPlaylistId(playlist.id);
    applyEditorConfig(toEditorConfigFromPlaylist(playlist));
  }, [applyEditorConfig]);

  const updatePlaylistListEntry = useCallback((updated: StoredPlaylist) => {
    setPlaylistList((previous) => {
      const hasEntry = previous.some((playlist) => playlist.id === updated.id);
      if (!hasEntry) return [updated, ...previous];
      return previous.map((playlist) => (playlist.id === updated.id ? updated : playlist));
    });
  }, []);

  const refreshPlaylistPickerData = useCallback(async () => {
    try {
      const [available, active] = await Promise.all([
        playlists.list(),
        playlists.getActive(),
      ]);
      setPlaylistList(withActivePlaylist(available, active));
      setActivePlaylistId(active.id);
    } catch (error) {
      console.error("Failed to refresh map editor playlists", error);
    }
  }, []);

  useEffect(() => {
    if (selectedPlaylistId) return;
    const playlistId = getMapEditorTestPlaylistId();
    if (!playlistId) return;
    const playlist = playlistList.find((entry) => entry.id === playlistId);
    clearMapEditorTestSession();
    if (!playlist) return;
    openPlaylistForEditing(playlist);
  }, [openPlaylistForEditing, playlistList, selectedPlaylistId]);

  useEffect(() => {
    if (selectedPlaylistId) return;
    void refreshPlaylistPickerData();
  }, [refreshPlaylistPickerData, selectedPlaylistId]);

  const perkOptions = useMemo(() => getSinglePlayerPerkPool(), []);
  const antiPerkOptions = useMemo(() => getSinglePlayerAntiPerkPool(), []);
  const cumRounds = useMemo(() => installedRounds.filter((round) => round.type === "Cum"), [installedRounds]);
  const selectedCumRoundIds = useMemo(
    () => config.cumRoundRefs.map((ref) => resolvePortableRoundRef(ref, installedRounds)?.id ?? ref.idHint ?? ""),
    [config.cumRoundRefs, installedRounds],
  );
  const selectedCumRoundIdSet = useMemo(
    () => new Set(selectedCumRoundIds.filter((id) => id.length > 0)),
    [selectedCumRoundIds],
  );
  const validation = useMemo(() => validateGraphConfig(config, installedRounds), [config, installedRounds]);
  const selectedPlaylistResolution = useMemo(
    () => (selectedPlaylist
      ? analyzePlaylistResolution({
        ...selectedPlaylist.config,
        boardConfig: toGraphBoardConfig(config),
      }, installedRounds)
      : null),
    [config, installedRounds, selectedPlaylist],
  );
  const selectedImportReview = selectedPlaylist && importedPlaylistReview?.playlistId === selectedPlaylist.id
    ? importedPlaylistReview
    : null;
  const selectedResolutionReview = selectedPlaylistResolution && selectedPlaylistResolution.issues.length > 0
    ? selectedPlaylistResolution
    : selectedImportReview?.analysis ?? null;
  const selectedResolutionActionLabel = selectedPlaylistResolution && selectedPlaylistResolution.issues.length > 0
    ? (selectedPlaylistResolution.counts.missing > 0 ? "Resolve Missing" : "Review Auto-Resolve")
    : (selectedImportReview ? "Review Auto-Resolve" : null);

  const selectedNode = useMemo(() => (
    selection.primaryNodeId ? config.nodes.find((node) => node.id === selection.primaryNodeId) ?? null : null
  ), [config.nodes, selection.primaryNodeId]);

  const selectedEdge = useMemo(() => (
    selection.selectedEdgeId ? config.edges.find((edge) => edge.id === selection.selectedEdgeId) ?? null : null
  ), [config.edges, selection.selectedEdgeId]);

  const outgoingEdgesForSelectedNode = useMemo(() => {
    if (!selectedNode) return [];
    return config.edges.filter((edge) => edge.fromNodeId === selectedNode.id);
  }, [config.edges, selectedNode]);

  const tilesByKind = useMemo(() => {
    const map = new Map<EditorNode["kind"], TileCatalogTile & { kind: EditorNode["kind"] }>();
    for (const tile of tileCatalog.tiles) {
      if (!map.has(tile.kind)) {
        map.set(tile.kind, tile);
      }
    }
    return map;
  }, [tileCatalog.tiles]);

  const filteredTiles = useMemo(() => {
    const query = tileSearch.trim().toLowerCase();
    return tileCatalog.tiles.filter((tile) => {
      if (activeCategory !== "all" && tile.category !== activeCategory) return false;
      if (!query) return true;
      const haystack = `${tile.label} ${tile.description ?? ""} ${tile.kind} ${(tile.tags ?? []).join(" ")}`.toLowerCase();
      return haystack.includes(query);
    });
  }, [activeCategory, tileCatalog.tiles, tileSearch]);

  const tileById = useMemo(() => {
    const map = new Map<string, TileCatalogTile & { kind: EditorNode["kind"] }>();
    for (const tile of tileCatalog.tiles) {
      map.set(tile.id, tile);
    }
    return map;
  }, [tileCatalog.tiles]);

  const hotkeyMap = useMemo(() => buildTileHotkeyMap(filteredTiles), [filteredTiles]);

  const activeTile = useMemo(() => {
    return tileCatalog.tiles.find((tile) => tile.kind === activePlacementKind) ?? filteredTiles[0] ?? null;
  }, [activePlacementKind, filteredTiles, tileCatalog.tiles]);


  const selectedEdgeLabel = useMemo(() => {
    if (!selection.selectedEdgeId) return "None";
    const edge = config.edges.find((candidate) => candidate.id === selection.selectedEdgeId);
    if (!edge) return "None";
    return `${edge.fromNodeId} → ${edge.toNodeId}`;
  }, [config.edges, selection.selectedEdgeId]);

  const commitSelection = useCallback((next: EditorSelectionState) => {
    setSelection((previous) => (selectionsEqual(previous, next) ? previous : next));
  }, []);

  const armTile = useCallback((tile: TileCatalogTile & { kind: EditorNode["kind"] }) => {
    playSelectSound();
    setActivePlacementKind(tile.kind);
    setTool("place");
  }, []);

  const patchNode = useCallback((nodeId: string, patch: Partial<EditorNode>) => {
    updateGraphConfig((previous) => {
      const nextNodes = previous.nodes.map((node) => {
        if (node.id !== nodeId) return node;
        return {
          ...node,
          ...patch,
          styleHint: patch.styleHint ? { ...node.styleHint, ...patch.styleHint } : node.styleHint,
        };
      });
      return {
        ...previous,
        nodes: nextNodes,
      };
    });
  }, [updateGraphConfig]);

  const toggleCumRound = useCallback((round: InstalledRound) => {
    updateGraphConfig((previous) => {
      const nextCumRoundRefs = [...previous.cumRoundRefs];
      const existingIndex = nextCumRoundRefs.findIndex((ref) => resolvePortableRoundRef(ref, installedRounds)?.id === round.id || ref.idHint === round.id);
      if (existingIndex >= 0) {
        nextCumRoundRefs.splice(existingIndex, 1);
      } else {
        nextCumRoundRefs.push(toPortableRoundRef(round));
      }
      return {
        ...previous,
        cumRoundRefs: nextCumRoundRefs,
      };
    });
  }, [installedRounds, updateGraphConfig]);

  const moveCumRound = useCallback((roundId: string, direction: -1 | 1) => {
    updateGraphConfig((previous) => {
      const currentIndex = previous.cumRoundRefs.findIndex((ref) => resolvePortableRoundRef(ref, installedRounds)?.id === roundId || ref.idHint === roundId);
      if (currentIndex < 0) return previous;
      const nextIndex = currentIndex + direction;
      if (nextIndex < 0 || nextIndex >= previous.cumRoundRefs.length) return previous;
      const nextCumRoundRefs = [...previous.cumRoundRefs];
      const [moved] = nextCumRoundRefs.splice(currentIndex, 1);
      if (!moved) return previous;
      nextCumRoundRefs.splice(nextIndex, 0, moved);
      return {
        ...previous,
        cumRoundRefs: nextCumRoundRefs,
      };
    });
  }, [installedRounds, updateGraphConfig]);

  const removeCumRoundByIndex = useCallback((index: number) => {
    updateGraphConfig((previous) => ({
      ...previous,
      cumRoundRefs: previous.cumRoundRefs.filter((_, refIndex) => refIndex !== index),
    }));
  }, [updateGraphConfig]);

  const setPerkTriggerChance = useCallback((value: number) => {
    updateGraphConfig((previous) => ({
      ...previous,
      perkSelection: {
        ...previous.perkSelection,
        triggerChancePerCompletedRound: Math.max(0, Math.min(1, value)),
      },
    }));
  }, [updateGraphConfig]);

  const setProbabilityScaling = useCallback((
    key: keyof EditorGraphConfig["probabilityScaling"],
    value: number,
  ) => {
    updateGraphConfig((previous) => ({
      ...previous,
      probabilityScaling: {
        ...previous.probabilityScaling,
        [key]: Math.max(0, Math.min(1, value)),
      },
    }));
  }, [updateGraphConfig]);

  const setCumRoundBonusScore = useCallback((value: number) => {
    updateGraphConfig((previous) => ({
      ...previous,
      economy: {
        ...previous.economy,
        scorePerCumRoundSuccess: Math.max(0, Math.floor(value)),
      },
    }));
  }, [updateGraphConfig]);

  const togglePerkEnabled = useCallback((perkId: string) => {
    updateGraphConfig((previous) => {
      const enabled = previous.perkPool.enabledPerkIds.includes(perkId);
      return {
        ...previous,
        perkPool: {
          ...previous.perkPool,
          enabledPerkIds: enabled
            ? previous.perkPool.enabledPerkIds.filter((id) => id !== perkId)
            : [...previous.perkPool.enabledPerkIds, perkId],
        },
      };
    });
  }, [updateGraphConfig]);

  const toggleAntiPerkEnabled = useCallback((perkId: string) => {
    updateGraphConfig((previous) => {
      const enabled = previous.perkPool.enabledAntiPerkIds.includes(perkId);
      return {
        ...previous,
        perkPool: {
          ...previous.perkPool,
          enabledAntiPerkIds: enabled
            ? previous.perkPool.enabledAntiPerkIds.filter((id) => id !== perkId)
            : [...previous.perkPool.enabledAntiPerkIds, perkId],
        },
      };
    });
  }, [updateGraphConfig]);

  const setAllPerksEnabled = useCallback((enabled: boolean) => {
    updateGraphConfig((previous) => ({
      ...previous,
      perkPool: {
        ...previous.perkPool,
        enabledPerkIds: enabled ? perkOptions.map((perk) => perk.id) : [],
      },
    }));
  }, [perkOptions, updateGraphConfig]);

  const setAllAntiPerksEnabled = useCallback((enabled: boolean) => {
    updateGraphConfig((previous) => ({
      ...previous,
      perkPool: {
        ...previous.perkPool,
        enabledAntiPerkIds: enabled ? antiPerkOptions.map((perk) => perk.id) : [],
      },
    }));
  }, [antiPerkOptions, updateGraphConfig]);

  const patchEdge = useCallback((edgeId: string, patch: Partial<EditorEdge>) => {
    updateGraphConfig((previous) => {
      const nextEdges = previous.edges.map((edge) => (edge.id === edgeId ? { ...edge, ...patch } : edge));
      return {
        ...previous,
        edges: nextEdges,
      };
    });
  }, [updateGraphConfig]);

  const createEdge = useCallback((fromNodeId: string, toNodeId: string) => {
    let edgeId: string | null = null;
    const changed = updateGraphConfig((previous) => {
      const sourceNode = previous.nodes.find((node) => node.id === fromNodeId);
      if (sourceNode?.kind === "end") return previous;
      const alreadyConnected = previous.edges.some((edge) => edge.fromNodeId === fromNodeId && edge.toNodeId === toNodeId);
      if (alreadyConnected) return previous;
      const nextEdge: EditorEdge = {
        id: createEditorId("edge"),
        fromNodeId,
        toNodeId,
        gateCost: 0,
        weight: 1,
      };
      edgeId = nextEdge.id;
      return {
        ...previous,
        edges: [...previous.edges, nextEdge],
      };
    });

    if (!changed || !edgeId) {
      playMapInvalidActionSound();
      return;
    }

    playMapConnectNodesSound();
    flashTouchedEdge(edgeId);
    commitSelection({
      selectedNodeIds: [toNodeId],
      primaryNodeId: toNodeId,
      selectedEdgeId: null,
    });
  }, [commitSelection, flashTouchedEdge, updateGraphConfig]);

  const deleteEdgeBetween = useCallback((fromNodeId: string, toNodeId: string) => {
    let removedEdgeId: string | null = null;
    const changed = updateGraphConfig((previous) => {
      const edge = previous.edges.find((candidate) => candidate.fromNodeId === fromNodeId && candidate.toNodeId === toNodeId);
      if (!edge) return previous;
      removedEdgeId = edge.id;
      return {
        ...previous,
        edges: previous.edges.filter((candidate) => candidate.id !== edge.id),
      };
    });

    if (!changed) {
      playMapInvalidActionSound();
      return;
    }
    playMapDisconnectNodesSound();
    if (removedEdgeId) {
      flashTouchedEdge(removedEdgeId);
    }
  }, [flashTouchedEdge, updateGraphConfig]);

  const moveNodes = useCallback((nodeIds: string[], deltaWorldX: number, deltaWorldY: number) => {
    if (nodeIds.length === 0) return;
    if (deltaWorldX === 0 && deltaWorldY === 0) return;
    const selectedNodeIds = new Set(nodeIds);
    const changed = updateGraphConfig((previous) => {
      let moved = false;
      const nextNodes = previous.nodes.map((node) => {
        if (!selectedNodeIds.has(node.id)) return node;
        const baseX = Number(node.styleHint?.x ?? 0);
        const baseY = Number(node.styleHint?.y ?? 0);
        moved = true;
        return {
          ...node,
          styleHint: {
            ...node.styleHint,
            x: baseX + deltaWorldX,
            y: baseY + deltaWorldY,
          },
        };
      });
      return moved
        ? {
          ...previous,
          nodes: nextNodes,
        }
        : previous;
    }, false);

    if (changed) {
      dragSessionRef.current.moved = true;
    }
  }, [updateGraphConfig]);

  const placeNodeAtWorld = useCallback((kind: EditorNode["kind"], worldX: number, worldY: number) => {
    const tileDefinition = tilesByKind.get(kind);
    let createdNodeId: string | null = null;

    const changed = updateGraphConfig((previous) => {
      const width = Math.max(160, Number(tileDefinition?.width ?? 190));
      const height = Math.max(58, Number(tileDefinition?.height ?? 84));
      const baseName = tileDefinition?.defaultName ?? tileDefinition?.label ?? toTitleCase(kind);
      const kindCount = previous.nodes.filter((node) => node.kind === kind).length + 1;
      const nextNode: EditorNode = {
        id: createEditorId(kind),
        name: kindCount === 1 ? baseName : `${baseName} ${kindCount}`,
        kind,
        styleHint: {
          x: worldX - width / 2,
          y: worldY - height / 2,
          width,
          height,
          color: tileDefinition?.color,
          icon: tileDefinition?.icon,
          size: tileDefinition?.size,
        },
      };
      if (kind === "round") {
        nextNode.roundRef = { name: `Round ${kindCount}` };
      }
      if (kind === "perk") {
        nextNode.visualId = perkOptions[0]?.id;
      }
      createdNodeId = nextNode.id;
      return {
        ...previous,
        nodes: [...previous.nodes, nextNode],
      };
    });

    if (!changed || !createdNodeId) {
      playMapInvalidActionSound();
      return;
    }

    playMapPlaceNodeSound();
    flashPlacedNode(createdNodeId);
    commitSelection({
      selectedNodeIds: [createdNodeId],
      primaryNodeId: createdNodeId,
      selectedEdgeId: null,
    });
  }, [commitSelection, flashPlacedNode, perkOptions, tilesByKind, updateGraphConfig]);

  const deleteSelection = useCallback(() => {
    if (selection.selectedNodeIds.length === 0 && !selection.selectedEdgeId) {
      playMapInvalidActionSound();
      return;
    }

    const selectedNodeIds = new Set(selection.selectedNodeIds);
    const changed = updateGraphConfig((previous) => deleteSelectionFromConfig(previous, selection));
    if (!changed) {
      playMapInvalidActionSound();
      return;
    }

    if (selection.selectedNodeIds.length > 0) {
      playMapDeleteNodeSound();
    } else {
      playMapDisconnectNodesSound();
    }

    if (connectFromNodeId && selectedNodeIds.has(connectFromNodeId)) {
      setConnectFromNodeId(null);
    }
    commitSelection(EMPTY_EDITOR_SELECTION);
  }, [commitSelection, connectFromNodeId, selection, updateGraphConfig]);

  const handleUndo = useCallback(() => {
    const nextState = undoManagerRef.current.undo();
    if (!nextState) {
      playMapInvalidActionSound();
      return;
    }
    setConfig(nextState);
    configRef.current = nextState;
    commitSelection(EMPTY_EDITOR_SELECTION);
    setConnectFromNodeId(null);
    syncHistoryState();
    playMapUndoRedoSound();
  }, [commitSelection, syncHistoryState]);

  const handleRedo = useCallback(() => {
    const nextState = undoManagerRef.current.redo();
    if (!nextState) {
      playMapInvalidActionSound();
      return;
    }
    setConfig(nextState);
    configRef.current = nextState;
    commitSelection(EMPTY_EDITOR_SELECTION);
    setConnectFromNodeId(null);
    syncHistoryState();
    playMapUndoRedoSound();
  }, [commitSelection, syncHistoryState]);

  const handleRealignGraph = useCallback(() => {
    const result = realignGraph(configRef.current, alignmentStrategy);
    if (!result.changed) {
      setSaveNotice("Layout already matches selected strategy.");
      playSelectSound();
      return;
    }

    const changed = updateGraphConfig((previous) => ({
      ...previous,
      nodes: result.nodes,
    }));

    if (!changed) {
      playMapInvalidActionSound();
      return;
    }

    setConnectFromNodeId(null);
    playSelectSound();
  }, [alignmentStrategy, updateGraphConfig]);

  const resetView = useCallback(() => {
    setViewport(DEFAULT_EDITOR_VIEWPORT);
    setSpacePanActive(false);
  }, []);

  const resetGraph = useCallback(() => {
    const shouldReset = window.confirm(
      "Are you sure you want to reset the graph? This will delete all progress made.",
    );
    if (!shouldReset) return;

    playSelectSound();
    const nextConfig = makeStartingConfig();
    setConfig(nextConfig);
    configRef.current = nextConfig;
    undoManagerRef.current.reset(nextConfig);
    syncHistoryState();
    commitSelection(EMPTY_EDITOR_SELECTION);
    setConnectFromNodeId(null);
    setTool("select");
    resetView();
    setIsDirty(true);
    setSaveNotice(null);
  }, [commitSelection, resetView, syncHistoryState]);

  const createUpdatedPlaylistConfig = useCallback((playlist: StoredPlaylist) => {
    return {
      ...playlist.config,
      boardConfig: toGraphBoardConfig(configRef.current),
      perkSelection: {
        ...playlist.config.perkSelection,
        ...configRef.current.perkSelection,
      },
      perkPool: {
        enabledPerkIds: [...configRef.current.perkPool.enabledPerkIds],
        enabledAntiPerkIds: [...configRef.current.perkPool.enabledAntiPerkIds],
      },
      probabilityScaling: {
        ...playlist.config.probabilityScaling,
        ...configRef.current.probabilityScaling,
      },
      economy: {
        ...playlist.config.economy,
        ...configRef.current.economy,
      },
    };
  }, []);

  const persistEditedPlaylist = useCallback(async (playlist: StoredPlaylist): Promise<StoredPlaylist | null> => {
    const validation = validateGraphConfig(configRef.current, installedRounds);
    if (validation.hardBlocked) {
      playMapInvalidActionSound();
      const firstError = validation.errors[0]?.message ?? "Map contains validation errors.";
      setSaveNotice(`Cannot continue: ${firstError}`);
      return null;
    }

    const updated = await playlists.update({
      playlistId: playlist.id,
      config: createUpdatedPlaylistConfig(playlist),
    });
    updatePlaylistListEntry(updated);
    if (importedPlaylistReview?.playlistId === playlist.id) {
      setImportedPlaylistReview(null);
    }
    setIsDirty(false);
    if (validation.warnings.length > 0) {
      setSaveNotice(`Saved with ${validation.warnings.length} warning(s).`);
    } else {
      setSaveNotice(`Saved "${updated.name}".`);
    }
    return updated;
  }, [createUpdatedPlaylistConfig, importedPlaylistReview?.playlistId, installedRounds, updatePlaylistListEntry]);

  const handleCreatePlaylist = useCallback(async () => {
    if (createPlaylistPending) return;
    const trimmedName = newPlaylistName.trim();
    const playlistName = trimmedName.length > 0 ? trimmedName : `Map Playlist ${playlistList.length + 1}`;
    setCreatePlaylistPending(true);
    setSaveNotice(null);
    try {
      const created = await playlists.create({ name: playlistName });
      updatePlaylistListEntry(created);
      setNewPlaylistName("");
      openPlaylistForEditing(created);
    } catch (error) {
      console.error("Failed to create playlist from map editor", error);
      setSaveNotice(error instanceof Error ? error.message : "Failed to create playlist.");
      playMapInvalidActionSound();
    } finally {
      setCreatePlaylistPending(false);
    }
  }, [createPlaylistPending, newPlaylistName, openPlaylistForEditing, playlistList.length, updatePlaylistListEntry]);

  const handleOpenPlaylistPicker = useCallback(() => {
    if (isDirty) {
      const shouldDiscard = window.confirm("Discard unsaved map changes and choose another playlist?");
      if (!shouldDiscard) return;
    }
    playSelectSound();
    setSelectedPlaylistId(null);
    setSaveNotice(null);
    void refreshPlaylistPickerData();
  }, [isDirty, refreshPlaylistPickerData]);

  const handleImportPlaylist = useCallback(async () => {
    if (importPending || savePending || testMapPending) return;
    if (selectedPlaylist && isDirty) {
      const shouldDiscard = window.confirm("Discard unsaved map changes and import another playlist?");
      if (!shouldDiscard) return;
    }

    playSelectSound();
    setImportPending(true);
    setSaveNotice(null);
    try {
      const filePath = await window.electronAPI.dialog.selectPlaylistImportFile();
      if (!filePath) return;
      const analysis = await playlists.analyzeImportFile(filePath);
      if (analysis.resolution.counts.missing > 0) {
        setResolutionModalState({
          context: "import",
          title: `Import ${analysis.metadata.name}`,
          filePath,
          analysis: analysis.resolution,
        });
        return;
      }
      const imported = await playlists.importFromFile({ filePath });
      updatePlaylistListEntry(imported.playlist);
      setActivePlaylistId(imported.playlist.id);
      openPlaylistForEditing(imported.playlist);
      if (analysis.resolution.issues.length > 0) {
        setImportedPlaylistReview({
          playlistId: imported.playlist.id,
          analysis: analysis.resolution,
        });
      } else {
        setImportedPlaylistReview(null);
      }
      setSaveNotice(
        analysis.resolution.counts.suggested > 0
          ? `Imported "${imported.playlist.name}" with ${analysis.resolution.counts.suggested} auto-resolved ref(s).`
          : `Imported "${imported.playlist.name}".`,
      );
    } catch (error) {
      console.error("Failed to import playlist from map editor", error);
      setSaveNotice(error instanceof Error ? error.message : "Failed to import playlist.");
      playMapInvalidActionSound();
    } finally {
      setImportPending(false);
    }
  }, [importPending, isDirty, openPlaylistForEditing, savePending, selectedPlaylist, testMapPending, updatePlaylistListEntry]);

  const handleExportPlaylist = useCallback(async () => {
    if (!selectedPlaylist) return;
    if (importPending || savePending || testMapPending) return;

    playSelectSound();
    setSavePending(true);
    setSaveNotice(null);
    try {
      const filePath = await window.electronAPI.dialog.selectPlaylistExportPath(selectedPlaylist.name);
      if (!filePath) return;

      const playlistToExport = isDirty
        ? await persistEditedPlaylist(selectedPlaylist)
        : selectedPlaylist;
      if (!playlistToExport) return;

      await playlists.exportToFile(playlistToExport.id, filePath);
      setSaveNotice(`Exported "${playlistToExport.name}".`);
    } catch (error) {
      console.error("Failed to export playlist from map editor", error);
      setSaveNotice(error instanceof Error ? error.message : "Failed to export playlist.");
      playMapInvalidActionSound();
    } finally {
      setSavePending(false);
    }
  }, [importPending, isDirty, persistEditedPlaylist, savePending, selectedPlaylist, testMapPending]);

  const handleSavePlaylist = useCallback(async () => {
    if (!selectedPlaylist) return;
    if (importPending || savePending || testMapPending) return;
    setSavePending(true);
    try {
      await persistEditedPlaylist(selectedPlaylist);
    } catch (error) {
      console.error("Failed to save playlist from map editor", error);
      setSaveNotice(error instanceof Error ? error.message : "Failed to save playlist.");
      playMapInvalidActionSound();
    } finally {
      setSavePending(false);
    }
  }, [importPending, persistEditedPlaylist, savePending, selectedPlaylist, testMapPending]);

  const handleTestMap = useCallback(async () => {
    if (!selectedPlaylist) return;
    if (importPending || savePending || testMapPending) return;
    setTestMapPending(true);
    try {
      const updated = await persistEditedPlaylist(selectedPlaylist);
      if (!updated) return;
      await playlists.setActive(updated.id);
      setActivePlaylistId(updated.id);
      setMapEditorTestSession(updated.id);
      playSelectSound();
      await navigate({ to: "/game" });
    } catch (error) {
      console.error("Failed to start map test", error);
      setSaveNotice(error instanceof Error ? error.message : "Failed to start map test.");
      playMapInvalidActionSound();
    } finally {
      setTestMapPending(false);
    }
  }, [importPending, navigate, persistEditedPlaylist, savePending, selectedPlaylist, testMapPending]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const isTyping = isTextInputElement(event.target);
      if (event.code === "Space") {
        if (!isTyping) {
          setSpacePanActive(true);
          event.preventDefault();
        }
        return;
      }
      if (isTyping) return;
      if (!selectedPlaylist) return;

      const key = event.key.toLowerCase();
      const usesCommand = event.metaKey || event.ctrlKey;

      if (usesCommand && key === "z") {
        event.preventDefault();
        if (event.shiftKey) {
          handleRedo();
        } else {
          handleUndo();
        }
        return;
      }

      if (usesCommand && key === "y") {
        event.preventDefault();
        handleRedo();
        return;
      }

      if (usesCommand && key === "s") {
        event.preventDefault();
        void handleSavePlaylist();
        return;
      }

      if (!usesCommand && key === "x") {
        event.preventDefault();
        deleteSelection();
        return;
      }

      if (event.key >= "1" && event.key <= "9") {
        const tileId = hotkeyMap[event.key];
        if (!tileId) return;
        const tile = tileById.get(tileId);
        if (!tile) return;
        event.preventDefault();
        armTile(tile);
        return;
      }

      if (key === "escape") {
        event.preventDefault();
        setConnectFromNodeId(null);
        commitSelection(EMPTY_EDITOR_SELECTION);
        return;
      }

      if (key === "v") {
        event.preventDefault();
        playSelectSound();
        setTool("select");
        return;
      }

      if (key === "p") {
        event.preventDefault();
        playSelectSound();
        setTool("place");
        return;
      }

      if (key === "c") {
        event.preventDefault();
        playSelectSound();
        setTool("connect");
        return;
      }

      if (key === "g") {
        event.preventDefault();
        playSelectSound();
        setShowGrid((previous) => !previous);
        return;
      }

      if (key === "l") {
        event.preventDefault();
        handleRealignGraph();
        return;
      }

      if (event.key === "0") {
        event.preventDefault();
        resetView();
      }
    };

    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code === "Space") {
        setSpacePanActive(false);
      }
    };

    const onWindowBlur = () => {
      setSpacePanActive(false);
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onWindowBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onWindowBlur);
    };
  }, [armTile, commitSelection, deleteSelection, handleRealignGraph, handleRedo, handleSavePlaylist, handleUndo, hotkeyMap, resetView, selectedPlaylist, tileById]);

  // Auto-switch inspector tab based on selection
  useEffect(() => {
    if (selection.selectedEdgeId) {
      setInspectorTab("edge");
      return;
    }
    if (selection.primaryNodeId) {
      setInspectorTab("node");
    }
  }, [selection.primaryNodeId, selection.selectedEdgeId]);



  const categoryTabs = useMemo<Array<{ id: TileCatalogCategory["id"] | "all"; label: string }>>(() => (
    [{ id: "all", label: "All" }, ...tileCatalog.categories]
  ), [tileCatalog.categories]);

  const handleToggleGrid = useCallback(() => {
    playSelectSound();
    setShowGrid((previous) => !previous);
  }, []);

  const handleSetConnectFromNode = useCallback((nodeId: string) => {
    setConnectFromNodeId(nodeId);
  }, []);

  const handleSetConnectTool = useCallback((_tool: "connect") => {
    setTool("connect");
  }, []);

  const navigateBack = useCallback(() => {
    playSelectSound();
    navigate({ to: "/" });
  }, [navigate]);

  /* ──────────────────────── Playlist picker view ──────────── */

  if (!selectedPlaylist) {
    return (
      <PlaylistPickerView
        playlistList={playlistList}
        activePlaylistId={activePlaylistId}
        newPlaylistName={newPlaylistName}
        createPlaylistPending={createPlaylistPending}
        saveNotice={saveNotice}
        importPending={importPending}
        onNewPlaylistNameChange={setNewPlaylistName}
        onCreatePlaylist={() => { void handleCreatePlaylist(); }}
        onImportPlaylist={() => { void handleImportPlaylist(); }}
        onOpenPlaylist={openPlaylistForEditing}
        onNavigateBack={navigateBack}
      />
    );
  }

  /* ──────────────────────── Main editor view ──────────── */

  return (
    <div className="relative h-screen overflow-hidden">
      <AnimatedBackground videoUris={[]} />
      <main className="relative z-10 flex h-full w-full flex-col">
        {/* ── Header bar ─────────────────── */}
        <header className="flex flex-shrink-0 items-center justify-between gap-3 border-b border-white/6 bg-black/40 px-4 py-2.5 backdrop-blur-md">
          <div className="flex items-center gap-4">
            <div>
              <h1 className="text-lg font-bold tracking-tight text-white">Map Editor</h1>
              <p className="text-xs text-zinc-500">
                <span className="text-cyan-400">{selectedPlaylist.name}</span>
                {isDirty && <span className="ml-1.5 text-amber-400">• unsaved</span>}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="rounded-lg border border-violet-500/45 bg-violet-500/12 px-3 py-1.5 text-xs font-medium text-violet-100 transition-colors hover:border-violet-400/60 hover:bg-violet-500/20 disabled:opacity-40"
              onMouseEnter={playHoverSound}
              onClick={() => { void handleImportPlaylist(); }}
              disabled={importPending || savePending || testMapPending}
            >
              {importPending ? "Importing..." : "Import"}
            </button>
            <button
              type="button"
              className="rounded-lg border border-emerald-500/45 bg-emerald-500/12 px-3 py-1.5 text-xs font-medium text-emerald-100 transition-colors hover:border-emerald-400/60 hover:bg-emerald-500/20 disabled:opacity-40"
              onMouseEnter={playHoverSound}
              onClick={() => { void handleExportPlaylist(); }}
              disabled={importPending || savePending || testMapPending}
            >
              {savePending ? "Working..." : "Export"}
            </button>
            {selectedResolutionActionLabel && selectedResolutionReview && (
              <button
                type="button"
                className="rounded-lg border border-cyan-500/45 bg-cyan-500/12 px-3 py-1.5 text-xs font-medium text-cyan-100 transition-colors hover:border-cyan-400/60 hover:bg-cyan-500/20"
                onMouseEnter={playHoverSound}
                onClick={() => {
                  setResolutionModalState({
                    context: "playlist",
                    title: `Resolve ${selectedPlaylist.name}`,
                    analysis: selectedResolutionReview,
                  });
                }}
              >
                {selectedResolutionActionLabel}
              </button>
            )}
            <button
              type="button"
              className="rounded-lg border border-zinc-700/50 bg-zinc-900/60 px-3 py-1.5 text-xs font-medium text-zinc-400 transition-colors hover:border-zinc-500/50 hover:text-zinc-200"
              onMouseEnter={playHoverSound}
              onClick={handleOpenPlaylistPicker}
            >
              Switch
            </button>
            <button
              type="button"
              className="rounded-lg border border-zinc-700/50 bg-zinc-900/60 px-3 py-1.5 text-xs font-medium text-zinc-400 transition-colors hover:border-zinc-500/50 hover:text-zinc-200"
              onMouseEnter={playHoverSound}
              onClick={navigateBack}
            >
              Exit
            </button>
          </div>
        </header>

        {/* ── Save notice ─────────────────── */}
        {saveNotice && (
          <div className={`flex-shrink-0 border-b px-4 py-1.5 text-xs ${saveNotice.startsWith("Cannot continue")
            ? "border-rose-500/30 bg-rose-950/30 text-rose-200"
            : "border-emerald-500/30 bg-emerald-950/30 text-emerald-200"
            }`}>
            {saveNotice}
          </div>
        )}
        {selectedResolutionActionLabel && selectedResolutionReview && (
          <div className="flex-shrink-0 border-b border-cyan-500/20 bg-cyan-950/20 px-4 py-1.5 text-xs text-cyan-200">
            {selectedResolutionReview.counts.missing > 0
              ? `${selectedResolutionReview.counts.missing} playlist refs still need a manual match.`
              : `${selectedResolutionReview.counts.suggested} refs were auto-resolved and can be reviewed.`}
          </div>
        )}

        {/* ── 3-column editor layout ─────────────────── */}
        <div className="flex min-h-0 flex-1 overflow-hidden">
          {/* ── Left: Tile sidebar ─────────────────── */}
          <TileSidebar
            categoryTabs={categoryTabs}
            activeCategory={activeCategory}
            tileSearch={tileSearch}
            filteredTiles={filteredTiles}
            activePlacementKind={activePlacementKind}
            onCategoryChange={setActiveCategory}
            onSearchChange={setTileSearch}
            onArmTile={armTile}
          />

          {/* ── Center: Toolbar + Canvas + Status bar ─────────────────── */}
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <div className="flex-shrink-0 border-b border-white/6 px-2 py-1.5">
              <EditorToolbar
                tool={tool}
                alignmentStrategy={alignmentStrategy}
                canRealign={config.nodes.length >= 2}
                showGrid={showGrid}
                isDirty={isDirty}
                savePending={savePending || importPending}
                testMapPending={testMapPending}
                canUndo={historyState.canUndo}
                canRedo={historyState.canRedo}
                onSetTool={setTool}
                onAlignmentStrategyChange={setAlignmentStrategy}
                onRealignGraph={handleRealignGraph}
                onToggleGrid={handleToggleGrid}
                onResetView={resetView}
                onDelete={deleteSelection}
                onUndo={handleUndo}
                onRedo={handleRedo}
                onResetGraph={resetGraph}
                onSave={() => { void handleSavePlaylist(); }}
                onTestMap={() => { void handleTestMap(); }}
              />
            </div>

            <div className="min-h-0 flex-1 bg-black/20">
              <EditorCanvas
                config={config}
                selection={selection}
                connectFromNodeId={connectFromNodeId}
                tool={tool}
                activePlacementKind={activePlacementKind}
                viewport={viewport}
                showGrid={showGrid}
                spacePanActive={spacePanActive}
                recentlyPlacedNodeIds={recentlyPlacedNodeIds}
                recentlyTouchedEdgeIds={recentlyTouchedEdgeIds}
                onViewportChange={setViewport}
                onSelectionChange={commitSelection}
                onSetConnectFrom={setConnectFromNodeId}
                onMoveNodes={moveNodes}
                onCreateEdge={createEdge}
                onDeleteEdgeBetween={deleteEdgeBetween}
                onDeleteSelection={deleteSelection}
                onPlaceNodeAtWorld={placeNodeAtWorld}
                onBeginNodeDrag={() => {
                  dragSessionRef.current.active = true;
                  dragSessionRef.current.moved = false;
                }}
                onEndNodeDrag={() => {
                  if (dragSessionRef.current.active && dragSessionRef.current.moved) {
                    undoManagerRef.current.push(configRef.current);
                    syncHistoryState();
                  }
                  dragSessionRef.current.active = false;
                  dragSessionRef.current.moved = false;
                }}
              />
            </div>

            <div className="flex-shrink-0 border-t border-white/6">
              <EditorStatusBar
                tool={tool}
                nodeCount={config.nodes.length}
                selectedCount={selection.selectedNodeIds.length}
                activeTileLabel={activeTile?.label ?? null}
                selectedEdgeLabel={selectedEdgeLabel}
              />
            </div>
          </div>

          {/* ── Right: Collapsible inspector ─────────────────── */}
          <div className={`editor-inspector flex flex-shrink-0 flex-col border-l border-white/6 bg-black/30 transition-all duration-200 ${inspectorCollapsed ? "w-10" : "w-72"}`}>
            {/* ── Collapse toggle ─────────────────── */}
            <button
              type="button"
              className="flex flex-shrink-0 items-center justify-center border-b border-white/6 py-2 text-zinc-600 transition-colors hover:text-zinc-300"
              onClick={() => setInspectorCollapsed((previous) => !previous)}
              title={inspectorCollapsed ? "Expand inspector" : "Collapse inspector"}
            >
              <span className="text-xs">{inspectorCollapsed ? "◀" : "▶"}</span>
            </button>

            {!inspectorCollapsed && (
              <>
                {/* ── Tab bar ─────────────────── */}
                <div className="flex flex-shrink-0 border-b border-white/6">
                  {INSPECTOR_TABS.map((tab) => {
                    const isActive = inspectorTab === tab.id;
                    const hasIssue = tab.id === "validation" && (validation.errors.length > 0 || validation.warnings.length > 0);
                    return (
                      <button
                        key={tab.id}
                        type="button"
                        className={`editor-tab relative flex-1 px-2 py-2 text-[11px] font-medium transition-colors ${isActive
                          ? "text-cyan-300"
                          : "text-zinc-600 hover:text-zinc-400"
                          }`}
                        onClick={() => setInspectorTab(tab.id)}
                      >
                        {tab.label}
                        {hasIssue && (
                          <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-rose-500" />
                        )}
                        {isActive && (
                          <span className="absolute bottom-0 inset-x-1 h-px bg-cyan-400/60" />
                        )}
                      </button>
                    );
                  })}
                </div>

                {/* ── Tab content ─────────────────── */}
                <div className="min-h-0 flex-1 overflow-y-auto">
                  {inspectorTab === "node" && (
                    <NodeInspectorPanel
                      selectedNode={selectedNode}
                      outgoingEdges={outgoingEdgesForSelectedNode}
                      installedRounds={installedRounds}
                      perkOptions={perkOptions}
                      onPatchNode={patchNode}
                      onCommitSelection={commitSelection}
                      onSetTool={handleSetConnectTool}
                      onSetConnectFrom={handleSetConnectFromNode}
                    />
                  )}
                  {inspectorTab === "edge" && (
                    <EdgeInspectorPanel
                      selectedEdge={selectedEdge}
                      allEdges={config.edges}
                      onPatchEdge={patchEdge}
                    />
                  )}
                  {inspectorTab === "settings" && (
                    <GraphSettingsPanel
                      perkSelection={config.perkSelection}
                      perkPool={config.perkPool}
                      probabilityScaling={config.probabilityScaling}
                      economy={config.economy}
                      perkOptions={perkOptions}
                      antiPerkOptions={antiPerkOptions}
                      cumRoundRefs={config.cumRoundRefs}
                      cumRounds={cumRounds}
                      installedRounds={installedRounds}
                      selectedCumRoundIdSet={selectedCumRoundIdSet}
                      onSetPerkTriggerChance={setPerkTriggerChance}
                      onSetProbabilityScaling={setProbabilityScaling}
                      onSetCumRoundBonusScore={setCumRoundBonusScore}
                      onTogglePerk={togglePerkEnabled}
                      onToggleAntiPerk={toggleAntiPerkEnabled}
                      onSetAllPerksEnabled={setAllPerksEnabled}
                      onSetAllAntiPerksEnabled={setAllAntiPerksEnabled}
                      onToggleCumRound={toggleCumRound}
                      onMoveCumRound={moveCumRound}
                      onRemoveCumRoundByIndex={removeCumRoundByIndex}
                    />
                  )}
                  {inspectorTab === "validation" && (
                    <ValidationPanel validation={validation} />
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </main>

      {resolutionModalState && (
        <PlaylistResolutionModal
          open
          title={resolutionModalState.title}
          installedRounds={installedRounds}
          analysis={resolutionModalState.analysis}
          primaryActionLabel={resolutionModalState.context === "import" ? "Import with Selected Resolutions" : "Apply Resolutions"}
          secondaryActionLabel={resolutionModalState.context === "import" ? "Continue Unresolved" : undefined}
          onClose={() => setResolutionModalState(null)}
          onPrimaryAction={(overrides) => {
            void (async () => {
              if (resolutionModalState.context === "import") {
                const imported = await playlists.importFromFile({
                  filePath: resolutionModalState.filePath,
                  manualMappingByRefKey: overrides,
                });
                updatePlaylistListEntry(imported.playlist);
                setActivePlaylistId(imported.playlist.id);
                openPlaylistForEditing(imported.playlist);
                setImportedPlaylistReview(
                  resolutionModalState.analysis.issues.length > 0
                    ? {
                      playlistId: imported.playlist.id,
                      analysis: resolutionModalState.analysis,
                    }
                    : null,
                );
                setSaveNotice(`Imported "${imported.playlist.name}".`);
                setResolutionModalState(null);
                return;
              }

              if (!selectedPlaylist) return;
              const combinedMapping = {
                ...resolutionModalState.analysis.suggestedMapping,
                ...overrides,
              };
              const nextConfig = applyPlaylistResolutionMapping({
                ...selectedPlaylist.config,
                boardConfig: toGraphBoardConfig(config),
              }, combinedMapping, installedRounds);
              const updated = await playlists.update({
                playlistId: selectedPlaylist.id,
                config: nextConfig,
              });
              updatePlaylistListEntry(updated);
              openPlaylistForEditing(updated);
              if (importedPlaylistReview?.playlistId === selectedPlaylist.id) {
                setImportedPlaylistReview(null);
              }
              setSaveNotice(`Applied playlist resolutions to "${updated.name}".`);
              setResolutionModalState(null);
            })();
          }}
          onSecondaryAction={(overrides) => {
            void (async () => {
              if (resolutionModalState.context !== "import") return;
              const imported = await playlists.importFromFile({
                filePath: resolutionModalState.filePath,
                manualMappingByRefKey: overrides,
              });
              updatePlaylistListEntry(imported.playlist);
              setActivePlaylistId(imported.playlist.id);
              openPlaylistForEditing(imported.playlist);
              setImportedPlaylistReview({
                playlistId: imported.playlist.id,
                analysis: resolutionModalState.analysis,
              });
              setSaveNotice(`Imported "${imported.playlist.name}" with unresolved refs preserved.`);
              setResolutionModalState(null);
            })();
          }}
        />
      )}
    </div>
  );
}
