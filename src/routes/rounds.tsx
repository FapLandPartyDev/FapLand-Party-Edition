import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AnimatedBackground } from "../components/AnimatedBackground";
import { RoundVideoOverlay } from "../components/game/RoundVideoOverlay";
import type { ActiveRound } from "../game/types";
import { CURRENT_PLAYLIST_VERSION, type PlaylistConfig, type PortableRoundRef } from "../game/playlistSchema";
import { MenuButton } from "../components/MenuButton";
import {
  db,
  type InstallFolderInspectionResult,
  type InstallFolderScanResult,
  type InstallScanStatus,
  type InstalledRound,
  type LegacyReviewedImportResult,
} from "../services/db";
import { playlists } from "../services/playlists";
import { trpc } from "../services/trpc";
import { importOpenedFile } from "../services/openedFiles";
import { buildRoundRenderRows, type RoundRenderRow } from "./roundRows";
import { usePlayableVideoFallback } from "../hooks/usePlayableVideoFallback";
import { playHoverSound, playSelectSound } from "../utils/audio";

type TypeFilter = "all" | NonNullable<InstalledRound["type"]>;
type ScriptFilter = "all" | "installed" | "missing";
type SortMode = "newest" | "difficulty" | "bpm" | "name";
type EditableRoundType = "Normal" | "Interjection" | "Cum";
type RoundEditDraft = {
  id: string;
  name: string;
  author: string;
  description: string;
  bpm: string;
  difficulty: string;
  startTime: string;
  endTime: string;
  type: EditableRoundType;
};
type HeroEditDraft = {
  id: string;
  name: string;
  author: string;
  description: string;
};
type LegacyImportedSlot = NonNullable<LegacyReviewedImportResult["legacyImport"]>["orderedSlots"][number];
type LegacyInspectionSlot = Extract<InstallFolderInspectionResult, { kind: "legacy" }>["legacySlots"][number];
type LegacyImportReviewSlot = LegacyInspectionSlot & {
  selectedAsCheckpoint: boolean;
  excludedFromImport: boolean;
};
type LegacyPlaylistReviewState = {
  folderPath: string;
  slots: LegacyImportReviewSlot[];
  playlistName: string;
  createPlaylist: boolean;
  creating: boolean;
  error: string | null;
};
const ROUNDS_PAGE_SIZE = 60;
const INTERMEDIARY_LOADING_PROMPT_KEY = "game.intermediary.loadingPrompt";
const INTERMEDIARY_LOADING_DURATION_KEY = "game.intermediary.loadingDurationSec";
const INTERMEDIARY_RETURN_PAUSE_KEY = "game.intermediary.returnPauseSec";
const DEFAULT_INTERMEDIARY_LOADING_PROMPT = "animated gif webm";
const DEFAULT_INTERMEDIARY_LOADING_DURATION_SEC = 10;
const DEFAULT_INTERMEDIARY_RETURN_PAUSE_SEC = 4;
const ZELDA_INTERMEDIARY_VIDEO_URI_FRAGMENT = "Fugtrup%20Zelda%20x%20Bokoblin.mp4";
const roundNameCollator = new Intl.Collator();

type IndexedRound = {
  round: InstalledRound;
  searchText: string;
  roundType: NonNullable<InstalledRound["type"]>;
  hasScript: boolean;
  createdAtMs: number;
  difficultyValue: number;
  bpmValue: number;
};

function toLegacyPlaylistConfig(orderedSlots: LegacyImportedSlot[]): PlaylistConfig {
  const safePointIndices: number[] = [];
  const normalRoundRefsByIndex: Record<string, PortableRoundRef> = {};
  orderedSlots.forEach((slot, index) => {
    const position = index + 1;
    if (slot.kind === "checkpoint") {
      safePointIndices.push(position);
      return;
    }
    normalRoundRefsByIndex[String(position)] = slot.ref;
  });

  return {
    playlistVersion: CURRENT_PLAYLIST_VERSION,
    boardConfig: {
      mode: "linear",
      totalIndices: Math.max(1, orderedSlots.length),
      safePointIndices,
      safePointRestMsByIndex: {},
      normalRoundRefsByIndex,
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
  };
}

function pickHeroGroupRoundToKeep(rounds: InstalledRound[]): InstalledRound | null {
  if (rounds.length === 0) return null;
  const [first, ...rest] = rounds;
  if (!first) return null;
  return rest.reduce((best, current) => {
    const bestCreated = new Date(best.createdAt).getTime();
    const currentCreated = new Date(current.createdAt).getTime();
    if (currentCreated !== bestCreated) {
      return currentCreated < bestCreated ? current : best;
    }

    return current.id < best.id ? current : best;
  }, first);
}

function toRoundEditDraft(round: InstalledRound): RoundEditDraft {
  return {
    id: round.id,
    name: round.name,
    author: round.author ?? "",
    description: round.description ?? "",
    bpm: round.bpm == null ? "" : `${round.bpm}`,
    difficulty: round.difficulty == null ? "" : `${round.difficulty}`,
    startTime: round.startTime == null ? "" : `${round.startTime}`,
    endTime: round.endTime == null ? "" : `${round.endTime}`,
    type: round.type ?? "Normal",
  };
}

function toHeroEditDraft(round: InstalledRound): HeroEditDraft | null {
  if (!round.heroId || !round.hero) return null;
  return {
    id: round.heroId,
    name: round.hero.name ?? "",
    author: round.hero.author ?? "",
    description: round.hero.description ?? "",
  };
}

function parseOptionalInteger(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) return Number.NaN;
  return Math.max(0, Math.round(parsed));
}

function parseOptionalFloat(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) return Number.NaN;
  return parsed;
}

function toIndexedRound(round: InstalledRound): IndexedRound {
  return {
    round,
    searchText: [
      round.name,
      round.author ?? "",
      round.hero?.name ?? "",
      round.description ?? "",
    ].join("\n").toLowerCase(),
    roundType: round.type ?? "Normal",
    hasScript: Boolean(round.resources[0]?.funscriptUri),
    createdAtMs: Date.parse(String(round.createdAt)) || 0,
    difficultyValue: round.difficulty ?? 0,
    bpmValue: round.bpm ?? 0,
  };
}

const getInstalledRounds = async (includeDisabled = false): Promise<InstalledRound[]> => {
  try {
    return await db.round.findInstalled(includeDisabled);
  } catch (error) {
    console.error("Error loading installed rounds", error);
    return [];
  }
};

const getDisabledRoundIds = async (): Promise<Set<string>> => {
  try {
    const ids = await db.round.getDisabledIds();
    return new Set(ids);
  } catch (error) {
    console.error("Error loading disabled round IDs", error);
    return new Set<string>();
  }
};

const getIntermediaryLoadingPrompt = async (): Promise<string> => {
  try {
    const stored = await trpc.store.get.query({ key: INTERMEDIARY_LOADING_PROMPT_KEY });
    if (typeof stored !== "string") return DEFAULT_INTERMEDIARY_LOADING_PROMPT;
    const trimmed = stored.trim();
    return trimmed.length > 0 ? trimmed : DEFAULT_INTERMEDIARY_LOADING_PROMPT;
  } catch (error) {
    console.warn("Failed to read intermediary loading prompt from store", error);
    return DEFAULT_INTERMEDIARY_LOADING_PROMPT;
  }
};

const getIntermediaryLoadingDurationSec = async (): Promise<number> => {
  try {
    const stored = await trpc.store.get.query({ key: INTERMEDIARY_LOADING_DURATION_KEY });
    const parsed = typeof stored === "number" ? stored : Number(stored);
    if (!Number.isFinite(parsed)) return DEFAULT_INTERMEDIARY_LOADING_DURATION_SEC;
    return Math.max(1, Math.min(60, Math.floor(parsed)));
  } catch (error) {
    console.warn("Failed to read intermediary loading duration from store", error);
    return DEFAULT_INTERMEDIARY_LOADING_DURATION_SEC;
  }
};

const getIntermediaryReturnPauseSec = async (): Promise<number> => {
  try {
    const stored = await trpc.store.get.query({ key: INTERMEDIARY_RETURN_PAUSE_KEY });
    const parsed = typeof stored === "number" ? stored : Number(stored);
    if (!Number.isFinite(parsed)) return DEFAULT_INTERMEDIARY_RETURN_PAUSE_SEC;
    return Math.max(0, Math.min(60, Math.floor(parsed)));
  } catch (error) {
    console.warn("Failed to read intermediary return pause from store", error);
    return DEFAULT_INTERMEDIARY_RETURN_PAUSE_SEC;
  }
};

export const Route = createFileRoute("/rounds")({
  loader: async () => {
    const [rounds, intermediaryLoadingPrompt, intermediaryLoadingDurationSec, intermediaryReturnPauseSec] =
      await Promise.all([
        getInstalledRounds(),
        getIntermediaryLoadingPrompt(),
        getIntermediaryLoadingDurationSec(),
        getIntermediaryReturnPauseSec(),
      ]);
    return {
      rounds,
      intermediaryLoadingPrompt,
      intermediaryLoadingDurationSec,
      intermediaryReturnPauseSec,
    };
  },
  component: InstalledRoundsPage,
});

export function InstalledRoundsPage() {
  const {
    rounds: initialRounds,
    intermediaryLoadingPrompt,
    intermediaryLoadingDurationSec,
    intermediaryReturnPauseSec,
  } = Route.useLoaderData();
  const [rounds, setRounds] = useState<InstalledRound[]>(initialRounds);
  const [showDisabledRounds, setShowDisabledRounds] = useState(false);
  const [disabledRoundIds, setDisabledRoundIds] = useState<Set<string>>(new Set());
  const [isStartingScan, setIsStartingScan] = useState(false);
  const [isExportingDatabase, setIsExportingDatabase] = useState(false);
  const [isOpeningExportFolder, setIsOpeningExportFolder] = useState(false);
  const [scanStatus, setScanStatus] = useState<InstallScanStatus | null>(null);
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [scriptFilter, setScriptFilter] = useState<ScriptFilter>("all");
  const [sortMode, setSortMode] = useState<SortMode>("newest");
  const [expandedHeroGroups, setExpandedHeroGroups] = useState<Record<string, boolean>>({});
  const [activePreviewRound, setActivePreviewRound] = useState<InstalledRound | null>(null);
  const [convertingHeroGroupKey, setConvertingHeroGroupKey] = useState<string | null>(null);
  const [editingRound, setEditingRound] = useState<RoundEditDraft | null>(null);
  const [editingHero, setEditingHero] = useState<HeroEditDraft | null>(null);
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [showInstallOverlay, setShowInstallOverlay] = useState(false);
  const [isAbortingInstall, setIsAbortingInstall] = useState(false);
  const [legacyPlaylistReview, setLegacyPlaylistReview] = useState<LegacyPlaylistReviewState | null>(null);
  const [visibleCount, setVisibleCount] = useState(ROUNDS_PAGE_SIZE);
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const deferredQuery = useDeferredValue(query);
  const goBack = useCallback(() => {
    if (window.history.length > 1) {
      window.history.back();
      return;
    }
    void navigate({ to: "/" });
  }, [navigate]);
  const handleHoverSfx = useCallback(() => {
    playHoverSound();
  }, []);
  const handleSelectSfx = useCallback(() => {
    playSelectSound();
  }, []);
  const activePreview: ActiveRound | null = useMemo(
    () =>
      activePreviewRound
        ? {
            fieldId: "preview-field",
            nodeId: "preview-node",
            roundId: activePreviewRound.id,
            roundName: activePreviewRound.name,
            selectionKind: "fixed",
            poolId: null,
            phaseKind: "normal",
            campaignIndex: 1,
          }
        : null,
    [activePreviewRound],
  );
  const previewInstalledRounds = useMemo(() => {
    if (!activePreviewRound) return [];
    const zeldaPool = rounds.filter((round) => {
      if (round.id === activePreviewRound.id || round.type !== "Interjection") return false;
      const videoUri = round.resources[0]?.videoUri ?? "";
      return videoUri.includes(ZELDA_INTERMEDIARY_VIDEO_URI_FRAGMENT);
    });
    return [activePreviewRound, ...zeldaPool];
  }, [activePreviewRound, rounds]);

  const refreshInstalledRounds = useCallback(async () => {
    const [refreshed, disabledIds] = await Promise.all([
      getInstalledRounds(showDisabledRounds),
      getDisabledRoundIds(),
    ]);
    setRounds(refreshed);
    setDisabledRoundIds(disabledIds);
  }, [showDisabledRounds]);

  useEffect(() => {
    let mounted = true;
    let previousState: InstallScanStatus["state"] | null = null;

    const pollScanStatus = async () => {
      try {
        const status = await db.install.getScanStatus();
        if (!mounted) return;

        setScanStatus(status);

        if (previousState === "running" && status.state !== "running") {
          if (mounted) {
            await refreshInstalledRounds();
          }
        }

        previousState = status.state;
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
  }, [refreshInstalledRounds, showDisabledRounds]);

  useEffect(() => {
    let mounted = true;
    void (async () => {
      const [next, disabledIds] = await Promise.all([getInstalledRounds(showDisabledRounds), getDisabledRoundIds()]);
      if (!mounted) return;
      setRounds(next);
      setDisabledRoundIds(disabledIds);
    })();
    return () => {
      mounted = false;
    };
  }, [showDisabledRounds]);

  const indexedRounds = useMemo(
    () => rounds.map(toIndexedRound),
    [rounds],
  );
  const sortedRoundEntries = useMemo(() => {
    const newest = [...indexedRounds].sort((a, b) => b.createdAtMs - a.createdAtMs);
    const difficulty = [...indexedRounds].sort((a, b) => b.difficultyValue - a.difficultyValue);
    const bpm = [...indexedRounds].sort((a, b) => b.bpmValue - a.bpmValue);
    const name = [...indexedRounds].sort((a, b) => roundNameCollator.compare(a.round.name, b.round.name));

    return { newest, difficulty, bpm, name };
  }, [indexedRounds]);
  const filteredRounds = useMemo(() => {
    const normalized = deferredQuery.trim().toLowerCase();
    const sortedSource = sortedRoundEntries[sortMode];

    if (normalized.length === 0 && typeFilter === "all" && scriptFilter === "all") {
      return sortedSource.map((entry) => entry.round);
    }

    const result: InstalledRound[] = [];
    for (const entry of sortedSource) {
      if (typeFilter !== "all" && entry.roundType !== typeFilter) {
        continue;
      }
      if (scriptFilter !== "all" && entry.hasScript !== (scriptFilter === "installed")) {
        continue;
      }
      if (normalized.length > 0 && !entry.searchText.includes(normalized)) {
        continue;
      }
      result.push(entry.round);
    }

    return result;
  }, [deferredQuery, scriptFilter, sortMode, sortedRoundEntries, typeFilter]);

  const visibleRounds = useMemo(
    () => filteredRounds.slice(0, visibleCount),
    [filteredRounds, visibleCount],
  );
  const highestVisibleDifficulty = useMemo(
    () => visibleRounds.reduce((max, round) => Math.max(max, round.difficulty ?? 0), 0),
    [visibleRounds],
  );
  const renderRows = useMemo(
    () => buildRoundRenderRows(visibleRounds),
    [visibleRounds],
  );
  const visibleHeroGroupKeys = useMemo(
    () =>
      renderRows
        .filter((row): row is Extract<RoundRenderRow, { kind: "hero-group" }> => row.kind === "hero-group")
        .map((row) => row.groupKey),
    [renderRows],
  );
  const handleConvertRoundToHero = useCallback((round: InstalledRound) => {
    handleSelectSfx();
    void navigate({
      to: "/converter",
      search: {
        sourceRoundId: round.id,
        heroName: round.name,
      },
    });
  }, [handleSelectSfx, navigate]);
  const handlePlayRound = useCallback((round: InstalledRound) => {
    handleSelectSfx();
    setActivePreviewRound(round);
  }, [handleSelectSfx]);
  const handleEditRound = useCallback((round: InstalledRound) => {
    handleSelectSfx();
    setEditingRound(toRoundEditDraft(round));
  }, [handleSelectSfx]);

  useEffect(() => {
    setVisibleCount(ROUNDS_PAGE_SIZE);
  }, [filteredRounds]);

  useEffect(() => {
    const visibleSet = new Set(visibleHeroGroupKeys);
    setExpandedHeroGroups((previous) => {
      const nextEntries = Object.entries(previous).filter(([key]) => visibleSet.has(key));
      if (nextEntries.length === Object.keys(previous).length) {
        return previous;
      }
      return Object.fromEntries(nextEntries);
    });
  }, [visibleHeroGroupKeys]);

  useEffect(() => {
    const target = loadMoreRef.current;
    const hasMore = filteredRounds.length > visibleCount;
    if (!target || !hasMore) return;

    if (typeof IntersectionObserver === "undefined") {
      setVisibleCount((current) => Math.min(filteredRounds.length, current + ROUNDS_PAGE_SIZE));
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        setVisibleCount((current) => Math.min(filteredRounds.length, current + ROUNDS_PAGE_SIZE));
      },
      { root: null, rootMargin: "400px 0px", threshold: 0.01 },
    );

    observer.observe(target);
    return () => observer.disconnect();
  }, [filteredRounds.length, visibleCount]);

  const scanNow = async () => {
    if (isStartingScan || scanStatus?.state === "running") return;
    setIsStartingScan(true);
    try {
      const status = await db.install.scanNow();
      setScanStatus(status);
      await refreshInstalledRounds();
    } catch (error) {
      console.error("Failed to scan install folders", error);
    } finally {
      setIsStartingScan(false);
    }
  };

  const createLegacyPlaylistFromImport = useCallback(async (result: InstallFolderScanResult, playlistName: string) => {
    if (!result.legacyImport || result.legacyImport.orderedSlots.length === 0) return;
    const created = await playlists.create({
      name: playlistName,
      config: toLegacyPlaylistConfig(result.legacyImport.orderedSlots),
    });
    await playlists.setActive(created.id);
  }, []);

  const installRoundsFromFolder = async () => {
    if (isStartingScan || scanStatus?.state === "running") return;

    try {
      const selectedFolders = await window.electronAPI.dialog.selectFolders();
      const folderPath = selectedFolders[0];
      if (!folderPath) return;

      setIsStartingScan(true);
      setIsAbortingInstall(false);
      setLegacyPlaylistReview(null);
      const inspection = await db.install.inspectFolder(folderPath);
      if (inspection.kind === "empty") {
        window.alert("No supported video files found in selected folder.");
        return;
      }

      if (inspection.kind === "legacy") {
        setLegacyPlaylistReview({
          folderPath: inspection.folderPath,
          playlistName: inspection.playlistNameHint.trim() || "Legacy Playlist",
          createPlaylist: true,
          creating: false,
          error: null,
          slots: inspection.legacySlots.map((slot) => ({
            ...slot,
            selectedAsCheckpoint: slot.defaultCheckpoint,
            excludedFromImport: false,
          })),
        });
        return;
      }

      setShowInstallOverlay(true);
      const result = await db.install.scanFolderOnce(inspection.folderPath, true);
      setScanStatus(result.status);
      await refreshInstalledRounds();
    } catch (error) {
      console.error("Failed to install rounds from selected folder", error);
    } finally {
      setShowInstallOverlay(false);
      setIsAbortingInstall(false);
      setIsStartingScan(false);
    }
  };

  const importRoundsFromFile = async () => {
    if (isStartingScan || isExportingDatabase || scanStatus?.state === "running") return;

    try {
      const filePath = await window.electronAPI.dialog.selectInstallImportFile();
      if (!filePath) return;

      setIsStartingScan(true);
      setIsAbortingInstall(false);
      setLegacyPlaylistReview(null);
      setShowInstallOverlay(true);

      const result = await importOpenedFile(filePath);
      if (result.kind === "sidecar") {
        setScanStatus(result.result.status);
        await refreshInstalledRounds();
        return;
      }

      if (result.kind === "playlist") {
        await navigate({ to: "/playlist-workshop" });
      }
    } catch (error) {
      console.error("Failed to import selected file", error);
    } finally {
      setShowInstallOverlay(false);
      setIsAbortingInstall(false);
      setIsStartingScan(false);
    }
  };

  const abortInstallImport = async () => {
    if (!showInstallOverlay || isAbortingInstall) return;

    setIsAbortingInstall(true);
    try {
      const status = await db.install.abortScan();
      setScanStatus(status);
    } catch (error) {
      console.error("Failed to abort round import", error);
      setIsAbortingInstall(false);
    }
  };

  const dismissLegacyPlaylistReview = () => {
    if (legacyPlaylistReview?.creating) return;
    setLegacyPlaylistReview(null);
  };

  const toggleLegacyCheckpointSelection = (slotId: string) => {
    setLegacyPlaylistReview((current) =>
      current
        ? {
            ...current,
            error: null,
            slots: current.slots.map((slot) =>
              slot.id === slotId ? { ...slot, selectedAsCheckpoint: !slot.selectedAsCheckpoint } : slot),
          }
        : null,
    );
  };

  const toggleLegacyImportExclusion = (slotId: string) => {
    setLegacyPlaylistReview((current) =>
      current
        ? {
            ...current,
            error: null,
            slots: current.slots.map((slot) =>
              slot.id === slotId ? { ...slot, excludedFromImport: !slot.excludedFromImport } : slot),
          }
        : null,
    );
  };

  const createLegacyPlaylist = async () => {
    if (!legacyPlaylistReview || legacyPlaylistReview.creating) return;

    const playlistName = legacyPlaylistReview.playlistName.trim() || "Legacy Playlist";
    const shouldCreatePlaylist = legacyPlaylistReview.createPlaylist;
    setLegacyPlaylistReview((current) =>
      current
        ? {
            ...current,
            playlistName,
            creating: true,
            error: null,
          }
        : null,
    );

    try {
      setShowInstallOverlay(true);
      setIsAbortingInstall(false);
      const result = await db.install.importLegacyWithPlan(
        legacyPlaylistReview.folderPath,
        legacyPlaylistReview.slots.map((slot) => ({
          id: slot.id,
          sourcePath: slot.sourcePath,
          originalOrder: slot.originalOrder,
          selectedAsCheckpoint: slot.selectedAsCheckpoint,
          excludedFromImport: slot.excludedFromImport,
        })),
      );
      setScanStatus(result.status);
      await refreshInstalledRounds();
      if (result.status.state !== "done" || !result.legacyImport) {
        setLegacyPlaylistReview((current) =>
          current
            ? {
                ...current,
                creating: false,
                error: result.status.lastMessage ?? "Legacy import did not finish.",
              }
            : null,
        );
        return;
      }
      if (shouldCreatePlaylist) {
        await createLegacyPlaylistFromImport({
          status: result.status,
          legacyImport: result.legacyImport,
        }, playlistName);
      }
      setLegacyPlaylistReview(null);
    } catch (error) {
      setLegacyPlaylistReview((current) =>
        current
          ? {
              ...current,
              creating: false,
              error: error instanceof Error ? error.message : "Failed to create legacy playlist.",
            }
          : null,
      );
    } finally {
      setShowInstallOverlay(false);
      setIsAbortingInstall(false);
    }
  };

  const exportInstalledDatabase = async () => {
    if (isExportingDatabase || isStartingScan || scanStatus?.state === "running") return;

    const includeResourceUris = window.confirm(
      "Include resource URIs in this export?\n\n" +
        "Select Cancel for the safe default (no resource URIs).",
    );

    if (includeResourceUris) {
      const acknowledged = window.confirm(
        "Warning: only include resource URIs when files are remotely hosted and you know what you are doing.\n\n" +
          "Continue with URI export?",
      );
      if (!acknowledged) return;
    }

    setIsExportingDatabase(true);
    try {
      const result = await db.install.exportDatabase(includeResourceUris);
      window.alert(
        `Database export finished.\n\n` +
          `Folder: ${result.exportDir}\n` +
          `Heroes: ${result.heroFiles}\n` +
          `Standalone rounds: ${result.roundFiles}\n` +
          `Total rounds: ${result.exportedRounds}\n` +
          `Resource URIs included: ${result.includeResourceUris ? "yes" : "no"}`,
      );
    } catch (error) {
      console.error("Failed to export installed database", error);
      window.alert(error instanceof Error ? error.message : "Failed to export installed database.");
    } finally {
      setIsExportingDatabase(false);
    }
  };

  const openInstallExportFolder = async () => {
    if (isOpeningExportFolder || isStartingScan || isExportingDatabase || scanStatus?.state === "running") return;

    setIsOpeningExportFolder(true);
    try {
      await db.install.openExportFolder();
    } catch (error) {
      console.error("Failed to open install export folder", error);
      window.alert(error instanceof Error ? error.message : "Failed to open install export folder.");
    } finally {
      setIsOpeningExportFolder(false);
    }
  };

  const convertHeroGroupToRound = async (group: Extract<RoundRenderRow, { kind: "hero-group" }>) => {
    const roundToKeep = pickHeroGroupRoundToKeep(group.rounds);
    if (!roundToKeep) return;

    const roundsToDeleteCount = Math.max(0, group.rounds.length - 1);
    const firstWarning = window.confirm(
      `Convert "${group.heroName}" back to a standalone round?\n\n` +
        `This will keep "${roundToKeep.name}" and permanently delete ${roundsToDeleteCount} attached round(s).`,
    );
    if (!firstWarning) return;

    const typedConfirmation = window.prompt(
      `Type "${group.heroName}" to confirm this destructive action.`,
      "",
    );
    if (typedConfirmation === null) return;
    if (typedConfirmation.trim() !== group.heroName) {
      window.alert("Confirmation text did not match. No changes were made.");
      return;
    }

    const finalWarning = window.confirm(
      "Final confirmation: this cannot be undone in-app. Continue?",
    );
    if (!finalWarning) return;

    setConvertingHeroGroupKey(group.groupKey);
    try {
      await db.round.convertHeroGroupToRound({
        keepRoundId: roundToKeep.id,
        roundIds: group.rounds.map((round) => round.id),
        heroId: group.rounds[0]?.heroId ?? null,
        roundName: group.heroName,
      });
      await refreshInstalledRounds();
    } catch (error) {
      console.error("Failed to convert hero group back to a round", error);
      window.alert(error instanceof Error ? error.message : "Failed to convert hero group back to a round.");
    } finally {
      setConvertingHeroGroupKey(null);
    }
  };

  const saveRoundEdit = async () => {
    if (!editingRound || isSavingEdit) return;

    const bpm = parseOptionalFloat(editingRound.bpm);
    const difficulty = parseOptionalInteger(editingRound.difficulty);
    const startTime = parseOptionalInteger(editingRound.startTime);
    const endTime = parseOptionalInteger(editingRound.endTime);
    if ([bpm, difficulty, startTime, endTime].some((value) => Number.isNaN(value))) {
      window.alert("Round fields must use valid numeric values.");
      return;
    }

    setIsSavingEdit(true);
    try {
      await db.round.update({
        id: editingRound.id,
        name: editingRound.name,
        author: editingRound.author,
        description: editingRound.description,
        bpm,
        difficulty,
        startTime,
        endTime,
        type: editingRound.type,
      });
      setEditingRound(null);
      await refreshInstalledRounds();
    } catch (error) {
      console.error("Failed to update round", error);
      window.alert(error instanceof Error ? error.message : "Failed to update round.");
    } finally {
      setIsSavingEdit(false);
    }
  };

  const saveHeroEdit = async () => {
    if (!editingHero || isSavingEdit) return;

    setIsSavingEdit(true);
    try {
      await db.hero.update({
        id: editingHero.id,
        name: editingHero.name,
        author: editingHero.author,
        description: editingHero.description,
      });
      setEditingHero(null);
      await refreshInstalledRounds();
    } catch (error) {
      console.error("Failed to update hero", error);
      window.alert(error instanceof Error ? error.message : "Failed to update hero.");
    } finally {
      setIsSavingEdit(false);
    }
  };

  const deleteRoundEntry = async () => {
    if (!editingRound || isSavingEdit) return;

    const confirmed = window.confirm(
      `Delete round entry "${editingRound.name}" from the database?\n\n` +
        "This removes only the database entry. Files on disk will be left untouched.",
    );
    if (!confirmed) return;

    setIsSavingEdit(true);
    try {
      await db.round.delete(editingRound.id);
      setEditingRound(null);
      await refreshInstalledRounds();
    } catch (error) {
      console.error("Failed to delete round", error);
      window.alert(error instanceof Error ? error.message : "Failed to delete round.");
    } finally {
      setIsSavingEdit(false);
    }
  };

  const deleteHeroEntry = async () => {
    if (!editingHero || isSavingEdit) return;

    const confirmed = window.confirm(
      `Delete hero entry "${editingHero.name}" from the database?\n\n` +
        "This removes only the hero database entry. Files on disk will be left untouched, and attached rounds will remain installed.",
    );
    if (!confirmed) return;

    setIsSavingEdit(true);
    try {
      await db.hero.delete(editingHero.id);
      setEditingHero(null);
      await refreshInstalledRounds();
    } catch (error) {
      console.error("Failed to delete hero", error);
      window.alert(error instanceof Error ? error.message : "Failed to delete hero.");
    } finally {
      setIsSavingEdit(false);
    }
  };

  return (
    <div className="relative min-h-screen overflow-hidden">
      <AnimatedBackground />

      <div className="relative z-10 h-screen overflow-y-auto px-4 py-8 sm:px-8">
        <main className="parallax-ui-none mx-auto flex w-full max-w-6xl flex-col gap-6">
          <header className="animate-entrance rounded-3xl border border-purple-400/35 bg-zinc-950/60 p-6 backdrop-blur-xl shadow-[0_0_50px_rgba(139,92,246,0.28)]">
            <button
              type="button"
              onMouseEnter={handleHoverSfx}
              onClick={() => {
                handleSelectSfx();
                goBack();
              }}
              className="rounded-xl border border-violet-300/55 bg-violet-500/20 px-4 py-2 font-[family-name:var(--font-jetbrains-mono)] text-xs uppercase tracking-[0.2em] text-violet-100 transition-all duration-200 hover:border-violet-200/80 hover:bg-violet-500/35"
            >
              Go Back
            </button>
            <p className="font-[family-name:var(--font-jetbrains-mono)] text-xs uppercase tracking-[0.45em] text-purple-200/85">
              Round Vault
            </p>
            <div className="mt-3 flex flex-wrap items-end justify-between gap-4">
              <h1 className="text-3xl font-black tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-violet-200 via-purple-100 to-indigo-200 drop-shadow-[0_0_30px_rgba(139,92,246,0.55)] sm:text-5xl">
                Installed Rounds
              </h1>
              <div className="flex flex-col items-end gap-2">
                <div className="flex items-center gap-2">
                  <div className="rounded-xl border border-violet-200/30 bg-violet-400/10 px-4 py-2 font-[family-name:var(--font-jetbrains-mono)] text-xs uppercase tracking-[0.3em] text-violet-100">
                    {filteredRounds.length} / {rounds.length} Visible
                  </div>
                  <button
                    type="button"
                    disabled={isStartingScan || isExportingDatabase || isOpeningExportFolder || scanStatus?.state === "running"}
                    onMouseEnter={handleHoverSfx}
                    onClick={() => {
                      handleSelectSfx();
                      void installRoundsFromFolder();
                    }}
                    className={`rounded-xl border px-4 py-2 font-[family-name:var(--font-jetbrains-mono)] text-xs uppercase tracking-[0.2em] transition-all duration-200 ${
                      isStartingScan || isExportingDatabase || isOpeningExportFolder || scanStatus?.state === "running"
                        ? "cursor-not-allowed border-zinc-600 bg-zinc-800 text-zinc-500"
                        : "border-violet-300/60 bg-violet-500/25 text-violet-100 hover:border-violet-200/80 hover:bg-violet-500/40"
                    }`}
                  >
                    Install Rounds
                  </button>
                  <button
                    type="button"
                    disabled={isStartingScan || isExportingDatabase || isOpeningExportFolder || scanStatus?.state === "running"}
                    onMouseEnter={handleHoverSfx}
                    onClick={() => {
                      handleSelectSfx();
                      void importRoundsFromFile();
                    }}
                    className={`rounded-xl border px-4 py-2 font-[family-name:var(--font-jetbrains-mono)] text-xs uppercase tracking-[0.2em] transition-all duration-200 ${
                      isStartingScan || isExportingDatabase || isOpeningExportFolder || scanStatus?.state === "running"
                        ? "cursor-not-allowed border-zinc-600 bg-zinc-800 text-zinc-500"
                        : "border-emerald-300/60 bg-emerald-500/20 text-emerald-100 hover:border-emerald-200/80 hover:bg-emerald-500/35"
                    }`}
                  >
                    Import File
                  </button>
                  <button
                    type="button"
                    disabled={isStartingScan || isExportingDatabase || isOpeningExportFolder || scanStatus?.state === "running"}
                    onMouseEnter={handleHoverSfx}
                    onClick={() => {
                      handleSelectSfx();
                      void exportInstalledDatabase();
                    }}
                    className={`rounded-xl border px-4 py-2 font-[family-name:var(--font-jetbrains-mono)] text-xs uppercase tracking-[0.2em] transition-all duration-200 ${
                      isStartingScan || isExportingDatabase || isOpeningExportFolder || scanStatus?.state === "running"
                        ? "cursor-not-allowed border-zinc-600 bg-zinc-800 text-zinc-500"
                        : "border-cyan-300/60 bg-cyan-500/20 text-cyan-100 hover:border-cyan-200/80 hover:bg-cyan-500/35"
                    }`}
                  >
                    {isExportingDatabase ? "Exporting..." : "Export Database"}
                  </button>
                  <button
                    type="button"
                    disabled={isStartingScan || isExportingDatabase || isOpeningExportFolder || scanStatus?.state === "running"}
                    onMouseEnter={handleHoverSfx}
                    onClick={() => {
                      handleSelectSfx();
                      void openInstallExportFolder();
                    }}
                    className={`rounded-xl border px-4 py-2 font-[family-name:var(--font-jetbrains-mono)] text-xs uppercase tracking-[0.2em] transition-all duration-200 ${
                      isStartingScan || isExportingDatabase || isOpeningExportFolder || scanStatus?.state === "running"
                        ? "cursor-not-allowed border-zinc-600 bg-zinc-800 text-zinc-500"
                        : "border-sky-300/60 bg-sky-500/20 text-sky-100 hover:border-sky-200/80 hover:bg-sky-500/35"
                    }`}
                  >
                    {isOpeningExportFolder ? "Opening..." : "Open Export Folder"}
                  </button>
                </div>
                {scanStatus && (
                  <InstallScanStatusBadge status={scanStatus} />
                )}
              </div>
            </div>
          </header>

          <section className="relative z-40 animate-entrance rounded-3xl border border-purple-400/25 bg-zinc-950/55 p-4 backdrop-blur-xl sm:p-6" style={{ animationDelay: "0.08s" }}>
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-5">
              <label className="lg:col-span-2">
                <span className="mb-2 block font-[family-name:var(--font-jetbrains-mono)] text-[10px] uppercase tracking-[0.25em] text-zinc-300">Search</span>
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  onFocus={handleHoverSfx}
                  onMouseEnter={handleHoverSfx}
                  placeholder="Search title, hero, author"
                  className="w-full rounded-xl border border-purple-300/30 bg-black/45 px-4 py-3 text-sm text-zinc-100 outline-none transition-all duration-200 focus:border-purple-300/75 focus:ring-2 focus:ring-purple-400/30"
                />
              </label>

              <GameDropdown
                label="Type"
                value={typeFilter}
                options={[
                  { value: "all", label: "All" },
                  { value: "Normal", label: "Normal" },
                  { value: "Interjection", label: "Interjection" },
                  { value: "Cum", label: "Cum" },
                ]}
                onChange={setTypeFilter}
                onHoverSfx={handleHoverSfx}
                onSelectSfx={handleSelectSfx}
              />

              <GameDropdown
                label="Script"
                value={scriptFilter}
                options={[
                  { value: "all", label: "All" },
                  { value: "installed", label: "Installed" },
                  { value: "missing", label: "Missing" },
                ]}
                onChange={setScriptFilter}
                onHoverSfx={handleHoverSfx}
                onSelectSfx={handleSelectSfx}
              />

              <GameDropdown
                label="Sort"
                value={sortMode}
                options={[
                  { value: "newest", label: "Newest" },
                  { value: "difficulty", label: "Difficulty" },
                  { value: "bpm", label: "BPM" },
                  { value: "name", label: "Name" },
                ]}
                onChange={setSortMode}
                onHoverSfx={handleHoverSfx}
                onSelectSfx={handleSelectSfx}
              />
            </div>

            <div className="mt-3 flex items-center justify-end">
              <label className="flex items-center gap-2 rounded-lg border border-zinc-700 bg-black/30 px-3 py-2 text-xs uppercase tracking-[0.18em] text-zinc-300">
                <input
                  type="checkbox"
                  checked={showDisabledRounds}
                  onChange={(event) => setShowDisabledRounds(event.target.checked)}
                />
                Show Disabled Imports
              </label>
            </div>

          </section>

          <div className="relative z-10 grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3">
            {renderRows.map((row, rowIndex) => {
              if (row.kind === "standalone") {
                const round = row.round;
                return (
                <RoundCard
                  key={round.id}
                  round={round}
                  index={rowIndex}
                  onHoverSfx={handleHoverSfx}
                  onConvertToHero={handleConvertRoundToHero}
                  onPlay={handlePlayRound}
                  onEdit={handleEditRound}
                    animateDifficulty={(round.difficulty ?? 0) === highestVisibleDifficulty && highestVisibleDifficulty > 0}
                    showDisabledBadge={disabledRoundIds.has(round.id)}
                  />
                );
              }

              const isExpanded = Boolean(expandedHeroGroups[row.groupKey]);
              return (
                <div key={row.groupKey} className="sm:col-span-2 xl:col-span-3 space-y-4">
                  <HeroGroupHeader
                    heroName={row.heroName}
                    roundCount={row.rounds.length}
                    expanded={isExpanded}
                    onHoverSfx={handleHoverSfx}
                    converting={convertingHeroGroupKey === row.groupKey}
                    onToggle={() => {
                      handleSelectSfx();
                      setExpandedHeroGroups((previous) => ({
                        ...previous,
                        [row.groupKey]: !previous[row.groupKey],
                      }));
                    }}
                    onConvertToRound={() => {
                      handleSelectSfx();
                      void convertHeroGroupToRound(row);
                    }}
                    onEditHero={() => {
                      const draft = toHeroEditDraft(row.rounds[0]);
                      if (!draft) return;
                      handleSelectSfx();
                      setEditingHero(draft);
                    }}
                  />
                  {isExpanded && (
                    <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3">
                      {row.rounds.map((round, groupIndex) => (
                        <RoundCard
                          key={round.id}
                          round={round}
                          index={rowIndex + groupIndex + 1}
                          onHoverSfx={handleHoverSfx}
                          onConvertToHero={handleConvertRoundToHero}
                          onPlay={handlePlayRound}
                          onEdit={handleEditRound}
                          animateDifficulty={(round.difficulty ?? 0) === highestVisibleDifficulty && highestVisibleDifficulty > 0}
                          showDisabledBadge={disabledRoundIds.has(round.id)}
                        />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {visibleRounds.length < filteredRounds.length && (
            <div ref={loadMoreRef} className="py-2 text-center font-[family-name:var(--font-jetbrains-mono)] text-[10px] uppercase tracking-[0.2em] text-zinc-400">
              Loading more rounds...
            </div>
          )}

          {filteredRounds.length === 0 && (
            <div className="animate-entrance rounded-2xl border border-zinc-700/60 bg-zinc-950/60 p-8 text-center backdrop-blur-xl">
              <p className="font-[family-name:var(--font-jetbrains-mono)] text-sm uppercase tracking-[0.28em] text-zinc-400">
                No rounds match this filter
              </p>
            </div>
          )}

          <div className="mx-auto grid w-full max-w-md grid-cols-1 gap-2 pb-6">
            <MenuButton
              label={isStartingScan || scanStatus?.state === "running" ? "Scanning..." : "Scan Now"}
              primary
              onClick={() => {
                handleSelectSfx();
                void scanNow();
              }}
              onHover={handleHoverSfx}
            />
            <MenuButton
              label="Back to Main Menu"
              onClick={() => {
                handleSelectSfx();
                navigate({ to: "/" });
              }}
              onHover={handleHoverSfx}
            />
          </div>
        </main>
      </div>
      {showInstallOverlay && (
        <InstallImportOverlay
          status={scanStatus}
          aborting={isAbortingInstall}
          onAbort={abortInstallImport}
        />
      )}
      {activePreviewRound && (
        <RoundVideoOverlay
          activeRound={activePreview}
          installedRounds={previewInstalledRounds}
          currentPlayer={undefined}
          intermediaryProbability={1}
          allowAutomaticIntermediaries
          showCloseButton
          onClose={() => {
            setActivePreviewRound(null);
          }}
          booruSearchPrompt={intermediaryLoadingPrompt}
          intermediaryLoadingDurationSec={intermediaryLoadingDurationSec}
          intermediaryReturnPauseSec={intermediaryReturnPauseSec}
          onFinishRound={() => {
            setActivePreviewRound(null);
          }}
        />
      )}
      {editingRound && (
        <EditDialog
          title="Edit Round"
          onClose={() => !isSavingEdit && setEditingRound(null)}
          onSubmit={() => {
            void saveRoundEdit();
          }}
          submitLabel={isSavingEdit ? "Saving..." : "Save Round"}
          disabled={isSavingEdit}
          destructiveActionLabel={isSavingEdit ? "Deleting..." : "Delete Round"}
          onDestructiveAction={() => {
            void deleteRoundEntry();
          }}
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <ModalField label="Name">
              <input
                value={editingRound.name}
                onChange={(event) => setEditingRound((previous) => previous ? { ...previous, name: event.target.value } : previous)}
                className="w-full rounded-xl border border-violet-300/30 bg-black/45 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-violet-200/70"
              />
            </ModalField>
            <ModalField label="Type">
              <select
                value={editingRound.type}
                onChange={(event) => setEditingRound((previous) => previous ? { ...previous, type: event.target.value as EditableRoundType } : previous)}
                className="w-full rounded-xl border border-violet-300/30 bg-black/45 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-violet-200/70"
              >
                <option value="Normal">Normal</option>
                <option value="Interjection">Interjection</option>
                <option value="Cum">Cum</option>
              </select>
            </ModalField>
            <ModalField label="Author">
              <input
                value={editingRound.author}
                onChange={(event) => setEditingRound((previous) => previous ? { ...previous, author: event.target.value } : previous)}
                className="w-full rounded-xl border border-violet-300/30 bg-black/45 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-violet-200/70"
              />
            </ModalField>
            <ModalField label="BPM">
              <input
                value={editingRound.bpm}
                onChange={(event) => setEditingRound((previous) => previous ? { ...previous, bpm: event.target.value } : previous)}
                className="w-full rounded-xl border border-violet-300/30 bg-black/45 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-violet-200/70"
              />
            </ModalField>
            <ModalField label="Difficulty">
              <input
                value={editingRound.difficulty}
                onChange={(event) => setEditingRound((previous) => previous ? { ...previous, difficulty: event.target.value } : previous)}
                className="w-full rounded-xl border border-violet-300/30 bg-black/45 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-violet-200/70"
              />
            </ModalField>
            <ModalField label="Start Time (ms)">
              <input
                value={editingRound.startTime}
                onChange={(event) => setEditingRound((previous) => previous ? { ...previous, startTime: event.target.value } : previous)}
                className="w-full rounded-xl border border-violet-300/30 bg-black/45 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-violet-200/70"
              />
            </ModalField>
            <ModalField label="End Time (ms)">
              <input
                value={editingRound.endTime}
                onChange={(event) => setEditingRound((previous) => previous ? { ...previous, endTime: event.target.value } : previous)}
                className="w-full rounded-xl border border-violet-300/30 bg-black/45 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-violet-200/70"
              />
            </ModalField>
            <ModalField label="Description" className="sm:col-span-2">
              <textarea
                value={editingRound.description}
                onChange={(event) => setEditingRound((previous) => previous ? { ...previous, description: event.target.value } : previous)}
                className="min-h-28 w-full rounded-xl border border-violet-300/30 bg-black/45 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-violet-200/70"
              />
            </ModalField>
          </div>
        </EditDialog>
      )}
      {editingHero && (
        <EditDialog
          title="Edit Hero"
          onClose={() => !isSavingEdit && setEditingHero(null)}
          onSubmit={() => {
            void saveHeroEdit();
          }}
          submitLabel={isSavingEdit ? "Saving..." : "Save Hero"}
          disabled={isSavingEdit}
          destructiveActionLabel={isSavingEdit ? "Deleting..." : "Delete Hero"}
          onDestructiveAction={() => {
            void deleteHeroEntry();
          }}
        >
          <div className="grid grid-cols-1 gap-3">
            <ModalField label="Name">
              <input
                value={editingHero.name}
                onChange={(event) => setEditingHero((previous) => previous ? { ...previous, name: event.target.value } : previous)}
                className="w-full rounded-xl border border-violet-300/30 bg-black/45 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-violet-200/70"
              />
            </ModalField>
            <ModalField label="Author">
              <input
                value={editingHero.author}
                onChange={(event) => setEditingHero((previous) => previous ? { ...previous, author: event.target.value } : previous)}
                className="w-full rounded-xl border border-violet-300/30 bg-black/45 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-violet-200/70"
              />
            </ModalField>
            <ModalField label="Description">
              <textarea
                value={editingHero.description}
                onChange={(event) => setEditingHero((previous) => previous ? { ...previous, description: event.target.value } : previous)}
                className="min-h-28 w-full rounded-xl border border-violet-300/30 bg-black/45 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-violet-200/70"
              />
            </ModalField>
          </div>
        </EditDialog>
      )}
      {legacyPlaylistReview && (
        <EditDialog
          title="Review Legacy Import"
          onClose={dismissLegacyPlaylistReview}
          onSubmit={() => {
            void createLegacyPlaylist();
          }}
          submitLabel={
            legacyPlaylistReview.creating
              ? "Importing..."
              : legacyPlaylistReview.createPlaylist
                ? "Import and Create Playlist"
                : "Import Without Playlist"
          }
          disabled={legacyPlaylistReview.creating}
        >
          <div className="space-y-4">
            <div className="rounded-2xl border border-violet-300/25 bg-violet-500/10 p-4 text-sm text-zinc-200">
              Review the folder before import. Ordered by filename (natural sort), so entries like 2, 10, and 100 stay in human order.
            </div>
            <label className="flex items-start gap-3 rounded-2xl border border-zinc-700/70 bg-black/35 px-4 py-3 text-sm text-zinc-200">
              <input
                type="checkbox"
                checked={legacyPlaylistReview.createPlaylist}
                onChange={(event) =>
                  setLegacyPlaylistReview((current) =>
                    current
                      ? {
                          ...current,
                          createPlaylist: event.target.checked,
                          error: null,
                        }
                      : null
                  )
                }
                className="mt-0.5 h-4 w-4 rounded border-zinc-500 bg-black/40"
              />
              <span>
                Create a playlist after import.
              </span>
            </label>
            <ModalField label="Playlist Name">
              <input
                value={legacyPlaylistReview.playlistName}
                onChange={(event) =>
                  setLegacyPlaylistReview((current) =>
                    current
                      ? {
                          ...current,
                          playlistName: event.target.value,
                          error: null,
                        }
                      : null
                  )
                }
                disabled={!legacyPlaylistReview.createPlaylist}
                className={`w-full rounded-xl border px-4 py-3 text-sm outline-none transition-all duration-200 ${
                  legacyPlaylistReview.createPlaylist
                    ? "border-violet-300/35 bg-black/45 text-zinc-100 focus:border-violet-200/80 focus:ring-2 focus:ring-violet-400/25"
                    : "cursor-not-allowed border-zinc-700 bg-zinc-900/70 text-zinc-500"
                }`}
                placeholder="Legacy Playlist"
              />
            </ModalField>
            <div className="rounded-2xl border border-zinc-700/70 bg-black/35 p-4">
              <div className="mb-3 flex items-center justify-between gap-3 text-xs uppercase tracking-[0.18em] text-zinc-300">
                <span>Import Order Preview</span>
                <span>{legacyPlaylistReview.slots.length} slots</span>
              </div>
              <div className="max-h-80 space-y-2 overflow-y-auto pr-1">
                {legacyPlaylistReview.slots.map((slot) => (
                  <div
                    key={slot.id}
                    className="flex items-center gap-3 rounded-xl border border-zinc-700/60 bg-zinc-900/60 px-3 py-3 text-sm text-zinc-100"
                  >
                    <span className="w-10 shrink-0 font-[family-name:var(--font-jetbrains-mono)] text-xs uppercase tracking-[0.18em] text-violet-200">
                      {slot.originalOrder + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-semibold text-zinc-50">{slot.sourceLabel}</div>
                      <div className="text-xs text-zinc-400">Excluded: {slot.excludedFromImport ? "Yes" : "No"}</div>
                      <div className="text-xs text-zinc-400">Checkpoint: {slot.selectedAsCheckpoint ? "Yes" : "No"}</div>
                    </div>
                    <label className="flex items-center gap-2 text-xs uppercase tracking-[0.14em] text-zinc-300">
                      <input
                        type="checkbox"
                        checked={!slot.excludedFromImport}
                        onChange={() => toggleLegacyImportExclusion(slot.id)}
                        className="h-4 w-4 rounded border-zinc-500 bg-black/40"
                      />
                      <span>Import</span>
                    </label>
                    <label className="flex items-center gap-2 text-xs uppercase tracking-[0.14em] text-zinc-300">
                      <input
                        type="checkbox"
                        checked={slot.selectedAsCheckpoint}
                        disabled={slot.excludedFromImport}
                        onChange={() => toggleLegacyCheckpointSelection(slot.id)}
                        className="h-4 w-4 rounded border-zinc-500 bg-black/40 disabled:cursor-not-allowed disabled:opacity-50"
                      />
                      <span>Checkpoint</span>
                    </label>
                  </div>
                ))}
              </div>
            </div>
            {legacyPlaylistReview.error && (
              <p className="rounded-xl border border-rose-300/35 bg-rose-500/15 px-4 py-3 text-sm text-rose-100">
                {legacyPlaylistReview.error}
              </p>
            )}
          </div>
        </EditDialog>
      )}
    </div>
  );
}

const RoundCard = memo(function RoundCard({
  round,
  index,
  onHoverSfx,
  onConvertToHero,
  onPlay,
  onEdit,
  animateDifficulty,
  showDisabledBadge,
}: {
  round: InstalledRound;
  index: number;
  onHoverSfx: () => void;
  onConvertToHero: (round: InstalledRound) => void;
  onPlay: (round: InstalledRound) => void;
  onEdit: (round: InstalledRound) => void;
  animateDifficulty: boolean;
  showDisabledBadge: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [showTechnicalDetails, setShowTechnicalDetails] = useState(false);
  const [isPreviewActive, setIsPreviewActive] = useState(false);
  const { getVideoSrc, ensurePlayableVideo, handleVideoError } = usePlayableVideoFallback();
  const previewUri = round.resources[0]?.videoUri;
  const previewImage = round.previewImage;
  const primaryResource = round.resources[0];
  const hasFunscript = Boolean(round.resources[0]?.funscriptUri);
  const difficulty = round.difficulty ?? 1;
  const sourceLabel = round.installSourceKey?.startsWith("stash:") ? "Stash" : "Local";
  const shouldLoadPreview = Boolean(previewUri) && isPreviewActive;
  const previewVideoSrc = shouldLoadPreview ? getVideoSrc(previewUri) : undefined;
  const previewWindowSec = useMemo(() => {
    const startMs =
      typeof round.startTime === "number" && Number.isFinite(round.startTime)
        ? Math.max(0, round.startTime)
        : 0;
    const rawEndMs =
      typeof round.endTime === "number" && Number.isFinite(round.endTime)
        ? Math.max(0, round.endTime)
        : null;
    const endMs = rawEndMs !== null && rawEndMs > startMs ? rawEndMs : null;
    return {
      startSec: startMs / 1000,
      endSec: endMs === null ? null : endMs / 1000,
    };
  }, [round.endTime, round.startTime]);

  const resolvePreviewWindow = (video: HTMLVideoElement) => {
    const hasFiniteDuration = Number.isFinite(video.duration) && video.duration > 0;
    const startSec = hasFiniteDuration ? Math.min(previewWindowSec.startSec, video.duration) : previewWindowSec.startSec;
    let endSec = previewWindowSec.endSec;
    if (endSec !== null && hasFiniteDuration) {
      endSec = Math.min(endSec, video.duration);
    }
    if (endSec !== null && endSec <= startSec + 0.001) {
      endSec = null;
    }
    return { startSec, endSec };
  };

  const startPreview = async () => {
    setIsPreviewActive(true);
    const video = videoRef.current;
    if (!video) return;
    if (video.readyState < HTMLMediaElement.HAVE_METADATA) return;
    const { startSec } = resolvePreviewWindow(video);
    video.currentTime = startSec;
    try {
      await video.play();
    } catch (error) {
      console.error("Preview play blocked", error);
    }
  };

  const stopPreview = () => {
    const video = videoRef.current;
    if (!video) return;
    video.pause();
    const { startSec } = resolvePreviewWindow(video);
    video.currentTime = startSec;
  };

  return (
    <article
      className="group animate-entrance overflow-hidden rounded-3xl border border-purple-300/30 bg-black/45 shadow-[0_0_25px_rgba(139,92,246,0.12)] backdrop-blur-lg transition-all duration-300 hover:-translate-y-1.5 hover:border-violet-300/70 hover:shadow-[0_0_45px_rgba(139,92,246,0.32)]"
      style={{ animationDelay: `${0.14 + index * 0.04}s` }}
      onMouseEnter={async () => {
        onHoverSfx();
        await startPreview();
      }}
      onMouseLeave={stopPreview}
      onFocus={async () => {
        onHoverSfx();
        await startPreview();
      }}
      onBlur={stopPreview}
    >
      <div className="group/video relative aspect-video overflow-hidden border-b border-purple-400/25 bg-gradient-to-br from-[#1b1130] via-[#120a25] to-[#0d1a33]">
        {previewImage && (
          <img
            src={previewImage}
            alt={`${round.name} preview`}
            className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
            loading="lazy"
            decoding="async"
          />
        )}
        {previewUri ? (
          <video
            ref={videoRef}
            className={`h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.06] ${previewImage ? "opacity-0 group-hover/video:opacity-100 group-focus-within/video:opacity-100" : ""}`}
            src={previewVideoSrc}
            muted
            preload={shouldLoadPreview ? "metadata" : "none"}
            playsInline
            poster={previewImage ?? undefined}
            onError={() => {
              void handleVideoError(previewUri);
            }}
            onLoadedMetadata={() => {
              if (!isPreviewActive) return;
              void ensurePlayableVideo(previewUri);
              const video = videoRef.current;
              if (!video) return;
              const { startSec } = resolvePreviewWindow(video);
              video.currentTime = startSec;
            }}
            onLoadedData={() => {
              if (!isPreviewActive) return;
              const video = videoRef.current;
              if (!video) return;
              const { startSec } = resolvePreviewWindow(video);
              video.currentTime = startSec;
              void video.play().catch(() => {});
            }}
            onTimeUpdate={() => {
              if (!isPreviewActive) return;
              const video = videoRef.current;
              if (!video) return;
              const { startSec, endSec } = resolvePreviewWindow(video);
              if (video.currentTime < startSec) {
                video.currentTime = startSec;
                return;
              }
              if (endSec !== null && video.currentTime >= endSec - 0.04) {
                video.currentTime = startSec;
                if (video.paused) {
                  void video.play().catch(() => {});
                }
              }
            }}
            onEnded={() => {
              if (!isPreviewActive) return;
              const video = videoRef.current;
              if (!video) return;
              const { startSec } = resolvePreviewWindow(video);
              video.currentTime = startSec;
              void video.play().catch(() => {});
            }}
          />
        ) : !previewImage ? (
          <div className="flex h-full items-center justify-center text-zinc-500 font-[family-name:var(--font-jetbrains-mono)] text-xs uppercase tracking-[0.35em]">
            No Preview
          </div>
        ) : null}

        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/75 via-black/20 to-transparent" />
        <DifficultyBadge difficulty={difficulty} animate={animateDifficulty} />

        {previewUri && (
          <button
            type="button"
            aria-label={`Play ${round.name}`}
            className="absolute left-1/2 top-1/2 z-20 flex h-16 w-16 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-white/55 bg-black/55 text-white opacity-0 shadow-[0_0_30px_rgba(0,0,0,0.45)] transition-all duration-200 group-hover/video:scale-105 group-hover/video:opacity-100 focus-visible:opacity-100"
            onMouseEnter={onHoverSfx}
            onClick={() => onPlay(round)}
          >
            <span className="ml-1 text-2xl leading-none">▶</span>
          </button>
        )}

        <div className="absolute right-3 top-3 flex flex-col items-end gap-1">
          <span className="rounded-md border border-violet-300/45 bg-violet-500/20 px-2 py-1 font-[family-name:var(--font-jetbrains-mono)] text-[10px] uppercase tracking-[0.25em] text-violet-100">
            {round.type ?? "Normal"}
          </span>
          <span className="rounded-md border border-cyan-300/45 bg-cyan-500/20 px-2 py-1 font-[family-name:var(--font-jetbrains-mono)] text-[10px] uppercase tracking-[0.2em] text-cyan-100">
            {sourceLabel}
          </span>
          {showDisabledBadge && (
            <span className="rounded-md border border-rose-300/45 bg-rose-500/20 px-2 py-1 font-[family-name:var(--font-jetbrains-mono)] text-[10px] uppercase tracking-[0.2em] text-rose-100">
              Disabled
            </span>
          )}
        </div>
      </div>

      <div className="space-y-3 p-4">
        <div>
          <h2 className="text-lg font-extrabold tracking-tight text-zinc-100">{round.name}</h2>
          <p className="mt-1 text-sm text-zinc-300 line-clamp-2">{round.description ?? "No description"}</p>
        </div>

        <div className="grid grid-cols-2 gap-2 text-xs font-[family-name:var(--font-jetbrains-mono)] uppercase tracking-[0.18em] text-zinc-300">
          <MetaItem label="BPM" value={round.bpm ? `${Math.round(round.bpm)}` : "N/A"} tone="cyan" />
          <MetaItem label="Hero" value={round.hero?.name ?? "N/A"} tone="pink" />
          <MetaItem label="Script" value={hasFunscript ? "Installed" : "Missing"} tone={hasFunscript ? "emerald" : "orange"} />
          <MetaItem label="Author" value={round.author ?? "Unknown"} tone="violet" />
          <MetaItem label="Window" value={formatWindow(round.startTime, round.endTime)} tone="indigo" />
          <MetaItem label="Added" value={formatDate(round.createdAt)} tone="cyan" />
        </div>

        <button
          className="mt-1 w-full rounded-xl border border-cyan-300/40 bg-cyan-500/15 px-4 py-2 font-[family-name:var(--font-jetbrains-mono)] text-xs uppercase tracking-[0.2em] text-cyan-100 transition-all duration-200 hover:border-cyan-200/75 hover:bg-cyan-500/30"
          onClick={() => onEdit(round)}
          onMouseEnter={onHoverSfx}
          type="button"
        >
          Edit Round
        </button>
        <button
          className="mt-1 w-full rounded-xl border border-violet-300/40 bg-violet-500/15 px-4 py-2 font-[family-name:var(--font-jetbrains-mono)] text-xs uppercase tracking-[0.2em] text-violet-100 transition-all duration-200 hover:border-violet-200/75 hover:bg-violet-500/30"
          onClick={() => setShowTechnicalDetails((prev) => !prev)}
          onMouseEnter={onHoverSfx}
          type="button"
        >
          {showTechnicalDetails ? "Hide Technical Details" : "Show Technical Details"}
        </button>
        {!round.heroId && !round.hero && (
          <button
            className="w-full rounded-xl border border-emerald-300/45 bg-emerald-500/20 px-4 py-2 font-[family-name:var(--font-jetbrains-mono)] text-xs uppercase tracking-[0.2em] text-emerald-100 transition-all duration-200 hover:border-emerald-200/75 hover:bg-emerald-500/35"
            onClick={() => onConvertToHero(round)}
            onMouseEnter={onHoverSfx}
            type="button"
          >
            Convert to Hero
          </button>
        )}

        {showTechnicalDetails && (
          <div className="rounded-xl border border-zinc-700/80 bg-black/35 p-3 font-[family-name:var(--font-jetbrains-mono)] text-[10px] uppercase tracking-[0.12em] text-zinc-300">
            <p className="break-all">Round Hash: {round.phash ?? "N/A"}</p>
            <p className="mt-1 break-all">Resource Hash: {primaryResource?.phash ?? "N/A"}</p>
            <p className="mt-1 break-all">Round ID: {round.id}</p>
            <p className="mt-1 break-all">Resource ID: {primaryResource?.id ?? "N/A"}</p>
            <p className="mt-1 break-all">Source Key: {round.installSourceKey ?? "N/A"}</p>
          </div>
        )}
      </div>
    </article>
  );
});

function HeroGroupHeader({
  heroName,
  roundCount,
  expanded,
  converting,
  onToggle,
  onConvertToRound,
  onEditHero,
  onHoverSfx,
}: {
  heroName: string;
  roundCount: number;
  expanded: boolean;
  converting: boolean;
  onToggle: () => void;
  onConvertToRound: () => void;
  onEditHero: () => void;
  onHoverSfx: () => void;
}) {
  return (
    <div className="flex w-full items-stretch gap-3 rounded-2xl">
      <button
        type="button"
        onMouseEnter={onHoverSfx}
        onFocus={onHoverSfx}
        onClick={onEditHero}
        className="shrink-0 rounded-2xl border border-cyan-300/45 bg-cyan-500/20 px-4 py-3 font-[family-name:var(--font-jetbrains-mono)] text-[10px] uppercase tracking-[0.2em] text-cyan-100 transition-all duration-200 hover:border-cyan-200/80 hover:bg-cyan-500/35"
      >
        Edit Hero
      </button>
      <button
        type="button"
        onMouseEnter={onHoverSfx}
        onFocus={onHoverSfx}
        onClick={onToggle}
        className="flex min-w-0 flex-1 items-center justify-between rounded-2xl border border-violet-300/35 bg-black/45 px-4 py-3 text-left shadow-[0_0_25px_rgba(139,92,246,0.12)] transition-all duration-200 hover:border-violet-200/70 hover:bg-violet-500/12"
        aria-expanded={expanded}
        aria-label={`${heroName} (${roundCount} rounds)`}
      >
        <div className="min-w-0">
          <p className="font-[family-name:var(--font-jetbrains-mono)] text-[10px] uppercase tracking-[0.25em] text-violet-200/85">
            Hero Group
          </p>
          <h2 className="mt-1 truncate text-lg font-extrabold tracking-tight text-zinc-100">
            {heroName}
          </h2>
        </div>
        <div className="flex items-center gap-3 pl-3">
          <span className="rounded-md border border-violet-300/40 bg-violet-500/15 px-2 py-1 font-[family-name:var(--font-jetbrains-mono)] text-[10px] uppercase tracking-[0.2em] text-violet-100">
            {roundCount} Rounds
          </span>
          <span className={`text-violet-200 transition-transform duration-200 ${expanded ? "rotate-180" : ""}`}>▾</span>
        </div>
      </button>
      <button
        type="button"
        onMouseEnter={onHoverSfx}
        onFocus={onHoverSfx}
        onClick={onConvertToRound}
        disabled={converting}
        className={`shrink-0 rounded-2xl border px-4 py-3 font-[family-name:var(--font-jetbrains-mono)] text-[10px] uppercase tracking-[0.2em] transition-all duration-200 ${
          converting
            ? "cursor-wait border-zinc-700 bg-zinc-800/80 text-zinc-400"
            : "border-rose-300/45 bg-rose-500/20 text-rose-100 hover:border-rose-200/80 hover:bg-rose-500/35"
        }`}
        aria-label={`Convert ${heroName} to round`}
      >
        {converting ? "Converting..." : "Convert to Round"}
      </button>
    </div>
  );
}

function DifficultyBadge({ difficulty, animate }: { difficulty: number; animate: boolean }) {
  const level = Math.max(1, Math.min(5, difficulty));
  return (
    <div className={`absolute left-3 top-3 flex items-center gap-2 rounded-full border border-pink-200/60 bg-pink-400/25 px-3 py-1.5 font-[family-name:var(--font-jetbrains-mono)] text-xs text-white shadow-[0_0_30px_rgba(236,72,153,0.6)] ${animate ? "animate-difficulty-pop" : ""}`}>
      <span className="text-pink-100">Difficulty</span>
      <span className="text-yellow-200 drop-shadow-[0_0_8px_rgba(253,224,71,0.85)]">{"★".repeat(level)}</span>
      <span className="rounded-full bg-black/30 px-2 py-0.5">{level}/5</span>
    </div>
  );
}

function EditDialog({
  title,
  children,
  onClose,
  onSubmit,
  submitLabel,
  disabled,
  destructiveActionLabel,
  onDestructiveAction,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  onSubmit: () => void;
  submitLabel: string;
  disabled: boolean;
  destructiveActionLabel?: string;
  onDestructiveAction?: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 px-4 backdrop-blur-sm">
      <div className="w-full max-w-2xl rounded-3xl border border-violet-300/30 bg-zinc-950/95 p-5 shadow-[0_0_40px_rgba(139,92,246,0.28)]">
        <div className="mb-4 flex items-center justify-between gap-4">
          <h2 className="text-xl font-extrabold tracking-tight text-zinc-100">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            disabled={disabled}
            className="rounded-xl border border-zinc-700 bg-black/40 px-3 py-2 text-xs uppercase tracking-[0.18em] text-zinc-300"
          >
            Close
          </button>
        </div>
        {children}
        <div className="mt-4 flex justify-end gap-3">
          {onDestructiveAction && destructiveActionLabel && (
            <button
              type="button"
              onClick={onDestructiveAction}
              disabled={disabled}
              className={`mr-auto rounded-xl border px-4 py-2 text-sm font-semibold ${
                disabled
                  ? "cursor-not-allowed border-zinc-700 bg-zinc-800 text-zinc-500"
                  : "border-rose-300/60 bg-rose-500/20 text-rose-100 hover:bg-rose-500/35"
              }`}
            >
              {destructiveActionLabel}
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            disabled={disabled}
            className="rounded-xl border border-zinc-700 bg-black/40 px-4 py-2 text-sm text-zinc-300"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onSubmit}
            disabled={disabled}
            className={`rounded-xl border px-4 py-2 text-sm font-semibold ${disabled ? "cursor-not-allowed border-zinc-700 bg-zinc-800 text-zinc-500" : "border-emerald-300/60 bg-emerald-500/25 text-emerald-100 hover:bg-emerald-500/40"}`}
          >
            {submitLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

function ModalField({
  label,
  children,
  className = "",
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={className}>
      <span className="mb-2 block font-[family-name:var(--font-jetbrains-mono)] text-[10px] uppercase tracking-[0.24em] text-zinc-300">
        {label}
      </span>
      {children}
    </label>
  );
}

function InstallScanStatusBadge({ status }: { status: InstallScanStatus }) {
  const tone =
    status.state === "running"
      ? "border-cyan-300/60 bg-cyan-500/20 text-cyan-100"
      : status.state === "aborted"
        ? "border-amber-300/60 bg-amber-500/20 text-amber-100"
      : status.state === "error"
        ? "border-rose-300/60 bg-rose-500/20 text-rose-100"
        : "border-emerald-300/60 bg-emerald-500/20 text-emerald-100";

  const summary = `${status.stats.installed} new / ${status.stats.updated} updated / ${status.stats.failed} failed`;
  const label =
    status.state === "running"
      ? `Scan running (${summary})`
      : status.state === "aborted"
        ? `Scan aborted (${summary})`
      : status.state === "error"
        ? `Scan error (${summary})`
        : `Last scan done (${summary})`;

  return (
    <div className={`rounded-xl border px-3 py-1.5 font-[family-name:var(--font-jetbrains-mono)] text-[10px] uppercase tracking-[0.2em] ${tone}`}>
      {label}
    </div>
  );
}

function InstallImportOverlay({
  status,
  aborting,
  onAbort,
}: {
  status: InstallScanStatus | null;
  aborting: boolean;
  onAbort: () => void;
}) {
  const summary = status
    ? `${status.stats.installed} new, ${status.stats.updated} updated, ${status.stats.failed} failed`
    : "Preparing import...";

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/80 px-4 backdrop-blur-md">
      <div className="w-full max-w-xl rounded-[2rem] border border-cyan-300/30 bg-zinc-950/95 p-6 shadow-[0_0_60px_rgba(34,211,238,0.18)]">
        <div className="flex items-start gap-4">
          <div className="mt-1 h-4 w-4 shrink-0 rounded-full bg-cyan-300 shadow-[0_0_22px_rgba(34,211,238,0.9)] animate-pulse" />
          <div className="flex-1 space-y-4">
            <div>
              <p className="font-[family-name:var(--font-jetbrains-mono)] text-[10px] uppercase tracking-[0.32em] text-cyan-200/85">
                Long Import Running
              </p>
              <h2 className="mt-2 text-2xl font-black tracking-tight text-zinc-50">
                Installing rounds can take a very long time.
              </h2>
              <p className="mt-3 text-sm leading-6 text-zinc-300">
                Hashes may need to be calculated, and video transcoding or preview generation may also be required.
                If you do not abort, you need to wait until the import finishes.
              </p>
            </div>

            <div className="rounded-2xl border border-cyan-300/20 bg-cyan-500/10 p-4">
              <p className="font-[family-name:var(--font-jetbrains-mono)] text-[10px] uppercase tracking-[0.22em] text-cyan-100">
                Progress
              </p>
              <p className="mt-2 text-sm text-zinc-100">{summary}</p>
              <p className="mt-2 text-sm text-zinc-300">
                {status?.lastMessage ?? "Scanning files and preparing imported rounds..."}
              </p>
            </div>

            <div className="flex justify-end">
              <button
                type="button"
                onClick={onAbort}
                disabled={aborting}
                className={`rounded-xl border px-4 py-2 font-[family-name:var(--font-jetbrains-mono)] text-xs uppercase tracking-[0.22em] transition-all duration-200 ${
                  aborting
                    ? "cursor-wait border-zinc-700 bg-zinc-800 text-zinc-500"
                    : "border-rose-300/55 bg-rose-500/20 text-rose-100 hover:border-rose-200/80 hover:bg-rose-500/35"
                }`}
              >
                {aborting ? "Aborting..." : "Abort Import"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

type GameOption<T extends string> = {
  value: T;
  label: string;
};

function GameDropdown<T extends string>({
  label,
  value,
  options,
  onChange,
  onHoverSfx,
  onSelectSfx,
}: {
  label: string;
  value: T;
  options: GameOption<T>[];
  onChange: (next: T) => void;
  onHoverSfx: () => void;
  onSelectSfx: () => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  const selected = options.find((opt) => opt.value === value) ?? options[0];

  return (
    <div ref={rootRef} className="relative">
      <span className="mb-2 block font-[family-name:var(--font-jetbrains-mono)] text-[10px] uppercase tracking-[0.25em] text-zinc-300">{label}</span>
      <button
        type="button"
        onMouseEnter={onHoverSfx}
        onFocus={onHoverSfx}
        onClick={() => {
          onSelectSfx();
          setOpen((prev) => !prev);
        }}
        className="flex w-full items-center justify-between rounded-xl border border-violet-300/30 bg-black/45 px-4 py-3 text-sm text-zinc-100 outline-none transition-all duration-200 hover:border-violet-200/60 focus:border-violet-200/70 focus:ring-2 focus:ring-violet-400/30"
      >
        <span>{selected.label}</span>
        <span className={`text-xs text-violet-200 transition-transform duration-200 ${open ? "rotate-180" : ""}`}>▾</span>
      </button>

      {open && (
        <div className="absolute z-50 mt-2 w-full overflow-hidden rounded-xl border border-violet-300/35 bg-zinc-950/95 shadow-[0_0_24px_rgba(139,92,246,0.38)] backdrop-blur-xl">
          {options.map((option) => {
            const active = option.value === value;
            return (
              <button
                key={option.value}
                type="button"
                onMouseEnter={onHoverSfx}
                onClick={() => {
                  onSelectSfx();
                  onChange(option.value);
                  setOpen(false);
                }}
                className={`flex w-full items-center justify-between px-3 py-2.5 text-left text-sm transition-colors duration-150 ${active ? "bg-violet-500/25 text-violet-100" : "text-zinc-200 hover:bg-violet-500/15"}`}
              >
                <span>{option.label}</span>
                {active && <span className="text-xs text-violet-200">●</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function MetaItem({ label, value, tone = "cyan" }: { label: string; value: string; tone?: "cyan" | "pink" | "emerald" | "orange" | "violet" | "indigo" }) {
  const toneClass =
    tone === "pink"
      ? "border-pink-300/35 bg-pink-500/10"
      : tone === "emerald"
        ? "border-emerald-300/35 bg-emerald-500/10"
        : tone === "orange"
          ? "border-orange-300/35 bg-orange-500/10"
          : tone === "violet"
            ? "border-violet-300/35 bg-violet-500/10"
            : tone === "indigo"
              ? "border-indigo-300/35 bg-indigo-500/10"
              : "border-cyan-300/35 bg-cyan-500/10";

  return (
    <div className={`rounded-lg border p-2 transition-colors duration-300 ${toneClass}`}>
      <p className="text-[10px] text-zinc-400">{label}</p>
      <p className="mt-1 truncate text-zinc-100">{value}</p>
    </div>
  );
}

function formatWindow(startTime: number | null, endTime: number | null): string {
  if (typeof startTime !== "number" || typeof endTime !== "number") {
    return "Full";
  }
  return `${startTime}s-${endTime}s`;
}

function formatDate(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  return date.toLocaleDateString();
}
