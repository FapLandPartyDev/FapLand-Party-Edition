// @i18n-enforced
import { Trans, useLingui } from "@lingui/react/macro";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { observeElementRect, useVirtualizer } from "@tanstack/react-virtual";
import { forwardRef, useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as z from "zod";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { AnimatedBackground } from "../components/AnimatedBackground";
import { SfwGuard } from "../components/SfwGuard";
import { ConfirmDialog } from "../components/ui/ConfirmDialog";
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
import { i18n } from "../i18n";

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
const AVAILABLE_ROUND_ROW_ESTIMATE_PX = 58;
const AVAILABLE_ROUNDS_INITIAL_RECT_HEIGHT_PX = 352;
const LARGE_AVAILABLE_LIST_THRESHOLD = 50;
type NewPlaylistMode = "fully-random" | "progressive-random";
type NormalRoundSort = "name-asc" | "name-desc" | "author" | "difficulty-asc";
type RoundOrderConfirmAction = "difficulty" | "random" | "progressive" | "clear";
type DurationFilter = "any" | "short" | "medium" | "long" | "unknown";
type WorkshopInstalledRound = InstalledRound | InstalledRoundCatalogEntry;
type RoundsPanePhase = "idle" | "loading-data" | "preparing-ui" | "ready";
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
type NoticeTone = "success" | "error" | "info";

const PlaylistWorkshopSearchSchema = z.object({
  open: z.enum(["active"]).optional(),
});

type WorkshopSectionId = "playlist" | "session" | "rounds" | "cum-rounds" | "perks" | "timing";

type WorkshopSection = {
  id: WorkshopSectionId;
  icon: string;
};

function getWorkshopSections(): WorkshopSection[] {
  return [
    {
      id: "playlist",
      icon: "📋",
    },
    {
      id: "session",
      icon: "🎯",
    },
    {
      id: "rounds",
      icon: "🎬",
    },
    {
      id: "cum-rounds",
      icon: "🏁",
    },
    {
      id: "perks",
      icon: "⚡",
    },
    {
      id: "timing",
      icon: "⏱️",
    },
  ];
}

function getWorkshopSectionTitle(sectionId: WorkshopSectionId): string {
  switch (sectionId) {
    case "playlist":
      return i18n._({
        id: "playlist-workshop.section.playlist.title",
        message: "Playlist",
      });
    case "session":
      return i18n._({
        id: "playlist-workshop.section.session.title",
        message: "Session",
      });
    case "rounds":
      return i18n._({
        id: "playlist-workshop.section.rounds.title",
        message: "Rounds",
      });
    case "cum-rounds":
      return i18n._({
        id: "playlist-workshop.section.cum-rounds.title",
        message: "Cum Rounds",
      });
    case "perks":
      return i18n._({
        id: "playlist-workshop.section.perks.title",
        message: "Perks & Anti-Perks",
      });
    case "timing":
      return i18n._({
        id: "playlist-workshop.section.timing.title",
        message: "Timing & Probabilities",
      });
  }
}

function getWorkshopSectionDescription(sectionId: WorkshopSectionId): string {
  switch (sectionId) {
    case "playlist":
      return i18n._({
        id: "playlist-workshop.section.playlist.description",
        message: "Select, create, and manage playlists.",
      });
    case "session":
      return i18n._({
        id: "playlist-workshop.section.session.description",
        message: "Round count, safe points, and board layout.",
      });
    case "rounds":
      return i18n._({
        id: "playlist-workshop.section.rounds.description",
        message: "Select and reorder normal rounds.",
      });
    case "cum-rounds":
      return i18n._({
        id: "playlist-workshop.section.cum-rounds.description",
        message: "Choose which cum rounds are available.",
      });
    case "perks":
      return i18n._({
        id: "playlist-workshop.section.perks.description",
        message: "Toggle individual perks and anti-perks.",
      });
    case "timing":
      return i18n._({
        id: "playlist-workshop.section.timing.description",
        message: "Round start delay and probability scaling.",
      });
  }
}

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

export function getRequiredLinearRoundCount(
  selectedCount: number,
  safePointIndices: number[],
  safePointsEnabled: boolean
): number {
  const targetCount = Math.max(0, Math.floor(selectedCount));
  if (targetCount === 0) return 1;

  const normalizedSafePointIndices = safePointsEnabled
    ? [...new Set(filterIndicesWithinTotal(safePointIndices, 500))].sort((a, b) => a - b)
    : [];

  for (let totalIndices = 1; totalIndices <= 500; totalIndices += 1) {
    const blockedCount = normalizedSafePointIndices.filter((value) => value <= totalIndices).length;
    if (totalIndices - blockedCount >= targetCount) {
      return totalIndices;
    }
  }

  return 500;
}

export function ensureLinearSetupCapacity(setup: EditableLinearSetup): EditableLinearSetup {
  const normalizedRoundCount = Math.max(1, Math.min(500, Math.floor(setup.roundCount)));
  const requiredRoundCount = getRequiredLinearRoundCount(
    setup.normalRoundOrder.length,
    setup.safePointIndices,
    setup.safePointsEnabled
  );
  const nextRoundCount = Math.max(normalizedRoundCount, requiredRoundCount);
  const safePointIndices = filterIndicesWithinTotal(setup.safePointIndices, nextRoundCount);

  return {
    ...setup,
    roundCount: nextRoundCount,
    safePointIndices,
  };
}

function clampLinearSetupToRoundCount(
  setup: EditableLinearSetup,
  nextRoundCount: number
): EditableLinearSetup {
  const cappedRoundCount = Math.max(1, Math.min(500, Math.floor(nextRoundCount)));
  const safePointIndices = filterIndicesWithinTotal(setup.safePointIndices, cappedRoundCount);

  return ensureLinearSetupCapacity({
    ...setup,
    roundCount: cappedRoundCount,
    safePointIndices,
  });
}

export function sortSelectedRoundsByDifficulty(
  rounds: WorkshopInstalledRound[]
): WorkshopInstalledRound[] {
  const collator = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });

  return rounds
    .map((round, index) => ({ round, index }))
    .sort((a, b) => {
      const difficultyDiff = (a.round.difficulty ?? 0) - (b.round.difficulty ?? 0);
      if (difficultyDiff !== 0) return difficultyDiff;

      const nameDiff = collator.compare(a.round.name, b.round.name);
      if (nameDiff !== 0) return nameDiff;

      return a.index - b.index;
    })
    .map(({ round }) => round);
}

function matchesDurationFilter(durationSec: number, filter: DurationFilter): boolean {
  if (filter === "any") return true;
  if (filter === "unknown") return durationSec <= 0;
  if (filter === "short") return durationSec > 0 && durationSec < 180;
  if (filter === "medium") return durationSec >= 180 && durationSec <= 600;
  return durationSec > 600;
}

function useVisibilityGate<T extends Element>({
  root,
  rootMargin = "240px 0px",
}: {
  root: Element | null;
  rootMargin?: string;
}) {
  const elementRef = useRef<T | null>(null);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    if (isVisible) return;
    const element = elementRef.current;
    if (!element) return;

    if (typeof IntersectionObserver === "undefined") {
      setIsVisible(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        setIsVisible(true);
        observer.disconnect();
      },
      { root, rootMargin }
    );

    observer.observe(element);
    return () => observer.disconnect();
  }, [isVisible, root, rootMargin]);

  return { elementRef, isVisible };
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

  return ensureLinearSetupCapacity({
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
  });
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
      name: i18n._({
        id: "playlist-workshop.empty-playlist.name",
        message: "Empty",
      }),
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

function getUnknownAuthorLabel(): string {
  return i18n._({
    id: "playlist-workshop.fallback.unknown-author",
    message: "Unknown Author",
  });
}

function getPlaylistCountLabel(count: number): string {
  return i18n._({
    id: "playlist-workshop.overview.playlist-count",
    message: "{count, plural, one {# Playlist} other {# Playlists}}",
    values: { count },
  });
}

function getImportedAutoResolvedNotice(count: number): string {
  return i18n._({
    id: "playlist-workshop.import.auto-resolved",
    message:
      "Playlist imported with {count, plural, one {# auto-resolved round ref} other {# auto-resolved round refs}}.",
    values: { count },
  });
}

function getResolutionMissingSummary(count: number): string {
  return i18n._({
    id: "playlist-workshop.resolution.missing-summary",
    message:
      "{count, plural, one {# playlist ref still needs a manual match.} other {# playlist refs still need a manual match.}}",
    values: { count },
  });
}

function getResolutionAutoResolvedSummary(count: number): string {
  return i18n._({
    id: "playlist-workshop.resolution.auto-resolved-summary",
    message:
      "{count, plural, one {# ref was auto-resolved and can be reviewed.} other {# refs were auto-resolved and can be reviewed.}}",
    values: { count },
  });
}

function getImportedUnresolvedSummary(count: number): string {
  return i18n._({
    id: "playlist-workshop.import.unresolved-summary",
    message:
      "Playlist imported. {count, plural, one {# ref still needs a manual match.} other {# refs still need a manual match.}}",
    values: { count },
  });
}

function PlaylistWorkshopRoundRowSkeleton() {
  return (
    <div className="flex items-center gap-2 rounded-xl border border-white/5 bg-white/5 px-2 py-1.5">
      <div className="h-10 w-16 shrink-0 animate-pulse rounded-lg bg-white/10" />
      <div className="min-w-0 flex-1">
        <div className="h-4 w-32 animate-pulse rounded bg-white/20" />
        <div className="mt-2 h-3 w-24 animate-pulse rounded bg-white/5" />
        <div className="mt-2 flex gap-1">
          <div className="h-4 w-14 animate-pulse rounded bg-white/5" />
          <div className="h-4 w-10 animate-pulse rounded bg-white/5" />
        </div>
      </div>
      <div className="h-7 w-7 shrink-0 animate-pulse rounded-lg bg-white/10" />
    </div>
  );
}

function PlaylistWorkshopRoundsSkeleton({ subTab = "library" }: { subTab?: "library" | "queue" }) {
  return (
    <div>
      {/* Skeleton for Tab Bar */}
      <div className="mb-4 flex gap-1.5 rounded-[1.25rem] bg-black/40 p-1.5 border border-white/5 backdrop-blur-md">
        <div className={`h-10 w-1/2 animate-pulse rounded-xl ${subTab === "library" ? "bg-white/10" : "bg-white/5"}`} />
        <div className={`h-10 w-1/2 animate-pulse rounded-xl ${subTab === "queue" ? "bg-white/10" : "bg-white/5"}`} />
      </div>

      {subTab === "library" ? (
        <section className="flex max-h-[75vh] flex-col">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="h-5 w-32 animate-pulse rounded bg-white/10" />
              <div className="mt-2 h-3 w-52 animate-pulse rounded bg-white/5" />
            </div>
            <div className="flex gap-2">
              <div className="h-6 w-20 animate-pulse rounded-full bg-white/10" />
              <div className="h-6 w-20 animate-pulse rounded-full bg-white/10" />
              <div className="h-6 w-24 animate-pulse rounded-full bg-white/10" />
            </div>
          </div>
          <div className="mt-4 grid gap-2 sm:grid-cols-[1fr_auto_auto]">
            <div className="h-10 animate-pulse rounded-xl border border-white/5 bg-white/5" />
            <div className="h-10 w-10 animate-pulse rounded-xl border border-white/5 bg-white/5" />
            <div className="h-10 w-10 animate-pulse rounded-xl border border-white/5 bg-white/5" />
          </div>
          <div className="mt-4 flex flex-1 flex-col gap-1.5 overflow-hidden">
            {Array.from({ length: 8 }, (_, index) => (
              <PlaylistWorkshopRoundRowSkeleton
                key={`playlist-workshop-available-round-skeleton:${index}`}
              />
            ))}
          </div>
        </section>
      ) : (
        <section className="flex max-h-[75vh] flex-col">
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-2">
            <div>
              <div className="h-5 w-32 animate-pulse rounded bg-white/10" />
              <div className="mt-2 h-3 w-48 animate-pulse rounded bg-white/5" />
            </div>
            <div className="flex gap-2">
              <div className="h-6 w-24 animate-pulse rounded-full bg-white/10" />
              <div className="h-6 w-28 animate-pulse rounded-full bg-white/10" />
            </div>
          </div>
          <div className="mt-4 flex flex-1 flex-col gap-1.5 overflow-hidden">
            {Array.from({ length: 7 }, (_, index) => (
              <PlaylistWorkshopRoundRowSkeleton
                key={`playlist-workshop-selected-round-skeleton:${index}`}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

export const Route = createFileRoute("/playlist-workshop")({
  validateSearch: (search) => PlaylistWorkshopSearchSchema.parse(search),
  loader: async () => {
    const availablePlaylists = await playlists.list();
    const activePlaylist = availablePlaylists.length > 0 ? await playlists.getActive() : null;
    return { availablePlaylists, activePlaylist };
  },
  component: PlaylistWorkshopPage,
});

function PlaylistWorkshopPage() {
  const { t } = useLingui();
  const workshopSections = useMemo(() => getWorkshopSections(), []);
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
  const { availablePlaylists, activePlaylist: loaderActivePlaylist } = Route.useLoaderData() as {
    availablePlaylists: StoredPlaylist[];
    activePlaylist: StoredPlaylist | null;
  };

  const [playlistList, setPlaylistList] = useState<StoredPlaylist[]>(
    withActivePlaylist(availablePlaylists, loaderActivePlaylist)
  );
  const [activePlaylistId, setActivePlaylistId] = useState(
    search.open === "active" ? (loaderActivePlaylist?.id ?? "") : ""
  );
  const [importNotice, setImportNotice] = useState<{ message: string; tone: NoticeTone } | null>(
    null
  );
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
  const [roundOrderConfirmAction, setRoundOrderConfirmAction] =
    useState<RoundOrderConfirmAction | null>(null);
  const [normalRoundSearch, setNormalRoundSearch] = useState("");
  const [normalRoundSort, setNormalRoundSort] = useState<NormalRoundSort>("name-asc");
  const [normalRoundDurationFilter, setNormalRoundDurationFilter] = useState<DurationFilter>("any");
  const [activePreviewRound, setActivePreviewRound] = useState<InstalledRound | null>(null);
  const [previewInstalledRounds, setPreviewInstalledRounds] = useState<InstalledRound[] | null>(
    null
  );
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

  const [installedRounds, setInstalledRounds] = useState<WorkshopInstalledRound[]>([]);
  const [isInstalledRoundsLoading, setIsInstalledRoundsLoading] = useState(false);
  const [roundsPanePhase, setRoundsPanePhase] = useState<RoundsPanePhase>("idle");
  const hasLoadedInstalledRoundsRef = useRef(false);
  const installedRoundsRequestRef = useRef<Promise<void> | null>(null);
  const roundsPaneRevealFrameRef = useRef<number | null>(null);
  const [setup, setSetup] = useState<EditableLinearSetup>(() =>
    activePlaylist
      ? toEditableSetup(activePlaylist, installedRounds)
      : createEmptyEditableSetup(installedRounds)
  );
  const [safePointsInput, setSafePointsInput] = useState<string>(
    formatSafePointsInput(setup.safePointIndices)
  );
  const [activeSectionId, setActiveSectionId] = useState<WorkshopSectionId>("playlist");
  const [roundsSubTab, setRoundsSubTab] = useState<"library" | "queue">("library");
  const availableRoundsScrollRef = useRef<HTMLDivElement | null>(null);
  const [availableRoundsScrollElement, setAvailableRoundsScrollElement] =
    useState<HTMLDivElement | null>(null);
  const setAvailableRoundsScrollNode = useCallback((node: HTMLDivElement | null) => {
    availableRoundsScrollRef.current = node;
    setAvailableRoundsScrollElement(node);
  }, []);
  const showImportNotice = useCallback((message: string, tone: NoticeTone = "success") => {
    setImportNotice({ message, tone });
  }, []);

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
    if (roundsPaneRevealFrameRef.current !== null) {
      window.cancelAnimationFrame(roundsPaneRevealFrameRef.current);
      roundsPaneRevealFrameRef.current = null;
    }

    if (activeSectionId !== "rounds" && activeSectionId !== "cum-rounds") {
      setRoundsPanePhase("idle");
      return;
    }

    const revealWhenReady = () => {
      if (roundsPaneRevealFrameRef.current !== null) {
        window.clearTimeout(roundsPaneRevealFrameRef.current);
      }
      roundsPaneRevealFrameRef.current = window.setTimeout(() => {
        roundsPaneRevealFrameRef.current = null;
        setRoundsPanePhase((current) =>
          current === "loading-data" || current === "preparing-ui" ? "ready" : current
        );
      }, 50);
    };

    if (hasLoadedInstalledRoundsRef.current) {
      setRoundsPanePhase("preparing-ui");
      revealWhenReady();
      return () => {
        if (roundsPaneRevealFrameRef.current !== null) {
          window.clearTimeout(roundsPaneRevealFrameRef.current);
          roundsPaneRevealFrameRef.current = null;
        }
      };
    }

    if (installedRoundsRequestRef.current) {
      setRoundsPanePhase("loading-data");
      return;
    }

    let mounted = true;
    setRoundsPanePhase("loading-data");
    setIsInstalledRoundsLoading(true);
    const request = (async () => {
      const nextRounds = await getInstalledRounds();
      if (!mounted) return;
      setInstalledRounds(nextRounds);
      hasLoadedInstalledRoundsRef.current = true;
      setIsInstalledRoundsLoading(false);
      setRoundsPanePhase("preparing-ui");
      revealWhenReady();
    })().finally(() => {
      if (installedRoundsRequestRef.current === request) {
        installedRoundsRequestRef.current = null;
      }
    });
    installedRoundsRequestRef.current = request;

    return () => {
      mounted = false;
      if (roundsPaneRevealFrameRef.current !== null) {
        window.cancelAnimationFrame(roundsPaneRevealFrameRef.current);
        roundsPaneRevealFrameRef.current = null;
      }
    };
  }, [activeSectionId]);

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
  const normalRoundById = useMemo(
    () => new Map(normalRounds.map((round) => [round.id, round])),
    [normalRounds]
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
  const requiredNormalRoundCount = useMemo(
    () =>
      getRequiredLinearRoundCount(
        setup.normalRoundOrder.length,
        setup.safePointIndices,
        setup.safePointsEnabled
      ),
    [setup.normalRoundOrder.length, setup.safePointIndices, setup.safePointsEnabled]
  );
  const normalRoundPlacement = useMemo(() => {
    const safePointIndices = setup.safePointsEnabled ? setup.safePointIndices : [];
    return getLinearQueuePlacement({
      totalIndices: setup.roundCount,
      safePointIndices,
      normalRoundOrder: setup.normalRoundOrder,
    });
  }, [setup.normalRoundOrder, setup.roundCount, setup.safePointIndices, setup.safePointsEnabled]);
  const selectedNormalRounds = useMemo(
    () =>
      setup.normalRoundOrder
        .map((roundId) => normalRoundById.get(roundId))
        .filter((round): round is WorkshopInstalledRound => Boolean(round)),
    [normalRoundById, setup.normalRoundOrder]
  );
  const availableNormalRounds = useMemo(
    () => normalRounds.filter((round) => !selectedNormalSet.has(round.id)),
    [normalRounds, selectedNormalSet]
  );
  const visibleAvailableNormalRounds = useMemo(() => {
    const query = normalRoundSearch.trim().toLowerCase();
    const collator = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });

    const filtered =
      query.length === 0
        ? availableNormalRounds
        : availableNormalRounds.filter((round) =>
          `${round.name} ${round.author ?? ""}`.toLowerCase().includes(query)
        );
    const durationFiltered = filtered.filter((round) =>
      matchesDurationFilter(getRoundDurationSec(round), normalRoundDurationFilter)
    );

    const compareByName = (a: WorkshopInstalledRound, b: WorkshopInstalledRound) =>
      collator.compare(a.name, b.name);
    const compareByAuthor = (a: WorkshopInstalledRound, b: WorkshopInstalledRound) =>
      collator.compare(a.author ?? getUnknownAuthorLabel(), b.author ?? getUnknownAuthorLabel()) ||
      compareByName(a, b);
    const compareByDifficulty = (a: WorkshopInstalledRound, b: WorkshopInstalledRound) =>
      (a.difficulty ?? 0) - (b.difficulty ?? 0) || compareByName(a, b);

    return [...durationFiltered].sort((a, b) => {
      if (normalRoundSort === "difficulty-asc") return compareByDifficulty(a, b);
      if (normalRoundSort === "name-desc") return compareByName(b, a);
      if (normalRoundSort === "author") return compareByAuthor(a, b);
      return compareByName(a, b);
    });
  }, [availableNormalRounds, normalRoundDurationFilter, normalRoundSearch, normalRoundSort]);

  const shouldVirtualizeAvailableRounds =
    visibleAvailableNormalRounds.length > LARGE_AVAILABLE_LIST_THRESHOLD;
  const shouldRenderAvailableRoundsFallback =
    visibleAvailableNormalRounds.length > 0 && !shouldVirtualizeAvailableRounds;
  const shouldRenderAvailableRoundsVirtualizationPlaceholder =
    shouldVirtualizeAvailableRounds && !availableRoundsScrollElement;

  const availableRoundsVirtualizer = useVirtualizer({
    count: visibleAvailableNormalRounds.length,
    getScrollElement: () => availableRoundsScrollElement,
    estimateSize: () => AVAILABLE_ROUND_ROW_ESTIMATE_PX,
    getItemKey: (index) => visibleAvailableNormalRounds[index]?.id ?? index,
    measureElement: (element) =>
      element.getBoundingClientRect().height || AVAILABLE_ROUND_ROW_ESTIMATE_PX,
    initialRect: { width: 1, height: AVAILABLE_ROUNDS_INITIAL_RECT_HEIGHT_PX },
    initialOffset: 0,
    observeElementRect: (instance, callback) =>
      observeElementRect(instance, (rect) => {
        callback(
          rect.height > 0
            ? rect
            : {
              ...rect,
              width: rect.width > 0 ? rect.width : 1,
              height: AVAILABLE_ROUNDS_INITIAL_RECT_HEIGHT_PX,
            }
        );
      }),
    overscan: 8,
    enabled: shouldVirtualizeAvailableRounds && Boolean(availableRoundsScrollElement),
  });

  useEffect(() => {
    availableRoundsScrollRef.current?.scrollTo({ top: 0 });
  }, [normalRoundDurationFilter, normalRoundSearch, normalRoundSort]);

  const isRoundsCatalogSection = activeSectionId === "rounds" || activeSectionId === "cum-rounds";
  const shouldShowRoundsSkeleton = isRoundsCatalogSection && roundsPanePhase !== "ready";

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
        showImportNotice(
          error instanceof Error ? error.message : t`Failed to open advanced map editor.`,
          "error"
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
        ? t`Resolve Missing`
        : t`Review Auto-Resolve`
      : activeImportReview
        ? t`Review Auto-Resolve`
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
        title: t`Import ${analysis.metadata.name}`,
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
    showImportNotice(
      analysis.resolution.counts.suggested > 0
        ? getImportedAutoResolvedNotice(analysis.resolution.counts.suggested)
        : t`Playlist imported.`
    );
  }

  const percent = (value: number) => Math.round(value * 100);
  const toRatio = (value: number) => Math.max(0, Math.min(100, Math.floor(value))) / 100;

  const dndSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setSetup((prev) => {
      const oldIndex = prev.normalRoundOrder.indexOf(active.id as string);
      const newIndex = prev.normalRoundOrder.indexOf(over.id as string);
      if (oldIndex < 0 || newIndex < 0) return prev;
      return ensureLinearSetupCapacity({
        ...prev,
        normalRoundOrder: arrayMove(prev.normalRoundOrder, oldIndex, newIndex),
      });
    });
  }, []);

  const activeSection =
    workshopSections.find((section) => section.id === activeSectionId) ?? workshopSections[0];

  if (playlistList.length === 0) {
    return (
      <div className="relative min-h-screen overflow-hidden">
        <AnimatedBackground />

        <div className="relative z-10 flex min-h-screen items-center justify-center px-4 py-8">
          <div className="w-full max-w-2xl rounded-3xl border border-violet-300/25 bg-zinc-950/80 p-6 shadow-2xl backdrop-blur-xl sm:p-8">
            <p className="font-[family-name:var(--font-jetbrains-mono)] text-[0.65rem] uppercase tracking-[0.32em] text-violet-200/70">
              <Trans>Creation & Workshop</Trans>
            </p>
            <h1 className="mt-3 text-3xl font-black tracking-tight text-white sm:text-4xl">
              <Trans>Playlist Workshop</Trans>
            </h1>
            <p className="mt-3 text-sm text-zinc-300 sm:text-base">
              <Trans>No playlist exists yet. Create one here when you want to start editing.</Trans>
            </p>

            {importNotice && (
              <div className="mt-4 rounded-xl border border-violet-300/30 bg-violet-500/10 px-4 py-3 text-sm text-violet-100">
                {importNotice.message}
              </div>
            )}

            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              <MenuButton
                label={t`Create Playlist`}
                primary
                onHover={playHoverSound}
                onClick={() => {
                  playSelectSound();
                  setNewPlaylistDialogOpen(true);
                }}
              />
              <MenuButton
                label={t`Back`}
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
                showImportNotice(t`Playlist created.`);
              } catch (error) {
                console.error("Failed to create playlist", error);
                showImportNotice(t`Failed to create playlist.`, "error");
                throw error;
              }
            }}
            onEmptyName={() => showImportNotice(t`Playlist name cannot be empty.`, "error")}
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
                <Trans>Creation & Workshop</Trans>
              </p>
              <h1 className="mt-3 text-3xl font-black tracking-tight text-white sm:text-4xl">
                <Trans>Playlist Workshop</Trans>
              </h1>
              <p className="mt-3 text-sm text-zinc-300 sm:text-base">
                <Trans>Choose a playlist to edit, or create one from here.</Trans>
              </p>
              {importNotice && (
                <div className="mt-4 rounded-xl border border-violet-300/30 bg-violet-500/10 px-4 py-3 text-sm text-violet-100">
                  {importNotice.message}
                </div>
              )}

              <div className="mt-6 grid gap-3 sm:grid-cols-2">
                <MenuButton
                  label={t`Create Playlist`}
                  primary
                  onHover={playHoverSound}
                  onClick={() => {
                    playSelectSound();
                    setNewPlaylistDialogOpen(true);
                  }}
                />
                <MenuButton
                  label={t`Back`}
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
                    <Trans>Select Playlist</Trans>
                  </p>
                  <h2 className="mt-2 text-2xl font-black tracking-tight text-white">
                    <Trans>Open A Playlist</Trans>
                  </h2>
                </div>
                <span className="rounded-full border border-violet-300/35 bg-violet-500/10 px-3 py-1 text-xs uppercase tracking-[0.14em] text-violet-100">
                  <Trans>{getPlaylistCountLabel(playlistList.length)}</Trans>
                </span>
              </div>

              <div className="mt-5 grid gap-3">
                {playlistList.map((playlist) => {
                  const isStoredActive = playlist.id === loaderActivePlaylist?.id;
                  const boardMode =
                    playlist.config.boardConfig.mode === "graph" ? t`Graph` : t`Linear`;
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
                        <div className="truncate text-lg font-semibold text-white">
                          {playlist.name}
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px] uppercase tracking-[0.16em] text-zinc-400">
                          <span>
                            <Trans>{boardMode} Playlist</Trans>
                          </span>
                          {isStoredActive && (
                            <span>
                              <Trans>Active</Trans>
                            </span>
                          )}
                        </div>
                      </div>
                      <span className="shrink-0 rounded-xl border border-violet-300/45 bg-violet-500/15 px-3 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-violet-100">
                        <Trans>Open</Trans>
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
                showImportNotice(t`Playlist created.`);
              } catch (error) {
                console.error("Failed to create playlist", error);
                showImportNotice(t`Failed to create playlist.`, "error");
                throw error;
              }
            }}
            onEmptyName={() => showImportNotice(t`Playlist name cannot be empty.`, "error")}
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
              <Trans>Redirecting</Trans>
            </p>
            <h1 className="mt-3 text-3xl font-black tracking-tight text-white sm:text-4xl">
              <Trans>Opening Graph Editor</Trans>
            </h1>
            <p className="mt-3 text-sm text-zinc-300 sm:text-base">
              <Trans>
                This playlist uses a graph board, so it opens in the Advanced Map Editor instead.
              </Trans>
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
      showImportNotice(
        error instanceof Error ? error.message : t`Failed to abort playlist export.`,
        "error"
      );
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
    showImportNotice(t`Playlist exported.`);
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
      showImportNotice(
        error instanceof Error ? error.message : t`Failed to open advanced map editor.`,
        "error"
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
        showImportNotice(t`Playlist pack exported to ${result.exportDir}.`);
      } catch (error) {
        console.error("Failed to export playlist pack", error);
        showImportNotice(
          error instanceof Error ? error.message : t`Failed to export playlist pack.`,
          "error"
        );
        setShowExportOverlay(false);
      }
    })();
    return true;
  };

  const saveLinearPlaylist = async (): Promise<boolean> => {
    if (!isLinearEditable || savePending) return false;
    setSavePending(true);
    try {
      const normalizedSetup = ensureLinearSetupCapacity({
        ...setup,
        safePointIndices: parseSafePointsInput(safePointsInput),
      });
      setSetup(normalizedSetup);
      setSafePointsInput(formatSafePointsInput(normalizedSetup.safePointIndices));

      const linearBoardConfig = toLinearBoardConfig(normalizedSetup, installedRounds);

      const nextConfig = ZPlaylistConfig.parse({
        ...activePlaylist.config,
        playlistVersion: activePlaylist.config.playlistVersion ?? CURRENT_PLAYLIST_VERSION,
        boardConfig: linearBoardConfig,
        saveMode: normalizedSetup.saveMode,
        roundStartDelayMs: Math.max(
          1000,
          Math.min(300000, Math.round(normalizedSetup.roundStartDelaySec * 1000))
        ),
        dice: {
          min: Math.max(1, Math.min(20, Math.floor(normalizedSetup.diceMin))),
          max: Math.max(1, Math.min(20, Math.floor(normalizedSetup.diceMax))),
        },
        perkSelection: {
          optionsPerPick: activePlaylist.config.perkSelection.optionsPerPick,
          triggerChancePerCompletedRound: Math.max(
            0,
            Math.min(1, normalizedSetup.perkTriggerChancePerRound)
          ),
        },
        perkPool: {
          enabledPerkIds: [...normalizedSetup.enabledPerkIds],
          enabledAntiPerkIds: [...normalizedSetup.enabledAntiPerkIds],
        },
        probabilityScaling: {
          initialIntermediaryProbability: Math.max(
            0,
            Math.min(1, normalizedSetup.probabilities.intermediary.initial)
          ),
          initialAntiPerkProbability: Math.max(
            0,
            Math.min(1, normalizedSetup.probabilities.antiPerk.initial)
          ),
          intermediaryIncreasePerRound: Math.max(
            0,
            Math.min(1, normalizedSetup.probabilities.intermediary.increasePerRound)
          ),
          antiPerkIncreasePerRound: Math.max(
            0,
            Math.min(1, normalizedSetup.probabilities.antiPerk.increasePerRound)
          ),
          maxIntermediaryProbability: Math.max(
            0,
            Math.min(1, normalizedSetup.probabilities.intermediary.max)
          ),
          maxAntiPerkProbability: Math.max(
            0,
            Math.min(1, normalizedSetup.probabilities.antiPerk.max)
          ),
        },
        economy: {
          ...activePlaylist.config.economy,
          startingMoney: Math.max(0, Math.floor(normalizedSetup.startingMoney)),
          scorePerCumRoundSuccess: Math.max(0, Math.floor(normalizedSetup.scorePerCumRoundSuccess)),
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
      showImportNotice(t`Playlist saved.`);
      return true;
    } catch (error) {
      console.error("Failed to save playlist", error);
      showImportNotice(t`Failed to save playlist.`, "error");
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

  const commitSafePointsInput = () => {
    const parsedSafePointIndices = parseSafePointsInput(safePointsInput);
    let nextSafePointIndices = parsedSafePointIndices;

    setSetup((prev) => {
      const nextSetup = ensureLinearSetupCapacity({
        ...prev,
        safePointIndices: filterIndicesWithinTotal(parsedSafePointIndices, 500),
      });
      nextSafePointIndices = nextSetup.safePointIndices;
      return nextSetup;
    });
    setSafePointsInput(formatSafePointsInput(nextSafePointIndices));
  };

  const addNormalRound = (roundId: string) => {
    setSetup((prev) => {
      if (prev.normalRoundOrder.includes(roundId)) return prev;
      return ensureLinearSetupCapacity({
        ...prev,
        normalRoundOrder: [...prev.normalRoundOrder, roundId],
      });
    });
  };

  const removeNormalRound = (roundId: string) => {
    setSetup((prev) => {
      if (!prev.normalRoundOrder.includes(roundId)) return prev;
      return {
        ...prev,
        normalRoundOrder: prev.normalRoundOrder.filter((id) => id !== roundId),
      };
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

  const addVisibleNormalRounds = () => {
    setSetup((prev) => {
      const nextOrder = [...prev.normalRoundOrder];
      for (const roundId of visibleAvailableNormalRounds.map((round) => round.id)) {
        if (!nextOrder.includes(roundId)) {
          nextOrder.push(roundId);
        }
      }
      return ensureLinearSetupCapacity({
        ...prev,
        normalRoundOrder: nextOrder,
      });
    });
  };

  const clearNormalRounds = () => {
    setSetup((prev) => ({ ...prev, normalRoundOrder: [] }));
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

      return ensureLinearSetupCapacity({
        ...prev,
        normalRoundOrder: orderedRounds.map((round) => round.id),
      });
    });
  };

  const applySelectedDifficultyOrdering = () => {
    setSetup((prev) => {
      const orderedRounds = sortSelectedRoundsByDifficulty(
        prev.normalRoundOrder
          .map((roundId) => normalRoundById.get(roundId))
          .filter((round): round is WorkshopInstalledRound => Boolean(round))
      );

      return ensureLinearSetupCapacity({
        ...prev,
        normalRoundOrder: orderedRounds.map((round) => round.id),
      });
    });
  };

  const requestRoundOrderAction = (action: RoundOrderConfirmAction) => {
    playSelectSound();
    setRoundOrderConfirmAction(action);
  };

  const confirmRoundOrderAction = () => {
    playSelectSound();
    const action = roundOrderConfirmAction;
    setRoundOrderConfirmAction(null);

    if (action === "difficulty") {
      applySelectedDifficultyOrdering();
      return;
    }
    if (action === "random") {
      applyNormalRoundOrdering("fully-random");
      return;
    }
    if (action === "progressive") {
      applyNormalRoundOrdering("progressive-random");
      return;
    }
    if (action === "clear") {
      clearNormalRounds();
    }
  };

  const roundOrderConfirmTitle =
    roundOrderConfirmAction === "clear"
      ? t`Clear selected rounds?`
      : t`Reorder selected rounds?`;
  const roundOrderConfirmLabel =
    roundOrderConfirmAction === "difficulty"
      ? t`Sort by Difficulty`
      : roundOrderConfirmAction === "random"
        ? t`Randomize`
        : roundOrderConfirmAction === "progressive"
          ? t`Apply Progressive`
          : t`Clear`;

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

  return (
    <div className="relative min-h-screen overflow-hidden">
      <AnimatedBackground />

      <div className="relative z-10 flex h-screen flex-col overflow-hidden lg:flex-row">
        {/* ── Sidebar ── */}
        <nav className="animate-entrance flex shrink-0 flex-row gap-1 overflow-x-auto border-b border-white/5 bg-black/40 px-3 py-2 backdrop-blur-2xl lg:w-64 lg:flex-col lg:gap-1 lg:overflow-x-visible lg:overflow-y-auto lg:border-b-0 lg:border-r lg:bg-black/20 lg:p-6 lg:pb-8">
          {/* Title — only visible on lg+ */}
          <div className="hidden lg:block lg:mb-6 lg:px-1">
            <p className="font-[family-name:var(--font-jetbrains-mono)] text-[0.65rem] uppercase tracking-[0.35em] text-zinc-500">
              <Trans>Creation & Workshop</Trans>
            </p>
            <h1 className="mt-1.5 text-xl font-semibold tracking-tight text-white drop-shadow-[0_2px_12px_rgba(255,255,255,0.15)]">
              <Trans>Playlist Workshop</Trans>
            </h1>
          </div>

          {workshopSections.map((section) => {
            const active = section.id === activeSectionId;
            return (
              <button
                key={section.id}
                type="button"
                onMouseEnter={playHoverSound}
                onFocus={playHoverSound}
                onClick={() => {
                  playSelectSound();
                  if (
                    (section.id === "rounds" || section.id === "cum-rounds") &&
                    !hasLoadedInstalledRoundsRef.current &&
                    !installedRoundsRequestRef.current
                  ) {
                    setIsInstalledRoundsLoading(true);
                  }
                  setActiveSectionId(section.id);
                }}
                className={`settings-sidebar-item whitespace-nowrap ${active ? "is-active" : ""}`}
              >
                <span className="settings-sidebar-icon">{section.icon}</span>
                <span>{abbreviateNsfwText(getWorkshopSectionTitle(section.id), sfwMode)}</span>
              </button>
            );
          })}

          {/* Sidebar footer actions */}
          <div className="hidden lg:mt-auto lg:flex lg:flex-col lg:gap-2 lg:px-1 lg:pt-4">
            {isLinearEditable ? (
              <>
                <MenuButton
                  label={savePending ? t`Saving...` : `💾 ${t`Save`}`}
                  onHover={playHoverSound}
                  onClick={() => {
                    playSelectSound();
                    void saveLinearPlaylist();
                  }}
                />
                <MenuButton
                  label={savePending ? t`Saving...` : t`Test`}
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
                label={t`Open Advanced Map Editor`}
                primary
                onHover={playHoverSound}
                onClick={() => {
                  void handleOpenAdvancedMapEditor();
                }}
              />
            )}
            <MenuButton
              label={t`← Back`}
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
                <h2 className="text-gradient-safe text-2xl font-black tracking-tight sm:text-3xl">
                  {abbreviateNsfwText(getWorkshopSectionTitle(activeSection.id), sfwMode)}
                </h2>
                <p className="mt-1.5 text-sm text-zinc-400">
                  {abbreviateNsfwText(getWorkshopSectionDescription(activeSection.id), sfwMode)}
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
                    className={`relative rounded-[1.75rem] border border-white/5 bg-black/20 p-6 backdrop-blur-2xl shadow-2xl ${playlistMenuOpen || manageMenuOpen || transferMenuOpen ? "z-20" : "z-0"}`}
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
                                <Trans>Active Playlist</Trans>
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
                                      setActivePlaylistId(playlist.id);
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
                                    {selected ? <Trans>Selected</Trans> : <Trans>Select</Trans>}
                                  </div>
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>

                      <div className="flex flex-wrap items-center gap-2 text-xs uppercase tracking-[0.12em] text-zinc-300">
                        <span className="rounded-full border border-violet-300/35 bg-violet-500/10 px-3 py-1">
                          <Trans>Playlist Version {activePlaylist.config.playlistVersion}</Trans>
                        </span>
                        <span
                          className={`rounded-full border px-3 py-1 ${isLinearEditable
                            ? "border-emerald-300/35 bg-emerald-500/10 text-emerald-100"
                            : "border-rose-300/35 bg-rose-500/10 text-rose-100"
                            }`}
                        >
                          {isLinearEditable ? (
                            <Trans>Linear Board</Trans>
                          ) : (
                            <Trans>Graph Board</Trans>
                          )}
                        </span>
                        <ActionMenu
                          ref={manageMenuRef}
                          label={t`Manage`}
                          open={manageMenuOpen}
                          onToggle={openManageMenu}
                          items={[
                            { label: t`New Playlist`, onClick: handleCreatePlaylist },
                            { label: t`Duplicate`, onClick: handleDuplicatePlaylist },
                            { label: t`Rename`, onClick: handleRenamePlaylist },
                            { label: t`Delete`, onClick: handleDeletePlaylist, tone: "danger" },
                          ]}
                        />
                        <ActionMenu
                          ref={transferMenuRef}
                          label={t`Transfer`}
                          open={transferMenuOpen}
                          onToggle={openTransferMenu}
                          items={[
                            { label: t`Import`, onClick: handleImportPlaylist },
                            { label: t`Export .fplay`, onClick: handleExportFplay },
                          ]}
                        />
                      </div>
                    </div>
                  </div>

                  <div className="rounded-[1.75rem] border border-white/5 bg-black/20 p-6 backdrop-blur-2xl shadow-2xl">
                    <h3 className="mb-4 text-sm font-semibold uppercase tracking-[0.14em] text-violet-200">
                      <Trans>Actions</Trans>
                    </h3>
                    {!isLinearEditable && (
                      <div className="rounded-[1.75rem] border border-amber-300/35 bg-[radial-gradient(circle_at_top_left,rgba(251,191,36,0.22),transparent_42%),linear-gradient(135deg,rgba(69,26,3,0.95),rgba(24,24,27,0.96))] p-5 shadow-[0_0_30px_rgba(251,191,36,0.12)]">
                        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                          <div className="max-w-2xl">
                            <p className="font-[family-name:var(--font-jetbrains-mono)] text-[10px] uppercase tracking-[0.24em] text-amber-100/85">
                              <Trans>Graph Playlist</Trans>
                            </p>
                            <h4 className="mt-2 text-xl font-black tracking-tight text-white">
                              <Trans>Use the Advanced Map Editor</Trans>
                            </h4>
                            <p className="mt-2 text-sm leading-6 text-amber-50/90">
                              <Trans>
                                This playlist uses a graph board, so Playlist Workshop cannot edit
                                its layout. Open the Advanced Map Editor to change nodes, paths, and
                                graph flow.
                              </Trans>
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
                            <Trans>Open Advanced Map Editor</Trans>
                          </button>
                        </div>
                      </div>
                    )}
                    <div className="mt-6 mb-6 relative group">
                      {/* Glorious backdrop glow */}
                      <div className="absolute -inset-0.5 rounded-[1.75rem] bg-gradient-to-r from-cyan-500 via-blue-500 to-emerald-500 opacity-40 blur-[12px] transition duration-500 group-hover:opacity-75"></div>

                      {/* Main container */}
                      <div className="relative overflow-hidden rounded-[1.75rem] border border-white/20 bg-black/60 p-5 lg:px-6 lg:py-5 backdrop-blur-2xl shadow-[0_0_40px_rgba(34,211,238,0.12)]">
                        {/* Shimmering highlights */}
                        <div className="absolute top-0 right-0 -m-20 h-48 w-48 rounded-full bg-cyan-500/20 blur-3xl"></div>
                        <div className="absolute bottom-0 left-0 -m-20 h-48 w-48 rounded-full bg-emerald-500/20 blur-3xl"></div>

                        <div className="relative z-10 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                          <div className="max-w-2xl">
                            <div className="flex items-center gap-2.5">
                              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-gradient-to-tr from-cyan-400 to-blue-500 text-white shadow-[0_0_12px_rgba(34,211,238,0.4)]">
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                                </svg>
                              </span>
                              <p className="font-[family-name:var(--font-jetbrains-mono)] text-[10px] sm:text-xs font-bold uppercase tracking-[0.25em] text-cyan-200 drop-shadow-sm">
                                <Trans>Shareable Pack</Trans>
                              </p>
                            </div>
                            <h4 className="mt-2 text-xl sm:text-2xl font-black tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-white via-cyan-100 to-emerald-100 drop-shadow-sm">
                              <Trans>Export Your Creation</Trans>
                            </h4>
                            <p className="mt-1.5 text-sm leading-relaxed text-zinc-300">
                              <Trans>
                                Ready to share? Bundle this playlist along with all its associated media into a highly compressed, easily shareable format. Perfect for distribution.
                              </Trans>
                            </p>
                          </div>

                          <div className="relative flex shrink-0 lg:ml-5 mt-2 lg:mt-0">
                            <div className="absolute -inset-0.5 rounded-full bg-gradient-to-r from-cyan-400 to-emerald-400 opacity-75 blur-md transition duration-300 group-hover:opacity-100 animate-[pulse_3s_ease-in-out_infinite]"></div>
                            <button
                              type="button"
                              onMouseEnter={playHoverSound}
                              onClick={() => {
                                playSelectSound();
                                void handleExportPack();
                              }}
                              className="relative inline-flex min-h-12 items-center justify-center gap-2 rounded-full border border-white/20 bg-gradient-to-r from-cyan-600 to-emerald-600 px-6 py-2.5 font-[family-name:var(--font-jetbrains-mono)] text-[11px] sm:text-xs font-bold uppercase tracking-[0.15em] text-white shadow-lg transition-all duration-300 hover:scale-[1.02] hover:from-cyan-500 hover:to-emerald-500 hover:shadow-[0_0_25px_rgba(52,211,238,0.35)]"
                            >
                              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                              </svg>
                              <Trans>Export Pack</Trans>
                            </button>
                          </div>
                        </div>
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
                              title: t`Resolve ${activePlaylist.name}`,
                              analysis: activeResolutionReview,
                            });
                          }}
                        />
                      </div>
                    )}
                    <div className="mt-4 grid gap-2 sm:grid-cols-2">
                      <MenuButton
                        label={savePending ? t`Saving...` : t`Save Without Test`}
                        onHover={playHoverSound}
                        onClick={() => {
                          playSelectSound();
                          void saveLinearPlaylist();
                        }}
                        disabled={!isLinearEditable}
                      />
                      <MenuButton
                        label={savePending ? t`Saving...` : t`Save and Test`}
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
                      {importNotice.message}
                    </p>
                  )}
                  {activeResolutionActionLabel && activeResolutionReview && (
                    <p className="rounded-xl border border-cyan-300/25 bg-cyan-500/10 px-4 py-2.5 text-sm text-cyan-200">
                      {activeResolutionReview.counts.missing > 0
                        ? getResolutionMissingSummary(activeResolutionReview.counts.missing)
                        : getResolutionAutoResolvedSummary(activeResolutionReview.counts.suggested)}
                    </p>
                  )}
                  {!isLinearEditable && (
                    <p className="rounded-xl border border-rose-300/25 bg-rose-500/10 px-4 py-2.5 text-sm text-rose-200">
                      <Trans>
                        This playlist uses graph board mode. Playlist Workshop only supports linear
                        playlists. Open the Advanced Map Editor to edit this board.
                      </Trans>
                    </p>
                  )}
                </>
              )}

              {/* ── Session section ── */}
              {activeSectionId === "session" && (
                <div className="rounded-[1.75rem] border border-white/5 bg-black/20 p-6 backdrop-blur-2xl shadow-2xl">
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-12">
                    <div className="min-w-0 xl:col-span-4">
                      <NumberInput
                        label={t`Round Count`}
                        description={t`Automatically grows to fit the selected queue.`}
                        value={setup.roundCount}
                        min={1}
                        max={500}
                        disabled={!isLinearEditable}
                        onChange={(value) =>
                          setSetup((prev) => {
                            const nextSetup = clampLinearSetupToRoundCount(prev, value);
                            setSafePointsInput(formatSafePointsInput(nextSetup.safePointIndices));
                            return nextSetup;
                          })
                        }
                      />
                    </div>

                    <label className="block min-w-0 xl:col-span-4">
                      <span className="mb-2 block text-xs uppercase tracking-[0.2em] text-zinc-300">
                        <Trans>Safe Points</Trans>
                      </span>
                      <button
                        type="button"
                        disabled={!isLinearEditable}
                        onMouseEnter={playHoverSound}
                        onClick={() => {
                          playSelectSound();
                          setSetup((prev) =>
                            ensureLinearSetupCapacity({
                              ...prev,
                              safePointsEnabled: !prev.safePointsEnabled,
                            })
                          );
                        }}
                        className={`w-full rounded-xl border px-4 py-3 text-sm font-semibold ${setup.safePointsEnabled
                          ? "border-emerald-300/55 bg-emerald-500/20 text-emerald-100"
                          : "border-zinc-600 bg-zinc-800 text-zinc-300"
                          }`}
                      >
                        {setup.safePointsEnabled ? <Trans>Enabled</Trans> : <Trans>Disabled</Trans>}
                      </button>
                    </label>

                    <div className="flex min-w-0 items-end md:col-span-2 xl:col-span-4">
                      <button
                        type="button"
                        disabled={!isLinearEditable}
                        onMouseEnter={playHoverSound}
                        onClick={() => {
                          playSelectSound();
                          const nextSetup = ensureLinearSetupCapacity({
                            ...setup,
                            safePointsEnabled: true,
                            safePointIndices: [...DEFAULT_SAFE_PRESET],
                          });
                          setSetup(nextSetup);
                          setSafePointsInput(formatSafePointsInput(nextSetup.safePointIndices));
                        }}
                        className="w-full rounded-xl border border-violet-300/60 bg-violet-500/25 px-4 py-3 text-sm font-semibold text-violet-100 hover:bg-violet-500/35"
                      >
                        <Trans>Apply 25/50/75 Preset</Trans>
                      </button>
                    </div>
                  </div>

                  <div className="mt-4">
                    <label
                      htmlFor="playlist-workshop-safe-points"
                      className="mb-2 block text-xs uppercase tracking-[0.2em] text-zinc-300"
                    >
                      <Trans>Safe Point Indices (comma-separated)</Trans>
                    </label>
                    <input
                      id="playlist-workshop-safe-points"
                      type="text"
                      value={safePointsInput}
                      disabled={!isLinearEditable || !setup.safePointsEnabled}
                      onChange={(event) => setSafePointsInput(event.target.value)}
                      onBlur={commitSafePointsInput}
                      onMouseEnter={playHoverSound}
                      className="w-full rounded-xl border border-purple-300/30 bg-black/45 px-4 py-3 text-sm text-zinc-100 outline-none disabled:opacity-50 focus:border-purple-300/75 focus:ring-2 focus:ring-purple-400/30"
                      placeholder={t`25, 50, 75`}
                    />
                  </div>

                  <div className="mt-4">
                    <span className="mb-2 block text-xs uppercase tracking-[0.2em] text-zinc-300">
                      <Trans>Save Mode</Trans>
                    </span>
                    <div className="grid gap-2 sm:grid-cols-3">
                      {[
                        { value: "none" as const, label: t`No Saves` },
                        { value: "checkpoint" as const, label: t`Only Checkpoint` },
                        { value: "everywhere" as const, label: t`Everywhere` },
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
                          className={`rounded-xl border px-4 py-3 text-sm font-semibold ${setup.saveMode === option.value
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
                        {setup.saveMode === "checkpoint" ? "🚩" : "💾"}{" "}
                        <Trans>
                          Warning: runs from this playlist are marked as assisted on the highscore
                          and in run history.
                        </Trans>
                      </p>
                    )}
                  </div>
                </div>
              )}

              {/* ── Rounds section ── */}
              {activeSectionId === "rounds" && (
                <div className="rounded-[1.75rem] border border-white/5 bg-black/20 p-6 backdrop-blur-2xl shadow-2xl">
                  {shouldShowRoundsSkeleton ? (
                    <PlaylistWorkshopRoundsSkeleton subTab={roundsSubTab} />
                  ) : (
                    <div className="flex flex-col">
                      {/* Tab Bar */}
                      <div className="mb-4 flex gap-1.5 rounded-[1.25rem] bg-black/40 p-1.5 border border-white/5 backdrop-blur-md">
                        <button
                          type="button"
                          onClick={() => {
                            playSelectSound();
                            setRoundsSubTab("library");
                          }}
                          onMouseEnter={playHoverSound}
                          className={`relative flex flex-1 items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition-all duration-300 ${roundsSubTab === "library"
                            ? "bg-violet-500/15 text-violet-200 border border-white/10 shadow-lg shadow-violet-500/5"
                            : "text-zinc-400 hover:text-white hover:bg-white/5 border border-transparent"
                            }`}
                        >
                          <span className="relative z-10 flex items-center gap-2">
                            <Trans>📚 Library</Trans>
                            <span className={`flex h-5 items-center justify-center rounded-full px-2 text-[10px] tabular-nums transition-colors ${roundsSubTab === "library" ? "bg-violet-900/40 text-violet-300" : "bg-black/30 text-zinc-500"}`}>
                              {availableNormalRounds.length}
                            </span>
                          </span>
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            playSelectSound();
                            setRoundsSubTab("queue");
                          }}
                          onMouseEnter={playHoverSound}
                          className={`relative flex flex-1 items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition-all duration-300 ${roundsSubTab === "queue"
                            ? "bg-emerald-500/15 text-emerald-200 border border-white/10 shadow-lg shadow-emerald-500/5"
                            : "text-zinc-400 hover:text-white hover:bg-white/5 border border-transparent"
                            }`}
                        >
                          <span className="relative z-10 flex items-center gap-2">
                            <Trans>🎯 Queue</Trans>
                            <span className={`flex h-5 items-center justify-center rounded-full px-2 text-[10px] tabular-nums transition-colors ${roundsSubTab === "queue" ? "bg-emerald-900/40 text-emerald-300" : "bg-black/30 text-zinc-500"}`}>
                              {setup.normalRoundOrder.length}
                            </span>
                          </span>
                        </button>
                      </div>

                      {/* Selected Rounds Tab Panel */}
                      <section
                        className={`flex max-h-[75vh] min-h-0 flex-col ${roundsSubTab !== "queue" ? "hidden" : ""
                          }`}
                      >
                        {/* Header */}
                        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2">
                          <div className="min-w-0">
                            <h3 className="text-base font-bold tracking-tight text-emerald-50">
                              <Trans>Selected Rounds</Trans>
                            </h3>
                            <p
                              className="mt-0.5 text-xs text-emerald-50/60"
                              title={t`This queue defines the order used first during the session. Remaining slots are filled with repeats.`}
                            >
                              <Trans>
                                Queue · drag to reorder · fills repeats if shorter than session
                              </Trans>
                            </p>
                          </div>
                          <div className="flex shrink-0 flex-wrap items-center gap-1.5 text-[11px] text-emerald-50/80">
                            <span className="rounded-full border border-emerald-200/35 bg-emerald-400/12 px-2.5 py-0.5">
                              <Trans>Selected: {setup.normalRoundOrder.length}</Trans>
                            </span>
                            <span className="rounded-full border border-emerald-200/35 bg-emerald-400/12 px-2.5 py-0.5">
                              <Trans>Minimum Round Count: {requiredNormalRoundCount}</Trans>
                            </span>
                          </div>
                        </div>

                        {/* Order / Bulk actions */}
                        <div className="mt-3 shrink-0 flex flex-wrap gap-1.5">
                          <button
                            type="button"
                            disabled={!isLinearEditable || selectedNormalRounds.length < 2}
                            onMouseEnter={playHoverSound}
                            onClick={() => requestRoundOrderAction("difficulty")}
                            className="rounded-lg border border-cyan-300/40 bg-cyan-500/15 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.1em] text-cyan-100 hover:bg-cyan-500/30 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            <Trans>Sort by Difficulty</Trans>
                          </button>
                          <button
                            type="button"
                            disabled={!isLinearEditable || normalRounds.length === 0}
                            onMouseEnter={playHoverSound}
                            onClick={() => requestRoundOrderAction("random")}
                            className="rounded-lg border border-emerald-300/40 bg-emerald-500/15 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.1em] text-emerald-100 hover:bg-emerald-500/30 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            <Trans>🎲 Random</Trans>
                          </button>
                          <button
                            type="button"
                            disabled={!isLinearEditable || normalRounds.length === 0}
                            onMouseEnter={playHoverSound}
                            onClick={() => requestRoundOrderAction("progressive")}
                            className="rounded-lg border border-violet-300/40 bg-violet-500/15 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.1em] text-violet-100 hover:bg-violet-500/30 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            <Trans>📈 Progressive</Trans>
                          </button>
                          <button
                            type="button"
                            disabled={!isLinearEditable || setup.normalRoundOrder.length === 0}
                            onMouseEnter={playHoverSound}
                            onClick={() => requestRoundOrderAction("clear")}
                            className="rounded-lg border border-rose-300/40 bg-rose-500/15 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.1em] text-rose-100 hover:bg-rose-500/30 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            <Trans>✕ Clear</Trans>
                          </button>
                        </div>

                        {/* Sortable round list */}
                        <DndContext
                          sensors={dndSensors}
                          collisionDetection={closestCenter}
                          onDragEnd={handleDragEnd}
                        >
                          <SortableContext
                            items={setup.normalRoundOrder}
                            strategy={verticalListSortingStrategy}
                          >
                            <div className="mt-3 flex flex-1 flex-col gap-1.5 overflow-y-auto pr-1">
                              {selectedNormalRounds.map((round: WorkshopInstalledRound) => {
                                const placement = normalRoundPlacement[round.id];
                                const durationSec = getRoundDurationSec(round);
                                const queuePosition = placement?.queuePosition ?? null;

                                return (
                                  <SortableRoundItem
                                    key={round.id}
                                    round={round}
                                    queuePosition={queuePosition}
                                    durationSec={durationSec}
                                    fieldIndex={placement?.fieldIndex ?? null}
                                    isDisabled={!isLinearEditable}
                                    onRemove={removeNormalRound}
                                    onOpenPreview={handlePlayRound}
                                  />
                                );
                              })}
                              {selectedNormalRounds.length === 0 && (
                                <div className="flex flex-1 flex-col items-center justify-center gap-4 rounded-xl border border-dashed border-emerald-300/20 px-4 py-10 text-sm">
                                  <div className="text-emerald-50/50 font-medium">
                                    {normalRounds.length === 0 ? (
                                      <Trans>No normal rounds installed.</Trans>
                                    ) : (
                                      <Trans>Your queue is empty.</Trans>
                                    )}
                                  </div>
                                  {normalRounds.length > 0 && (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        playSelectSound();
                                        setRoundsSubTab("library");
                                      }}
                                      onMouseEnter={playHoverSound}
                                      className="rounded-xl border border-emerald-400/30 bg-emerald-500/20 px-5 py-2.5 font-bold text-emerald-100 transition-colors hover:bg-emerald-500/30 hover:border-emerald-300/50"
                                    >
                                      <Trans>Browse Library →</Trans>
                                    </button>
                                  )}
                                </div>
                              )}
                            </div>
                          </SortableContext>
                        </DndContext>
                      </section>

                      {/* Available Rounds Tab Panel */}
                      <section
                        className={`relative flex max-h-[75vh] min-h-0 flex-col ${roundsSubTab !== "library" ? "hidden" : ""
                          }`}
                      >
                        {/* Header */}
                        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2">
                          <div className="min-w-0">
                            <h3 className="text-base font-bold tracking-tight text-violet-50">
                              <Trans>Available Rounds</Trans>
                            </h3>
                            <p className="mt-0.5 text-xs text-violet-50/60">
                              <Trans>Installed library · click Add to include in queue</Trans>
                            </p>
                          </div>
                          <div className="flex shrink-0 flex-wrap items-center gap-1.5 text-[11px] text-violet-50/80">
                            <span className="rounded-full border border-violet-200/35 bg-violet-400/12 px-2.5 py-0.5">
                              <Trans>{availableNormalRounds.length} available</Trans>
                            </span>
                            <span className="rounded-full border border-violet-200/35 bg-violet-400/12 px-2.5 py-0.5">
                              <Trans>{visibleAvailableNormalRounds.length} shown</Trans>
                            </span>
                            <button
                              type="button"
                              disabled={
                                !isLinearEditable || visibleAvailableNormalRounds.length === 0
                              }
                              onMouseEnter={playHoverSound}
                              onClick={() => {
                                playSelectSound();
                                addVisibleNormalRounds();
                              }}
                              className="rounded-full border border-violet-300/55 bg-violet-500/25 px-3 py-0.5 font-semibold uppercase tracking-[0.1em] text-violet-100 hover:bg-violet-500/40 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              <Trans>Add Visible</Trans>
                            </button>
                          </div>
                        </div>

                        {/* Filters */}
                        <div className="mt-3 shrink-0 grid gap-2 sm:grid-cols-[1fr_auto_auto]">
                          <div>
                            <label htmlFor="playlist-workshop-round-search" className="sr-only">
                              <Trans>Search rounds</Trans>
                            </label>
                            <input
                              id="playlist-workshop-round-search"
                              type="text"
                              value={normalRoundSearch}
                              onChange={(event) => setNormalRoundSearch(event.target.value)}
                              onMouseEnter={playHoverSound}
                              className="w-full rounded-xl border border-purple-300/30 bg-black/45 px-3 py-2 text-sm text-zinc-100 outline-none placeholder:text-zinc-500 focus:border-purple-300/75 focus:ring-2 focus:ring-purple-400/30"
                              placeholder={t`Search by round or author…`}
                            />
                          </div>
                          <GameDropdown
                            value={normalRoundSort}
                            options={[
                              { value: "name-asc", label: t`A-Z` },
                              { value: "name-desc", label: t`Z-A` },
                              { value: "author", label: t`Author` },
                              { value: "difficulty-asc", label: t`Easiest` },
                            ]}
                            onChange={(value) => setNormalRoundSort(value as NormalRoundSort)}
                            onHoverSfx={playHoverSound}
                          />
                          <GameDropdown
                            value={normalRoundDurationFilter}
                            options={[
                              { value: "any", label: t`Any` },
                              { value: "short", label: t`< 3 min` },
                              { value: "medium", label: t`3-10 min` },
                              { value: "long", label: t`> 10 min` },
                              { value: "unknown", label: t`Unknown` },
                            ]}
                            onChange={(value) =>
                              setNormalRoundDurationFilter(value as DurationFilter)
                            }
                            onHoverSfx={playHoverSound}
                          />
                        </div>

                        {/* Scrollable round list */}
                        <div
                          ref={setAvailableRoundsScrollNode}
                          className="mt-3 flex min-h-[22rem] flex-1 flex-col overflow-y-auto pr-1"
                        >
                          {visibleAvailableNormalRounds.length > 0 &&
                            shouldVirtualizeAvailableRounds &&
                            availableRoundsScrollElement && (
                              <div
                                className="relative"
                                style={{ height: `${availableRoundsVirtualizer.getTotalSize()}px` }}
                              >
                                {availableRoundsVirtualizer.getVirtualItems().map((item) => {
                                  const round = visibleAvailableNormalRounds[item.index];
                                  if (!round) return null;
                                  const durationSec = getRoundDurationSec(round);

                                  return (
                                    <div
                                      key={round.id}
                                      ref={availableRoundsVirtualizer.measureElement}
                                      data-index={item.index}
                                      className="absolute left-0 top-0 w-full pb-1.5"
                                      style={{ transform: `translateY(${item.start}px)` }}
                                    >
                                      <div
                                        role="group"
                                        aria-label={t`Available round ${round.name}`}
                                        className="group flex items-center gap-2 rounded-xl border border-violet-300/15 bg-black/25 px-2 py-1.5 transition-colors hover:border-violet-300/30 hover:bg-black/40"
                                      >
                                        <div className="shrink-0">
                                          <WorkshopRoundPreview
                                            round={round}
                                            onOpenPreview={handlePlayRound}
                                            intersectionRoot={availableRoundsScrollRef.current}
                                          />
                                        </div>

                                        <div className="min-w-0 flex-1">
                                          <div className="truncate text-sm font-semibold leading-tight text-zinc-100">
                                            {round.name}
                                          </div>
                                          <div className="truncate text-[11px] text-zinc-400">
                                            {round.author ?? getUnknownAuthorLabel()}
                                          </div>
                                          <div className="mt-0.5 flex flex-wrap gap-1 text-[10px]">
                                            <span className="rounded border border-zinc-700/60 bg-zinc-900/70 px-1.5 py-px text-zinc-300">
                                              {formatDurationLabel(durationSec)}
                                            </span>
                                            {typeof round.difficulty === "number" && (
                                              <span className="rounded border border-zinc-700/60 bg-zinc-900/70 px-1.5 py-px text-zinc-300">
                                                <Trans>D{round.difficulty}</Trans>
                                              </span>
                                            )}
                                          </div>
                                        </div>

                                        <button
                                          type="button"
                                          disabled={!isLinearEditable}
                                          onMouseEnter={playHoverSound}
                                          onClick={() => {
                                            playSelectSound();
                                            addNormalRound(round.id);
                                          }}
                                          aria-label={t`Add to queue`}
                                          title={t`Add to queue`}
                                          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-violet-400/40 bg-violet-500/15 text-sm text-violet-300 transition-colors hover:border-violet-300/70 hover:bg-violet-500/35 hover:text-violet-100 disabled:cursor-not-allowed disabled:opacity-40"
                                        >
                                          +
                                        </button>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          {shouldRenderAvailableRoundsFallback && (
                            <div className="flex flex-col gap-1.5">
                              {visibleAvailableNormalRounds.map((round: WorkshopInstalledRound) => {
                                const durationSec = getRoundDurationSec(round);

                                return (
                                  <div
                                    key={round.id}
                                    role="group"
                                    aria-label={t`Available round ${round.name}`}
                                    className="group flex items-center gap-2 rounded-xl border border-violet-300/15 bg-black/25 px-2 py-1.5 transition-colors hover:border-violet-300/30 hover:bg-black/40"
                                  >
                                    <div className="shrink-0">
                                      <WorkshopRoundPreview
                                        round={round}
                                        onOpenPreview={handlePlayRound}
                                      />
                                    </div>

                                    <div className="min-w-0 flex-1">
                                      <div className="truncate text-sm font-semibold leading-tight text-zinc-100">
                                        {round.name}
                                      </div>
                                      <div className="truncate text-[11px] text-zinc-400">
                                        {round.author ?? getUnknownAuthorLabel()}
                                      </div>
                                      <div className="mt-0.5 flex flex-wrap gap-1 text-[10px]">
                                        <span className="rounded border border-zinc-700/60 bg-zinc-900/70 px-1.5 py-px text-zinc-300">
                                          {formatDurationLabel(durationSec)}
                                        </span>
                                        {typeof round.difficulty === "number" && (
                                          <span className="rounded border border-zinc-700/60 bg-zinc-900/70 px-1.5 py-px text-zinc-300">
                                            <Trans>D{round.difficulty}</Trans>
                                          </span>
                                        )}
                                      </div>
                                    </div>

                                    <button
                                      type="button"
                                      disabled={!isLinearEditable}
                                      onMouseEnter={playHoverSound}
                                      onClick={() => {
                                        playSelectSound();
                                        addNormalRound(round.id);
                                      }}
                                      aria-label={t`Add to queue`}
                                      title={t`Add to queue`}
                                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-violet-400/40 bg-violet-500/15 text-sm text-violet-300 transition-colors hover:border-violet-300/70 hover:bg-violet-500/35 hover:text-violet-100 disabled:cursor-not-allowed disabled:opacity-40"
                                    >
                                      +
                                    </button>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                          {shouldRenderAvailableRoundsVirtualizationPlaceholder && (
                            <div
                              aria-label={t`Preparing available rounds`}
                              className="flex flex-col gap-1.5"
                            >
                              {Array.from({ length: 8 }, (_, index) => (
                                <PlaylistWorkshopRoundRowSkeleton
                                  key={`playlist-workshop-available-rounds-prep:${index}`}
                                />
                              ))}
                            </div>
                          )}
                          {visibleAvailableNormalRounds.length === 0 && (
                            <div className="flex flex-1 flex-col items-center justify-center gap-4 rounded-xl border border-dashed border-violet-300/20 px-4 py-10 text-sm">
                              <div className="text-violet-50/50 font-medium">
                                {normalRounds.length === 0 ? (
                                  <Trans>No normal rounds installed.</Trans>
                                ) : availableNormalRounds.length === 0 ? (
                                  <Trans>All rounds are in the queue.</Trans>
                                ) : (
                                  <Trans>No rounds match your search.</Trans>
                                )}
                              </div>
                              {normalRounds.length > 0 && availableNormalRounds.length === 0 && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    playSelectSound();
                                    setRoundsSubTab("queue");
                                  }}
                                  onMouseEnter={playHoverSound}
                                  className="rounded-xl border border-violet-400/30 bg-violet-500/20 px-5 py-2.5 font-bold text-violet-100 transition-colors hover:bg-violet-500/30 hover:border-violet-300/50"
                                >
                                  <Trans>View Queue →</Trans>
                                </button>
                              )}
                            </div>
                          )}
                        </div>

                        {/* Floating Queue Summary for Library Tab */}
                        {setup.normalRoundOrder.length > 0 && (
                          <div className="absolute bottom-6 left-1/2 flex -translate-x-1/2 items-center gap-3 rounded-full border border-emerald-400/20 bg-emerald-950/80 pl-4 pr-1 py-1 shadow-[0_4px_24px_rgba(16,185,129,0.25)] backdrop-blur-xl">
                            <div className="text-sm font-semibold text-emerald-100 whitespace-nowrap">
                              <Trans>🎯 {setup.normalRoundOrder.length} added to queue</Trans>
                            </div>
                            <button
                              type="button"
                              onClick={() => {
                                playSelectSound();
                                setRoundsSubTab("queue");
                              }}
                              onMouseEnter={playHoverSound}
                              className="rounded-full bg-emerald-500/20 px-3 py-1.5 text-xs font-bold text-emerald-200 transition-colors hover:bg-emerald-500/40 whitespace-nowrap"
                            >
                              <Trans>View Queue →</Trans>
                            </button>
                          </div>
                        )}
                      </section>
                    </div>
                  )}
                </div>
              )}

              {/* ── Cum Rounds section ── */}
              {activeSectionId === "cum-rounds" && (
                <div className="rounded-[1.75rem] border border-white/5 bg-black/20 p-6 backdrop-blur-2xl shadow-2xl">
                  {shouldShowRoundsSkeleton ? (
                    <PlaylistWorkshopRoundsSkeleton />
                  ) : (
                    <>
                      <div className="mb-4 rounded-xl border border-purple-300/20 bg-purple-500/10 px-4 py-3 text-sm text-purple-50">
                        <p className="font-semibold uppercase tracking-[0.14em] text-purple-200">
                          {abbreviateNsfwText(t`How cum rounds work`, sfwMode)}
                        </p>
                        <p className="mt-2 text-purple-50/90">
                          {abbreviateNsfwText(
                            t`Cum rounds play after the main playlist reaches the end. The rounds you enable here become a random selection pool, and one of them will be chosen when the run finishes.`,
                            sfwMode
                          )}
                        </p>
                        <p className="mt-2 text-purple-50/90">
                          {abbreviateNsfwText(
                            t`If you leave this list empty, the game falls back to a random installed cum round instead of ending without one.`,
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
                              className={`rounded-2xl border px-3 py-3 ${selected
                                ? "border-emerald-300/60 bg-emerald-500/12 text-emerald-100"
                                : "border-zinc-600 bg-black/35 text-zinc-200"
                                }`}
                            >
                              <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
                                <div className="flex min-w-0 flex-1 flex-col gap-3 sm:flex-row sm:items-start">
                                  <WorkshopRoundPreview
                                    round={round}
                                    onOpenPreview={handlePlayRound}
                                  />
                                  <div className="min-w-0 flex-1">
                                    <div className="truncate text-sm font-semibold text-zinc-100">
                                      {round.name}
                                    </div>
                                    <div className="text-xs text-zinc-400">
                                      {round.author ?? getUnknownAuthorLabel()}
                                    </div>
                                    <div className="mt-1 flex flex-wrap gap-1.5 text-[11px]">
                                      <span className="rounded-full border border-zinc-600/70 bg-zinc-900/80 px-2 py-0.5 text-zinc-300">
                                        {formatDurationLabel(durationSec)}
                                      </span>
                                      {typeof round.difficulty === "number" && (
                                        <span className="rounded-full border border-zinc-600/70 bg-zinc-900/80 px-2 py-0.5 text-zinc-300">
                                          <Trans>Difficulty {round.difficulty}</Trans>
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
                                  className={`rounded-md border px-3 py-1 text-xs font-semibold uppercase tracking-[0.15em] ${selected
                                    ? "border-emerald-300/60 bg-emerald-500/20 text-emerald-100"
                                    : "border-zinc-600 bg-zinc-800 text-zinc-300"
                                    }`}
                                >
                                  {selected ? <Trans>Enabled</Trans> : <Trans>Disabled</Trans>}
                                </button>
                              </div>
                            </div>
                          );
                        })}
                        {cumRounds.length === 0 && (
                          <div className="rounded-xl border border-zinc-700 bg-black/30 px-3 py-2 text-sm text-zinc-400">
                            {abbreviateNsfwText(t`No cum rounds installed.`, sfwMode)}
                          </div>
                        )}
                      </div>
                    </>
                  )}
                </div>
              )}

              {/* ── Perks & Anti-Perks section ── */}
              {activeSectionId === "perks" && (
                <>
                  <div className="rounded-2xl border border-cyan-300/25 bg-cyan-500/10 p-4 text-sm text-cyan-50">
                    <p className="font-semibold uppercase tracking-[0.16em] text-cyan-200">
                      <Trans>How the system works</Trans>
                    </p>
                    <p className="mt-2 text-cyan-50/90">
                      <Trans>
                        Perks are beneficial choices offered between completed rounds. Anti-perks
                        are harmful effects that can enter the same choice pool when enabled and can
                        also stay active across multiple rounds.
                      </Trans>
                    </p>
                    <p className="mt-2 text-cyan-50/80">
                      <Trans>
                        Trigger chance controls how often a perk choice appears. In singleplayer,
                        the computer can also randomly hit you with one of the enabled anti-perks
                        based on the anti-perk chance settings. The enabled lists below define what
                        can show up during a run.
                      </Trans>
                    </p>
                  </div>
                  <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
                    <div className="rounded-[1.75rem] border border-white/5 bg-black/20 p-6 backdrop-blur-2xl shadow-2xl">
                      <div className="mb-2 space-y-2">
                        <h3 className="text-sm font-semibold uppercase tracking-[0.14em] text-emerald-200">
                          <Trans>Perks</Trans>
                          <span className="ml-2 text-[11px] tracking-[0.12em] text-emerald-300/90">
                            <Trans>
                              {setup.enabledPerkIds.length}/{perks.length} active
                            </Trans>
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
                            <Trans>Activate all perks</Trans>
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
                            <Trans>Deactivate all perks</Trans>
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
                                  <span
                                    className={`text-xs ${selected ? "text-emerald-300" : "text-zinc-500"}`}
                                  >
                                    {selected ? "●" : "○"}
                                  </span>
                                  <span>
                                    <Trans>{perk.name}</Trans>
                                  </span>
                                  {perk.requiresHandy && (
                                    <span className="rounded border border-amber-500/40 bg-amber-500/15 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-[0.06em] text-amber-200/90">
                                      <Trans>Device</Trans>
                                    </span>
                                  )}
                                </span>
                                <span className="flex items-center gap-1.5">
                                  <span
                                    className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] ${selected
                                      ? "border-emerald-300/65 bg-emerald-500/25 text-emerald-50"
                                      : "border-zinc-600 bg-zinc-800/85 text-zinc-300"
                                      }`}
                                  >
                                    {selected ? <Trans>Active</Trans> : <Trans>Inactive</Trans>}
                                  </span>
                                  <span
                                    className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] ${rarityMeta.tailwind.badge}`}
                                  >
                                    <Trans>{rarityMeta.label}</Trans>
                                  </span>
                                </span>
                              </div>
                              <p
                                className={`mt-2 text-xs leading-5 ${selected ? "text-emerald-50/90" : "text-zinc-300"}`}
                              >
                                <Trans>{perk.description}</Trans>
                              </p>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                    <div className="rounded-[1.75rem] border border-white/5 bg-black/20 p-6 backdrop-blur-2xl shadow-2xl">
                      <div className="mb-2 space-y-2">
                        <h3 className="text-sm font-semibold uppercase tracking-[0.14em] text-rose-200">
                          <Trans>Anti-Perks</Trans>
                          <span className="ml-2 text-[11px] tracking-[0.12em] text-rose-300/90">
                            <Trans>
                              {setup.enabledAntiPerkIds.length}/{antiPerks.length} active
                            </Trans>
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
                            <Trans>Activate all anti-perks</Trans>
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
                            <Trans>Deactivate all anti-perks</Trans>
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
                                  <span
                                    className={`text-xs ${selected ? "text-rose-300" : "text-zinc-500"}`}
                                  >
                                    {selected ? "●" : "○"}
                                  </span>
                                  <span>
                                    <Trans>{perk.name}</Trans>
                                  </span>
                                  {perk.requiresHandy && (
                                    <span className="rounded border border-amber-500/40 bg-amber-500/15 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-[0.06em] text-amber-200/90">
                                      <Trans>Device</Trans>
                                    </span>
                                  )}
                                </span>
                                <span className="flex items-center gap-1.5">
                                  <span
                                    className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] ${selected
                                      ? "border-rose-300/65 bg-rose-500/25 text-rose-50"
                                      : "border-zinc-600 bg-zinc-800/85 text-zinc-300"
                                      }`}
                                  >
                                    {selected ? <Trans>Active</Trans> : <Trans>Inactive</Trans>}
                                  </span>
                                  <span
                                    className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] ${rarityMeta.tailwind.badge}`}
                                  >
                                    <Trans>{rarityMeta.label}</Trans>
                                  </span>
                                </span>
                              </div>
                              <p
                                className={`mt-2 text-xs leading-5 ${selected ? "text-rose-50/90" : "text-zinc-300"}`}
                              >
                                <Trans>{perk.description}</Trans>
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
                      <span>🎲</span> <Trans>Dice Roll Limits</Trans>
                    </h3>
                    <div className="grid grid-cols-2 gap-6">
                      <div className="space-y-2">
                        <label
                          htmlFor="playlist-workshop-dice-min"
                          className="text-xs font-bold text-white/40 uppercase tracking-wider"
                        >
                          <Trans>Minimum Roll</Trans>
                        </label>
                        <input
                          id="playlist-workshop-dice-min"
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
                        <label
                          htmlFor="playlist-workshop-dice-max"
                          className="text-xs font-bold text-white/40 uppercase tracking-wider"
                        >
                          <Trans>Maximum Roll</Trans>
                        </label>
                        <input
                          id="playlist-workshop-dice-max"
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
                      <Trans>
                        Controls the range of the dice used for movement. Default is 1 to 6.
                      </Trans>
                    </p>
                  </div>

                  <div className="bg-black/40 border border-white/10 rounded-xl p-6 backdrop-blur-md">
                    <NumberInput
                      label={t`Starting Money`}
                      description={t`Money available at the beginning of a new run from this playlist. Existing resumed runs keep their saved money.`}
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
                      label={t`Round Start Delay (sec)`}
                      description={t`Time to wait before each round starts. Set to 0 for instant transitions. Default is 20 seconds.`}
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
                      label={t`Perk Trigger Chance %`}
                      description={t`Base chance to roll a random perk after each completed round. This does not stack per round; the same chance is checked again each time.`}
                      value={percent(setup.perkTriggerChancePerRound)}
                      disabled={!isLinearEditable}
                      onChange={(value) =>
                        setSetup((prev) => ({ ...prev, perkTriggerChancePerRound: toRatio(value) }))
                      }
                    />
                    <NumberInput
                      label={t`Intermediary Initial %`}
                      description={t`Starting chance for an intermediary event before round 1. The run begins at this value, then uses the increase and max settings below to scale over time.`}
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
                      label={t`Intermediary Increase %`}
                      description={t`Additional intermediary chance added after each completed round. Example: 10% initial plus 5% increase becomes 15% on the next round, then 20%, until the max is reached.`}
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
                      label={t`Intermediary Max %`}
                      description={t`Hard cap for intermediary chance. Scaling stops increasing once this value is reached, even if more rounds are completed.`}
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
                      label={t`Anti-Perk Initial %`}
                      description={t`Starting chance for anti-perks at the beginning of the run. This is the first value used before any round-based scaling happens.`}
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
                      label={t`Anti-Perk Increase %`}
                      description={t`Additional anti-perk chance added after each completed round. The chance ramps up round by round until it hits the configured maximum.`}
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
                      label={t`Anti-Perk Max %`}
                      description={t`Hard cap for anti-perk chance. Once reached, later rounds keep using this maximum instead of growing further.`}
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
                      label={abbreviateNsfwText(t`Cum Round Bonus Score`, sfwMode)}
                      description={abbreviateNsfwText(
                        t`Bonus score granted when a cum round is completed successfully. This affects scoring only and does not influence trigger probabilities.`,
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
                label={t`Back`}
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
              showImportNotice(t`Playlist renamed.`);
            } catch (error) {
              console.error("Failed to rename playlist", error);
              showImportNotice(t`Failed to rename playlist.`, "error");
              throw error;
            }
          }}
          onEmptyName={() => showImportNotice(t`Playlist name cannot be empty.`, "error")}
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
              showImportNotice(t`Playlist created.`);
            } catch (error) {
              console.error("Failed to create playlist", error);
              showImportNotice(t`Failed to create playlist.`, "error");
              throw error;
            }
          }}
          onEmptyName={() => showImportNotice(t`Playlist name cannot be empty.`, "error")}
        />
      )}

      {deleteDialogOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4">
          <div className="w-full max-w-md rounded-2xl border border-rose-300/35 bg-zinc-950/90 p-5 shadow-2xl backdrop-blur-xl">
            <h2 className="text-lg font-bold text-rose-100">
              <Trans>Delete Playlist</Trans>
            </h2>
            <p className="mt-2 text-sm text-zinc-300">
              <Trans>
                Delete <span className="font-semibold text-zinc-100">{activePlaylist.name}</span>?
                This cannot be undone.
              </Trans>
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
                <Trans>Cancel</Trans>
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
                      showImportNotice(t`Playlist deleted.`);
                    } catch (error) {
                      console.error("Failed to delete playlist", error);
                      showImportNotice(t`Failed to delete playlist.`, "error");
                    } finally {
                      setDeletePending(false);
                    }
                  })();
                }}
                className="rounded-xl border border-rose-300/45 bg-rose-500/20 px-3 py-2 text-sm font-semibold text-rose-100 hover:bg-rose-500/35 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {deletePending ? <Trans>Deleting...</Trans> : <Trans>Delete</Trans>}
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
              ? t`Import with Selected Resolutions`
              : t`Apply Resolutions`
          }
          secondaryActionLabel={
            resolutionModalState.context === "import" ? t`Continue Unresolved` : undefined
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
                showImportNotice(
                  resolutionModalState.analysis.counts.missing > 0
                    ? getImportedUnresolvedSummary(resolutionModalState.analysis.counts.missing)
                    : t`Playlist imported.`,
                  resolutionModalState.analysis.counts.missing > 0 ? "info" : "success"
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
              showImportNotice(t`Playlist resolutions applied.`);
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
              showImportNotice(t`Playlist imported with unresolved refs preserved.`, "info");
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
      <ConfirmDialog
        isOpen={roundOrderConfirmAction !== null}
        title={roundOrderConfirmTitle}
        message={t`This changes the order of the entire selected round list. Continue?`}
        confirmLabel={roundOrderConfirmLabel}
        variant={roundOrderConfirmAction === "clear" ? "danger" : "warning"}
        onConfirm={confirmRoundOrderAction}
        onCancel={() => setRoundOrderConfirmAction(null)}
      />
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
            className={`rounded-xl border px-5 py-3 text-sm font-semibold shadow-2xl backdrop-blur-xl ${importNotice.tone === "error"
              ? "border-rose-300/40 bg-rose-950/85 text-rose-100 shadow-rose-500/20"
              : importNotice.tone === "info"
                ? "border-cyan-300/40 bg-cyan-950/85 text-cyan-100 shadow-cyan-500/20"
                : "border-emerald-300/40 bg-emerald-950/85 text-emerald-100 shadow-emerald-500/20"
              }`}
          >
            {importNotice.message}
          </div>
        </div>
      )}
    </div>
  );
}

function SortableRoundItem({
  round,
  queuePosition,
  durationSec,
  fieldIndex,
  isDisabled,
  onRemove,
  onOpenPreview,
}: {
  round: WorkshopInstalledRound;
  queuePosition: number | null;
  durationSec: number | null;
  fieldIndex: number | null;
  isDisabled: boolean;
  onRemove: (id: string) => void;
  onOpenPreview: (round: WorkshopInstalledRound) => void;
}) {
  const { t } = useLingui();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: round.id,
    disabled: isDisabled,
  });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
    zIndex: isDragging ? 50 : undefined,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      role="group"
      aria-label={t`Selected round ${round.name}`}
      className="group flex items-center gap-2 rounded-xl border border-emerald-300/15 bg-black/25 px-2 py-1.5 transition-colors hover:border-emerald-300/30 hover:bg-black/40"
    >
      {/* Drag handle */}
      <button
        type="button"
        {...attributes}
        {...listeners}
        disabled={isDisabled}
        aria-label={t`Drag to reorder`}
        title={t`Drag to reorder`}
        className="flex h-7 w-5 shrink-0 cursor-grab items-center justify-center rounded text-zinc-500 transition-colors hover:text-zinc-200 active:cursor-grabbing disabled:cursor-not-allowed disabled:opacity-30"
      >
        ⠿
      </button>

      {/* Queue number */}
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-emerald-500/20 font-[family-name:var(--font-jetbrains-mono)] text-[11px] font-bold text-emerald-200 tabular-nums">
        {queuePosition ?? "?"}
      </span>

      {/* Thumbnail */}
      <div className="shrink-0">
        <WorkshopRoundPreview round={round} onOpenPreview={onOpenPreview} />
      </div>

      {/* Info */}
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold leading-tight text-zinc-100">
          {round.name}
        </div>
        <div className="truncate text-[11px] text-zinc-400">
          {round.author ?? getUnknownAuthorLabel()}
        </div>
        <div className="mt-0.5 flex flex-wrap gap-1 text-[10px]">
          <span className="rounded border border-zinc-700/60 bg-zinc-900/70 px-1.5 py-px text-zinc-300">
            {formatDurationLabel(durationSec ?? 0)}
          </span>
          {typeof round.difficulty === "number" && (
            <span className="rounded border border-zinc-700/60 bg-zinc-900/70 px-1.5 py-px text-zinc-300">
              <Trans>D{round.difficulty}</Trans>
            </span>
          )}
          {fieldIndex !== null && fieldIndex > 0 && (
            <span className="rounded border border-zinc-700/60 bg-zinc-900/70 px-1.5 py-px text-zinc-300">
              <Trans>F{fieldIndex}</Trans>
            </span>
          )}
        </div>
      </div>

      {/* Remove */}
      <button
        type="button"
        disabled={isDisabled}
        onMouseEnter={playHoverSound}
        onClick={() => {
          playSelectSound();
          onRemove(round.id);
        }}
        aria-label={t`Remove from queue`}
        title={t`Remove from queue`}
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-rose-400/40 bg-rose-500/15 text-sm text-rose-300 transition-colors hover:border-rose-300/70 hover:bg-rose-500/30 hover:text-rose-100 disabled:cursor-not-allowed disabled:opacity-40"
      >
        ✕
      </button>
    </div>
  );
}

function WorkshopRoundPreview({
  round,
  onOpenPreview,
  intersectionRoot = null,
}: {
  round: WorkshopInstalledRound;
  onOpenPreview: (round: WorkshopInstalledRound) => void;
  intersectionRoot?: Element | null;
}) {
  const { t } = useLingui();
  const previewImage = "previewImage" in round ? (round.previewImage ?? null) : null;
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [isPreviewActive, setIsPreviewActive] = useState(false);
  const { elementRef, isVisible } = useVisibilityGate<HTMLDivElement>({
    root: intersectionRoot,
  });
  const shouldResolveMedia = isVisible || isPreviewActive;
  const { mediaResources, isLoading, loadMediaResources } = useInstalledRoundMedia(
    shouldResolveMedia ? round.id : null
  );
  const previewUri = mediaResources?.resources[0]?.videoUri ?? null;
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
    stopPreview();
    onOpenPreview(round);
  };

  return (
    <div
      ref={elementRef}
      className="group/video relative h-10 w-16 shrink-0 cursor-pointer overflow-hidden rounded-lg border border-violet-300/25 bg-gradient-to-br from-[#1b1130] via-[#120a25] to-[#0d1a33]"
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
      tabIndex={0}
      role="button"
      aria-label={t`Open ${round.name}`}
    >
      {previewImage && (
        <SfwGuard>
          <img
            src={previewImage}
            alt={t`${round.name} preview`}
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
              void video.play().catch(() => { });
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
                  void video.play().catch(() => { });
                }
              }
            }}
            onEnded={() => {
              if (!isPreviewActive) return;
              const video = videoRef.current;
              if (!video) return;
              const { startSec } = resolvePreviewWindow(video);
              video.currentTime = startSec;
              void video.play().catch(() => { });
            }}
          />
        </SfwGuard>
      ) : !previewImage ? (
        <div className="flex h-full items-center justify-center text-[8px] font-[family-name:var(--font-jetbrains-mono)] uppercase tracking-[0.15em] text-zinc-500">
          {isLoading ? <Trans>…</Trans> : <Trans>No Preview</Trans>}
        </div>
      ) : null}

      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/70 via-black/15 to-transparent" />

      {previewUri && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <span className="flex h-5 w-5 items-center justify-center rounded-full border border-white/45 bg-black/55 text-[9px] text-white opacity-0 transition-opacity duration-200 group-hover/video:opacity-100 group-focus-within/video:opacity-100">
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
      className={`rounded-xl border px-3 py-2 font-[family-name:var(--font-jetbrains-mono)] text-xs uppercase tracking-[0.18em] ${disabled
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
        <h2 className="text-lg font-bold text-violet-100">
          <Trans>Rename Playlist</Trans>
        </h2>
        <p className="mt-2 text-sm text-zinc-300">
          <Trans>Choose a new name for this playlist.</Trans>
        </p>
        <div className="mt-4">
          <label
            htmlFor="playlist-rename-name"
            className="mb-2 block text-xs uppercase tracking-[0.2em] text-zinc-300"
          >
            <Trans>Playlist Name</Trans>
          </label>
          <input
            id="playlist-rename-name"
            type="text"
            value={draft}
            maxLength={120}
            onChange={(event) => setDraft(event.target.value)}
            onMouseEnter={playHoverSound}
            className="w-full rounded-xl border border-purple-300/30 bg-black/45 px-4 py-3 text-sm text-zinc-100 outline-none focus:border-purple-300/75 focus:ring-2 focus:ring-purple-400/30"
          />
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
            <Trans>Cancel</Trans>
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
            {pending ? <Trans>Renaming...</Trans> : <Trans>Rename</Trans>}
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
  const { t } = useLingui();
  const [name, setName] = useState(t`New Playlist`);
  const [mode, setMode] = useState<NewPlaylistMode>("fully-random");
  const [pending, setPending] = useState(false);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4">
      <div className="w-full max-w-xl rounded-2xl border border-violet-300/35 bg-zinc-950/90 p-5 shadow-2xl backdrop-blur-xl">
        <h2 className="text-lg font-bold text-violet-100">
          <Trans>Create Playlist</Trans>
        </h2>
        <p className="mt-2 text-sm text-zinc-300">
          <Trans>Set a name and choose how rounds are generated.</Trans>
        </p>
        <div className="mt-4">
          <label
            htmlFor="playlist-create-name"
            className="mb-2 block text-xs uppercase tracking-[0.2em] text-zinc-300"
          >
            <Trans>Playlist Name</Trans>
          </label>
          <input
            id="playlist-create-name"
            type="text"
            value={name}
            maxLength={120}
            onChange={(event) => setName(event.target.value)}
            onMouseEnter={playHoverSound}
            className="w-full rounded-xl border border-purple-300/30 bg-black/45 px-4 py-3 text-sm text-zinc-100 outline-none focus:border-purple-300/75 focus:ring-2 focus:ring-purple-400/30"
          />
        </div>
        <div className="mt-4 grid gap-2">
          <button
            type="button"
            onClick={() => setMode("fully-random")}
            className={`rounded-xl border px-4 py-3 text-left text-sm ${mode === "fully-random"
              ? "border-emerald-300/60 bg-emerald-500/20 text-emerald-100"
              : "border-zinc-600 bg-black/35 text-zinc-200"
              }`}
          >
            <div className="font-semibold">
              <Trans>Fully Random</Trans>
            </div>
            <div className="mt-1 text-xs text-zinc-300">
              <Trans>Shuffles normal rounds randomly without difficulty bias.</Trans>
            </div>
          </button>
          <button
            type="button"
            onClick={() => setMode("progressive-random")}
            className={`rounded-xl border px-4 py-3 text-left text-sm ${mode === "progressive-random"
              ? "border-violet-300/60 bg-violet-500/20 text-violet-100"
              : "border-zinc-600 bg-black/35 text-zinc-200"
              }`}
          >
            <div className="font-semibold">
              <Trans>Progressive Random</Trans>
            </div>
            <div className="mt-1 text-xs text-zinc-300">
              <Trans>
                Keeps randomness, but later rounds increasingly favor longer and higher-difficulty
                entries.
              </Trans>
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
            <Trans>Cancel</Trans>
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
            {pending ? <Trans>Creating...</Trans> : <Trans>Create</Trans>}
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
            className={`mb-1 w-full rounded-lg border px-3 py-2 text-left text-sm last:mb-0 ${item.tone === "danger"
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
        className={`flex items-center rounded-xl border bg-black/45 p-1 ${disabled ? "border-zinc-700 opacity-50" : "border-purple-300/30"
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
