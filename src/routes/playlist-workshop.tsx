import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { forwardRef, useEffect, useMemo, useRef, useState } from "react";
import * as z from "zod";
import { AnimatedBackground } from "../components/AnimatedBackground";
import { SfwGuard } from "../components/SfwGuard";
import { GameDropdown } from "../components/ui/GameDropdown";
import { PlaylistPackExportDialog } from "../components/PlaylistPackExportDialog";
import { MenuButton } from "../components/MenuButton";
import { PlaylistExportOverlay } from "../components/PlaylistExportOverlay";
import { PlaylistResolutionModal } from "../components/PlaylistResolutionModal";
import { RoundVideoOverlay } from "../components/game/RoundVideoOverlay";
import {
  CURRENT_PLAYLIST_VERSION,
  ZPlaylistConfig,
  type LinearBoardConfig,
} from "../game/playlistSchema";
import type { ActiveRound, PerkDefinition, PerkRarity } from "../game/types";
import {
  analyzePlaylistResolution,
  applyPlaylistResolutionMapping,
  type PlaylistResolutionAnalysis,
} from "../game/playlistResolution";
import {
  createDefaultPlaylistConfig,
  resolvePortableRoundRef,
  toPortableRoundRef,
} from "../game/playlistRuntime";
import { setMapEditorTestSession } from "../features/map-editor/testSession";
import { getSinglePlayerAntiPerkPool, getSinglePlayerPerkPool } from "../game/data/perks";
import { PERK_RARITY_META, resolvePerkRarity } from "../game/data/perkRarity";
import { useInstalledRoundMedia } from "../hooks/useInstalledRoundMedia";
import { usePlayableVideoFallback } from "../hooks/usePlayableVideoFallback";
import { useSfwMode } from "../hooks/useSfwMode";
import { db, type InstalledRound, type InstalledRoundCatalogEntry } from "../services/db";
import { getInstalledRoundCatalogCached } from "../services/installedRoundsCache";
import {
  playlists,
  type PlaylistExportPackageStatus,
  type StoredPlaylist,
} from "../services/playlists";
import { formatDurationLabel, getRoundDurationSec } from "../utils/duration";
import { playHoverSound, playSelectSound } from "../utils/audio";
import { abbreviateNsfwText } from "../utils/sfwText";
import { DEFAULT_INTERMEDIARY_LOADING_PROMPT } from "../constants/booruSettings";

type EditableLinearSetup = {
  roundCount: number;
  safePointsEnabled: boolean;
  safePointIndices: number[];
  saveMode: "none" | "checkpoint" | "everywhere";
  normalRoundOrder: string[];
  enabledCumRoundIds: string[];
  enabledPerkIds: string[];
  enabledAntiPerkIds: string[];
  perkTriggerChancePerRound: number;
  roundStartDelaySec: number;
  startingMoney: number;
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
  diceMin: number;
  diceMax: number;
};

const DEFAULT_SAFE_PRESET = [25, 50, 75];
const DEFAULT_INTERMEDIARY_LOADING_DURATION_SEC = 5;
const DEFAULT_INTERMEDIARY_RETURN_PAUSE_SEC = 4;
type NewPlaylistMode = "fully-random" | "progressive-random";
type NormalRoundSort = "selected-first" | "queue" | "name-asc" | "name-desc" | "author";
type DurationFilter = "any" | "short" | "medium" | "long" | "unknown";
type WorkshopInstalledRound = InstalledRound | InstalledRoundCatalogEntry;
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

const PlaylistWorkshopSearchSchema = z.object({
  open: z.enum(["active"]).optional(),
});

const WORKSHOP_SECTION_IDS = [
  "playlist",
  "session",
  "rounds",
  "cum-rounds",
  "perks",
  "timing",
] as const;
type WorkshopSectionId = (typeof WORKSHOP_SECTION_IDS)[number];

type WorkshopSection = {
  id: WorkshopSectionId;
  icon: string;
  title: string;
  description: string;
};

const WORKSHOP_SECTIONS: WorkshopSection[] = [
  {
    id: "playlist",
    icon: "📋",
    title: "Playlist",
    description: "Select, create, and manage playlists.",
  },
  {
    id: "session",
    icon: "🎯",
    title: "Session",
    description: "Round count, safe points, and board layout.",
  },
  { id: "rounds", icon: "🎬", title: "Rounds", description: "Select and reorder normal rounds." },
  {
    id: "cum-rounds",
    icon: "🏁",
    title: "Cum Rounds",
    description: "Choose which cum rounds are available.",
  },
  {
    id: "perks",
    icon: "⚡",
    title: "Perks & Anti-Perks",
    description: "Toggle individual perks and anti-perks.",
  },
  {
    id: "timing",
    icon: "⏱️",
    title: "Timing & Probabilities",
    description: "Round start delay and probability scaling.",
  },
];

const PERK_RARITY_ORDER: Record<PerkRarity, number> = {
  common: 0,
  rare: 1,
  epic: 2,
  legendary: 3,
};

const parseSafePointsInput = (raw: string): number[] =>
  [
    ...new Set(
      raw
        .split(",")
        .map((part) => Number(part.trim()))
        .filter((value) => Number.isFinite(value))
        .map((value) => Math.floor(value))
    ),
  ].sort((a, b) => a - b);

const formatSafePointsInput = (indices: number[]): string => indices.join(", ");

function toManualMappingRecord(
  overrides: Record<string, string | null | undefined>
): Record<string, string | null> {
  return Object.fromEntries(
    Object.entries(overrides).filter(([, value]) => value !== undefined)
  ) as Record<string, string | null>;
}

const withActivePlaylist = (
  playlistsToShow: StoredPlaylist[],
  activePlaylist: StoredPlaylist | null
): StoredPlaylist[] => {
  if (!activePlaylist) return playlistsToShow;
  if (playlistsToShow.some((playlist) => playlist.id === activePlaylist.id)) {
    return playlistsToShow;
  }
  return [activePlaylist, ...playlistsToShow];
};

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

function filterIndicesWithinTotal(indices: number[], totalIndices: number): number[] {
  const cappedTotal = Math.max(1, Math.min(500, Math.floor(totalIndices)));
  return indices.filter((value) => value >= 1 && value <= cappedTotal);
}

export function pruneLinearSetupToRoundCount(
  setup: EditableLinearSetup,
  nextRoundCount: number
): EditableLinearSetup {
  const cappedRoundCount = Math.max(1, Math.min(500, Math.floor(nextRoundCount)));
  const safePointIndices = filterIndicesWithinTotal(setup.safePointIndices, cappedRoundCount);
  const placement = getLinearQueuePlacement({
    totalIndices: cappedRoundCount,
    safePointIndices: setup.safePointsEnabled ? safePointIndices : [],
    normalRoundOrder: setup.normalRoundOrder,
  });

  return {
    ...setup,
    roundCount: cappedRoundCount,
    safePointIndices,
    normalRoundOrder: setup.normalRoundOrder.filter(
      (roundId) => placement[roundId]?.fieldIndex !== null
    ),
  };
}

function matchesDurationFilter(durationSec: number, filter: DurationFilter): boolean {
  if (filter === "any") return true;
  if (filter === "unknown") return durationSec <= 0;
  if (filter === "short") return durationSec > 0 && durationSec < 180;
  if (filter === "medium") return durationSec >= 180 && durationSec <= 600;
  return durationSec > 600;
}

function sortPerksByRarityAndName(perks: ReadonlyArray<PerkDefinition>): PerkDefinition[] {
  const collator = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });
  return [...perks].sort((a, b) => {
    const rarityDiff =
      PERK_RARITY_ORDER[resolvePerkRarity(a)] - PERK_RARITY_ORDER[resolvePerkRarity(b)];
    if (rarityDiff !== 0) return rarityDiff;
    return collator.compare(a.name, b.name);
  });
}

function shuffleRounds(rounds: WorkshopInstalledRound[]): WorkshopInstalledRound[] {
  const next = [...rounds];
  for (let i = next.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    const temp = next[i];
    next[i] = next[j]!;
    next[j] = temp!;
  }
  return next;
}

function buildProgressiveRandomOrder(rounds: WorkshopInstalledRound[]): WorkshopInstalledRound[] {
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
  const picked: WorkshopInstalledRound[] = [];

  while (pool.length > 0) {
    const progress = picked.length / Math.max(1, rounds.length - 1);
    const biasStrength = progress * 2.5;
    const weighted = pool.map((round) => {
      const diffNorm = normalize(round.difficulty ?? 1, minDifficulty, maxDifficulty);
      const durationNorm = normalize(getRoundDurationSec(round), minDuration, maxDuration);
      const score = diffNorm * 0.7 + durationNorm * 0.3;
      const jitter = Math.random() * 0.35;
      return {
        round,
        weight: Math.max(0.01, 0.2 + jitter + score * biasStrength),
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

const getInstalledRounds = async (): Promise<InstalledRoundCatalogEntry[]> => {
  try {
    return await getInstalledRoundCatalogCached();
  } catch (error) {
    console.error("Failed to fetch installed rounds", error);
    return [];
  }
};

function toEditableSetup(
  playlist: StoredPlaylist,
  installedRounds: Array<InstalledRound | InstalledRoundCatalogEntry>
): EditableLinearSetup {
  const config = playlist.config;

  if (config.boardConfig.mode !== "linear") {
    return {
      roundCount: 100,
      safePointsEnabled: true,
      safePointIndices: [...DEFAULT_SAFE_PRESET],
      saveMode: config.saveMode ?? "none",
      normalRoundOrder: [],
      enabledCumRoundIds: [],
      enabledPerkIds: [...config.perkPool.enabledPerkIds],
      enabledAntiPerkIds: [...config.perkPool.enabledAntiPerkIds],
      perkTriggerChancePerRound: config.perkSelection.triggerChancePerCompletedRound,
      roundStartDelaySec: Math.round((config.roundStartDelayMs ?? 20000) / 1000),
      startingMoney: config.economy.startingMoney,
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
      diceMin: config.dice?.min ?? 1,
      diceMax: config.dice?.max ?? 6,
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
    saveMode: config.saveMode ?? "none",
    normalRoundOrder,
    enabledCumRoundIds,
    enabledPerkIds: [...config.perkPool.enabledPerkIds],
    enabledAntiPerkIds: [...config.perkPool.enabledAntiPerkIds],
    perkTriggerChancePerRound: config.perkSelection.triggerChancePerCompletedRound,
    roundStartDelaySec: Math.round((config.roundStartDelayMs ?? 20000) / 1000),
    startingMoney: config.economy.startingMoney,
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
    diceMin: config.dice?.min ?? 1,
    diceMax: config.dice?.max ?? 6,
  };
}

function toLinearBoardConfig(
  setup: EditableLinearSetup,
  installedRounds: WorkshopInstalledRound[]
): LinearBoardConfig {
  const roundById = new Map(installedRounds.map((round) => [round.id, round]));

  const normalRoundOrder = setup.normalRoundOrder
    .map((id) => roundById.get(id))
    .filter((round): round is WorkshopInstalledRound => Boolean(round))
    .map(toPortableRoundRef);

  const cumRoundRefs = setup.enabledCumRoundIds
    .map((id) => roundById.get(id))
    .filter((round): round is WorkshopInstalledRound => Boolean(round))
    .map(toPortableRoundRef);

  return {
    mode: "linear",
    totalIndices: Math.max(1, Math.min(500, Math.floor(setup.roundCount))),
    safePointIndices: setup.safePointsEnabled
      ? filterIndicesWithinTotal(
          parseSafePointsInput(formatSafePointsInput(setup.safePointIndices)),
          setup.roundCount
        )
      : [],
    safePointRestMsByIndex: {},
    normalRoundRefsByIndex: {},
    normalRoundOrder,
    cumRoundRefs,
  };
}

function createEmptyEditableSetup(
  installedRounds: Array<InstalledRound | InstalledRoundCatalogEntry>
): EditableLinearSetup {
  return toEditableSetup(
    {
      id: "__empty__",
      name: "Empty",
      description: null,
      formatVersion: 1,
      installSourceKey: null,
      config: createDefaultPlaylistConfig(installedRounds),
      createdAt: new Date(0),
      updatedAt: new Date(0),
    },
    installedRounds
  );
}

export const Route = createFileRoute("/playlist-workshop")({
  validateSearch: (search) => PlaylistWorkshopSearchSchema.parse(search),
  loader: async () => {
    const [installedRounds, availablePlaylists] = await Promise.all([
      getInstalledRounds(),
      playlists.list(),
    ]);
    const activePlaylist = availablePlaylists.length > 0 ? await playlists.getActive() : null;
    return { installedRounds, availablePlaylists, activePlaylist };
  },
  component: PlaylistWorkshopPage,
});

function PlaylistWorkshopPage() {
  const sfwMode = useSfwMode();
  const navigate = useNavigate();
  const search = PlaylistWorkshopSearchSchema.parse(Route.useSearch());
  const goBack = () => {
    if (window.history.length > 1) {
      window.history.back();
      return;
    }
    void navigate({ to: "/" });
  };
  const {
    installedRounds,
    availablePlaylists,
    activePlaylist: loaderActivePlaylist,
  } = Route.useLoaderData() as {
    installedRounds: WorkshopInstalledRound[];
    availablePlaylists: StoredPlaylist[];
    activePlaylist: StoredPlaylist | null;
  };

  const [playlistList, setPlaylistList] = useState<StoredPlaylist[]>(
    withActivePlaylist(availablePlaylists, loaderActivePlaylist)
  );
  const [activePlaylistId, setActivePlaylistId] = useState(
    search.open === "active" ? (loaderActivePlaylist?.id ?? "") : ""
  );
  const [importNotice, setImportNotice] = useState<string | null>(null);
  const [savePending, setSavePending] = useState(false);
  const [exportStatus, setExportStatus] = useState<PlaylistExportPackageStatus | null>(null);
  const [showPackExportDialog, setShowPackExportDialog] = useState(false);
  const [showExportOverlay, setShowExportOverlay] = useState(false);
  const [isAbortingExport, setIsAbortingExport] = useState(false);
  const [graphRedirectFailedPlaylistId, setGraphRedirectFailedPlaylistId] = useState<string | null>(
    null
  );
  const [newPlaylistDialogOpen, setNewPlaylistDialogOpen] = useState(false);
  const [renameDialogOpen, setRenameDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deletePending, setDeletePending] = useState(false);
  const [playlistMenuOpen, setPlaylistMenuOpen] = useState(false);
  const [manageMenuOpen, setManageMenuOpen] = useState(false);
  const [transferMenuOpen, setTransferMenuOpen] = useState(false);
  const [normalRoundSearch, setNormalRoundSearch] = useState("");
  const [normalRoundSort, setNormalRoundSort] = useState<NormalRoundSort>("selected-first");
  const [normalRoundDurationFilter, setNormalRoundDurationFilter] = useState<DurationFilter>("any");
  const [activePreviewRound, setActivePreviewRound] = useState<InstalledRound | null>(null);
  const [previewInstalledRounds, setPreviewInstalledRounds] = useState<InstalledRound[] | null>(null);
  const [resolutionModalState, setResolutionModalState] = useState<ResolutionModalState | null>(
    null
  );
  const [importedPlaylistReview, setImportedPlaylistReview] =
    useState<ImportedPlaylistReview | null>(null);
  const playlistMenuRef = useRef<HTMLDivElement | null>(null);
  const manageMenuRef = useRef<HTMLDivElement | null>(null);
  const transferMenuRef = useRef<HTMLDivElement | null>(null);
  const graphRedirectPlaylistIdRef = useRef<string | null>(null);

  const activePlaylist = useMemo(
    () => playlistList.find((playlist) => playlist.id === activePlaylistId) ?? null,
    [activePlaylistId, playlistList]
  );

  const [setup, setSetup] = useState<EditableLinearSetup>(() =>
    activePlaylist
      ? toEditableSetup(activePlaylist, installedRounds)
      : createEmptyEditableSetup(installedRounds)
  );
  const [safePointsInput, setSafePointsInput] = useState<string>(
    formatSafePointsInput(setup.safePointIndices)
  );
  const [activeSectionId, setActiveSectionId] = useState<WorkshopSectionId>("playlist");

  useEffect(() => {
    const nextList = withActivePlaylist(availablePlaylists, loaderActivePlaylist);
    setPlaylistList(nextList);
    setActivePlaylistId((current) => {
      if (current && nextList.some((playlist) => playlist.id === current)) {
        return current;
      }
      return search.open === "active" ? (loaderActivePlaylist?.id ?? "") : "";
    });
  }, [availablePlaylists, loaderActivePlaylist, search.open]);

  useEffect(() => {
    if (!activePlaylist) return;
    const next = toEditableSetup(activePlaylist, installedRounds);
    setSetup(next);
    setSafePointsInput(formatSafePointsInput(next.safePointIndices));
  }, [activePlaylist, installedRounds]);

  useEffect(() => {
    if (!importNotice) return;
    const timer = setTimeout(() => setImportNotice(null), 3000);
    return () => clearTimeout(timer);
  }, [importNotice]);

  useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (playlistMenuRef.current && !playlistMenuRef.current.contains(target)) {
        setPlaylistMenuOpen(false);
      }
      if (manageMenuRef.current && !manageMenuRef.current.contains(target)) {
        setManageMenuOpen(false);
      }
      if (transferMenuRef.current && !transferMenuRef.current.contains(target)) {
        setTransferMenuOpen(false);
      }
    };
    window.addEventListener("mousedown", onPointerDown);
    return () => window.removeEventListener("mousedown", onPointerDown);
  }, []);

  useEffect(() => {
    let mounted = true;

    const pollExportStatus = async () => {
      try {
        const status = await playlists.getExportPackageStatus();
        if (!mounted) return;
        setExportStatus(status);
        if (status.state !== "running" && !savePending) {
          setShowExportOverlay(false);
          setIsAbortingExport(false);
        }
      } catch (error) {
        console.error("Failed to poll playlist export status", error);
      }
    };

    void pollExportStatus();
    const interval = window.setInterval(() => {
      void pollExportStatus();
    }, 500);

    return () => {
      mounted = false;
      window.clearInterval(interval);
    };
  }, [savePending]);

  const normalRounds = useMemo(
    () =>
      installedRounds.filter(
        (round: WorkshopInstalledRound) => (round.type ?? "Normal") === "Normal"
      ),
    [installedRounds]
  );
  const cumRounds = useMemo(
    () => installedRounds.filter((round: WorkshopInstalledRound) => round.type === "Cum"),
    [installedRounds]
  );
  const perks = useMemo(() => sortPerksByRarityAndName(getSinglePlayerPerkPool()), []);
  const antiPerks = useMemo(() => sortPerksByRarityAndName(getSinglePlayerAntiPerkPool()), []);

  const selectedNormalSet = useMemo(
    () => new Set(setup.normalRoundOrder),
    [setup.normalRoundOrder]
  );
  const selectedCumSet = useMemo(
    () => new Set(setup.enabledCumRoundIds),
    [setup.enabledCumRoundIds]
  );
  const selectedPerkSet = useMemo(() => new Set(setup.enabledPerkIds), [setup.enabledPerkIds]);
  const selectedAntiPerkSet = useMemo(
    () => new Set(setup.enabledAntiPerkIds),
    [setup.enabledAntiPerkIds]
  );
  const allPerkIds = useMemo(() => perks.map((perk) => perk.id), [perks]);
  const allAntiPerkIds = useMemo(() => antiPerks.map((perk) => perk.id), [antiPerks]);
  const normalRoundPlacement = useMemo(() => {
    const safePointIndices = setup.safePointsEnabled ? parseSafePointsInput(safePointsInput) : [];
    return getLinearQueuePlacement({
      totalIndices: setup.roundCount,
      safePointIndices,
      normalRoundOrder: setup.normalRoundOrder,
    });
  }, [safePointsInput, setup.normalRoundOrder, setup.roundCount, setup.safePointsEnabled]);
  const normalRoundOrderIndex = useMemo(
    () => new Map(setup.normalRoundOrder.map((roundId, index) => [roundId, index])),
    [setup.normalRoundOrder]
  );
  const visibleNormalRounds = useMemo(() => {
    const query = normalRoundSearch.trim().toLowerCase();
    const collator = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });

    const filtered =
      query.length === 0
        ? normalRounds
        : normalRounds.filter((round) =>
            `${round.name} ${round.author ?? ""}`.toLowerCase().includes(query)
          );
    const durationFiltered = filtered.filter((round) =>
      matchesDurationFilter(getRoundDurationSec(round), normalRoundDurationFilter)
    );

    const compareByName = (a: WorkshopInstalledRound, b: WorkshopInstalledRound) =>
      collator.compare(a.name, b.name);
    const compareByAuthor = (a: WorkshopInstalledRound, b: WorkshopInstalledRound) =>
      collator.compare(a.author ?? "Unknown Author", b.author ?? "Unknown Author") ||
      compareByName(a, b);

    return [...durationFiltered].sort((a, b) => {
      const aSelected = selectedNormalSet.has(a.id);
      const bSelected = selectedNormalSet.has(b.id);
      const aQueueIndex = normalRoundOrderIndex.get(a.id);
      const bQueueIndex = normalRoundOrderIndex.get(b.id);

      if (normalRoundSort === "selected-first") {
        if (aSelected !== bSelected) return aSelected ? -1 : 1;
        if (aSelected && bSelected) {
          return (
            (aQueueIndex ?? Number.MAX_SAFE_INTEGER) - (bQueueIndex ?? Number.MAX_SAFE_INTEGER) ||
            compareByName(a, b)
          );
        }
        return compareByName(a, b);
      }

      if (normalRoundSort === "queue") {
        const aHasQueue = typeof aQueueIndex === "number";
        const bHasQueue = typeof bQueueIndex === "number";
        if (aHasQueue !== bHasQueue) return aHasQueue ? -1 : 1;
        if (aHasQueue && bHasQueue) {
          return (
            (aQueueIndex ?? Number.MAX_SAFE_INTEGER) - (bQueueIndex ?? Number.MAX_SAFE_INTEGER) ||
            compareByName(a, b)
          );
        }
        return compareByName(a, b);
      }

      if (normalRoundSort === "name-desc") return compareByName(b, a);
      if (normalRoundSort === "author") return compareByAuthor(a, b);
      return compareByName(a, b);
    });
  }, [
    normalRoundDurationFilter,
    normalRoundOrderIndex,
    normalRoundSearch,
    normalRoundSort,
    normalRounds,
    selectedNormalSet,
  ]);
  const visibleSelectedNormalCount = useMemo(
    () => visibleNormalRounds.filter((round) => selectedNormalSet.has(round.id)).length,
    [selectedNormalSet, visibleNormalRounds]
  );
  const activePreview: ActiveRound | null = useMemo(
    () =>
      activePreviewRound
        ? {
            fieldId: "playlist-workshop-preview-field",
            nodeId: "playlist-workshop-preview-node",
            roundId: activePreviewRound.id,
            roundName: activePreviewRound.name,
            selectionKind: "fixed",
            poolId: null,
            phaseKind: "normal",
            campaignIndex: 1,
          }
        : null,
    [activePreviewRound]
  );
  const isLinearEditable = activePlaylist?.config.boardConfig.mode === "linear";
  const shouldAutoOpenActivePlaylist = search.open === "active";
  const shouldRedirectGraphPlaylist =
    Boolean(activePlaylist) &&
    shouldAutoOpenActivePlaylist &&
    !isLinearEditable &&
    graphRedirectFailedPlaylistId !== activePlaylist?.id;

  useEffect(() => {
    if (!activePlaylist || isLinearEditable) {
      graphRedirectPlaylistIdRef.current = null;
      return;
    }
    if (graphRedirectFailedPlaylistId === activePlaylist.id) {
      return;
    }
    if (graphRedirectPlaylistIdRef.current === activePlaylist.id) {
      return;
    }

    graphRedirectPlaylistIdRef.current = activePlaylist.id;

    void (async () => {
      try {
        await playlists.setActive(activePlaylist.id);
        setMapEditorTestSession(activePlaylist.id);
        await navigate({ to: "/map-editor" });
      } catch (error) {
        console.error("Failed to auto-open graph playlist in map editor", error);
        setGraphRedirectFailedPlaylistId(activePlaylist.id);
        setImportNotice(
          error instanceof Error ? error.message : "Failed to open advanced map editor."
        );
      } finally {
        if (graphRedirectPlaylistIdRef.current === activePlaylist.id) {
          graphRedirectPlaylistIdRef.current = null;
        }
      }
    })();
  }, [
    activePlaylist,
    graphRedirectFailedPlaylistId,
    isLinearEditable,
    navigate,
    shouldAutoOpenActivePlaylist,
  ]);

  const activePlaylistResolution = useMemo(
    () =>
      activePlaylist ? analyzePlaylistResolution(activePlaylist.config, installedRounds) : null,
    [activePlaylist, installedRounds]
  );
  const activeImportReview =
    activePlaylist && importedPlaylistReview?.playlistId === activePlaylist.id
      ? importedPlaylistReview
      : null;
  const activeResolutionReview =
    activePlaylistResolution && activePlaylistResolution.issues.length > 0
      ? activePlaylistResolution
      : (activeImportReview?.analysis ?? null);
  const activeResolutionActionLabel =
    activePlaylistResolution && activePlaylistResolution.issues.length > 0
      ? activePlaylistResolution.counts.missing > 0
        ? "Resolve Missing"
        : "Review Auto-Resolve"
      : activeImportReview
        ? "Review Auto-Resolve"
        : null;

  function buildNewPlaylistConfig(mode: NewPlaylistMode) {
    const base = createDefaultPlaylistConfig(installedRounds);
    const normalRounds = installedRounds.filter(
      (round: WorkshopInstalledRound) => (round.type ?? "Normal") === "Normal"
    );
    const ordered =
      mode === "fully-random"
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
  }

  async function refreshPlaylists() {
    const nextList = await playlists.list();
    const nextActive = nextList.length > 0 ? await playlists.getActive() : null;
    setPlaylistList(withActivePlaylist(nextList, nextActive));
    setActivePlaylistId((current) => {
      if (current && nextList.some((playlist) => playlist.id === current)) {
        return current;
      }
      return "";
    });
  }

  async function handleImportPlaylist() {
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
    setActivePlaylistId(imported.playlist.id);
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
        : "Playlist imported."
    );
  }

  if (playlistList.length === 0) {
    return (
      <div className="relative min-h-screen overflow-hidden">
        <AnimatedBackground />

        <div className="relative z-10 flex min-h-screen items-center justify-center px-4 py-8">
          <div className="w-full max-w-2xl rounded-3xl border border-violet-300/25 bg-zinc-950/80 p-6 shadow-2xl backdrop-blur-xl sm:p-8">
            <p className="font-[family-name:var(--font-jetbrains-mono)] text-[0.65rem] uppercase tracking-[0.32em] text-violet-200/70">
              Creation & Workshop
            </p>
            <h1 className="mt-3 text-3xl font-black tracking-tight text-white sm:text-4xl">
              Playlist Workshop
            </h1>
            <p className="mt-3 text-sm text-zinc-300 sm:text-base">
              No playlist exists yet. Create one here when you want to start editing.
            </p>

            {importNotice && (
              <div className="mt-4 rounded-xl border border-violet-300/30 bg-violet-500/10 px-4 py-3 text-sm text-violet-100">
                {importNotice}
              </div>
            )}

            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              <MenuButton
                label="Create Playlist"
                primary
                onHover={playHoverSound}
                onClick={() => {
                  playSelectSound();
                  setNewPlaylistDialogOpen(true);
                }}
              />
              <MenuButton
                label="Back"
                onHover={playHoverSound}
                onClick={() => {
                  playSelectSound();
                  goBack();
                }}
              />
            </div>
          </div>
        </div>

        {newPlaylistDialogOpen && (
          <NewPlaylistDialog
            onClose={() => setNewPlaylistDialogOpen(false)}
            onSubmit={async ({ name, mode }) => {
              try {
                const config = buildNewPlaylistConfig(mode);
                const created = await playlists.create({ name, config });
                await playlists.setActive(created.id);
                await refreshPlaylists();
                setActivePlaylistId(created.id);
                setNewPlaylistDialogOpen(false);
                setImportNotice("Playlist created.");
              } catch (error) {
                console.error("Failed to create playlist", error);
                setImportNotice("Failed to create playlist.");
                throw error;
              }
            }}
            onEmptyName={() => setImportNotice("Playlist name cannot be empty.")}
          />
        )}
      </div>
    );
  }

  if (!activePlaylist) {
    return (
      <div className="relative min-h-screen overflow-hidden">
        <AnimatedBackground />

        <div className="relative z-10 min-h-screen px-4 py-8 sm:px-8">
          <main className="mx-auto flex w-full max-w-5xl flex-col gap-6">
            <header className="rounded-3xl border border-violet-300/25 bg-zinc-950/80 p-6 shadow-2xl backdrop-blur-xl sm:p-8">
              <p className="font-[family-name:var(--font-jetbrains-mono)] text-[0.65rem] uppercase tracking-[0.32em] text-violet-200/70">
                Creation & Workshop
              </p>
              <h1 className="mt-3 text-3xl font-black tracking-tight text-white sm:text-4xl">
                Playlist Workshop
              </h1>
              <p className="mt-3 text-sm text-zinc-300 sm:text-base">
                Choose a playlist to edit, or create one from here.
              </p>

              {importNotice && (
                <div className="mt-4 rounded-xl border border-violet-300/30 bg-violet-500/10 px-4 py-3 text-sm text-violet-100">
                  {importNotice}
                </div>
              )}

              <div className="mt-6 grid gap-3 sm:grid-cols-2">
                <MenuButton
                  label="Create Playlist"
                  primary
                  onHover={playHoverSound}
                  onClick={() => {
                    playSelectSound();
                    setNewPlaylistDialogOpen(true);
                  }}
                />
                <MenuButton
                  label="Back"
                  onHover={playHoverSound}
                  onClick={() => {
                    playSelectSound();
                    goBack();
                  }}
                />
              </div>
            </header>

            <section className="rounded-3xl border border-violet-300/20 bg-zinc-950/70 p-5 shadow-2xl backdrop-blur-xl sm:p-6">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="font-[family-name:var(--font-jetbrains-mono)] text-[0.65rem] uppercase tracking-[0.28em] text-violet-200/70">
                    Select Playlist
                  </p>
                  <h2 className="mt-2 text-2xl font-black tracking-tight text-white">
                    Open A Playlist
                  </h2>
                </div>
                <span className="rounded-full border border-violet-300/35 bg-violet-500/10 px-3 py-1 text-xs uppercase tracking-[0.14em] text-violet-100">
                  {playlistList.length} Playlist{playlistList.length === 1 ? "" : "s"}
                </span>
              </div>

              <div className="mt-5 grid gap-3">
                {playlistList.map((playlist) => {
                  const isStoredActive = playlist.id === loaderActivePlaylist?.id;
                  const boardMode = playlist.config.boardConfig.mode === "graph" ? "Graph" : "Linear";
                  return (
                    <button
                      key={playlist.id}
                      type="button"
                      onMouseEnter={playHoverSound}
                      onClick={() => {
                        playSelectSound();
                        setActivePlaylistId(playlist.id);
                      }}
                      className="flex w-full items-center justify-between gap-4 rounded-2xl border border-violet-300/25 bg-gradient-to-br from-violet-500/12 to-slate-950/70 px-4 py-4 text-left transition-all duration-200 hover:border-violet-200/60 hover:bg-violet-500/18"
                    >
                      <div className="min-w-0">
                        <div className="truncate text-lg font-semibold text-white">{playlist.name}</div>
                        <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px] uppercase tracking-[0.16em] text-zinc-400">
                          <span>{boardMode} Playlist</span>
                          {isStoredActive && <span>Active</span>}
                        </div>
                      </div>
                      <span className="shrink-0 rounded-xl border border-violet-300/45 bg-violet-500/15 px-3 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-violet-100">
                        Open
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>
          </main>
        </div>

        {newPlaylistDialogOpen && (
          <NewPlaylistDialog
            onClose={() => setNewPlaylistDialogOpen(false)}
            onSubmit={async ({ name, mode }) => {
              try {
                const config = buildNewPlaylistConfig(mode);
                const created = await playlists.create({ name, config });
                await playlists.setActive(created.id);
                await refreshPlaylists();
                setActivePlaylistId(created.id);
                setNewPlaylistDialogOpen(false);
                setImportNotice("Playlist created.");
              } catch (error) {
                console.error("Failed to create playlist", error);
                setImportNotice("Failed to create playlist.");
                throw error;
              }
            }}
            onEmptyName={() => setImportNotice("Playlist name cannot be empty.")}
          />
        )}
      </div>
    );
  }

  if (shouldRedirectGraphPlaylist) {
    return (
      <div className="relative min-h-screen overflow-hidden">
        <AnimatedBackground />

        <div className="relative z-10 flex min-h-screen items-center justify-center px-4 py-8">
          <div className="w-full max-w-xl rounded-3xl border border-amber-300/25 bg-zinc-950/80 p-6 shadow-2xl backdrop-blur-xl sm:p-8">
            <p className="font-[family-name:var(--font-jetbrains-mono)] text-[0.65rem] uppercase tracking-[0.32em] text-amber-100/75">
              Redirecting
            </p>
            <h1 className="mt-3 text-3xl font-black tracking-tight text-white sm:text-4xl">
              Opening Graph Editor
            </h1>
            <p className="mt-3 text-sm text-zinc-300 sm:text-base">
              This playlist uses a graph board, so it opens in the Advanced Map Editor instead.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const handleAbortPlaylistExport = async () => {
    setIsAbortingExport(true);
    try {
      const status = await playlists.abortExportPackage();
      setExportStatus(status);
    } catch (error) {
      console.error("Failed to abort playlist export", error);
      setImportNotice(error instanceof Error ? error.message : "Failed to abort playlist export.");
      setIsAbortingExport(false);
    }
  };

  const openManageMenu = () => {
    setManageMenuOpen((prev) => !prev);
    setTransferMenuOpen(false);
  };

  const openTransferMenu = () => {
    setTransferMenuOpen((prev) => !prev);
    setManageMenuOpen(false);
  };

  const handleCreatePlaylist = async () => {
    playSelectSound();
    setNewPlaylistDialogOpen(true);
  };

  const handleDuplicatePlaylist = async () => {
    playSelectSound();
    const duplicated = await playlists.duplicate(activePlaylist.id);
    await playlists.setActive(duplicated.id);
    await refreshPlaylists();
  };

  const handleRenamePlaylist = async () => {
    playSelectSound();
    setRenameDialogOpen(true);
  };

  const handleDeletePlaylist = async () => {
    playSelectSound();
    setDeleteDialogOpen(true);
  };

  const handleExportFplay = async () => {
    playSelectSound();
    const filePath = await window.electronAPI.dialog.selectPlaylistExportPath(activePlaylist.name);
    if (!filePath) return;
    await playlists.exportToFile(activePlaylist.id, filePath);
    setImportNotice("Playlist exported.");
  };

  const handleExportPack = async () => {
    playSelectSound();
    setShowPackExportDialog(true);
  };

  const handleOpenAdvancedMapEditor = async () => {
    playSelectSound();
    try {
      await playlists.setActive(activePlaylist.id);
      setMapEditorTestSession(activePlaylist.id);
      await navigate({ to: "/map-editor" });
    } catch (error) {
      console.error("Failed to open advanced map editor from playlist workshop", error);
      setImportNotice(
        error instanceof Error ? error.message : "Failed to open advanced map editor."
      );
    }
  };

  const handleStartExportPack = async (input: {
    compressionMode: "copy" | "av1";
    compressionStrength: number;
    includeMedia: boolean;
    asFpack: boolean;
  }): Promise<boolean> => {
    const directoryPath = await window.electronAPI.dialog.selectPlaylistExportDirectory(
      activePlaylist.name
    );
    if (!directoryPath) return false;
    setShowExportOverlay(true);
    void (async () => {
      try {
        const result = await playlists.exportPackage({
          playlistId: activePlaylist.id,
          directoryPath,
          compressionMode: input.compressionMode,
          compressionStrength: input.compressionStrength,
          includeMedia: input.includeMedia,
          asFpack: input.asFpack,
        });
        setImportNotice(`Playlist pack exported to ${result.exportDir}.`);
      } catch (error) {
        console.error("Failed to export playlist pack", error);
        setImportNotice(error instanceof Error ? error.message : "Failed to export playlist pack.");
        setShowExportOverlay(false);
      }
    })();
    return true;
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
        installedRounds
      );

      const nextConfig = ZPlaylistConfig.parse({
        ...activePlaylist.config,
        playlistVersion: activePlaylist.config.playlistVersion ?? CURRENT_PLAYLIST_VERSION,
        boardConfig: linearBoardConfig,
        saveMode: setup.saveMode,
        roundStartDelayMs: Math.max(
          1000,
          Math.min(300000, Math.round(setup.roundStartDelaySec * 1000))
        ),
        dice: {
          min: Math.max(1, Math.min(20, Math.floor(setup.diceMin))),
          max: Math.max(1, Math.min(20, Math.floor(setup.diceMax))),
        },
        perkSelection: {
          optionsPerPick: activePlaylist.config.perkSelection.optionsPerPick,
          triggerChancePerCompletedRound: Math.max(0, Math.min(1, setup.perkTriggerChancePerRound)),
        },
        perkPool: {
          enabledPerkIds: [...setup.enabledPerkIds],
          enabledAntiPerkIds: [...setup.enabledAntiPerkIds],
        },
        probabilityScaling: {
          initialIntermediaryProbability: Math.max(
            0,
            Math.min(1, setup.probabilities.intermediary.initial)
          ),
          initialAntiPerkProbability: Math.max(
            0,
            Math.min(1, setup.probabilities.antiPerk.initial)
          ),
          intermediaryIncreasePerRound: Math.max(
            0,
            Math.min(1, setup.probabilities.intermediary.increasePerRound)
          ),
          antiPerkIncreasePerRound: Math.max(
            0,
            Math.min(1, setup.probabilities.antiPerk.increasePerRound)
          ),
          maxIntermediaryProbability: Math.max(
            0,
            Math.min(1, setup.probabilities.intermediary.max)
          ),
          maxAntiPerkProbability: Math.max(0, Math.min(1, setup.probabilities.antiPerk.max)),
        },
        economy: {
          ...activePlaylist.config.economy,
          startingMoney: Math.max(0, Math.floor(setup.startingMoney)),
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
    await navigate({
      to: "/game",
      search: {
        playlistId: activePlaylist.id,
        launchNonce: Date.now(),
      },
    });
  };

  const toggleNormalRound = (roundId: string) => {
    setSetup((prev) => {
      if (prev.normalRoundOrder.includes(roundId)) {
        return { ...prev, normalRoundOrder: prev.normalRoundOrder.filter((id) => id !== roundId) };
      }
      return { ...prev, normalRoundOrder: [...prev.normalRoundOrder, roundId] };
    });
  };

  const handlePlayRound = async (round: WorkshopInstalledRound) => {
    playSelectSound();
    try {
      const fullInstalledRounds = await db.round.findInstalled();
      const matchedRound = fullInstalledRounds.find((entry) => entry.id === round.id) ?? null;
      if (!matchedRound) {
        return;
      }
      setPreviewInstalledRounds(fullInstalledRounds);
      setActivePreviewRound(matchedRound);
    } catch (error) {
      console.error("Failed to load preview round media", error);
    }
  };

  const setVisibleNormalRoundsSelected = (nextSelected: boolean) => {
    setSetup((prev) => {
      const visibleIds = visibleNormalRounds.map((round) => round.id);
      const visibleSet = new Set(visibleIds);
      if (nextSelected) {
        const nextOrder = [...prev.normalRoundOrder];
        for (const roundId of visibleIds) {
          if (!nextOrder.includes(roundId)) {
            nextOrder.push(roundId);
          }
        }
        return { ...prev, normalRoundOrder: nextOrder };
      }

      return {
        ...prev,
        normalRoundOrder: prev.normalRoundOrder.filter((roundId) => !visibleSet.has(roundId)),
      };
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
        normalRounds.some((round) => round.id === roundId)
      );
      const sourceRounds =
        selectedRoundIds.length > 0
          ? selectedRoundIds
              .map((roundId) => normalRounds.find((round) => round.id === roundId))
              .filter((round): round is WorkshopInstalledRound => Boolean(round))
          : normalRounds;

      if (sourceRounds.length === 0) return prev;

      const orderedRounds =
        mode === "fully-random"
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
        return {
          ...prev,
          enabledCumRoundIds: prev.enabledCumRoundIds.filter((id) => id !== roundId),
        };
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
        return {
          ...prev,
          enabledAntiPerkIds: prev.enabledAntiPerkIds.filter((id) => id !== perkId),
        };
      }
      return { ...prev, enabledAntiPerkIds: [...prev.enabledAntiPerkIds, perkId] };
    });
  };

  const percent = (value: number) => Math.round(value * 100);
  const toRatio = (value: number) => Math.max(0, Math.min(100, Math.floor(value))) / 100;

  const activeSection =
    WORKSHOP_SECTIONS.find((section) => section.id === activeSectionId) ?? WORKSHOP_SECTIONS[0];

  return (
    <div className="relative min-h-screen overflow-hidden">
      <AnimatedBackground />

      <div className="relative z-10 flex h-screen flex-col overflow-hidden lg:flex-row">
        {/* ── Sidebar ── */}
        <nav className="animate-entrance flex shrink-0 flex-row gap-1 overflow-x-auto border-b border-purple-400/20 bg-zinc-950/70 px-3 py-2 backdrop-blur-xl lg:w-60 lg:flex-col lg:gap-0.5 lg:overflow-x-visible lg:overflow-y-auto lg:border-b-0 lg:border-r lg:px-3 lg:py-6">
          {/* Title — only visible on lg+ */}
          <div className="hidden lg:block lg:mb-5 lg:px-3">
            <p className="font-[family-name:var(--font-jetbrains-mono)] text-[0.6rem] uppercase tracking-[0.45em] text-purple-200/70">
              Creation & Workshop
            </p>
            <h1 className="mt-1.5 text-xl font-black tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-violet-200 via-purple-100 to-indigo-200 drop-shadow-[0_0_20px_rgba(139,92,246,0.45)]">
              Playlist Workshop
            </h1>
          </div>

          {WORKSHOP_SECTIONS.map((section) => {
            const active = section.id === activeSectionId;
            return (
              <button
                key={section.id}
                type="button"
                onMouseEnter={playHoverSound}
                onFocus={playHoverSound}
                onClick={() => {
                  playSelectSound();
                  setActiveSectionId(section.id);
                }}
                className={`settings-sidebar-item whitespace-nowrap ${active ? "is-active" : ""}`}
              >
                <span className="settings-sidebar-icon">{section.icon}</span>
                <span>{abbreviateNsfwText(section.title, sfwMode)}</span>
              </button>
            );
          })}

          {/* Sidebar footer actions */}
          <div className="hidden lg:mt-auto lg:flex lg:flex-col lg:gap-2 lg:px-1 lg:pt-4">
            {isLinearEditable ? (
              <>
                <MenuButton
                  label={savePending ? "Saving..." : "💾 Save"}
                  onHover={playHoverSound}
                  onClick={() => {
                    playSelectSound();
                    void saveLinearPlaylist();
                  }}
                />
                <MenuButton
                  label={savePending ? "Saving..." : "Test"}
                  primary
                  onHover={playHoverSound}
                  onClick={() => {
                    playSelectSound();
                    void saveAndTestPlaylist();
                  }}
                />
              </>
            ) : (
              <MenuButton
                label="Open Advanced Map Editor"
                primary
                onHover={playHoverSound}
                onClick={() => {
                  void handleOpenAdvancedMapEditor();
                }}
              />
            )}
            <MenuButton
              label="← Back"
              onHover={playHoverSound}
              onClick={() => {
                playSelectSound();
                goBack();
              }}
            />
          </div>
        </nav>

        {/* ── Content area ── */}
        <div className="flex-1 overflow-y-auto px-4 py-6 sm:px-8 lg:px-10 lg:py-8">
          <main className="parallax-ui-none mx-auto flex w-full max-w-4xl flex-col gap-5">
            {/* Section header */}
            {activeSection && (
              <header className="settings-panel-enter mb-1" key={`header-${activeSection.id}`}>
                <h2 className="text-2xl font-black tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-violet-200 via-purple-100 to-indigo-200 drop-shadow-[0_0_20px_rgba(139,92,246,0.4)] sm:text-3xl">
                  {abbreviateNsfwText(activeSection.title, sfwMode)}
                </h2>
                <p className="mt-1.5 text-sm text-zinc-400">
                  {abbreviateNsfwText(activeSection.description, sfwMode)}
                </p>
              </header>
            )}

            {/* Section content */}
            <div
              className="settings-panel-enter flex flex-col gap-5"
              key={`content-${activeSectionId}`}
            >
              {/* ── Playlist section ── */}
              {activeSectionId === "playlist" && (
                <>
                  <div
                    className={`relative rounded-2xl border border-purple-400/25 bg-zinc-950/55 p-5 backdrop-blur-xl ${playlistMenuOpen || manageMenuOpen || transferMenuOpen ? "z-20" : "z-0"}`}
                  >
                    <div className="space-y-4">
                      <div ref={playlistMenuRef} className="relative">
                        <button
                          type="button"
                          onMouseEnter={playHoverSound}
                          onClick={() => {
                            playSelectSound();
                            setPlaylistMenuOpen((prev) => !prev);
                            setManageMenuOpen(false);
                            setTransferMenuOpen(false);
                          }}
                          className="w-full rounded-2xl border border-violet-300/50 bg-gradient-to-b from-violet-500/25 to-indigo-500/20 px-4 py-3 text-left text-zinc-100 shadow-[0_0_24px_rgba(139,92,246,0.25)]"
                        >
                          <div className="flex items-start justify-between gap-4">
                            <div>
                              <div className="text-[10px] uppercase tracking-[0.2em] text-violet-200/80">
                                Active Playlist
                              </div>
                              <div className="mt-2 truncate text-lg font-semibold">
                                {activePlaylist.name}
                              </div>
                            </div>
                            <span
                              className={`mt-5 text-xs text-violet-200 transition-transform ${playlistMenuOpen ? "rotate-180" : ""}`}
                            >
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
                                  className={`mb-1 w-full rounded-lg border px-3 py-2 text-left text-sm last:mb-0 ${
                                    selected
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

                      <div className="flex flex-wrap items-center gap-2 text-xs uppercase tracking-[0.12em] text-zinc-300">
                        <span className="rounded-full border border-violet-300/35 bg-violet-500/10 px-3 py-1">
                          Playlist Version {activePlaylist.config.playlistVersion}
                        </span>
                        <span
                          className={`rounded-full border px-3 py-1 ${
                            isLinearEditable
                              ? "border-emerald-300/35 bg-emerald-500/10 text-emerald-100"
                              : "border-rose-300/35 bg-rose-500/10 text-rose-100"
                          }`}
                        >
                          {isLinearEditable ? "Linear Board" : "Graph Board"}
                        </span>
                        <ActionMenu
                          ref={manageMenuRef}
                          label="Manage"
                          open={manageMenuOpen}
                          onToggle={openManageMenu}
                          items={[
                            { label: "New Playlist", onClick: handleCreatePlaylist },
                            { label: "Duplicate", onClick: handleDuplicatePlaylist },
                            { label: "Rename", onClick: handleRenamePlaylist },
                            { label: "Delete", onClick: handleDeletePlaylist, tone: "danger" },
                          ]}
                        />
                        <ActionMenu
                          ref={transferMenuRef}
                          label="Transfer"
                          open={transferMenuOpen}
                          onToggle={openTransferMenu}
                          items={[
                            { label: "Import", onClick: handleImportPlaylist },
                            { label: "Export .fplay", onClick: handleExportFplay },
                          ]}
                        />
                      </div>
                    </div>
                  </div>

                  <div className="rounded-2xl border border-purple-400/25 bg-zinc-950/55 p-5 backdrop-blur-xl">
                    <h3 className="mb-4 text-sm font-semibold uppercase tracking-[0.14em] text-violet-200">
                      Actions
                    </h3>
                    {!isLinearEditable && (
                      <div className="rounded-[1.75rem] border border-amber-300/35 bg-[radial-gradient(circle_at_top_left,rgba(251,191,36,0.22),transparent_42%),linear-gradient(135deg,rgba(69,26,3,0.95),rgba(24,24,27,0.96))] p-5 shadow-[0_0_30px_rgba(251,191,36,0.12)]">
                        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                          <div className="max-w-2xl">
                            <p className="font-[family-name:var(--font-jetbrains-mono)] text-[10px] uppercase tracking-[0.24em] text-amber-100/85">
                              Graph Playlist
                            </p>
                            <h4 className="mt-2 text-xl font-black tracking-tight text-white">
                              Use the Advanced Map Editor
                            </h4>
                            <p className="mt-2 text-sm leading-6 text-amber-50/90">
                              This playlist uses a graph board, so Playlist Workshop cannot edit its
                              layout. Open the Advanced Map Editor to change nodes, paths, and graph
                              flow.
                            </p>
                          </div>
                          <button
                            type="button"
                            onMouseEnter={playHoverSound}
                            onClick={() => {
                              void handleOpenAdvancedMapEditor();
                            }}
                            className="inline-flex min-h-12 items-center justify-center rounded-2xl border border-amber-100/70 bg-amber-300/18 px-5 py-3 font-[family-name:var(--font-jetbrains-mono)] text-sm font-semibold uppercase tracking-[0.2em] text-amber-50 transition-all duration-200 hover:border-white hover:bg-amber-300/28 hover:text-white"
                          >
                            Open Advanced Map Editor
                          </button>
                        </div>
                      </div>
                    )}
                    <div className="mt-4 rounded-[1.75rem] border border-cyan-300/30 bg-[radial-gradient(circle_at_top_left,rgba(34,211,238,0.18),transparent_42%),linear-gradient(135deg,rgba(8,47,73,0.92),rgba(15,23,42,0.95))] p-5 shadow-[0_0_30px_rgba(34,211,238,0.12)]">
                      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                        <div className="max-w-2xl">
                          <p className="font-[family-name:var(--font-jetbrains-mono)] text-[10px] uppercase tracking-[0.24em] text-cyan-100/85">
                            Shareable Pack
                          </p>
                          <h4 className="mt-2 text-xl font-black tracking-tight text-white">
                            Export Pack
                          </h4>
                          <p className="mt-2 text-sm leading-6 text-slate-200/90">
                            Bundle this playlist with its media into a shareable folder and choose
                            compression before exporting.
                          </p>
                        </div>
                        <button
                          type="button"
                          onMouseEnter={playHoverSound}
                          onClick={() => {
                            void handleExportPack();
                          }}
                          className="inline-flex min-h-12 items-center justify-center rounded-2xl border border-cyan-100/70 bg-cyan-300/18 px-5 py-3 font-[family-name:var(--font-jetbrains-mono)] text-sm font-semibold uppercase tracking-[0.2em] text-cyan-50 transition-all duration-200 hover:border-white hover:bg-cyan-300/28 hover:text-white"
                        >
                          Export Pack
                        </button>
                      </div>
                    </div>
                    {activeResolutionActionLabel && activeResolutionReview && (
                      <div className="mt-3 flex flex-wrap gap-3">
                        <HeaderAction
                          label={activeResolutionActionLabel}
                          onClick={async () => {
                            playSelectSound();
                            setResolutionModalState({
                              context: "playlist",
                              title: `Resolve ${activePlaylist.name}`,
                              analysis: activeResolutionReview,
                            });
                          }}
                        />
                      </div>
                    )}
                    <div className="mt-4 grid gap-2 sm:grid-cols-2">
                      <MenuButton
                        label={savePending ? "Saving..." : "Save Without Test"}
                        onHover={playHoverSound}
                        onClick={() => {
                          playSelectSound();
                          void saveLinearPlaylist();
                        }}
                        disabled={!isLinearEditable}
                      />
                      <MenuButton
                        label={savePending ? "Saving..." : "Save and Test"}
                        primary
                        onHover={playHoverSound}
                        onClick={() => {
                          playSelectSound();
                          void saveAndTestPlaylist();
                        }}
                        disabled={!isLinearEditable}
                      />
                    </div>
                  </div>

                  {importNotice && (
                    <p className="rounded-xl border border-amber-300/25 bg-amber-500/10 px-4 py-2.5 text-sm text-amber-200">
                      {importNotice}
                    </p>
                  )}
                  {activeResolutionActionLabel && activeResolutionReview && (
                    <p className="rounded-xl border border-cyan-300/25 bg-cyan-500/10 px-4 py-2.5 text-sm text-cyan-200">
                      {activeResolutionReview.counts.missing > 0
                        ? `${activeResolutionReview.counts.missing} playlist refs still need a manual match.`
                        : `${activeResolutionReview.counts.suggested} refs were auto-resolved and can be reviewed.`}
                    </p>
                  )}
                  {!isLinearEditable && (
                    <p className="rounded-xl border border-rose-300/25 bg-rose-500/10 px-4 py-2.5 text-sm text-rose-200">
                      This playlist uses graph board mode. Playlist Workshop only supports linear
                      playlists. Open the Advanced Map Editor to edit this board.
                    </p>
                  )}
                </>
              )}

              {/* ── Session section ── */}
              {activeSectionId === "session" && (
                <div className="rounded-2xl border border-purple-400/25 bg-zinc-950/55 p-5 backdrop-blur-xl">
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                    <NumberInput
                      label="Round Count"
                      value={setup.roundCount}
                      min={1}
                      max={500}
                      disabled={!isLinearEditable}
                      onChange={(value) =>
                        setSetup((prev) => {
                          const nextSetup = pruneLinearSetupToRoundCount(prev, value);
                          setSafePointsInput(formatSafePointsInput(nextSetup.safePointIndices));
                          return nextSetup;
                        })
                      }
                    />

                    <label className="block">
                      <span className="mb-2 block text-xs uppercase tracking-[0.2em] text-zinc-300">
                        Safe Points
                      </span>
                      <button
                        type="button"
                        disabled={!isLinearEditable}
                        onMouseEnter={playHoverSound}
                        onClick={() => {
                          playSelectSound();
                          setSetup((prev) => ({
                            ...prev,
                            safePointsEnabled: !prev.safePointsEnabled,
                          }));
                        }}
                        className={`w-full rounded-xl border px-4 py-3 text-sm font-semibold ${
                          setup.safePointsEnabled
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
                          setSetup((prev) => ({
                            ...prev,
                            safePointsEnabled: true,
                            safePointIndices: [...DEFAULT_SAFE_PRESET],
                          }));
                          setSafePointsInput(formatSafePointsInput(DEFAULT_SAFE_PRESET));
                        }}
                        className="w-full rounded-xl border border-violet-300/60 bg-violet-500/25 px-4 py-3 text-sm font-semibold text-violet-100 hover:bg-violet-500/35"
                      >
                        Apply 25/50/75 Preset
                      </button>
                    </div>
                  </div>

                  <label className="mt-4 block">
                    <span className="mb-2 block text-xs uppercase tracking-[0.2em] text-zinc-300">
                      Safe Point Indices (comma-separated)
                    </span>
                    <input
                      type="text"
                      value={safePointsInput}
                      disabled={!isLinearEditable || !setup.safePointsEnabled}
                      onChange={(event) => setSafePointsInput(event.target.value)}
                      onBlur={() =>
                        setSafePointsInput((current) =>
                          formatSafePointsInput(parseSafePointsInput(current))
                        )
                      }
                      onMouseEnter={playHoverSound}
                      className="w-full rounded-xl border border-purple-300/30 bg-black/45 px-4 py-3 text-sm text-zinc-100 outline-none disabled:opacity-50 focus:border-purple-300/75 focus:ring-2 focus:ring-purple-400/30"
                      placeholder="25, 50, 75"
                    />
                  </label>

                  <div className="mt-4">
                    <span className="mb-2 block text-xs uppercase tracking-[0.2em] text-zinc-300">
                      Save Mode
                    </span>
                    <div className="grid gap-2 sm:grid-cols-3">
                      {[
                        { value: "none" as const, label: "No Saves" },
                        { value: "checkpoint" as const, label: "Only Checkpoint" },
                        { value: "everywhere" as const, label: "Everywhere" },
                      ].map((option) => (
                        <button
                          key={option.value}
                          type="button"
                          disabled={!isLinearEditable}
                          onMouseEnter={playHoverSound}
                          onClick={() => {
                            playSelectSound();
                            setSetup((prev) => ({ ...prev, saveMode: option.value }));
                          }}
                          className={`rounded-xl border px-4 py-3 text-sm font-semibold ${
                            setup.saveMode === option.value
                              ? "border-cyan-300/60 bg-cyan-500/20 text-cyan-100"
                              : "border-zinc-600 bg-zinc-800 text-zinc-300"
                          }`}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                    {setup.saveMode !== "none" && (
                      <p className="mt-3 rounded-xl border border-amber-300/25 bg-amber-500/10 px-4 py-2.5 text-sm text-amber-200">
                        {setup.saveMode === "checkpoint" ? "🚩" : "💾"} Warning: runs from this
                        playlist are marked as assisted on the highscore and in run history.
                      </p>
                    )}
                  </div>
                </div>
              )}

              {/* ── Rounds section ── */}
              {activeSectionId === "rounds" && (
                <div className="rounded-2xl border border-purple-400/25 bg-zinc-950/55 p-5 backdrop-blur-xl">
                  <p className="text-sm text-zinc-300">
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
                  <div className="mt-4 grid gap-3 md:grid-cols-2 md:items-end xl:grid-cols-[minmax(260px,1fr)_220px_220px]">
                    <label className="block">
                      <span className="mb-2 block text-xs uppercase tracking-[0.2em] text-zinc-300">
                        Search
                      </span>
                      <input
                        type="text"
                        value={normalRoundSearch}
                        onChange={(event) => setNormalRoundSearch(event.target.value)}
                        onMouseEnter={playHoverSound}
                        className="w-full rounded-xl border border-purple-300/30 bg-black/45 px-4 py-2.5 text-sm text-zinc-100 outline-none focus:border-purple-300/75 focus:ring-2 focus:ring-purple-400/30"
                        placeholder="Search by round or author"
                      />
                    </label>
                    <div className="block">
                      <span className="mb-2 block text-xs uppercase tracking-[0.2em] text-zinc-300">
                        Sort
                      </span>
                      <GameDropdown
                        value={normalRoundSort}
                        options={[
                          { value: "selected-first", label: "Selected first" },
                          { value: "queue", label: "Queue position" },
                          { value: "name-asc", label: "Name (A-Z)" },
                          { value: "name-desc", label: "Name (Z-A)" },
                          { value: "author", label: "Author" },
                        ]}
                        onChange={(value) => setNormalRoundSort(value as NormalRoundSort)}
                        onHoverSfx={playHoverSound}
                      />
                    </div>
                    <div className="block">
                      <span className="mb-2 block text-xs uppercase tracking-[0.2em] text-zinc-300">
                        Duration
                      </span>
                      <GameDropdown
                        value={normalRoundDurationFilter}
                        options={[
                          { value: "any", label: "Any duration" },
                          { value: "short", label: "Short under 3 min" },
                          { value: "medium", label: "Medium 3-10 min" },
                          { value: "long", label: "Long over 10 min" },
                          { value: "unknown", label: "Unknown duration" },
                        ]}
                        onChange={(value) => setNormalRoundDurationFilter(value as DurationFilter)}
                        onHoverSfx={playHoverSound}
                      />
                    </div>
                    <label className="block">
                      <span className="mb-2 block text-xs uppercase tracking-[0.2em] text-zinc-300">
                        Duration
                      </span>
                      <GameDropdown
                        value={normalRoundDurationFilter}
                        options={[
                          { value: "any", label: "Any duration" },
                          { value: "short", label: "Short under 3 min" },
                          { value: "medium", label: "Medium 3-10 min" },
                          { value: "long", label: "Long over 10 min" },
                          { value: "unknown", label: "Unknown duration" },
                        ]}
                        onChange={(value) => setNormalRoundDurationFilter(value as DurationFilter)}
                        onHoverSfx={playHoverSound}
                      />
                    </label>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
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
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={!isLinearEditable || visibleNormalRounds.length === 0}
                        onMouseEnter={playHoverSound}
                        onClick={() => {
                          playSelectSound();
                          setVisibleNormalRoundsSelected(true);
                        }}
                        className="rounded-lg border border-emerald-300/45 bg-emerald-500/20 px-3 py-1 text-xs font-semibold uppercase tracking-[0.12em] text-emerald-100 hover:bg-emerald-500/35 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        Select visible
                      </button>
                      <button
                        type="button"
                        disabled={!isLinearEditable || visibleSelectedNormalCount === 0}
                        onMouseEnter={playHoverSound}
                        onClick={() => {
                          playSelectSound();
                          setVisibleNormalRoundsSelected(false);
                        }}
                        className="rounded-lg border border-zinc-600 bg-zinc-800/70 px-3 py-1 text-xs font-semibold uppercase tracking-[0.12em] text-zinc-200 hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        Deselect visible
                      </button>
                    </div>
                  </div>
                  <div className="mt-4 grid max-h-[60vh] gap-2 overflow-y-auto pr-1">
                    {visibleNormalRounds.map((round: WorkshopInstalledRound) => {
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
                            <div className="flex min-w-0 flex-1 flex-col gap-3 sm:flex-row sm:items-start">
                              <WorkshopRoundPreview round={round} onOpenPreview={handlePlayRound} />
                              <div className="flex min-w-0 flex-1 items-start gap-3">
                                <button
                                  type="button"
                                  disabled={!isLinearEditable}
                                  onMouseEnter={playHoverSound}
                                  onClick={() => {
                                    playSelectSound();
                                    toggleNormalRound(round.id);
                                  }}
                                  className={`rounded-md border px-3 py-1 text-xs font-semibold uppercase tracking-[0.15em] ${
                                    selected
                                      ? "border-emerald-300/60 bg-emerald-500/20 text-emerald-100"
                                      : "border-zinc-600 bg-zinc-800 text-zinc-300"
                                  }`}
                                >
                                  {selected ? "Selected" : "Select"}
                                </button>
                                <div className="min-w-0 flex-1">
                                  <div className="truncate text-sm font-semibold text-zinc-100">
                                    {round.name}
                                  </div>
                                  <div className="text-xs text-zinc-400">
                                    {round.author ?? "Unknown Author"}
                                  </div>
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
                            </div>
                            {selected && (
                              <div className="flex flex-wrap items-center gap-2 xl:justify-end">
                                <span className="rounded-full border border-violet-300/45 bg-violet-500/20 px-3 py-1 text-xs text-violet-100">
                                  Q#{placement?.queuePosition ?? "?"}
                                  {placement?.fieldIndex
                                    ? ` -> F${placement.fieldIndex}`
                                    : " -> Unplaced"}
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
                        {normalRounds.length === 0
                          ? "No normal rounds installed."
                          : "No rounds match your search."}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* ── Cum Rounds section ── */}
              {activeSectionId === "cum-rounds" && (
                <div className="rounded-2xl border border-purple-400/25 bg-zinc-950/55 p-5 backdrop-blur-xl">
                  <div className="mb-4 rounded-xl border border-purple-300/20 bg-purple-500/10 px-4 py-3 text-sm text-purple-50">
                    <p className="font-semibold uppercase tracking-[0.14em] text-purple-200">
                      {abbreviateNsfwText("How cum rounds work", sfwMode)}
                    </p>
                    <p className="mt-2 text-purple-50/90">
                      {abbreviateNsfwText(
                        "Cum rounds play after the main playlist reaches the end. The rounds you enable here become a random selection pool, and one of them will be chosen when the run finishes.",
                        sfwMode
                      )}
                    </p>
                    <p className="mt-2 text-purple-50/90">
                      {abbreviateNsfwText(
                        "If you leave this list empty, the game falls back to a random installed cum round instead of ending without one.",
                        sfwMode
                      )}
                    </p>
                  </div>
                  <div className="grid gap-2">
                    {cumRounds.map((round: WorkshopInstalledRound) => {
                      const selected = selectedCumSet.has(round.id);
                      const durationSec = getRoundDurationSec(round);
                      return (
                        <div
                          key={round.id}
                          className={`rounded-2xl border px-3 py-3 ${
                            selected
                              ? "border-emerald-300/60 bg-emerald-500/12 text-emerald-100"
                              : "border-zinc-600 bg-black/35 text-zinc-200"
                          }`}
                        >
                          <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
                            <div className="flex min-w-0 flex-1 flex-col gap-3 sm:flex-row sm:items-start">
                              <WorkshopRoundPreview round={round} onOpenPreview={handlePlayRound} />
                              <div className="min-w-0 flex-1">
                                <div className="truncate text-sm font-semibold text-zinc-100">
                                  {round.name}
                                </div>
                                <div className="text-xs text-zinc-400">
                                  {round.author ?? "Unknown Author"}
                                </div>
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
                            <button
                              type="button"
                              disabled={!isLinearEditable}
                              onMouseEnter={playHoverSound}
                              onClick={() => {
                                playSelectSound();
                                toggleCumRound(round.id);
                              }}
                              className={`rounded-md border px-3 py-1 text-xs font-semibold uppercase tracking-[0.15em] ${
                                selected
                                  ? "border-emerald-300/60 bg-emerald-500/20 text-emerald-100"
                                  : "border-zinc-600 bg-zinc-800 text-zinc-300"
                              }`}
                            >
                              {selected ? "Enabled" : "Disabled"}
                            </button>
                          </div>
                        </div>
                      );
                    })}
                    {cumRounds.length === 0 && (
                      <div className="rounded-xl border border-zinc-700 bg-black/30 px-3 py-2 text-sm text-zinc-400">
                        {abbreviateNsfwText("No cum rounds installed.", sfwMode)}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* ── Perks & Anti-Perks section ── */}
              {activeSectionId === "perks" && (
                <>
                  <div className="rounded-2xl border border-cyan-300/25 bg-cyan-500/10 p-4 text-sm text-cyan-50">
                    <p className="font-semibold uppercase tracking-[0.16em] text-cyan-200">
                      How the system works
                    </p>
                    <p className="mt-2 text-cyan-50/90">
                      Perks are beneficial choices offered between completed rounds. Anti-perks are
                      harmful effects that can enter the same choice pool when enabled and can also
                      stay active across multiple rounds.
                    </p>
                    <p className="mt-2 text-cyan-50/80">
                      Trigger chance controls how often a perk choice appears. In singleplayer, the
                      computer can also randomly hit you with one of the enabled anti-perks based on
                      the anti-perk chance settings. The enabled lists below define what can show up
                      during a run.
                    </p>
                  </div>
                  <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
                    <div className="rounded-2xl border border-purple-400/25 bg-zinc-950/55 p-5 backdrop-blur-xl">
                      <div className="mb-2 space-y-2">
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
                              className={`w-full rounded-lg border px-3 py-2 text-left text-sm transition-all ${
                                selected
                                  ? `${rarityMeta.tailwind.setupSelected} ring-2 ring-emerald-300/65 shadow-[0_0_20px_rgba(16,185,129,0.25)]`
                                  : `${rarityMeta.tailwind.setupIdle} border-dashed opacity-70`
                              }`}
                            >
                              <div className="flex items-center justify-between gap-2">
                                <span className="flex items-center gap-2">
                                  <span
                                    className={`text-xs ${selected ? "text-emerald-300" : "text-zinc-500"}`}
                                  >
                                    {selected ? "●" : "○"}
                                  </span>
                                  <span>{perk.name}</span>
                                  {perk.requiresHandy && (
                                    <span className="rounded border border-amber-500/40 bg-amber-500/15 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-[0.06em] text-amber-200/90">
                                      Device
                                    </span>
                                  )}
                                </span>
                                <span className="flex items-center gap-1.5">
                                  <span
                                    className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] ${
                                      selected
                                        ? "border-emerald-300/65 bg-emerald-500/25 text-emerald-50"
                                        : "border-zinc-600 bg-zinc-800/85 text-zinc-300"
                                    }`}
                                  >
                                    {selected ? "Active" : "Inactive"}
                                  </span>
                                  <span
                                    className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] ${rarityMeta.tailwind.badge}`}
                                  >
                                    {rarityMeta.label}
                                  </span>
                                </span>
                              </div>
                              <p
                                className={`mt-2 text-xs leading-5 ${selected ? "text-emerald-50/90" : "text-zinc-300"}`}
                              >
                                {perk.description}
                              </p>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                    <div className="rounded-2xl border border-purple-400/25 bg-zinc-950/55 p-5 backdrop-blur-xl">
                      <div className="mb-2 space-y-2">
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
                              setSetup((prev) => ({
                                ...prev,
                                enabledAntiPerkIds: [...allAntiPerkIds],
                              }));
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
                              className={`w-full rounded-lg border px-3 py-2 text-left text-sm transition-all ${
                                selected
                                  ? `${rarityMeta.tailwind.setupSelected} ring-2 ring-rose-300/65 shadow-[0_0_20px_rgba(251,113,133,0.25)]`
                                  : `${rarityMeta.tailwind.setupIdle} border-dashed opacity-70`
                              }`}
                            >
                              <div className="flex items-center justify-between gap-2">
                                <span className="flex items-center gap-2">
                                  <span
                                    className={`text-xs ${selected ? "text-rose-300" : "text-zinc-500"}`}
                                  >
                                    {selected ? "●" : "○"}
                                  </span>
                                  <span>{perk.name}</span>
                                  {perk.requiresHandy && (
                                    <span className="rounded border border-amber-500/40 bg-amber-500/15 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-[0.06em] text-amber-200/90">
                                      Device
                                    </span>
                                  )}
                                </span>
                                <span className="flex items-center gap-1.5">
                                  <span
                                    className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] ${
                                      selected
                                        ? "border-rose-300/65 bg-rose-500/25 text-rose-50"
                                        : "border-zinc-600 bg-zinc-800/85 text-zinc-300"
                                    }`}
                                  >
                                    {selected ? "Active" : "Inactive"}
                                  </span>
                                  <span
                                    className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] ${rarityMeta.tailwind.badge}`}
                                  >
                                    {rarityMeta.label}
                                  </span>
                                </span>
                              </div>
                              <p
                                className={`mt-2 text-xs leading-5 ${selected ? "text-rose-50/90" : "text-zinc-300"}`}
                              >
                                {perk.description}
                              </p>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                </>
              )}

              {/* ── Timing & Probabilities section ── */}
              {activeSectionId === "timing" && (
                <div className="flex flex-col gap-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
                  <div className="bg-black/40 border border-white/10 rounded-xl p-6 backdrop-blur-md">
                    <h3 className="text-xl font-bold mb-4 flex items-center gap-2">
                      <span>🎲</span> Dice Roll Limits
                    </h3>
                    <div className="grid grid-cols-2 gap-6">
                      <div className="space-y-2">
                        <label className="text-xs font-bold text-white/40 uppercase tracking-wider">
                          Minimum Roll
                        </label>
                        <input
                          type="number"
                          min="1"
                          max="20"
                          value={setup.diceMin}
                          onChange={(e) =>
                            setSetup((prev) => ({
                              ...prev,
                              diceMin: Math.max(1, Math.min(20, Number(e.target.value))),
                            }))
                          }
                          className="w-full bg-white/5 border border-white/10 rounded-lg py-2 px-3 focus:outline-none focus:border-blue-500 transition-colors"
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="text-xs font-bold text-white/40 uppercase tracking-wider">
                          Maximum Roll
                        </label>
                        <input
                          type="number"
                          min="1"
                          max="20"
                          value={setup.diceMax}
                          onChange={(e) =>
                            setSetup((prev) => ({
                              ...prev,
                              diceMax: Math.max(1, Math.min(20, Number(e.target.value))),
                            }))
                          }
                          className="w-full bg-white/5 border border-white/10 rounded-lg py-2 px-3 focus:outline-none focus:border-blue-500 transition-colors"
                        />
                      </div>
                    </div>
                    <p className="text-xs text-white/40 mt-4 leading-relaxed italic">
                      Controls the range of the dice used for movement. Default is 1 to 6.
                    </p>
                  </div>

                  <div className="bg-black/40 border border-white/10 rounded-xl p-6 backdrop-blur-md">
                    <NumberInput
                      label="Starting Money"
                      description="Money available at the beginning of a new run from this playlist. Existing resumed runs keep their saved money."
                      value={setup.startingMoney}
                      min={0}
                      max={100000}
                      disabled={!isLinearEditable}
                      onChange={(value) =>
                        setSetup((prev) => ({
                          ...prev,
                          startingMoney: Math.max(0, value),
                        }))
                      }
                    />
                    <NumberInput
                      label="Round Start Delay (sec)"
                      description="Time to wait before each round starts. Set to 0 for instant transitions. Default is 20 seconds."
                      value={setup.roundStartDelaySec}
                      min={0}
                      max={300}
                      disabled={!isLinearEditable}
                      onChange={(value) =>
                        setSetup((prev) => ({
                          ...prev,
                          roundStartDelaySec: Math.max(0, Math.min(300, value)),
                        }))
                      }
                    />
                    <NumberInput
                      label="Perk Trigger Chance %"
                      description="Base chance to roll a random perk after each completed round. This does not stack per round; the same chance is checked again each time."
                      value={percent(setup.perkTriggerChancePerRound)}
                      disabled={!isLinearEditable}
                      onChange={(value) =>
                        setSetup((prev) => ({ ...prev, perkTriggerChancePerRound: toRatio(value) }))
                      }
                    />
                    <NumberInput
                      label="Intermediary Initial %"
                      description="Starting chance for an intermediary event before round 1. The run begins at this value, then uses the increase and max settings below to scale over time."
                      value={percent(setup.probabilities.intermediary.initial)}
                      disabled={!isLinearEditable}
                      onChange={(value) =>
                        setSetup((prev) => ({
                          ...prev,
                          probabilities: {
                            ...prev.probabilities,
                            intermediary: {
                              ...prev.probabilities.intermediary,
                              initial: toRatio(value),
                            },
                          },
                        }))
                      }
                    />
                    <NumberInput
                      label="Intermediary Increase %"
                      description="Additional intermediary chance added after each completed round. Example: 10% initial plus 5% increase becomes 15% on the next round, then 20%, until the max is reached."
                      value={percent(setup.probabilities.intermediary.increasePerRound)}
                      disabled={!isLinearEditable}
                      onChange={(value) =>
                        setSetup((prev) => ({
                          ...prev,
                          probabilities: {
                            ...prev.probabilities,
                            intermediary: {
                              ...prev.probabilities.intermediary,
                              increasePerRound: toRatio(value),
                            },
                          },
                        }))
                      }
                    />
                    <NumberInput
                      label="Intermediary Max %"
                      description="Hard cap for intermediary chance. Scaling stops increasing once this value is reached, even if more rounds are completed."
                      value={percent(setup.probabilities.intermediary.max)}
                      disabled={!isLinearEditable}
                      onChange={(value) =>
                        setSetup((prev) => ({
                          ...prev,
                          probabilities: {
                            ...prev.probabilities,
                            intermediary: {
                              ...prev.probabilities.intermediary,
                              max: toRatio(value),
                            },
                          },
                        }))
                      }
                    />
                    <NumberInput
                      label="Anti-Perk Initial %"
                      description="Starting chance for anti-perks at the beginning of the run. This is the first value used before any round-based scaling happens."
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
                      description="Additional anti-perk chance added after each completed round. The chance ramps up round by round until it hits the configured maximum."
                      value={percent(setup.probabilities.antiPerk.increasePerRound)}
                      disabled={!isLinearEditable}
                      onChange={(value) =>
                        setSetup((prev) => ({
                          ...prev,
                          probabilities: {
                            ...prev.probabilities,
                            antiPerk: {
                              ...prev.probabilities.antiPerk,
                              increasePerRound: toRatio(value),
                            },
                          },
                        }))
                      }
                    />
                    <NumberInput
                      label="Anti-Perk Max %"
                      description="Hard cap for anti-perk chance. Once reached, later rounds keep using this maximum instead of growing further."
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
                      label={abbreviateNsfwText("Cum Round Bonus Score", sfwMode)}
                      description={abbreviateNsfwText(
                        "Bonus score granted when a cum round is completed successfully. This affects scoring only and does not influence trigger probabilities.",
                        sfwMode
                      )}
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
                </div>
              )}
            </div>

            {/* Back button — visible only on small viewports */}
            <div className="mx-auto grid w-full max-w-md grid-cols-1 gap-2 pb-6 lg:hidden">
              <MenuButton
                label="Back"
                onHover={playHoverSound}
                onClick={() => {
                  playSelectSound();
                  goBack();
                }}
              />
            </div>
          </main>
        </div>
      </div>

      {renameDialogOpen && (
        <RenamePlaylistDialog
          initialName={activePlaylist.name}
          onClose={() => setRenameDialogOpen(false)}
          onSubmit={async (nextName) => {
            try {
              await playlists.update({ playlistId: activePlaylist.id, name: nextName });
              await refreshPlaylists();
              setRenameDialogOpen(false);
              setImportNotice("Playlist renamed.");
            } catch (error) {
              console.error("Failed to rename playlist", error);
              setImportNotice("Failed to rename playlist.");
              throw error;
            }
          }}
          onEmptyName={() => setImportNotice("Playlist name cannot be empty.")}
        />
      )}

      {newPlaylistDialogOpen && (
        <NewPlaylistDialog
          onClose={() => setNewPlaylistDialogOpen(false)}
          onSubmit={async ({ name, mode }) => {
            try {
              const config = buildNewPlaylistConfig(mode);
              const created = await playlists.create({ name, config });
              await playlists.setActive(created.id);
              await refreshPlaylists();
              setNewPlaylistDialogOpen(false);
              setImportNotice("Playlist created.");
            } catch (error) {
              console.error("Failed to create playlist", error);
              setImportNotice("Failed to create playlist.");
              throw error;
            }
          }}
          onEmptyName={() => setImportNotice("Playlist name cannot be empty.")}
        />
      )}

      {deleteDialogOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4">
          <div className="w-full max-w-md rounded-2xl border border-rose-300/35 bg-zinc-950/90 p-5 shadow-2xl backdrop-blur-xl">
            <h2 className="text-lg font-bold text-rose-100">Delete Playlist</h2>
            <p className="mt-2 text-sm text-zinc-300">
              Delete <span className="font-semibold text-zinc-100">{activePlaylist.name}</span>?
              This cannot be undone.
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
          primaryActionLabel={
            resolutionModalState.context === "import"
              ? "Import with Selected Resolutions"
              : "Apply Resolutions"
          }
          secondaryActionLabel={
            resolutionModalState.context === "import" ? "Continue Unresolved" : undefined
          }
          onClose={() => setResolutionModalState(null)}
          onPrimaryAction={(overrides) => {
            void (async () => {
              if (resolutionModalState.context === "import") {
                const imported = await playlists.importFromFile({
                  filePath: resolutionModalState.filePath,
                  manualMappingByRefKey: toManualMappingRecord(overrides),
                });
                await playlists.setActive(imported.playlist.id);
                await refreshPlaylists();
                setImportedPlaylistReview(
                  resolutionModalState.analysis.issues.length > 0
                    ? {
                        playlistId: imported.playlist.id,
                        analysis: resolutionModalState.analysis,
                      }
                    : null
                );
                setImportNotice(
                  resolutionModalState.analysis.counts.missing > 0
                    ? `Playlist imported. ${resolutionModalState.analysis.counts.missing} refs still need a manual match.`
                    : "Playlist imported."
                );
                setResolutionModalState(null);
                return;
              }

              const combinedMapping = {
                ...resolutionModalState.analysis.suggestedMapping,
                ...overrides,
              };
              const nextConfig = applyPlaylistResolutionMapping(
                activePlaylist.config,
                combinedMapping,
                installedRounds
              );
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
                manualMappingByRefKey: toManualMappingRecord(overrides),
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
      {showExportOverlay && (
        <PlaylistExportOverlay
          status={exportStatus}
          aborting={isAbortingExport}
          onAbort={() => {
            void handleAbortPlaylistExport();
          }}
        />
      )}
      {showPackExportDialog && (
        <PlaylistPackExportDialog
          playlistId={activePlaylist.id}
          playlistName={activePlaylist.name}
          onClose={() => {
            setShowPackExportDialog(false);
          }}
          onSubmit={handleStartExportPack}
        />
      )}
      {activePreviewRound && (
        <RoundVideoOverlay
          activeRound={activePreview}
          installedRounds={previewInstalledRounds ?? []}
          currentPlayer={undefined}
          intermediaryProbability={1}
          allowAutomaticIntermediaries
          showCloseButton
          onClose={() => {
            setActivePreviewRound(null);
          }}
          booruSearchPrompt={DEFAULT_INTERMEDIARY_LOADING_PROMPT}
          intermediaryLoadingDurationSec={DEFAULT_INTERMEDIARY_LOADING_DURATION_SEC}
          intermediaryReturnPauseSec={DEFAULT_INTERMEDIARY_RETURN_PAUSE_SEC}
          onFinishRound={() => {
            setActivePreviewRound(null);
          }}
        />
      )}

      {/* Floating toast notification */}
      {importNotice && (
        <div className="fixed bottom-6 left-1/2 z-[200] -translate-x-1/2 animate-entrance">
          <div
            className={`rounded-xl border px-5 py-3 text-sm font-semibold shadow-2xl backdrop-blur-xl ${
              importNotice.toLowerCase().includes("fail")
                ? "border-rose-300/40 bg-rose-950/85 text-rose-100 shadow-rose-500/20"
                : "border-emerald-300/40 bg-emerald-950/85 text-emerald-100 shadow-emerald-500/20"
            }`}
          >
            {importNotice}
          </div>
        </div>
      )}
    </div>
  );
}

function WorkshopRoundPreview({
  round,
  onOpenPreview,
}: {
  round: WorkshopInstalledRound;
  onOpenPreview: (round: WorkshopInstalledRound) => void;
}) {
  const { mediaResources, isLoading, loadMediaResources } = useInstalledRoundMedia(round.id);
  const previewUri = mediaResources?.resources[0]?.videoUri ?? null;
  const previewImage = round.previewImage;
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [isPreviewActive, setIsPreviewActive] = useState(false);
  const { getVideoSrc, ensurePlayableVideo, handleVideoError } = usePlayableVideoFallback();
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
    const startSec = hasFiniteDuration
      ? Math.min(previewWindowSec.startSec, video.duration)
      : previewWindowSec.startSec;
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
    const ensuredResources = previewUri ? mediaResources : await loadMediaResources();
    const ensuredPreviewUri = previewUri ?? ensuredResources?.resources[0]?.videoUri ?? null;
    if (!ensuredPreviewUri) return;
    const video = videoRef.current;
    if (!video || video.readyState < HTMLMediaElement.HAVE_METADATA) return;
    const { startSec } = resolvePreviewWindow(video);
    video.currentTime = startSec;
    try {
      await video.play();
    } catch (error) {
      console.error("Workshop preview play blocked", error);
    }
  };

  const stopPreview = () => {
    setIsPreviewActive(false);
    const video = videoRef.current;
    if (!video) return;
    video.pause();
    const { startSec } = resolvePreviewWindow(video);
    video.currentTime = startSec;
  };

  const openPreview = () => {
    if (!previewUri) return;
    stopPreview();
    onOpenPreview(round);
  };

  return (
    <div
      className={`group/video relative h-24 w-full shrink-0 overflow-hidden rounded-xl border border-violet-300/25 bg-gradient-to-br from-[#1b1130] via-[#120a25] to-[#0d1a33] sm:w-44 ${previewUri ? "cursor-pointer" : ""}`}
      onMouseEnter={async () => {
        playHoverSound();
        await startPreview();
      }}
      onMouseLeave={stopPreview}
      onFocus={async () => {
        playHoverSound();
        await startPreview();
      }}
      onBlur={stopPreview}
      onClick={() => {
        openPreview();
      }}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        openPreview();
      }}
      tabIndex={previewUri ? 0 : undefined}
      role={previewUri ? "button" : undefined}
      aria-label={previewUri ? `Open ${round.name}` : undefined}
    >
      {previewImage && (
        <SfwGuard>
          <img
            src={previewImage}
            alt={`${round.name} preview`}
            className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover/video:scale-[1.03] group-focus-within/video:scale-[1.03]"
            loading="lazy"
            decoding="async"
          />
        </SfwGuard>
      )}
      {previewUri ? (
        <SfwGuard>
          <video
            ref={videoRef}
            className={`h-full w-full object-cover transition-transform duration-500 group-hover/video:scale-[1.06] group-focus-within/video:scale-[1.06] ${previewImage ? "opacity-0 group-hover/video:opacity-100 group-focus-within/video:opacity-100" : ""}`}
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
        </SfwGuard>
      ) : !previewImage ? (
        <div className="flex h-full items-center justify-center text-[10px] font-[family-name:var(--font-jetbrains-mono)] uppercase tracking-[0.25em] text-zinc-500">
          {isLoading ? "Loading..." : "No Preview"}
        </div>
      ) : null}

      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/70 via-black/15 to-transparent" />

      {previewUri && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <span className="flex h-10 w-10 items-center justify-center rounded-full border border-white/45 bg-black/45 text-sm text-white opacity-0 transition-opacity duration-200 group-hover/video:opacity-100 group-focus-within/video:opacity-100">
            ▶
          </span>
        </div>
      )}
    </div>
  );
}

function HeaderAction({
  label,
  onClick,
  disabled,
  emphasis = "default",
}: {
  label: string;
  onClick: () => void | Promise<void>;
  disabled?: boolean;
  emphasis?: "default" | "primary";
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onMouseEnter={playHoverSound}
      onClick={() => {
        void onClick();
      }}
      className={`rounded-xl border px-3 py-2 font-[family-name:var(--font-jetbrains-mono)] text-xs uppercase tracking-[0.18em] ${
        disabled
          ? "cursor-not-allowed border-zinc-700 bg-zinc-900 text-zinc-500"
          : emphasis === "primary"
            ? "border-emerald-300/45 bg-emerald-500/20 text-emerald-100 hover:border-emerald-200/80 hover:bg-emerald-500/35"
            : "border-violet-300/45 bg-violet-500/20 text-violet-100 hover:border-violet-200/80 hover:bg-violet-500/35"
      }`}
    >
      {label}
    </button>
  );
}

function RenamePlaylistDialog({
  initialName,
  onClose,
  onSubmit,
  onEmptyName,
}: {
  initialName: string;
  onClose: () => void;
  onSubmit: (name: string) => Promise<void>;
  onEmptyName: () => void;
}) {
  const [draft, setDraft] = useState(initialName);
  const [pending, setPending] = useState(false);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4">
      <div className="w-full max-w-md rounded-2xl border border-violet-300/35 bg-zinc-950/90 p-5 shadow-2xl backdrop-blur-xl">
        <h2 className="text-lg font-bold text-violet-100">Rename Playlist</h2>
        <p className="mt-2 text-sm text-zinc-300">Choose a new name for this playlist.</p>
        <label className="mt-4 block">
          <span className="mb-2 block text-xs uppercase tracking-[0.2em] text-zinc-300">
            Playlist Name
          </span>
          <input
            type="text"
            value={draft}
            maxLength={120}
            onChange={(event) => setDraft(event.target.value)}
            onMouseEnter={playHoverSound}
            className="w-full rounded-xl border border-purple-300/30 bg-black/45 px-4 py-3 text-sm text-zinc-100 outline-none focus:border-purple-300/75 focus:ring-2 focus:ring-purple-400/30"
          />
        </label>
        <div className="mt-5 grid grid-cols-2 gap-2">
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              playSelectSound();
              onClose();
            }}
            className="rounded-xl border border-zinc-600 bg-zinc-900 px-3 py-2 text-sm font-semibold text-zinc-200 hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              playSelectSound();
              void (async () => {
                const nextName = draft.trim();
                if (nextName.length === 0) {
                  onEmptyName();
                  return;
                }
                setPending(true);
                try {
                  await onSubmit(nextName);
                } finally {
                  setPending(false);
                }
              })();
            }}
            className="rounded-xl border border-violet-300/45 bg-violet-500/20 px-3 py-2 text-sm font-semibold text-violet-100 hover:bg-violet-500/35 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {pending ? "Renaming..." : "Rename"}
          </button>
        </div>
      </div>
    </div>
  );
}

function NewPlaylistDialog({
  onClose,
  onSubmit,
  onEmptyName,
}: {
  onClose: () => void;
  onSubmit: (input: { name: string; mode: NewPlaylistMode }) => Promise<void>;
  onEmptyName: () => void;
}) {
  const [name, setName] = useState("New Playlist");
  const [mode, setMode] = useState<NewPlaylistMode>("fully-random");
  const [pending, setPending] = useState(false);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4">
      <div className="w-full max-w-xl rounded-2xl border border-violet-300/35 bg-zinc-950/90 p-5 shadow-2xl backdrop-blur-xl">
        <h2 className="text-lg font-bold text-violet-100">Create Playlist</h2>
        <p className="mt-2 text-sm text-zinc-300">
          Set a name and choose how rounds are generated.
        </p>
        <label className="mt-4 block">
          <span className="mb-2 block text-xs uppercase tracking-[0.2em] text-zinc-300">
            Playlist Name
          </span>
          <input
            type="text"
            value={name}
            maxLength={120}
            onChange={(event) => setName(event.target.value)}
            onMouseEnter={playHoverSound}
            className="w-full rounded-xl border border-purple-300/30 bg-black/45 px-4 py-3 text-sm text-zinc-100 outline-none focus:border-purple-300/75 focus:ring-2 focus:ring-purple-400/30"
          />
        </label>
        <div className="mt-4 grid gap-2">
          <button
            type="button"
            onClick={() => setMode("fully-random")}
            className={`rounded-xl border px-4 py-3 text-left text-sm ${
              mode === "fully-random"
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
            onClick={() => setMode("progressive-random")}
            className={`rounded-xl border px-4 py-3 text-left text-sm ${
              mode === "progressive-random"
                ? "border-violet-300/60 bg-violet-500/20 text-violet-100"
                : "border-zinc-600 bg-black/35 text-zinc-200"
            }`}
          >
            <div className="font-semibold">Progressive Random</div>
            <div className="mt-1 text-xs text-zinc-300">
              Keeps randomness, but later rounds increasingly favor longer and higher-difficulty
              entries.
            </div>
          </button>
        </div>
        <div className="mt-5 grid grid-cols-2 gap-2">
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              playSelectSound();
              onClose();
            }}
            className="rounded-xl border border-zinc-600 bg-zinc-900 px-3 py-2 text-sm font-semibold text-zinc-200 hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              playSelectSound();
              void (async () => {
                const nextName = name.trim();
                if (nextName.length === 0) {
                  onEmptyName();
                  return;
                }
                setPending(true);
                try {
                  await onSubmit({ name: nextName, mode });
                } finally {
                  setPending(false);
                }
              })();
            }}
            className="rounded-xl border border-violet-300/45 bg-violet-500/20 px-3 py-2 text-sm font-semibold text-violet-100 hover:bg-violet-500/35 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {pending ? "Creating..." : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
}

const ActionMenu = forwardRef<
  HTMLDivElement,
  {
    label: string;
    open: boolean;
    onToggle: () => void;
    items: Array<{
      label: string;
      onClick: () => void | Promise<void>;
      tone?: "default" | "danger";
    }>;
  }
>(({ label, open, onToggle, items }, ref) => (
  <div ref={ref} className="relative">
    <button
      type="button"
      onMouseEnter={playHoverSound}
      onClick={() => {
        playSelectSound();
        onToggle();
      }}
      className="flex w-full items-center justify-between rounded-xl border border-violet-300/45 bg-violet-500/20 px-3 py-2 font-[family-name:var(--font-jetbrains-mono)] text-xs uppercase tracking-[0.18em] text-violet-100 hover:border-violet-200/80 hover:bg-violet-500/35"
    >
      <span>{label}</span>
      <span className={`text-[10px] transition-transform ${open ? "rotate-180" : ""}`}>▼</span>
    </button>
    {open && (
      <div className="absolute right-0 top-[calc(100%+8px)] z-[120] min-w-full rounded-xl border border-violet-300/45 bg-zinc-950/95 p-2 shadow-2xl backdrop-blur-xl">
        {items.map((item) => (
          <button
            key={item.label}
            type="button"
            onMouseEnter={playHoverSound}
            onClick={() => {
              void item.onClick();
              onToggle();
            }}
            className={`mb-1 w-full rounded-lg border px-3 py-2 text-left text-sm last:mb-0 ${
              item.tone === "danger"
                ? "border-rose-300/45 bg-rose-500/10 text-rose-100 hover:bg-rose-500/20"
                : "border-zinc-700 bg-black/40 text-zinc-200 hover:border-violet-300/60 hover:bg-violet-500/20"
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>
    )}
  </div>
));

ActionMenu.displayName = "ActionMenu";

function NumberInput({
  label,
  description,
  value,
  onChange,
  disabled,
  min = 0,
  max = 100,
  step = 1,
}: {
  label: string;
  description?: string;
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
      {description ? (
        <span className="mb-2 block text-xs leading-5 text-zinc-400">{description}</span>
      ) : null}
      <div
        className={`flex items-center rounded-xl border bg-black/45 p-1 ${
          disabled ? "border-zinc-700 opacity-50" : "border-purple-300/30"
        }`}
      >
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
  );
}
