import { Trans, useLingui } from "@lingui/react/macro";
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
import { LibraryExportOverlay } from "../components/LibraryExportOverlay";
import {
  EroScriptsFunscriptSearchDialog,
  type EroScriptsRoundInstallInput,
} from "../components/EroScriptsFunscriptSearchDialog";
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
import { getSinglePlayerAntiPerkPool, getSinglePlayerPerkPool } from "../game/data/perks";
import { MenuButton } from "../components/MenuButton";
import {
  db,
  type InstallFolderInspectionResult,
  type InstallFolderScanResult,
  type InstallScanStatus,
  type InstalledRoundCardAssets,
  type LibraryExportPackageAnalysis,
  type LibraryExportPackageStatus,
  type InstalledRound,
  type LegacyReviewedImportResult,
  type LibraryPackageExportResult,
  type VideoDownloadProgress,
  type WebsiteVideoScanStatus,
  type InstalledRoundCatalogEntry,
  type InstalledRoundMediaResources,
} from "../services/db";
import { getInstalledRoundCardAssetsCached } from "../services/installedRoundsCache";
import { playlists, type StoredPlaylist } from "../services/playlists";
import { trpc } from "../services/trpc";
import { importOpenedFile } from "../services/openedFiles";
import {
  buildRoundRenderRowsWithOptions,
  type RoundLibraryEntry,
  type RoundRenderRow,
} from "./roundRows";
import {
  buildAggregateDownloadProgress,
  buildDownloadProgressByUri,
  buildPlaylistGroupingData,
  buildSourceHeroOptions,
  filterAndSortRounds,
  toIndexedRound,
  type ScriptFilter,
  type SortMode,
  type SourceHeroOption,
  type TypeFilter,
} from "./roundsSelectors";
import { usePlayableVideoFallback } from "../hooks/usePlayableVideoFallback";
import { useSfwMode } from "../hooks/useSfwMode";
import { playHoverSound, playSelectSound } from "../utils/audio";
import { formatDurationLabel, getRoundDurationSec } from "../utils/duration";
import { abbreviateNsfwText } from "../utils/sfwText";
import { VirtualizedRoundLibraryGrid } from "../features/library/components/VirtualizedRoundLibraryGrid";
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

type GroupMode = "hero" | "playlist";
type EroScriptsDialogContext = "library" | "website-round" | "edit-round";
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
  excludeFromRandom: boolean;
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
  compressionMode: "copy" | "av1" | null;
  compressionStrength: number;
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
type AsyncStatus = "idle" | "loading" | "ready" | "error";
type AsyncResource<T> = {
  status: AsyncStatus;
  data: T;
  error: string | null;
  hasLoadedOnce: boolean;
};
type PreviewSettings = {
  intermediaryLoadingPrompt: string;
  intermediaryLoadingDurationSec: number;
  intermediaryReturnPauseSec: number;
  roundProgressBarAlwaysVisible: boolean;
};
type WebInstallSettings = {
  installWebFunscriptUrlEnabled: boolean;
};
const INTERMEDIARY_LOADING_PROMPT_KEY = "game.intermediary.loadingPrompt";
const INTERMEDIARY_LOADING_DURATION_KEY = "game.intermediary.loadingDurationSec";
const INTERMEDIARY_RETURN_PAUSE_KEY = "game.intermediary.returnPauseSec";
const ROUND_CARD_DATE_FORMATTER = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  year: "numeric",
});
const RoundsSearchSchema = z.object({
  open: z.enum(["install-rounds", "install-web"]).optional(),
});

const InstallScanStatusBadge = memo(function InstallScanStatusBadge({
  status,
}: {
  status: InstallScanStatus;
}) {
  const { t } = useLingui();
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

  const summary = t`${stats.installed} rounds / ${stats.playlistsImported} playlists / ${stats.updated} updated / ${stats.failed} failed${progressText}`;
  const label =
    status.state === "running"
      ? t`Scan running (${summary})`
      : status.state === "aborted"
        ? t`Scan aborted (${summary})`
        : status.state === "error"
          ? t`Scan error (${summary})`
          : t`Last scan done (${summary})`;

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
          <Trans>Library Idle</Trans>
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
  const { t } = useLingui();
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
            <Trans>Transfer Guidance</Trans>
          </h3>
          <p className="mt-1 text-sm text-zinc-300">
            <Trans>
              Keep the flow predictable: install from folders for bulk local content, use safe
              exports for portability, and only include URIs when the receiving machine expects
              them.
            </Trans>
          </p>
        </div>
        {scanStatus && <InstallScanStatusBadge status={scanStatus} />}
      </div>
      <InlineMetrics
        className="mt-4"
        metrics={[
          { label: t`Folders`, value: scanStatus?.stats.scannedFolders ?? 0, tone: "violet" },
          { label: t`Installed`, value: scanStatus?.stats.installed ?? 0, tone: "emerald" },
          { label: t`Playlists`, value: scanStatus?.stats.playlistsImported ?? 0, tone: "cyan" },
          { label: t`Failed`, value: scanStatus?.stats.failed ?? 0, tone: "amber" },
        ]}
      />
    </>
  );
});
function createAsyncResource<T>(data: T): AsyncResource<T> {
  return {
    status: "idle",
    data,
    error: null,
    hasLoadedOnce: false,
  };
}

function LoadingPillSkeleton() {
  return (
    <span className="inline-flex h-7 w-24 animate-pulse rounded-xl border border-zinc-700/80 bg-zinc-900/70" />
  );
}

function RoundsLibraryMetricsSkeleton() {
  return (
    <section className="relative z-40 animate-entrance rounded-3xl border border-purple-400/25 bg-zinc-950/55 p-5 backdrop-blur-xl">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-3">
          <div className="h-6 w-48 animate-pulse rounded bg-violet-200/20" />
          <div className="h-4 w-80 max-w-full animate-pulse rounded bg-zinc-300/10" />
        </div>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <div
            key={`metric-skeleton:${index}`}
            className="rounded-2xl border border-zinc-700/60 bg-black/25 p-4"
          >
            <div className="h-3 w-20 animate-pulse rounded bg-zinc-300/10" />
            <div className="mt-3 h-8 w-12 animate-pulse rounded bg-violet-300/15" />
          </div>
        ))}
      </div>
    </section>
  );
}

function RoundsLibraryFiltersSkeleton() {
  return (
    <section
      className="relative z-40 animate-entrance rounded-3xl border border-purple-400/25 bg-zinc-950/55 p-5 backdrop-blur-xl"
      style={{ animationDelay: "0.08s" }}
    >
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-3">
          <div className="h-6 w-44 animate-pulse rounded bg-violet-200/20" />
          <div className="h-4 w-96 max-w-full animate-pulse rounded bg-zinc-300/10" />
        </div>
        <LoadingPillSkeleton />
      </div>
      <div className="mt-5 grid grid-cols-1 gap-3 lg:grid-cols-5">
        <div className="h-12 rounded-xl border border-purple-300/20 bg-black/45 animate-pulse lg:col-span-2" />
        <div className="h-12 rounded-xl border border-zinc-700 bg-black/30 animate-pulse" />
        <div className="h-12 rounded-xl border border-zinc-700 bg-black/30 animate-pulse" />
        <div className="h-12 rounded-xl border border-zinc-700 bg-black/30 animate-pulse" />
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <LoadingPillSkeleton />
        <LoadingPillSkeleton />
        <LoadingPillSkeleton />
        <LoadingPillSkeleton />
      </div>
    </section>
  );
}

function RoundsLibraryGridSkeleton({ refreshing = false }: { refreshing?: boolean }) {
  return (
    <section
      className="animate-entrance rounded-3xl border border-purple-400/25 bg-zinc-950/55 p-5 backdrop-blur-xl"
      style={{ animationDelay: "0.11s" }}
    >
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-3">
          <div className="h-6 w-40 animate-pulse rounded bg-violet-200/20" />
          <div className="h-4 w-72 max-w-full animate-pulse rounded bg-zinc-300/10" />
        </div>
        {refreshing ? (
          <div className="rounded-xl border border-cyan-300/35 bg-cyan-500/10 px-4 py-2 font-[family-name:var(--font-jetbrains-mono)] text-[10px] uppercase tracking-[0.18em] text-cyan-100">
            <Trans>Refreshing library...</Trans>
          </div>
        ) : (
          <div className="flex gap-2">
            <LoadingPillSkeleton />
            <LoadingPillSkeleton />
          </div>
        )}
      </div>
      <div className="mt-5 grid gap-5 md:grid-cols-2 xl:grid-cols-2">
        {Array.from({ length: 6 }, (_, index) => (
          <div
            key={`round-card-skeleton:${index}`}
            className="rounded-[1.75rem] border border-zinc-700/70 bg-black/25 p-5"
          >
            <div className="aspect-[16/9] animate-pulse rounded-2xl bg-zinc-800/80" />
            <div className="mt-4 h-5 w-40 animate-pulse rounded bg-violet-300/15" />
            <div className="mt-3 h-4 w-full animate-pulse rounded bg-zinc-300/10" />
            <div className="mt-2 h-4 w-3/4 animate-pulse rounded bg-zinc-300/10" />
            <div className="mt-5 flex gap-2">
              <LoadingPillSkeleton />
              <LoadingPillSkeleton />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function LibraryErrorState({
  message,
  onRetry,
  onHoverSfx,
  onSelectSfx,
}: {
  message: string;
  onRetry: () => void;
  onHoverSfx: () => void;
  onSelectSfx: () => void;
}) {
  const { t } = useLingui();
  return (
    <section
      className="animate-entrance rounded-3xl border border-rose-400/25 bg-zinc-950/55 p-5 backdrop-blur-xl"
      style={{ animationDelay: "0.11s" }}
    >
      <div className="rounded-2xl border border-rose-400/30 bg-rose-500/10 p-8 text-center">
        <p className="font-[family-name:var(--font-jetbrains-mono)] text-sm uppercase tracking-[0.28em] text-rose-200">
          <Trans>Failed to load installed rounds</Trans>
        </p>
        <p className="mt-3 text-sm text-zinc-300">{message}</p>
        <div className="mt-5 flex justify-center">
          <RoundActionButton
            label={t`Retry`}
            tone="rose"
            onHover={onHoverSfx}
            onClick={() => {
              onSelectSfx();
              onRetry();
            }}
          />
        </div>
      </div>
    </section>
  );
}

const DEFAULT_INTERMEDIARY_LOADING_DURATION_SEC = 5;
const DEFAULT_INTERMEDIARY_RETURN_PAUSE_SEC = 4;
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

function pickHeroGroupRoundToKeep<TRound extends RoundLibraryEntry>(
  rounds: TRound[]
): TRound | null {
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

function getResourceFunscriptState(
  resource: { funscriptUri?: string | null; hasFunscript?: boolean } | undefined
) {
  if (!resource) return { hasFunscript: false, funscriptUri: null as string | null };
  const funscriptUri =
    "funscriptUri" in resource && typeof resource.funscriptUri === "string"
      ? resource.funscriptUri
      : null;
  return {
    hasFunscript:
      Boolean(funscriptUri) || ("hasFunscript" in resource && resource.hasFunscript === true),
    funscriptUri,
  };
}

function roundHasPlayableResource(round: RoundLibraryEntry): boolean {
  return round.resources.length > 0;
}

function roundHasFunscript(round: RoundLibraryEntry): boolean {
  return getResourceFunscriptState(round.resources[0]).hasFunscript;
}

function toRoundEditDraft(
  round: RoundLibraryEntry,
  mediaResources?: InstalledRoundMediaResources | null
): RoundEditDraft {
  const primaryResource = mediaResources?.resources[0] ?? round.resources[0] ?? null;
  const { funscriptUri } = getResourceFunscriptState(primaryResource ?? undefined);
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
    funscriptUri,
    excludeFromRandom: round.excludeFromRandom ?? false,
  };
}

function toHeroEditDraft(round: RoundLibraryEntry): HeroEditDraft | null {
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

function isTemplateRound(round: RoundLibraryEntry): boolean {
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
): Promise<InstalledRoundCatalogEntry[]> =>
  db.round.findInstalledCatalog(includeDisabled, includeTemplates);

const getAvailablePlaylists = async (): Promise<StoredPlaylist[]> => playlists.list();

const getDisabledRoundIds = async (): Promise<Set<string>> =>
  new Set(await db.round.getDisabledIds());

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
  component: InstalledRoundsPage,
});

export function InstalledRoundsPage() {
  const { t } = useLingui();
  const search = Route.useSearch();
  const sfwMode = useSfwMode();
  const { showToast } = useToast();
  const [deleteRoundDialog, setDeleteRoundDialog] = useState<DeleteRoundDialogState | null>(null);
  const [deleteHeroDialog, setDeleteHeroDialog] = useState<DeleteHeroDialogState | null>(null);
  const [showDisabledRounds, setShowDisabledRounds] = useState(false);
  const [roundsResource, setRoundsResource] = useState<
    AsyncResource<InstalledRoundCatalogEntry[]>
  >(() =>
    createAsyncResource<InstalledRoundCatalogEntry[]>([])
  );
  const [playlistsResource, setPlaylistsResource] = useState<AsyncResource<StoredPlaylist[]>>(() =>
    createAsyncResource<StoredPlaylist[]>([])
  );
  const [disabledIdsResource, setDisabledIdsResource] = useState<AsyncResource<Set<string>>>(() =>
    createAsyncResource<Set<string>>(new Set())
  );
  const [previewSettingsResource, setPreviewSettingsResource] = useState<
    AsyncResource<PreviewSettings>
  >(() =>
    createAsyncResource<PreviewSettings>({
      intermediaryLoadingPrompt: DEFAULT_INTERMEDIARY_LOADING_PROMPT,
      intermediaryLoadingDurationSec: DEFAULT_INTERMEDIARY_LOADING_DURATION_SEC,
      intermediaryReturnPauseSec: DEFAULT_INTERMEDIARY_RETURN_PAUSE_SEC,
      roundProgressBarAlwaysVisible: DEFAULT_ROUND_PROGRESS_BAR_ALWAYS_VISIBLE,
    })
  );
  const [webInstallSettingsResource, setWebInstallSettingsResource] = useState<
    AsyncResource<WebInstallSettings>
  >(() =>
    createAsyncResource<WebInstallSettings>({
      installWebFunscriptUrlEnabled: DEFAULT_INSTALL_WEB_FUNSCRIPT_URL_ENABLED,
    })
  );
  const [controllerSupportEnabled, setControllerSupportEnabled] = useState(
    DEFAULT_CONTROLLER_SUPPORT_ENABLED
  );
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
  const [previewInstalledRounds, setPreviewInstalledRounds] = useState<InstalledRound[]>([]);
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
  const [isAutoDifficultyLoading, setIsAutoDifficultyLoading] = useState(false);
  const [showInstallOverlay, setShowInstallOverlay] = useState(false);
  const [isAbortingInstall, setIsAbortingInstall] = useState(false);
  const [legacyPlaylistReview, setLegacyPlaylistReview] =
    useState<LegacyPlaylistReviewState | null>(null);
  const [exportDialog, setExportDialog] = useState<InstalledDatabaseExportDialogState | null>(null);
  const [libraryExportStatus, setLibraryExportStatus] = useState<LibraryExportPackageStatus | null>(
    null
  );
  const [showLibraryExportOverlay, setShowLibraryExportOverlay] = useState(false);
  const [isAbortingLibraryExport, setIsAbortingLibraryExport] = useState(false);
  const [visibleRoundIds, setVisibleRoundIds] = useState<string[]>([]);
  const [cardAssetsByRoundId, setCardAssetsByRoundId] = useState<
    Map<string, InstalledRoundCardAssets>
  >(new Map());
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
  const [eroscriptsDialogContext, setEroScriptsDialogContext] =
    useState<EroScriptsDialogContext | null>(null);
  const rounds = roundsResource.data;
  const availablePlaylists = playlistsResource.data;
  const disabledRoundIds = disabledIdsResource.data;
  const intermediaryLoadingPrompt = previewSettingsResource.data.intermediaryLoadingPrompt;
  const intermediaryLoadingDurationSec =
    previewSettingsResource.data.intermediaryLoadingDurationSec;
  const intermediaryReturnPauseSec = previewSettingsResource.data.intermediaryReturnPauseSec;
  const roundProgressBarAlwaysVisible = previewSettingsResource.data.roundProgressBarAlwaysVisible;
  const installWebFunscriptUrlEnabled =
    webInstallSettingsResource.data.installWebFunscriptUrlEnabled;

  useEffect(() => {
    let mounted = true;

    const pollExportStatus = async () => {
      try {
        const status = await db.install.getExportPackageStatus();
        if (!mounted) return;
        setLibraryExportStatus(status);
        if (status.state === "running") {
          setShowLibraryExportOverlay(true);
          return;
        }
        setShowLibraryExportOverlay(false);
        setIsAbortingLibraryExport(false);
        if (status.state === "aborted") {
          setExportDialog((current) =>
            current
              ? {
                  ...current,
                  result: null,
                  error: t`Export canceled.`,
                }
              : current
          );
        } else if (status.state === "error") {
          setExportDialog((current) =>
            current
              ? {
                  ...current,
                  error:
                    current.error ?? status.lastMessage ?? t`Failed to export library package.`,
                }
              : current
          );
        }
      } catch (error) {
        console.error("Failed to poll library export status", error);
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
  }, []);
  useEffect(() => {
    let mounted = true;
    void getControllerSupportEnabled().then((nextControllerSupportEnabled) => {
      if (!mounted) return;
      setControllerSupportEnabled(nextControllerSupportEnabled);
    });
    return () => {
      mounted = false;
    };
  }, []);
  const [scrollContainer, setScrollContainer] = useState<HTMLDivElement | null>(null);
  const navigate = useNavigate();
  const deferredQuery = useDeferredValue(query);
  const websiteRoundVideoValidationRequestIdRef = useRef(0);
  const consumedPaletteOpenRef = useRef<typeof search.open | null>(null);
  const roundsRequestRef = useRef<Promise<InstalledRoundCatalogEntry[]> | null>(null);
  const roundsRequestIncludeDisabledRef = useRef<boolean | null>(null);
  const fullRoundsRequestRef = useRef<Promise<InstalledRound[]> | null>(null);
  const fullRoundsRequestIncludeDisabledRef = useRef<boolean | null>(null);
  const fullRoundsCacheRef = useRef<InstalledRound[] | null>(null);
  const fullRoundsCacheIncludeDisabledRef = useRef<boolean | null>(null);
  const disabledIdsRequestRef = useRef<Promise<Set<string>> | null>(null);
  const playlistsRequestRef = useRef<Promise<StoredPlaylist[]> | null>(null);
  const previewSettingsRequestRef = useRef<Promise<PreviewSettings> | null>(null);
  const webInstallSettingsRequestRef = useRef<Promise<WebInstallSettings> | null>(null);
  const loadedRoundsIncludeDisabledRef = useRef<boolean | null>(null);

  const goBack = useCallback(() => {
    void navigate({ to: "/" });
  }, [navigate]);

  const handleHoverSfx = useCallback(() => {
    playHoverSound();
  }, []);
  const handleSelectSfx = useCallback(() => {
    playSelectSound();
  }, []);

  const abortLibraryExport = useCallback(async () => {
    setIsAbortingLibraryExport(true);
    try {
      const status = await db.install.abortExportPackage();
      setLibraryExportStatus(status);
    } catch (error) {
      console.error("Failed to abort library export", error);
      setIsAbortingLibraryExport(false);
    }
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

  const loadInstalledRounds = useCallback(
    async ({
      force = false,
      includeDisabled = showDisabledRounds,
    }: { force?: boolean; includeDisabled?: boolean } = {}) => {
      if (
        roundsRequestRef.current &&
        roundsRequestIncludeDisabledRef.current === includeDisabled &&
        !force
      ) {
        return roundsRequestRef.current;
      }
      if (
        !force &&
        roundsResource.hasLoadedOnce &&
        loadedRoundsIncludeDisabledRef.current === includeDisabled
      ) {
        return Promise.resolve(roundsResource.data);
      }

      setRoundsResource((current) => ({
        ...current,
        status: "loading",
        error: null,
      }));

      const request = getInstalledRounds(includeDisabled)
        .then((nextRounds) => {
          loadedRoundsIncludeDisabledRef.current = includeDisabled;
          setRoundsResource({
            status: "ready",
            data: nextRounds,
            error: null,
            hasLoadedOnce: true,
          });
          return nextRounds;
        })
        .catch((error) => {
          console.error("Error loading installed rounds", error);
          const message =
            error instanceof Error ? error.message : t`Failed to load installed rounds.`;
          setRoundsResource((current) => ({
            status: "error",
            data: current.hasLoadedOnce ? current.data : [],
            error: message,
            hasLoadedOnce: current.hasLoadedOnce,
          }));
          throw error;
        })
        .finally(() => {
          if (roundsRequestRef.current === request) {
            roundsRequestRef.current = null;
            roundsRequestIncludeDisabledRef.current = null;
          }
        });

      roundsRequestRef.current = request;
      roundsRequestIncludeDisabledRef.current = includeDisabled;
      return request;
    },
    [roundsResource.data, roundsResource.hasLoadedOnce, showDisabledRounds]
  );

  const loadFullInstalledRoundsForPreview = useCallback(
    async (includeDisabled = showDisabledRounds) => {
      if (
        fullRoundsCacheRef.current &&
        fullRoundsCacheIncludeDisabledRef.current === includeDisabled
      ) {
        return fullRoundsCacheRef.current;
      }
      if (
        fullRoundsRequestRef.current &&
        fullRoundsRequestIncludeDisabledRef.current === includeDisabled
      ) {
        return fullRoundsRequestRef.current;
      }

      const request = db.round
        .findInstalled(includeDisabled)
        .then((nextRounds) => {
          fullRoundsCacheRef.current = nextRounds;
          fullRoundsCacheIncludeDisabledRef.current = includeDisabled;
          return nextRounds;
        })
        .finally(() => {
          if (fullRoundsRequestRef.current === request) {
            fullRoundsRequestRef.current = null;
            fullRoundsRequestIncludeDisabledRef.current = null;
          }
        });

      fullRoundsRequestRef.current = request;
      fullRoundsRequestIncludeDisabledRef.current = includeDisabled;
      return request;
    },
    [showDisabledRounds]
  );

  const loadDisabledRoundIds = useCallback(
    async ({ force = false }: { force?: boolean } = {}) => {
      if (disabledIdsRequestRef.current && !force) {
        return disabledIdsRequestRef.current;
      }
      if (!force && disabledIdsResource.hasLoadedOnce) {
        return Promise.resolve(disabledIdsResource.data);
      }

      setDisabledIdsResource((current) => ({
        ...current,
        status: "loading",
        error: null,
      }));

      const request = getDisabledRoundIds()
        .then((nextIds) => {
          setDisabledIdsResource({
            status: "ready",
            data: nextIds,
            error: null,
            hasLoadedOnce: true,
          });
          return nextIds;
        })
        .catch((error) => {
          console.error("Error loading disabled round IDs", error);
          const message =
            error instanceof Error ? error.message : t`Failed to load disabled round IDs.`;
          setDisabledIdsResource((current) => ({
            status: "error",
            data: current.hasLoadedOnce ? current.data : new Set<string>(),
            error: message,
            hasLoadedOnce: current.hasLoadedOnce,
          }));
          throw error;
        })
        .finally(() => {
          if (disabledIdsRequestRef.current === request) {
            disabledIdsRequestRef.current = null;
          }
        });

      disabledIdsRequestRef.current = request;
      return request;
    },
    [disabledIdsResource.data, disabledIdsResource.hasLoadedOnce]
  );

  const loadAvailablePlaylists = useCallback(
    async ({ force = false }: { force?: boolean } = {}) => {
      if (playlistsRequestRef.current && !force) {
        return playlistsRequestRef.current;
      }
      if (!force && playlistsResource.hasLoadedOnce) {
        return Promise.resolve(playlistsResource.data);
      }

      setPlaylistsResource((current) => ({
        ...current,
        status: "loading",
        error: null,
      }));

      const request = getAvailablePlaylists()
        .then((nextPlaylists) => {
          setPlaylistsResource({
            status: "ready",
            data: nextPlaylists,
            error: null,
            hasLoadedOnce: true,
          });
          return nextPlaylists;
        })
        .catch((error) => {
          console.error("Error loading playlists", error);
          const message = error instanceof Error ? error.message : t`Failed to load playlists.`;
          setPlaylistsResource((current) => ({
            status: "error",
            data: current.hasLoadedOnce ? current.data : [],
            error: message,
            hasLoadedOnce: current.hasLoadedOnce,
          }));
          throw error;
        })
        .finally(() => {
          if (playlistsRequestRef.current === request) {
            playlistsRequestRef.current = null;
          }
        });

      playlistsRequestRef.current = request;
      return request;
    },
    [playlistsResource.data, playlistsResource.hasLoadedOnce]
  );

  const loadPreviewSettings = useCallback(
    async ({ force = false }: { force?: boolean } = {}) => {
      if (previewSettingsRequestRef.current && !force) {
        return previewSettingsRequestRef.current;
      }
      if (!force && previewSettingsResource.hasLoadedOnce) {
        return Promise.resolve(previewSettingsResource.data);
      }

      setPreviewSettingsResource((current) => ({
        ...current,
        status: "loading",
        error: null,
      }));

      const request = Promise.all([
        getIntermediaryLoadingPrompt(),
        getIntermediaryLoadingDurationSec(),
        getIntermediaryReturnPauseSec(),
        getRoundProgressBarAlwaysVisible(),
      ])
        .then(
          ([
            nextIntermediaryLoadingPrompt,
            nextIntermediaryLoadingDurationSec,
            nextIntermediaryReturnPauseSec,
            nextRoundProgressBarAlwaysVisible,
          ]) => {
            const nextSettings = {
              intermediaryLoadingPrompt: nextIntermediaryLoadingPrompt,
              intermediaryLoadingDurationSec: nextIntermediaryLoadingDurationSec,
              intermediaryReturnPauseSec: nextIntermediaryReturnPauseSec,
              roundProgressBarAlwaysVisible: nextRoundProgressBarAlwaysVisible,
            };
            setPreviewSettingsResource({
              status: "ready",
              data: nextSettings,
              error: null,
              hasLoadedOnce: true,
            });
            return nextSettings;
          }
        )
        .catch((error) => {
          console.warn("Failed to load preview settings", error);
          const message =
            error instanceof Error ? error.message : t`Failed to load preview settings.`;
          setPreviewSettingsResource((current) => ({
            status: "error",
            data: current.data,
            error: message,
            hasLoadedOnce: current.hasLoadedOnce,
          }));
          throw error;
        })
        .finally(() => {
          if (previewSettingsRequestRef.current === request) {
            previewSettingsRequestRef.current = null;
          }
        });

      previewSettingsRequestRef.current = request;
      return request;
    },
    [previewSettingsResource.data, previewSettingsResource.hasLoadedOnce]
  );

  const loadWebInstallSettings = useCallback(
    async ({ force = false }: { force?: boolean } = {}) => {
      if (webInstallSettingsRequestRef.current && !force) {
        return webInstallSettingsRequestRef.current;
      }
      if (!force && webInstallSettingsResource.hasLoadedOnce) {
        return Promise.resolve(webInstallSettingsResource.data);
      }

      setWebInstallSettingsResource((current) => ({
        ...current,
        status: "loading",
        error: null,
      }));

      const request = getInstallWebFunscriptUrlEnabled()
        .then((nextEnabled) => {
          const nextSettings = { installWebFunscriptUrlEnabled: nextEnabled };
          setWebInstallSettingsResource({
            status: "ready",
            data: nextSettings,
            error: null,
            hasLoadedOnce: true,
          });
          return nextSettings;
        })
        .catch((error) => {
          console.warn("Failed to load web install settings", error);
          const message =
            error instanceof Error ? error.message : t`Failed to load web install settings.`;
          setWebInstallSettingsResource((current) => ({
            status: "error",
            data: current.data,
            error: message,
            hasLoadedOnce: current.hasLoadedOnce,
          }));
          throw error;
        })
        .finally(() => {
          if (webInstallSettingsRequestRef.current === request) {
            webInstallSettingsRequestRef.current = null;
          }
        });

      webInstallSettingsRequestRef.current = request;
      return request;
    },
    [webInstallSettingsResource.data, webInstallSettingsResource.hasLoadedOnce]
  );

  const refreshInstalledRounds = useCallback(async () => {
    fullRoundsCacheRef.current = null;
    fullRoundsCacheIncludeDisabledRef.current = null;
    fullRoundsRequestRef.current = null;
    fullRoundsRequestIncludeDisabledRef.current = null;
    setPreviewInstalledRounds([]);
    if (!roundsResource.hasLoadedOnce && activeSectionId !== "library") {
      return;
    }
    await loadInstalledRounds({ force: true, includeDisabled: showDisabledRounds });
    if (disabledIdsResource.hasLoadedOnce || activeSectionId === "library") {
      await loadDisabledRoundIds({ force: true });
    }
  }, [
    activeSectionId,
    disabledIdsResource.hasLoadedOnce,
    loadDisabledRoundIds,
    loadInstalledRounds,
    roundsResource.hasLoadedOnce,
    showDisabledRounds,
  ]);

  const refreshAvailablePlaylists = useCallback(async () => {
    await loadAvailablePlaylists({ force: true });
  }, [loadAvailablePlaylists]);

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
        message: t`Enter a valid public http(s) website video URL.`,
      });
      return;
    }

    const requestId = ++websiteRoundVideoValidationRequestIdRef.current;
    setWebsiteRoundVideoValidation({
      state: "checking",
      message: t`Checking website support...`,
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
            message: t`Supported via ${sourceLabel}${titleSuffix}`,
          });
        })
        .catch((error) => {
          if (websiteRoundVideoValidationRequestIdRef.current !== requestId) return;
          setWebsiteRoundVideoValidation({
            state: "unsupported",
            message:
              error instanceof Error ? error.message : t`This website video URL is not supported.`,
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
        installedRounds: previewInstalledRounds,
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
      previewInstalledRounds,
    ]
  );

  useEffect(() => {
    if (activeSectionId !== "library") {
      return;
    }
    if (!roundsResource.hasLoadedOnce) {
      void loadInstalledRounds().catch(() => undefined);
      void loadDisabledRoundIds().catch(() => undefined);
    } else if (!disabledIdsResource.hasLoadedOnce) {
      void loadDisabledRoundIds().catch(() => undefined);
    }
  }, [
    activeSectionId,
    disabledIdsResource.hasLoadedOnce,
    loadDisabledRoundIds,
    loadInstalledRounds,
    roundsResource.hasLoadedOnce,
  ]);

  useEffect(() => {
    if (!roundsResource.hasLoadedOnce) {
      return;
    }
    if (loadedRoundsIncludeDisabledRef.current === showDisabledRounds) {
      return;
    }
    void loadInstalledRounds({ force: true, includeDisabled: showDisabledRounds }).catch(
      () => undefined
    );
  }, [loadInstalledRounds, roundsResource.hasLoadedOnce, showDisabledRounds]);

  useEffect(() => {
    if (
      groupMode !== "playlist" ||
      playlistsResource.hasLoadedOnce ||
      playlistsResource.status === "loading"
    ) {
      return;
    }
    void loadAvailablePlaylists().catch(() => undefined);
  }, [
    groupMode,
    loadAvailablePlaylists,
    playlistsResource.hasLoadedOnce,
    playlistsResource.status,
  ]);

  useEffect(() => {
    if (
      !activePreviewRound ||
      previewSettingsResource.hasLoadedOnce ||
      previewSettingsResource.status === "loading"
    ) {
      return;
    }
    void loadPreviewSettings().catch(() => undefined);
  }, [
    activePreviewRound,
    loadPreviewSettings,
    previewSettingsResource.hasLoadedOnce,
    previewSettingsResource.status,
  ]);

  useEffect(() => {
    if (
      !websiteRoundDialogOpen ||
      webInstallSettingsResource.hasLoadedOnce ||
      webInstallSettingsResource.status === "loading"
    ) {
      return;
    }
    void loadWebInstallSettings().catch(() => undefined);
  }, [
    loadWebInstallSettings,
    webInstallSettingsResource.hasLoadedOnce,
    webInstallSettingsResource.status,
    websiteRoundDialogOpen,
  ]);

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

  useEffect(() => {
    setCardAssetsByRoundId(new Map());
  }, [rounds, showDisabledRounds]);

  useEffect(() => {
    const nextVisibleRoundIds = [...new Set(visibleRoundIds.filter((roundId) => roundId.length > 0))];
    if (nextVisibleRoundIds.length === 0) {
      return;
    }

    let cancelled = false;
    void getInstalledRoundCardAssetsCached(nextVisibleRoundIds, showDisabledRounds)
      .then((entries) => {
        if (cancelled || entries.length === 0) {
          return;
        }
        setCardAssetsByRoundId((previous) => {
          let changed = false;
          const next = new Map(previous);
          for (const entry of entries) {
            if (next.get(entry.roundId) === entry) {
              continue;
            }
            next.set(entry.roundId, entry);
            changed = true;
          }
          return changed ? next : previous;
        });
      })
      .catch((error) => {
        console.error("Failed to load installed round card assets", error);
      });

    return () => {
      cancelled = true;
    };
  }, [showDisabledRounds, visibleRoundIds]);

  const downloadProgressByUri = useMemo(
    () => buildDownloadProgressByUri(downloadProgresses),
    [downloadProgresses]
  );

  const aggregateDownloadProgress = useMemo(
    () => buildAggregateDownloadProgress(downloadProgresses),
    [downloadProgresses]
  );

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
  const filteredRounds = useMemo(
    () =>
      filterAndSortRounds({
        indexedRounds,
        query: deferredQuery,
        typeFilter,
        scriptFilter,
        sortMode,
      }),
    [deferredQuery, indexedRounds, scriptFilter, sortMode, typeFilter]
  );
  const playlistGroupingData = useMemo(
    () =>
      groupMode === "playlist" && availablePlaylists.length > 0
        ? buildPlaylistGroupingData(availablePlaylists, rounds)
        : null,
    [availablePlaylists, groupMode, rounds]
  );
  const playlistsByRoundId = playlistGroupingData?.playlistsByRoundId ?? null;
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
    () => rounds.filter((round) => roundHasFunscript(round)).length,
    [rounds]
  );
  const sourceHeroOptions = useMemo<SourceHeroOption[]>(
    () => buildSourceHeroOptions(rounds),
    [rounds]
  );
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
      ? t`Oldest`
      : sortMode === "difficulty"
        ? t`Difficulty`
        : sortMode === "bpm"
          ? t`BPM`
          : sortMode === "length"
            ? t`Length`
            : sortMode === "name"
              ? t`Name`
              : sortMode === "excluded"
                ? t`Excluded`
                : t`Newest`;
  const groupModeLabel = groupMode === "playlist" ? t`Playlist` : t`Hero`;
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
  const isInitialLibraryLoading =
    activeSectionId === "library" &&
    roundsResource.status === "loading" &&
    !roundsResource.hasLoadedOnce;
  const isLibraryRefreshing =
    activeSectionId === "library" &&
    roundsResource.status === "loading" &&
    roundsResource.hasLoadedOnce;
  const hasInitialLibraryError =
    activeSectionId === "library" &&
    roundsResource.status === "error" &&
    !roundsResource.hasLoadedOnce;
  const playlistGroupingLoading =
    groupMode === "playlist" && playlistsResource.status === "loading";
  const expandedGroupKeySet = useMemo(
    () => new Set(visibleGroupKeys.filter((groupKey) => Boolean(expandedHeroGroups[groupKey]))),
    [expandedHeroGroups, visibleGroupKeys]
  );
  const handleConvertRoundToHero = useCallback(
    (round: RoundLibraryEntry) => {
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
    (round: RoundLibraryEntry) => {
      const cardAssets = cardAssetsByRoundId.get(round.id);
      if (cardAssets?.websiteVideoCacheStatus === "pending") {
        return;
      }
      handleSelectSfx();
      void loadPreviewSettings().catch(() => undefined);
      void loadFullInstalledRoundsForPreview(showDisabledRounds)
        .then((fullRounds) => {
          const fullRound = fullRounds.find((candidate) => candidate.id === round.id);
          if (!fullRound) {
            showToast(t`Failed to load selected round media.`, "error");
            return;
          }
          setPreviewInstalledRounds(fullRounds);
          setActivePreviewRound(fullRound);
        })
        .catch((error) => {
          console.error("Failed to load installed rounds for preview", error);
          showToast(
            error instanceof Error ? error.message : t`Failed to load selected round media.`,
            "error"
          );
        });
    },
    [
      cardAssetsByRoundId,
      handleSelectSfx,
      loadFullInstalledRoundsForPreview,
      loadPreviewSettings,
      showDisabledRounds,
      showToast,
      t,
    ]
  );
  const handleEditRound = useCallback(
    (round: RoundLibraryEntry) => {
      handleSelectSfx();
      void db.round
        .getMediaResources(round.id, showDisabledRounds)
        .then((mediaResources) => {
          if (!mediaResources || mediaResources.resources.length === 0) {
            showToast(t`Failed to load selected round media.`, "error");
            return;
          }
          setEditingRound(toRoundEditDraft(round, mediaResources));
        })
        .catch((error) => {
          console.error("Failed to load round media resources for editing", error);
          showToast(
            error instanceof Error ? error.message : t`Failed to load selected round media.`,
            "error"
          );
        });
    },
    [handleSelectSfx, showDisabledRounds, showToast, t]
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
        showToast(t`No supported video files found in selected folder.`, "error");
        return;
      }

      if (inspection.kind === "legacy") {
        setLegacyPlaylistReview({
          folderPath: inspection.folderPath,
          playlistName: inspection.playlistNameHint.trim() || t`Legacy Playlist`,
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
        showToast(result.feedback.message, result.feedback.variant);
        return;
      }

      if (result.kind === "playlist") {
        await refreshAvailablePlaylists();
        showToast(result.feedback.message, result.feedback.variant);
        await navigate({ to: "/playlist-workshop" });
      }
    } catch (error) {
      console.error("Failed to import selected file", error);
      showToast(
        error instanceof Error ? error.message : t`Failed to import selected file.`,
        "error"
      );
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
      void loadWebInstallSettings().catch(() => undefined);
      setWebsiteRoundDialogOpen(true);
      return;
    }

    void installRoundsFromFolder();
  }, [installRoundsFromFolder, loadWebInstallSettings, navigate, search.open]);

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

    const playlistName = legacyPlaylistReview.playlistName.trim() || t`Legacy Playlist`;
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
                error: result.status.lastMessage ?? t`Legacy import did not finish.`,
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
              error: error instanceof Error ? error.message : t`Failed to create legacy playlist.`,
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
      compressionMode: null,
      compressionStrength: 80,
      result: null,
      error: null,
    });
  };

  const exportInstalledDatabase = async () => {
    if (!exportDialog || isExportingDatabase || isStartingScan || isLibraryScanning) return;

    try {
      const directoryPath = await window.electronAPI.dialog.selectPlaylistExportDirectory(
        t`Installed Library`
      );
      if (!directoryPath) return;

      setIsExportingDatabase(true);
      setShowLibraryExportOverlay(true);
      setLibraryExportStatus((current) =>
        current && current.state === "running"
          ? current
          : {
              state: "running",
              phase: "analyzing",
              startedAt: new Date().toISOString(),
              finishedAt: null,
              lastMessage: t`Preparing export...`,
              progress: { completed: 0, total: 0 },
              stats: { heroFiles: 0, roundFiles: 0, videoFiles: 0, funscriptFiles: 0 },
              compression: null,
            }
      );
      setExportDialog((current) =>
        current
          ? {
              ...current,
              result: null,
              error: null,
            }
          : current
      );
      const result = await db.install.exportPackage({
        roundIds: exportDialog.exportMode === "selected" ? Array.from(selectedRoundIds) : undefined,
        heroIds: exportDialog.exportMode === "selected" ? Array.from(selectedHeroIds) : undefined,
        includeMedia: exportDialog.includeMedia,
        asFpack: exportDialog.asFpack,
        directoryPath,
        compressionMode: exportDialog.includeMedia
          ? (exportDialog.compressionMode ?? "copy")
          : "copy",
        compressionStrength: exportDialog.compressionStrength,
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
              error:
                error instanceof Error && error.message === "Export aborted by user."
                  ? t`Export canceled.`
                  : error instanceof Error
                    ? error.message
                    : t`Failed to export library package.`,
            }
          : current
      );
      setShowLibraryExportOverlay(false);
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
        error instanceof Error ? error.message : t`Failed to attach the selected funscript file.`,
        "error"
      );
    }
  };

  const installWebsiteRound = async () => {
    if (actionButtonsDisabled) return;

    const trimmedName = websiteRoundName.trim();
    if (!trimmedName) {
      setWebsiteRoundError(t`Enter a round name before installing.`);
      setWebsiteRoundSuccess(null);
      return;
    }

    const normalizedVideoUrl = normalizeHttpUrl(websiteRoundVideoUrl);
    if (!normalizedVideoUrl) {
      setWebsiteRoundError(t`Enter a valid public http(s) website video URL.`);
      setWebsiteRoundSuccess(null);
      return;
    }

    if (websiteRoundVideoValidation.state === "checking") {
      setWebsiteRoundError(t`Wait until the website video URL support check finishes.`);
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
      setWebsiteRoundError(t`Funscript URL must also be a valid http(s) URL.`);
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
      setWebsiteRoundSuccess(t`Installed "${trimmedName}".`);
    } catch (error) {
      console.error("Failed to install website round", error);
      setWebsiteRoundError(
        error instanceof Error ? error.message : t`Failed to install the website round.`
      );
    } finally {
      setIsInstallingWebsiteRound(false);
    }
  };

  const getEroScriptsInitialQuery = () => {
    if (eroscriptsDialogContext === "edit-round") {
      return editingRound?.name ?? queryInput;
    }
    if (eroscriptsDialogContext === "website-round") {
      return websiteRoundName.trim() || websiteRoundVideoUrl.trim() || queryInput;
    }
    return queryInput.trim() || query.trim();
  };

  const attachEroScriptsFunscript = async (result: { funscriptUri: string; filename: string }) => {
    if (eroscriptsDialogContext === "edit-round") {
      setEditingRound((previous) =>
        previous ? { ...previous, funscriptUri: result.funscriptUri } : previous
      );
      showToast(t`Funscript attached. Save the round to keep it.`, "success");
      return;
    }

    if (eroscriptsDialogContext === "website-round") {
      setWebsiteRoundFunscriptFileUri(result.funscriptUri);
      setWebsiteRoundFunscriptFileLabel(result.filename);
      setWebsiteRoundFunscriptUrl("");
      setWebsiteRoundError(null);
      setWebsiteRoundSuccess(t`Funscript attached.`);
      return;
    }
  };

  const installEroScriptsRound = async (input: EroScriptsRoundInstallInput) => {
    if (actionButtonsDisabled) return;
    try {
      if (input.videoUri.startsWith("http://") || input.videoUri.startsWith("https://")) {
        await db.round.createWebsiteRound({
          name: input.name,
          videoUri: input.videoUri,
          funscriptUri: input.funscriptUri,
        });
      } else {
        await db.round.createMediaRound({
          name: input.name,
          videoUri: input.videoUri,
          funscriptUri: input.funscriptUri,
          sourceKey: input.sourceUrl,
        });
      }
      await refreshInstalledRounds();
      showToast(
        input.funscriptUri
          ? t`Installed EroScripts video with funscript.`
          : t`Installed EroScripts video without a funscript.`,
        "success"
      );
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : t`Failed to install EroScripts video.`,
        "error"
      );
      throw error;
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
          ? { ...current, error: t`Confirmation text did not match. No changes were made.` }
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
        error instanceof Error ? error.message : t`Failed to convert hero group back to a round.`,
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
      showToast(t`Round fields must use valid numeric values.`, "error");
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
        excludeFromRandom: editingRound.excludeFromRandom,
      });
      setEditingRound(null);
      await refreshInstalledRounds();
    } catch (error) {
      console.error("Failed to update round", error);
      showToast(error instanceof Error ? error.message : t`Failed to update round.`, "error");
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
      showToast(error instanceof Error ? error.message : t`Failed to update hero.`, "error");
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
      showToast(error instanceof Error ? error.message : t`Failed to delete round.`, "error");
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

  const confirmDeleteHero = useCallback(async () => {
    if (!deleteHeroDialog || isSavingEdit) return;
    setDeleteHeroDialog(null);

    setIsSavingEdit(true);
    try {
      await db.hero.delete(deleteHeroDialog.id);
      setEditingHero((current) => (current?.id === deleteHeroDialog.id ? null : current));
      await refreshInstalledRounds();
    } catch (error) {
      console.error("Failed to delete hero", error);
      showToast(error instanceof Error ? error.message : t`Failed to delete hero.`, "error");
    } finally {
      setIsSavingEdit(false);
    }
  }, [deleteHeroDialog, isSavingEdit, refreshInstalledRounds, showToast]);

  const deleteHeroEntry = (heroDraft: HeroEditDraft | null = editingHero) => {
    if (!heroDraft || isSavingEdit) return;
    const persistedHeroName =
      rounds.find((round) => round.hero?.id === heroDraft.id)?.hero?.name ?? heroDraft.name;
    setDeleteHeroDialog({
      id: heroDraft.id,
      name: heroDraft.name.trim() || persistedHeroName.trim(),
    });
  };

  const retryTemplateLinkingForRound = async (round: RoundLibraryEntry) => {
    if (isSavingEdit) return;
    setIsSavingEdit(true);
    try {
      await db.round.retryTemplateLinking({ roundId: round.id });
      await refreshInstalledRounds();
    } catch (error) {
      console.error("Failed to retry template round linking", error);
      showToast(
        error instanceof Error ? error.message : t`Failed to retry template round linking.`,
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
        error instanceof Error ? error.message : t`Failed to retry template hero linking.`,
        "error"
      );
    } finally {
      setIsSavingEdit(false);
    }
  };

  const saveRoundTemplateRepair = async () => {
    if (!repairingTemplateRound || isSavingEdit) return;
    if (!repairingTemplateRound.installedRoundId) {
      showToast(t`Select an installed round to repair this template.`, "error");
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
        error instanceof Error ? error.message : t`Failed to repair template round.`,
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
      showToast(t`Select a source hero first.`, "error");
      return;
    }
    if (repairingTemplateHero.assignments.some((assignment) => !assignment.installedRoundId)) {
      showToast(t`Assign every unresolved hero round before saving.`, "error");
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
        error instanceof Error ? error.message : t`Failed to repair template hero.`,
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
              <Trans>Round Vault</Trans>
            </p>
            <h1 className="mt-1.5 text-xl font-black tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-violet-200 via-purple-100 to-indigo-200 drop-shadow-[0_0_20px_rgba(139,92,246,0.45)]">
              <Trans>Installed Rounds</Trans>
            </h1>
            <p className="mt-2 text-sm text-zinc-400">
              <Trans>
                Manage imports, hero groups, and exports with the same focused shell as the new
                settings screen.
              </Trans>
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
                <span>{section.id === "library" ? t`Library` : t`Import & Export`}</span>
              </button>
            );
          })}

          <div className="min-w-0 shrink-0 rounded-2xl border border-purple-400/20 bg-black/25 p-2 lg:mt-4">
            <p className="px-2 pb-2 font-[family-name:var(--font-jetbrains-mono)] text-[10px] uppercase tracking-[0.24em] text-zinc-400">
              <Trans>Library Grouping</Trans>
            </p>
            <div className="flex gap-1 lg:flex-col">
              {[
                { value: "hero", label: t`Heroes` },
                { value: "playlist", label: t`Playlists` },
              ].map((option) => {
                const active = groupMode === option.value;
                const disabled =
                  option.value === "playlist" &&
                  playlistsResource.status === "loading" &&
                  !playlistsResource.hasLoadedOnce;
                return (
                  <button
                    key={option.value}
                    type="button"
                    onMouseEnter={handleHoverSfx}
                    onFocus={handleHoverSfx}
                    onClick={() => {
                      if (disabled) return;
                      handleSelectSfx();
                      startTransition(() => {
                        setGroupMode(option.value as GroupMode);
                      });
                    }}
                    disabled={disabled}
                    className={`rounded-xl px-3 py-2 text-left font-[family-name:var(--font-jetbrains-mono)] text-[10px] uppercase tracking-[0.2em] transition-all duration-200 ${
                      active
                        ? "border border-cyan-300/45 bg-cyan-500/18 text-cyan-100"
                        : disabled
                          ? "cursor-wait border border-zinc-800 bg-zinc-950/50 text-zinc-500"
                          : "border border-transparent bg-zinc-900/55 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200"
                    }`}
                  >
                    {option.value === "playlist" && playlistGroupingLoading
                      ? t`Playlists...`
                      : option.label}
                  </button>
                );
              })}
            </div>
            {groupMode === "playlist" && playlistGroupingLoading && (
              <p className="px-2 pt-2 font-[family-name:var(--font-jetbrains-mono)] text-[10px] uppercase tracking-[0.18em] text-cyan-200/70">
                <Trans>Loading playlist groups...</Trans>
              </p>
            )}
          </div>

          <div className="hidden lg:mt-auto lg:block lg:px-1 lg:pt-4">
            <MenuButton
              label={t`← Back`}
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
                    <Trans>Installed Rounds</Trans>
                  </p>
                  <h2 className="mt-2 text-3xl font-black tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-violet-200 via-purple-100 to-indigo-200 drop-shadow-[0_0_20px_rgba(139,92,246,0.4)] sm:text-4xl">
                    {activeSection.id === "library" ? t`Library` : t`Import & Export`}
                  </h2>
                  <p className="mt-2 max-w-3xl text-sm text-zinc-400">
                    {activeSection.id === "library"
                      ? t`Browse, filter, and edit installed rounds with the main library view front and center.`
                      : t`Install new rounds, import portable files, and manage database exports from one place.`}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <div className="rounded-xl border border-violet-200/30 bg-violet-400/10 px-4 py-2 font-[family-name:var(--font-jetbrains-mono)] text-xs uppercase tracking-[0.3em] text-violet-100">
                    {filteredRounds.length} / {rounds.length} <Trans>Visible</Trans>
                  </div>
                  <RoundsLibraryStatusPoller
                    onStatusChange={(status) => setIsLibraryScanning(status?.state === "running")}
                    onDataChanged={refreshInstalledRounds}
                  />
                  {aggregateDownloadProgress && (
                    <div className="flex items-center gap-2 rounded-xl border border-cyan-300/25 bg-cyan-400/10 px-4 py-2 font-[family-name:var(--font-jetbrains-mono)] text-xs uppercase tracking-[0.2em] text-cyan-100">
                      <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-cyan-400" />
                      {aggregateDownloadProgress.count} <Trans>download</Trans>
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
                          <Trans>Library Snapshot</Trans>
                        </h3>
                        <p className="mt-1 text-sm text-zinc-300">
                          <Trans>
                            Keep the main browsing tools, collection health, and import actions in
                            one place.
                          </Trans>
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <RoundActionButton
                          label={t`Install Rounds`}
                          tone="violet"
                          disabled={actionButtonsDisabled}
                          onHover={handleHoverSfx}
                          onClick={() => {
                            handleSelectSfx();
                            void installRoundsFromFolder();
                          }}
                        />
                        <RoundActionButton
                          label={t`Import File`}
                          tone="emerald"
                          disabled={actionButtonsDisabled}
                          onHover={handleHoverSfx}
                          onClick={() => {
                            handleSelectSfx();
                            void importRoundsFromFile();
                          }}
                        />
                        <RoundActionButton
                          label={t`Install From Web`}
                          tone="violet"
                          disabled={actionButtonsDisabled}
                          onHover={handleHoverSfx}
                          onClick={() => {
                            handleSelectSfx();
                            void loadWebInstallSettings().catch(() => undefined);
                            setWebsiteRoundDialogOpen(true);
                          }}
                        />
                        <RoundActionButton
                          label={t`Search EroScripts`}
                          tone="cyan"
                          disabled={actionButtonsDisabled}
                          onHover={handleHoverSfx}
                          onClick={() => {
                            handleSelectSfx();
                            setEroScriptsDialogContext("library");
                          }}
                        />
                        <RoundActionButton
                          label={isExportingDatabase ? t`Exporting...` : t`Export`}
                          tone="cyan"
                          disabled={actionButtonsDisabled}
                          onHover={handleHoverSfx}
                          onClick={() => {
                            handleSelectSfx();
                            openExportDatabaseDialog();
                          }}
                        />
                        <RoundActionButton
                          label={selectionMode ? t`Cancel Selection` : t`Select Items`}
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
                            className={`rounded-xl border px-4 py-2 font-[family-name:var(--font-jetbrains-mono)] text-xs uppercase tracking-[0.18em] transition-all duration-200 ${
                              selectionMode
                                ? "border-violet-300/60 bg-violet-500/25 text-violet-100"
                                : "border-slate-600 bg-slate-900/70 text-slate-300 hover:border-violet-300/40"
                            }`}
                          >
                            {selectionMode ? t`Cancel Selection` : t`Select Items`}
                          </button>
                          {(selectedRoundIds.size > 0 || selectedHeroIds.size > 0) && (
                            <>
                              <span className="text-sm text-violet-200">
                                {t`${selectedRoundIds.size} rounds, ${selectedHeroIds.size} heroes selected`}
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
                                <Trans>Clear</Trans>
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
                                <Trans>Export Selected</Trans>
                              </button>
                            </>
                          )}
                        </div>
                      )}
                    </div>

                    {isInitialLibraryLoading ? (
                      <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
                        {Array.from({ length: 4 }, (_, index) => (
                          <div
                            key={`snapshot-skeleton:${index}`}
                            className="rounded-2xl border border-zinc-700/60 bg-black/25 p-4"
                          >
                            <div className="h-3 w-20 animate-pulse rounded bg-zinc-300/10" />
                            <div className="mt-3 h-8 w-12 animate-pulse rounded bg-violet-300/15" />
                          </div>
                        ))}
                      </div>
                    ) : (
                      <InlineMetrics
                        className="mt-4"
                        metrics={[
                          { label: t`Standalone`, value: standaloneRoundCount, tone: "violet" },
                          { label: t`Hero Groups`, value: heroGroupCount, tone: "pink" },
                          {
                            label: t`Scripts Ready`,
                            value: roundsWithScriptCount,
                            tone: "emerald",
                          },
                          {
                            label: t`Disabled`,
                            value: disabledIdsResource.hasLoadedOnce ? disabledRoundIds.size : "…",
                            tone: "amber",
                          },
                        ]}
                      />
                    )}
                  </section>

                  {isInitialLibraryLoading ? (
                    <>
                      <RoundsLibraryFiltersSkeleton />
                      <RoundsLibraryGridSkeleton />
                    </>
                  ) : hasInitialLibraryError ? (
                    <LibraryErrorState
                      message={roundsResource.error ?? t`Failed to load installed rounds.`}
                      onHoverSfx={handleHoverSfx}
                      onSelectSfx={handleSelectSfx}
                      onRetry={() => {
                        void loadInstalledRounds({
                          force: true,
                          includeDisabled: showDisabledRounds,
                        }).catch(() => undefined);
                        void loadDisabledRoundIds({ force: true }).catch(() => undefined);
                      }}
                    />
                  ) : (
                    <section
                      className="relative z-40 animate-entrance rounded-3xl border border-purple-400/25 bg-zinc-950/55 p-5 backdrop-blur-xl"
                      style={{ animationDelay: "0.08s" }}
                    >
                      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                        <div>
                          <h3 className="text-lg font-extrabold tracking-tight text-violet-100">
                            <Trans>Search & Filter</Trans>
                          </h3>
                          <p className="mt-1 text-sm text-zinc-300">
                            <Trans>
                              Narrow the collection by round type, script availability, or a text
                              search across round metadata.
                            </Trans>
                          </p>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <label className="flex items-center gap-2 rounded-lg border border-zinc-700 bg-black/30 px-3 py-2 text-xs uppercase tracking-[0.18em] text-zinc-300">
                            <input
                              type="checkbox"
                              checked={showDisabledRounds}
                              onChange={(event) => setShowDisabledRounds(event.target.checked)}
                            />
                            <Trans>Show Disabled Imports</Trans>
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
                            className={`rounded-xl border px-4 py-2 font-[family-name:var(--font-jetbrains-mono)] text-xs uppercase tracking-[0.18em] transition-all duration-200 ${
                              hasActiveFilters
                                ? "border-violet-300/50 bg-violet-500/15 text-violet-100 hover:border-violet-200/75 hover:bg-violet-500/25"
                                : "cursor-not-allowed border-zinc-700 bg-zinc-900/70 text-zinc-500"
                            }`}
                          >
                            <Trans>Clear Filters</Trans>
                          </button>
                        </div>
                      </div>

                      <div className="mt-5 grid grid-cols-1 gap-3 lg:grid-cols-5">
                        <label className="lg:col-span-2">
                          <span className="mb-2 block font-[family-name:var(--font-jetbrains-mono)] text-[10px] uppercase tracking-[0.25em] text-zinc-300">
                            <Trans>Search</Trans>
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
                            placeholder={t`Search title, hero, author`}
                            className="w-full rounded-xl border border-purple-300/30 bg-black/45 px-4 py-3 text-sm text-zinc-100 outline-none transition-all duration-200 focus:border-purple-300/75 focus:ring-2 focus:ring-purple-400/30"
                          />
                        </label>

                        <GameDropdown
                          label={t`Type`}
                          value={typeFilter}
                          options={[
                            { value: "all", label: t`All` },
                            { value: "Normal", label: t`Normal` },
                            { value: "Interjection", label: t`Interjection` },
                            { value: "Cum", label: abbreviateNsfwText(t`Cum`, sfwMode) },
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
                          label={t`Script`}
                          value={scriptFilter}
                          options={[
                            { value: "all", label: t`All` },
                            { value: "installed", label: t`Installed` },
                            { value: "missing", label: t`Missing` },
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
                          label={t`Sort`}
                          value={sortMode}
                          options={[
                            { value: "newest", label: t`Newest` },
                            { value: "oldest", label: t`Oldest` },
                            { value: "difficulty", label: t`Difficulty` },
                            { value: "bpm", label: t`BPM` },
                            { value: "length", label: t`Length` },
                            { value: "name", label: t`Name` },
                            { value: "excluded", label: t`Excluded` },
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
                            ? t`${activeFilterCount} Active Filters`
                            : t`No Active Filters`}
                        </div>
                        <div className="rounded-xl border border-zinc-700/80 bg-black/30 px-3 py-2 font-[family-name:var(--font-jetbrains-mono)] text-[10px] uppercase tracking-[0.2em] text-zinc-300">
                          {t`Sort:`} {sortModeLabel}
                        </div>
                        <div className="rounded-xl border border-zinc-700/80 bg-black/30 px-3 py-2 font-[family-name:var(--font-jetbrains-mono)] text-[10px] uppercase tracking-[0.2em] text-zinc-300">
                          {t`Grouping:`} {groupModeLabel}
                          {playlistGroupingLoading && (
                            <span className="ml-2 text-cyan-200/80">
                              <Trans>Loading…</Trans>
                            </span>
                          )}
                        </div>
                        <div className="rounded-xl border border-zinc-700/80 bg-black/30 px-3 py-2 font-[family-name:var(--font-jetbrains-mono)] text-[10px] uppercase tracking-[0.2em] text-zinc-300">
                          {showDisabledRounds ? t`Disabled Included` : t`Disabled Hidden`}
                        </div>
                      </div>
                    </section>
                  )}

                  {!isInitialLibraryLoading && !hasInitialLibraryError && !isLibraryRefreshing && (
                    <section
                      className="animate-entrance rounded-3xl border border-purple-400/25 bg-zinc-950/55 p-5 backdrop-blur-xl"
                      style={{ animationDelay: "0.11s" }}
                    >
                      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                        <div>
                          <h3 className="text-lg font-extrabold tracking-tight text-violet-100">
                            <Trans>Round Library</Trans>
                          </h3>
                          <p className="mt-1 text-sm text-zinc-300">
                            {filteredRounds.length === 0
                              ? t`No rounds currently match the active search and filter state.`
                              : t`${filteredRounds.length} matching rounds are currently available.`}
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
                            className={`rounded-xl border px-4 py-2 font-[family-name:var(--font-jetbrains-mono)] text-xs uppercase tracking-[0.18em] transition-all duration-200 ${
                              visibleGroupKeys.length > 0 && !allVisibleGroupsExpanded
                                ? "border-cyan-300/45 bg-cyan-500/15 text-cyan-100 hover:border-cyan-200/75 hover:bg-cyan-500/25"
                                : "cursor-not-allowed border-zinc-700 bg-zinc-900/70 text-zinc-500"
                            }`}
                          >
                            <Trans>Expand All Groups</Trans>
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
                            className={`rounded-xl border px-4 py-2 font-[family-name:var(--font-jetbrains-mono)] text-xs uppercase tracking-[0.18em] transition-all duration-200 ${
                              visibleGroupKeys.length > 0 && allVisibleGroupsExpanded
                                ? "border-violet-300/45 bg-violet-500/15 text-violet-100 hover:border-violet-200/75 hover:bg-violet-500/25"
                                : "cursor-not-allowed border-zinc-700 bg-zinc-900/70 text-zinc-500"
                            }`}
                          >
                            <Trans>Collapse Groups</Trans>
                          </button>
                        </div>
                      </div>

                      <LibraryLastMessage />

                      {filteredRounds.length === 0 ? (
                        <div className="mt-5 rounded-2xl border border-zinc-700/60 bg-zinc-950/60 p-8 text-center backdrop-blur-xl">
                          <p className="font-[family-name:var(--font-jetbrains-mono)] text-sm uppercase tracking-[0.28em] text-zinc-400">
                            <Trans>No rounds match this filter</Trans>
                          </p>
                          <p className="mt-3 text-sm text-zinc-400">
                            {hasActiveFilters
                              ? t`Clear the current filters to get back to the full library.`
                              : t`Install a folder or import a portable file to start building the library.`}
                          </p>
                          <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
                            {hasActiveFilters ? (
                              <RoundActionButton
                                label={t`Reset Filters`}
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
                                label={t`Open Import & Export`}
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
                              onVisibleRoundIdsChange={setVisibleRoundIds}
                              renderCard={(item) => {
                                const cardAssets = cardAssetsByRoundId.get(item.round.id);
                                return (
                                <RoundCard
                                  key={item.key}
                                  round={item.round}
                                  cardAssets={cardAssets}
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
                                  isWebsiteVideoCaching={
                                    websiteVideoScanStatus?.state === "running"
                                  }
                                  downloadProgress={
                                    cardAssets?.previewVideoUri
                                      ? getDownloadProgressForVideoUri(cardAssets.previewVideoUri)
                                      : null
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
                                );
                              }}
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
                                      cardAssetsByRoundId,
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

                                const { pendingCacheCount } = summarizeHeroGroupPreviewState(
                                  row.rounds,
                                  cardAssetsByRoundId,
                                  websiteVideoScanStatus?.state === "running"
                                );
                                return (
                                  <PlaylistGroupHeader
                                    playlistName={row.playlistName}
                                    roundCount={row.rounds.length}
                                    cachePending={pendingCacheCount > 0}
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
                  )}

                  {!isInitialLibraryLoading && !hasInitialLibraryError && isLibraryRefreshing && (
                    <RoundsLibraryGridSkeleton refreshing />
                  )}
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
                          <Trans>Import New Content</Trans>
                        </h3>
                        <p className="mt-1 text-sm text-zinc-300">
                          <Trans>
                            Folder installs are best for bulk local content. Portable file import is
                            best for sidecars and packaged exports.
                          </Trans>
                        </p>
                      </div>
                      <div className="space-y-3">
                        <RoundActionButton
                          label={t`Install Rounds`}
                          description={t`Choose a folder and scan it for supported round media.`}
                          tone="violet"
                          disabled={actionButtonsDisabled}
                          onHover={handleHoverSfx}
                          onClick={() => {
                            handleSelectSfx();
                            void installRoundsFromFolder();
                          }}
                        />
                        <RoundActionButton
                          label={t`Import File`}
                          description={t`Bring in a portable round package or other supported import file.`}
                          tone="emerald"
                          disabled={actionButtonsDisabled}
                          onHover={handleHoverSfx}
                          onClick={() => {
                            handleSelectSfx();
                            void importRoundsFromFile();
                          }}
                        />
                        <RoundActionButton
                          label={t`Install From Web`}
                          description={t`Open a popup to create an installed round from a public website URL.`}
                          tone="violet"
                          disabled={actionButtonsDisabled}
                          onHover={handleHoverSfx}
                          onClick={() => {
                            handleSelectSfx();
                            void loadWebInstallSettings().catch(() => undefined);
                            setWebsiteRoundDialogOpen(true);
                          }}
                        />
                        <RoundActionButton
                          label={t`Search EroScripts`}
                          description={t`Find EroScripts topics, download videos, and attach direct funscripts.`}
                          tone="cyan"
                          disabled={actionButtonsDisabled}
                          onHover={handleHoverSfx}
                          onClick={() => {
                            handleSelectSfx();
                            setEroScriptsDialogContext("library");
                          }}
                        />
                        <RoundActionButton
                          label={scanRunning ? t`Scanning...` : t`Scan Now`}
                          description={t`Re-run install folder discovery for sources already connected to the app.`}
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
                          <Trans>Export & Share</Trans>
                        </h3>
                        <p className="mt-1 text-sm text-zinc-300">
                          <Trans>
                            Build a clean installed-database export and choose where the package
                            should be written.
                          </Trans>
                        </p>
                      </div>
                      <div className="space-y-3">
                        <RoundActionButton
                          label={isExportingDatabase ? t`Exporting...` : t`Export`}
                          description={t`Open the export flow and package the installed database.`}
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
                label={scanRunning ? t`Scanning...` : t`Scan Now`}
                primary
                onClick={() => {
                  handleSelectSfx();
                  void scanNow();
                }}
                onHover={handleHoverSfx}
              />
              <MenuButton
                label={t`Back to Main Menu`}
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
        isSettingsLoading={webInstallSettingsResource.status === "loading"}
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
        onSearchEroScripts={() => {
          handleSelectSfx();
          setEroScriptsDialogContext("website-round");
        }}
        onInstall={() => {
          handleSelectSfx();
          void installWebsiteRound();
        }}
        onHoverSfx={handleHoverSfx}
      />
      <EroScriptsFunscriptSearchDialog
        open={eroscriptsDialogContext !== null}
        initialQuery={getEroScriptsInitialQuery()}
        currentFunscriptUri={
          eroscriptsDialogContext === "edit-round" ? editingRound?.funscriptUri : null
        }
        onClose={() => setEroScriptsDialogContext(null)}
        onAttachFunscript={
          eroscriptsDialogContext === "edit-round" || eroscriptsDialogContext === "website-round"
            ? attachEroScriptsFunscript
            : undefined
        }
        onInstallRound={installEroScriptsRound}
      />
      {activePreviewRound && <RoundVideoOverlay {...previewOverlayProps} />}
      {editingRound && (
        <EditDialog
          title={t`Edit Round`}
          onClose={() => !isSavingEdit && setEditingRound(null)}
          onSubmit={() => {
            void saveRoundEdit();
          }}
          submitLabel={isSavingEdit ? t`Saving...` : t`Save Round`}
          disabled={isSavingEdit}
          destructiveActionLabel={isSavingEdit ? t`Deleting...` : t`Delete Round`}
          onDestructiveAction={() => {
            void deleteRoundEntry();
          }}
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <ModalField label={t`Name`}>
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
            <ModalField label={t`Type`}>
              <GameDropdown
                value={editingRound.type}
                options={[
                  { value: "Normal", label: t`Normal` },
                  { value: "Interjection", label: t`Interjection` },
                  { value: "Cum", label: abbreviateNsfwText(t`Cum`, sfwMode) },
                ]}
                onChange={(value) =>
                  setEditingRound((previous) =>
                    previous ? { ...previous, type: value as EditableRoundType } : previous
                  )
                }
              />
            </ModalField>
            <ModalField label={t`Author`}>
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
            <ModalField label={t`BPM`}>
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
            <ModalField label={t`Difficulty`}>
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
                        aria-label={t`Set difficulty to ${level} star${level === 1 ? "" : "s"}`}
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
                {editingRound.funscriptUri && (
                  <button
                    type="button"
                    disabled={isAutoDifficultyLoading}
                    onClick={() => {
                      if (!editingRound.funscriptUri) return;
                      setIsAutoDifficultyLoading(true);
                      db.round
                        .calculateDifficultyFromFunscript(editingRound.funscriptUri)
                        .then((result) => {
                          if (result != null) {
                            setEditingRound((previous) =>
                              previous ? { ...previous, difficulty: String(result) } : previous
                            );
                          } else {
                            showToast(t`Could not estimate difficulty from funscript.`, "error");
                          }
                        })
                        .catch(() => {
                          showToast(t`Could not estimate difficulty from funscript.`, "error");
                        })
                        .finally(() => setIsAutoDifficultyLoading(false));
                    }}
                    className="text-xs text-zinc-500 hover:text-zinc-400 disabled:opacity-50"
                  >
                    {isAutoDifficultyLoading ? t`Calculating…` : t`Auto from funscript`}
                  </button>
                )}
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
                    <Trans>clear</Trans>
                  </button>
                )}
              </div>
            </ModalField>
            <ModalField label={t`Start Time (ms)`}>
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
            <ModalField label={t`End Time (ms)`}>
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
            <ModalField label={t`Funscript`} className="sm:col-span-2">
              <div className="space-y-3 rounded-xl border border-violet-300/30 bg-black/45 p-3">
                <div className="rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-zinc-200">
                  {editingRound.funscriptUri ? (
                    <span className="break-all">{editingRound.funscriptUri}</span>
                  ) : (
                    <span className="text-zinc-500">
                      <Trans>No funscript attached</Trans>
                    </span>
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
                    {editingRound.funscriptUri ? t`Replace Funscript` : t`Attach Funscript`}
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
                    <Trans>Detach Funscript</Trans>
                  </button>
                  <button
                    type="button"
                    disabled={isSavingEdit || !editingRound.resourceId}
                    onClick={() => {
                      handleSelectSfx();
                      setEroScriptsDialogContext("edit-round");
                    }}
                    className="rounded-xl border border-emerald-300/35 bg-emerald-500/12 px-3 py-2 text-xs uppercase tracking-[0.18em] text-emerald-100 transition-all duration-200 hover:border-emerald-200/75 hover:bg-emerald-500/24 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Trans>Search EroScripts</Trans>
                  </button>
                </div>
                {!editingRound.resourceId && (
                  <p className="text-xs text-zinc-500">
                    <Trans>
                      Template rounds do not have a primary media resource, so a funscript cannot be
                      attached here.
                    </Trans>
                  </p>
                )}
              </div>
            </ModalField>
            <ModalField label={t`Random Selection`} className="sm:col-span-2">
              <label className="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={editingRound.excludeFromRandom}
                  onChange={(event) =>
                    setEditingRound((previous) =>
                      previous ? { ...previous, excludeFromRandom: event.target.checked } : previous
                    )
                  }
                  className="h-4 w-4 rounded border-violet-300/40 bg-black/45 text-violet-400 focus:ring-violet-400/60"
                />
                <span className="text-sm text-zinc-300">
                  <Trans>Exclude from random round selection</Trans>
                </span>
              </label>
              <p className="mt-1 text-xs text-zinc-500">
                <Trans>
                  When enabled, this round will never be picked by random round nodes, the succubus
                  anti-perk, or the cum round fallback.
                </Trans>
              </p>
            </ModalField>
            <ModalField label={t`Description`} className="sm:col-span-2">
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
          title={t`Convert Hero to Round`}
          onClose={() => {
            if (convertingHeroGroupKey === heroGroupRoundConversion.groupKey) return;
            setHeroGroupRoundConversion(null);
          }}
          onSubmit={() => {
            void confirmHeroGroupRoundConversion();
          }}
          submitLabel={
            convertingHeroGroupKey === heroGroupRoundConversion.groupKey
              ? t`Converting...`
              : t`Confirm Conversion`
          }
          disabled={convertingHeroGroupKey === heroGroupRoundConversion.groupKey}
        >
          <div className="space-y-4">
            <div className="rounded-2xl border border-rose-300/25 bg-rose-500/10 p-4 text-sm text-zinc-200">
              <p className="font-semibold text-rose-100">
                <Trans>
                  This keeps "{heroGroupRoundConversion.keepRoundName}" and permanently deletes{" "}
                  {heroGroupRoundConversion.roundsToDeleteCount} attached round(s).
                </Trans>
              </p>
              <p className="mt-2 text-zinc-300">
                <Trans>
                  The hero will be removed and the kept round will become a standalone entry. This
                  cannot be undone in-app.
                </Trans>
              </p>
            </div>
            <ModalField label={t`Type "${heroGroupRoundConversion.heroName}" to confirm`}>
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
          title={t`Edit Hero`}
          onClose={() => !isSavingEdit && setEditingHero(null)}
          onSubmit={() => {
            void saveHeroEdit();
          }}
          submitLabel={isSavingEdit ? t`Saving...` : t`Save Hero`}
          disabled={isSavingEdit}
          destructiveActionLabel={isSavingEdit ? t`Deleting...` : t`Delete Hero`}
          onDestructiveAction={() => {
            void deleteHeroEntry();
          }}
        >
          <div className="grid grid-cols-1 gap-3">
            <ModalField label={t`Name`}>
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
            <ModalField label={t`Author`}>
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
            <ModalField label={t`Description`}>
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
          title={t`Repair Template Round`}
          onClose={() => !isSavingEdit && setRepairingTemplateRound(null)}
          onSubmit={() => {
            void saveRoundTemplateRepair();
          }}
          submitLabel={isSavingEdit ? t`Repairing...` : t`Attach Source Media`}
          disabled={isSavingEdit}
        >
          <div className="space-y-4">
            <p className="rounded-2xl border border-amber-300/25 bg-amber-500/10 p-4 text-sm text-zinc-200">
              <Trans>
                Attach installed media to{" "}
                <span className="font-semibold text-amber-100">
                  {repairingTemplateRound.roundName}
                </span>
                .
              </Trans>
            </p>
            <ModalField label={t`Installed Round Source`}>
              <GameDropdown
                value={repairingTemplateRound.installedRoundId as string}
                options={[
                  { value: "" as string, label: t`Select installed round` },
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
          title={t`Repair Template Hero`}
          onClose={() => !isSavingEdit && setRepairingTemplateHero(null)}
          onSubmit={() => {
            void saveHeroTemplateRepair();
          }}
          submitLabel={isSavingEdit ? t`Repairing...` : t`Attach Hero Media`}
          disabled={isSavingEdit}
        >
          <div className="space-y-4">
            <p className="rounded-2xl border border-amber-300/25 bg-amber-500/10 p-4 text-sm text-zinc-200">
              <Trans>
                Choose a source hero for{" "}
                <span className="font-semibold text-amber-100">
                  {repairingTemplateHero.heroName}
                </span>
                . Assignments are auto-filled by round name, then order.
              </Trans>
            </p>
            <ModalField label={t`Source Hero`}>
              <GameDropdown
                value={repairingTemplateHero.sourceHeroId}
                options={[
                  { value: "" as string, label: t`Select source hero` },
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
                        { value: "" as string, label: t`Select installed round` },
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
          title={t`Review Legacy Import`}
          onClose={dismissLegacyPlaylistReview}
          onSubmit={() => {
            void createLegacyPlaylist();
          }}
          submitLabel={
            legacyPlaylistReview.creating
              ? t`Importing...`
              : legacyPlaylistReview.createPlaylist
                ? t`Import and Create Playlist`
                : t`Import Without Playlist`
          }
          disabled={legacyPlaylistReview.creating}
        >
          <div className="space-y-4">
            <div className="rounded-2xl border border-violet-300/25 bg-violet-500/10 p-4 text-sm text-zinc-200">
              <Trans>
                Review the folder before import. Ordered by filename (natural sort), so entries like
                2, 10, and 100 stay in human order.
              </Trans>
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
                <Trans>Create a playlist after import.</Trans>
              </span>
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
              <span>
                <Trans>Defer phash generation to a later moment.</Trans>
              </span>
            </label>
            <ModalField label={t`Playlist Name`}>
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
                placeholder={t`Legacy Playlist`}
              />
            </ModalField>
            <div className="rounded-2xl border border-zinc-700/70 bg-black/35 p-4">
              <div className="mb-3 flex items-center justify-between gap-3 text-xs uppercase tracking-[0.18em] text-zinc-300">
                <span>
                  <Trans>Import Order Preview</Trans>
                </span>
                <span>
                  {legacyPlaylistReview.slots.length} <Trans>slots</Trans>
                </span>
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
                        <Trans>Excluded:</Trans> {slot.excludedFromImport ? t`Yes` : t`No`}
                      </div>
                      <div className="text-xs text-zinc-400">
                        <Trans>Checkpoint:</Trans> {slot.selectedAsCheckpoint ? t`Yes` : t`No`}
                      </div>
                    </div>
                    <label className="flex items-center gap-2 text-xs uppercase tracking-[0.14em] text-zinc-300">
                      <input
                        type="checkbox"
                        checked={!slot.excludedFromImport}
                        onChange={() => toggleLegacyImportExclusion(slot.id)}
                        className="h-4 w-4 rounded border-zinc-500 bg-black/40"
                      />
                      <span>
                        <Trans>Import</Trans>
                      </span>
                    </label>
                    <label className="flex items-center gap-2 text-xs uppercase tracking-[0.14em] text-zinc-300">
                      <input
                        type="checkbox"
                        checked={slot.selectedAsCheckpoint}
                        disabled={slot.excludedFromImport}
                        onChange={() => toggleLegacyCheckpointSelection(slot.id)}
                        className="h-4 w-4 rounded border-zinc-500 bg-black/40 disabled:cursor-not-allowed disabled:opacity-50"
                      />
                      <span>
                        <Trans>Checkpoint</Trans>
                      </span>
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
          selectionIds={{
            roundIds: Array.from(selectedRoundIds),
            heroIds: Array.from(selectedHeroIds),
          }}
        />
      )}
      {showLibraryExportOverlay && (
        <LibraryExportOverlay
          status={libraryExportStatus}
          aborting={isAbortingLibraryExport}
          onAbort={() => {
            void abortLibraryExport();
          }}
        />
      )}
      <ConfirmDialog
        isOpen={deleteRoundDialog !== null}
        title={t`Delete Round?`}
        message={t`Delete round entry \u201C${deleteRoundDialog?.name ?? ""}\u201D from the database?\n\nThis removes only the database entry. Files on disk will be left untouched.`}
        confirmLabel={t`Delete Round`}
        variant="danger"
        onConfirm={confirmDeleteRound}
        onCancel={() => setDeleteRoundDialog(null)}
      />
      <ConfirmDialog
        isOpen={deleteHeroDialog !== null}
        title={t`Delete Hero?`}
        message={t`Delete hero entry \u201C${deleteHeroDialog?.name ?? ""}\u201D from the database?\n\nThis also permanently deletes all attached rounds from the database. Files on disk will be left untouched.`}
        confirmLabel={t`Delete Hero`}
        variant="danger"
        onConfirm={confirmDeleteHero}
        onCancel={() => setDeleteHeroDialog(null)}
      />
    </div>
  );
}

const RoundCard = memo(function RoundCard({
  round,
  cardAssets,
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
  downloadProgress = null,
  selectionMode,
  selected,
  onToggleSelection,
}: {
  round: RoundLibraryEntry;
  cardAssets?: InstalledRoundCardAssets;
  index: number;
  onHoverSfx: () => void;
  onConvertToHero: (round: RoundLibraryEntry) => void;
  onPlay: (round: RoundLibraryEntry) => void;
  onEdit: (round: RoundLibraryEntry) => void;
  onRetryTemplateLinking: (round: RoundLibraryEntry) => void;
  onRepairTemplate: (round: RoundLibraryEntry) => void;
  animateDifficulty: boolean;
  showDisabledBadge: boolean;
  isWebsiteVideoCaching?: boolean;
  downloadProgress?: VideoDownloadProgress | null;
  selectionMode?: boolean;
  selected?: boolean;
  onToggleSelection?: (round: RoundLibraryEntry) => void;
}) {
  const sfwMode = useSfwMode();
  const { t } = useLingui();
  const [showTechnicalDetails, setShowTechnicalDetails] = useState(false);
  const [hasActivatedPreview, setHasActivatedPreview] = useState(false);
  const [isPreviewActive, setIsPreviewActive] = useState(false);
  const previewVideoRef = useRef<HTMLVideoElement | null>(null);
  const firstResource = round.resources[0];
  const previewUri = cardAssets?.previewVideoUri;
  const previewImage = cardAssets?.previewImage ?? null;
  const primaryResource = firstResource;
  const hasFunscript = roundHasFunscript(round);
  const isTemplate = isTemplateRound(round);
  const isWebsiteRound = round.installSourceKey?.startsWith("website:") ?? false;
  const websiteVideoCacheStatus = cardAssets?.websiteVideoCacheStatus ?? "not_applicable";
  const isPreviewBeingGenerated =
    isWebsiteVideoCaching && isWebsiteRound && cardAssets != null && !previewImage;
  const showWebsiteCachingState = isWebsiteRound && websiteVideoCacheStatus === "pending";
  const isCardAssetLoading = cardAssets == null;
  const canPreview = Boolean(previewUri) && !showWebsiteCachingState;
  const canPlay =
    roundHasPlayableResource(round) &&
    (!isWebsiteRound || !isCardAssetLoading) &&
    !showWebsiteCachingState;
  const difficulty = round.difficulty ?? 1;
  const sourceLabel = abbreviateNsfwText(
    getRoundInstallSourceLabel(round.installSourceKey, {
      stash: t`Stash`,
      web: t`Web`,
      local: t`Local`,
    }),
    sfwMode
  );
  const durationLabel = formatDurationLabel(getRoundDurationSec(round));
  const animationDelay = index < 12 ? `${0.14 + index * 0.04}s` : undefined;
  const displayName = abbreviateNsfwText(round.name, sfwMode);
  const displayType = abbreviateNsfwText(getRoundDisplayType(round.type, "Normal"), sfwMode);
  const displayDescription = abbreviateNsfwText(round.description ?? t`No description`, sfwMode);
  const displayAuthor = abbreviateNsfwText(round.author ?? t`Unknown`, sfwMode);
  const displayHeroName = round.hero?.name ? abbreviateNsfwText(round.hero.name, sfwMode) : t`N/A`;
  const displayLibraryLabel = abbreviateNsfwText(
    round.author ?? round.hero?.name ?? t`Installed`,
    sfwMode
  );
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
          aria-label={selected ? t`Deselect ${displayName}` : t`Select ${displayName}`}
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
              alt={t`${displayName} preview`}
              className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
              loading="lazy"
              decoding="async"
            />
          </SfwGuard>
        )}
        {previewUri && canPreview && hasActivatedPreview ? (
          <RoundCardPreviewVideo
            videoRef={previewVideoRef}
            previewUri={previewUri}
            previewImage={previewImage}
            startTime={round.startTime}
            endTime={round.endTime}
            active={isPreviewActive}
          />
        ) : isCardAssetLoading ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-zinc-500 font-[family-name:var(--font-jetbrains-mono)] text-xs uppercase tracking-[0.35em]">
            <div className="h-16 w-32 animate-pulse rounded-2xl border border-white/10 bg-white/5" />
            <span>{t`Loading Preview`}</span>
          </div>
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
                ? t`Caching Ongoing`
                : isPreviewBeingGenerated
                  ? t`Preview Is Being Generated`
                  : t`No Preview`}
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
        ) : canPlay ? (
          <button
            type="button"
            aria-label={t`Play ${displayName}`}
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
              <Trans>Disabled</Trans>
            </span>
          )}
          {round.excludeFromRandom && (
            <span className="rounded-full border border-orange-300/35 bg-orange-500/18 px-2.5 py-1 font-[family-name:var(--font-jetbrains-mono)] text-[9px] uppercase tracking-[0.24em] text-orange-100 backdrop-blur-md">
              <Trans>Excluded</Trans>
            </span>
          )}
          {isTemplate && (
            <span className="rounded-full border border-amber-300/35 bg-amber-500/18 px-2.5 py-1 font-[family-name:var(--font-jetbrains-mono)] text-[9px] uppercase tracking-[0.24em] text-amber-100 backdrop-blur-md">
              <Trans>Template</Trans>
            </span>
          )}
          {showWebsiteCachingState && (
            <span className="rounded-full border border-amber-300/45 bg-amber-500/18 px-2.5 py-1 font-[family-name:var(--font-jetbrains-mono)] text-[9px] uppercase tracking-[0.24em] text-amber-100 backdrop-blur-md">
              {downloadProgress ? `${Math.round(downloadProgress.percent)}%` : t`Caching Ongoing`}
            </span>
          )}
        </div>

        <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-3 px-3 pb-3">
          <div className="min-w-0 rounded-2xl border border-white/10 bg-black/25 px-3 py-2 backdrop-blur-md">
            <p className="font-[family-name:var(--font-jetbrains-mono)] text-[9px] uppercase tracking-[0.28em] text-white/55">
              <Trans>Library</Trans>
            </p>
            <p className="mt-1 max-w-[12rem] truncate text-sm font-semibold text-white/90">
              {displayLibraryLabel}
            </p>
          </div>
          <span
            className={`shrink-0 rounded-full border px-2.5 py-1 font-[family-name:var(--font-jetbrains-mono)] text-[9px] uppercase tracking-[0.24em] backdrop-blur-md ${
              showWebsiteCachingState
                ? "border-amber-300/45 bg-amber-500/18 text-amber-100"
                : hasFunscript
                  ? "border-emerald-300/35 bg-emerald-500/18 text-emerald-100"
                  : "border-orange-300/35 bg-orange-500/18 text-orange-100"
            }`}
          >
            {showWebsiteCachingState
              ? downloadProgress
                ? `${Math.round(downloadProgress.percent)}%`
                : t`Video Caching`
              : hasFunscript
                ? t`Script Ready`
                : t`No Script`}
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
              <TechnicalDetail label={t`Round Hash`} value={round.phash ?? "N/A"} />
              <TechnicalDetail label={t`Resource Hash`} value={primaryResource?.phash ?? "N/A"} />
              <TechnicalDetail label={t`Round ID`} value={round.id} />
              <TechnicalDetail label={t`Resource ID`} value={primaryResource?.id ?? "N/A"} />
              <TechnicalDetail
                label={t`Source Key`}
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
            <strong className="font-medium text-zinc-300">{t`BPM:`}</strong>{" "}
            {round.bpm ? Math.round(round.bpm) : t`N/A`}
          </span>
          <span>
            <strong className="font-medium text-zinc-300">{t`Hero:`}</strong> {displayHeroName}
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
            {isTemplate ? t`Template` : hasFunscript ? t`Script Ready` : t`No Script`}
          </span>
          <span>
            <strong className="font-medium text-zinc-300">{t`Author:`}</strong> {displayAuthor}
          </span>
          <span>
            <strong className="font-medium text-zinc-300">{t`Window:`}</strong>{" "}
            {formatWindow(round.startTime, round.endTime, t)}
          </span>
          <span>
            <strong className="font-medium text-zinc-300">{t`Length:`}</strong> {durationLabel}
          </span>
          <span>
            <strong className="font-medium text-zinc-300">{t`Source:`}</strong> {sourceLabel}
          </span>
        </div>

        <div className="grid grid-cols-[minmax(0,1fr)_auto] auto-rows-auto content-start gap-1.5 self-end">
          <button
            className="min-w-0 rounded-[1.6rem] border border-cyan-300/35 bg-cyan-500/14 px-3 py-1.5 font-[family-name:var(--font-jetbrains-mono)] text-[10px] uppercase tracking-[0.18em] text-cyan-100 transition-all duration-200 hover:border-cyan-200/75 hover:bg-cyan-500/28"
            onClick={() => onEdit(round)}
            onMouseEnter={onHoverSfx}
            type="button"
          >
            <Trans>Edit Round</Trans>
          </button>
          <button
            className="rounded-[1.6rem] border border-violet-300/35 bg-violet-500/12 px-2.5 py-1.5 font-[family-name:var(--font-jetbrains-mono)] text-[10px] uppercase tracking-[0.16em] text-violet-100 transition-all duration-200 hover:border-violet-200/75 hover:bg-violet-500/24"
            onClick={() => setShowTechnicalDetails((prev) => !prev)}
            onMouseEnter={onHoverSfx}
            type="button"
            aria-expanded={showTechnicalDetails}
            aria-label={
              showTechnicalDetails ? t`Hide Technical Details` : t`Show Technical Details`
            }
          >
            {showTechnicalDetails ? <Trans>Hide Details</Trans> : <Trans>Details</Trans>}
          </button>
          {isTemplate && (
            <>
              <button
                className="col-span-2 rounded-[1.6rem] border border-amber-300/35 bg-amber-500/14 px-3 py-1.5 font-[family-name:var(--font-jetbrains-mono)] text-[10px] uppercase tracking-[0.18em] text-amber-100 transition-all duration-200 hover:border-amber-200/75 hover:bg-amber-500/28"
                onClick={() => onRepairTemplate(round)}
                onMouseEnter={onHoverSfx}
                type="button"
              >
                <Trans>Repair Template</Trans>
              </button>
              <button
                className="col-span-2 rounded-[1.6rem] border border-fuchsia-300/35 bg-fuchsia-500/14 px-3 py-1.5 font-[family-name:var(--font-jetbrains-mono)] text-[10px] uppercase tracking-[0.18em] text-fuchsia-100 transition-all duration-200 hover:border-fuchsia-200/75 hover:bg-fuchsia-500/28"
                onClick={() => onRetryTemplateLinking(round)}
                onMouseEnter={onHoverSfx}
                type="button"
              >
                <Trans>Retry Auto-Link</Trans>
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
              <Trans>Convert to Hero</Trans>
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
  const { t } = useLingui();
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
          aria-label={selected ? t`Deselect ${heroName}` : t`Select ${heroName}`}
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
        aria-label={t`${heroName} (${roundCount} rounds)`}
      >
        <div className="min-w-0">
          <p className="font-[family-name:var(--font-jetbrains-mono)] text-[10px] uppercase tracking-[0.25em] text-violet-200/85">
            <Trans>Hero Group</Trans>
          </p>
          <h2 className="mt-1 truncate text-lg font-extrabold tracking-tight text-zinc-100">
            {heroName}
          </h2>
        </div>
        <div className="flex items-center gap-3 pl-3">
          {pendingCacheCount > 0 && (
            <span className="rounded-md border border-amber-300/40 bg-amber-500/15 px-2 py-1 font-[family-name:var(--font-jetbrains-mono)] text-[10px] uppercase tracking-[0.2em] text-amber-100">
              {pendingCacheCount > 1 ? t`${pendingCacheCount} Caching` : t`Caching Ongoing`}
            </span>
          )}
          {pendingPreviewCount > 0 && (
            <span className="rounded-md border border-cyan-300/40 bg-cyan-500/15 px-2 py-1 font-[family-name:var(--font-jetbrains-mono)] text-[10px] uppercase tracking-[0.2em] text-cyan-100">
              {pendingPreviewCount > 1
                ? t`${pendingPreviewCount} Previews Generating`
                : t`Preview Is Being Generated`}
            </span>
          )}
          <span className="rounded-md border border-violet-300/40 bg-violet-500/15 px-2 py-1 font-[family-name:var(--font-jetbrains-mono)] text-[10px] uppercase tracking-[0.2em] text-violet-100">
            {t`${roundCount} Rounds`}
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
          <Trans>Actions</Trans>
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
              <Trans>Edit Hero</Trans>
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
              <Trans>Delete Hero</Trans>
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
                  <Trans>Repair Templates</Trans>
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
                  <Trans>Retry Auto-Link</Trans>
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
              {converting ? <Trans>Converting...</Trans> : <Trans>Convert to Round</Trans>}
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
  const { t } = useLingui();
  return (
    <button
      type="button"
      onMouseEnter={onHoverSfx}
      onFocus={onHoverSfx}
      onClick={onToggle}
      className="flex w-full min-w-0 items-center justify-between rounded-2xl border border-emerald-300/35 bg-black/45 px-4 py-3 text-left shadow-[0_0_25px_rgba(16,185,129,0.12)] transition-all duration-200 hover:border-emerald-200/70 hover:bg-emerald-500/12"
      aria-expanded={expanded}
      aria-label={t`${playlistName} (${roundCount} rounds)`}
    >
      <div className="min-w-0">
        <p className="font-[family-name:var(--font-jetbrains-mono)] text-[10px] uppercase tracking-[0.25em] text-emerald-200/85">
          <Trans>Playlist Group</Trans>
        </p>
        <h2 className="mt-1 truncate text-lg font-extrabold tracking-tight text-zinc-100">
          {playlistName}
        </h2>
        {cachePending && (
          <p className="mt-1 font-[family-name:var(--font-jetbrains-mono)] text-[10px] uppercase tracking-[0.18em] text-amber-200/90">
            <Trans>Caching ongoing</Trans>
          </p>
        )}
      </div>
      <div className="flex items-center gap-3 pl-3">
        {cachePending && (
          <span className="rounded-md border border-amber-300/45 bg-amber-500/15 px-2 py-1 font-[family-name:var(--font-jetbrains-mono)] text-[10px] uppercase tracking-[0.2em] text-amber-100">
            <Trans>Caching Ongoing</Trans>
          </span>
        )}
        <span className="rounded-md border border-emerald-300/40 bg-emerald-500/15 px-2 py-1 font-[family-name:var(--font-jetbrains-mono)] text-[10px] uppercase tracking-[0.2em] text-emerald-100">
          {t`${roundCount} Rounds`}
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
      <span className="text-pink-100/90">
        <Trans>Difficulty</Trans>
      </span>
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
            <Trans>Close</Trans>
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
            <Trans>Cancel</Trans>
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

function formatEta(
  ms: number | null | undefined,
  t: (template: TemplateStringsArray, ...expressions: unknown[]) => string
): string {
  if (ms === null || ms === undefined) return "";
  const totalSeconds = Math.round(ms / 1000);
  if (totalSeconds <= 0) return "";
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? t`~ ${minutes}m ${seconds}s remaining` : t`~ ${seconds}s remaining`;
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
  const { t } = useLingui();
  const stats = status?.stats;
  const processed = stats ? stats.installed + stats.updated + stats.skipped + stats.failed : 0;
  const total = status?.phaseProgress?.total ?? stats?.totalSidecars ?? 0;
  const phaseCurrent = status?.phaseProgress?.current ?? processed;
  const progress = total > 0 ? (processed / total) * 100 : 0;
  const eta =
    status?.state === "running"
      ? status.etaMs
        ? formatEta(status.etaMs, t)
        : t`Calculating ETA...`
      : "";

  const summary = status
    ? t`${status.stats.installed} rounds, ${status.stats.playlistsImported} playlists, ${status.stats.updated} updated, ${status.stats.failed} failed`
    : t`Preparing import...`;
  const progressLabel =
    status?.phase === "extracting-pack" && status.phaseProgress
      ? t`Extracting pack ${status.phaseProgress.current} / ${status.phaseProgress.total} files`
      : (status?.lastMessage ?? t`Scanning files and preparing imported rounds...`);
  const progressPercent = total > 0 ? (phaseCurrent / total) * 100 : progress;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/80 px-4 backdrop-blur-md">
      <div className="w-full max-w-xl rounded-[2rem] border border-cyan-300/30 bg-zinc-950/95 p-6 shadow-[0_0_60px_rgba(34,211,238,0.18)]">
        <div className="flex items-start gap-4">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-cyan-300/30 bg-cyan-500/10 shadow-[0_0_15px_rgba(34,211,238,0.2)]">
            {status?.lastPreviewImage ? (
              <img
                src={status.lastPreviewImage}
                alt={t`Current round preview`}
                className="h-full w-full rounded-2xl object-cover"
              />
            ) : (
              <div className="h-4 w-4 rounded-full bg-cyan-300 shadow-[0_0_22px_rgba(34,211,238,0.9)] animate-pulse" />
            )}
          </div>

          <div className="flex-1 space-y-4">
            <div>
              <p className="font-[family-name:var(--font-jetbrains-mono)] text-[10px] uppercase tracking-[0.32em] text-cyan-200/85">
                <Trans>Long Import Running</Trans>
              </p>
              <h2 className="mt-2 text-2xl font-black tracking-tight text-zinc-50">
                <Trans>Installing rounds can take a very long time.</Trans>
              </h2>
              <p className="mt-3 text-sm leading-6 text-zinc-300">
                <Trans>
                  Hashes may need to be calculated, and video transcoding or preview generation may
                  also be required.
                </Trans>
              </p>
            </div>

            <div className="rounded-2xl border border-cyan-300/20 bg-cyan-500/10 p-4">
              <div className="flex items-center justify-between">
                <p className="font-[family-name:var(--font-jetbrains-mono)] text-[10px] uppercase tracking-[0.22em] text-cyan-100">
                  <Trans>Progress</Trans>
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
                    style={{ width: `${Math.min(100, progressPercent)}%` }}
                  />
                </div>
              )}

              <p className="mt-3 text-sm text-zinc-100">{summary}</p>
              <p className="mt-2 text-xs font-medium text-zinc-400 truncate">{progressLabel}</p>
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
                {aborting ? t`Aborting...` : t`Abort Import`}
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
  selectionIds,
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
  selectionIds: { roundIds: string[]; heroIds: string[] };
}) {
  const { t } = useLingui();
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const hasResult = Boolean(state.result);
  const disableClose = exporting;
  const hasSelection = selectionCount.rounds > 0 || selectionCount.heroes > 0;
  const [analysis, setAnalysis] = useState<LibraryExportPackageAnalysis | null>(null);
  const [analyzing, setAnalyzing] = useState(!hasResult);
  const userTouchedModeRef = useRef(false);
  const selectedRoundKey = selectionIds.roundIds.join("|");
  const selectedHeroKey = selectionIds.heroIds.join("|");

  useControllerSurface({
    id: "installed-library-export-dialog",
    scopeRef: dialogRef,
    priority: 120,
    enabled: true,
    initialFocusId: "installed-library-export-submit",
  });

  useEffect(() => {
    if (hasResult) {
      setAnalyzing(false);
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(
      () => {
        setAnalyzing(true);
        db.install
          .analyzeExportPackage({
            roundIds: state.exportMode === "selected" ? selectionIds.roundIds : undefined,
            heroIds: state.exportMode === "selected" ? selectionIds.heroIds : undefined,
            includeMedia: state.includeMedia,
            compressionMode: state.includeMedia ? (state.compressionMode ?? undefined) : "copy",
            compressionStrength: state.compressionStrength,
          })
          .then((result) => {
            if (cancelled) return;
            setAnalysis(result);
            onChange((current) => ({
              ...current,
              error: null,
            }));
            if (!userTouchedModeRef.current && state.compressionMode === null) {
              onChange((current) => ({
                ...current,
                compressionMode: result.compression.defaultMode,
              }));
            }
          })
          .catch((error) => {
            if (cancelled) return;
            setAnalysis(null);
            onChange((current) => ({
              ...current,
              error: error instanceof Error ? error.message : t`Failed to analyze library package.`,
            }));
          })
          .finally(() => {
            if (!cancelled) {
              setAnalyzing(false);
            }
          });
      },
      state.compressionMode === null ? 0 : 220
    );

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [
    hasResult,
    selectedHeroKey,
    selectedRoundKey,
    state.compressionMode,
    state.compressionStrength,
    state.exportMode,
    state.includeMedia,
  ]);

  const effectiveMode: "copy" | "av1" = !state.includeMedia
    ? "copy"
    : (state.compressionMode ?? analysis?.compression.defaultMode ?? "copy");
  const estimate = analysis?.estimate ?? null;
  const savingsBytes = estimate?.savingsBytes ?? 0;
  const canEnableCompression = state.includeMedia && (analysis?.compression.supported ?? false);
  const formatByteSize = (bytes: number) => {
    if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
    const units = ["B", "KB", "MB", "GB", "TB"];
    let value = bytes;
    let unitIndex = 0;
    while (value >= 1024 && unitIndex < units.length - 1) {
      value /= 1024;
      unitIndex += 1;
    }
    const digits = value >= 100 || unitIndex === 0 ? 0 : value >= 10 ? 1 : 2;
    return `${value.toFixed(digits)} ${units[unitIndex]}`;
  };
  const formatDurationEstimate = (seconds: number) => {
    if (!Number.isFinite(seconds) || seconds <= 0) return "0 min";
    const rounded = Math.max(1, Math.round(seconds));
    const hours = Math.floor(rounded / 3600);
    const minutes = Math.floor((rounded % 3600) / 60);
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${Math.max(1, minutes)} min`;
  };
  const getStrengthLabel = (value: number) => {
    if (value <= 20) return t`Low compression`;
    if (value <= 60) return t`Balanced`;
    return t`High compression`;
  };

  return (
    <div
      className="fixed inset-0 z-[75] overflow-y-auto bg-[radial-gradient(circle_at_top,rgba(34,211,238,0.18),transparent_35%),rgba(2,6,23,0.84)] px-4 py-6 backdrop-blur-md sm:flex sm:items-center sm:justify-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="installed-database-export-title"
    >
      <div
        ref={dialogRef}
        className="relative mx-auto w-full max-w-4xl overflow-hidden rounded-[2rem] border border-cyan-300/30 bg-slate-950/95 shadow-[0_30px_120px_rgba(8,145,178,0.3)] sm:max-h-[calc(100vh-3rem)]"
      >
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(34,211,238,0.16),transparent_30%),radial-gradient(circle_at_bottom_left,rgba(59,130,246,0.18),transparent_35%)]" />
        <div className="relative space-y-6 p-6 sm:max-h-[calc(100vh-3rem)] sm:overflow-y-auto sm:p-8">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-3">
              <p className="font-[family-name:var(--font-jetbrains-mono)] text-[10px] uppercase tracking-[0.34em] text-cyan-200/85">
                <Trans>Library Export</Trans>
              </p>
              <div>
                <h2
                  id="installed-database-export-title"
                  className="text-3xl font-black tracking-tight text-white sm:text-4xl"
                >
                  {hasResult ? t`Export complete.` : t`Package your library.`}
                </h2>
                <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-300">
                  {hasResult
                    ? t`Your export is ready. You can close this dialog or use the path below.`
                    : t`Review scope, media handling, and AV1 compression before choosing the destination folder.`}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              disabled={disableClose}
              className={`rounded-xl border px-4 py-2 font-[family-name:var(--font-jetbrains-mono)] text-xs uppercase tracking-[0.2em] ${
                disableClose
                  ? "cursor-not-allowed border-slate-700 bg-slate-900 text-slate-500"
                  : "border-slate-600/80 bg-black/30 text-slate-300 transition-all duration-200 hover:border-cyan-200/60 hover:text-white"
              }`}
            >
              <Trans>Close</Trans>
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
                      <Trans>Export Ready</Trans>
                    </p>
                    <p className="text-sm text-emerald-50">
                      <Trans>Media included:</Trans> {state.result?.includeMedia ? t`yes` : t`no`}
                    </p>
                  </div>
                </div>
                <div className="mt-5 rounded-2xl border border-white/10 bg-black/20 p-4">
                  <p className="font-[family-name:var(--font-jetbrains-mono)] text-[10px] uppercase tracking-[0.22em] text-slate-400">
                    <Trans>Final Artifact</Trans>
                  </p>
                  <p className="mt-2 break-all text-sm text-white">
                    {state.result?.fpackPath ?? state.result?.exportDir}
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 rounded-[1.5rem] border border-cyan-300/18 bg-cyan-500/8 p-5 text-sm text-slate-100">
                <ExportStat label={t`Heroes`} value={state.result?.heroFiles ?? 0} />
                <ExportStat label={t`Standalone`} value={state.result?.roundFiles ?? 0} />
                <ExportStat label={t`Total Rounds`} value={state.result?.exportedRounds ?? 0} />
                <ExportStat label={t`Videos`} value={state.result?.videoFiles ?? 0} />
                {state.result?.includeMedia && (
                  <>
                    <ExportStat label={t`Funscripts`} value={state.result?.funscriptFiles ?? 0} />
                    <ExportStat label={t`Mode`} value={t`With Media`} />
                  </>
                )}
                {!state.result?.includeMedia && (
                  <ExportStat label={t`Mode`} value={t`Sidecars Only`} />
                )}
                {state.result?.fpackPath && <ExportStat label={t`Pack`} value=".fpack" />}
                {state.result?.includeMedia && (
                  <ExportStat
                    label={t`Compression`}
                    value={state.result?.compression.enabled ? "AV1" : t`Copy`}
                  />
                )}
                {state.result?.compression.enabled && (
                  <ExportStat
                    label={t`Reencoded`}
                    value={state.result?.compression.reencodedVideos ?? 0}
                  />
                )}
                {state.result?.compression.enabled && (
                  <ExportStat
                    label={t`Already AV1`}
                    value={state.result?.compression.alreadyAv1Copied ?? 0}
                  />
                )}
              </div>
            </div>
          ) : (
            <div className="grid gap-4 lg:grid-cols-[1.05fr_0.95fr]">
              <div className="space-y-4">
                <div className="rounded-[1.5rem] border border-cyan-300/18 bg-cyan-500/8 p-5">
                  <p className="font-[family-name:var(--font-jetbrains-mono)] text-[10px] uppercase tracking-[0.22em] text-cyan-100/85">
                    <Trans>Export Scope</Trans>
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
                      disabled={exporting}
                      className={`flex-1 rounded-[1.25rem] border p-4 text-left transition-all duration-200 ${
                        state.exportMode === "all"
                          ? "border-cyan-300/60 bg-cyan-500/15"
                          : "border-slate-600 bg-slate-900/50 hover:border-slate-500"
                      }`}
                    >
                      <p className="font-semibold text-white">
                        <Trans>All</Trans>
                      </p>
                      <p className="mt-1 text-xs text-slate-400">
                        <Trans>Export the entire installed library.</Trans>
                      </p>
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
                      disabled={exporting || !hasSelection}
                      className={`flex-1 rounded-[1.25rem] border p-4 text-left transition-all duration-200 ${
                        !hasSelection
                          ? "cursor-not-allowed border-slate-700 bg-slate-900/30 opacity-50"
                          : state.exportMode === "selected"
                            ? "border-violet-300/60 bg-violet-500/15"
                            : "border-slate-600 bg-slate-900/50 hover:border-slate-500"
                      }`}
                    >
                      <p className="font-semibold text-white">
                        <Trans>Selected</Trans>
                      </p>
                      <p className="mt-1 text-xs text-slate-400">
                        {hasSelection
                          ? t`${selectionCount.rounds} rounds, ${selectionCount.heroes} heroes`
                          : t`No selection`}
                      </p>
                    </button>
                  </div>
                </div>

                <div className="rounded-[1.5rem] border border-cyan-300/18 bg-cyan-500/8 p-5">
                  <p className="font-[family-name:var(--font-jetbrains-mono)] text-[10px] uppercase tracking-[0.22em] text-cyan-100/85">
                    <Trans>Package Options</Trans>
                  </p>
                  <div className="mt-4 flex flex-col gap-4">
                    <label className="flex cursor-pointer items-center gap-3">
                      <input
                        type="checkbox"
                        className="form-checkbox h-5 w-5 rounded border-slate-700 bg-black/50 text-cyan-400 focus:ring-cyan-400 focus:ring-offset-slate-950"
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
                            compressionMode: next ? current.compressionMode : "copy",
                            error: null,
                          }));
                        }}
                        disabled={exporting}
                      />
                      <div>
                        <span className="text-sm font-semibold text-white">
                          <Trans>Include Media Files</Trans>
                        </span>
                        <p className="text-xs text-slate-400">
                          <Trans>If unchecked, only sidecars and scripts are exported.</Trans>
                        </p>
                      </div>
                    </label>

                    <label className="flex cursor-pointer items-center gap-3">
                      <input
                        type="checkbox"
                        className="form-checkbox h-5 w-5 rounded border-slate-700 bg-black/50 text-cyan-400 focus:ring-cyan-400 focus:ring-offset-slate-950"
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
                          <Trans>Pack into .fpack File</Trans>
                        </span>
                        <p className="text-xs text-slate-400">
                          <Trans>
                            Packs all exported files into a single ZIP archive (.fpack).
                          </Trans>
                        </p>
                      </div>
                    </label>
                  </div>

                  {state.includeMedia && (
                    <div className="rounded-[1.5rem] border border-cyan-300/18 bg-cyan-500/8 p-5">
                      <p className="font-[family-name:var(--font-jetbrains-mono)] text-[10px] uppercase tracking-[0.22em] text-cyan-100/85">
                        <Trans>Compression</Trans>
                      </p>
                      <div className="mt-4 grid gap-3">
                        <button
                          type="button"
                          onClick={() => {
                            userTouchedModeRef.current = true;
                            onChange((current) => ({
                              ...current,
                              compressionMode: "copy",
                              error: null,
                            }));
                          }}
                          disabled={exporting}
                          className={`rounded-[1.25rem] border p-4 text-left transition-all duration-200 ${
                            effectiveMode === "copy"
                              ? "border-emerald-300/65 bg-emerald-500/12"
                              : "border-slate-700/80 bg-black/25 hover:border-slate-500"
                          }`}
                        >
                          <p className="font-semibold text-white">
                            <Trans>Copy original media</Trans>
                          </p>
                          <p className="mt-1 text-xs text-slate-400">
                            <Trans>Fastest export. Keeps current codec and file size.</Trans>
                          </p>
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            if (!canEnableCompression) return;
                            userTouchedModeRef.current = true;
                            onChange((current) => ({
                              ...current,
                              compressionMode: "av1",
                              error: null,
                            }));
                          }}
                          disabled={exporting || !canEnableCompression}
                          className={`rounded-[1.25rem] border p-4 text-left transition-all duration-200 ${
                            !canEnableCompression
                              ? "cursor-not-allowed border-slate-700 bg-slate-900/30 opacity-55"
                              : effectiveMode === "av1"
                                ? "border-amber-300/65 bg-amber-500/12"
                                : "border-slate-700/80 bg-black/25 hover:border-slate-500"
                          }`}
                        >
                          <p className="font-semibold text-white">
                            <Trans>Convert to AV1</Trans>
                          </p>
                          <p className="mt-1 text-xs text-slate-400">
                            <Trans>
                              Smaller packages. Takes longer because videos may be reencoded.
                            </Trans>
                          </p>
                        </button>
                      </div>

                      {effectiveMode === "av1" && (
                        <div className="mt-4 rounded-[1.25rem] border border-amber-300/18 bg-black/20 p-4">
                          <div className="flex items-center justify-between gap-3">
                            <div>
                              <p className="font-[family-name:var(--font-jetbrains-mono)] text-[10px] uppercase tracking-[0.2em] text-amber-100/90">
                                <Trans>Compression Strength</Trans>
                              </p>
                              <p className="mt-1 text-sm text-white">
                                {state.compressionStrength}% ·{" "}
                                {getStrengthLabel(state.compressionStrength)}
                              </p>
                            </div>
                            <p className="text-xs text-slate-400">
                              {analysis?.compression.encoderName ?? t`Encoder pending`}
                            </p>
                          </div>
                          <input
                            type="range"
                            min={0}
                            max={100}
                            step={1}
                            value={state.compressionStrength}
                            disabled={exporting}
                            onChange={(event) => {
                              userTouchedModeRef.current = true;
                              onChange((current) => ({
                                ...current,
                                compressionStrength: Number(event.target.value),
                                error: null,
                              }));
                            }}
                            className="mt-4 h-2 w-full cursor-pointer appearance-none rounded-full bg-slate-800 accent-amber-300"
                          />
                          <div className="mt-4 grid grid-cols-2 gap-3 text-sm text-slate-100 sm:grid-cols-4">
                            <ExportStat
                              label={t`Source Size`}
                              value={formatByteSize(estimate?.sourceVideoBytes ?? 0)}
                            />
                            <ExportStat
                              label={t`Expected Size`}
                              value={formatByteSize(estimate?.expectedVideoBytes ?? 0)}
                            />
                            <ExportStat label={t`Savings`} value={formatByteSize(savingsBytes)} />
                            <ExportStat
                              label={t`Est. Time`}
                              value={formatDurationEstimate(
                                estimate?.estimatedCompressionSeconds ?? 0
                              )}
                            />
                          </div>
                        </div>
                      )}

                      {analysis?.compression.warning && (
                        <p className="mt-4 rounded-2xl border border-amber-300/25 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
                          {analysis.compression.warning}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              </div>
              <div className="rounded-[1.5rem] border border-slate-700/80 bg-black/25 p-5">
                <p className="font-[family-name:var(--font-jetbrains-mono)] text-[10px] uppercase tracking-[0.22em] text-slate-400">
                  <Trans>What happens</Trans>
                </p>
                <div className="mt-4 space-y-3 text-sm text-slate-200">
                  <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-4">
                    <p className="font-semibold text-white">
                      <Trans>1. Scope</Trans>
                    </p>
                    <p className="mt-1 leading-6 text-slate-300">
                      {state.exportMode === "all"
                        ? t`The full installed library will be packaged.`
                        : hasSelection
                          ? t`${selectionCount.rounds} rounds and ${selectionCount.heroes} heroes will be packaged.`
                          : t`Select items in the library to enable partial export.`}
                    </p>
                  </div>
                  <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-4">
                    <p className="font-semibold text-white">
                      <Trans>2. Media</Trans>
                    </p>
                    <p className="mt-1 leading-6 text-slate-300">
                      {state.includeMedia
                        ? effectiveMode === "av1"
                          ? t`Videos will be packaged and reencoded to AV1 when needed. Funscripts remain attached.`
                          : t`Videos and funscripts will be copied into the export package without reencoding.`
                        : t`Only sidecars and script files will be written. Video URIs stay as references.`}
                    </p>
                  </div>
                  <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-4">
                    <p className="font-semibold text-white">
                      <Trans>3. Estimate</Trans>
                    </p>
                    <p className="mt-1 leading-6 text-slate-300">
                      {analyzing
                        ? t`Analyzing package size and compression time...`
                        : state.includeMedia
                          ? t`Expected media size: ${formatByteSize(estimate?.expectedVideoBytes ?? 0)}${effectiveMode === "av1" ? `, estimated encode time: ${formatDurationEstimate(estimate?.estimatedCompressionSeconds ?? 0)}.` : "."}`
                          : t`No video packaging step is required.`}
                    </p>
                  </div>
                  <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-4">
                    <p className="font-semibold text-white">
                      <Trans>4. Export</Trans>
                    </p>
                    <p className="mt-1 leading-6 text-slate-300">
                      <Trans>
                        You will choose a destination folder, then a timestamped export package will
                        be generated inside it.
                      </Trans>
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
                ? t`You can close this dialog now.`
                : analyzing
                  ? t`Analyzing export package...`
                  : state.exportMode === "selected" && !hasSelection
                    ? t`Select items in the library first.`
                    : t`Click export to choose a destination and generate the package.`}
            </p>
            <div className="flex flex-wrap gap-3">
              {!hasResult && (
                <button
                  type="button"
                  onClick={onSubmit}
                  disabled={
                    exporting || analyzing || (state.exportMode === "selected" && !hasSelection)
                  }
                  className={`rounded-xl border px-5 py-2.5 font-[family-name:var(--font-jetbrains-mono)] text-xs uppercase tracking-[0.22em] transition-all duration-200 ${
                    exporting || analyzing || (state.exportMode === "selected" && !hasSelection)
                      ? "cursor-not-allowed border-slate-700 bg-slate-900 text-slate-500"
                      : "border-cyan-300/60 bg-cyan-500/22 text-cyan-100 hover:border-cyan-200/85 hover:bg-cyan-500/36"
                  }`}
                  data-controller-focus-id="installed-library-export-submit"
                  data-controller-initial="true"
                >
                  {exporting ? t`Exporting...` : analyzing ? t`Analyzing...` : t`Start Export`}
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
      className={`rounded-2xl border px-4 py-3 text-left font-[family-name:var(--font-jetbrains-mono)] text-xs uppercase tracking-[0.18em] transition-all duration-200 ${
        disabled
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
  isSettingsLoading,
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
  onSearchEroScripts,
  onInstall,
  onHoverSfx,
}: {
  open: boolean;
  roundName: string;
  videoUrl: string;
  funscriptUrl: string;
  funscriptFileLabel: string | null;
  isSettingsLoading: boolean;
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
  onSearchEroScripts: () => void;
  onInstall: () => void;
  onHoverSfx: () => void;
}) {
  const { t } = useLingui();
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
        aria-label={t`Install from web`}
      >
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(217,70,239,0.14),transparent_28%),radial-gradient(circle_at_bottom_left,rgba(34,211,238,0.12),transparent_32%)]" />
        <div className="relative space-y-6 p-6 sm:p-8">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="font-[family-name:var(--font-jetbrains-mono)] text-[10px] uppercase tracking-[0.34em] text-fuchsia-200/80">
                <Trans>Website Install</Trans>
              </p>
              <h2 className="mt-3 text-3xl font-black tracking-tight text-white">
                <Trans>Install From Web</Trans>
              </h2>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-300">
                <Trans>
                  Create an installed round directly from a supported public website URL. Playback
                  starts from the web source immediately and caches in the background.
                </Trans>
              </p>
            </div>
            <button
              type="button"
              onMouseEnter={onHoverSfx}
              onClick={onClose}
              disabled={installing}
              className={`rounded-xl border px-4 py-2 font-[family-name:var(--font-jetbrains-mono)] text-xs uppercase tracking-[0.2em] ${
                installing
                  ? "cursor-not-allowed border-slate-700 bg-slate-900 text-slate-500"
                  : "border-slate-600/80 bg-black/30 text-slate-300 transition-all duration-200 hover:border-fuchsia-200/60 hover:text-white"
              }`}
            >
              <Trans>Close</Trans>
            </button>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-xs font-semibold uppercase tracking-[0.2em] text-zinc-400">
                <Trans>Round Name</Trans>
              </span>
              <input
                type="text"
                value={roundName}
                onChange={(event) => onRoundNameChange(event.target.value)}
                placeholder={t`My Website Round`}
                className="w-full rounded-xl border border-fuchsia-300/30 bg-black/45 px-4 py-3 text-sm text-zinc-100 outline-none transition-colors focus:border-fuchsia-200/75"
                data-controller-focus-id="website-round-name"
                data-controller-initial="true"
                aria-label={t`Round Name`}
              />
            </label>

            <label className="block lg:col-span-2">
              <span className="mb-1 block text-xs font-semibold uppercase tracking-[0.2em] text-zinc-400">
                <Trans>Video URL</Trans>
              </span>
              <input
                type="url"
                value={videoUrl}
                onChange={(event) => onVideoUrlChange(event.target.value)}
                placeholder={t`https://www.pornhub.com/view_video.php?viewkey=...`}
                className={`w-full rounded-xl border bg-black/45 px-4 py-3 text-sm text-zinc-100 outline-none transition-colors focus:border-fuchsia-200/75 ${
                  videoValidation.state === "unsupported"
                    ? "border-rose-300/60"
                    : videoValidation.state === "supported"
                      ? "border-emerald-300/60"
                      : videoValidation.state === "checking"
                        ? "border-cyan-300/60"
                        : "border-fuchsia-300/30"
                }`}
                aria-label={t`Video URL`}
              />
              {videoValidation.message ? (
                <span
                  className={`mt-2 block text-xs ${
                    videoValidation.state === "unsupported"
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

            {isSettingsLoading ? (
              <div className="block lg:col-span-2">
                <span className="mb-1 block text-xs font-semibold uppercase tracking-[0.2em] text-zinc-400">
                  <Trans>Funscript URL</Trans>
                </span>
                <div className="h-12 animate-pulse rounded-xl border border-cyan-300/20 bg-black/45" />
              </div>
            ) : showFunscriptUrl ? (
              <label className="block lg:col-span-2">
                <span className="mb-1 block text-xs font-semibold uppercase tracking-[0.2em] text-zinc-400">
                  <Trans>Funscript URL</Trans>
                </span>
                <input
                  type="url"
                  value={funscriptUrl}
                  onChange={(event) => onFunscriptUrlChange(event.target.value)}
                  placeholder={t`Optional: https://example.com/video.funscript`}
                  className="w-full rounded-xl border border-cyan-300/30 bg-black/45 px-4 py-3 text-sm text-zinc-100 outline-none transition-colors focus:border-cyan-200/75"
                  aria-label={t`Funscript URL`}
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
              label={t`Select Local Funscript`}
              description={t`Attach an optional local .funscript file`}
              tone="cyan"
              disabled={disabled}
              onHover={onHoverSfx}
              onClick={onSelectLocalFunscript}
            />
            <RoundActionButton
              label={t`Search EroScripts`}
              description={t`Find videos and direct funscripts from EroScripts.`}
              tone="emerald"
              disabled={disabled}
              onHover={onHoverSfx}
              onClick={onSearchEroScripts}
            />
            <RoundActionButton
              label={installing ? t`Installing...` : t`Install Website Round`}
              description={t`Create an installed round from the current website source fields.`}
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
            {!isSettingsLoading && !showFunscriptUrl
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

function formatWindow(
  startTime: number | null,
  endTime: number | null,
  t: (template: TemplateStringsArray, ...expressions: unknown[]) => string
): string {
  if (typeof startTime !== "number" || !Number.isFinite(startTime)) {
    return t`Full`;
  }
  const startLabel = formatMediaTimestamp(startTime);
  if (typeof endTime !== "number" || !Number.isFinite(endTime) || endTime <= startTime) {
    return `${startLabel}+`;
  }
  return `${startLabel}-${formatMediaTimestamp(endTime)}`;
}

function getRoundInstallSourceLabel(
  installSourceKey: string | null | undefined,
  labels: { stash: string; web: string; local: string }
): string {
  if (installSourceKey?.startsWith("stash:")) {
    return labels.stash;
  }

  if (installSourceKey?.startsWith("website:")) {
    return labels.web;
  }

  return labels.local;
}

function getRoundDisplayType(type: string | null | undefined, normalLabel: string): string {
  return typeof type === "string" && type.trim().length > 0 ? type : normalLabel;
}

function summarizeHeroGroupPreviewState(
  rounds: RoundLibraryEntry[],
  cardAssetsByRoundId: ReadonlyMap<string, InstalledRoundCardAssets>,
  isWebsiteVideoCaching: boolean
): {
  pendingCacheCount: number;
  pendingPreviewCount: number;
} {
  let pendingCacheCount = 0;
  let pendingPreviewCount = 0;

  for (const round of rounds) {
    const cardAssets = cardAssetsByRoundId.get(round.id);
    const cacheStatus = cardAssets?.websiteVideoCacheStatus ?? "not_applicable";
    if (cacheStatus === "pending") {
      pendingCacheCount += 1;
      continue;
    }

    const isWebsiteRound = round.installSourceKey?.startsWith("website:") ?? false;
    if (isWebsiteVideoCaching && isWebsiteRound && cardAssets != null && !cardAssets.previewImage) {
      pendingPreviewCount += 1;
    }
  }

  return { pendingCacheCount, pendingPreviewCount };
}

function formatDate(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  return ROUND_CARD_DATE_FORMATTER.format(date);
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
