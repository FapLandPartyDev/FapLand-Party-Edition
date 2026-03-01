import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  memo,
  startTransition,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import * as z from "zod";
import { AnimatedBackground } from "../components/AnimatedBackground";
import { SfwGuard } from "../components/SfwGuard";
import { RoundVideoOverlay } from "../components/game/RoundVideoOverlay";
import { buildPreviewRoundVideoOverlayProps } from "../components/game/buildRoundVideoOverlayProps";
import { InlineMetrics } from "../components/ui";
import { GameDropdown } from "../components/ui/GameDropdown";
import { ConfirmDialog } from "../components/ui/ConfirmDialog";
import { useToast } from "../components/ui/ToastHost";
import { useControllerSurface } from "../controller";
import type { ActiveRound } from "../game/types";
import {
  CURRENT_PLAYLIST_VERSION,
  type PlaylistConfig,
  type PortableRoundRef,
} from "../game/playlistSchema";
import { collectPlaylistRefs, createPortableRoundRefResolver } from "../game/playlistResolution";
import { getSinglePlayerAntiPerkPool, getSinglePlayerPerkPool } from "../game/data/perks";
import { MenuButton } from "../components/MenuButton";
import {
  db,
  type InstallFolderInspectionResult,
  type InstallFolderScanResult,
  type InstallScanStatus,
  type InstalledRound,
  type LegacyReviewedImportResult,
  type LibraryPackageExportResult,
  type VideoDownloadProgress,
  type WebsiteVideoScanStatus,
} from "../services/db";
import { playlists, type StoredPlaylist } from "../services/playlists";
import { trpc } from "../services/trpc";
import { importOpenedFile } from "../services/openedFiles";
import { buildRoundRenderRowsWithOptions, type RoundRenderRow } from "./roundRows";
import { usePlayableVideoFallback } from "../hooks/usePlayableVideoFallback";
import { useSfwMode } from "../hooks/useSfwMode";
import { playHoverSound, playSelectSound } from "../utils/audio";
import { formatDurationLabel, getRoundDurationSec } from "../utils/duration";
import { abbreviateNsfwText } from "../utils/sfwText";
import { VirtualizedRoundLibraryGrid } from "../features/library/components/VirtualizedRoundLibraryGrid";
import {
  buildPlaylistWebsiteCacheSummary,
  getInstalledRoundWebsiteVideoCacheStatus,
} from "../features/webVideo/cacheStatus";
import {
  DEFAULT_ROUND_PROGRESS_BAR_ALWAYS_VISIBLE,
  ROUND_PROGRESS_BAR_ALWAYS_VISIBLE_KEY,
  normalizeRoundProgressBarAlwaysVisible,
} from "../constants/roundVideoOverlaySettings";
import { DEFAULT_INTERMEDIARY_LOADING_PROMPT } from "../constants/booruSettings";
import {
  DEFAULT_CONTROLLER_SUPPORT_ENABLED,
  normalizeControllerSupportEnabled,
  DEFAULT_INSTALL_WEB_FUNSCRIPT_URL_ENABLED,
  INSTALL_WEB_FUNSCRIPT_URL_ENABLED_KEY,
  normalizeInstallWebFunscriptUrlEnabled,
} from "../constants/experimentalFeatures";

type TypeFilter = "all" | NonNullable<InstalledRound["type"]>;
type ScriptFilter = "all" | "installed" | "missing";
type SortMode = "newest" | "oldest" | "difficulty" | "bpm" | "length" | "name";
type GroupMode = "hero" | "playlist";
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
  resourceId: string | null;
  funscriptUri: string | null;
};
type HeroEditDraft = {
  id: string;
  name: string;
  author: string;
  description: string;
};
type DeleteRoundDialogState = {
  id: string;
  name: string;
};
type DeleteHeroDialogState = {
  id: string;
  name: string;
};
type HeroGroupRoundConversionState = {
  groupKey: string;
  heroId: string | null;
  heroName: string;
  roundIds: string[];
  keepRoundId: string;
  keepRoundName: string;
  roundsToDeleteCount: number;
  confirmationText: string;
  error: string | null;
};
type WebsiteRoundVideoValidationState =
  | { state: "idle"; message: null }
  | { state: "checking"; message: string }
  | { state: "supported"; message: string }
  | { state: "unsupported"; message: string };
type RoundTemplateRepairState = {
  roundId: string;
  roundName: string;
  installedRoundId: string;
};
type HeroTemplateRepairAssignment = {
  roundId: string;
  roundName: string;
  installedRoundId: string;
};
type HeroTemplateRepairState = {
  heroId: string;
  heroName: string;
  sourceHeroId: string;
  assignments: HeroTemplateRepairAssignment[];
};
type LegacyImportedSlot = NonNullable<
  LegacyReviewedImportResult["legacyImport"]
>["orderedSlots"][number];
type LegacyInspectionSlot = Extract<
  InstallFolderInspectionResult,
  { kind: "legacy" }
>["legacySlots"][number];
type LegacyImportReviewSlot = LegacyInspectionSlot & {
  selectedAsCheckpoint: boolean;
  excludedFromImport: boolean;
};
type LegacyPlaylistReviewState = {
  folderPath: string;
  slots: LegacyImportReviewSlot[];
  playlistName: string;
  createPlaylist: boolean;
  deferPhash: boolean;
  creating: boolean;
  error: string | null;
};
type InstalledDatabaseExportDialogState = {
  exportMode: "all" | "selected";
  includeMedia: boolean;
  asFpack: boolean;
  result: LibraryPackageExportResult | null;
  error: string | null;
};
type RoundSectionId = "library" | "transfer";
type RoundSection = {
  id: RoundSectionId;
  icon: string;
  title: string;
  description: string;
};
const INTERMEDIARY_LOADING_PROMPT_KEY = "game.intermediary.loadingPrompt";
const INTERMEDIARY_LOADING_DURATION_KEY = "game.intermediary.loadingDurationSec";
const INTERMEDIARY_RETURN_PAUSE_KEY = "game.intermediary.returnPauseSec";
const RoundsSearchSchema = z.object({
  open: z.enum(["install-rounds", "install-web"]).optional(),
});

const InstallScanStatusBadge = memo(function InstallScanStatusBadge({
  status,
}: {
  status: InstallScanStatus;
}) {
  const tone =
    status.state === "running"
      ? "border-cyan-300/60 bg-cyan-500/20 text-cyan-100"
      : status.state === "aborted"
        ? "border-amber-300/60 bg-amber-500/20 text-amber-100"
        : status.state === "error"
          ? "border-rose-300/60 bg-rose-500/20 text-rose-100"
          : "border-emerald-300/60 bg-emerald-500/20 text-emerald-100";

  const stats = status.stats;
  const processed =
    stats.installed + stats.updated + stats.skipped + stats.failed + stats.sidecarsSeen;
  const total = stats.totalSidecars;
  const progressText =
    total > 0 && status.state === "running" ? ` (${Math.round((processed / total) * 100)}%)` : "";

  const summary = `${stats.installed} rounds / ${stats.playlistsImported} playlists / ${stats.updated} updated / ${stats.failed} failed${progressText}`;
  const label =
    status.state === "running"
      ? `Scan running (${summary})`
      : status.state === "aborted"
        ? `Scan aborted (${summary})`
        : status.state === "error"
          ? `Scan error (${summary})`
          : `Last scan done (${summary})`;

  return (
    <div
      className={`rounded-xl border px-4 py-2 font-[family-name:var(--font-jetbrains-mono)] text-xs uppercase tracking-[0.24em] ${tone}`}
    >
      {label}
    </div>
  );
});

interface RoundsLibraryStatusPollerProps {
  onStatusChange: (status: InstallScanStatus | null) => void;
  onDataChanged: () => void | Promise<void>;
}

const RoundsLibraryStatusPoller = memo(
  ({ onStatusChange, onDataChanged }: RoundsLibraryStatusPollerProps) => {
    const [scanStatus, setScanStatus] = useState<InstallScanStatus | null>(null);
    const previousCountRef = useRef<number>(0);
    const previousStateRef = useRef<InstallScanStatus["state"] | null>(null);

    useEffect(() => {
      let mounted = true;

      const pollScanStatus = async () => {
        try {
          const status = await db.install.getScanStatus();
          if (!mounted) return;

          setScanStatus(status);
          onStatusChange(status);

          const currentCount = status.stats.installed + status.stats.updated;
          const countIncreased = currentCount > previousCountRef.current;
          const finishedNow = previousStateRef.current === "running" && status.state !== "running";

          if (countIncreased || finishedNow) {
            void onDataChanged();
          }

          previousStateRef.current = status.state;
          previousCountRef.current = currentCount;
        } catch (error) {
          console.error("Failed to poll library scan status", error);
        }
      };

      void pollScanStatus();
      const interval = window.setInterval(pollScanStatus, 2000);

      return () => {
        mounted = false;
        window.clearInterval(interval);
      };
    }, [onDataChanged, onStatusChange]);

    if (!scanStatus) {
      return (
        <div className="rounded-xl border border-emerald-300/30 bg-emerald-500/10 px-4 py-2 font-[family-name:var(--font-jetbrains-mono)] text-xs uppercase tracking-[0.24em] text-emerald-100">
          Library Idle
        </div>
      );
    }

    return <InstallScanStatusBadge status={scanStatus} />;
  }
);

RoundsLibraryStatusPoller.displayName = "RoundsLibraryStatusPoller";

const LibraryLastMessage = memo(() => {
  const [scanStatus, setScanStatus] = useState<InstallScanStatus | null>(null);

  useEffect(() => {
    let mounted = true;
    const poll = async () => {
      try {
        const status = await db.install.getScanStatus();
        if (mounted) setScanStatus(status);
      } catch (err) {
        console.error("Failed to poll scan status in message block", err);
      }
    };
    poll();
    const interval = window.setInterval(poll, 4000);
    return () => {
      mounted = false;
      window.clearInterval(interval);
    };
  }, []);

  if (!scanStatus?.lastMessage) return null;

  return (
    <div className="mt-4 rounded-2xl border border-zinc-700/70 bg-black/25 px-4 py-3 text-sm text-zinc-300">
      {scanStatus.lastMessage}
    </div>
  );
});

LibraryLastMessage.displayName = "LibraryLastMessage";

const LibraryTransferStats = memo(() => {
  const [scanStatus, setScanStatus] = useState<InstallScanStatus | null>(null);

  useEffect(() => {
    let mounted = true;
    const poll = async () => {
      try {
        const status = await db.install.getScanStatus();
        if (mounted) setScanStatus(status);
      } catch (err) {
        console.error("Failed to poll scan status in stats", err);
      }
    };
    poll();
    const interval = window.setInterval(poll, 2000);
    return () => {
      mounted = false;
      window.clearInterval(interval);
    };
  }, []);

  return (
    <>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h3 className="text-lg font-extrabold tracking-tight text-violet-100">
            Transfer Guidance
          </h3>
          <p className="mt-1 text-sm text-zinc-300">
            Keep the flow predictable: install from folders for bulk local content, use safe exports
            for portability, and only include URIs when the receiving machine expects them.
          </p>
        </div>
        {scanStatus && <InstallScanStatusBadge status={scanStatus} />}
      </div>
      <InlineMetrics
        className="mt-4"
        metrics={[
          { label: "Folders", value: scanStatus?.stats.scannedFolders ?? 0, tone: "violet" },
          { label: "Installed", value: scanStatus?.stats.installed ?? 0, tone: "emerald" },
          { label: "Playlists", value: scanStatus?.stats.playlistsImported ?? 0, tone: "cyan" },
          { label: "Failed", value: scanStatus?.stats.failed ?? 0, tone: "amber" },
        ]}
      />
    </>
  );
});
const DEFAULT_INTERMEDIARY_LOADING_DURATION_SEC = 5;
const DEFAULT_INTERMEDIARY_RETURN_PAUSE_SEC = 4;
const roundNameCollator = new Intl.Collator();
const ROUND_SECTIONS: RoundSection[] = [
  {
    id: "library",
    icon: "📚",
    title: "Library",
    description:
      "Browse, filter, and edit installed rounds with the main library view front and center.",
  },
  {
    id: "transfer",
    icon: "📦",
    title: "Import & Export",
    description:
      "Install new rounds, import portable files, and manage database exports from one place.",
  },
];

type IndexedRound = {
  round: InstalledRound;
  searchText: string;
  roundType: NonNullable<InstalledRound["type"]>;
  hasScript: boolean;
  createdAtMs: number;
  difficultyValue: number;
  bpmValue: number;
  lengthSec: number;
};

type PlaylistMembership = {
  playlistId: string;
  playlistName: string;
};

type SourceHeroOption = {
  heroId: string;
  heroName: string;
  rounds: InstalledRound[];
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
      triggerChancePerCompletedRound: 0.51,
    },
    perkPool: {
      enabledPerkIds: getSinglePlayerPerkPool().map((perk) => perk.id),
      enabledAntiPerkIds: getSinglePlayerAntiPerkPool().map((perk) => perk.id),
    },
    probabilityScaling: {
      initialIntermediaryProbability: 0.1,
      initialAntiPerkProbability: 0.1,
      intermediaryIncreasePerRound: 0.02,
      antiPerkIncreasePerRound: 0.015,
      maxIntermediaryProbability: 1,
      maxAntiPerkProbability: 0.75,
    },
    roundStartDelayMs: 20000,
    dice: { min: 1, max: 6 },
    economy: {
      startingMoney: 120,
      moneyPerCompletedRound: 50,
      startingScore: 0,
      scorePerCompletedRound: 100,
      scorePerIntermediary: 30,
      scorePerActiveAntiPerk: 25,
      scorePerCumRoundSuccess: 420,
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

function reloadUiAfterHeroGroupConversion() {
  if (typeof window === "undefined") return;
  if (/jsdom/i.test(window.navigator.userAgent)) return;
  window.location.reload();
}

async function refreshUiAfterHeroGroupConversion(refreshInstalledRounds: () => Promise<void>) {
  // First reconcile route-local state, then force a full refresh so derived UI catches up.
  await refreshInstalledRounds();
  reloadUiAfterHeroGroupConversion();
}

function toRoundEditDraft(round: InstalledRound): RoundEditDraft {
  const primaryResource = round.resources[0] ?? null;
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
    resourceId: primaryResource?.id ?? null,
    funscriptUri: primaryResource?.funscriptUri ?? null,
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
    searchText: [round.name, round.author ?? "", round.hero?.name ?? "", round.description ?? ""]
      .join("\n")
      .toLowerCase(),
    roundType: round.type ?? "Normal",
    hasScript: Boolean(round.resources[0]?.funscriptUri),
    createdAtMs: Date.parse(String(round.createdAt)) || 0,
    difficultyValue: round.difficulty ?? 0,
    bpmValue: round.bpm ?? 0,
    lengthSec: getRoundDurationSec(round),
  };
}

function isTemplateRound(round: InstalledRound): boolean {
  return round.resources.length === 0;
}

function normalizeHttpUrl(value: string): string | null {
  try {
    const parsed = new URL(value.trim());
    if (!(parsed.protocol === "http:" || parsed.protocol === "https:")) {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

const getInstalledRounds = async (
  includeDisabled = false,
  includeTemplates = true
): Promise<InstalledRound[]> => {
  try {
    return await db.round.findInstalled(includeDisabled, includeTemplates);
  } catch (error) {
    console.error("Error loading installed rounds", error);
    return [];
  }
};

const getAvailablePlaylists = async (): Promise<StoredPlaylist[]> => {
  try {
    return await playlists.list();
  } catch (error) {
    console.error("Error loading playlists", error);
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

const getRoundProgressBarAlwaysVisible = async (): Promise<boolean> => {
  try {
    const stored = await trpc.store.get.query({ key: ROUND_PROGRESS_BAR_ALWAYS_VISIBLE_KEY });
    return normalizeRoundProgressBarAlwaysVisible(stored);
  } catch (error) {
    console.warn("Failed to read round progress bar visibility from store", error);
    return DEFAULT_ROUND_PROGRESS_BAR_ALWAYS_VISIBLE;
  }
};

const getControllerSupportEnabled = async (): Promise<boolean> => {
  try {
    const stored = await trpc.store.get.query({ key: "experimental.controllerSupportEnabled" });
    return normalizeControllerSupportEnabled(stored);
  } catch (error) {
    console.warn("Failed to read controller support enabled from store", error);
    return DEFAULT_CONTROLLER_SUPPORT_ENABLED;
  }
};

const getInstallWebFunscriptUrlEnabled = async (): Promise<boolean> => {
  try {
    const stored = await trpc.store.get.query({ key: INSTALL_WEB_FUNSCRIPT_URL_ENABLED_KEY });
    return normalizeInstallWebFunscriptUrlEnabled(stored);
  } catch (error) {
    console.warn("Failed to read install web funscript URL setting from store", error);
    return DEFAULT_INSTALL_WEB_FUNSCRIPT_URL_ENABLED;
  }
};

export const Route = createFileRoute("/rounds")({
  validateSearch: (search) => RoundsSearchSchema.parse(search),
  loader: async () => {
    const [
      rounds,
      availablePlaylists,
      intermediaryLoadingPrompt,
      intermediaryLoadingDurationSec,
      intermediaryReturnPauseSec,
      roundProgressBarAlwaysVisible,
      controllerSupportEnabled,
      installWebFunscriptUrlEnabled,
    ] = await Promise.all([
      getInstalledRounds(),
      getAvailablePlaylists(),
      getIntermediaryLoadingPrompt(),
      getIntermediaryLoadingDurationSec(),
      getIntermediaryReturnPauseSec(),
      getRoundProgressBarAlwaysVisible(),
      getControllerSupportEnabled(),
      getInstallWebFunscriptUrlEnabled(),
    ]);
    return {
      rounds,
      availablePlaylists,
      intermediaryLoadingPrompt,
      intermediaryLoadingDurationSec,
      intermediaryReturnPauseSec,
      roundProgressBarAlwaysVisible,
      controllerSupportEnabled,
      installWebFunscriptUrlEnabled,
    };
  },
  component: InstalledRoundsPage,
});

export function InstalledRoundsPage() {
  const search = Route.useSearch();
  const sfwMode = useSfwMode();
  const {
    rounds: initialRounds,
    availablePlaylists: initialPlaylists,
    intermediaryLoadingPrompt,
    intermediaryLoadingDurationSec,
    intermediaryReturnPauseSec,
    roundProgressBarAlwaysVisible,
    controllerSupportEnabled,
    installWebFunscriptUrlEnabled,
  } = Route.useLoaderData();
  const { showToast } = useToast();
  const [deleteRoundDialog, setDeleteRoundDialog] = useState<DeleteRoundDialogState | null>(null);
  const [deleteHeroDialog, setDeleteHeroDialog] = useState<DeleteHeroDialogState | null>(null);
  const [rounds, setRounds] = useState<InstalledRound[]>(initialRounds);
  const [availablePlaylists, setAvailablePlaylists] = useState<StoredPlaylist[]>(initialPlaylists);
  const [showDisabledRounds, setShowDisabledRounds] = useState(false);
  const [disabledRoundIds, setDisabledRoundIds] = useState<Set<string>>(new Set());
  const [isStartingScan, setIsStartingScan] = useState(false);
  const [isExportingDatabase, setIsExportingDatabase] = useState(false);
  const [isInstallingWebsiteRound, setIsInstallingWebsiteRound] = useState(false);
  const [isLibraryScanning, setIsLibraryScanning] = useState(false);
  const [websiteVideoScanStatus, setWebsiteVideoScanStatus] =
    useState<WebsiteVideoScanStatus | null>(null);
  const [downloadProgresses, setDownloadProgresses] = useState<VideoDownloadProgress[]>([]);
  const [queryInput, setQueryInput] = useState("");
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [scriptFilter, setScriptFilter] = useState<ScriptFilter>("all");
  const [sortMode, setSortMode] = useState<SortMode>("newest");
  const [groupMode, setGroupMode] = useState<GroupMode>("hero");
  const [expandedHeroGroups, setExpandedHeroGroups] = useState<Record<string, boolean>>({});
  const [activePreviewRound, setActivePreviewRound] = useState<InstalledRound | null>(null);
  const [convertingHeroGroupKey, setConvertingHeroGroupKey] = useState<string | null>(null);
  const [heroGroupRoundConversion, setHeroGroupRoundConversion] =
    useState<HeroGroupRoundConversionState | null>(null);
  const [editingRound, setEditingRound] = useState<RoundEditDraft | null>(null);
  const [editingHero, setEditingHero] = useState<HeroEditDraft | null>(null);
  const [repairingTemplateRound, setRepairingTemplateRound] =
    useState<RoundTemplateRepairState | null>(null);
  const [repairingTemplateHero, setRepairingTemplateHero] =
    useState<HeroTemplateRepairState | null>(null);
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [showInstallOverlay, setShowInstallOverlay] = useState(false);
  const [isAbortingInstall, setIsAbortingInstall] = useState(false);
  const [legacyPlaylistReview, setLegacyPlaylistReview] =
    useState<LegacyPlaylistReviewState | null>(null);
  const [exportDialog, setExportDialog] = useState<InstalledDatabaseExportDialogState | null>(null);
  const [selectedRoundIds, setSelectedRoundIds] = useState<Set<string>>(new Set());
  const [selectedHeroIds, setSelectedHeroIds] = useState<Set<string>>(new Set());
  const [selectionMode, setSelectionMode] = useState(false);
  const [activeSectionId, setActiveSectionId] = useState<RoundSectionId>("library");
  const [websiteRoundName, setWebsiteRoundName] = useState("");
  const [websiteRoundNameEdited, setWebsiteRoundNameEdited] = useState(false);
  const [websiteRoundVideoUrl, setWebsiteRoundVideoUrl] = useState("");
  const [websiteRoundFunscriptUrl, setWebsiteRoundFunscriptUrl] = useState("");
  const [websiteRoundFunscriptFileUri, setWebsiteRoundFunscriptFileUri] = useState<string | null>(
    null
  );
  const [websiteRoundFunscriptFileLabel, setWebsiteRoundFunscriptFileLabel] = useState<
    string | null
  >(null);
  const [websiteRoundError, setWebsiteRoundError] = useState<string | null>(null);
  const [websiteRoundSuccess, setWebsiteRoundSuccess] = useState<string | null>(null);
  const [websiteRoundVideoValidation, setWebsiteRoundVideoValidation] =
    useState<WebsiteRoundVideoValidationState>({ state: "idle", message: null });
  const [websiteRoundDialogOpen, setWebsiteRoundDialogOpen] = useState(false);

  useEffect(() => {
    setRounds(initialRounds);
  }, [initialRounds]);

  useEffect(() => {
    setAvailablePlaylists(initialPlaylists);
  }, [initialPlaylists]);
  const [scrollContainer, setScrollContainer] = useState<HTMLDivElement | null>(null);
  const navigate = useNavigate();
  const deferredQuery = useDeferredValue(query);
  const websiteRoundVideoValidationRequestIdRef = useRef(0);
  const consumedPaletteOpenRef = useRef<typeof search.open | null>(null);

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

  const handleControllerBack = useCallback(() => {
    playSelectSound();
    goBack();
    return true;
  }, [goBack]);

  useControllerSurface({
    id: "rounds-page",
    priority: 10,
    enabled: controllerSupportEnabled,
    onBack: handleControllerBack,
  });

  useEffect(() => {
    if (!websiteRoundDialogOpen) {
      setWebsiteRoundVideoValidation({ state: "idle", message: null });
      return;
    }

    const trimmedVideoUrl = websiteRoundVideoUrl.trim();
    if (!trimmedVideoUrl) {
      setWebsiteRoundVideoValidation({ state: "idle", message: null });
      return;
    }

    const normalizedVideoUrl = normalizeHttpUrl(trimmedVideoUrl);
    if (!normalizedVideoUrl) {
      setWebsiteRoundVideoValidation({
        state: "unsupported",
        message: "Enter a valid public http(s) website video URL.",
      });
      return;
    }

    const requestId = ++websiteRoundVideoValidationRequestIdRef.current;
    setWebsiteRoundVideoValidation({
      state: "checking",
      message: "Checking website support...",
    });

    const timeoutId = window.setTimeout(() => {
      void db.round
        .checkWebsiteVideoSupport(normalizedVideoUrl)
        .then((result) => {
          if (websiteRoundVideoValidationRequestIdRef.current !== requestId) return;
          const sourceLabel = result.extractor ?? "yt-dlp";
          const titleSuffix = result.title ? `: ${result.title}` : "";
          if (!websiteRoundNameEdited && result.title) {
            setWebsiteRoundName(result.title);
          }
          setWebsiteRoundVideoValidation({
            state: "supported",
            message: `Supported via ${sourceLabel}${titleSuffix}`,
          });
        })
        .catch((error) => {
          if (websiteRoundVideoValidationRequestIdRef.current !== requestId) return;
          setWebsiteRoundVideoValidation({
            state: "unsupported",
            message:
              error instanceof Error ? error.message : "This website video URL is not supported.",
          });
        });
    }, 400);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [websiteRoundDialogOpen, websiteRoundNameEdited, websiteRoundVideoUrl]);

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
    [activePreviewRound]
  );
  const previewOverlayProps = useMemo(
    () =>
      buildPreviewRoundVideoOverlayProps({
        activeRound: activePreview,
        installedRounds: rounds,
        intermediaryProbability: 1,
        booruSearchPrompt: intermediaryLoadingPrompt,
        intermediaryLoadingDurationSec,
        intermediaryReturnPauseSec,
        initialShowProgressBarAlways: roundProgressBarAlwaysVisible,
        onClose: () => {
          setActivePreviewRound(null);
        },
        onFinishRound: () => {
          setActivePreviewRound(null);
        },
      }),
    [
      activePreview,
      intermediaryLoadingDurationSec,
      intermediaryLoadingPrompt,
      intermediaryReturnPauseSec,
      roundProgressBarAlwaysVisible,
      rounds,
    ]
  );
  const refreshInstalledRounds = useCallback(async () => {
    const [refreshed, disabledIds] = await Promise.all([
      getInstalledRounds(showDisabledRounds),
      getDisabledRoundIds(),
    ]);
    setRounds(refreshed);
    setDisabledRoundIds(disabledIds);
  }, [showDisabledRounds]);

  const refreshAvailablePlaylists = useCallback(async () => {
    const next = await getAvailablePlaylists();
    setAvailablePlaylists(next);
  }, []);

  useEffect(() => {
    let mounted = true;
    void (async () => {
      const [next, disabledIds] = await Promise.all([
        getInstalledRounds(showDisabledRounds),
        getDisabledRoundIds(),
      ]);
      if (!mounted) return;
      setRounds(next);
      setDisabledRoundIds(disabledIds);
    })();
    return () => {
      mounted = false;
    };
  }, [showDisabledRounds]);

  useEffect(() => {
    let mounted = true;
    let previousState: string | null = null;
    let hadActiveProgress = false;

    const pollWebsiteVideoScanStatus = async () => {
      try {
        const [status, progresses] = await Promise.all([
          db.webVideoCache.getScanStatus(),
          db.webVideoCache.getDownloadProgresses(),
        ]);
        if (!mounted) return;
        setWebsiteVideoScanStatus(status);
        setDownloadProgresses(progresses);

        const hasActiveProgress = progresses.length > 0;
        const scanJustFinished = previousState === "running" && status.state !== "running";
        const downloadsJustFinished = hadActiveProgress && !hasActiveProgress;

        if (scanJustFinished || downloadsJustFinished) {
          void refreshInstalledRounds();
        }

        previousState = status.state;
        hadActiveProgress = hasActiveProgress;
      } catch (error) {
        console.error("Failed to poll website video scan status", error);
      }
    };

    void pollWebsiteVideoScanStatus();
    const interval = window.setInterval(pollWebsiteVideoScanStatus, 2000);

    return () => {
      mounted = false;
      window.clearInterval(interval);
    };
  }, [refreshInstalledRounds]);

  const downloadProgressByUri = useMemo(() => {
    const map = new Map<string, VideoDownloadProgress>();
    for (const progress of downloadProgresses) {
      map.set(progress.url, progress);
    }
    return map;
  }, [downloadProgresses]);

  const aggregateDownloadProgress = useMemo(() => {
    if (downloadProgresses.length === 0) return null;
    const totalPercent = downloadProgresses.reduce((sum, p) => sum + p.percent, 0);
    const avgPercent = Math.round(totalPercent / downloadProgresses.length);
    const totalDownloaded = downloadProgresses.reduce(
      (sum, p) => sum + (p.downloadedBytes ?? 0),
      0
    );
    const totalSize = downloadProgresses.reduce((sum, p) => sum + (p.totalBytes ?? 0), 0);
    return { count: downloadProgresses.length, avgPercent, totalDownloaded, totalSize };
  }, [downloadProgresses]);

  const getDownloadProgressForVideoUri = useCallback(
    (videoUri: string): VideoDownloadProgress | null => {
      try {
        const uri = videoUri.trim();
        if (uri.startsWith("app://external/web-url?")) {
          const parsed = new URL(uri);
          const target = parsed.searchParams.get("target");
          if (target) {
            const targetUrl = new URL(target);
            targetUrl.hash = "";
            return downloadProgressByUri.get(targetUrl.toString()) ?? null;
          }
        }
        if (/^https?:\/\//i.test(uri)) {
          const url = new URL(uri);
          url.hash = "";
          return downloadProgressByUri.get(url.toString()) ?? null;
        }
      } catch {
        return null;
      }
      return null;
    },
    [downloadProgressByUri]
  );

  const indexedRounds = useMemo(() => rounds.map(toIndexedRound), [rounds]);
  const sortedRoundEntries = useMemo(() => {
    const newest = [...indexedRounds].sort((a, b) => b.createdAtMs - a.createdAtMs);
    const oldest = [...indexedRounds].sort((a, b) => a.createdAtMs - b.createdAtMs);
    const difficulty = [...indexedRounds].sort((a, b) => b.difficultyValue - a.difficultyValue);
    const bpm = [...indexedRounds].sort((a, b) => b.bpmValue - a.bpmValue);
    const length = [...indexedRounds].sort((a, b) => b.lengthSec - a.lengthSec);
    const name = [...indexedRounds].sort((a, b) =>
      roundNameCollator.compare(a.round.name, b.round.name)
    );

    return { newest, oldest, difficulty, bpm, length, name };
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
  const playlistsByRoundId = useMemo(() => {
    if (groupMode !== "playlist") return null;

    const roundResolver = createPortableRoundRefResolver(rounds);
    const memberships = new Map<string, PlaylistMembership[]>();

    for (const playlist of availablePlaylists) {
      const seenRoundIds = new Set<string>();
      for (const entry of collectPlaylistRefs(playlist.config)) {
        const resolved = roundResolver.resolve(entry.ref);
        if (!resolved || seenRoundIds.has(resolved.id)) continue;
        seenRoundIds.add(resolved.id);
        const existing = memberships.get(resolved.id);
        const membership = { playlistId: playlist.id, playlistName: playlist.name };
        if (existing) {
          existing.push(membership);
        } else {
          memberships.set(resolved.id, [membership]);
        }
      }
    }

    return memberships;
  }, [availablePlaylists, groupMode, rounds]);
  const playlistWebsiteCacheSummaryById = useMemo(
    () => buildPlaylistWebsiteCacheSummary(availablePlaylists, rounds),
    [availablePlaylists, rounds]
  );
  const activeSection =
    ROUND_SECTIONS.find((section) => section.id === activeSectionId) ?? ROUND_SECTIONS[0];
  const standaloneRoundCount = useMemo(
    () => rounds.filter((round) => !round.heroId && !round.hero).length,
    [rounds]
  );
  const heroGroupCount = useMemo(() => {
    const groupKeys = new Set<string>();
    rounds.forEach((round) => {
      const heroKey = round.heroId ?? round.hero?.name;
      if (heroKey) {
        groupKeys.add(heroKey);
      }
    });
    return groupKeys.size;
  }, [rounds]);
  const roundsWithScriptCount = useMemo(
    () => rounds.filter((round) => Boolean(round.resources[0]?.funscriptUri)).length,
    [rounds]
  );
  const sourceHeroOptions = useMemo<SourceHeroOption[]>(() => {
    const groups = new Map<string, SourceHeroOption>();
    for (const round of rounds) {
      if (!round.heroId || !round.hero || isTemplateRound(round)) continue;
      const existing = groups.get(round.heroId);
      if (existing) {
        existing.rounds.push(round);
        continue;
      }
      groups.set(round.heroId, {
        heroId: round.heroId,
        heroName: round.hero.name,
        rounds: [round],
      });
    }
    return [...groups.values()].sort((a, b) => a.heroName.localeCompare(b.heroName));
  }, [rounds]);
  const hasActiveFilters =
    queryInput.trim().length > 0 || typeFilter !== "all" || scriptFilter !== "all";
  const activeFilterCount =
    Number(queryInput.trim().length > 0) +
    Number(typeFilter !== "all") +
    Number(scriptFilter !== "all");
  const actionButtonsDisabled =
    isStartingScan || isExportingDatabase || isInstallingWebsiteRound || isLibraryScanning;
  const scanRunning = isStartingScan || isLibraryScanning;
  const sortModeLabel =
    sortMode === "oldest"
      ? "Oldest"
      : sortMode === "difficulty"
        ? "Difficulty"
        : sortMode === "bpm"
          ? "BPM"
          : sortMode === "length"
            ? "Length"
            : sortMode === "name"
              ? "Name"
              : "Newest";
  const groupModeLabel = groupMode === "playlist" ? "Playlist" : "Hero";
  const highestFilteredDifficulty = useMemo(
    () => filteredRounds.reduce((max, round) => Math.max(max, round.difficulty ?? 0), 0),
    [filteredRounds]
  );
  const renderRows = useMemo(
    () =>
      buildRoundRenderRowsWithOptions(
        filteredRounds,
        groupMode === "playlist"
          ? { mode: "playlist", playlistsByRoundId: playlistsByRoundId ?? new Map() }
          : { mode: "hero" }
      ),
    [filteredRounds, groupMode, playlistsByRoundId]
  );
  const visibleGroupKeys = useMemo(
    () =>
      renderRows
        .filter(
          (row): row is Extract<RoundRenderRow, { kind: "hero-group" | "playlist-group" }> =>
            row.kind !== "standalone"
        )
        .map((row) => row.groupKey),
    [renderRows]
  );
  const allVisibleGroupsExpanded =
    visibleGroupKeys.length > 0 &&
    visibleGroupKeys.every((groupKey) => Boolean(expandedHeroGroups[groupKey]));
  const expandedGroupKeySet = useMemo(
    () => new Set(visibleGroupKeys.filter((groupKey) => Boolean(expandedHeroGroups[groupKey]))),
    [expandedHeroGroups, visibleGroupKeys]
  );
  const handleConvertRoundToHero = useCallback(
    (round: InstalledRound) => {
      handleSelectSfx();
      void navigate({
        to: "/converter",
        search: {
          sourceRoundId: round.id,
          heroName: round.name,
        },
      });
    },
    [handleSelectSfx, navigate]
  );
  const handlePlayRound = useCallback(
    (round: InstalledRound) => {
      if (getInstalledRoundWebsiteVideoCacheStatus(round) === "pending") {
        return;
      }
      handleSelectSfx();
      setActivePreviewRound(round);
    },
    [handleSelectSfx, rounds.length]
  );
  const handleEditRound = useCallback(
    (round: InstalledRound) => {
      handleSelectSfx();
      setEditingRound(toRoundEditDraft(round));
    },
    [handleSelectSfx]
  );

  useEffect(() => {
    const visibleSet = new Set(visibleGroupKeys);
    setExpandedHeroGroups((previous) => {
      const nextEntries = Object.entries(previous).filter(([key]) => visibleSet.has(key));
      if (nextEntries.length === Object.keys(previous).length) {
        return previous;
      }
      return Object.fromEntries(nextEntries);
    });
  }, [visibleGroupKeys]);

  const scanNow = async () => {
    if (isStartingScan || isLibraryScanning) return;
    setIsStartingScan(true);
    try {
      await db.install.scanNow();
      await refreshInstalledRounds();
    } catch (error) {
      console.error("Failed to scan install folders", error);
    } finally {
      setIsStartingScan(false);
    }
  };

  const createLegacyPlaylistFromImport = useCallback(
    async (result: InstallFolderScanResult, playlistName: string) => {
      if (!result.legacyImport || result.legacyImport.orderedSlots.length === 0) return;
      const created = await playlists.create({
        name: playlistName,
        config: toLegacyPlaylistConfig(result.legacyImport.orderedSlots),
      });
      await playlists.setActive(created.id);
      await refreshAvailablePlaylists();
    },
    [refreshAvailablePlaylists]
  );

  const installRoundsFromFolder = async () => {
    if (isStartingScan || isLibraryScanning) return;

    try {
      const selectedFolders = await window.electronAPI.dialog.selectFolders();
      const folderPath = selectedFolders[0];
      if (!folderPath) return;

      setIsStartingScan(true);
      setIsAbortingInstall(false);
      setLegacyPlaylistReview(null);
      const inspection = await db.install.inspectFolder(folderPath);
      if (inspection.kind === "empty") {
        showToast("No supported video files found in selected folder.", "error");
        return;
      }

      if (inspection.kind === "legacy") {
        setLegacyPlaylistReview({
          folderPath: inspection.folderPath,
          playlistName: inspection.playlistNameHint.trim() || "Legacy Playlist",
          createPlaylist: true,
          deferPhash: true,
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
      await db.install.scanFolderOnce(inspection.folderPath, true);
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
    if (isStartingScan || isExportingDatabase || isLibraryScanning) return;

    try {
      const filePath = await window.electronAPI.dialog.selectInstallImportFile();
      if (!filePath) return;

      setIsStartingScan(true);
      setIsAbortingInstall(false);
      setLegacyPlaylistReview(null);
      setShowInstallOverlay(true);

      const result = await importOpenedFile(filePath);
      if (result.kind === "sidecar") {
        await refreshInstalledRounds();
        return;
      }

      if (result.kind === "playlist") {
        await refreshAvailablePlaylists();
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
      await db.install.abortScan();
    } catch (error) {
      console.error("Failed to abort round import", error);
      setIsAbortingInstall(false);
    }
  };

  useEffect(() => {
    if (!search.open) {
      consumedPaletteOpenRef.current = null;
      return;
    }
    if (consumedPaletteOpenRef.current === search.open) {
      return;
    }

    consumedPaletteOpenRef.current = search.open;
    setActiveSectionId("transfer");
    void navigate({
      to: "/rounds",
      search: {},
      replace: true,
    });

    if (search.open === "install-web") {
      setWebsiteRoundDialogOpen(true);
      return;
    }

    void installRoundsFromFolder();
  }, [installRoundsFromFolder, navigate, search.open]);

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
            slot.id === slotId
              ? { ...slot, selectedAsCheckpoint: !slot.selectedAsCheckpoint }
              : slot
          ),
        }
        : null
    );
  };

  const toggleLegacyImportExclusion = (slotId: string) => {
    setLegacyPlaylistReview((current) =>
      current
        ? {
          ...current,
          error: null,
          slots: current.slots.map((slot) =>
            slot.id === slotId ? { ...slot, excludedFromImport: !slot.excludedFromImport } : slot
          ),
        }
        : null
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
        : null
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
        legacyPlaylistReview.deferPhash
      );
      await refreshInstalledRounds();
      if (result.status.state !== "done" || !result.legacyImport) {
        setLegacyPlaylistReview((current) =>
          current
            ? {
              ...current,
              creating: false,
              error: result.status.lastMessage ?? "Legacy import did not finish.",
            }
            : null
        );
        return;
      }
      if (shouldCreatePlaylist) {
        await createLegacyPlaylistFromImport(
          {
            status: result.status,
            legacyImport: result.legacyImport,
          },
          playlistName
        );
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
          : null
      );
    } finally {
      setShowInstallOverlay(false);
      setIsAbortingInstall(false);
    }
  };

  const openExportDatabaseDialog = () => {
    if (isExportingDatabase || isStartingScan || isLibraryScanning) return;
    setExportDialog({
      exportMode: selectedRoundIds.size > 0 || selectedHeroIds.size > 0 ? "selected" : "all",
      includeMedia: true,
      asFpack: false,
      result: null,
      error: null,
    });
  };

  const exportInstalledDatabase = async () => {
    if (!exportDialog || isExportingDatabase || isStartingScan || isLibraryScanning) return;

    try {
      const directoryPath =
        await window.electronAPI.dialog.selectPlaylistExportDirectory("Installed Library");
      if (!directoryPath) return;

      setIsExportingDatabase(true);
      const result = await db.install.exportPackage({
        roundIds: exportDialog.exportMode === "selected" ? Array.from(selectedRoundIds) : undefined,
        heroIds: exportDialog.exportMode === "selected" ? Array.from(selectedHeroIds) : undefined,
        includeMedia: exportDialog.includeMedia,
        asFpack: exportDialog.asFpack,
        directoryPath,
      });
      setExportDialog((current) =>
        current
          ? {
            ...current,
            result,
            error: null,
          }
          : current
      );
    } catch (error) {
      console.error("Failed to export library package", error);
      setExportDialog((current) =>
        current
          ? {
            ...current,
            error: error instanceof Error ? error.message : "Failed to export library package.",
          }
          : current
      );
    } finally {
      setIsExportingDatabase(false);
    }
  };

  const selectWebsiteRoundFunscriptFile = async () => {
    if (actionButtonsDisabled) return;

    try {
      const filePath = await window.electronAPI.dialog.selectConverterFunscriptFile();
      if (!filePath) return;

      const converted = window.electronAPI.file.convertFileSrc(filePath);
      setWebsiteRoundFunscriptFileUri(converted);
      setWebsiteRoundFunscriptFileLabel(filePath.split(/[/\\]/).pop() ?? filePath);
      setWebsiteRoundFunscriptUrl("");
      setWebsiteRoundError(null);
      setWebsiteRoundSuccess(null);
    } catch (error) {
      console.error("Failed to select website round funscript", error);
      showToast(
        error instanceof Error ? error.message : "Failed to attach the selected funscript file.",
        "error"
      );
    }
  };

  const installWebsiteRound = async () => {
    if (actionButtonsDisabled) return;

    const trimmedName = websiteRoundName.trim();
    if (!trimmedName) {
      setWebsiteRoundError("Enter a round name before installing.");
      setWebsiteRoundSuccess(null);
      return;
    }

    const normalizedVideoUrl = normalizeHttpUrl(websiteRoundVideoUrl);
    if (!normalizedVideoUrl) {
      setWebsiteRoundError("Enter a valid public http(s) website video URL.");
      setWebsiteRoundSuccess(null);
      return;
    }

    if (websiteRoundVideoValidation.state === "checking") {
      setWebsiteRoundError("Wait until the website video URL support check finishes.");
      setWebsiteRoundSuccess(null);
      return;
    }

    if (websiteRoundVideoValidation.state === "unsupported") {
      setWebsiteRoundError(websiteRoundVideoValidation.message);
      setWebsiteRoundSuccess(null);
      return;
    }

    const trimmedFunscriptUrl = websiteRoundFunscriptUrl.trim();
    const normalizedFunscriptUrl =
      trimmedFunscriptUrl.length > 0 ? normalizeHttpUrl(trimmedFunscriptUrl) : null;
    if (trimmedFunscriptUrl.length > 0 && !normalizedFunscriptUrl) {
      setWebsiteRoundError("Funscript URL must also be a valid http(s) URL.");
      setWebsiteRoundSuccess(null);
      return;
    }

    setIsInstallingWebsiteRound(true);
    setWebsiteRoundError(null);
    setWebsiteRoundSuccess(null);
    try {
      await db.round.createWebsiteRound({
        name: trimmedName,
        videoUri: normalizedVideoUrl,
        funscriptUri: websiteRoundFunscriptFileUri ?? normalizedFunscriptUrl,
      });
      await refreshInstalledRounds();
      setWebsiteRoundName("");
      setWebsiteRoundNameEdited(false);
      setWebsiteRoundVideoUrl("");
      setWebsiteRoundFunscriptUrl("");
      setWebsiteRoundFunscriptFileUri(null);
      setWebsiteRoundFunscriptFileLabel(null);
      setWebsiteRoundVideoValidation({ state: "idle", message: null });
      setWebsiteRoundSuccess(`Installed "${trimmedName}".`);
    } catch (error) {
      console.error("Failed to install website round", error);
      setWebsiteRoundError(
        error instanceof Error ? error.message : "Failed to install the website round."
      );
    } finally {
      setIsInstallingWebsiteRound(false);
    }
  };

  const toggleHeroGroupSelection = useCallback(
    (group: Extract<RoundRenderRow, { kind: "hero-group" }>) => {
      const groupRoundIds = group.rounds.map((r) => r.id);
      const heroId = group.rounds[0]?.heroId;
      const allRoundsSelected = groupRoundIds.every((id) => selectedRoundIds.has(id));
      const heroSelected = heroId ? selectedHeroIds.has(heroId) : false;

      if (allRoundsSelected && heroSelected) {
        setSelectedRoundIds((prev) => {
          const next = new Set(prev);
          for (const id of groupRoundIds) next.delete(id);
          return next;
        });
        if (heroId) {
          setSelectedHeroIds((prev) => {
            const next = new Set(prev);
            next.delete(heroId);
            return next;
          });
        }
      } else {
        setSelectedRoundIds((prev) => {
          const next = new Set(prev);
          for (const id of groupRoundIds) next.add(id);
          return next;
        });
        if (heroId) {
          setSelectedHeroIds((prev) => {
            const next = new Set(prev);
            next.add(heroId);
            return next;
          });
        }
      }
    },
    [selectedRoundIds, selectedHeroIds]
  );

  const openHeroGroupRoundConversion = (group: Extract<RoundRenderRow, { kind: "hero-group" }>) => {
    const roundToKeep = pickHeroGroupRoundToKeep(group.rounds);
    if (!roundToKeep) return;

    setHeroGroupRoundConversion({
      groupKey: group.groupKey,
      heroId: group.rounds[0]?.heroId ?? null,
      heroName: group.heroName,
      roundIds: group.rounds.map((round) => round.id),
      keepRoundId: roundToKeep.id,
      keepRoundName: roundToKeep.name,
      roundsToDeleteCount: Math.max(0, group.rounds.length - 1),
      confirmationText: "",
      error: null,
    });
  };

  const confirmHeroGroupRoundConversion = async () => {
    if (!heroGroupRoundConversion) return;
    if (
      heroGroupRoundConversion.confirmationText.trim().toLocaleLowerCase() !==
      heroGroupRoundConversion.heroName.trim().toLocaleLowerCase()
    ) {
      setHeroGroupRoundConversion((current) =>
        current
          ? { ...current, error: "Confirmation text did not match. No changes were made." }
          : current
      );
      return;
    }

    setConvertingHeroGroupKey(heroGroupRoundConversion.groupKey);
    try {
      await db.round.convertHeroGroupToRound({
        keepRoundId: heroGroupRoundConversion.keepRoundId,
        roundIds: heroGroupRoundConversion.roundIds,
        heroId: heroGroupRoundConversion.heroId,
        roundName: heroGroupRoundConversion.heroName,
      });
      setHeroGroupRoundConversion(null);
      await refreshUiAfterHeroGroupConversion(refreshInstalledRounds);
    } catch (error) {
      console.error("Failed to convert hero group back to a round", error);
      showToast(
        error instanceof Error ? error.message : "Failed to convert hero group back to a round.",
        "error"
      );
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
      showToast("Round fields must use valid numeric values.", "error");
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
        funscriptUri: editingRound.resourceId ? editingRound.funscriptUri : undefined,
        type: editingRound.type,
      });
      setEditingRound(null);
      await refreshInstalledRounds();
    } catch (error) {
      console.error("Failed to update round", error);
      showToast(error instanceof Error ? error.message : "Failed to update round.", "error");
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
      showToast(error instanceof Error ? error.message : "Failed to update hero.", "error");
    } finally {
      setIsSavingEdit(false);
    }
  };

  const confirmDeleteRound = useCallback(async () => {
    if (!deleteRoundDialog || isSavingEdit) return;
    setDeleteRoundDialog(null);

    setIsSavingEdit(true);
    try {
      await db.round.delete(deleteRoundDialog.id);
      setEditingRound((current) => (current?.id === deleteRoundDialog.id ? null : current));
      await refreshInstalledRounds();
    } catch (error) {
      console.error("Failed to delete round", error);
      showToast(error instanceof Error ? error.message : "Failed to delete round.", "error");
    } finally {
      setIsSavingEdit(false);
    }
  }, [deleteRoundDialog, isSavingEdit, refreshInstalledRounds, showToast]);

  const deleteRoundEntry = () => {
    if (!editingRound || isSavingEdit) return;
    const persistedRoundName =
      rounds.find((round) => round.id === editingRound.id)?.name ?? editingRound.name;
    setDeleteRoundDialog({
      id: editingRound.id,
      name: editingRound.name.trim() || persistedRoundName.trim(),
    });
  };

  const confirmDeleteHero = useCallback(
    async () => {
      if (!deleteHeroDialog || isSavingEdit) return;
      setDeleteHeroDialog(null);

      setIsSavingEdit(true);
      try {
        await db.hero.delete(deleteHeroDialog.id);
        setEditingHero((current) => (current?.id === deleteHeroDialog.id ? null : current));
        await refreshInstalledRounds();
      } catch (error) {
        console.error("Failed to delete hero", error);
        showToast(error instanceof Error ? error.message : "Failed to delete hero.", "error");
      } finally {
        setIsSavingEdit(false);
      }
    },
    [deleteHeroDialog, isSavingEdit, refreshInstalledRounds, showToast]
  );

  const deleteHeroEntry = (heroDraft: HeroEditDraft | null = editingHero) => {
    if (!heroDraft || isSavingEdit) return;
    const persistedHeroName =
      rounds.find((round) => round.hero?.id === heroDraft.id)?.hero?.name ?? heroDraft.name;
    setDeleteHeroDialog({
      id: heroDraft.id,
      name: heroDraft.name.trim() || persistedHeroName.trim(),
    });
  };

  const retryTemplateLinkingForRound = async (round: InstalledRound) => {
    if (isSavingEdit) return;
    setIsSavingEdit(true);
    try {
      await db.round.retryTemplateLinking({ roundId: round.id });
      await refreshInstalledRounds();
    } catch (error) {
      console.error("Failed to retry template round linking", error);
      showToast(
        error instanceof Error ? error.message : "Failed to retry template round linking.",
        "error"
      );
    } finally {
      setIsSavingEdit(false);
    }
  };

  const retryTemplateLinkingForHero = async (heroId: string) => {
    if (isSavingEdit) return;
    setIsSavingEdit(true);
    try {
      await db.template.retryLinking({ heroId });
      await refreshInstalledRounds();
    } catch (error) {
      console.error("Failed to retry template hero linking", error);
      showToast(
        error instanceof Error ? error.message : "Failed to retry template hero linking.",
        "error"
      );
    } finally {
      setIsSavingEdit(false);
    }
  };

  const saveRoundTemplateRepair = async () => {
    if (!repairingTemplateRound || isSavingEdit) return;
    if (!repairingTemplateRound.installedRoundId) {
      showToast("Select an installed round to repair this template.", "error");
      return;
    }
    setIsSavingEdit(true);
    try {
      await db.round.repairTemplate({
        roundId: repairingTemplateRound.roundId,
        installedRoundId: repairingTemplateRound.installedRoundId,
      });
      setRepairingTemplateRound(null);
      await refreshInstalledRounds();
    } catch (error) {
      console.error("Failed to repair template round", error);
      showToast(
        error instanceof Error ? error.message : "Failed to repair template round.",
        "error"
      );
    } finally {
      setIsSavingEdit(false);
    }
  };

  const applySourceHeroToRepairDraft = (sourceHeroId: string) => {
    const sourceHero = sourceHeroOptions.find((entry) => entry.heroId === sourceHeroId);
    setRepairingTemplateHero((current) => {
      if (!current) return current;
      const remaining = [...(sourceHero?.rounds ?? [])];
      const nextAssignments = current.assignments.map((assignment) => {
        const exactNameIndex = remaining.findIndex(
          (candidate) => candidate.name === assignment.roundName
        );
        const matched =
          exactNameIndex >= 0 ? remaining.splice(exactNameIndex, 1)[0] : remaining.shift();
        return {
          ...assignment,
          installedRoundId: matched?.id ?? "",
        };
      });
      return {
        ...current,
        sourceHeroId,
        assignments: nextAssignments,
      };
    });
  };

  const saveHeroTemplateRepair = async () => {
    if (!repairingTemplateHero || isSavingEdit) return;
    if (!repairingTemplateHero.sourceHeroId) {
      showToast("Select a source hero first.", "error");
      return;
    }
    if (repairingTemplateHero.assignments.some((assignment) => !assignment.installedRoundId)) {
      showToast("Assign every unresolved hero round before saving.", "error");
      return;
    }
    setIsSavingEdit(true);
    try {
      await db.template.repairHero({
        heroId: repairingTemplateHero.heroId,
        sourceHeroId: repairingTemplateHero.sourceHeroId,
        assignments: repairingTemplateHero.assignments.map((assignment) => ({
          roundId: assignment.roundId,
          installedRoundId: assignment.installedRoundId,
        })),
      });
      setRepairingTemplateHero(null);
      await refreshInstalledRounds();
    } catch (error) {
      console.error("Failed to repair template hero", error);
      showToast(
        error instanceof Error ? error.message : "Failed to repair template hero.",
        "error"
      );
    } finally {
      setIsSavingEdit(false);
    }
  };

  return (
    <div className="relative min-h-screen overflow-hidden">
      <AnimatedBackground />

      <div className="relative z-10 flex h-screen flex-col overflow-hidden lg:flex-row">
        <nav className="animate-entrance flex shrink-0 flex-row gap-1 overflow-x-auto border-b border-purple-400/20 bg-zinc-950/70 px-3 py-2 backdrop-blur-xl lg:w-64 lg:flex-col lg:gap-0.5 lg:overflow-x-visible lg:overflow-y-auto lg:border-b-0 lg:border-r lg:px-3 lg:py-6">
          <div className="hidden lg:mb-5 lg:block lg:px-3">
            <p className="font-[family-name:var(--font-jetbrains-mono)] text-[0.6rem] uppercase tracking-[0.45em] text-purple-200/70">
              Round Vault
            </p>
            <h1 className="mt-1.5 text-xl font-black tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-violet-200 via-purple-100 to-indigo-200 drop-shadow-[0_0_20px_rgba(139,92,246,0.45)]">
              Installed Rounds
            </h1>
            <p className="mt-2 text-sm text-zinc-400">
              Manage imports, hero groups, and exports with the same focused shell as the new
              settings screen.
            </p>
          </div>

          {ROUND_SECTIONS.map((section, index) => {
            const active = section.id === activeSectionId;
            return (
              <button
                key={section.id}
                type="button"
                data-controller-focus-id={`rounds-sidebar-${section.id}`}
                data-controller-down={
                  index < ROUND_SECTIONS.length - 1
                    ? `rounds-sidebar-${ROUND_SECTIONS[index + 1].id}`
                    : undefined
                }
                data-controller-up={
                  index > 0 ? `rounds-sidebar-${ROUND_SECTIONS[index - 1].id}` : undefined
                }
                aria-current={active ? "page" : undefined}
                onMouseEnter={handleHoverSfx}
                onFocus={handleHoverSfx}
                onClick={() => {
                  handleSelectSfx();
                  setActiveSectionId(section.id);
                }}
                className={`settings-sidebar-item whitespace-nowrap ${active ? "is-active" : ""}`}
              >
                <span aria-hidden="true" className="settings-sidebar-icon">
                  {section.icon}
                </span>
                <span>{section.title}</span>
              </button>
            );
          })}

          <div className="min-w-0 shrink-0 rounded-2xl border border-purple-400/20 bg-black/25 p-2 lg:mt-4">
            <p className="px-2 pb-2 font-[family-name:var(--font-jetbrains-mono)] text-[10px] uppercase tracking-[0.24em] text-zinc-400">
              Library Grouping
            </p>
            <div className="flex gap-1 lg:flex-col">
              {[
                { value: "hero", label: "Heroes" },
                { value: "playlist", label: "Playlists" },
              ].map((option) => {
                const active = groupMode === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    onMouseEnter={handleHoverSfx}
                    onFocus={handleHoverSfx}
                    onClick={() => {
                      handleSelectSfx();
                      startTransition(() => {
                        setGroupMode(option.value as GroupMode);
                      });
                    }}
                    className={`rounded-xl px-3 py-2 text-left font-[family-name:var(--font-jetbrains-mono)] text-[10px] uppercase tracking-[0.2em] transition-all duration-200 ${active
                        ? "border border-cyan-300/45 bg-cyan-500/18 text-cyan-100"
                        : "border border-transparent bg-zinc-900/55 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200"
                      }`}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="hidden lg:mt-auto lg:block lg:px-1 lg:pt-4">
            <MenuButton
              label="← Back"
              controllerFocusId="rounds-back"
              onHover={handleHoverSfx}
              onClick={() => {
                handleSelectSfx();
                goBack();
              }}
            />
          </div>
        </nav>

        <div
          ref={setScrollContainer}
          className="flex-1 overflow-y-auto px-4 py-6 sm:px-8 lg:px-10 lg:py-8"
        >
          <main className="parallax-ui-none mx-auto flex w-full max-w-6xl flex-col gap-5">
            <header className="settings-panel-enter mb-1">
              <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
                <div>
                  <p className="font-[family-name:var(--font-jetbrains-mono)] text-[10px] uppercase tracking-[0.34em] text-violet-200/75">
                    Installed Rounds
                  </p>
                  <h2 className="mt-2 text-3xl font-black tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-violet-200 via-purple-100 to-indigo-200 drop-shadow-[0_0_20px_rgba(139,92,246,0.4)] sm:text-4xl">
                    {activeSection.title}
                  </h2>
                  <p className="mt-2 max-w-3xl text-sm text-zinc-400">
                    {activeSection.description}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <div className="rounded-xl border border-violet-200/30 bg-violet-400/10 px-4 py-2 font-[family-name:var(--font-jetbrains-mono)] text-xs uppercase tracking-[0.3em] text-violet-100">
                    {filteredRounds.length} / {rounds.length} Visible
                  </div>
                  <RoundsLibraryStatusPoller
                    onStatusChange={(status) => setIsLibraryScanning(status?.state === "running")}
                    onDataChanged={refreshInstalledRounds}
                  />
                  {aggregateDownloadProgress && (
                    <div className="flex items-center gap-2 rounded-xl border border-cyan-300/25 bg-cyan-400/10 px-4 py-2 font-[family-name:var(--font-jetbrains-mono)] text-xs uppercase tracking-[0.2em] text-cyan-100">
                      <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-cyan-400" />
                      {aggregateDownloadProgress.count} download
                      {aggregateDownloadProgress.count > 1 ? "s" : ""}
                      <span className="text-cyan-300/70">—</span>
                      {aggregateDownloadProgress.avgPercent}%
                      {aggregateDownloadProgress.totalSize > 0 && (
                        <>
                          <span className="text-cyan-300/70">
                            ({Math.round(aggregateDownloadProgress.totalDownloaded / 1048576)}/
                            {Math.round(aggregateDownloadProgress.totalSize / 1048576)} MB)
                          </span>
                        </>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </header>

            <div
              className="settings-panel-enter flex flex-col gap-5"
              key={`content-${activeSection.id}`}
            >
              {activeSection.id === "library" && (
                <>
                  <section
                    className="animate-entrance rounded-3xl border border-purple-400/25 bg-zinc-950/55 p-5 backdrop-blur-xl"
                    style={{ animationDelay: "0.05s" }}
                  >
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                      <div>
                        <h3 className="text-lg font-extrabold tracking-tight text-violet-100">
                          Library Snapshot
                        </h3>
                        <p className="mt-1 text-sm text-zinc-300">
                          Keep the main browsing tools, collection health, and import actions in one
                          place.
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <RoundActionButton
                          label="Install Rounds"
                          tone="violet"
                          disabled={actionButtonsDisabled}
                          onHover={handleHoverSfx}
                          onClick={() => {
                            handleSelectSfx();
                            void installRoundsFromFolder();
                          }}
                        />
                        <RoundActionButton
                          label="Import File"
                          tone="emerald"
                          disabled={actionButtonsDisabled}
                          onHover={handleHoverSfx}
                          onClick={() => {
                            handleSelectSfx();
                            void importRoundsFromFile();
                          }}
                        />
                        <RoundActionButton
                          label="Install From Web"
                          tone="violet"
                          disabled={actionButtonsDisabled}
                          onHover={handleHoverSfx}
                          onClick={() => {
                            handleSelectSfx();
                            setWebsiteRoundDialogOpen(true);
                          }}
                        />
                        <RoundActionButton
                          label={isExportingDatabase ? "Exporting..." : "Export"}
                          tone="cyan"
                          disabled={actionButtonsDisabled}
                          onHover={handleHoverSfx}
                          onClick={() => {
                            handleSelectSfx();
                            openExportDatabaseDialog();
                          }}
                        />
                        <RoundActionButton
                          label={selectionMode ? "Cancel Selection" : "Select Items"}
                          tone="violet"
                          disabled={false}
                          onHover={handleHoverSfx}
                          onClick={() => {
                            handleSelectSfx();
                            if (selectionMode) {
                              setSelectedRoundIds(new Set());
                              setSelectedHeroIds(new Set());
                            }
                            setSelectionMode(!selectionMode);
                          }}
                        />
                      </div>

                      {(selectedRoundIds.size > 0 || selectedHeroIds.size > 0 || selectionMode) && (
                        <div className="mt-4 flex flex-wrap items-center gap-3 rounded-2xl border border-violet-300/25 bg-violet-500/10 px-4 py-3">
                          <button
                            type="button"
                            onMouseEnter={handleHoverSfx}
                            onClick={() => {
                              handleSelectSfx();
                              setSelectionMode(!selectionMode);
                              if (selectionMode) {
                                setSelectedRoundIds(new Set());
                                setSelectedHeroIds(new Set());
                              }
                            }}
                            className={`rounded-xl border px-4 py-2 font-[family-name:var(--font-jetbrains-mono)] text-xs uppercase tracking-[0.18em] transition-all duration-200 ${selectionMode
                                ? "border-violet-300/60 bg-violet-500/25 text-violet-100"
                                : "border-slate-600 bg-slate-900/70 text-slate-300 hover:border-violet-300/40"
                              }`}
                          >
                            {selectionMode ? "Cancel Selection" : "Select Items"}
                          </button>
                          {(selectedRoundIds.size > 0 || selectedHeroIds.size > 0) && (
                            <>
                              <span className="text-sm text-violet-200">
                                {selectedRoundIds.size} rounds, {selectedHeroIds.size} heroes
                                selected
                              </span>
                              <button
                                type="button"
                                onMouseEnter={handleHoverSfx}
                                onClick={() => {
                                  handleSelectSfx();
                                  setSelectedRoundIds(new Set());
                                  setSelectedHeroIds(new Set());
                                }}
                                className="rounded-xl border border-slate-600 bg-slate-900/70 px-3 py-1.5 text-xs uppercase tracking-[0.15em] text-slate-300 hover:border-rose-300/40 hover:text-rose-200"
                              >
                                Clear
                              </button>
                              <button
                                type="button"
                                onMouseEnter={handleHoverSfx}
                                onClick={() => {
                                  handleSelectSfx();
                                  openExportDatabaseDialog();
                                }}
                                className="rounded-xl border border-cyan-300/50 bg-cyan-500/20 px-4 py-2 font-[family-name:var(--font-jetbrains-mono)] text-xs uppercase tracking-[0.18em] text-cyan-100 hover:border-cyan-200/75"
                              >
                                Export Selected
                              </button>
                            </>
                          )}
                        </div>
                      )}
                    </div>

                    <InlineMetrics
                      className="mt-4"
                      metrics={[
                        { label: "Standalone", value: standaloneRoundCount, tone: "violet" },
                        { label: "Hero Groups", value: heroGroupCount, tone: "pink" },
                        { label: "Scripts Ready", value: roundsWithScriptCount, tone: "emerald" },
                        { label: "Disabled", value: disabledRoundIds.size, tone: "amber" },
                      ]}
                    />
                  </section>

                  <section
                    className="relative z-40 animate-entrance rounded-3xl border border-purple-400/25 bg-zinc-950/55 p-5 backdrop-blur-xl"
                    style={{ animationDelay: "0.08s" }}
                  >
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                      <div>
                        <h3 className="text-lg font-extrabold tracking-tight text-violet-100">
                          Search & Filter
                        </h3>
                        <p className="mt-1 text-sm text-zinc-300">
                          Narrow the collection by round type, script availability, or a text search
                          across round metadata.
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <label className="flex items-center gap-2 rounded-lg border border-zinc-700 bg-black/30 px-3 py-2 text-xs uppercase tracking-[0.18em] text-zinc-300">
                          <input
                            type="checkbox"
                            checked={showDisabledRounds}
                            onChange={(event) => setShowDisabledRounds(event.target.checked)}
                          />
                          Show Disabled Imports
                        </label>
                        <button
                          type="button"
                          onMouseEnter={handleHoverSfx}
                          onClick={() => {
                            handleSelectSfx();
                            setQueryInput("");
                            startTransition(() => {
                              setQuery("");
                              setTypeFilter("all");
                              setScriptFilter("all");
                              setSortMode("newest");
                            });
                          }}
                          disabled={!hasActiveFilters}
                          className={`rounded-xl border px-4 py-2 font-[family-name:var(--font-jetbrains-mono)] text-xs uppercase tracking-[0.18em] transition-all duration-200 ${hasActiveFilters
                              ? "border-violet-300/50 bg-violet-500/15 text-violet-100 hover:border-violet-200/75 hover:bg-violet-500/25"
                              : "cursor-not-allowed border-zinc-700 bg-zinc-900/70 text-zinc-500"
                            }`}
                        >
                          Clear Filters
                        </button>
                      </div>
                    </div>

                    <div className="mt-5 grid grid-cols-1 gap-3 lg:grid-cols-5">
                      <label className="lg:col-span-2">
                        <span className="mb-2 block font-[family-name:var(--font-jetbrains-mono)] text-[10px] uppercase tracking-[0.25em] text-zinc-300">
                          Search
                        </span>
                        <input
                          value={queryInput}
                          onChange={(event) => {
                            const nextValue = event.target.value;
                            setQueryInput(nextValue);
                            startTransition(() => {
                              setQuery(nextValue);
                            });
                          }}
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
                          { value: "Cum", label: abbreviateNsfwText("Cum", sfwMode) },
                        ]}
                        onChange={(value) => {
                          startTransition(() => {
                            setTypeFilter(value as TypeFilter);
                          });
                        }}
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
                        onChange={(value) => {
                          startTransition(() => {
                            setScriptFilter(value as ScriptFilter);
                          });
                        }}
                        onHoverSfx={handleHoverSfx}
                        onSelectSfx={handleSelectSfx}
                      />

                      <GameDropdown
                        label="Sort"
                        value={sortMode}
                        options={[
                          { value: "newest", label: "Newest" },
                          { value: "oldest", label: "Oldest" },
                          { value: "difficulty", label: "Difficulty" },
                          { value: "bpm", label: "BPM" },
                          { value: "length", label: "Length" },
                          { value: "name", label: "Name" },
                        ]}
                        onChange={(value) => {
                          startTransition(() => {
                            setSortMode(value as SortMode);
                          });
                        }}
                        onHoverSfx={handleHoverSfx}
                        onSelectSfx={handleSelectSfx}
                      />
                    </div>

                    <div className="mt-4 flex flex-wrap items-center gap-2">
                      <div className="rounded-xl border border-zinc-700/80 bg-black/30 px-3 py-2 font-[family-name:var(--font-jetbrains-mono)] text-[10px] uppercase tracking-[0.2em] text-zinc-300">
                        {activeFilterCount > 0
                          ? `${activeFilterCount} Active Filters`
                          : "No Active Filters"}
                      </div>
                      <div className="rounded-xl border border-zinc-700/80 bg-black/30 px-3 py-2 font-[family-name:var(--font-jetbrains-mono)] text-[10px] uppercase tracking-[0.2em] text-zinc-300">
                        Sort: {sortModeLabel}
                      </div>
                      <div className="rounded-xl border border-zinc-700/80 bg-black/30 px-3 py-2 font-[family-name:var(--font-jetbrains-mono)] text-[10px] uppercase tracking-[0.2em] text-zinc-300">
                        Grouping: {groupModeLabel}
                      </div>
                      <div className="rounded-xl border border-zinc-700/80 bg-black/30 px-3 py-2 font-[family-name:var(--font-jetbrains-mono)] text-[10px] uppercase tracking-[0.2em] text-zinc-300">
                        {showDisabledRounds ? "Disabled Included" : "Disabled Hidden"}
                      </div>
                    </div>
                  </section>

                  <section
                    className="animate-entrance rounded-3xl border border-purple-400/25 bg-zinc-950/55 p-5 backdrop-blur-xl"
                    style={{ animationDelay: "0.11s" }}
                  >
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                      <div>
                        <h3 className="text-lg font-extrabold tracking-tight text-violet-100">
                          Round Library
                        </h3>
                        <p className="mt-1 text-sm text-zinc-300">
                          {filteredRounds.length === 0
                            ? "No rounds currently match the active search and filter state."
                            : `${filteredRounds.length} matching rounds are currently available.`}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onMouseEnter={handleHoverSfx}
                          onClick={() => {
                            handleSelectSfx();
                            setExpandedHeroGroups((previous) => {
                              const next = { ...previous };
                              visibleGroupKeys.forEach((groupKey) => {
                                next[groupKey] = true;
                              });
                              return next;
                            });
                          }}
                          disabled={visibleGroupKeys.length === 0 || allVisibleGroupsExpanded}
                          className={`rounded-xl border px-4 py-2 font-[family-name:var(--font-jetbrains-mono)] text-xs uppercase tracking-[0.18em] transition-all duration-200 ${visibleGroupKeys.length > 0 && !allVisibleGroupsExpanded
                              ? "border-cyan-300/45 bg-cyan-500/15 text-cyan-100 hover:border-cyan-200/75 hover:bg-cyan-500/25"
                              : "cursor-not-allowed border-zinc-700 bg-zinc-900/70 text-zinc-500"
                            }`}
                        >
                          Expand All Groups
                        </button>
                        <button
                          type="button"
                          onMouseEnter={handleHoverSfx}
                          onClick={() => {
                            handleSelectSfx();
                            setExpandedHeroGroups((previous) => {
                              const next = { ...previous };
                              visibleGroupKeys.forEach((groupKey) => {
                                delete next[groupKey];
                              });
                              return next;
                            });
                          }}
                          disabled={visibleGroupKeys.length === 0 || !allVisibleGroupsExpanded}
                          className={`rounded-xl border px-4 py-2 font-[family-name:var(--font-jetbrains-mono)] text-xs uppercase tracking-[0.18em] transition-all duration-200 ${visibleGroupKeys.length > 0 && allVisibleGroupsExpanded
                              ? "border-violet-300/45 bg-violet-500/15 text-violet-100 hover:border-violet-200/75 hover:bg-violet-500/25"
                              : "cursor-not-allowed border-zinc-700 bg-zinc-900/70 text-zinc-500"
                            }`}
                        >
                          Collapse Groups
                        </button>
                      </div>
                    </div>

                    <LibraryLastMessage />

                    {filteredRounds.length === 0 ? (
                      <div className="mt-5 rounded-2xl border border-zinc-700/60 bg-zinc-950/60 p-8 text-center backdrop-blur-xl">
                        <p className="font-[family-name:var(--font-jetbrains-mono)] text-sm uppercase tracking-[0.28em] text-zinc-400">
                          No rounds match this filter
                        </p>
                        <p className="mt-3 text-sm text-zinc-400">
                          {hasActiveFilters
                            ? "Clear the current filters to get back to the full library."
                            : "Install a folder or import a portable file to start building the library."}
                        </p>
                        <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
                          {hasActiveFilters ? (
                            <RoundActionButton
                              label="Reset Filters"
                              tone="violet"
                              onHover={handleHoverSfx}
                              onClick={() => {
                                handleSelectSfx();
                                setQueryInput("");
                                startTransition(() => {
                                  setQuery("");
                                  setTypeFilter("all");
                                  setScriptFilter("all");
                                  setSortMode("newest");
                                });
                              }}
                            />
                          ) : (
                            <RoundActionButton
                              label="Open Import & Export"
                              tone="cyan"
                              onHover={handleHoverSfx}
                              onClick={() => {
                                handleSelectSfx();
                                setActiveSectionId("transfer");
                              }}
                            />
                          )}
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="mt-5">
                          <VirtualizedRoundLibraryGrid
                            rows={renderRows}
                            expandedGroupKeys={expandedGroupKeySet}
                            scrollContainer={scrollContainer}
                            renderCard={(item) => (
                              <RoundCard
                                key={item.key}
                                round={item.round}
                                index={item.renderIndex}
                                onHoverSfx={handleHoverSfx}
                                onConvertToHero={handleConvertRoundToHero}
                                onPlay={handlePlayRound}
                                onEdit={handleEditRound}
                                onRetryTemplateLinking={retryTemplateLinkingForRound}
                                onRepairTemplate={(templateRound) => {
                                  handleSelectSfx();
                                  setRepairingTemplateRound({
                                    roundId: templateRound.id,
                                    roundName: templateRound.name,
                                    installedRoundId: "",
                                  });
                                }}
                                animateDifficulty={
                                  (item.round.difficulty ?? 0) === highestFilteredDifficulty &&
                                  highestFilteredDifficulty > 0
                                }
                                showDisabledBadge={disabledRoundIds.has(item.round.id)}
                                isWebsiteVideoCaching={websiteVideoScanStatus?.state === "running"}
                                websiteVideoCachePending={
                                  getInstalledRoundWebsiteVideoCacheStatus(item.round) === "pending"
                                }
                                downloadProgress={
                                  item.round.resources
                                    .map((r) => getDownloadProgressForVideoUri(r.videoUri))
                                    .find((p): p is VideoDownloadProgress => p != null) ?? null
                                }
                                selectionMode={selectionMode}
                                selected={selectedRoundIds.has(item.round.id)}
                                onToggleSelection={(round) => {
                                  handleSelectSfx();
                                  setSelectedRoundIds((prev) => {
                                    const next = new Set(prev);
                                    if (next.has(round.id)) {
                                      next.delete(round.id);
                                    } else {
                                      next.add(round.id);
                                    }
                                    return next;
                                  });
                                }}
                              />
                            )}
                            renderGroupHeader={(shelf) => {
                              const row = shelf.row;
                              const isExpanded = expandedGroupKeySet.has(row.groupKey);
                              if (row.kind === "hero-group") {
                                const heroId = row.rounds[0]?.heroId;
                                const groupRoundIds = row.rounds.map((r) => r.id);
                                const allRoundsSelected = groupRoundIds.every((id) =>
                                  selectedRoundIds.has(id)
                                );
                                const heroSelected = heroId ? selectedHeroIds.has(heroId) : false;
                                const isGroupSelected =
                                  groupRoundIds.length > 0 && allRoundsSelected && heroSelected;
                                const { pendingCacheCount, pendingPreviewCount } =
                                  summarizeHeroGroupPreviewState(
                                    row.rounds,
                                    websiteVideoScanStatus?.state === "running"
                                  );
                                return (
                                  <HeroGroupHeader
                                    heroName={row.heroName}
                                    roundCount={row.rounds.length}
                                    pendingCacheCount={pendingCacheCount}
                                    pendingPreviewCount={pendingPreviewCount}
                                    expanded={isExpanded}
                                    onHoverSfx={handleHoverSfx}
                                    converting={convertingHeroGroupKey === row.groupKey}
                                    hasTemplateRounds={row.rounds.some((round) =>
                                      isTemplateRound(round)
                                    )}
                                    selectionMode={selectionMode}
                                    selected={isGroupSelected}
                                    onToggleSelection={() => {
                                      handleSelectSfx();
                                      toggleHeroGroupSelection(row);
                                    }}
                                    onToggle={() => {
                                      handleSelectSfx();
                                      setExpandedHeroGroups((previous) => ({
                                        ...previous,
                                        [row.groupKey]: !previous[row.groupKey],
                                      }));
                                    }}
                                    onConvertToRound={() => {
                                      handleSelectSfx();
                                      openHeroGroupRoundConversion(row);
                                    }}
                                    onEditHero={() => {
                                      const draft = toHeroEditDraft(row.rounds[0]);
                                      if (!draft) return;
                                      handleSelectSfx();
                                      setEditingHero(draft);
                                    }}
                                    onDeleteHero={() => {
                                      const draft = toHeroEditDraft(row.rounds[0]);
                                      if (!draft) return;
                                      handleSelectSfx();
                                      void deleteHeroEntry(draft);
                                    }}
                                    onRetryTemplateLinking={() => {
                                      const heroId = row.rounds[0]?.heroId;
                                      if (!heroId) return;
                                      handleSelectSfx();
                                      void retryTemplateLinkingForHero(heroId);
                                    }}
                                    onRepairTemplate={() => {
                                      const heroId = row.rounds[0]?.heroId;
                                      if (!heroId) return;
                                      handleSelectSfx();
                                      setRepairingTemplateHero({
                                        heroId,
                                        heroName: row.heroName,
                                        sourceHeroId: "",
                                        assignments: row.rounds
                                          .filter((round) => isTemplateRound(round))
                                          .map((round) => ({
                                            roundId: round.id,
                                            roundName: round.name,
                                            installedRoundId: "",
                                          })),
                                      });
                                    }}
                                  />
                                );
                              }

                              return (
                                <PlaylistGroupHeader
                                  playlistName={row.playlistName}
                                  roundCount={row.rounds.length}
                                  cachePending={
                                    playlistWebsiteCacheSummaryById.get(
                                      row.groupKey.replace(/^playlist:/, "")
                                    )?.hasPending ?? false
                                  }
                                  expanded={isExpanded}
                                  onHoverSfx={handleHoverSfx}
                                  onToggle={() => {
                                    handleSelectSfx();
                                    setExpandedHeroGroups((previous) => ({
                                      ...previous,
                                      [row.groupKey]: !previous[row.groupKey],
                                    }));
                                  }}
                                />
                              );
                            }}
                          />
                        </div>
                      </>
                    )}
                  </section>
                </>
              )}

              {activeSection.id === "transfer" && (
                <>
                  <section className="grid gap-5 xl:grid-cols-2">
                    <div
                      className="animate-entrance rounded-3xl border border-purple-400/25 bg-zinc-950/55 p-5 backdrop-blur-xl"
                      style={{ animationDelay: "0.05s" }}
                    >
                      <div className="mb-4">
                        <h3 className="text-lg font-extrabold tracking-tight text-violet-100">
                          Import New Content
                        </h3>
                        <p className="mt-1 text-sm text-zinc-300">
                          Folder installs are best for bulk local content. Portable file import is
                          best for sidecars and packaged exports.
                        </p>
                      </div>
                      <div className="space-y-3">
                        <RoundActionButton
                          label="Install Rounds"
                          description="Choose a folder and scan it for supported round media."
                          tone="violet"
                          disabled={actionButtonsDisabled}
                          onHover={handleHoverSfx}
                          onClick={() => {
                            handleSelectSfx();
                            void installRoundsFromFolder();
                          }}
                        />
                        <RoundActionButton
                          label="Import File"
                          description="Bring in a portable round package or other supported import file."
                          tone="emerald"
                          disabled={actionButtonsDisabled}
                          onHover={handleHoverSfx}
                          onClick={() => {
                            handleSelectSfx();
                            void importRoundsFromFile();
                          }}
                        />
                        <RoundActionButton
                          label="Install From Web"
                          description="Open a popup to create an installed round from a public website URL."
                          tone="violet"
                          disabled={actionButtonsDisabled}
                          onHover={handleHoverSfx}
                          onClick={() => {
                            handleSelectSfx();
                            setWebsiteRoundDialogOpen(true);
                          }}
                        />
                        <RoundActionButton
                          label={scanRunning ? "Scanning..." : "Scan Now"}
                          description="Re-run install folder discovery for sources already connected to the app."
                          tone="cyan"
                          disabled={scanRunning}
                          onHover={handleHoverSfx}
                          onClick={() => {
                            handleSelectSfx();
                            void scanNow();
                          }}
                        />
                      </div>
                    </div>

                    <div
                      className="animate-entrance rounded-3xl border border-purple-400/25 bg-zinc-950/55 p-5 backdrop-blur-xl"
                      style={{ animationDelay: "0.08s" }}
                    >
                      <div className="mb-4">
                        <h3 className="text-lg font-extrabold tracking-tight text-violet-100">
                          Export & Share
                        </h3>
                        <p className="mt-1 text-sm text-zinc-300">
                          Build a clean installed-database export and choose where the package
                          should be written.
                        </p>
                      </div>
                      <div className="space-y-3">
                        <RoundActionButton
                          label={isExportingDatabase ? "Exporting..." : "Export"}
                          description="Open the export flow and package the installed database."
                          tone="sky"
                          disabled={actionButtonsDisabled}
                          onHover={handleHoverSfx}
                          onClick={() => {
                            handleSelectSfx();
                            openExportDatabaseDialog();
                          }}
                        />
                      </div>
                    </div>
                  </section>

                  <section
                    className="animate-entrance rounded-3xl border border-purple-400/25 bg-zinc-950/55 p-5 backdrop-blur-xl"
                    style={{ animationDelay: "0.11s" }}
                  >
                    <LibraryTransferStats />
                  </section>
                </>
              )}
            </div>

            <div className="mx-auto grid w-full max-w-md grid-cols-1 gap-2 pb-6">
              <MenuButton
                label={scanRunning ? "Scanning..." : "Scan Now"}
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
      </div>
      {showInstallOverlay && (
        <RoundsLibraryInstallOverlay isAborting={isAbortingInstall} onAbort={abortInstallImport} />
      )}
      <WebsiteRoundInstallDialog
        open={websiteRoundDialogOpen}
        roundName={websiteRoundName}
        videoUrl={websiteRoundVideoUrl}
        funscriptUrl={websiteRoundFunscriptUrl}
        funscriptFileLabel={websiteRoundFunscriptFileLabel}
        showFunscriptUrl={installWebFunscriptUrlEnabled}
        error={websiteRoundError}
        success={websiteRoundSuccess}
        videoValidation={websiteRoundVideoValidation}
        installing={isInstallingWebsiteRound}
        disabled={actionButtonsDisabled}
        onClose={() => {
          if (isInstallingWebsiteRound) return;
          setWebsiteRoundDialogOpen(false);
          setWebsiteRoundVideoValidation({ state: "idle", message: null });
        }}
        onRoundNameChange={(value) => {
          setWebsiteRoundName(value);
          setWebsiteRoundNameEdited(true);
          setWebsiteRoundError(null);
          setWebsiteRoundSuccess(null);
        }}
        onVideoUrlChange={(value) => {
          setWebsiteRoundVideoUrl(value);
          setWebsiteRoundError(null);
          setWebsiteRoundSuccess(null);
        }}
        onFunscriptUrlChange={(value) => {
          setWebsiteRoundFunscriptUrl(value);
          setWebsiteRoundFunscriptFileUri(null);
          setWebsiteRoundFunscriptFileLabel(null);
          setWebsiteRoundError(null);
          setWebsiteRoundSuccess(null);
        }}
        onSelectLocalFunscript={() => {
          handleSelectSfx();
          void selectWebsiteRoundFunscriptFile();
        }}
        onInstall={() => {
          handleSelectSfx();
          void installWebsiteRound();
        }}
        onHoverSfx={handleHoverSfx}
      />
      {activePreviewRound && (
        <RoundVideoOverlay {...previewOverlayProps} />
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
                onChange={(event) =>
                  setEditingRound((previous) =>
                    previous ? { ...previous, name: event.target.value } : previous
                  )
                }
                className="w-full rounded-xl border border-violet-300/30 bg-black/45 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-violet-200/70"
              />
            </ModalField>
            <ModalField label="Type">
              <GameDropdown
                value={editingRound.type}
                options={[
                  { value: "Normal", label: "Normal" },
                  { value: "Interjection", label: "Interjection" },
                  { value: "Cum", label: abbreviateNsfwText("Cum", sfwMode) },
                ]}
                onChange={(value) =>
                  setEditingRound((previous) =>
                    previous ? { ...previous, type: value as EditableRoundType } : previous
                  )
                }
              />
            </ModalField>
            <ModalField label="Author">
              <input
                value={editingRound.author}
                onChange={(event) =>
                  setEditingRound((previous) =>
                    previous ? { ...previous, author: event.target.value } : previous
                  )
                }
                className="w-full rounded-xl border border-violet-300/30 bg-black/45 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-violet-200/70"
              />
            </ModalField>
            <ModalField label="BPM">
              <input
                value={editingRound.bpm}
                onChange={(event) =>
                  setEditingRound((previous) =>
                    previous ? { ...previous, bpm: event.target.value } : previous
                  )
                }
                className="w-full rounded-xl border border-violet-300/30 bg-black/45 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-violet-200/70"
              />
            </ModalField>
            <ModalField label="Difficulty">
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-0.5 rounded-xl border border-violet-300/30 bg-black/45 px-3 py-2">
                  {[1, 2, 3, 4, 5].map((level) => {
                    const currentDifficulty = editingRound.difficulty
                      ? parseInt(editingRound.difficulty, 10)
                      : 0;
                    const active = level <= currentDifficulty;
                    return (
                      <button
                        key={level}
                        type="button"
                        aria-label={`Set difficulty to ${level} star${level === 1 ? "" : "s"}`}
                        onClick={() =>
                          setEditingRound((previous) =>
                            previous ? { ...previous, difficulty: String(level) } : previous
                          )
                        }
                        className={`text-lg leading-none transition-colors ${active ? "text-yellow-300 drop-shadow-[0_0_6px_rgba(253,224,71,0.7)]" : "text-zinc-600 hover:text-zinc-400"}`}
                      >
                        ★
                      </button>
                    );
                  })}
                </div>
                {editingRound.difficulty && (
                  <button
                    type="button"
                    onClick={() =>
                      setEditingRound((previous) =>
                        previous ? { ...previous, difficulty: "" } : previous
                      )
                    }
                    className="text-xs text-zinc-500 hover:text-zinc-400"
                  >
                    clear
                  </button>
                )}
              </div>
            </ModalField>
            <ModalField label="Start Time (ms)">
              <input
                value={editingRound.startTime}
                onChange={(event) =>
                  setEditingRound((previous) =>
                    previous ? { ...previous, startTime: event.target.value } : previous
                  )
                }
                className="w-full rounded-xl border border-violet-300/30 bg-black/45 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-violet-200/70"
              />
            </ModalField>
            <ModalField label="End Time (ms)">
              <input
                value={editingRound.endTime}
                onChange={(event) =>
                  setEditingRound((previous) =>
                    previous ? { ...previous, endTime: event.target.value } : previous
                  )
                }
                className="w-full rounded-xl border border-violet-300/30 bg-black/45 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-violet-200/70"
              />
            </ModalField>
            <ModalField label="Funscript" className="sm:col-span-2">
              <div className="space-y-3 rounded-xl border border-violet-300/30 bg-black/45 p-3">
                <div className="rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-zinc-200">
                  {editingRound.funscriptUri ? (
                    <span className="break-all">{editingRound.funscriptUri}</span>
                  ) : (
                    <span className="text-zinc-500">No funscript attached</span>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={isSavingEdit || !editingRound.resourceId}
                    onClick={() => {
                      void window.electronAPI.dialog
                        .selectConverterFunscriptFile()
                        .then((filePath) => {
                          if (!filePath) return;
                          setEditingRound((previous) =>
                            previous
                              ? {
                                ...previous,
                                funscriptUri: window.electronAPI.file.convertFileSrc(filePath),
                              }
                              : previous
                          );
                        });
                    }}
                    className="rounded-xl border border-cyan-300/35 bg-cyan-500/12 px-3 py-2 text-xs uppercase tracking-[0.18em] text-cyan-100 transition-all duration-200 hover:border-cyan-200/75 hover:bg-cyan-500/24 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {editingRound.funscriptUri ? "Replace Funscript" : "Attach Funscript"}
                  </button>
                  <button
                    type="button"
                    disabled={
                      isSavingEdit || !editingRound.resourceId || !editingRound.funscriptUri
                    }
                    onClick={() =>
                      setEditingRound((previous) =>
                        previous ? { ...previous, funscriptUri: null } : previous
                      )
                    }
                    className="rounded-xl border border-orange-300/35 bg-orange-500/12 px-3 py-2 text-xs uppercase tracking-[0.18em] text-orange-100 transition-all duration-200 hover:border-orange-200/75 hover:bg-orange-500/24 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Detach Funscript
                  </button>
                </div>
                {!editingRound.resourceId && (
                  <p className="text-xs text-zinc-500">
                    Template rounds do not have a primary media resource, so a funscript cannot be
                    attached here.
                  </p>
                )}
              </div>
            </ModalField>
            <ModalField label="Description" className="sm:col-span-2">
              <textarea
                value={editingRound.description}
                onChange={(event) =>
                  setEditingRound((previous) =>
                    previous ? { ...previous, description: event.target.value } : previous
                  )
                }
                className="min-h-28 w-full rounded-xl border border-violet-300/30 bg-black/45 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-violet-200/70"
              />
            </ModalField>
          </div>
        </EditDialog>
      )}
      {heroGroupRoundConversion && (
        <EditDialog
          title="Convert Hero to Round"
          onClose={() => {
            if (convertingHeroGroupKey === heroGroupRoundConversion.groupKey) return;
            setHeroGroupRoundConversion(null);
          }}
          onSubmit={() => {
            void confirmHeroGroupRoundConversion();
          }}
          submitLabel={
            convertingHeroGroupKey === heroGroupRoundConversion.groupKey
              ? "Converting..."
              : "Confirm Conversion"
          }
          disabled={convertingHeroGroupKey === heroGroupRoundConversion.groupKey}
        >
          <div className="space-y-4">
            <div className="rounded-2xl border border-rose-300/25 bg-rose-500/10 p-4 text-sm text-zinc-200">
              <p className="font-semibold text-rose-100">
                This keeps "{heroGroupRoundConversion.keepRoundName}" and permanently deletes{" "}
                {heroGroupRoundConversion.roundsToDeleteCount} attached round(s).
              </p>
              <p className="mt-2 text-zinc-300">
                The hero will be removed and the kept round will become a standalone entry. This
                cannot be undone in-app.
              </p>
            </div>
            <ModalField label={`Type "${heroGroupRoundConversion.heroName}" to confirm`}>
              <input
                value={heroGroupRoundConversion.confirmationText}
                onChange={(event) =>
                  setHeroGroupRoundConversion((current) =>
                    current
                      ? {
                        ...current,
                        confirmationText: event.target.value,
                        error: null,
                      }
                      : current
                  )
                }
                className="w-full rounded-xl border border-rose-300/30 bg-black/45 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-rose-200/70"
              />
            </ModalField>
            {heroGroupRoundConversion.error ? (
              <p className="rounded-2xl border border-amber-300/25 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
                {heroGroupRoundConversion.error}
              </p>
            ) : null}
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
                onChange={(event) =>
                  setEditingHero((previous) =>
                    previous ? { ...previous, name: event.target.value } : previous
                  )
                }
                className="w-full rounded-xl border border-violet-300/30 bg-black/45 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-violet-200/70"
              />
            </ModalField>
            <ModalField label="Author">
              <input
                value={editingHero.author}
                onChange={(event) =>
                  setEditingHero((previous) =>
                    previous ? { ...previous, author: event.target.value } : previous
                  )
                }
                className="w-full rounded-xl border border-violet-300/30 bg-black/45 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-violet-200/70"
              />
            </ModalField>
            <ModalField label="Description">
              <textarea
                value={editingHero.description}
                onChange={(event) =>
                  setEditingHero((previous) =>
                    previous ? { ...previous, description: event.target.value } : previous
                  )
                }
                className="min-h-28 w-full rounded-xl border border-violet-300/30 bg-black/45 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-violet-200/70"
              />
            </ModalField>
          </div>
        </EditDialog>
      )}
      {repairingTemplateRound && (
        <EditDialog
          title="Repair Template Round"
          onClose={() => !isSavingEdit && setRepairingTemplateRound(null)}
          onSubmit={() => {
            void saveRoundTemplateRepair();
          }}
          submitLabel={isSavingEdit ? "Repairing..." : "Attach Source Media"}
          disabled={isSavingEdit}
        >
          <div className="space-y-4">
            <p className="rounded-2xl border border-amber-300/25 bg-amber-500/10 p-4 text-sm text-zinc-200">
              Attach installed media to{" "}
              <span className="font-semibold text-amber-100">
                {repairingTemplateRound.roundName}
              </span>
              .
            </p>
            <ModalField label="Installed Round Source">
              <GameDropdown
                value={repairingTemplateRound.installedRoundId as string}
                options={[
                  { value: "" as string, label: "Select installed round" },
                  ...rounds
                    .filter((round) => !isTemplateRound(round))
                    .map((round) => ({
                      value: round.id,
                      label: round.name + (round.hero?.name ? ` [${round.hero.name}]` : ""),
                    })),
                ]}
                onChange={(value) =>
                  setRepairingTemplateRound((current) =>
                    current ? { ...current, installedRoundId: value } : current
                  )
                }
              />
            </ModalField>
          </div>
        </EditDialog>
      )}
      {repairingTemplateHero && (
        <EditDialog
          title="Repair Template Hero"
          onClose={() => !isSavingEdit && setRepairingTemplateHero(null)}
          onSubmit={() => {
            void saveHeroTemplateRepair();
          }}
          submitLabel={isSavingEdit ? "Repairing..." : "Attach Hero Media"}
          disabled={isSavingEdit}
        >
          <div className="space-y-4">
            <p className="rounded-2xl border border-amber-300/25 bg-amber-500/10 p-4 text-sm text-zinc-200">
              Choose a source hero for{" "}
              <span className="font-semibold text-amber-100">{repairingTemplateHero.heroName}</span>
              . Assignments are auto-filled by round name, then order.
            </p>
            <ModalField label="Source Hero">
              <GameDropdown
                value={repairingTemplateHero.sourceHeroId}
                options={[
                  { value: "" as string, label: "Select source hero" },
                  ...sourceHeroOptions.map((option) => ({
                    value: option.heroId,
                    label: `${option.heroName} (${option.rounds.length} rounds)`,
                  })),
                ]}
                onChange={(value) => applySourceHeroToRepairDraft(value)}
              />
            </ModalField>
            <div className="space-y-3">
              {repairingTemplateHero.assignments.map((assignment) => {
                const selectedSourceHero = sourceHeroOptions.find(
                  (entry) => entry.heroId === repairingTemplateHero.sourceHeroId
                );
                return (
                  <ModalField key={assignment.roundId} label={assignment.roundName}>
                    <GameDropdown
                      value={assignment.installedRoundId}
                      options={[
                        { value: "" as string, label: "Select installed round" },
                        ...(selectedSourceHero?.rounds ?? []).map((round) => ({
                          value: round.id,
                          label: round.name,
                        })),
                      ]}
                      onChange={(value) =>
                        setRepairingTemplateHero((current) =>
                          current
                            ? {
                              ...current,
                              assignments: current.assignments.map((entry) =>
                                entry.roundId === assignment.roundId
                                  ? { ...entry, installedRoundId: value }
                                  : entry
                              ),
                            }
                            : current
                        )
                      }
                    />
                  </ModalField>
                );
              })}
            </div>
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
              Review the folder before import. Ordered by filename (natural sort), so entries like
              2, 10, and 100 stay in human order.
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
              <span>Create a playlist after import.</span>
            </label>
            <label className="flex items-start gap-3 rounded-2xl border border-zinc-700/70 bg-black/35 px-4 py-3 text-sm text-zinc-200">
              <input
                type="checkbox"
                checked={legacyPlaylistReview.deferPhash}
                onChange={(event) =>
                  setLegacyPlaylistReview((current) =>
                    current
                      ? {
                        ...current,
                        deferPhash: event.target.checked,
                        error: null,
                      }
                      : null
                  )
                }
                className="mt-0.5 h-4 w-4 rounded border-zinc-500 bg-black/40"
              />
              <span>Defer phash generation to a later moment.</span>
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
                className={`w-full rounded-xl border px-4 py-3 text-sm outline-none transition-all duration-200 ${legacyPlaylistReview.createPlaylist
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
                      <div className="text-xs text-zinc-400">
                        Excluded: {slot.excludedFromImport ? "Yes" : "No"}
                      </div>
                      <div className="text-xs text-zinc-400">
                        Checkpoint: {slot.selectedAsCheckpoint ? "Yes" : "No"}
                      </div>
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
      {exportDialog && (
        <InstalledDatabaseExportDialog
          state={exportDialog}
          exporting={isExportingDatabase}
          onClose={() => {
            if (isExportingDatabase) return;
            setExportDialog(null);
          }}
          onChange={(updater) => {
            setExportDialog((current) => {
              if (!current) return current;
              return typeof updater === "function" ? updater(current) : updater;
            });
          }}
          onSubmit={() => {
            void exportInstalledDatabase();
          }}
          selectionCount={{ rounds: selectedRoundIds.size, heroes: selectedHeroIds.size }}
        />
      )}
      <ConfirmDialog
        isOpen={deleteRoundDialog !== null}
        title="Delete Round?"
        message={`Delete round entry \u201C${deleteRoundDialog?.name ?? ""}\u201D from the database?\n\nThis removes only the database entry. Files on disk will be left untouched.`}
        confirmLabel="Delete Round"
        variant="danger"
        onConfirm={confirmDeleteRound}
        onCancel={() => setDeleteRoundDialog(null)}
      />
      <ConfirmDialog
        isOpen={deleteHeroDialog !== null}
        title="Delete Hero?"
        message={`Delete hero entry \u201C${deleteHeroDialog?.name ?? ""}\u201D from the database?\n\nThis also permanently deletes all attached rounds from the database. Files on disk will be left untouched.`}
        confirmLabel="Delete Hero"
        variant="danger"
        onConfirm={confirmDeleteHero}
        onCancel={() => setDeleteHeroDialog(null)}
      />
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
  onRetryTemplateLinking,
  onRepairTemplate,
  animateDifficulty,
  showDisabledBadge,
  isWebsiteVideoCaching = false,
  websiteVideoCachePending = false,
  downloadProgress = null,
  selectionMode,
  selected,
  onToggleSelection,
}: {
  round: InstalledRound;
  index: number;
  onHoverSfx: () => void;
  onConvertToHero: (round: InstalledRound) => void;
  onPlay: (round: InstalledRound) => void;
  onEdit: (round: InstalledRound) => void;
  onRetryTemplateLinking: (round: InstalledRound) => void;
  onRepairTemplate: (round: InstalledRound) => void;
  animateDifficulty: boolean;
  showDisabledBadge: boolean;
  isWebsiteVideoCaching?: boolean;
  websiteVideoCachePending?: boolean;
  downloadProgress?: VideoDownloadProgress | null;
  selectionMode?: boolean;
  selected?: boolean;
  onToggleSelection?: (round: InstalledRound) => void;
}) {
  const sfwMode = useSfwMode();
  const [showTechnicalDetails, setShowTechnicalDetails] = useState(false);
  const [hasActivatedPreview, setHasActivatedPreview] = useState(false);
  const [isPreviewActive, setIsPreviewActive] = useState(false);
  const previewVideoRef = useRef<HTMLVideoElement | null>(null);
  const previewUri = round.resources[0]?.videoUri;
  const previewImage = round.previewImage;
  const primaryResource = round.resources[0];
  const hasFunscript = Boolean(round.resources[0]?.funscriptUri);
  const isTemplate = isTemplateRound(round);
  const isWebsiteRound = round.installSourceKey?.startsWith("website:") ?? false;
  const isPreviewBeingGenerated = isWebsiteVideoCaching && isWebsiteRound && !previewImage;
  const showWebsiteCachingState = isWebsiteRound && websiteVideoCachePending;
  const canPreview = Boolean(previewUri) && !showWebsiteCachingState;
  const difficulty = round.difficulty ?? 1;
  const sourceLabel = getRoundInstallSourceLabel(round.installSourceKey);
  const durationLabel = formatDurationLabel(getRoundDurationSec(round));
  const animationDelay = index < 12 ? `${0.14 + index * 0.04}s` : undefined;
  const displayName = abbreviateNsfwText(round.name, sfwMode);
  const displayType = abbreviateNsfwText(round.type ?? "Normal", sfwMode);
  const displayDescription = abbreviateNsfwText(round.description ?? "No description", sfwMode);
  const displayAuthor = abbreviateNsfwText(round.author ?? "Unknown", sfwMode);
  const displayHeroName = round.hero?.name ? abbreviateNsfwText(round.hero.name, sfwMode) : "N/A";
  const displayLibraryLabel = abbreviateNsfwText(round.author ?? round.hero?.name ?? "Installed", sfwMode);
  const stopPreviewPlayback = useCallback(() => {
    setIsPreviewActive(false);
    setHasActivatedPreview(false);
    const video = previewVideoRef.current;
    if (!video) return;
    video.pause();
    video.currentTime = 0;
    video.removeAttribute("src");
    video.load();
  }, []);

  return (
    <article
      className={`group relative flex h-full w-full min-w-0 flex-col overflow-hidden rounded-[28px] border border-white/10 bg-[linear-gradient(180deg,rgba(14,10,25,0.94),rgba(5,7,14,0.98))] shadow-[0_22px_60px_rgba(2,6,23,0.44)] backdrop-blur-xl transition-all duration-300 hover:border-violet-300/55 hover:shadow-[0_28px_72px_rgba(76,29,149,0.34)] ${index < 12 ? "animate-entrance" : ""}`}
      style={animationDelay ? { animationDelay } : undefined}
      onMouseEnter={() => {
        onHoverSfx();
        if (canPreview) {
          setHasActivatedPreview(true);
          setIsPreviewActive(true);
        }
      }}
      onMouseLeave={() => setIsPreviewActive(false)}
      onFocus={() => {
        onHoverSfx();
        if (canPreview) {
          setHasActivatedPreview(true);
          setIsPreviewActive(true);
        }
      }}
      onBlur={() => setIsPreviewActive(false)}
    >
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(34,211,238,0.14),transparent_26%),radial-gradient(circle_at_bottom_left,rgba(168,85,247,0.18),transparent_38%)]" />

      {selectionMode && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onToggleSelection?.(round);
          }}
          className="absolute left-3 top-3 z-40 flex h-6 w-6 items-center justify-center rounded-lg border transition-all"
          style={{
            borderColor: selected ? "rgba(34,211,238,0.6)" : "rgba(255,255,255,0.3)",
            backgroundColor: selected ? "rgba(34,211,238,0.25)" : "rgba(0,0,0,0.4)",
          }}
        >
          {selected && <span className="text-cyan-200 text-sm">✓</span>}
        </button>
      )}

      <div className="group/video relative aspect-video shrink-0 overflow-hidden border-b border-white/10 bg-gradient-to-br from-[#1b1130] via-[#120a25] to-[#0d1a33]">
        {previewImage && (
          <SfwGuard>
            <img
              src={previewImage}
              alt={`${displayName} preview`}
              className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
              loading="lazy"
              decoding="async"
            />
          </SfwGuard>
        )}
        {canPreview && hasActivatedPreview ? (
          <RoundCardPreviewVideo
            videoRef={previewVideoRef}
            previewUri={previewUri}
            previewImage={previewImage}
            startTime={round.startTime}
            endTime={round.endTime}
            active={isPreviewActive}
          />
        ) : !previewImage ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-zinc-500 font-[family-name:var(--font-jetbrains-mono)] text-xs uppercase tracking-[0.35em]">
            {showWebsiteCachingState && !downloadProgress && (
              <span className="h-8 w-8 animate-spin rounded-full border-2 border-amber-200/70 border-t-transparent" />
            )}
            {showWebsiteCachingState && downloadProgress && (
              <div className="flex w-32 flex-col items-center gap-2">
                <span className="text-amber-200/80">{Math.round(downloadProgress.percent)}%</span>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-amber-950/60">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-amber-500 via-amber-400 to-yellow-400 transition-[width] duration-700 ease-out"
                    style={{ width: `${downloadProgress.percent}%` }}
                  />
                </div>
              </div>
            )}
            <span>
              {showWebsiteCachingState
                ? "Caching Ongoing"
                : isPreviewBeingGenerated
                  ? "Preview Is Being Generated"
                  : "No Preview"}
            </span>
          </div>
        ) : null}

        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-[#030407]/90 via-black/20 to-white/5" />
        <DifficultyBadge difficulty={difficulty} animate={animateDifficulty} />

        {showWebsiteCachingState ? (
          <div className="absolute left-1/2 top-1/2 z-20 flex min-w-36 -translate-x-1/2 -translate-y-1/2 flex-col items-center justify-center gap-2 rounded-2xl border border-amber-300/40 bg-black/70 px-5 py-4 text-amber-50 shadow-[0_0_30px_rgba(0,0,0,0.45)]">
            {downloadProgress ? (
              <>
                <span className="font-[family-name:var(--font-jetbrains-mono)] text-[10px] uppercase tracking-[0.24em] text-amber-200/80">
                  {Math.round(downloadProgress.percent)}%
                </span>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-amber-950/60">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-amber-500 via-amber-400 to-yellow-400 transition-[width] duration-700 ease-out"
                    style={{ width: `${downloadProgress.percent}%` }}
                  />
                </div>
              </>
            ) : (
              <span className="h-7 w-7 animate-spin rounded-full border-2 border-amber-200/80 border-t-transparent" />
            )}
          </div>
        ) : previewUri ? (
          <button
            type="button"
            aria-label={`Play ${displayName}`}
            className="absolute left-1/2 top-1/2 z-20 flex h-14 w-14 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-white/45 bg-black/55 text-white opacity-0 shadow-[0_0_30px_rgba(0,0,0,0.45)] transition-all duration-200 group-hover/video:scale-105 group-hover/video:opacity-100 focus-visible:opacity-100"
            onMouseEnter={onHoverSfx}
            onClick={() => {
              stopPreviewPlayback();
              onPlay(round);
            }}
          >
            <span className="ml-1 text-2xl leading-none">▶</span>
          </button>
        ) : null}

        <div className="absolute right-3 top-3 flex flex-col items-end gap-1.5">
          <span className="rounded-full border border-violet-300/35 bg-violet-500/18 px-2.5 py-1 font-[family-name:var(--font-jetbrains-mono)] text-[9px] uppercase tracking-[0.28em] text-violet-100 backdrop-blur-md">
            {displayType}
          </span>
          <span className="rounded-full border border-cyan-300/35 bg-cyan-500/18 px-2.5 py-1 font-[family-name:var(--font-jetbrains-mono)] text-[9px] uppercase tracking-[0.24em] text-cyan-100 backdrop-blur-md">
            {sourceLabel}
          </span>
          {showDisabledBadge && (
            <span className="rounded-full border border-rose-300/35 bg-rose-500/18 px-2.5 py-1 font-[family-name:var(--font-jetbrains-mono)] text-[9px] uppercase tracking-[0.24em] text-rose-100 backdrop-blur-md">
              Disabled
            </span>
          )}
          {isTemplate && (
            <span className="rounded-full border border-amber-300/35 bg-amber-500/18 px-2.5 py-1 font-[family-name:var(--font-jetbrains-mono)] text-[9px] uppercase tracking-[0.24em] text-amber-100 backdrop-blur-md">
              Template
            </span>
          )}
          {showWebsiteCachingState && (
            <span className="rounded-full border border-amber-300/45 bg-amber-500/18 px-2.5 py-1 font-[family-name:var(--font-jetbrains-mono)] text-[9px] uppercase tracking-[0.24em] text-amber-100 backdrop-blur-md">
              {downloadProgress ? `${Math.round(downloadProgress.percent)}%` : "Caching Ongoing"}
            </span>
          )}
        </div>

        <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-3 px-3 pb-3">
          <div className="min-w-0 rounded-2xl border border-white/10 bg-black/25 px-3 py-2 backdrop-blur-md">
            <p className="font-[family-name:var(--font-jetbrains-mono)] text-[9px] uppercase tracking-[0.28em] text-white/55">
              Library
            </p>
            <p className="mt-1 max-w-[12rem] truncate text-sm font-semibold text-white/90">
              {displayLibraryLabel}
            </p>
          </div>
          <span
            className={`shrink-0 rounded-full border px-2.5 py-1 font-[family-name:var(--font-jetbrains-mono)] text-[9px] uppercase tracking-[0.24em] backdrop-blur-md ${showWebsiteCachingState
                ? "border-amber-300/45 bg-amber-500/18 text-amber-100"
                : hasFunscript
                  ? "border-emerald-300/35 bg-emerald-500/18 text-emerald-100"
                  : "border-orange-300/35 bg-orange-500/18 text-orange-100"
              }`}
          >
            {showWebsiteCachingState
              ? downloadProgress
                ? `${Math.round(downloadProgress.percent)}%`
                : "Video Caching"
              : hasFunscript
                ? "Script Ready"
                : "No Script"}
          </span>
        </div>

        <div
          className="pointer-events-auto absolute inset-x-0 bottom-0 z-30 grid transition-all duration-200 ease-out"
          style={{ gridTemplateRows: showTechnicalDetails ? "1fr" : "0fr" }}
        >
          <div className="overflow-hidden">
            <div
              className="mx-3 mb-3 grid gap-1.5 rounded-xl border border-white/15 bg-black/90 p-2.5 font-[family-name:var(--font-jetbrains-mono)] text-[9px] tracking-[0.1em] text-zinc-300 backdrop-blur-xl transition-opacity duration-150 sm:grid-cols-2"
              style={{
                opacity: showTechnicalDetails ? 1 : 0,
                transitionDelay: showTechnicalDetails ? "50ms" : "0ms",
              }}
            >
              <TechnicalDetail label="Round Hash" value={round.phash ?? "N/A"} />
              <TechnicalDetail label="Resource Hash" value={primaryResource?.phash ?? "N/A"} />
              <TechnicalDetail label="Round ID" value={round.id} />
              <TechnicalDetail label="Resource ID" value={primaryResource?.id ?? "N/A"} />
              <TechnicalDetail
                label="Source Key"
                value={round.installSourceKey ?? "N/A"}
                className="sm:col-span-2"
              />
            </div>
          </div>
        </div>

        {downloadProgress && (
          <div className="absolute inset-x-0 bottom-0 z-20">
            <div className="h-1 overflow-hidden bg-black/40">
              <div
                className="h-full bg-gradient-to-r from-amber-500 via-amber-400 to-yellow-400 transition-[width] duration-700 ease-out"
                style={{ width: `${downloadProgress.percent}%` }}
              />
            </div>
          </div>
        )}
      </div>

      <div className="relative grid flex-1 grid-rows-[auto_minmax(4.5rem,4.5rem)_auto] gap-3 p-3.5">
        <div className="space-y-1.5">
          <div className="flex items-start justify-between gap-3">
            <h2 className="min-h-[2.4rem] min-w-0 flex-1 text-[1.15rem] font-black leading-tight tracking-tight text-zinc-100 line-clamp-2">
              {displayName}
            </h2>
            <span className="shrink-0 self-start rounded-full border border-white/10 bg-white/5 px-2.5 py-1 font-[family-name:var(--font-jetbrains-mono)] text-[9px] uppercase tracking-[0.24em] text-zinc-200/80">
              {formatDate(round.createdAt)}
            </span>
          </div>
          <p className="min-h-10 text-sm leading-5 text-zinc-300/85 line-clamp-2">
            {displayDescription}
          </p>
        </div>

        <div className="flex min-h-[4.5rem] flex-wrap content-start items-start gap-x-4 gap-y-1.5 overflow-hidden text-xs text-zinc-400">
          <span>
            <strong className="font-medium text-zinc-300">BPM:</strong>{" "}
            {round.bpm ? Math.round(round.bpm) : "N/A"}
          </span>
          <span>
            <strong className="font-medium text-zinc-300">Hero:</strong> {displayHeroName}
          </span>
          <span
            className={
              hasFunscript
                ? "text-emerald-300"
                : isTemplate
                  ? "text-fuchsia-300"
                  : "text-orange-300"
            }
          >
            {isTemplate ? "Template" : hasFunscript ? "Script Ready" : "No Script"}
          </span>
          <span>
            <strong className="font-medium text-zinc-300">Author:</strong>{" "}
            {displayAuthor}
          </span>
          <span>
            <strong className="font-medium text-zinc-300">Window:</strong>{" "}
            {formatWindow(round.startTime, round.endTime)}
          </span>
          <span>
            <strong className="font-medium text-zinc-300">Length:</strong> {durationLabel}
          </span>
          <span>
            <strong className="font-medium text-zinc-300">Source:</strong> {sourceLabel}
          </span>
        </div>

        <div className="grid grid-cols-[minmax(0,1fr)_auto] auto-rows-auto content-start gap-1.5 self-end">
          <button
            className="min-w-0 rounded-[1.6rem] border border-cyan-300/35 bg-cyan-500/14 px-3 py-1.5 font-[family-name:var(--font-jetbrains-mono)] text-[10px] uppercase tracking-[0.18em] text-cyan-100 transition-all duration-200 hover:border-cyan-200/75 hover:bg-cyan-500/28"
            onClick={() => onEdit(round)}
            onMouseEnter={onHoverSfx}
            type="button"
          >
            Edit Round
          </button>
          <button
            className="rounded-[1.6rem] border border-violet-300/35 bg-violet-500/12 px-2.5 py-1.5 font-[family-name:var(--font-jetbrains-mono)] text-[10px] uppercase tracking-[0.16em] text-violet-100 transition-all duration-200 hover:border-violet-200/75 hover:bg-violet-500/24"
            onClick={() => setShowTechnicalDetails((prev) => !prev)}
            onMouseEnter={onHoverSfx}
            type="button"
            aria-expanded={showTechnicalDetails}
            aria-label={showTechnicalDetails ? "Hide Technical Details" : "Show Technical Details"}
          >
            {showTechnicalDetails ? "Hide Details" : "Details"}
          </button>
          {isTemplate && (
            <>
              <button
                className="col-span-2 rounded-[1.6rem] border border-amber-300/35 bg-amber-500/14 px-3 py-1.5 font-[family-name:var(--font-jetbrains-mono)] text-[10px] uppercase tracking-[0.18em] text-amber-100 transition-all duration-200 hover:border-amber-200/75 hover:bg-amber-500/28"
                onClick={() => onRepairTemplate(round)}
                onMouseEnter={onHoverSfx}
                type="button"
              >
                Repair Template
              </button>
              <button
                className="col-span-2 rounded-[1.6rem] border border-fuchsia-300/35 bg-fuchsia-500/14 px-3 py-1.5 font-[family-name:var(--font-jetbrains-mono)] text-[10px] uppercase tracking-[0.18em] text-fuchsia-100 transition-all duration-200 hover:border-fuchsia-200/75 hover:bg-fuchsia-500/28"
                onClick={() => onRetryTemplateLinking(round)}
                onMouseEnter={onHoverSfx}
                type="button"
              >
                Retry Auto-Link
              </button>
            </>
          )}
          {!round.heroId && !round.hero && (
            <button
              className="col-span-2 rounded-[1.6rem] border border-emerald-300/35 bg-emerald-500/14 px-3 py-1.5 font-[family-name:var(--font-jetbrains-mono)] text-[10px] uppercase tracking-[0.18em] text-emerald-100 transition-all duration-200 hover:border-emerald-200/75 hover:bg-emerald-500/28"
              onClick={() => onConvertToHero(round)}
              onMouseEnter={onHoverSfx}
              type="button"
            >
              Convert to Hero
            </button>
          )}
        </div>
      </div>
    </article>
  );
});

const RoundCardPreviewVideo = memo(function RoundCardPreviewVideo({
  videoRef,
  previewUri,
  previewImage,
  startTime,
  endTime,
  active,
}: {
  videoRef: { current: HTMLVideoElement | null };
  previewUri: string;
  previewImage: string | null;
  startTime: number | null;
  endTime: number | null;
  active: boolean;
}) {
  const { getVideoSrc, ensurePlayableVideo, handleVideoError } = usePlayableVideoFallback();
  const previewVideoSrc = getVideoSrc(previewUri);
  const previewWindowSec = useMemo(() => {
    const startMs =
      typeof startTime === "number" && Number.isFinite(startTime) ? Math.max(0, startTime) : 0;
    const rawEndMs =
      typeof endTime === "number" && Number.isFinite(endTime) ? Math.max(0, endTime) : null;
    const resolvedEndMs = rawEndMs !== null && rawEndMs > startMs ? rawEndMs : null;
    return {
      startSec: startMs / 1000,
      endSec: resolvedEndMs === null ? null : resolvedEndMs / 1000,
    };
  }, [endTime, startTime]);

  const resolvePreviewWindow = useCallback(
    (video: HTMLVideoElement) => {
      const hasFiniteDuration = Number.isFinite(video.duration) && video.duration > 0;
      const startSec = hasFiniteDuration
        ? Math.min(previewWindowSec.startSec, video.duration)
        : previewWindowSec.startSec;
      let resolvedEndSec = previewWindowSec.endSec;
      if (resolvedEndSec !== null && hasFiniteDuration) {
        resolvedEndSec = Math.min(resolvedEndSec, video.duration);
      }
      if (resolvedEndSec !== null && resolvedEndSec <= startSec + 0.001) {
        resolvedEndSec = null;
      }
      return { startSec, endSec: resolvedEndSec };
    },
    [previewWindowSec.endSec, previewWindowSec.startSec]
  );

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    if (!active) {
      video.pause();
      const { startSec } = resolvePreviewWindow(video);
      video.currentTime = startSec;
      return;
    }

    if (video.readyState < HTMLMediaElement.HAVE_METADATA) {
      return;
    }

    const { startSec } = resolvePreviewWindow(video);
    video.currentTime = startSec;
    void video.play().catch((error) => {
      const isIgnorable =
        error instanceof DOMException &&
        (error.name === "AbortError" || error.name === "NotAllowedError");
      if (!isIgnorable) {
        console.error("Preview play blocked", error);
      }
    });
  }, [active, resolvePreviewWindow]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !active || !previewVideoSrc) return;
    video.load();
  }, [active, previewVideoSrc, videoRef]);

  return (
    <SfwGuard>
      <video
        ref={videoRef}
        className={`h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.06] ${previewImage ? "opacity-0 group-hover/video:opacity-100 group-focus-within/video:opacity-100" : ""}`}
        src={previewVideoSrc}
        muted
        preload={active ? "metadata" : "none"}
        playsInline
        poster={previewImage ?? undefined}
        onError={() => {
          void handleVideoError(previewUri);
        }}
        onLoadedMetadata={() => {
          if (!active) return;
          void ensurePlayableVideo(previewUri);
          const video = videoRef.current;
          if (!video) return;
          const { startSec } = resolvePreviewWindow(video);
          video.currentTime = startSec;
        }}
        onLoadedData={() => {
          if (!active) return;
          const video = videoRef.current;
          if (!video) return;
          const { startSec } = resolvePreviewWindow(video);
          video.currentTime = startSec;
          void video.play().catch(() => undefined);
        }}
        onTimeUpdate={() => {
          if (!active) return;
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
              void video.play().catch(() => undefined);
            }
          }
        }}
        onEnded={() => {
          if (!active) return;
          const video = videoRef.current;
          if (!video) return;
          const { startSec } = resolvePreviewWindow(video);
          video.currentTime = startSec;
          void video.play().catch(() => undefined);
        }}
      />
    </SfwGuard>
  );
});

function HeroGroupHeader({
  heroName,
  roundCount,
  pendingCacheCount,
  pendingPreviewCount,
  expanded,
  converting,
  hasTemplateRounds,
  onToggle,
  onConvertToRound,
  onEditHero,
  onDeleteHero,
  onRetryTemplateLinking,
  onRepairTemplate,
  onHoverSfx,
  selectionMode,
  selected,
  onToggleSelection,
}: {
  heroName: string;
  roundCount: number;
  pendingCacheCount: number;
  pendingPreviewCount: number;
  expanded: boolean;
  converting: boolean;
  hasTemplateRounds: boolean;
  onToggle: () => void;
  onConvertToRound: () => void;
  onEditHero: () => void;
  onDeleteHero: () => void;
  onRetryTemplateLinking: () => void;
  onRepairTemplate: () => void;
  onHoverSfx: () => void;
  selectionMode?: boolean;
  selected?: boolean;
  onToggleSelection?: () => void;
}) {
  const [showActions, setShowActions] = useState(false);
  const actionsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showActions) return;
    const onClick = (e: MouseEvent) => {
      if (actionsRef.current && !actionsRef.current.contains(e.target as Node)) {
        setShowActions(false);
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [showActions]);

  return (
    <div className="flex w-full items-stretch gap-2">
      {selectionMode && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onToggleSelection?.();
          }}
          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border transition-all"
          style={{
            borderColor: selected ? "rgba(34,211,238,0.6)" : "rgba(255,255,255,0.3)",
            backgroundColor: selected ? "rgba(34,211,238,0.25)" : "rgba(0,0,0,0.4)",
          }}
        >
          {selected && <span className="text-cyan-200 text-sm">✓</span>}
        </button>
      )}
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
          {pendingCacheCount > 0 && (
            <span className="rounded-md border border-amber-300/40 bg-amber-500/15 px-2 py-1 font-[family-name:var(--font-jetbrains-mono)] text-[10px] uppercase tracking-[0.2em] text-amber-100">
              {pendingCacheCount > 1 ? `${pendingCacheCount} Caching` : "Caching Ongoing"}
            </span>
          )}
          {pendingPreviewCount > 0 && (
            <span className="rounded-md border border-cyan-300/40 bg-cyan-500/15 px-2 py-1 font-[family-name:var(--font-jetbrains-mono)] text-[10px] uppercase tracking-[0.2em] text-cyan-100">
              {pendingPreviewCount > 1
                ? `${pendingPreviewCount} Previews Generating`
                : "Preview Is Being Generated"}
            </span>
          )}
          <span className="rounded-md border border-violet-300/40 bg-violet-500/15 px-2 py-1 font-[family-name:var(--font-jetbrains-mono)] text-[10px] uppercase tracking-[0.2em] text-violet-100">
            {roundCount} Rounds
          </span>
          <span
            className={`text-violet-200 transition-transform duration-200 ${expanded ? "rotate-180" : ""}`}
          >
            ▾
          </span>
        </div>
      </button>
      <div ref={actionsRef} className="relative">
        <button
          type="button"
          onMouseEnter={onHoverSfx}
          onClick={() => setShowActions((v) => !v)}
          className="h-full rounded-2xl border border-violet-300/35 bg-violet-500/12 px-3 font-[family-name:var(--font-jetbrains-mono)] text-[10px] uppercase tracking-[0.2em] text-violet-100 transition-all duration-200 hover:border-violet-200/75 hover:bg-violet-500/24"
        >
          Actions
        </button>
        {showActions && (
          <div className="absolute right-0 top-full z-50 mt-2 min-w-[160px] overflow-hidden rounded-xl border border-violet-300/35 bg-zinc-950/95 shadow-[0_0_24px_rgba(139,92,246,0.38)] backdrop-blur-xl">
            <button
              type="button"
              onMouseEnter={onHoverSfx}
              onClick={() => {
                setShowActions(false);
                onEditHero();
              }}
              className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm text-cyan-100 transition-colors hover:bg-cyan-500/15"
            >
              Edit Hero
            </button>
            <button
              type="button"
              onMouseEnter={onHoverSfx}
              onClick={() => {
                setShowActions(false);
                onDeleteHero();
              }}
              className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm text-rose-100 transition-colors hover:bg-rose-500/15"
            >
              Delete Hero
            </button>
            {hasTemplateRounds && (
              <>
                <button
                  type="button"
                  onMouseEnter={onHoverSfx}
                  onClick={() => {
                    setShowActions(false);
                    onRepairTemplate();
                  }}
                  className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm text-amber-100 transition-colors hover:bg-amber-500/15"
                >
                  Repair Templates
                </button>
                <button
                  type="button"
                  onMouseEnter={onHoverSfx}
                  onClick={() => {
                    setShowActions(false);
                    onRetryTemplateLinking();
                  }}
                  className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm text-fuchsia-100 transition-colors hover:bg-fuchsia-500/15"
                >
                  Retry Auto-Link
                </button>
              </>
            )}
            <div className="my-1 h-px bg-zinc-700/50" />
            <button
              type="button"
              onMouseEnter={onHoverSfx}
              onClick={() => {
                setShowActions(false);
                onConvertToRound();
              }}
              disabled={converting}
              className={`flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm transition-colors ${converting ? "cursor-wait text-zinc-400" : "text-rose-100 hover:bg-rose-500/15"}`}
            >
              {converting ? "Converting..." : "Convert to Round"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function PlaylistGroupHeader({
  playlistName,
  roundCount,
  cachePending,
  expanded,
  onToggle,
  onHoverSfx,
}: {
  playlistName: string;
  roundCount: number;
  cachePending: boolean;
  expanded: boolean;
  onToggle: () => void;
  onHoverSfx: () => void;
}) {
  return (
    <button
      type="button"
      onMouseEnter={onHoverSfx}
      onFocus={onHoverSfx}
      onClick={onToggle}
      className="flex w-full min-w-0 items-center justify-between rounded-2xl border border-emerald-300/35 bg-black/45 px-4 py-3 text-left shadow-[0_0_25px_rgba(16,185,129,0.12)] transition-all duration-200 hover:border-emerald-200/70 hover:bg-emerald-500/12"
      aria-expanded={expanded}
      aria-label={`${playlistName} (${roundCount} rounds)`}
    >
      <div className="min-w-0">
        <p className="font-[family-name:var(--font-jetbrains-mono)] text-[10px] uppercase tracking-[0.25em] text-emerald-200/85">
          Playlist Group
        </p>
        <h2 className="mt-1 truncate text-lg font-extrabold tracking-tight text-zinc-100">
          {playlistName}
        </h2>
        {cachePending && (
          <p className="mt-1 font-[family-name:var(--font-jetbrains-mono)] text-[10px] uppercase tracking-[0.18em] text-amber-200/90">
            Caching ongoing
          </p>
        )}
      </div>
      <div className="flex items-center gap-3 pl-3">
        {cachePending && (
          <span className="rounded-md border border-amber-300/45 bg-amber-500/15 px-2 py-1 font-[family-name:var(--font-jetbrains-mono)] text-[10px] uppercase tracking-[0.2em] text-amber-100">
            Caching Ongoing
          </span>
        )}
        <span className="rounded-md border border-emerald-300/40 bg-emerald-500/15 px-2 py-1 font-[family-name:var(--font-jetbrains-mono)] text-[10px] uppercase tracking-[0.2em] text-emerald-100">
          {roundCount} Rounds
        </span>
        <span
          className={`text-emerald-200 transition-transform duration-200 ${expanded ? "rotate-180" : ""}`}
        >
          ▾
        </span>
      </div>
    </button>
  );
}

function DifficultyBadge({ difficulty, animate }: { difficulty: number; animate: boolean }) {
  const level = Math.max(1, Math.min(5, difficulty));
  return (
    <div
      className={`absolute left-3 top-3 flex items-center gap-2 rounded-full border border-pink-200/45 bg-pink-400/22 px-3 py-1.5 font-[family-name:var(--font-jetbrains-mono)] text-[10px] text-white shadow-[0_0_30px_rgba(236,72,153,0.45)] backdrop-blur-md ${animate ? "animate-difficulty-pop" : ""}`}
    >
      <span className="text-pink-100/90">Difficulty</span>
      <span className="text-yellow-200 drop-shadow-[0_0_8px_rgba(253,224,71,0.85)]">
        {"★".repeat(level)}
      </span>
      <span className="rounded-full bg-black/30 px-2 py-0.5 text-white/90">{level}/5</span>
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
              className={`mr-auto rounded-xl border px-4 py-2 text-sm font-semibold ${disabled
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

function formatEta(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return "";
  const totalSeconds = Math.round(ms / 1000);
  if (totalSeconds <= 0) return "";
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `~ ${minutes}m ${seconds}s remaining` : `~ ${seconds}s remaining`;
}

const RoundsLibraryInstallOverlay = memo(
  ({ isAborting, onAbort }: { isAborting: boolean; onAbort: () => void }) => {
    const [scanStatus, setScanStatus] = useState<InstallScanStatus | null>(null);

    useEffect(() => {
      let mounted = true;
      const poll = async () => {
        try {
          const status = await db.install.getScanStatus();
          if (mounted) setScanStatus(status);
        } catch (err) {
          console.error("Failed to poll scan status in overlay", err);
        }
      };
      poll();
      const interval = window.setInterval(poll, 1000); // Poll faster in overlay
      return () => {
        mounted = false;
        window.clearInterval(interval);
      };
    }, []);

    return <InstallImportOverlay status={scanStatus} aborting={isAborting} onAbort={onAbort} />;
  }
);

RoundsLibraryInstallOverlay.displayName = "RoundsLibraryInstallOverlay";

function InstallImportOverlay({
  status,
  aborting,
  onAbort,
}: {
  status: InstallScanStatus | null;
  aborting: boolean;
  onAbort: () => void;
}) {
  const stats = status?.stats;
  const processed = stats
    ? stats.installed + stats.updated + stats.skipped + stats.failed + stats.sidecarsSeen
    : 0;
  const total = stats?.totalSidecars ?? 0;
  const progress = total > 0 ? (processed / total) * 100 : 0;
  const eta =
    status?.state === "running"
      ? status.etaMs
        ? formatEta(status.etaMs)
        : "Calculating ETA..."
      : "";

  const summary = status
    ? `${status.stats.installed} rounds, ${status.stats.playlistsImported} playlists, ${status.stats.updated} updated, ${status.stats.failed} failed`
    : "Preparing import...";

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/80 px-4 backdrop-blur-md">
      <div className="w-full max-w-xl rounded-[2rem] border border-cyan-300/30 bg-zinc-950/95 p-6 shadow-[0_0_60px_rgba(34,211,238,0.18)]">
        <div className="flex items-start gap-4">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-cyan-300/30 bg-cyan-500/10 shadow-[0_0_15px_rgba(34,211,238,0.2)]">
            {status?.lastPreviewImage ? (
              <img
                src={status.lastPreviewImage}
                alt="Current round preview"
                className="h-full w-full rounded-2xl object-cover"
              />
            ) : (
              <div className="h-4 w-4 rounded-full bg-cyan-300 shadow-[0_0_22px_rgba(34,211,238,0.9)] animate-pulse" />
            )}
          </div>

          <div className="flex-1 space-y-4">
            <div>
              <p className="font-[family-name:var(--font-jetbrains-mono)] text-[10px] uppercase tracking-[0.32em] text-cyan-200/85">
                Long Import Running
              </p>
              <h2 className="mt-2 text-2xl font-black tracking-tight text-zinc-50">
                Installing rounds can take a very long time.
              </h2>
              <p className="mt-3 text-sm leading-6 text-zinc-300">
                Hashes may need to be calculated, and video transcoding or preview generation may
                also be required.
              </p>
            </div>

            <div className="rounded-2xl border border-cyan-300/20 bg-cyan-500/10 p-4">
              <div className="flex items-center justify-between">
                <p className="font-[family-name:var(--font-jetbrains-mono)] text-[10px] uppercase tracking-[0.22em] text-cyan-100">
                  Progress
                </p>
                {eta && (
                  <p className="font-[family-name:var(--font-jetbrains-mono)] text-[10px] uppercase tracking-[0.1em] text-cyan-300 animate-pulse">
                    {eta}
                  </p>
                )}
              </div>

              {total > 0 && (
                <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-zinc-800/50">
                  <div
                    className="h-full bg-gradient-to-r from-cyan-500 to-blue-500 transition-all duration-500 ease-out"
                    style={{ width: `${Math.min(100, progress)}%` }}
                  />
                </div>
              )}

              <p className="mt-3 text-sm text-zinc-100">{summary}</p>
              <p className="mt-2 text-xs font-medium text-zinc-400 truncate">
                {status?.lastMessage ?? "Scanning files and preparing imported rounds..."}
              </p>
            </div>

            <div className="flex justify-end">
              <button
                type="button"
                onClick={onAbort}
                disabled={aborting}
                className={`rounded-xl border px-4 py-2 font-[family-name:var(--font-jetbrains-mono)] text-xs uppercase tracking-[0.22em] transition-all duration-200 ${aborting
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

function InstalledDatabaseExportDialog({
  state,
  exporting,
  onClose,
  onChange,
  onSubmit,
  selectionCount,
}: {
  state: InstalledDatabaseExportDialogState;
  exporting: boolean;
  onClose: () => void;
  onChange: (
    next:
      | InstalledDatabaseExportDialogState
      | ((current: InstalledDatabaseExportDialogState) => InstalledDatabaseExportDialogState)
  ) => void;
  onSubmit: () => void;
  selectionCount: { rounds: number; heroes: number };
}) {
  const hasResult = Boolean(state.result);
  const disableClose = exporting;
  const hasSelection = selectionCount.rounds > 0 || selectionCount.heroes > 0;

  return (
    <div
      className="fixed inset-0 z-[75] overflow-y-auto bg-[radial-gradient(circle_at_top,rgba(34,211,238,0.18),transparent_35%),rgba(2,6,23,0.84)] px-4 py-6 backdrop-blur-md sm:flex sm:items-center sm:justify-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="installed-database-export-title"
    >
      <div className="relative mx-auto w-full max-w-3xl overflow-hidden rounded-[2rem] border border-cyan-300/30 bg-slate-950/95 shadow-[0_30px_120px_rgba(8,145,178,0.3)] sm:max-h-[calc(100vh-3rem)]">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(34,211,238,0.16),transparent_30%),radial-gradient(circle_at_bottom_left,rgba(59,130,246,0.18),transparent_35%)]" />
        <div className="relative space-y-6 p-6 sm:max-h-[calc(100vh-3rem)] sm:overflow-y-auto sm:p-8">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-3">
              <p className="font-[family-name:var(--font-jetbrains-mono)] text-[10px] uppercase tracking-[0.34em] text-cyan-200/85">
                Library Export
              </p>
              <div>
                <h2
                  id="installed-database-export-title"
                  className="text-3xl font-black tracking-tight text-white sm:text-4xl"
                >
                  {hasResult ? "Export complete." : "Package your library."}
                </h2>
                <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-300">
                  {hasResult
                    ? "Your export is ready. You can close this dialog or use the path below."
                    : "Export your rounds and heroes with optional media files for sharing or backup."}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              disabled={disableClose}
              className={`rounded-xl border px-4 py-2 font-[family-name:var(--font-jetbrains-mono)] text-xs uppercase tracking-[0.2em] ${disableClose
                  ? "cursor-not-allowed border-slate-700 bg-slate-900 text-slate-500"
                  : "border-slate-600/80 bg-black/30 text-slate-300 transition-all duration-200 hover:border-cyan-200/60 hover:text-white"
                }`}
            >
              Close
            </button>
          </div>

          {hasResult ? (
            <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
              <div className="rounded-[1.5rem] border border-emerald-300/25 bg-emerald-500/10 p-5">
                <div className="flex items-center gap-3">
                  <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-emerald-300/35 bg-emerald-400/15 text-2xl text-emerald-100">
                    ✓
                  </div>
                  <div>
                    <p className="font-[family-name:var(--font-jetbrains-mono)] text-[10px] uppercase tracking-[0.24em] text-emerald-100/80">
                      Export Ready
                    </p>
                    <p className="text-sm text-emerald-50">
                      Media included: {state.result?.includeMedia ? "yes" : "no"}
                    </p>
                  </div>
                </div>
                <div className="mt-5 rounded-2xl border border-white/10 bg-black/20 p-4">
                  <p className="font-[family-name:var(--font-jetbrains-mono)] text-[10px] uppercase tracking-[0.22em] text-slate-400">
                    Export Folder
                  </p>
                  <p className="mt-2 break-all text-sm text-white">{state.result?.exportDir}</p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 rounded-[1.5rem] border border-cyan-300/18 bg-cyan-500/8 p-5 text-sm text-slate-100">
                <ExportStat label="Heroes" value={state.result?.heroFiles ?? 0} />
                <ExportStat label="Standalone" value={state.result?.roundFiles ?? 0} />
                <ExportStat label="Total Rounds" value={state.result?.exportedRounds ?? 0} />
                <ExportStat label="Videos" value={state.result?.videoFiles ?? 0} />
                {state.result?.includeMedia && (
                  <>
                    <ExportStat label="Funscripts" value={state.result?.funscriptFiles ?? 0} />
                    <ExportStat label="Mode" value="With Media" />
                  </>
                )}
                {!state.result?.includeMedia && <ExportStat label="Mode" value="Sidecars Only" />}
                {state.result?.fpackPath && <ExportStat label="Pack" value=".fpack" />}
              </div>
            </div>
          ) : (
            <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
              <div className="space-y-4">
                <div className="rounded-[1.5rem] border border-slate-700/80 bg-black/25 p-5">
                  <p className="font-[family-name:var(--font-jetbrains-mono)] text-[10px] uppercase tracking-[0.22em] text-slate-400">
                    Export Scope
                  </p>
                  <div className="mt-4 flex gap-3">
                    <button
                      type="button"
                      onClick={() =>
                        onChange((current) => ({
                          ...current,
                          exportMode: "all",
                          error: null,
                        }))
                      }
                      className={`flex-1 rounded-2xl border p-4 text-left transition-all ${state.exportMode === "all"
                          ? "border-cyan-300/60 bg-cyan-500/15"
                          : "border-slate-600 bg-slate-900/50 hover:border-slate-500"
                        }`}
                    >
                      <p className="font-semibold text-white">All</p>
                      <p className="mt-1 text-xs text-slate-400">Export entire library</p>
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        onChange((current) => ({
                          ...current,
                          exportMode: "selected",
                          error: null,
                        }))
                      }
                      disabled={!hasSelection}
                      className={`flex-1 rounded-2xl border p-4 text-left transition-all ${!hasSelection
                          ? "cursor-not-allowed border-slate-700 bg-slate-900/30 opacity-50"
                          : state.exportMode === "selected"
                            ? "border-violet-300/60 bg-violet-500/15"
                            : "border-slate-600 bg-slate-900/50 hover:border-slate-500"
                        }`}
                    >
                      <p className="font-semibold text-white">Selected</p>
                      <p className="mt-1 text-xs text-slate-400">
                        {hasSelection
                          ? `${selectionCount.rounds} rounds, ${selectionCount.heroes} heroes`
                          : "No selection"}
                      </p>
                    </button>
                  </div>
                </div>
                <div className="rounded-[1.5rem] border border-slate-700/80 bg-black/25 p-5">
                  <p className="font-[family-name:var(--font-jetbrains-mono)] text-[10px] uppercase tracking-[0.22em] text-slate-400">
                    Options
                  </p>
                  <label className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      className="form-checkbox h-5 w-5 rounded border-slate-700 bg-black/50 text-emerald-400 focus:ring-emerald-400 focus:ring-offset-slate-950"
                      checked={state.includeMedia}
                      onChange={(event) => {
                        const next = event.target.checked;
                        onChange((current) => ({
                          ...current,
                          includeMedia: next,
                          asFpack:
                            !next && !current.asFpack
                              ? true
                              : !next && current.asFpack
                                ? true
                                : next && current.asFpack
                                  ? false
                                  : current.asFpack,
                          error: null,
                        }));
                      }}
                      disabled={exporting}
                    />
                    <div>
                      <span className="text-sm font-semibold text-white">Include Media Files</span>
                      <p className="text-xs text-slate-400">
                        If unchecked, only text files and configurations are exported.
                      </p>
                    </div>
                  </label>

                  <label className="flex items-center gap-3 cursor-pointer mt-4">
                    <input
                      type="checkbox"
                      className="form-checkbox h-5 w-5 rounded border-slate-700 bg-black/50 text-emerald-400 focus:ring-emerald-400 focus:ring-offset-slate-950"
                      checked={state.asFpack}
                      onChange={(event) => {
                        onChange((current) => ({
                          ...current,
                          asFpack: event.target.checked,
                          error: null,
                        }));
                      }}
                      disabled={exporting}
                    />
                    <div>
                      <span className="text-sm font-semibold text-white">
                        Pack into .fpack File
                      </span>
                      <p className="text-xs text-slate-400">
                        Packs all exported files into a single ZIP archive (.fpack).
                      </p>
                    </div>
                  </label>
                </div>
              </div>

              <div className="rounded-[1.5rem] border border-slate-700/80 bg-black/25 p-5">
                <p className="font-[family-name:var(--font-jetbrains-mono)] text-[10px] uppercase tracking-[0.22em] text-slate-400">
                  What happens
                </p>
                <div className="mt-4 space-y-3 text-sm text-slate-200">
                  <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-4">
                    <p className="font-semibold text-white">1. Select scope</p>
                    <p className="mt-1 leading-6 text-slate-300">
                      {hasSelection
                        ? "Export all or just your selected items."
                        : "Select items in the library to enable partial export."}
                    </p>
                  </div>
                  <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-4">
                    <p className="font-semibold text-white">2. Media option</p>
                    <p className="mt-1 leading-6 text-slate-300">
                      {state.includeMedia
                        ? "Videos and funscripts will be copied to the export folder."
                        : "Only sidecar files (.round/.hero) will be created."}
                    </p>
                  </div>
                  <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-4">
                    <p className="font-semibold text-white">3. Export</p>
                    <p className="mt-1 leading-6 text-slate-300">
                      You will choose a destination folder, and the export will create a timestamped
                      package inside it.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {state.error && (
            <p className="rounded-2xl border border-rose-300/35 bg-rose-500/15 px-4 py-3 text-sm text-rose-100">
              {state.error}
            </p>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/10 pt-2">
            <p className="text-sm text-slate-400">
              {hasResult
                ? "You can close this dialog now."
                : state.exportMode === "selected" && !hasSelection
                  ? "Select items in the library first."
                  : "Click export to choose a destination and generate the package."}
            </p>
            <div className="flex flex-wrap gap-3">
              {!hasResult && (
                <button
                  type="button"
                  onClick={onSubmit}
                  disabled={exporting || (state.exportMode === "selected" && !hasSelection)}
                  className={`rounded-xl border px-5 py-2.5 font-[family-name:var(--font-jetbrains-mono)] text-xs uppercase tracking-[0.22em] transition-all duration-200 ${exporting || (state.exportMode === "selected" && !hasSelection)
                      ? "cursor-not-allowed border-slate-700 bg-slate-900 text-slate-500"
                      : "border-cyan-300/60 bg-cyan-500/22 text-cyan-100 hover:border-cyan-200/85 hover:bg-cyan-500/36"
                    }`}
                >
                  {exporting ? "Exporting..." : "Start Export"}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function RoundActionButton({
  label,
  onClick,
  onHover,
  disabled = false,
  description,
  tone = "violet",
}: {
  label: string;
  onClick: () => void;
  onHover: () => void;
  disabled?: boolean;
  description?: string;
  tone?: "violet" | "emerald" | "cyan" | "sky";
}) {
  const activeToneClass =
    tone === "emerald"
      ? "border-emerald-300/55 bg-emerald-500/18 text-emerald-100 hover:border-emerald-200/80 hover:bg-emerald-500/30"
      : tone === "cyan"
        ? "border-cyan-300/55 bg-cyan-500/18 text-cyan-100 hover:border-cyan-200/80 hover:bg-cyan-500/30"
        : tone === "sky"
          ? "border-sky-300/55 bg-sky-500/18 text-sky-100 hover:border-sky-200/80 hover:bg-sky-500/30"
          : "border-violet-300/55 bg-violet-500/18 text-violet-100 hover:border-violet-200/80 hover:bg-violet-500/30";

  return (
    <button
      type="button"
      disabled={disabled}
      aria-label={label}
      onMouseEnter={onHover}
      onFocus={onHover}
      onClick={onClick}
      className={`rounded-2xl border px-4 py-3 text-left font-[family-name:var(--font-jetbrains-mono)] text-xs uppercase tracking-[0.18em] transition-all duration-200 ${disabled
          ? "cursor-not-allowed border-zinc-700 bg-zinc-900/70 text-zinc-500"
          : activeToneClass
        }`}
    >
      <div>{label}</div>
      {description && (
        <div className="mt-2 text-[11px] normal-case tracking-normal opacity-80">{description}</div>
      )}
    </button>
  );
}

function WebsiteRoundInstallDialog({
  open,
  roundName,
  videoUrl,
  funscriptUrl,
  funscriptFileLabel,
  showFunscriptUrl,
  error,
  success,
  videoValidation,
  installing,
  disabled,
  onClose,
  onRoundNameChange,
  onVideoUrlChange,
  onFunscriptUrlChange,
  onSelectLocalFunscript,
  onInstall,
  onHoverSfx,
}: {
  open: boolean;
  roundName: string;
  videoUrl: string;
  funscriptUrl: string;
  funscriptFileLabel: string | null;
  showFunscriptUrl: boolean;
  error: string | null;
  success: string | null;
  videoValidation: WebsiteRoundVideoValidationState;
  installing: boolean;
  disabled: boolean;
  onClose: () => void;
  onRoundNameChange: (value: string) => void;
  onVideoUrlChange: (value: string) => void;
  onFunscriptUrlChange: (value: string) => void;
  onSelectLocalFunscript: () => void;
  onInstall: () => void;
  onHoverSfx: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement | null>(null);

  useControllerSurface({
    id: "website-round-install-dialog",
    scopeRef: dialogRef,
    priority: 180,
    enabled: open,
    initialFocusId: "website-round-name",
    onBack: () => {
      onClose();
      return true;
    },
  });

  useEffect(() => {
    if (!open) return undefined;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onClose();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[180] flex items-center justify-center bg-[radial-gradient(circle_at_top,rgba(192,38,211,0.18),transparent_35%),rgba(3,7,18,0.86)] px-4 py-6 backdrop-blur-md"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        className="relative w-full max-w-3xl overflow-hidden rounded-[2rem] border border-fuchsia-300/25 bg-slate-950/95 shadow-[0_28px_120px_rgba(168,85,247,0.25)]"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Install from web"
      >
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(217,70,239,0.14),transparent_28%),radial-gradient(circle_at_bottom_left,rgba(34,211,238,0.12),transparent_32%)]" />
        <div className="relative space-y-6 p-6 sm:p-8">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="font-[family-name:var(--font-jetbrains-mono)] text-[10px] uppercase tracking-[0.34em] text-fuchsia-200/80">
                Website Install
              </p>
              <h2 className="mt-3 text-3xl font-black tracking-tight text-white">
                Install From Web
              </h2>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-300">
                Create an installed round directly from a supported public website URL. Playback
                starts from the web source immediately and caches in the background.
              </p>
            </div>
            <button
              type="button"
              onMouseEnter={onHoverSfx}
              onClick={onClose}
              disabled={installing}
              className={`rounded-xl border px-4 py-2 font-[family-name:var(--font-jetbrains-mono)] text-xs uppercase tracking-[0.2em] ${installing
                  ? "cursor-not-allowed border-slate-700 bg-slate-900 text-slate-500"
                  : "border-slate-600/80 bg-black/30 text-slate-300 transition-all duration-200 hover:border-fuchsia-200/60 hover:text-white"
                }`}
            >
              Close
            </button>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-xs font-semibold uppercase tracking-[0.2em] text-zinc-400">
                Round Name
              </span>
              <input
                type="text"
                value={roundName}
                onChange={(event) => onRoundNameChange(event.target.value)}
                placeholder="My Website Round"
                className="w-full rounded-xl border border-fuchsia-300/30 bg-black/45 px-4 py-3 text-sm text-zinc-100 outline-none transition-colors focus:border-fuchsia-200/75"
                data-controller-focus-id="website-round-name"
                data-controller-initial="true"
                aria-label="Round Name"
              />
            </label>

            <label className="block lg:col-span-2">
              <span className="mb-1 block text-xs font-semibold uppercase tracking-[0.2em] text-zinc-400">
                Video URL
              </span>
              <input
                type="url"
                value={videoUrl}
                onChange={(event) => onVideoUrlChange(event.target.value)}
                placeholder="https://www.pornhub.com/view_video.php?viewkey=..."
                className={`w-full rounded-xl border bg-black/45 px-4 py-3 text-sm text-zinc-100 outline-none transition-colors focus:border-fuchsia-200/75 ${videoValidation.state === "unsupported"
                    ? "border-rose-300/60"
                    : videoValidation.state === "supported"
                      ? "border-emerald-300/60"
                      : videoValidation.state === "checking"
                        ? "border-cyan-300/60"
                        : "border-fuchsia-300/30"
                  }`}
                aria-label="Video URL"
              />
              {videoValidation.message ? (
                <span
                  className={`mt-2 block text-xs ${videoValidation.state === "unsupported"
                      ? "text-rose-200"
                      : videoValidation.state === "supported"
                        ? "text-emerald-200"
                        : "text-cyan-200"
                    }`}
                >
                  {videoValidation.message}
                </span>
              ) : null}
            </label>

            {showFunscriptUrl ? (
              <label className="block lg:col-span-2">
                <span className="mb-1 block text-xs font-semibold uppercase tracking-[0.2em] text-zinc-400">
                  Funscript URL
                </span>
                <input
                  type="url"
                  value={funscriptUrl}
                  onChange={(event) => onFunscriptUrlChange(event.target.value)}
                  placeholder="Optional: https://example.com/video.funscript"
                  className="w-full rounded-xl border border-cyan-300/30 bg-black/45 px-4 py-3 text-sm text-zinc-100 outline-none transition-colors focus:border-cyan-200/75"
                  aria-label="Funscript URL"
                />
              </label>
            ) : null}
          </div>

          {error ? (
            <div className="rounded-xl border border-rose-300/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
              {error}
            </div>
          ) : null}

          {success ? (
            <div className="rounded-xl border border-emerald-300/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">
              {success}
            </div>
          ) : null}

          {funscriptFileLabel ? (
            <div className="rounded-xl border border-cyan-300/30 bg-cyan-500/10 px-4 py-3 text-sm text-cyan-100">
              Local funscript attached: {funscriptFileLabel}
            </div>
          ) : null}

          <div className="flex flex-wrap gap-3">
            <RoundActionButton
              label="Select Local Funscript"
              description="Attach an optional local .funscript file"
              tone="cyan"
              disabled={disabled}
              onHover={onHoverSfx}
              onClick={onSelectLocalFunscript}
            />
            <RoundActionButton
              label={installing ? "Installing..." : "Install Website Round"}
              description="Create an installed round from the current website source fields."
              tone="violet"
              disabled={
                disabled ||
                videoValidation.state === "checking" ||
                videoValidation.state === "unsupported"
              }
              onHover={onHoverSfx}
              onClick={onInstall}
            />
          </div>

          <div className="rounded-xl border border-zinc-700/70 bg-black/30 px-4 py-3 text-xs text-zinc-400">
            Public website URLs only in v1. Private sessions, cookies, and login-gated sources are
            intentionally unsupported here.
            {!showFunscriptUrl
              ? " Use a local funscript by default, or enable the experimental remote funscript URL field in settings."
              : ""}
          </div>
        </div>
      </div>
    </div>
  );
}

function ExportStat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-2xl border border-white/8 bg-black/20 p-4">
      <p className="font-[family-name:var(--font-jetbrains-mono)] text-[10px] uppercase tracking-[0.18em] text-slate-400">
        {label}
      </p>
      <p className="mt-2 text-xl font-bold text-white">{value}</p>
    </div>
  );
}

function TechnicalDetail({
  label,
  value,
  className = "",
}: {
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <div
      className={`min-w-0 rounded-xl border border-white/6 bg-white/[0.03] px-2.5 py-2 ${className}`.trim()}
    >
      <p className="text-[9px] uppercase tracking-[0.2em] text-zinc-500">{label}</p>
      <p className="mt-1 break-all text-[10px] uppercase text-zinc-200">{value}</p>
    </div>
  );
}

function formatWindow(startTime: number | null, endTime: number | null): string {
  if (typeof startTime !== "number" || !Number.isFinite(startTime)) {
    return "Full";
  }
  const startLabel = formatMediaTimestamp(startTime);
  if (typeof endTime !== "number" || !Number.isFinite(endTime) || endTime <= startTime) {
    return `${startLabel}+`;
  }
  return `${startLabel}-${formatMediaTimestamp(endTime)}`;
}

function getRoundInstallSourceLabel(
  installSourceKey: string | null | undefined
): "Stash" | "Web" | "Local" {
  if (installSourceKey?.startsWith("stash:")) {
    return "Stash";
  }

  if (installSourceKey?.startsWith("website:")) {
    return "Web";
  }

  return "Local";
}

function summarizeHeroGroupPreviewState(
  rounds: InstalledRound[],
  isWebsiteVideoCaching: boolean
): {
  pendingCacheCount: number;
  pendingPreviewCount: number;
} {
  let pendingCacheCount = 0;
  let pendingPreviewCount = 0;

  for (const round of rounds) {
    const cacheStatus = getInstalledRoundWebsiteVideoCacheStatus(round);
    if (cacheStatus === "pending") {
      pendingCacheCount += 1;
      continue;
    }

    const isWebsiteRound = round.installSourceKey?.startsWith("website:") ?? false;
    if (isWebsiteVideoCaching && isWebsiteRound && !round.previewImage) {
      pendingPreviewCount += 1;
    }
  }

  return { pendingCacheCount, pendingPreviewCount };
}

function formatDate(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

function formatMediaTimestamp(valueMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(valueMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}
