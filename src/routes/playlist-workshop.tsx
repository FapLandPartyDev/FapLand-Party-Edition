import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatedBackground } from "../components/AnimatedBackground";
import { MenuButton } from "../components/MenuButton";
import { PlaylistResolutionModal } from "../components/PlaylistResolutionModal";
import {
  CURRENT_PLAYLIST_VERSION,
  ZPlaylistConfig,
  type LinearBoardConfig,
} from "../game/playlistSchema";
import {
  analyzePlaylistResolution,
  applyPlaylistResolutionMapping,
  type PlaylistResolutionAnalysis,
} from "../game/playlistResolution";
import { createDefaultPlaylistConfig, resolvePortableRoundRef, toPortableRoundRef } from "../game/playlistRuntime";
import { getSinglePlayerAntiPerkPool, getSinglePlayerPerkPool } from "../game/data/perks";
import { PERK_RARITY_META, resolvePerkRarity } from "../game/data/perkRarity";
import { db, type InstalledRound } from "../services/db";
import { playlists, type StoredPlaylist } from "../services/playlists";
import { playHoverSound, playSelectSound } from "../utils/audio";

type EditableLinearSetup = {
  roundCount: number;
  safePointsEnabled: boolean;
  safePointIndices: number[];
  normalRoundOrder: string[];
  enabledCumRoundIds: string[];
  enabledPerkIds: string[];
  enabledAntiPerkIds: string[];
  perkTriggerChancePerRound: number;
  probabilities: {
    intermediary: {
      initial: number;
      increasePerRound: number;
      max: number;
    };
    antiPerk: {
      initial: number;
      increasePerRound: number;
      max: number;
    };
  };
  scorePerCumRoundSuccess: number;
};

const DEFAULT_SAFE_PRESET = [25, 50, 75];
type NewPlaylistMode = "fully-random" | "progressive-random";
type NormalRoundSort = "selected-first" | "queue" | "name-asc" | "name-desc" | "author";
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

const parseSafePointsInput = (raw: string): number[] =>
  [...new Set(raw
    .split(",")
    .map((part) => Number(part.trim()))
    .filter((value) => Number.isFinite(value))
    .map((value) => Math.floor(value)))]
    .sort((a, b) => a - b);

const formatSafePointsInput = (indices: number[]): string => indices.join(", ");

function getLinearQueuePlacement(input: {
  totalIndices: number;
  safePointIndices: number[];
  normalRoundOrder: string[];
}): Record<string, { queuePosition: number; fieldIndex: number | null }> {
  const placement: Record<string, { queuePosition: number; fieldIndex: number | null }> = {};
  const safeSet = new Set(input.safePointIndices);
  const cappedTotal = Math.max(1, Math.min(500, Math.floor(input.totalIndices)));
  const availableFieldIndices: number[] = [];

  for (let fieldIndex = 1; fieldIndex <= cappedTotal; fieldIndex += 1) {
    if (!safeSet.has(fieldIndex)) {
      availableFieldIndices.push(fieldIndex);
    }
  }

  for (let queueIndex = 0; queueIndex < input.normalRoundOrder.length; queueIndex += 1) {
    const roundId = input.normalRoundOrder[queueIndex];
    if (!roundId) continue;
    placement[roundId] = {
      queuePosition: queueIndex + 1,
      fieldIndex: availableFieldIndices[queueIndex] ?? null,
    };
  }

  return placement;
}

function getRoundDurationSec(round: InstalledRound): number {
  const start = typeof round.startTime === "number" ? round.startTime : null;
  const end = typeof round.endTime === "number" ? round.endTime : null;
  if (start === null || end === null || end <= start) return 0;
  return Math.max(0, Math.floor((end - start) / 1000));
}

function formatDurationLabel(totalSeconds: number): string {
  if (totalSeconds <= 0) return "Unknown duration";
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function shuffleRounds(rounds: InstalledRound[]): InstalledRound[] {
  const next = [...rounds];
  for (let i = next.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    const temp = next[i];
    next[i] = next[j]!;
    next[j] = temp!;
  }
  return next;
}

function buildProgressiveRandomOrder(rounds: InstalledRound[]): InstalledRound[] {
  if (rounds.length <= 1) return [...rounds];

  const difficultyValues = rounds.map((round) => round.difficulty ?? 1);
  const durationValues = rounds.map((round) => getRoundDurationSec(round));
  const minDifficulty = Math.min(...difficultyValues);
  const maxDifficulty = Math.max(...difficultyValues);
  const minDuration = Math.min(...durationValues);
  const maxDuration = Math.max(...durationValues);

  const normalize = (value: number, min: number, max: number): number => {
    if (max <= min) return 0.5;
    return (value - min) / (max - min);
  };

  const pool = [...rounds];
  const picked: InstalledRound[] = [];

  while (pool.length > 0) {
    const progress = picked.length / Math.max(1, rounds.length - 1);
    const biasStrength = progress * 2.5;
    const weighted = pool.map((round) => {
      const diffNorm = normalize(round.difficulty ?? 1, minDifficulty, maxDifficulty);
      const durationNorm = normalize(getRoundDurationSec(round), minDuration, maxDuration);
      const score = (diffNorm * 0.7) + (durationNorm * 0.3);
      const jitter = Math.random() * 0.35;
      return {
        round,
        weight: Math.max(0.01, 0.2 + jitter + (score * biasStrength)),
      };
    });

    const total = weighted.reduce((sum, entry) => sum + entry.weight, 0);
    let cursor = Math.random() * total;
    let chosenIndex = weighted.length - 1;
    for (let i = 0; i < weighted.length; i += 1) {
      cursor -= weighted[i]!.weight;
      if (cursor <= 0) {
        chosenIndex = i;
        break;
      }
    }

    const [chosen] = pool.splice(chosenIndex, 1);
    if (chosen) picked.push(chosen);
  }

  return picked;
}

const getInstalledRounds = async (): Promise<InstalledRound[]> => {
  try {
    return await db.round.findInstalled();
  } catch (error) {
    console.error("Failed to fetch installed rounds", error);
    return [];
  }
};

function toEditableSetup(playlist: StoredPlaylist, installedRounds: InstalledRound[]): EditableLinearSetup {
  const config = playlist.config;

  if (config.boardConfig.mode !== "linear") {
    return {
      roundCount: 100,
      safePointsEnabled: true,
      safePointIndices: [...DEFAULT_SAFE_PRESET],
      normalRoundOrder: [],
      enabledCumRoundIds: [],
      enabledPerkIds: [...config.perkPool.enabledPerkIds],
      enabledAntiPerkIds: [...config.perkPool.enabledAntiPerkIds],
      perkTriggerChancePerRound: config.perkSelection.triggerChancePerCompletedRound,
      probabilities: {
        intermediary: {
          initial: config.probabilityScaling.initialIntermediaryProbability,
          increasePerRound: config.probabilityScaling.intermediaryIncreasePerRound,
          max: config.probabilityScaling.maxIntermediaryProbability,
        },
        antiPerk: {
          initial: config.probabilityScaling.initialAntiPerkProbability,
          increasePerRound: config.probabilityScaling.antiPerkIncreasePerRound,
          max: config.probabilityScaling.maxAntiPerkProbability,
        },
      },
      scorePerCumRoundSuccess: config.economy.scorePerCumRoundSuccess,
    };
  }

  const board = config.boardConfig;
  const orderFromBoard = board.normalRoundOrder
    .map((ref) => resolvePortableRoundRef(ref, installedRounds)?.id)
    .filter((id): id is string => Boolean(id));
  const orderFromExplicit = Object.entries(board.normalRoundRefsByIndex)
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .map(([, ref]) => resolvePortableRoundRef(ref, installedRounds)?.id)
    .filter((id): id is string => Boolean(id));

  const normalRoundOrder = orderFromBoard.length > 0 ? orderFromBoard : orderFromExplicit;
  const enabledCumRoundIds = board.cumRoundRefs
    .map((ref) => resolvePortableRoundRef(ref, installedRounds)?.id)
    .filter((id): id is string => Boolean(id));

  return {
    roundCount: board.totalIndices,
    safePointsEnabled: board.safePointIndices.length > 0,
    safePointIndices: [...board.safePointIndices],
    normalRoundOrder,
    enabledCumRoundIds,
    enabledPerkIds: [...config.perkPool.enabledPerkIds],
    enabledAntiPerkIds: [...config.perkPool.enabledAntiPerkIds],
    perkTriggerChancePerRound: config.perkSelection.triggerChancePerCompletedRound,
    probabilities: {
      intermediary: {
        initial: config.probabilityScaling.initialIntermediaryProbability,
        increasePerRound: config.probabilityScaling.intermediaryIncreasePerRound,
        max: config.probabilityScaling.maxIntermediaryProbability,
      },
      antiPerk: {
        initial: config.probabilityScaling.initialAntiPerkProbability,
        increasePerRound: config.probabilityScaling.antiPerkIncreasePerRound,
        max: config.probabilityScaling.maxAntiPerkProbability,
      },
    },
    scorePerCumRoundSuccess: config.economy.scorePerCumRoundSuccess,
  };
}

function toLinearBoardConfig(setup: EditableLinearSetup, installedRounds: InstalledRound[]): LinearBoardConfig {
  const roundById = new Map(installedRounds.map((round) => [round.id, round]));

  const normalRoundOrder = setup.normalRoundOrder
    .map((id) => roundById.get(id))
    .filter((round): round is InstalledRound => Boolean(round))
    .map(toPortableRoundRef);

  const cumRoundRefs = setup.enabledCumRoundIds
    .map((id) => roundById.get(id))
    .filter((round): round is InstalledRound => Boolean(round))
    .map(toPortableRoundRef);

  return {
    mode: "linear",
    totalIndices: Math.max(1, Math.min(500, Math.floor(setup.roundCount))),
    safePointIndices: setup.safePointsEnabled
      ? parseSafePointsInput(formatSafePointsInput(setup.safePointIndices))
      : [],
    safePointRestMsByIndex: {},
    normalRoundRefsByIndex: {},
    normalRoundOrder,
    cumRoundRefs,
  };
}

export const Route = createFileRoute("/playlist-workshop")({
  loader: async () => {
    const [installedRounds, availablePlaylists, activePlaylist] = await Promise.all([
      getInstalledRounds(),
      playlists.list(),
      playlists.getActive(),
    ]);
    return { installedRounds, availablePlaylists, activePlaylist };
  },
  component: PlaylistWorkshopRoute,
});

function PlaylistWorkshopRoute() {
  const navigate = useNavigate();
  const goBack = () => {
    if (window.history.length > 1) {
      window.history.back();
      return;
    }
    void navigate({ to: "/" });
  };
  const { installedRounds, availablePlaylists, activePlaylist: loaderActivePlaylist } = Route.useLoaderData() as {
    installedRounds: InstalledRound[];
    availablePlaylists: StoredPlaylist[];
    activePlaylist: StoredPlaylist;
  };

  const [playlistList, setPlaylistList] = useState<StoredPlaylist[]>(
    availablePlaylists.some((playlist: StoredPlaylist) => playlist.id === loaderActivePlaylist.id)
      ? availablePlaylists
      : [loaderActivePlaylist, ...availablePlaylists],
  );
  const [activePlaylistId, setActivePlaylistId] = useState(loaderActivePlaylist.id);
  const [importNotice, setImportNotice] = useState<string | null>(null);
  const [savePending, setSavePending] = useState(false);
  const [newPlaylistDialogOpen, setNewPlaylistDialogOpen] = useState(false);
  const [newPlaylistName, setNewPlaylistName] = useState("");
  const [newPlaylistMode, setNewPlaylistMode] = useState<NewPlaylistMode>("fully-random");
  const [newPlaylistPending, setNewPlaylistPending] = useState(false);
  const [renameDialogOpen, setRenameDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [renameDraft, setRenameDraft] = useState("");
  const [renamePending, setRenamePending] = useState(false);
  const [deletePending, setDeletePending] = useState(false);
  const [playlistMenuOpen, setPlaylistMenuOpen] = useState(false);
  const [normalRoundSearch, setNormalRoundSearch] = useState("");
  const [normalRoundSort, setNormalRoundSort] = useState<NormalRoundSort>("selected-first");
  const [resolutionModalState, setResolutionModalState] = useState<ResolutionModalState | null>(null);
  const [importedPlaylistReview, setImportedPlaylistReview] = useState<ImportedPlaylistReview | null>(null);
  const playlistMenuRef = useRef<HTMLDivElement | null>(null);

  const activePlaylist = useMemo(
    () => playlistList.find((playlist) => playlist.id === activePlaylistId) ?? loaderActivePlaylist,
    [activePlaylistId, loaderActivePlaylist, playlistList],
  );

  const [setup, setSetup] = useState<EditableLinearSetup>(() => toEditableSetup(activePlaylist, installedRounds));
  const [safePointsInput, setSafePointsInput] = useState<string>(formatSafePointsInput(setup.safePointIndices));

  useEffect(() => {
    const next = toEditableSetup(activePlaylist, installedRounds);
    setSetup(next);
    setSafePointsInput(formatSafePointsInput(next.safePointIndices));
  }, [activePlaylist, installedRounds]);

  useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      if (!playlistMenuRef.current) return;
      if (playlistMenuRef.current.contains(event.target as Node)) return;
      setPlaylistMenuOpen(false);
    };
    window.addEventListener("mousedown", onPointerDown);
    return () => window.removeEventListener("mousedown", onPointerDown);
  }, []);

  const normalRounds = useMemo(
    () => installedRounds.filter((round: InstalledRound) => (round.type ?? "Normal") === "Normal"),
    [installedRounds],
  );
  const cumRounds = useMemo(
    () => installedRounds.filter((round: InstalledRound) => round.type === "Cum"),
    [installedRounds],
  );
  const perks = useMemo(() => getSinglePlayerPerkPool(), []);
  const antiPerks = useMemo(() => getSinglePlayerAntiPerkPool(), []);

  const selectedNormalSet = useMemo(() => new Set(setup.normalRoundOrder), [setup.normalRoundOrder]);
  const selectedCumSet = useMemo(() => new Set(setup.enabledCumRoundIds), [setup.enabledCumRoundIds]);
  const selectedPerkSet = useMemo(() => new Set(setup.enabledPerkIds), [setup.enabledPerkIds]);
  const selectedAntiPerkSet = useMemo(() => new Set(setup.enabledAntiPerkIds), [setup.enabledAntiPerkIds]);
  const allPerkIds = useMemo(() => perks.map((perk) => perk.id), [perks]);
  const allAntiPerkIds = useMemo(() => antiPerks.map((perk) => perk.id), [antiPerks]);
  const normalRoundPlacement = useMemo(() => {
    const safePointIndices = setup.safePointsEnabled
      ? parseSafePointsInput(safePointsInput)
      : [];
    return getLinearQueuePlacement({
      totalIndices: setup.roundCount,
      safePointIndices,
      normalRoundOrder: setup.normalRoundOrder,
    });
  }, [safePointsInput, setup.normalRoundOrder, setup.roundCount, setup.safePointsEnabled]);
  const normalRoundOrderIndex = useMemo(
    () => new Map(setup.normalRoundOrder.map((roundId, index) => [roundId, index])),
    [setup.normalRoundOrder],
  );
  const visibleNormalRounds = useMemo(() => {
    const query = normalRoundSearch.trim().toLowerCase();
    const collator = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });

    const filtered = query.length === 0
      ? normalRounds
      : normalRounds.filter((round) =>
        `${round.name} ${round.author ?? ""}`.toLowerCase().includes(query));

    const compareByName = (a: InstalledRound, b: InstalledRound) => collator.compare(a.name, b.name);
    const compareByAuthor = (a: InstalledRound, b: InstalledRound) =>
      collator.compare(a.author ?? "Unknown Author", b.author ?? "Unknown Author") || compareByName(a, b);

    return [...filtered].sort((a, b) => {
      const aSelected = selectedNormalSet.has(a.id);
      const bSelected = selectedNormalSet.has(b.id);
      const aQueueIndex = normalRoundOrderIndex.get(a.id);
      const bQueueIndex = normalRoundOrderIndex.get(b.id);

      if (normalRoundSort === "selected-first") {
        if (aSelected !== bSelected) return aSelected ? -1 : 1;
        if (aSelected && bSelected) {
          return (aQueueIndex ?? Number.MAX_SAFE_INTEGER) - (bQueueIndex ?? Number.MAX_SAFE_INTEGER)
            || compareByName(a, b);
        }
        return compareByName(a, b);
      }

      if (normalRoundSort === "queue") {
        const aHasQueue = typeof aQueueIndex === "number";
        const bHasQueue = typeof bQueueIndex === "number";
        if (aHasQueue !== bHasQueue) return aHasQueue ? -1 : 1;
        if (aHasQueue && bHasQueue) {
          return (aQueueIndex ?? Number.MAX_SAFE_INTEGER) - (bQueueIndex ?? Number.MAX_SAFE_INTEGER)
            || compareByName(a, b);
        }
        return compareByName(a, b);
      }

      if (normalRoundSort === "name-desc") return compareByName(b, a);
      if (normalRoundSort === "author") return compareByAuthor(a, b);
      return compareByName(a, b);
    });
  }, [normalRoundOrderIndex, normalRoundSearch, normalRoundSort, normalRounds, selectedNormalSet]);
  const visibleSelectedNormalCount = useMemo(
    () => visibleNormalRounds.filter((round) => selectedNormalSet.has(round.id)).length,
    [selectedNormalSet, visibleNormalRounds],
  );

  const isLinearEditable = activePlaylist.config.boardConfig.mode === "linear";
  const activePlaylistResolution = useMemo(
    () => analyzePlaylistResolution(activePlaylist.config, installedRounds),
    [activePlaylist.config, installedRounds],
  );
  const activeImportReview = importedPlaylistReview?.playlistId === activePlaylist.id
    ? importedPlaylistReview
    : null;
  const activeResolutionReview = activePlaylistResolution.issues.length > 0
    ? activePlaylistResolution
    : activeImportReview?.analysis ?? null;
  const activeResolutionActionLabel = activePlaylistResolution.issues.length > 0
    ? (activePlaylistResolution.counts.missing > 0 ? "Resolve Missing" : "Review Auto-Resolve")
    : (activeImportReview ? "Review Auto-Resolve" : null);

  const buildNewPlaylistConfig = (mode: NewPlaylistMode) => {
    const base = createDefaultPlaylistConfig(installedRounds);
    const normalRounds = installedRounds.filter((round: InstalledRound) => (round.type ?? "Normal") === "Normal");
    const ordered = mode === "fully-random"
      ? shuffleRounds(normalRounds)
      : buildProgressiveRandomOrder(normalRounds);

    return ZPlaylistConfig.parse({
      ...base,
      boardConfig: {
        ...base.boardConfig,
        mode: "linear",
        normalRoundOrder: ordered.map(toPortableRoundRef),
      },
    });
  };

  const refreshPlaylists = async () => {
    const [nextList, nextActive] = await Promise.all([playlists.list(), playlists.getActive()]);
    setPlaylistList(
      nextList.some((playlist) => playlist.id === nextActive.id)
        ? nextList
        : [nextActive, ...nextList],
    );
    setActivePlaylistId(nextActive.id);
  };

  const saveLinearPlaylist = async (): Promise<boolean> => {
    if (!isLinearEditable || savePending) return false;
    setSavePending(true);
    try {
      const linearBoardConfig = toLinearBoardConfig(
        {
          ...setup,
          safePointIndices: parseSafePointsInput(safePointsInput),
        },
        installedRounds,
      );

      const nextConfig = ZPlaylistConfig.parse({
        ...activePlaylist.config,
        playlistVersion: activePlaylist.config.playlistVersion ?? CURRENT_PLAYLIST_VERSION,
        boardConfig: linearBoardConfig,
        perkSelection: {
          optionsPerPick: activePlaylist.config.perkSelection.optionsPerPick,
          triggerChancePerCompletedRound: Math.max(0, Math.min(1, setup.perkTriggerChancePerRound)),
        },
        perkPool: {
          enabledPerkIds: [...setup.enabledPerkIds],
          enabledAntiPerkIds: [...setup.enabledAntiPerkIds],
        },
        probabilityScaling: {
          initialIntermediaryProbability: Math.max(0, Math.min(1, setup.probabilities.intermediary.initial)),
          initialAntiPerkProbability: Math.max(0, Math.min(1, setup.probabilities.antiPerk.initial)),
          intermediaryIncreasePerRound: Math.max(0, Math.min(1, setup.probabilities.intermediary.increasePerRound)),
          antiPerkIncreasePerRound: Math.max(0, Math.min(1, setup.probabilities.antiPerk.increasePerRound)),
          maxIntermediaryProbability: Math.max(0, Math.min(1, setup.probabilities.intermediary.max)),
          maxAntiPerkProbability: Math.max(0, Math.min(1, setup.probabilities.antiPerk.max)),
        },
        economy: {
          ...activePlaylist.config.economy,
          scorePerCumRoundSuccess: Math.max(0, Math.floor(setup.scorePerCumRoundSuccess)),
        },
      });

      await playlists.update({
        playlistId: activePlaylist.id,
        config: nextConfig,
      });
      if (importedPlaylistReview?.playlistId === activePlaylist.id) {
        setImportedPlaylistReview(null);
      }
      await refreshPlaylists();
      setImportNotice("Playlist saved.");
      return true;
    } catch (error) {
      console.error("Failed to save playlist", error);
      setImportNotice("Failed to save playlist.");
      return false;
    } finally {
      setSavePending(false);
    }
  };

  const saveAndTestPlaylist = async () => {
    const saved = await saveLinearPlaylist();
    if (!saved) return;
    await playlists.setActive(activePlaylist.id);
    await navigate({ to: "/game" });
  };

  const toggleNormalRound = (roundId: string) => {
    setSetup((prev) => {
      if (prev.normalRoundOrder.includes(roundId)) {
        return { ...prev, normalRoundOrder: prev.normalRoundOrder.filter((id) => id !== roundId) };
      }
      return { ...prev, normalRoundOrder: [...prev.normalRoundOrder, roundId] };
    });
  };

  const moveNormalRound = (roundId: string, direction: -1 | 1) => {
    setSetup((prev) => {
      const index = prev.normalRoundOrder.indexOf(roundId);
      if (index < 0) return prev;
      const nextIndex = index + direction;
      if (nextIndex < 0 || nextIndex >= prev.normalRoundOrder.length) return prev;
      const nextOrder = [...prev.normalRoundOrder];
      const [entry] = nextOrder.splice(index, 1);
      if (!entry) return prev;
      nextOrder.splice(nextIndex, 0, entry);
      return { ...prev, normalRoundOrder: nextOrder };
    });
  };

  const applyNormalRoundOrdering = (mode: NewPlaylistMode) => {
    setSetup((prev) => {
      const selectedRoundIds = prev.normalRoundOrder.filter((roundId) =>
        normalRounds.some((round) => round.id === roundId));
      const sourceRounds = selectedRoundIds.length > 0
        ? selectedRoundIds
          .map((roundId) => normalRounds.find((round) => round.id === roundId))
          .filter((round): round is InstalledRound => Boolean(round))
        : normalRounds;

      if (sourceRounds.length === 0) return prev;

      const orderedRounds = mode === "fully-random"
        ? shuffleRounds(sourceRounds)
        : buildProgressiveRandomOrder(sourceRounds);

      return {
        ...prev,
        normalRoundOrder: orderedRounds.map((round) => round.id),
      };
    });
  };

  const toggleCumRound = (roundId: string) => {
    setSetup((prev) => {
      if (prev.enabledCumRoundIds.includes(roundId)) {
        return { ...prev, enabledCumRoundIds: prev.enabledCumRoundIds.filter((id) => id !== roundId) };
      }
      return { ...prev, enabledCumRoundIds: [...prev.enabledCumRoundIds, roundId] };
    });
  };

  const togglePerk = (perkId: string) => {
    setSetup((prev) => {
      if (prev.enabledPerkIds.includes(perkId)) {
        return { ...prev, enabledPerkIds: prev.enabledPerkIds.filter((id) => id !== perkId) };
      }
      return { ...prev, enabledPerkIds: [...prev.enabledPerkIds, perkId] };
    });
  };

  const toggleAntiPerk = (perkId: string) => {
    setSetup((prev) => {
      if (prev.enabledAntiPerkIds.includes(perkId)) {
        return { ...prev, enabledAntiPerkIds: prev.enabledAntiPerkIds.filter((id) => id !== perkId) };
      }
      return { ...prev, enabledAntiPerkIds: [...prev.enabledAntiPerkIds, perkId] };
    });
  };

  const percent = (value: number) => Math.round(value * 100);
  const toRatio = (value: number) => Math.max(0, Math.min(100, Math.floor(value))) / 100;

  return (
    <div className="relative min-h-screen overflow-hidden">
      <AnimatedBackground />

      <div className="relative z-10 h-screen overflow-y-auto px-4 py-8 sm:px-8">
        <main className="parallax-ui-none mx-auto flex w-full max-w-6xl flex-col gap-6 pb-6">
          <header className="animate-entrance relative z-30 rounded-3xl border border-purple-400/35 bg-zinc-950/60 p-6 backdrop-blur-xl shadow-[0_0_50px_rgba(139,92,246,0.28)]">
            <button
              type="button"
              onMouseEnter={playHoverSound}
              onClick={() => {
                playSelectSound();
                goBack();
              }}
              className="rounded-xl border border-violet-300/55 bg-violet-500/20 px-4 py-2 font-[family-name:var(--font-jetbrains-mono)] text-xs uppercase tracking-[0.2em] text-violet-100 transition-all duration-200 hover:border-violet-200/80 hover:bg-violet-500/35"
            >
              Go Back
            </button>
            <p className="font-[family-name:var(--font-jetbrains-mono)] text-xs uppercase tracking-[0.45em] text-purple-200/85">
              Creation & Workshop
            </p>
            <h1 className="mt-3 text-3xl font-black tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-violet-200 via-purple-100 to-indigo-200 sm:text-5xl">
              Playlist Workshop
            </h1>
            <p className="mt-3 text-sm text-zinc-300">
              Customize and maintain reusable playlists outside the play flow.
            </p>
            <div className="mt-4 grid gap-3 md:grid-cols-[minmax(220px,1fr)_repeat(7,minmax(90px,auto))]">
              <div ref={playlistMenuRef} className="relative">
                <button
                  type="button"
                  onMouseEnter={playHoverSound}
                  onClick={() => {
                    playSelectSound();
                    setPlaylistMenuOpen((prev) => !prev);
                  }}
                  className="w-full rounded-xl border border-violet-300/50 bg-gradient-to-b from-violet-500/25 to-indigo-500/20 px-4 py-2 text-left text-zinc-100 shadow-[0_0_24px_rgba(139,92,246,0.25)]"
                >
                  <div className="text-[10px] uppercase tracking-[0.2em] text-violet-200/80">Active Playlist</div>
                  <div className="mt-1 flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-semibold">{activePlaylist.name}</span>
                    <span className={`text-xs text-violet-200 transition-transform ${playlistMenuOpen ? "rotate-180" : ""}`}>
                      ▼
                    </span>
                  </div>
                </button>
                {playlistMenuOpen && (
                  <div className="absolute left-0 right-0 top-[calc(100%+8px)] z-[120] max-h-80 overflow-y-auto rounded-xl border border-violet-300/45 bg-zinc-950/95 p-2 shadow-2xl backdrop-blur-xl">
                    {playlistList.map((playlist) => {
                      const selected = playlist.id === activePlaylist.id;
                      return (
                        <button
                          key={playlist.id}
                          type="button"
                          onMouseEnter={playHoverSound}
                          onClick={() => {
                            playSelectSound();
                            void (async () => {
                              await playlists.setActive(playlist.id);
                              await refreshPlaylists();
                              setPlaylistMenuOpen(false);
                            })();
                          }}
                          className={`mb-1 w-full rounded-lg border px-3 py-2 text-left text-sm last:mb-0 ${selected
                              ? "border-emerald-300/60 bg-emerald-500/20 text-emerald-100"
                              : "border-zinc-700 bg-black/40 text-zinc-200 hover:border-violet-300/60 hover:bg-violet-500/20"
                            }`}
                        >
                          <div className="truncate font-semibold">{playlist.name}</div>
                          <div className="text-[10px] uppercase tracking-[0.15em] text-zinc-400">
                            {selected ? "Selected" : "Select"}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
              <HeaderAction label="New" onClick={async () => {
                playSelectSound();
                setNewPlaylistName("New Playlist");
                setNewPlaylistMode("fully-random");
                setNewPlaylistDialogOpen(true);
              }} />
              <HeaderAction label="Duplicate" onClick={async () => {
                playSelectSound();
                const duplicated = await playlists.duplicate(activePlaylist.id);
                await playlists.setActive(duplicated.id);
                await refreshPlaylists();
              }} />
              <HeaderAction label="Rename" onClick={async () => {
                playSelectSound();
                setRenameDraft(activePlaylist.name);
                setRenameDialogOpen(true);
              }} />
              <HeaderAction label="Delete" onClick={async () => {
                playSelectSound();
                setDeleteDialogOpen(true);
              }} />
              <HeaderAction label="Import" onClick={async () => {
                playSelectSound();
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
                await playlists.setActive(imported.playlist.id);
                await refreshPlaylists();
                if (analysis.resolution.issues.length > 0) {
                  setImportedPlaylistReview({
                    playlistId: imported.playlist.id,
                    analysis: analysis.resolution,
                  });
                } else {
                  setImportedPlaylistReview(null);
                }
                setImportNotice(
                  analysis.resolution.counts.suggested > 0
                    ? `Playlist imported with ${analysis.resolution.counts.suggested} auto-resolved round refs.`
                    : "Playlist imported.",
                );
              }} />
              {activeResolutionActionLabel && activeResolutionReview && (
                <HeaderAction label={activeResolutionActionLabel} onClick={async () => {
                  playSelectSound();
                  setResolutionModalState({
                    context: "playlist",
                    title: `Resolve ${activePlaylist.name}`,
                    analysis: activeResolutionReview,
                  });
                }} />
              )}
              <HeaderAction label="Export" onClick={async () => {
                playSelectSound();
                const filePath = await window.electronAPI.dialog.selectPlaylistExportPath(activePlaylist.name);
                if (!filePath) return;
                await playlists.exportToFile(activePlaylist.id, filePath);
                setImportNotice("Playlist exported.");
              }} />
              <HeaderAction label={savePending ? "Saving..." : "Save"} onClick={() => {
                playSelectSound();
                void saveLinearPlaylist();
              }} disabled={savePending || !isLinearEditable} />
            </div>
            <p className="mt-3 text-xs uppercase tracking-[0.12em] text-zinc-400">
              Playlist Version {activePlaylist.config.playlistVersion}
            </p>
            {importNotice && (
              <p className="mt-2 text-sm text-amber-200">{importNotice}</p>
            )}
            {activeResolutionActionLabel && activeResolutionReview && (
              <p className="mt-2 text-sm text-cyan-200">
                {activeResolutionReview.counts.missing > 0
                  ? `${activeResolutionReview.counts.missing} playlist refs still need a manual match.`
                  : `${activeResolutionReview.counts.suggested} refs were auto-resolved and can be reviewed.`}
              </p>
            )}
            {!isLinearEditable && (
              <p className="mt-2 text-sm text-rose-200">
                This playlist uses graph board mode. Graph editing is not available yet.
              </p>
            )}
          </header>

          <section className="rounded-3xl border border-purple-400/25 bg-zinc-950/55 p-5 backdrop-blur-xl">
            <h2 className="text-lg font-bold text-violet-100">Session Rounds</h2>
            <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
              <NumberInput
                label="Round Count"
                value={setup.roundCount}
                min={1}
                max={500}
                disabled={!isLinearEditable}
                onChange={(value) => setSetup((prev) => ({ ...prev, roundCount: value }))}
              />

              <label className="block">
                <span className="mb-2 block text-xs uppercase tracking-[0.2em] text-zinc-300">Safe Points</span>
                <button
                  type="button"
                  disabled={!isLinearEditable}
                  onMouseEnter={playHoverSound}
                  onClick={() => {
                    playSelectSound();
                    setSetup((prev) => ({ ...prev, safePointsEnabled: !prev.safePointsEnabled }));
                  }}
                  className={`w-full rounded-xl border px-4 py-3 text-sm font-semibold ${setup.safePointsEnabled
                      ? "border-emerald-300/55 bg-emerald-500/20 text-emerald-100"
                      : "border-zinc-600 bg-zinc-800 text-zinc-300"
                    }`}
                >
                  {setup.safePointsEnabled ? "Enabled" : "Disabled"}
                </button>
              </label>

              <div className="flex items-end">
                <button
                  type="button"
                  disabled={!isLinearEditable}
                  onMouseEnter={playHoverSound}
                  onClick={() => {
                    playSelectSound();
                    setSetup((prev) => ({ ...prev, safePointsEnabled: true, safePointIndices: [...DEFAULT_SAFE_PRESET] }));
                    setSafePointsInput(formatSafePointsInput(DEFAULT_SAFE_PRESET));
                  }}
                  className="w-full rounded-xl border border-violet-300/60 bg-violet-500/25 px-4 py-3 text-sm font-semibold text-violet-100 hover:bg-violet-500/35"
                >
                  Apply 25/50/75 Preset
                </button>
              </div>
            </div>

            <label className="mt-4 block">
              <span className="mb-2 block text-xs uppercase tracking-[0.2em] text-zinc-300">Safe Point Indices (comma-separated)</span>
              <input
                type="text"
                value={safePointsInput}
                disabled={!isLinearEditable || !setup.safePointsEnabled}
                onChange={(event) => setSafePointsInput(event.target.value)}
                onBlur={() =>
                  setSafePointsInput((current) => formatSafePointsInput(parseSafePointsInput(current)))
                }
                onMouseEnter={playHoverSound}
                className="w-full rounded-xl border border-purple-300/30 bg-black/45 px-4 py-3 text-sm text-zinc-100 outline-none disabled:opacity-50 focus:border-purple-300/75 focus:ring-2 focus:ring-purple-400/30"
                placeholder="25, 50, 75"
              />
            </label>
          </section>

          <section className="rounded-3xl border border-purple-400/25 bg-zinc-950/55 p-5 backdrop-blur-xl">
            <h2 className="text-lg font-bold text-violet-100">Normal Rounds (selection + order)</h2>
            <p className="mt-1 text-sm text-zinc-300">
              Selected order is used first. Remaining slots are filled with random repeats.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={!isLinearEditable || normalRounds.length === 0}
                onMouseEnter={playHoverSound}
                onClick={() => {
                  playSelectSound();
                  applyNormalRoundOrdering("fully-random");
                }}
                className="rounded-lg border border-emerald-300/45 bg-emerald-500/20 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.12em] text-emerald-100 hover:bg-emerald-500/35 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Fully Random Order
              </button>
              <button
                type="button"
                disabled={!isLinearEditable || normalRounds.length === 0}
                onMouseEnter={playHoverSound}
                onClick={() => {
                  playSelectSound();
                  applyNormalRoundOrdering("progressive-random");
                }}
                className="rounded-lg border border-violet-300/45 bg-violet-500/20 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.12em] text-violet-100 hover:bg-violet-500/35 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Progressive Random Order
              </button>
              <p className="self-center text-xs text-zinc-400">
                Applies to selected rounds, or all normal rounds if none are selected.
              </p>
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-[minmax(260px,1fr)_220px_auto] md:items-end">
              <label className="block">
                <span className="mb-2 block text-xs uppercase tracking-[0.2em] text-zinc-300">Search</span>
                <input
                  type="text"
                  value={normalRoundSearch}
                  onChange={(event) => setNormalRoundSearch(event.target.value)}
                  onMouseEnter={playHoverSound}
                  className="w-full rounded-xl border border-purple-300/30 bg-black/45 px-4 py-2.5 text-sm text-zinc-100 outline-none focus:border-purple-300/75 focus:ring-2 focus:ring-purple-400/30"
                  placeholder="Search by round or author"
                />
              </label>
              <label className="block">
                <span className="mb-2 block text-xs uppercase tracking-[0.2em] text-zinc-300">Sort</span>
                <select
                  value={normalRoundSort}
                  onChange={(event) => setNormalRoundSort(event.target.value as NormalRoundSort)}
                  onMouseEnter={playHoverSound}
                  className="w-full rounded-xl border border-purple-300/30 bg-black/45 px-4 py-2.5 text-sm text-zinc-100 outline-none focus:border-purple-300/75 focus:ring-2 focus:ring-purple-400/30"
                >
                  <option value="selected-first">Selected first</option>
                  <option value="queue">Queue position</option>
                  <option value="name-asc">Name (A-Z)</option>
                  <option value="name-desc">Name (Z-A)</option>
                  <option value="author">Author</option>
                </select>
              </label>
              <div className="flex flex-wrap gap-2 text-xs text-zinc-300 md:justify-end md:pb-1">
                <span className="rounded-full border border-emerald-300/45 bg-emerald-500/15 px-3 py-1">
                  Selected: {setup.normalRoundOrder.length}
                </span>
                <span className="rounded-full border border-violet-300/45 bg-violet-500/15 px-3 py-1">
                  Showing: {visibleNormalRounds.length}
                </span>
                <span className="rounded-full border border-zinc-600 bg-zinc-900/70 px-3 py-1">
                  Visible selected: {visibleSelectedNormalCount}
                </span>
              </div>
            </div>
            <div className="mt-4 grid max-h-[60vh] gap-2 overflow-y-auto pr-1">
              {visibleNormalRounds.map((round: InstalledRound) => {
                const selected = selectedNormalSet.has(round.id);
                const placement = normalRoundPlacement[round.id];
                const durationSec = getRoundDurationSec(round);
                const queuePosition = placement?.queuePosition ?? null;
                const isFirstInQueue = queuePosition === 1;
                const isLastInQueue = queuePosition === setup.normalRoundOrder.length;
                return (
                  <div
                    key={round.id}
                    className="rounded-2xl border border-violet-300/20 bg-gradient-to-r from-black/35 via-violet-950/20 to-black/20 px-3 py-3"
                  >
                    <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
                      <div className="flex min-w-0 flex-1 items-start gap-3">
                        <button
                          type="button"
                          disabled={!isLinearEditable}
                          onMouseEnter={playHoverSound}
                          onClick={() => {
                            playSelectSound();
                            toggleNormalRound(round.id);
                          }}
                          className={`rounded-md border px-3 py-1 text-xs font-semibold uppercase tracking-[0.15em] ${selected
                              ? "border-emerald-300/60 bg-emerald-500/20 text-emerald-100"
                              : "border-zinc-600 bg-zinc-800 text-zinc-300"
                            }`}
                        >
                          {selected ? "Selected" : "Select"}
                        </button>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-semibold text-zinc-100">{round.name}</div>
                          <div className="text-xs text-zinc-400">{round.author ?? "Unknown Author"}</div>
                          <div className="mt-1 flex flex-wrap gap-1.5 text-[11px]">
                            <span className="rounded-full border border-zinc-600/70 bg-zinc-900/80 px-2 py-0.5 text-zinc-300">
                              {formatDurationLabel(durationSec)}
                            </span>
                            {typeof round.difficulty === "number" && (
                              <span className="rounded-full border border-zinc-600/70 bg-zinc-900/80 px-2 py-0.5 text-zinc-300">
                                Difficulty {round.difficulty}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                      {selected && (
                        <div className="flex flex-wrap items-center gap-2 xl:justify-end">
                          <span className="rounded-full border border-violet-300/45 bg-violet-500/20 px-3 py-1 text-xs text-violet-100">
                            Q#{placement?.queuePosition ?? "?"}
                            {placement?.fieldIndex ? ` -> F${placement.fieldIndex}` : " -> Unplaced"}
                          </span>
                          <button
                            type="button"
                            disabled={!isLinearEditable || isFirstInQueue}
                            onMouseEnter={playHoverSound}
                            onClick={() => moveNormalRound(round.id, -1)}
                            className="rounded border border-zinc-600 px-2.5 py-1 text-xs text-zinc-200 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            Up
                          </button>
                          <button
                            type="button"
                            disabled={!isLinearEditable || isLastInQueue}
                            onMouseEnter={playHoverSound}
                            onClick={() => moveNormalRound(round.id, 1)}
                            className="rounded border border-zinc-600 px-2.5 py-1 text-xs text-zinc-200 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            Down
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
              {visibleNormalRounds.length === 0 && (
                <div className="rounded-xl border border-zinc-700 bg-black/30 px-3 py-2 text-sm text-zinc-400">
                  {normalRounds.length === 0 ? "No normal rounds installed." : "No rounds match your search."}
                </div>
              )}
            </div>
          </section>

          <section className="rounded-3xl border border-purple-400/25 bg-zinc-950/55 p-5 backdrop-blur-xl">
            <h2 className="text-lg font-bold text-violet-100">Cum Rounds</h2>
            <div className="mt-4 grid gap-2">
              {cumRounds.map((round: InstalledRound) => {
                const selected = selectedCumSet.has(round.id);
                return (
                  <button
                    key={round.id}
                    type="button"
                    disabled={!isLinearEditable}
                    onMouseEnter={playHoverSound}
                    onClick={() => {
                      playSelectSound();
                      toggleCumRound(round.id);
                    }}
                    className={`flex items-center justify-between rounded-xl border px-3 py-2 text-left ${selected
                        ? "border-emerald-300/60 bg-emerald-500/20 text-emerald-100"
                        : "border-zinc-600 bg-black/35 text-zinc-200"
                      }`}
                  >
                    <span className="truncate">{round.name}</span>
                    <span className="ml-3 text-xs uppercase tracking-[0.14em]">{selected ? "Enabled" : "Disabled"}</span>
                  </button>
                );
              })}
              {cumRounds.length === 0 && (
                <div className="rounded-xl border border-zinc-700 bg-black/30 px-3 py-2 text-sm text-zinc-400">
                  No cum rounds installed.
                </div>
              )}
            </div>
          </section>

          <section className="rounded-3xl border border-purple-400/25 bg-zinc-950/55 p-5 backdrop-blur-xl">
            <h2 className="text-lg font-bold text-violet-100">Perks and Anti-Perks</h2>
            <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold uppercase tracking-[0.14em] text-emerald-200">
                    Perks
                    <span className="ml-2 text-[11px] tracking-[0.12em] text-emerald-300/90">
                      {setup.enabledPerkIds.length}/{perks.length} active
                    </span>
                  </h3>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={!isLinearEditable}
                      onMouseEnter={playHoverSound}
                      onClick={() => {
                        playSelectSound();
                        setSetup((prev) => ({ ...prev, enabledPerkIds: [...allPerkIds] }));
                      }}
                      className="rounded-lg border border-emerald-300/45 bg-emerald-500/20 px-3 py-1 text-xs font-semibold uppercase tracking-[0.12em] text-emerald-100 hover:bg-emerald-500/35 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      Activate all perks
                    </button>
                    <button
                      type="button"
                      disabled={!isLinearEditable}
                      onMouseEnter={playHoverSound}
                      onClick={() => {
                        playSelectSound();
                        setSetup((prev) => ({ ...prev, enabledPerkIds: [] }));
                      }}
                      className="rounded-lg border border-zinc-600 bg-zinc-800/70 px-3 py-1 text-xs font-semibold uppercase tracking-[0.12em] text-zinc-200 hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      Deactivate all perks
                    </button>
                  </div>
                </div>
                <div className="space-y-2">
                  {perks.map((perk) => {
                    const selected = selectedPerkSet.has(perk.id);
                    const rarityMeta = PERK_RARITY_META[resolvePerkRarity(perk)];
                    return (
                      <button
                        key={perk.id}
                        type="button"
                        disabled={!isLinearEditable}
                        aria-pressed={selected}
                        onMouseEnter={playHoverSound}
                        onClick={() => {
                          playSelectSound();
                          togglePerk(perk.id);
                        }}
                        className={`w-full rounded-lg border px-3 py-2 text-left text-sm transition-all ${selected
                            ? `${rarityMeta.tailwind.setupSelected} ring-2 ring-emerald-300/65 shadow-[0_0_20px_rgba(16,185,129,0.25)]`
                            : `${rarityMeta.tailwind.setupIdle} border-dashed opacity-70`
                          }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="flex items-center gap-2">
                            <span className={`text-xs ${selected ? "text-emerald-300" : "text-zinc-500"}`}>{selected ? "●" : "○"}</span>
                            <span>{perk.name}</span>
                          </span>
                          <span className="flex items-center gap-1.5">
                            <span className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] ${selected
                                ? "border-emerald-300/65 bg-emerald-500/25 text-emerald-50"
                                : "border-zinc-600 bg-zinc-800/85 text-zinc-300"
                              }`}>
                              {selected ? "Active" : "Inactive"}
                            </span>
                            <span className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] ${rarityMeta.tailwind.badge}`}>
                              {rarityMeta.label}
                            </span>
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
              <div>
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold uppercase tracking-[0.14em] text-rose-200">
                    Anti-Perks
                    <span className="ml-2 text-[11px] tracking-[0.12em] text-rose-300/90">
                      {setup.enabledAntiPerkIds.length}/{antiPerks.length} active
                    </span>
                  </h3>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={!isLinearEditable}
                      onMouseEnter={playHoverSound}
                      onClick={() => {
                        playSelectSound();
                        setSetup((prev) => ({ ...prev, enabledAntiPerkIds: [...allAntiPerkIds] }));
                      }}
                      className="rounded-lg border border-rose-300/45 bg-rose-500/20 px-3 py-1 text-xs font-semibold uppercase tracking-[0.12em] text-rose-100 hover:bg-rose-500/35 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      Activate all antiperks
                    </button>
                    <button
                      type="button"
                      disabled={!isLinearEditable}
                      onMouseEnter={playHoverSound}
                      onClick={() => {
                        playSelectSound();
                        setSetup((prev) => ({ ...prev, enabledAntiPerkIds: [] }));
                      }}
                      className="rounded-lg border border-zinc-600 bg-zinc-800/70 px-3 py-1 text-xs font-semibold uppercase tracking-[0.12em] text-zinc-200 hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      Deactivate all antiperks
                    </button>
                  </div>
                </div>
                <div className="space-y-2">
                  {antiPerks.map((perk) => {
                    const selected = selectedAntiPerkSet.has(perk.id);
                    const rarityMeta = PERK_RARITY_META[resolvePerkRarity(perk)];
                    return (
                      <button
                        key={perk.id}
                        type="button"
                        disabled={!isLinearEditable}
                        aria-pressed={selected}
                        onMouseEnter={playHoverSound}
                        onClick={() => {
                          playSelectSound();
                          toggleAntiPerk(perk.id);
                        }}
                        className={`w-full rounded-lg border px-3 py-2 text-left text-sm transition-all ${selected
                            ? `${rarityMeta.tailwind.setupSelected} ring-2 ring-rose-300/65 shadow-[0_0_20px_rgba(251,113,133,0.25)]`
                            : `${rarityMeta.tailwind.setupIdle} border-dashed opacity-70`
                          }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="flex items-center gap-2">
                            <span className={`text-xs ${selected ? "text-rose-300" : "text-zinc-500"}`}>{selected ? "●" : "○"}</span>
                            <span>{perk.name}</span>
                          </span>
                          <span className="flex items-center gap-1.5">
                            <span className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] ${selected
                                ? "border-rose-300/65 bg-rose-500/25 text-rose-50"
                                : "border-zinc-600 bg-zinc-800/85 text-zinc-300"
                              }`}>
                              {selected ? "Active" : "Inactive"}
                            </span>
                            <span className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] ${rarityMeta.tailwind.badge}`}>
                              {rarityMeta.label}
                            </span>
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </section>

          <section className="rounded-3xl border border-purple-400/25 bg-zinc-950/55 p-5 backdrop-blur-xl">
            <h2 className="text-lg font-bold text-violet-100">Probabilities</h2>
            <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
              <NumberInput
                label="Perk Trigger Chance %"
                value={percent(setup.perkTriggerChancePerRound)}
                disabled={!isLinearEditable}
                onChange={(value) => setSetup((prev) => ({ ...prev, perkTriggerChancePerRound: toRatio(value) }))}
              />
              <NumberInput
                label="Intermediary Initial %"
                value={percent(setup.probabilities.intermediary.initial)}
                disabled={!isLinearEditable}
                onChange={(value) =>
                  setSetup((prev) => ({
                    ...prev,
                    probabilities: {
                      ...prev.probabilities,
                      intermediary: { ...prev.probabilities.intermediary, initial: toRatio(value) },
                    },
                  }))
                }
              />
              <NumberInput
                label="Intermediary Increase %"
                value={percent(setup.probabilities.intermediary.increasePerRound)}
                disabled={!isLinearEditable}
                onChange={(value) =>
                  setSetup((prev) => ({
                    ...prev,
                    probabilities: {
                      ...prev.probabilities,
                      intermediary: { ...prev.probabilities.intermediary, increasePerRound: toRatio(value) },
                    },
                  }))
                }
              />
              <NumberInput
                label="Intermediary Max %"
                value={percent(setup.probabilities.intermediary.max)}
                disabled={!isLinearEditable}
                onChange={(value) =>
                  setSetup((prev) => ({
                    ...prev,
                    probabilities: {
                      ...prev.probabilities,
                      intermediary: { ...prev.probabilities.intermediary, max: toRatio(value) },
                    },
                  }))
                }
              />
              <NumberInput
                label="Anti-Perk Initial %"
                value={percent(setup.probabilities.antiPerk.initial)}
                disabled={!isLinearEditable}
                onChange={(value) =>
                  setSetup((prev) => ({
                    ...prev,
                    probabilities: {
                      ...prev.probabilities,
                      antiPerk: { ...prev.probabilities.antiPerk, initial: toRatio(value) },
                    },
                  }))
                }
              />
              <NumberInput
                label="Anti-Perk Increase %"
                value={percent(setup.probabilities.antiPerk.increasePerRound)}
                disabled={!isLinearEditable}
                onChange={(value) =>
                  setSetup((prev) => ({
                    ...prev,
                    probabilities: {
                      ...prev.probabilities,
                      antiPerk: { ...prev.probabilities.antiPerk, increasePerRound: toRatio(value) },
                    },
                  }))
                }
              />
              <NumberInput
                label="Anti-Perk Max %"
                value={percent(setup.probabilities.antiPerk.max)}
                disabled={!isLinearEditable}
                onChange={(value) =>
                  setSetup((prev) => ({
                    ...prev,
                    probabilities: {
                      ...prev.probabilities,
                      antiPerk: { ...prev.probabilities.antiPerk, max: toRatio(value) },
                    },
                  }))
                }
              />
              <NumberInput
                label="Cum Round Bonus Score"
                value={setup.scorePerCumRoundSuccess}
                min={0}
                max={100000}
                disabled={!isLinearEditable}
                onChange={(value) =>
                  setSetup((prev) => ({
                    ...prev,
                    scorePerCumRoundSuccess: Math.max(0, value),
                  }))
                }
              />
            </div>
          </section>


          <div className="mx-auto grid w-full max-w-md grid-cols-1 gap-2">
            <MenuButton
              label={savePending ? "Saving..." : "Save Without Test"}
              onHover={playHoverSound}
              onClick={() => {
                playSelectSound();
                void saveLinearPlaylist();
              }}
            />
            <MenuButton
              label={savePending ? "Saving..." : "Save and Test"}
              primary
              onHover={playHoverSound}
              onClick={() => {
                playSelectSound();
                void saveAndTestPlaylist();
              }}
            />
            <MenuButton
              label="Back to Main Menu"
              onHover={playHoverSound}
              onClick={() => {
                playSelectSound();
                navigate({ to: "/" });
              }}
            />
          </div>
        </main>
      </div>

      {renameDialogOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4">
          <div className="w-full max-w-md rounded-2xl border border-violet-300/35 bg-zinc-950/90 p-5 shadow-2xl backdrop-blur-xl">
            <h2 className="text-lg font-bold text-violet-100">Rename Playlist</h2>
            <p className="mt-2 text-sm text-zinc-300">Choose a new name for this playlist.</p>
            <label className="mt-4 block">
              <span className="mb-2 block text-xs uppercase tracking-[0.2em] text-zinc-300">Playlist Name</span>
              <input
                type="text"
                value={renameDraft}
                autoFocus
                maxLength={120}
                onChange={(event) => setRenameDraft(event.target.value)}
                onMouseEnter={playHoverSound}
                className="w-full rounded-xl border border-purple-300/30 bg-black/45 px-4 py-3 text-sm text-zinc-100 outline-none focus:border-purple-300/75 focus:ring-2 focus:ring-purple-400/30"
              />
            </label>
            <div className="mt-5 grid grid-cols-2 gap-2">
              <button
                type="button"
                disabled={renamePending}
                onClick={() => {
                  playSelectSound();
                  setRenameDialogOpen(false);
                }}
                className="rounded-xl border border-zinc-600 bg-zinc-900 px-3 py-2 text-sm font-semibold text-zinc-200 hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={renamePending}
                onClick={() => {
                  playSelectSound();
                  void (async () => {
                    const nextName = renameDraft.trim();
                    if (nextName.length === 0) {
                      setImportNotice("Playlist name cannot be empty.");
                      return;
                    }
                    setRenamePending(true);
                    try {
                      await playlists.update({ playlistId: activePlaylist.id, name: nextName });
                      await refreshPlaylists();
                      setRenameDialogOpen(false);
                      setImportNotice("Playlist renamed.");
                    } catch (error) {
                      console.error("Failed to rename playlist", error);
                      setImportNotice("Failed to rename playlist.");
                    } finally {
                      setRenamePending(false);
                    }
                  })();
                }}
                className="rounded-xl border border-violet-300/45 bg-violet-500/20 px-3 py-2 text-sm font-semibold text-violet-100 hover:bg-violet-500/35 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {renamePending ? "Renaming..." : "Rename"}
              </button>
            </div>
          </div>
        </div>
      )}

      {newPlaylistDialogOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4">
          <div className="w-full max-w-xl rounded-2xl border border-violet-300/35 bg-zinc-950/90 p-5 shadow-2xl backdrop-blur-xl">
            <h2 className="text-lg font-bold text-violet-100">Create Playlist</h2>
            <p className="mt-2 text-sm text-zinc-300">
              Set a name and choose how rounds are generated.
            </p>
            <label className="mt-4 block">
              <span className="mb-2 block text-xs uppercase tracking-[0.2em] text-zinc-300">Playlist Name</span>
              <input
                type="text"
                value={newPlaylistName}
                autoFocus
                maxLength={120}
                onChange={(event) => setNewPlaylistName(event.target.value)}
                onMouseEnter={playHoverSound}
                className="w-full rounded-xl border border-purple-300/30 bg-black/45 px-4 py-3 text-sm text-zinc-100 outline-none focus:border-purple-300/75 focus:ring-2 focus:ring-purple-400/30"
              />
            </label>
            <div className="mt-4 grid gap-2">
              <button
                type="button"
                onClick={() => setNewPlaylistMode("fully-random")}
                className={`rounded-xl border px-4 py-3 text-left text-sm ${newPlaylistMode === "fully-random"
                    ? "border-emerald-300/60 bg-emerald-500/20 text-emerald-100"
                    : "border-zinc-600 bg-black/35 text-zinc-200"
                  }`}
              >
                <div className="font-semibold">Fully Random</div>
                <div className="mt-1 text-xs text-zinc-300">
                  Shuffles normal rounds randomly without difficulty bias.
                </div>
              </button>
              <button
                type="button"
                onClick={() => setNewPlaylistMode("progressive-random")}
                className={`rounded-xl border px-4 py-3 text-left text-sm ${newPlaylistMode === "progressive-random"
                    ? "border-violet-300/60 bg-violet-500/20 text-violet-100"
                    : "border-zinc-600 bg-black/35 text-zinc-200"
                  }`}
              >
                <div className="font-semibold">Progressive Random</div>
                <div className="mt-1 text-xs text-zinc-300">
                  Keeps randomness, but later rounds increasingly favor longer and higher-difficulty entries.
                </div>
              </button>
            </div>
            <div className="mt-5 grid grid-cols-2 gap-2">
              <button
                type="button"
                disabled={newPlaylistPending}
                onClick={() => {
                  playSelectSound();
                  setNewPlaylistDialogOpen(false);
                }}
                className="rounded-xl border border-zinc-600 bg-zinc-900 px-3 py-2 text-sm font-semibold text-zinc-200 hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={newPlaylistPending}
                onClick={() => {
                  playSelectSound();
                  void (async () => {
                    const name = newPlaylistName.trim();
                    if (name.length === 0) {
                      setImportNotice("Playlist name cannot be empty.");
                      return;
                    }
                    setNewPlaylistPending(true);
                    try {
                      const config = buildNewPlaylistConfig(newPlaylistMode);
                      const created = await playlists.create({ name, config });
                      await playlists.setActive(created.id);
                      await refreshPlaylists();
                      setNewPlaylistDialogOpen(false);
                      setImportNotice("Playlist created.");
                    } catch (error) {
                      console.error("Failed to create playlist", error);
                      setImportNotice("Failed to create playlist.");
                    } finally {
                      setNewPlaylistPending(false);
                    }
                  })();
                }}
                className="rounded-xl border border-violet-300/45 bg-violet-500/20 px-3 py-2 text-sm font-semibold text-violet-100 hover:bg-violet-500/35 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {newPlaylistPending ? "Creating..." : "Create"}
              </button>
            </div>
          </div>
        </div>
      )}

      {deleteDialogOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4">
          <div className="w-full max-w-md rounded-2xl border border-rose-300/35 bg-zinc-950/90 p-5 shadow-2xl backdrop-blur-xl">
            <h2 className="text-lg font-bold text-rose-100">Delete Playlist</h2>
            <p className="mt-2 text-sm text-zinc-300">
              Delete <span className="font-semibold text-zinc-100">{activePlaylist.name}</span>? This cannot be undone.
            </p>
            <div className="mt-5 grid grid-cols-2 gap-2">
              <button
                type="button"
                disabled={deletePending}
                onClick={() => {
                  playSelectSound();
                  setDeleteDialogOpen(false);
                }}
                className="rounded-xl border border-zinc-600 bg-zinc-900 px-3 py-2 text-sm font-semibold text-zinc-200 hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={deletePending}
                onClick={() => {
                  playSelectSound();
                  void (async () => {
                    setDeletePending(true);
                    try {
                      await playlists.remove(activePlaylist.id);
                      await refreshPlaylists();
                      setDeleteDialogOpen(false);
                      setImportNotice("Playlist deleted.");
                    } catch (error) {
                      console.error("Failed to delete playlist", error);
                      setImportNotice("Failed to delete playlist.");
                    } finally {
                      setDeletePending(false);
                    }
                  })();
                }}
                className="rounded-xl border border-rose-300/45 bg-rose-500/20 px-3 py-2 text-sm font-semibold text-rose-100 hover:bg-rose-500/35 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {deletePending ? "Deleting..." : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}

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
                await playlists.setActive(imported.playlist.id);
                await refreshPlaylists();
                setImportedPlaylistReview(
                  resolutionModalState.analysis.issues.length > 0
                    ? {
                      playlistId: imported.playlist.id,
                      analysis: resolutionModalState.analysis,
                    }
                    : null,
                );
                setImportNotice(
                  resolutionModalState.analysis.counts.missing > 0
                    ? `Playlist imported. ${resolutionModalState.analysis.counts.missing} refs still need a manual match.`
                    : "Playlist imported.",
                );
                setResolutionModalState(null);
                return;
              }

              const combinedMapping = {
                ...resolutionModalState.analysis.suggestedMapping,
                ...overrides,
              };
              const nextConfig = applyPlaylistResolutionMapping(activePlaylist.config, combinedMapping, installedRounds);
              await playlists.update({
                playlistId: activePlaylist.id,
                config: nextConfig,
              });
              if (importedPlaylistReview?.playlistId === activePlaylist.id) {
                setImportedPlaylistReview(null);
              }
              await refreshPlaylists();
              setImportNotice("Playlist resolutions applied.");
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
              await playlists.setActive(imported.playlist.id);
              await refreshPlaylists();
              setImportedPlaylistReview({
                playlistId: imported.playlist.id,
                analysis: resolutionModalState.analysis,
              });
              setImportNotice("Playlist imported with unresolved refs preserved.");
              setResolutionModalState(null);
            })();
          }}
        />
      )}
    </div>
  );
}

function HeaderAction({ label, onClick, disabled }: { label: string; onClick: () => void | Promise<void>; disabled?: boolean }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onMouseEnter={playHoverSound}
      onClick={() => {
        void onClick();
      }}
      className={`rounded-xl border px-3 py-2 font-[family-name:var(--font-jetbrains-mono)] text-xs uppercase tracking-[0.18em] ${disabled
          ? "cursor-not-allowed border-zinc-700 bg-zinc-900 text-zinc-500"
          : "border-violet-300/45 bg-violet-500/20 text-violet-100 hover:border-violet-200/80 hover:bg-violet-500/35"
        }`}
    >
      {label}
    </button>
  );
}

function NumberInput({
  label,
  value,
  onChange,
  disabled,
  min = 0,
  max = 100,
  step = 1,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  disabled?: boolean;
  min?: number;
  max?: number;
  step?: number;
}) {
  const clamp = (next: number): number => Math.max(min, Math.min(max, next));

  return (
    <label className="block">
      <span className="mb-2 block text-xs uppercase tracking-[0.2em] text-zinc-300">{label}</span>
      <div className={`flex items-center rounded-xl border bg-black/45 p-1 ${disabled ? "border-zinc-700 opacity-50" : "border-purple-300/30"
        }`}>
        <button
          type="button"
          disabled={disabled}
          onMouseEnter={playHoverSound}
          onClick={() => onChange(clamp(value - step))}
          className="rounded-lg border border-rose-300/45 bg-rose-500/20 px-3 py-2 text-sm font-black text-rose-100 hover:bg-rose-500/35 disabled:cursor-not-allowed"
        >
          -
        </button>
        <input
          type="text"
          inputMode="numeric"
          value={value}
          disabled={disabled}
          onMouseEnter={playHoverSound}
          onChange={(event) => {
            const digitsOnly = event.target.value.replace(/[^\d]/g, "");
            if (digitsOnly.length === 0) return;
            const parsed = Number(digitsOnly);
            if (!Number.isFinite(parsed)) return;
            onChange(clamp(Math.floor(parsed)));
          }}
          className="mx-2 w-full rounded-lg border border-violet-300/30 bg-violet-500/10 px-3 py-2 text-center font-[family-name:var(--font-jetbrains-mono)] text-sm font-bold text-violet-100 outline-none focus:border-violet-200/75 focus:ring-2 focus:ring-violet-300/30"
        />
        <button
          type="button"
          disabled={disabled}
          onMouseEnter={playHoverSound}
          onClick={() => onChange(clamp(value + step))}
          className="rounded-lg border border-emerald-300/45 bg-emerald-500/20 px-3 py-2 text-sm font-black text-emerald-100 hover:bg-emerald-500/35 disabled:cursor-not-allowed"
        >
          +
        </button>
      </div>
    </label>
  )
}
