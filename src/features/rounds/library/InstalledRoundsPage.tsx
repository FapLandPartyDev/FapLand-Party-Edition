import { Trans, useLingui } from "@lingui/react/macro";
import { useNavigate } from "@tanstack/react-router";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";
import { AnimatedBackground } from "@/components/AnimatedBackground";
import { LibraryExportOverlay } from "@/components/LibraryExportOverlay";
import {
  EroScriptsFunscriptSearchDialog,
  type EroScriptsRoundInstallInput,
} from "@/components/EroScriptsFunscriptSearchDialog";
import { RoundVideoOverlay } from "@/components/game/RoundVideoOverlay";
import { buildPreviewRoundVideoOverlayProps } from "@/components/game/buildRoundVideoOverlayProps";
import { InlineMetrics } from "@/components/ui";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { useToast } from "@/components/ui/ToastHost";
import { useControllerSurface } from "@/controller";
import type { ActiveRound } from "@/game/types";
import {
  CURRENT_PLAYLIST_VERSION,
  type PlaylistConfig,
  type PortableRoundRef,
} from "@/game/playlistSchema";
import { getSinglePlayerAntiPerkPool, getSinglePlayerPerkPool } from "@/game/data/perks";
import {
  db,
  type InstallFolderScanResult,
  type InstallScanStatus,
  type InstalledRoundPlaybackEntry,
  type LegacyReviewedImportResult,
  type LibraryExportPackageStatus,
} from "@/services/db";
import { playlists } from "@/services/playlists";
import { importOpenedFile } from "@/services/openedFiles";
import { getInstalledRoundPlaybackEntryCached } from "@/services/installedRoundsCache";
import { buildRoundRenderRowsWithOptions, type RoundRenderRow } from "@/routes/roundRows";
import {
  buildDownloadProgressByUri,
  buildPlaylistGroupingData,
  buildRoundLibraryIndex,
  filterAndSortRounds,
  getDownloadProgressForPlaybackUri,
  getWebsiteVideoTargetFromPlaybackUri,
  type AddedDateFilter,
  type MetadataFilter,
  type ScriptFilter,
  type SortMode,
  type SourceFilter,
  type TypeFilter,
} from "@/routes/roundsSelectors";
import { useSfwMode } from "@/hooks/useSfwMode";
import { playHoverSound, playSelectSound } from "@/utils/audio";
import { abbreviateNsfwText } from "@/utils/sfwText";
import { useVisibleRoundAssets } from "@/features/rounds/useVisibleRoundAssets";
import { THEHANDY_OFFSET_MAX_MS, THEHANDY_OFFSET_MIN_MS } from "@/constants/theHandy";
import { GameDropdown } from "@/components/ui/GameDropdown";

import { DEFAULT_EXPORT_COMPRESSION_STRENGTH } from "./constants";
import {
  formatDate,
  isTemplateRound,
  normalizeHttpUrl,
  parseOptionalFloat,
  parseOptionalInteger,
  parseOptionalSignedInteger,
  parseTagsInput,
  pickHeroGroupRoundToKeep,
  reloadUiAfterHeroGroupConversion,
  summarizeHeroGroupPreviewState,
  roundHasFunscript,
  toHeroEditDraft,
  toRoundEditDraft,
} from "./helpers";
import type {
  BulkTagsDialogState,
  DeleteHeroDialogState,
  DeleteRoundDialogState,
  DeleteSelectedRoundsDialogState,
  EroScriptsDialogContext,
  GroupMode,
  HeroEditDraft,
  HeroHardModeConversionState,
  HeroGroupRoundConversionState,
  HeroTemplateRepairState,
  LegacyPlaylistReviewState,
  LibraryExportDialogState,
  RoundEditDraft,
  RoundHardModeConversionState,
  RoundLibraryEntry,
  RoundTemplateRepairState,
  WebsiteRoundVideoValidationState,
} from "./types";
import {
  useAvailablePlaylists,
  useControllerSupportEnabled,
  useDisabledRoundIds,
  useInstalledRoundsCatalog,
  useInvalidateLibrary,
  usePreviewSettings,
  useWebInstallSettings,
} from "./hooks/useLibraryData";
import {
  useExportPackageStatus,
  useInstallScanStatus,
  useWebVideoCacheStatus,
} from "./hooks/useStatusPollers";
import { ActionButton, DateFilterInput } from "./ui/ActionButton";
import { RoundCard } from "./components/RoundCard";
import { HeroGroupHeader, PlaylistGroupHeader } from "./components/GroupHeaders";
import { RoundGrid } from "./components/RoundGrid";
import { EditRoundDialog } from "./dialogs/EditRoundDialog";
import { EditHeroDialog } from "./dialogs/EditHeroDialog";
import { BulkTagsDialog, HeroGroupConversionDialog } from "./dialogs/BulkAndConversionDialogs";
import {
  RepairTemplateHeroDialog,
  RepairTemplateRoundDialog,
} from "./dialogs/RepairTemplateDialogs";
import { LegacyPlaylistReviewDialog } from "./dialogs/LegacyPlaylistReviewDialog";
import { WebsiteRoundInstallDialog } from "./dialogs/WebsiteRoundInstallDialog";
import { LibraryExportDialog } from "./dialogs/LibraryExportDialog";
import { InstallImportOverlay } from "./overlays/InstallImportOverlay";

function toLegacyPlaylistConfig(
  orderedSlots: NonNullable<LegacyReviewedImportResult["legacyImport"]>["orderedSlots"]
): PlaylistConfig {
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
    saveMode: "none",
    perkSelection: { optionsPerPick: 3, triggerChancePerCompletedRound: 0.51 },
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
      resetIntermediaryProbabilityAfterTrigger: false,
      resetAntiPerkProbabilityAfterTrigger: false,
    },
    roundStartDelayMs: 20000,
    disableDiceAnimation: false,
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

function InstallScanStatusBadge({ status }: { status: InstallScanStatus }) {
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
}

export function InstalledRoundsPage({
  search,
  navigate,
}: {
  search: {
    open?: "install-rounds" | "install-web";
    groupMode?: GroupMode;
    sortMode?: SortMode;
    query?: string;
    showDisabled?: boolean;
  };
  navigate: (opts: {
    to: string;
    search?: Record<string, unknown>;
    replace?: boolean;
  }) => Promise<void> | void;
}) {
  const { t } = useLingui();
  const sfwMode = useSfwMode();
  const { showToast } = useToast();
  const routerNavigate = useNavigate();
  const invalidateLibrary = useInvalidateLibrary();

  // ─── Grouping / URL-driven filter state ────────────────────────────────────
  const groupMode: GroupMode = search.groupMode ?? "hero";
  const sortMode: SortMode = search.sortMode ?? "newest";
  const showDisabledRounds = search.showDisabled ?? false;
  const updateSearch = useCallback(
    (patch: Record<string, unknown>, replace = false) => {
      void routerNavigate({ to: "/rounds", search: { ...search, ...patch }, replace });
    },
    [routerNavigate, search]
  );

  // ─── Local (non-URL) filter state ───────────────────────────────────────────
  const [queryInput, setQueryInput] = useState(search.query ?? "");
  const [query, setQuery] = useState(search.query ?? "");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [scriptFilter, setScriptFilter] = useState<ScriptFilter>("all");
  const [tagFilter, setTagFilter] = useState<MetadataFilter>("all");
  const [actorFilter, setActorFilter] = useState<MetadataFilter>("all");
  const [libraryFilter, setLibraryFilter] = useState<MetadataFilter>("all");
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");
  const [addedDateFilter, setAddedDateFilter] = useState<AddedDateFilter>({ mode: "all" });

  useEffect(() => {
    setQueryInput(search.query ?? "");
    setQuery(search.query ?? "");
  }, [search.query]);

  // ─── Data queries ───────────────────────────────────────────────────────────
  const roundsQuery = useInstalledRoundsCatalog(showDisabledRounds, true);
  const disabledIdsQuery = useDisabledRoundIds();
  const playlistsQuery = useAvailablePlaylists(groupMode === "playlist");
  const previewSettingsQuery = usePreviewSettings();
  const webInstallSettingsQuery = useWebInstallSettings();
  const controllerQuery = useControllerSupportEnabled();

  const rounds = useMemo(() => roundsQuery.data ?? [], [roundsQuery.data]);
  const disabledRoundIds = useMemo(
    () => new Set(disabledIdsQuery.data ?? []),
    [disabledIdsQuery.data]
  );
  const availablePlaylists = useMemo(() => playlistsQuery.data ?? [], [playlistsQuery.data]);

  // ─── Derived library state ──────────────────────────────────────────────────
  const roundLibraryIndex = useMemo(() => buildRoundLibraryIndex(rounds), [rounds]);
  const {
    indexedRounds,
    metadataOptions,
    standaloneRoundCount,
    heroGroupCount,
    roundsWithScriptCount,
    sourceHeroOptions,
  } = roundLibraryIndex;

  const deferredQuery = query;
  const filteredRounds = useMemo(
    () =>
      filterAndSortRounds({
        indexedRounds,
        query: deferredQuery,
        typeFilter,
        scriptFilter,
        tagFilter,
        actorFilter,
        libraryFilter,
        sourceFilter,
        addedDateFilter,
        sortMode,
      }),
    [
      actorFilter,
      deferredQuery,
      indexedRounds,
      libraryFilter,
      scriptFilter,
      sourceFilter,
      addedDateFilter,
      sortMode,
      tagFilter,
      typeFilter,
    ]
  );

  const playlistGroupingData = useMemo(
    () =>
      groupMode === "playlist" && availablePlaylists.length > 0
        ? buildPlaylistGroupingData(availablePlaylists, rounds)
        : null,
    [availablePlaylists, groupMode, rounds]
  );
  const playlistsByRoundId = playlistGroupingData?.playlistsByRoundId ?? null;

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
  const [expandedHeroGroups, setExpandedHeroGroups] = useState<Record<string, boolean>>({});
  const expandedGroupKeySet = useMemo(
    () => new Set(visibleGroupKeys.filter((groupKey) => Boolean(expandedHeroGroups[groupKey]))),
    [expandedHeroGroups, visibleGroupKeys]
  );
  const allVisibleGroupsExpanded =
    visibleGroupKeys.length > 0 &&
    visibleGroupKeys.every((groupKey) => Boolean(expandedHeroGroups[groupKey]));

  // Shelves open by default. Explicit collapses are remembered for this page session.
  useEffect(() => {
    setExpandedHeroGroups((previous) => {
      const next = { ...previous };
      let changed = false;
      for (const groupKey of visibleGroupKeys) {
        if (groupKey in next) continue;
        next[groupKey] = true;
        changed = true;
      }
      return changed ? next : previous;
    });
  }, [visibleGroupKeys]);

  const hasActiveFilters =
    queryInput.trim().length > 0 ||
    typeFilter !== "all" ||
    scriptFilter !== "all" ||
    tagFilter !== "all" ||
    actorFilter !== "all" ||
    libraryFilter !== "all" ||
    sourceFilter !== "all" ||
    addedDateFilter.mode !== "all";
  const activeFilterCount =
    Number(queryInput.trim().length > 0) +
    Number(typeFilter !== "all") +
    Number(scriptFilter !== "all") +
    Number(tagFilter !== "all") +
    Number(actorFilter !== "all") +
    Number(libraryFilter !== "all") +
    Number(sourceFilter !== "all") +
    Number(addedDateFilter.mode !== "all");

  // ─── Selection ──────────────────────────────────────────────────────────────
  const [selectedRoundIds, setSelectedRoundIds] = useState<Set<string>>(new Set());
  const [selectedHeroIds, setSelectedHeroIds] = useState<Set<string>>(new Set());
  const [selectionMode, setSelectionMode] = useState(false);

  // ─── Scan status + web video cache ──────────────────────────────────────────
  const scanStatusQuery = useInstallScanStatus({ enabled: true });
  const scanStatus = scanStatusQuery.data ?? null;
  const [isStartingScan, setIsStartingScan] = useState(false);
  const [showInstallOverlay, setShowInstallOverlay] = useState(false);
  const [isAbortingInstall, setIsAbortingInstall] = useState(false);
  const isLibraryScanning = scanStatus?.state === "running";

  const [visibleRoundIds, setVisibleRoundIds] = useState<string[]>([]);
  const [isLibraryScrolling, setIsLibraryScrolling] = useState(false);
  const [inspectedRoundId, setInspectedRoundId] = useState<string | null>(null);
  const [showInstallMenu, setShowInstallMenu] = useState(false);
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const [showFilterTray, setShowFilterTray] = useState(false);
  // Preview overlay state declared early so the visible-assets hook can prioritize it.
  const [activePreviewRound, setActivePreviewRound] = useState<InstalledRoundPlaybackEntry | null>(
    null
  );
  const { cardAssetsByRoundId, refreshRoundAssets } = useVisibleRoundAssets({
    visibleRoundIds,
    selectedRoundId: activePreviewRound?.id ?? inspectedRoundId,
    includeDisabled: showDisabledRounds,
    isScrolling: isLibraryScrolling,
  });

  const hasWebsiteRounds = useMemo(
    () => rounds.some((round) => round.installSourceKey?.startsWith("website:")),
    [rounds]
  );
  const webVideoCacheQuery = useWebVideoCacheStatus(hasWebsiteRounds && !isStartingScan);
  const websiteVideoScanStatus = webVideoCacheQuery.data?.scanStatus ?? null;
  const websiteVideoDownloadProgresses = useMemo(
    () => webVideoCacheQuery.data?.downloadProgresses ?? [],
    [webVideoCacheQuery.data?.downloadProgresses]
  );
  const isWebsiteVideoCaching =
    websiteVideoScanStatus?.state === "running" || websiteVideoDownloadProgresses.length > 0;
  const downloadProgressByUri = useMemo(
    () => buildDownloadProgressByUri(websiteVideoDownloadProgresses),
    [websiteVideoDownloadProgresses]
  );
  const getDownloadProgressForVideoUri = useCallback(
    (uri: string | null | undefined) =>
      getDownloadProgressForPlaybackUri(downloadProgressByUri, uri),
    [downloadProgressByUri]
  );
  const previousDownloadUrlsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const currentUrls = new Set(websiteVideoDownloadProgresses.map((progress) => progress.url));
    const completedUrls = [...previousDownloadUrlsRef.current].filter(
      (url) => !currentUrls.has(url)
    );
    previousDownloadUrlsRef.current = currentUrls;
    if (completedUrls.length === 0) return;

    const completedUrlSet = new Set(completedUrls);
    const affectedVisibleRoundIds = visibleRoundIds.filter((roundId) => {
      const previewVideoUri = cardAssetsByRoundId.get(roundId)?.previewVideoUri;
      const targetUrl = previewVideoUri
        ? getWebsiteVideoTargetFromPlaybackUri(previewVideoUri)
        : null;
      return targetUrl ? completedUrlSet.has(targetUrl) : false;
    });
    refreshRoundAssets(affectedVisibleRoundIds);
  }, [cardAssetsByRoundId, refreshRoundAssets, visibleRoundIds, websiteVideoDownloadProgresses]);

  // ─── Export state ───────────────────────────────────────────────────────────
  const [exportDialog, setExportDialog] = useState<LibraryExportDialogState | null>(null);
  const [isExportingDatabase, setIsExportingDatabase] = useState(false);
  const [libraryExportStatus, setLibraryExportStatus] = useState<LibraryExportPackageStatus | null>(
    null
  );
  const [showLibraryExportOverlay, setShowLibraryExportOverlay] = useState(false);
  const [isAbortingLibraryExport, setIsAbortingLibraryExport] = useState(false);
  const exportRunning = libraryExportStatus?.state === "running";
  const exportStatusQuery = useExportPackageStatus(exportRunning || showLibraryExportOverlay);
  useEffect(() => {
    const status = exportStatusQuery.data;
    if (!status) return;
    setLibraryExportStatus(status);
    if (status.state === "running") {
      setShowLibraryExportOverlay(true);
    } else {
      setShowLibraryExportOverlay(false);
      setIsAbortingLibraryExport(false);
      if (status.state === "aborted") {
        setExportDialog((current) =>
          current ? { ...current, result: null, error: t`Export canceled.` } : current
        );
      } else if (status.state === "error") {
        setExportDialog((current) =>
          current
            ? {
                ...current,
                error: current.error ?? status.lastMessage ?? t`Failed to export library package.`,
              }
            : current
        );
      }
    }
  }, [exportStatusQuery.data, t]);

  // ─── Preview overlay ────────────────────────────────────────────────────────
  const [previewInstalledRounds, setPreviewInstalledRounds] = useState<
    NonNullable<InstalledRoundPlaybackEntry>[]
  >([]);
  const previewSettings = previewSettingsQuery.data;
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
        intermediaryProbability: 0,
        booruSearchPrompt: previewSettings?.intermediaryLoadingPrompt ?? "",
        intermediaryLoadingDurationSec: previewSettings?.intermediaryLoadingDurationSec ?? 5,
        intermediaryReturnPauseSec: previewSettings?.intermediaryReturnPauseSec ?? 4,
        allowAutomaticIntermediaries: false,
        initialShowProgressBarAlways: previewSettings?.roundProgressBarAlwaysVisible ?? false,
        onClose: () => setActivePreviewRound(null),
        onFinishRound: () => setActivePreviewRound(null),
      }),
    [activePreview, previewInstalledRounds, previewSettings]
  );

  // ─── Dialog state ───────────────────────────────────────────────────────────
  const [editingRound, setEditingRound] = useState<RoundEditDraft | null>(null);
  const [editingHero, setEditingHero] = useState<HeroEditDraft | null>(null);
  const [deleteRoundDialog, setDeleteRoundDialog] = useState<DeleteRoundDialogState | null>(null);
  const [deleteSelectedRoundsDialog, setDeleteSelectedRoundsDialog] =
    useState<DeleteSelectedRoundsDialogState | null>(null);
  const [deleteHeroDialog, setDeleteHeroDialog] = useState<DeleteHeroDialogState | null>(null);
  const [bulkTagsDialog, setBulkTagsDialog] = useState<BulkTagsDialogState | null>(null);
  const [heroGroupRoundConversion, setHeroGroupRoundConversion] =
    useState<HeroGroupRoundConversionState | null>(null);
  const [convertingHeroGroupKey, setConvertingHeroGroupKey] = useState<string | null>(null);
  const [heroHardModeConversion, setHeroHardModeConversion] =
    useState<HeroHardModeConversionState | null>(null);
  const [convertingHardModeHeroId, setConvertingHardModeHeroId] = useState<string | null>(null);
  const [roundHardModeConversion, setRoundHardModeConversion] =
    useState<RoundHardModeConversionState | null>(null);
  const [convertingHardModeRoundId, setConvertingHardModeRoundId] = useState<string | null>(null);
  const [revertingHardModeRoundId, setRevertingHardModeRoundId] = useState<string | null>(null);
  const [repairingTemplateRound, setRepairingTemplateRound] =
    useState<RoundTemplateRepairState | null>(null);
  const [repairingTemplateHero, setRepairingTemplateHero] =
    useState<HeroTemplateRepairState | null>(null);
  const [legacyPlaylistReview, setLegacyPlaylistReview] =
    useState<LegacyPlaylistReviewState | null>(null);
  const [eroscriptsDialogContext, setEroscriptsDialogContext] =
    useState<EroScriptsDialogContext | null>(null);
  const [isSavingEdit, setIsSavingEdit] = useState(false);

  // ─── Website install dialog ─────────────────────────────────────────────────
  const [websiteRoundDialogOpen, setWebsiteRoundDialogOpen] = useState(false);
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
  const [isInstallingWebsiteRound, setIsInstallingWebsiteRound] = useState(false);
  const websiteRoundVideoValidationRequestIdRef = useRef(0);
  const installWebFunscriptUrlEnabled =
    webInstallSettingsQuery.data?.installWebFunscriptUrlEnabled ?? false;
  const webInstallSettingsLoading = webInstallSettingsQuery.isLoading;

  // ─── SFX helpers ────────────────────────────────────────────────────────────
  const handleHoverSfx = useCallback(() => playHoverSound(), []);
  const handleSelectSfx = useCallback(() => playSelectSound(), []);

  // ─── Controller support ─────────────────────────────────────────────────────
  const controllerSupportEnabled = controllerQuery.data ?? false;
  const goBack = useCallback(() => {
    void routerNavigate({ to: "/" });
  }, [routerNavigate]);
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

  // ─── Website video validation effect ────────────────────────────────────────
  useEffect(() => {
    if (!websiteRoundDialogOpen) {
      setWebsiteRoundVideoValidation({ state: "idle", message: null });
      return;
    }
    const normalizedVideoUrl = normalizeHttpUrl(websiteRoundVideoUrl);
    if (!normalizedVideoUrl) {
      setWebsiteRoundVideoValidation({
        state: "unsupported",
        message: t`Enter a valid public http(s) website video URL.`,
      });
      return;
    }
    const requestId = ++websiteRoundVideoValidationRequestIdRef.current;
    setWebsiteRoundVideoValidation({ state: "checking", message: t`Checking website support...` });
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
    return () => window.clearTimeout(timeoutId);
  }, [t, websiteRoundDialogOpen, websiteRoundNameEdited, websiteRoundVideoUrl]);

  const actionButtonsDisabled =
    isStartingScan || isExportingDatabase || isInstallingWebsiteRound || isLibraryScanning;
  // ─── Action handlers ────────────────────────────────────────────────────────
  const refreshLibrary = useCallback(async () => {
    await invalidateLibrary();
  }, [invalidateLibrary]);

  const handleConvertRoundToHero = useCallback(
    (round: RoundLibraryEntry) => {
      handleSelectSfx();
      void routerNavigate({
        to: "/converter",
        search: { sourceRoundId: round.id, heroName: round.name },
      });
    },
    [handleSelectSfx, routerNavigate]
  );

  const handlePlayRound = useCallback(
    (round: RoundLibraryEntry) => {
      const cardAssets = cardAssetsByRoundId.get(round.id);
      if (cardAssets?.websiteVideoCacheStatus === "pending") return;
      handleSelectSfx();
      void getInstalledRoundPlaybackEntryCached(round.id, showDisabledRounds)
        .then((playbackEntry) => {
          if (!playbackEntry) {
            showToast(t`Failed to load selected round media.`, "error");
            return;
          }
          setPreviewInstalledRounds([playbackEntry]);
          setActivePreviewRound(playbackEntry);
        })
        .catch((error) => {
          console.error("Failed to load installed rounds for preview", error);
          showToast(
            error instanceof Error ? error.message : t`Failed to load selected round media.`,
            "error"
          );
        });
    },
    [cardAssetsByRoundId, handleSelectSfx, showDisabledRounds, showToast, t]
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

  const handleRetryTemplateLinkingForRound = useCallback(
    async (round: RoundLibraryEntry) => {
      if (isSavingEdit) return;
      setIsSavingEdit(true);
      try {
        await db.round.retryTemplateLinking({ roundId: round.id });
        await refreshLibrary();
      } catch (error) {
        console.error("Failed to retry template round linking", error);
        showToast(
          error instanceof Error ? error.message : t`Failed to retry template round linking.`,
          "error"
        );
      } finally {
        setIsSavingEdit(false);
      }
    },
    [isSavingEdit, refreshLibrary, showToast, t]
  );

  const handleRetryTemplateLinkingForHero = useCallback(
    async (heroId: string) => {
      if (isSavingEdit) return;
      setIsSavingEdit(true);
      try {
        await db.template.retryLinking({ heroId });
        await refreshLibrary();
      } catch (error) {
        console.error("Failed to retry template hero linking", error);
        showToast(
          error instanceof Error ? error.message : t`Failed to retry template hero linking.`,
          "error"
        );
      } finally {
        setIsSavingEdit(false);
      }
    },
    [isSavingEdit, refreshLibrary, showToast, t]
  );

  const saveRoundEdit = useCallback(async () => {
    if (!editingRound || isSavingEdit) return;
    const bpm = parseOptionalFloat(editingRound.bpm);
    const difficulty = parseOptionalInteger(editingRound.difficulty);
    const startTime = parseOptionalInteger(editingRound.startTime);
    const endTime = parseOptionalInteger(editingRound.endTime);
    const funscriptOffsetMs = parseOptionalSignedInteger(editingRound.funscriptOffsetMs);
    if ([bpm, difficulty, startTime, endTime, funscriptOffsetMs].some((v) => Number.isNaN(v))) {
      showToast(t`Round fields must use valid numeric values.`, "error");
      return;
    }
    if (
      funscriptOffsetMs !== null &&
      (funscriptOffsetMs < THEHANDY_OFFSET_MIN_MS || funscriptOffsetMs > THEHANDY_OFFSET_MAX_MS)
    ) {
      showToast(
        t`Funscript offset must be between ${THEHANDY_OFFSET_MIN_MS}ms and ${THEHANDY_OFFSET_MAX_MS}ms.`,
        "error"
      );
      return;
    }
    setIsSavingEdit(true);
    try {
      await db.round.update({
        id: editingRound.id,
        name: editingRound.name,
        author: editingRound.author,
        description: editingRound.description,
        tags: parseTagsInput(editingRound.tagsText),
        bpm,
        difficulty,
        startTime,
        endTime,
        funscriptUri: editingRound.resourceId ? editingRound.funscriptUri : undefined,
        funscriptOffsetMs: editingRound.resourceId ? funscriptOffsetMs : undefined,
        invertFunscript: editingRound.resourceId ? editingRound.invertFunscript : undefined,
        type: editingRound.type,
        excludeFromRandom: editingRound.excludeFromRandom,
        libraryLabel: editingRound.libraryLabel,
      });
      setEditingRound(null);
      await refreshLibrary();
    } catch (error) {
      console.error("Failed to update round", error);
      showToast(error instanceof Error ? error.message : t`Failed to update round.`, "error");
    } finally {
      setIsSavingEdit(false);
    }
  }, [editingRound, isSavingEdit, refreshLibrary, showToast, t]);

  const saveHeroEdit = useCallback(async () => {
    if (!editingHero || isSavingEdit) return;
    setIsSavingEdit(true);
    try {
      const heroDraft = editingHero;
      await db.hero.update({
        id: heroDraft.id,
        name: heroDraft.name,
        author: heroDraft.author,
        description: heroDraft.description,
        tags: parseTagsInput(heroDraft.tagsText),
      });
      if (heroDraft.funscriptDirty) {
        const result = await db.hero.updateFunscript({
          heroId: heroDraft.id,
          funscriptUri: heroDraft.funscriptUri,
        });
        const updatedLabel =
          result.updatedResources === 1
            ? t`Updated funscript for 1 hero round.`
            : t`Updated funscript for ${result.updatedResources} hero rounds.`;
        const skippedLabel =
          result.skippedRounds > 0
            ? result.skippedRounds === 1
              ? ` ${t`Skipped 1 round without resources.`}`
              : ` ${t`Skipped ${result.skippedRounds} rounds without resources.`}`
            : "";
        showToast(`${updatedLabel}${skippedLabel}`, "success");
      }
      setEditingHero(null);
      await refreshLibrary();
    } catch (error) {
      console.error("Failed to update hero", error);
      showToast(error instanceof Error ? error.message : t`Failed to update hero.`, "error");
    } finally {
      setIsSavingEdit(false);
    }
  }, [editingHero, isSavingEdit, refreshLibrary, showToast, t]);

  const editHeroEntry = useCallback(
    async (round: RoundLibraryEntry) => {
      const draft = toHeroEditDraft(round);
      if (!draft) return;
      handleSelectSfx();
      setEditingHero(draft);
      try {
        const mediaResources = await db.round.getMediaResources(round.id, true);
        const updatedDraft = toHeroEditDraft(round, mediaResources);
        if (!updatedDraft) return;
        setEditingHero((current) =>
          current?.id === updatedDraft.id && !current.funscriptDirty
            ? { ...current, funscriptUri: updatedDraft.funscriptUri }
            : current
        );
      } catch (error) {
        console.warn("Failed to load hero funscript resource details", error);
      }
    },
    [handleSelectSfx]
  );

  const confirmDeleteRound = useCallback(async () => {
    if (!deleteRoundDialog || isSavingEdit) return;
    const { id } = deleteRoundDialog;
    setDeleteRoundDialog(null);
    setIsSavingEdit(true);
    try {
      await db.round.delete(id);
      setEditingRound((current) => (current?.id === id ? null : current));
      await refreshLibrary();
    } catch (error) {
      console.error("Failed to delete round", error);
      showToast(error instanceof Error ? error.message : t`Failed to delete round.`, "error");
    } finally {
      setIsSavingEdit(false);
    }
  }, [deleteRoundDialog, isSavingEdit, refreshLibrary, showToast, t]);

  const deleteRoundEntry = useCallback(() => {
    if (!editingRound || isSavingEdit) return;
    const persistedRoundName =
      rounds.find((round) => round.id === editingRound.id)?.name ?? editingRound.name;
    setDeleteRoundDialog({
      id: editingRound.id,
      name: editingRound.name.trim() || persistedRoundName.trim(),
    });
  }, [editingRound, isSavingEdit, rounds]);

  const deleteHeroEntry = useCallback(
    (heroDraft: HeroEditDraft | null = editingHero) => {
      if (!heroDraft || isSavingEdit) return;
      const persistedHeroName =
        rounds.find((round) => round.hero?.id === heroDraft.id)?.hero?.name ?? heroDraft.name;
      setDeleteHeroDialog({
        id: heroDraft.id,
        name: heroDraft.name.trim() || persistedHeroName.trim(),
      });
    },
    [editingHero, isSavingEdit, rounds]
  );

  const confirmDeleteHero = useCallback(async () => {
    if (!deleteHeroDialog || isSavingEdit) return;
    const { id } = deleteHeroDialog;
    setDeleteHeroDialog(null);
    setIsSavingEdit(true);
    try {
      await db.hero.delete(id);
      setEditingHero((current) => (current?.id === id ? null : current));
      await refreshLibrary();
    } catch (error) {
      console.error("Failed to delete hero", error);
      showToast(error instanceof Error ? error.message : t`Failed to delete hero.`, "error");
    } finally {
      setIsSavingEdit(false);
    }
  }, [deleteHeroDialog, isSavingEdit, refreshLibrary, showToast, t]);

  const confirmBulkTagsEdit = useCallback(async () => {
    if (!bulkTagsDialog || selectedRoundIds.size === 0 || isSavingEdit) return;
    const tags = parseTagsInput(bulkTagsDialog.tagsText);
    if (tags.length === 0) {
      showToast(t`Enter at least one tag.`, "error");
      return;
    }
    setIsSavingEdit(true);
    try {
      const result = await db.round.bulkUpdateTags({
        roundIds: Array.from(selectedRoundIds),
        mode: bulkTagsDialog.mode,
        tags,
      });
      setBulkTagsDialog(null);
      await refreshLibrary();
      showToast(t`Updated tags for ${result.updatedCount} rounds.`, "success");
    } catch (error) {
      console.error("Failed to update selected round tags", error);
      showToast(
        error instanceof Error ? error.message : t`Failed to update selected round tags.`,
        "error"
      );
    } finally {
      setIsSavingEdit(false);
    }
  }, [bulkTagsDialog, isSavingEdit, refreshLibrary, selectedRoundIds, showToast, t]);

  const buildActiveFilterContext = useCallback((): string[] => {
    const context: string[] = [];
    if (sourceFilter !== "all") {
      const sourceLabel =
        sourceFilter === "stash" ? t`Stash` : sourceFilter === "web" ? t`Web` : t`Local`;
      context.push(t`Source: ${sourceLabel}`);
    }
    if (addedDateFilter.mode === "since" && addedDateFilter.fromDate.trim()) {
      context.push(t`Added: since ${formatDate(addedDateFilter.fromDate)}`);
    } else if (addedDateFilter.mode === "before" && addedDateFilter.toDate.trim()) {
      context.push(t`Added: before ${formatDate(addedDateFilter.toDate)}`);
    } else if (
      addedDateFilter.mode === "between" &&
      addedDateFilter.fromDate.trim() &&
      addedDateFilter.toDate.trim()
    ) {
      context.push(
        t`Added: ${formatDate(addedDateFilter.fromDate)} to ${formatDate(addedDateFilter.toDate)}`
      );
    }
    return context;
  }, [addedDateFilter, sourceFilter, t]);

  const openDeleteSelectedRoundsDialog = useCallback(() => {
    if (selectedRoundIds.size === 0 || isSavingEdit) return;
    const selectedRounds = rounds.filter((round) => selectedRoundIds.has(round.id));
    if (selectedRounds.length === 0) return;
    setDeleteSelectedRoundsDialog({
      ids: selectedRounds.map((round) => round.id),
      names: selectedRounds.map((round) => round.name),
      filterContext: buildActiveFilterContext(),
    });
  }, [buildActiveFilterContext, isSavingEdit, rounds, selectedRoundIds]);

  const confirmDeleteSelectedRounds = useCallback(async () => {
    if (!deleteSelectedRoundsDialog || isSavingEdit) return;
    const idsToDelete = deleteSelectedRoundsDialog.ids;
    const idsToDeleteSet = new Set(idsToDelete);
    setDeleteSelectedRoundsDialog(null);
    setIsSavingEdit(true);
    try {
      const result = await db.round.deleteMany(idsToDelete);
      setEditingRound((current) => (current && idsToDeleteSet.has(current.id) ? null : current));
      setSelectedRoundIds((previous) => {
        const next = new Set(previous);
        for (const id of idsToDeleteSet) next.delete(id);
        return next;
      });
      setSelectedHeroIds(new Set());
      await refreshLibrary();
      showToast(t`Deleted ${result.deletedCount} rounds.`, "success");
    } catch (error) {
      console.error("Failed to delete selected rounds", error);
      showToast(
        error instanceof Error ? error.message : t`Failed to delete selected rounds.`,
        "error"
      );
    } finally {
      setIsSavingEdit(false);
    }
  }, [deleteSelectedRoundsDialog, isSavingEdit, refreshLibrary, showToast, t]);

  const openExportDatabaseDialog = useCallback(() => {
    if (isExportingDatabase || isStartingScan || isLibraryScanning) return;
    setExportDialog({
      exportMode: selectedRoundIds.size > 0 || selectedHeroIds.size > 0 ? "selected" : "all",
      includeMedia: true,
      asFpack: false,
      compressionMode: null,
      compressionStrength: DEFAULT_EXPORT_COMPRESSION_STRENGTH,
      result: null,
      error: null,
    });
  }, [isExportingDatabase, isStartingScan, isLibraryScanning, selectedHeroIds, selectedRoundIds]);

  const exportInstalledDatabase = useCallback(async () => {
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
      setExportDialog((current) => (current ? { ...current, result: null, error: null } : current));
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
      setExportDialog((current) => (current ? { ...current, result, error: null } : current));
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
  }, [
    exportDialog,
    isExportingDatabase,
    isStartingScan,
    isLibraryScanning,
    selectedHeroIds,
    selectedRoundIds,
    t,
  ]);

  const abortLibraryExport = useCallback(async () => {
    if (isAbortingLibraryExport) return;
    setIsAbortingLibraryExport(true);
    try {
      const status = await db.install.abortExportPackage();
      setLibraryExportStatus(status);
    } catch (error) {
      console.error("Failed to abort library export", error);
      setIsAbortingLibraryExport(false);
    }
  }, [isAbortingLibraryExport]);

  const abortInstallImport = useCallback(async () => {
    if (!showInstallOverlay || isAbortingInstall) return;
    setIsAbortingInstall(true);
    try {
      await db.install.abortScan();
    } catch (error) {
      console.error("Failed to abort round import", error);
      setIsAbortingInstall(false);
    }
  }, [isAbortingInstall, showInstallOverlay]);

  const scanNow = useCallback(async () => {
    if (isStartingScan || isLibraryScanning) return;
    setIsStartingScan(true);
    try {
      await db.install.scanNow();
      await refreshLibrary();
    } catch (error) {
      console.error("Failed to scan install folders", error);
    } finally {
      setIsStartingScan(false);
    }
  }, [isLibraryScanning, isStartingScan, refreshLibrary]);

  const createLegacyPlaylistFromImport = useCallback(
    async (result: InstallFolderScanResult, playlistName: string) => {
      if (!result.legacyImport || result.legacyImport.orderedSlots.length === 0) return;
      const created = await playlists.create({
        name: playlistName,
        config: toLegacyPlaylistConfig(result.legacyImport.orderedSlots),
      });
      await playlists.setActive(created.id);
      await refreshLibrary();
    },
    [refreshLibrary]
  );

  const installRoundsFromFolder = useCallback(async () => {
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
      await refreshLibrary();
    } catch (error) {
      console.error("Failed to install rounds from selected folder", error);
    } finally {
      setShowInstallOverlay(false);
      setIsAbortingInstall(false);
      setIsStartingScan(false);
    }
  }, [isLibraryScanning, isStartingScan, refreshLibrary, showToast, t]);

  const importRoundsFromFile = useCallback(async () => {
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
        await refreshLibrary();
        showToast(result.feedback.message, result.feedback.variant);
        return;
      }
      if (result.kind === "playlist") {
        await refreshLibrary();
        showToast(result.feedback.message, result.feedback.variant);
        await routerNavigate({ to: "/playlist-workshop" });
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
  }, [
    isExportingDatabase,
    isLibraryScanning,
    isStartingScan,
    refreshLibrary,
    routerNavigate,
    showToast,
    t,
  ]);

  const selectWebsiteRoundFunscriptFile = useCallback(async () => {
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
  }, [actionButtonsDisabled, showToast, t]);

  const installWebsiteRound = useCallback(async () => {
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
      await refreshLibrary();
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
  }, [
    actionButtonsDisabled,
    refreshLibrary,
    t,
    websiteRoundFunscriptFileUri,
    websiteRoundFunscriptUrl,
    websiteRoundName,
    websiteRoundVideoUrl,
    websiteRoundVideoValidation,
  ]);

  const getEroScriptsInitialQuery = useCallback(() => {
    if (eroscriptsDialogContext === "edit-round") return editingRound?.name ?? queryInput;
    if (eroscriptsDialogContext === "edit-hero") return editingHero?.name ?? queryInput;
    if (eroscriptsDialogContext === "website-round")
      return websiteRoundName.trim() || websiteRoundVideoUrl.trim() || queryInput;
    return queryInput.trim() || query.trim();
  }, [
    editingHero?.name,
    editingRound?.name,
    eroscriptsDialogContext,
    query,
    queryInput,
    websiteRoundName,
    websiteRoundVideoUrl,
  ]);

  const attachEroScriptsFunscript = useCallback(
    async (result: { funscriptUri: string; filename: string }) => {
      if (eroscriptsDialogContext === "edit-round") {
        setEditingRound((prev) => (prev ? { ...prev, funscriptUri: result.funscriptUri } : prev));
        showToast(t`Funscript attached. Save the round to keep it.`, "success");
        return;
      }
      if (eroscriptsDialogContext === "edit-hero") {
        setEditingHero((prev) =>
          prev ? { ...prev, funscriptUri: result.funscriptUri, funscriptDirty: true } : prev
        );
        showToast(
          t`Funscript attached. Save the hero to apply it to all attached rounds.`,
          "success"
        );
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
    },
    [eroscriptsDialogContext, showToast, t]
  );

  const installEroScriptsRound = useCallback(
    async (input: EroScriptsRoundInstallInput) => {
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
        await refreshLibrary();
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
    },
    [actionButtonsDisabled, refreshLibrary, showToast, t]
  );

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
    [selectedHeroIds, selectedRoundIds]
  );

  const openHeroGroupRoundConversion = useCallback(
    (group: Extract<RoundRenderRow, { kind: "hero-group" }>) => {
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
    },
    []
  );

  const openHeroHardModeConversion = useCallback(
    (group: Extract<RoundRenderRow, { kind: "hero-group" }>) => {
      const heroId = group.rounds[0]?.heroId;
      if (!heroId || convertingHardModeHeroId) return;
      setHeroHardModeConversion({
        groupKey: group.groupKey,
        heroId,
        heroName: group.heroName,
        recalculateDifficulty: true,
      });
    },
    [convertingHardModeHeroId]
  );

  const confirmHeroHardModeConversion = useCallback(async () => {
    if (!heroHardModeConversion || convertingHardModeHeroId) return;

    setConvertingHardModeHeroId(heroHardModeConversion.heroId);
    try {
      const result = await db.hero.convertFunscriptToHardMode({
        heroId: heroHardModeConversion.heroId,
        recalculateDifficulty: heroHardModeConversion.recalculateDifficulty,
      });
      setHeroHardModeConversion(null);
      await refreshLibrary();
      const skippedLabel =
        result.skippedRounds === 0
          ? ""
          : result.skippedRounds === 1
            ? ` ${t`Skipped 1 round without a media resource.`}`
            : ` ${t`Skipped ${result.skippedRounds} rounds without media resources.`}`;
      showToast(
        `${t`Attached the hard-mode script to ${result.updatedResources} rounds.`}${skippedLabel}`,
        "success"
      );
    } catch (error) {
      console.error("Failed to convert the hero funscript to hard mode", error);
      showToast(
        error instanceof Error ? error.message : t`Failed to convert the legacy funscript.`,
        "error"
      );
    } finally {
      setConvertingHardModeHeroId(null);
    }
  }, [convertingHardModeHeroId, heroHardModeConversion, refreshLibrary, showToast, t]);

  const confirmRoundHardModeConversion = useCallback(async () => {
    if (!roundHardModeConversion || convertingHardModeRoundId) return;
    setConvertingHardModeRoundId(roundHardModeConversion.roundId);
    try {
      const result = await db.round.convertFunscriptToHardMode(
        roundHardModeConversion.roundId,
        roundHardModeConversion.recalculateDifficulty
      );
      setRoundHardModeConversion(null);
      await refreshLibrary();
      const scopeLabel =
        result.scope === "hero"
          ? t`Attached the hard-mode script to ${result.updatedResources} hero rounds.`
          : t`Attached the hard-mode script to this round.`;
      const skippedLabel =
        result.skippedRounds > 0
          ? ` ${t`Skipped ${result.skippedRounds} rounds without media resources.`}`
          : "";
      showToast(`${scopeLabel}${skippedLabel}`, "success");
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : t`Failed to convert the legacy funscript.`,
        "error"
      );
    } finally {
      setConvertingHardModeRoundId(null);
    }
  }, [convertingHardModeRoundId, refreshLibrary, roundHardModeConversion, showToast, t]);

  const revertHardModeForRound = useCallback(
    async (targetRound: RoundLibraryEntry) => {
      if (revertingHardModeRoundId) return;
      setRevertingHardModeRoundId(targetRound.id);
      try {
        const result = await db.round.revertHardModeFunscript(targetRound.id);
        await refreshLibrary();
        const message =
          result.scope === "hero"
            ? t`Restored the previous scripts on ${result.updatedResources} hero rounds.`
            : t`Restored this round's previous script.`;
        showToast(message, "success");
      } catch (error) {
        showToast(
          error instanceof Error ? error.message : t`Failed to restore the previous funscript.`,
          "error"
        );
      } finally {
        setRevertingHardModeRoundId(null);
      }
    },
    [refreshLibrary, revertingHardModeRoundId, showToast, t]
  );

  const confirmHeroGroupRoundConversion = useCallback(async () => {
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
      await refreshLibrary();
      reloadUiAfterHeroGroupConversion();
    } catch (error) {
      console.error("Failed to convert hero group back to a round", error);
      showToast(
        error instanceof Error ? error.message : t`Failed to convert hero group back to a round.`,
        "error"
      );
    } finally {
      setConvertingHeroGroupKey(null);
    }
  }, [heroGroupRoundConversion, refreshLibrary, showToast, t]);

  const saveRoundTemplateRepair = useCallback(async () => {
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
      await refreshLibrary();
    } catch (error) {
      console.error("Failed to repair template round", error);
      showToast(
        error instanceof Error ? error.message : t`Failed to repair template round.`,
        "error"
      );
    } finally {
      setIsSavingEdit(false);
    }
  }, [isSavingEdit, repairingTemplateRound, refreshLibrary, showToast, t]);

  const applySourceHeroToRepairDraft = useCallback(
    (sourceHeroId: string) => {
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
          return { ...assignment, installedRoundId: matched?.id ?? "" };
        });
        return { ...current, sourceHeroId, assignments: nextAssignments };
      });
    },
    [sourceHeroOptions]
  );

  const saveHeroTemplateRepair = useCallback(async () => {
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
      await refreshLibrary();
    } catch (error) {
      console.error("Failed to repair template hero", error);
      showToast(
        error instanceof Error ? error.message : t`Failed to repair template hero.`,
        "error"
      );
    } finally {
      setIsSavingEdit(false);
    }
  }, [isSavingEdit, repairingTemplateHero, refreshLibrary, showToast, t]);

  const toggleLegacyCheckpointSelection = useCallback((slotId: string) => {
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
  }, []);

  const toggleLegacyImportExclusion = useCallback((slotId: string) => {
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
  }, []);

  const createLegacyPlaylist = useCallback(async () => {
    if (!legacyPlaylistReview || legacyPlaylistReview.creating) return;
    const playlistName = legacyPlaylistReview.playlistName.trim() || t`Legacy Playlist`;
    const shouldCreatePlaylist = legacyPlaylistReview.createPlaylist;
    setLegacyPlaylistReview((current) =>
      current ? { ...current, playlistName, creating: true, error: null } : null
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
      await refreshLibrary();
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
          { status: result.status, legacyImport: result.legacyImport },
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
  }, [createLegacyPlaylistFromImport, legacyPlaylistReview, refreshLibrary, t]);

  // ─── Deep-link (?open=) consumption ─────────────────────────────────────────
  const consumedPaletteOpenRef = useRef<typeof search.open | null>(null);
  useEffect(() => {
    if (!search.open) {
      consumedPaletteOpenRef.current = null;
      return;
    }
    if (consumedPaletteOpenRef.current === search.open) return;
    consumedPaletteOpenRef.current = search.open;
    void navigate({ to: "/rounds", search: {}, replace: true });
    if (search.open === "install-web") {
      setWebsiteRoundDialogOpen(true);
      return;
    }
    void installRoundsFromFolder();
  }, [installRoundsFromFolder, navigate, search.open]);

  // ─── Loading / error flags ──────────────────────────────────────────────────
  const isInitialLibraryLoading = roundsQuery.isLoading && !roundsQuery.data;
  const hasInitialLibraryError = roundsQuery.isError && !roundsQuery.data;
  const isLibraryRefreshing = roundsQuery.isFetching && !isInitialLibraryLoading;
  const playlistGroupingLoading = groupMode === "playlist" && playlistsQuery.isLoading;

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
  const handleOpenRepairTemplateRound = useCallback((templateRound: RoundLibraryEntry) => {
    setRepairingTemplateRound({
      roundId: templateRound.id,
      roundName: templateRound.name,
      installedRoundId: "",
    });
  }, []);

  // ─── Scroll container ref (for the virtualized grid) ────────────────────────
  const [scrollContainer, setScrollContainer] = useState<HTMLDivElement | null>(null);
  const inspectedRound = useMemo(
    () => rounds.find((round) => round.id === inspectedRoundId) ?? null,
    [inspectedRoundId, rounds]
  );

  useEffect(() => {
    if (!inspectedRoundId) return;
    const closeInspector = (event: KeyboardEvent) => {
      if (event.key === "Escape") setInspectedRoundId(null);
    };
    window.addEventListener("keydown", closeInspector);
    return () => window.removeEventListener("keydown", closeInspector);
  }, [inspectedRoundId]);

  const deleteSelectedRoundCount = deleteSelectedRoundsDialog?.ids.length ?? 0;
  const deleteSelectedRoundExamples =
    deleteSelectedRoundsDialog?.names
      .slice(0, 3)
      .map((name) => abbreviateNsfwText(name, sfwMode))
      .join(", ") ?? "";
  const deleteSelectedRoundMessage = deleteSelectedRoundsDialog
    ? [
        t`Delete ${deleteSelectedRoundCount} selected round entries from the database?`,
        t`Files on disk will be left untouched. This cannot be undone from inside the app.`,
        deleteSelectedRoundsDialog.filterContext.length > 0
          ? t`Current filters: ${deleteSelectedRoundsDialog.filterContext.join(", ")}`
          : null,
        deleteSelectedRoundExamples ? t`Examples: ${deleteSelectedRoundExamples}` : null,
      ]
        .filter((entry): entry is string => Boolean(entry))
        .join("\n\n")
    : "";

  return (
    <div className="round-library-page relative min-h-screen overflow-hidden">
      <AnimatedBackground quality="minimal" />

      <div className="round-library-shell relative z-10 flex h-screen min-w-0 flex-col overflow-hidden">
        <header className="round-library-topbar shrink-0 border-b border-white/[0.07] bg-[#090a0e]/96 px-4 py-3 sm:px-6">
          <div className="mx-auto flex max-w-[1800px] items-center gap-3">
            <button
              type="button"
              aria-label={t`Back`}
              onClick={() => {
                handleSelectSfx();
                goBack();
              }}
              onMouseEnter={handleHoverSfx}
              className="round-library-icon-button"
            >
              ←
            </button>
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-3">
                <h1 className="app-theme-heading truncate text-xl font-black tracking-[-0.03em] sm:text-2xl">
                  <Trans>Installed Rounds</Trans>
                </h1>
                <span className="hidden font-[family-name:var(--font-jetbrains-mono)] text-[10px] uppercase tracking-[0.18em] text-zinc-500 sm:inline">
                  {filteredRounds.length} / {rounds.length}
                </span>
              </div>
              <p className="truncate text-xs text-zinc-500">
                <Trans>Your playable media library</Trans>
              </p>
            </div>
            {scanStatus?.state === "running" && <InstallScanStatusBadge status={scanStatus} />}
            <div className="relative">
              <button
                type="button"
                disabled={actionButtonsDisabled}
                onClick={() => {
                  setShowMoreMenu(false);
                  setShowInstallMenu((current) => !current);
                }}
                className="round-library-primary-action"
              >
                <span className="text-base">＋</span>
                <Trans>Install</Trans>
                <span className="text-[9px] text-cyan-200/60">▾</span>
              </button>
              {showInstallMenu && (
                <div className="round-library-command-menu right-0">
                  <CommandMenuButton
                    label={t`Install folder`}
                    description={t`Scan a folder for rounds`}
                    onClick={() => {
                      setShowInstallMenu(false);
                      void installRoundsFromFolder();
                    }}
                  />
                  <CommandMenuButton
                    label={t`Import file`}
                    description={t`Open a round or portable package`}
                    onClick={() => {
                      setShowInstallMenu(false);
                      void importRoundsFromFile();
                    }}
                  />
                  <CommandMenuButton
                    label={t`Install from web`}
                    description={t`Create a round from a public URL`}
                    onClick={() => {
                      setShowInstallMenu(false);
                      setWebsiteRoundDialogOpen(true);
                    }}
                  />
                  <CommandMenuButton
                    label={t`Search EroScripts`}
                    description={t`Find videos and funscripts`}
                    onClick={() => {
                      setShowInstallMenu(false);
                      setEroscriptsDialogContext("library");
                    }}
                  />
                </div>
              )}
            </div>
            <div className="relative">
              <button
                type="button"
                aria-label={t`More actions`}
                onClick={() => {
                  setShowInstallMenu(false);
                  setShowMoreMenu((current) => !current);
                }}
                className="round-library-icon-button"
              >
                •••
              </button>
              {showMoreMenu && (
                <div className="round-library-command-menu right-0">
                  <CommandMenuButton
                    label={t`Refresh library`}
                    onClick={() => {
                      setShowMoreMenu(false);
                      void refreshLibrary();
                    }}
                  />
                  <CommandMenuButton
                    label={t`Scan connected folders`}
                    onClick={() => {
                      setShowMoreMenu(false);
                      void scanNow();
                    }}
                  />
                  <CommandMenuButton
                    label={t`Export library`}
                    onClick={() => {
                      setShowMoreMenu(false);
                      openExportDatabaseDialog();
                    }}
                  />
                </div>
              )}
            </div>
          </div>
        </header>

        <div className="flex min-h-0 min-w-0 flex-1">
          <main className="flex min-w-0 flex-1 flex-col">
            <div ref={setScrollContainer} className="min-h-0 flex-1 overflow-y-auto">
              <div className="mx-auto w-full max-w-[1800px] px-4 pb-10 pt-4 sm:px-6">
                <LibrarySectionContent
                  queryInput={queryInput}
                  setQueryInput={setQueryInput}
                  setQuery={setQuery}
                  typeFilter={typeFilter}
                  setTypeFilter={setTypeFilter}
                  scriptFilter={scriptFilter}
                  setScriptFilter={setScriptFilter}
                  tagFilter={tagFilter}
                  setTagFilter={setTagFilter}
                  actorFilter={actorFilter}
                  setActorFilter={setActorFilter}
                  libraryFilter={libraryFilter}
                  setLibraryFilter={setLibraryFilter}
                  sourceFilter={sourceFilter}
                  setSourceFilter={setSourceFilter}
                  addedDateFilter={addedDateFilter}
                  setAddedDateFilter={setAddedDateFilter}
                  sortMode={sortMode}
                  updateSearch={updateSearch}
                  showDisabledRounds={showDisabledRounds}
                  metadataOptions={metadataOptions}
                  activeFilterCount={activeFilterCount}
                  hasActiveFilters={hasActiveFilters}
                  sortModeLabel={sortModeLabel}
                  groupModeLabel={groupModeLabel}
                  groupMode={groupMode}
                  playlistGroupingLoading={playlistGroupingLoading}
                  sfwMode={sfwMode}
                  handleHoverSfx={handleHoverSfx}
                  handleSelectSfx={handleSelectSfx}
                  isInitialLibraryLoading={isInitialLibraryLoading}
                  hasInitialLibraryError={hasInitialLibraryError}
                  isLibraryRefreshing={isLibraryRefreshing}
                  roundsQueryError={roundsQuery.error}
                  refreshLibrary={refreshLibrary}
                  standaloneRoundCount={standaloneRoundCount}
                  heroGroupCount={heroGroupCount}
                  roundsWithScriptCount={roundsWithScriptCount}
                  disabledRoundIdsSize={disabledRoundIds.size}
                  disabledIdsLoaded={disabledIdsQuery.isLoading === false}
                  actionButtonsDisabled={actionButtonsDisabled}
                  installRoundsFromFolder={installRoundsFromFolder}
                  importRoundsFromFile={importRoundsFromFile}
                  openWebsiteRoundDialog={() => setWebsiteRoundDialogOpen(true)}
                  openEroScriptsDialog={() => setEroscriptsDialogContext("library")}
                  openExportDatabaseDialog={openExportDatabaseDialog}
                  isExportingDatabase={isExportingDatabase}
                  selectionMode={selectionMode}
                  setSelectionMode={setSelectionMode}
                  selectedRoundIds={selectedRoundIds}
                  setSelectedRoundIds={setSelectedRoundIds}
                  selectedHeroIds={selectedHeroIds}
                  setSelectedHeroIds={setSelectedHeroIds}
                  filteredRounds={filteredRounds}
                  openBulkTagsDialog={() => setBulkTagsDialog({ mode: "add", tagsText: "" })}
                  openDeleteSelectedRoundsDialog={openDeleteSelectedRoundsDialog}
                  isSavingEdit={isSavingEdit}
                  renderRows={renderRows}
                  expandedGroupKeySet={expandedGroupKeySet}
                  setExpandedHeroGroups={setExpandedHeroGroups}
                  visibleGroupKeys={visibleGroupKeys}
                  allVisibleGroupsExpanded={allVisibleGroupsExpanded}
                  scrollContainer={scrollContainer}
                  setVisibleRoundIds={setVisibleRoundIds}
                  isLibraryScrolling={isLibraryScrolling}
                  onLibraryScrollingChange={setIsLibraryScrolling}
                  cardAssetsByRoundId={cardAssetsByRoundId}
                  handlePlayRound={handlePlayRound}
                  websiteVideoScanStatusRunning={isWebsiteVideoCaching}
                  getDownloadProgressForVideoUri={getDownloadProgressForVideoUri}
                  disabledRoundIds={disabledRoundIds}
                  selectionToggle={(round) => {
                    handleSelectSfx();
                    setSelectedRoundIds((prev) => {
                      const next = new Set(prev);
                      if (next.has(round.id)) next.delete(round.id);
                      else next.add(round.id);
                      return next;
                    });
                  }}
                  renderHeroGroupHeader={(row) => (
                    <HeroGroupHeaderShell
                      row={row}
                      expandedGroupKeySet={expandedGroupKeySet}
                      setExpandedHeroGroups={setExpandedHeroGroups}
                      convertingHeroGroupKey={convertingHeroGroupKey}
                      convertingHardModeHeroId={convertingHardModeHeroId}
                      cardAssetsByRoundId={cardAssetsByRoundId}
                      websiteVideoScanStatusRunning={isWebsiteVideoCaching}
                      selectionMode={selectionMode}
                      selectedRoundIds={selectedRoundIds}
                      selectedHeroIds={selectedHeroIds}
                      toggleHeroGroupSelection={toggleHeroGroupSelection}
                      openHeroGroupRoundConversion={openHeroGroupRoundConversion}
                      openHeroHardModeConversion={openHeroHardModeConversion}
                      revertHardModeForRound={revertHardModeForRound}
                      revertingHardModeRoundId={revertingHardModeRoundId}
                      editHeroEntry={editHeroEntry}
                      deleteHeroEntry={deleteHeroEntry}
                      handleRetryTemplateLinkingForHero={handleRetryTemplateLinkingForHero}
                      setRepairingTemplateHero={setRepairingTemplateHero}
                      handleHoverSfx={handleHoverSfx}
                      handleSelectSfx={handleSelectSfx}
                    />
                  )}
                  renderPlaylistGroupHeader={(row) => (
                    <PlaylistGroupHeaderShell
                      row={row}
                      expandedGroupKeySet={expandedGroupKeySet}
                      setExpandedHeroGroups={setExpandedHeroGroups}
                      cardAssetsByRoundId={cardAssetsByRoundId}
                      websiteVideoScanStatusRunning={isWebsiteVideoCaching}
                      handleHoverSfx={handleHoverSfx}
                      handleSelectSfx={handleSelectSfx}
                    />
                  )}
                  showFilterTray={showFilterTray}
                  setShowFilterTray={setShowFilterTray}
                  inspectedRoundId={inspectedRoundId}
                  inspectRound={setInspectedRoundId}
                />
              </div>
            </div>
          </main>

          {inspectedRound && (
            <RoundInspector
              round={inspectedRound}
              cardAssets={cardAssetsByRoundId.get(inspectedRound.id)}
              disabled={disabledRoundIds.has(inspectedRound.id)}
              onClose={() => setInspectedRoundId(null)}
              onPlay={() => handlePlayRound(inspectedRound)}
              onEdit={() => handleEditRound(inspectedRound)}
              onConvert={() => handleConvertRoundToHero(inspectedRound)}
              onConvertHardMode={() =>
                setRoundHardModeConversion({
                  roundId: inspectedRound.id,
                  roundName: inspectedRound.name,
                  heroName: inspectedRound.hero?.name ?? null,
                  recalculateDifficulty: true,
                })
              }
              onRevertHardMode={() => void revertHardModeForRound(inspectedRound)}
              revertingHardMode={revertingHardModeRoundId !== null}
              onRepair={() => handleOpenRepairTemplateRound(inspectedRound)}
              onRetry={() => void handleRetryTemplateLinkingForRound(inspectedRound)}
              onDelete={() =>
                setDeleteRoundDialog({ id: inspectedRound.id, name: inspectedRound.name })
              }
            />
          )}
        </div>
      </div>

      {/* ─── Overlays ─────────────────────────────────────────────────────────── */}
      {showInstallOverlay && (
        <InstallImportOverlay isAborting={isAbortingInstall} onAbort={abortInstallImport} />
      )}
      <WebsiteRoundInstallDialog
        open={websiteRoundDialogOpen}
        roundName={websiteRoundName}
        videoUrl={websiteRoundVideoUrl}
        funscriptUrl={websiteRoundFunscriptUrl}
        funscriptFileLabel={websiteRoundFunscriptFileLabel}
        isSettingsLoading={webInstallSettingsLoading}
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
          setEroscriptsDialogContext("website-round");
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
          eroscriptsDialogContext === "edit-round"
            ? editingRound?.funscriptUri
            : eroscriptsDialogContext === "edit-hero"
              ? editingHero?.funscriptUri
              : null
        }
        onClose={() => setEroscriptsDialogContext(null)}
        onAttachFunscript={
          eroscriptsDialogContext === "edit-round" ||
          eroscriptsDialogContext === "edit-hero" ||
          eroscriptsDialogContext === "website-round"
            ? attachEroScriptsFunscript
            : undefined
        }
        onInstallRound={installEroScriptsRound}
      />
      {activePreviewRound && <RoundVideoOverlay {...previewOverlayProps} />}

      {/* ─── Dialogs ──────────────────────────────────────────────────────────── */}
      {editingRound && (
        <EditRoundDialog
          draft={editingRound}
          disabled={isSavingEdit}
          onClose={() => !isSavingEdit && setEditingRound(null)}
          onChange={(updater) => setEditingRound((prev) => (prev ? updater(prev) : prev))}
          onSubmit={() => void saveRoundEdit()}
          onDestructiveAction={deleteRoundEntry}
          onEroScriptsRequest={(ctx) => {
            handleSelectSfx();
            setEroscriptsDialogContext(ctx);
          }}
        />
      )}
      {bulkTagsDialog && (
        <BulkTagsDialog
          state={bulkTagsDialog}
          selectedCount={selectedRoundIds.size}
          disabled={isSavingEdit}
          onClose={() => setBulkTagsDialog(null)}
          onChange={(updater) => setBulkTagsDialog((prev) => (prev ? updater(prev) : prev))}
          onSubmit={() => void confirmBulkTagsEdit()}
        />
      )}
      {heroGroupRoundConversion && (
        <HeroGroupConversionDialog
          state={heroGroupRoundConversion}
          disabled={convertingHeroGroupKey === heroGroupRoundConversion.groupKey}
          onClose={() => {
            if (convertingHeroGroupKey === heroGroupRoundConversion.groupKey) return;
            setHeroGroupRoundConversion(null);
          }}
          onChange={(updater) =>
            setHeroGroupRoundConversion((prev) => (prev ? updater(prev) : prev))
          }
          onSubmit={() => void confirmHeroGroupRoundConversion()}
        />
      )}
      {editingHero && (
        <EditHeroDialog
          draft={editingHero}
          disabled={isSavingEdit}
          onClose={() => !isSavingEdit && setEditingHero(null)}
          onChange={(updater) => setEditingHero((prev) => (prev ? updater(prev) : prev))}
          onSubmit={() => void saveHeroEdit()}
          onDestructiveAction={() => deleteHeroEntry()}
          onEroScriptsRequest={(ctx) => {
            handleSelectSfx();
            setEroscriptsDialogContext(ctx);
          }}
        />
      )}
      {repairingTemplateRound && (
        <RepairTemplateRoundDialog
          state={repairingTemplateRound}
          rounds={rounds}
          disabled={isSavingEdit}
          onClose={() => !isSavingEdit && setRepairingTemplateRound(null)}
          onChange={(updater) => setRepairingTemplateRound((prev) => (prev ? updater(prev) : prev))}
          onSubmit={() => void saveRoundTemplateRepair()}
        />
      )}
      {repairingTemplateHero && (
        <RepairTemplateHeroDialog
          state={repairingTemplateHero}
          sourceHeroOptions={sourceHeroOptions}
          disabled={isSavingEdit}
          onClose={() => !isSavingEdit && setRepairingTemplateHero(null)}
          onChange={(updater) => setRepairingTemplateHero((prev) => (prev ? updater(prev) : prev))}
          onApplySourceHero={applySourceHeroToRepairDraft}
          onSubmit={() => void saveHeroTemplateRepair()}
        />
      )}
      {legacyPlaylistReview && (
        <LegacyPlaylistReviewDialog
          state={legacyPlaylistReview}
          onClose={() => {
            if (legacyPlaylistReview.creating) return;
            setLegacyPlaylistReview(null);
          }}
          onChange={(updater) => setLegacyPlaylistReview((prev) => (prev ? updater(prev) : prev))}
          onToggleCheckpoint={toggleLegacyCheckpointSelection}
          onToggleExclusion={toggleLegacyImportExclusion}
          onSubmit={() => void createLegacyPlaylist()}
        />
      )}
      {exportDialog && (
        <LibraryExportDialog
          state={exportDialog}
          exporting={isExportingDatabase}
          onClose={() => {
            if (isExportingDatabase) return;
            setExportDialog(null);
          }}
          onChange={(updater) =>
            setExportDialog((current) => {
              if (!current) return current;
              return typeof updater === "function" ? updater(current) : updater;
            })
          }
          onSubmit={() => void exportInstalledDatabase()}
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
          onAbort={() => void abortLibraryExport()}
        />
      )}
      <ConfirmDialog
        isOpen={heroHardModeConversion !== null}
        title={t`Convert Legacy Script to Hard Mode?`}
        message={t`Convert the attached script from “${heroHardModeConversion?.heroName ?? ""}” and attach the generated script to every resource-backed round in the hero?\n\nOnly use this on a legacy half-stroke script. The current attachment may be local or remote and will remain unchanged. Existing funscript attachments for this hero will be replaced.`}
        confirmLabel={t`Convert and Attach`}
        variant="warning"
        isPending={convertingHardModeHeroId !== null}
        onConfirm={() => void confirmHeroHardModeConversion()}
        onCancel={() => {
          if (convertingHardModeHeroId) return;
          setHeroHardModeConversion(null);
        }}
      >
        <label className="mt-4 flex items-start gap-3 rounded-xl border border-amber-300/20 bg-amber-500/10 p-3 text-sm text-zinc-200">
          <input
            type="checkbox"
            checked={heroHardModeConversion?.recalculateDifficulty ?? true}
            disabled={convertingHardModeHeroId !== null}
            onChange={(event) =>
              setHeroHardModeConversion((current) =>
                current ? { ...current, recalculateDifficulty: event.target.checked } : current
              )
            }
            className="mt-0.5 h-4 w-4 rounded border-amber-300/40 bg-black/45 text-amber-400 focus:ring-amber-400/60"
          />
          <span>
            {t`Recalculate the difficulty of affected rounds from the converted hard-mode script`}
          </span>
        </label>
      </ConfirmDialog>
      <ConfirmDialog
        isOpen={roundHardModeConversion !== null}
        title={t`Convert Legacy Script to Hard Mode?`}
        message={
          roundHardModeConversion?.heroName
            ? t`Convert the script attached to “${roundHardModeConversion.roundName}”? Because this round belongs to “${roundHardModeConversion.heroName}”, the generated script will replace the primary funscript attachment on every resource-backed round in that hero.\n\nOnly use this on a legacy half-stroke script. The current local or remote source will remain unchanged.`
            : t`Convert the script attached to “${roundHardModeConversion?.roundName ?? ""}” and replace this round's primary funscript attachment?\n\nOnly use this on a legacy half-stroke script. The current local or remote source will remain unchanged.`
        }
        confirmLabel={t`Convert and Attach`}
        variant="warning"
        isPending={convertingHardModeRoundId !== null}
        onConfirm={() => void confirmRoundHardModeConversion()}
        onCancel={() => {
          if (convertingHardModeRoundId) return;
          setRoundHardModeConversion(null);
        }}
      >
        <label className="mt-4 flex items-start gap-3 rounded-xl border border-amber-300/20 bg-amber-500/10 p-3 text-sm text-zinc-200">
          <input
            type="checkbox"
            checked={roundHardModeConversion?.recalculateDifficulty ?? true}
            disabled={convertingHardModeRoundId !== null}
            onChange={(event) =>
              setRoundHardModeConversion((current) =>
                current ? { ...current, recalculateDifficulty: event.target.checked } : current
              )
            }
            className="mt-0.5 h-4 w-4 rounded border-amber-300/40 bg-black/45 text-amber-400 focus:ring-amber-400/60"
          />
          <span>
            {t`Recalculate the difficulty of affected rounds from the converted hard-mode script`}
          </span>
        </label>
      </ConfirmDialog>
      <ConfirmDialog
        isOpen={deleteRoundDialog !== null}
        title={t`Delete Round?`}
        message={t`Delete round entry \u201C${deleteRoundDialog?.name ?? ""}\u201D from the database?\n\nThis removes only the database entry. Files on disk will be left untouched.`}
        confirmLabel={t`Delete Round`}
        variant="danger"
        onConfirm={() => void confirmDeleteRound()}
        onCancel={() => setDeleteRoundDialog(null)}
      />
      <ConfirmDialog
        isOpen={deleteSelectedRoundsDialog !== null}
        title={t`Delete Selected Rounds?`}
        message={deleteSelectedRoundMessage}
        confirmLabel={t`Delete ${deleteSelectedRoundCount} Rounds`}
        variant="danger"
        isPending={isSavingEdit}
        onConfirm={() => void confirmDeleteSelectedRounds()}
        onCancel={() => setDeleteSelectedRoundsDialog(null)}
      />
      <ConfirmDialog
        isOpen={deleteHeroDialog !== null}
        title={t`Delete Hero?`}
        message={t`Delete hero entry \u201C${deleteHeroDialog?.name ?? ""}\u201D from the database?\n\nThis also permanently deletes all attached rounds from the database. Files on disk will be left untouched.`}
        confirmLabel={t`Delete Hero`}
        variant="danger"
        onConfirm={() => void confirmDeleteHero()}
        onCancel={() => setDeleteHeroDialog(null)}
      />
    </div>
  );
}

function CommandMenuButton({
  label,
  description,
  onClick,
}: {
  label: string;
  description?: string;
  onClick: () => void;
}) {
  return (
    <button type="button" onClick={onClick} className="round-library-command-item">
      <span className="font-semibold text-zinc-100">{label}</span>
      {description && <span className="mt-0.5 text-[11px] text-zinc-600">{description}</span>}
    </button>
  );
}

function RoundInspector({
  round,
  cardAssets,
  disabled,
  onClose,
  onPlay,
  onEdit,
  onConvert,
  onConvertHardMode,
  onRevertHardMode,
  revertingHardMode,
  onRepair,
  onRetry,
  onDelete,
}: {
  round: RoundLibraryEntry;
  cardAssets?: import("@/services/db").InstalledRoundCardAssets;
  disabled: boolean;
  onClose: () => void;
  onPlay: () => void;
  onEdit: () => void;
  onConvert: () => void;
  onConvertHardMode: () => void;
  onRevertHardMode: () => void;
  revertingHardMode: boolean;
  onRepair: () => void;
  onRetry: () => void;
  onDelete: () => void;
}) {
  const { t } = useLingui();
  const previewImage = cardAssets?.previewImage ?? null;
  const isTemplate = isTemplateRound(round);
  const hasScript = roundHasFunscript(round);
  const author = round.author ?? round.hero?.name ?? t`Unknown creator`;

  return (
    <aside
      aria-label={t`Round details`}
      className="round-library-inspector fixed inset-x-0 bottom-0 z-[80] max-h-[82vh] overflow-y-auto border-t border-white/10 shadow-2xl lg:static lg:z-20 lg:h-full lg:max-h-none lg:w-[370px] lg:shrink-0 lg:border-l lg:border-t-0"
    >
      <div className="round-library-inspector-header sticky top-0 z-10 flex items-center justify-between border-b border-white/[0.06] px-4 py-3">
        <span className="font-[family-name:var(--font-jetbrains-mono)] text-[10px] uppercase tracking-[0.18em] text-zinc-500">
          <Trans>Round details</Trans>
        </span>
        <button
          type="button"
          aria-label={t`Close details`}
          onClick={onClose}
          className="round-library-icon-button h-8 w-8"
        >
          ×
        </button>
      </div>

      <div className="p-4">
        <div className="relative aspect-video overflow-hidden rounded-2xl bg-[#11141a]">
          {previewImage ? (
            <img src={previewImage} alt="" className="h-full w-full object-cover" />
          ) : (
            <div className="grid h-full place-items-center text-xs text-zinc-600">
              <Trans>No preview available</Trans>
            </div>
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent" />
          <button type="button" onClick={onPlay} className="round-poster-play z-20">
            ▶
          </button>
        </div>

        <div className="mt-4">
          <div className="flex flex-wrap gap-1.5">
            <span className="round-poster-badge">{round.type ?? "Normal"}</span>
            <span className={`round-poster-badge ${hasScript ? "is-ready" : ""}`}>
              {hasScript ? t`Script ready` : t`No script`}
            </span>
            {disabled && <span className="round-poster-badge is-danger">{t`Disabled`}</span>}
            {round.excludeFromRandom && <span className="round-poster-badge">{t`Excluded`}</span>}
          </div>
          <h2 className="mt-3 text-2xl font-black leading-tight tracking-[-0.03em] text-white">
            {round.name}
          </h2>
          <p className="mt-1 text-sm text-zinc-500">{author}</p>
          <p className="mt-4 text-sm leading-6 text-zinc-300">
            {round.description ?? t`No description`}
          </p>
        </div>

        <dl className="mt-5 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-white/[0.06] bg-white/[0.06]">
          <InspectorMetric label={t`BPM`} value={round.bpm ? Math.round(round.bpm) : "—"} />
          <InspectorMetric label={t`Difficulty`} value={`${round.difficulty ?? 1}/5`} />
          <InspectorMetric
            label={t`Start`}
            value={`${Math.round((round.startTime ?? 0) / 1000)}s`}
          />
          <InspectorMetric
            label={t`End`}
            value={round.endTime ? `${Math.round(round.endTime / 1000)}s` : "—"}
          />
          <InspectorMetric label={t`Installed`} value={formatDate(round.createdAt)} />
          <InspectorMetric label={t`Source`} value={round.installSourceKey ?? t`Local`} />
        </dl>

        {round.tags.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-1.5">
            {round.tags.map((tag) => (
              <span
                key={tag}
                className="rounded-md bg-white/[0.05] px-2 py-1 text-[11px] text-zinc-400"
              >
                {tag}
              </span>
            ))}
          </div>
        )}

        <div className="mt-5 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={onPlay}
            className="round-library-primary-action justify-center"
          >
            ▶ <Trans>Play</Trans>
          </button>
          <button
            type="button"
            onClick={onEdit}
            className="round-library-toolbar-button justify-center"
          >
            <Trans>Edit round</Trans>
          </button>
          {!round.heroId && !round.hero && (
            <button
              type="button"
              onClick={onConvert}
              className="round-library-toolbar-button col-span-2 justify-center"
            >
              <Trans>Convert to hero</Trans>
            </button>
          )}
          {hasScript && !isTemplate && (
            <>
              <button
                type="button"
                onClick={onConvertHardMode}
                className="round-library-toolbar-button col-span-2 justify-center"
              >
                <Trans>Convert legacy script to hard mode</Trans>
              </button>
              <button
                type="button"
                onClick={onRevertHardMode}
                disabled={revertingHardMode}
                className="round-library-toolbar-button col-span-2 justify-center"
              >
                {revertingHardMode ? (
                  <Trans>Restoring previous script…</Trans>
                ) : (
                  <Trans>Restore previous script</Trans>
                )}
              </button>
            </>
          )}
          {isTemplate && (
            <>
              <button type="button" onClick={onRepair} className="round-library-toolbar-button">
                <Trans>Repair template</Trans>
              </button>
              <button type="button" onClick={onRetry} className="round-library-toolbar-button">
                <Trans>Retry auto-link</Trans>
              </button>
            </>
          )}
          <button
            type="button"
            onClick={onDelete}
            className="round-library-toolbar-button is-danger col-span-2 justify-center"
          >
            <Trans>Delete round</Trans>
          </button>
        </div>

        <details className="mt-5 border-t border-white/[0.06] pt-4 text-xs text-zinc-600">
          <summary className="cursor-pointer font-semibold text-zinc-500">
            <Trans>Technical details</Trans>
          </summary>
          <div className="mt-3 space-y-2 break-all font-[family-name:var(--font-jetbrains-mono)] text-[10px]">
            <p>{round.id}</p>
            <p>{round.phash ?? t`No round hash`}</p>
          </div>
        </details>
      </div>
    </aside>
  );
}

function InspectorMetric({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="bg-[#0d0f14] px-3 py-2.5">
      <dt className="font-[family-name:var(--font-jetbrains-mono)] text-[9px] uppercase tracking-[0.14em] text-zinc-600">
        {label}
      </dt>
      <dd className="mt-1 truncate text-sm font-semibold text-zinc-200">{value}</dd>
    </div>
  );
}

// ─── Sub-components for library + transfer sections ───────────────────────────

type LibrarySectionProps = {
  // filters
  queryInput: string;
  setQueryInput: (v: string) => void;
  setQuery: (v: string) => void;
  typeFilter: TypeFilter;
  setTypeFilter: (v: TypeFilter) => void;
  scriptFilter: ScriptFilter;
  setScriptFilter: (v: ScriptFilter) => void;
  tagFilter: MetadataFilter;
  setTagFilter: (v: MetadataFilter) => void;
  actorFilter: MetadataFilter;
  setActorFilter: (v: MetadataFilter) => void;
  libraryFilter: MetadataFilter;
  setLibraryFilter: (v: MetadataFilter) => void;
  sourceFilter: SourceFilter;
  setSourceFilter: (v: SourceFilter) => void;
  addedDateFilter: AddedDateFilter;
  setAddedDateFilter: Dispatch<SetStateAction<AddedDateFilter>>;
  sortMode: SortMode;
  updateSearch: (patch: Record<string, unknown>) => void;
  showDisabledRounds: boolean;
  metadataOptions: { tags: string[]; authorNames: string[]; libraryLabels: string[] };
  activeFilterCount: number;
  hasActiveFilters: boolean;
  sortModeLabel: string;
  groupModeLabel: string;
  groupMode: GroupMode;
  playlistGroupingLoading: boolean;
  sfwMode: boolean;
  handleHoverSfx: () => void;
  handleSelectSfx: () => void;
  isInitialLibraryLoading: boolean;
  hasInitialLibraryError: boolean;
  isLibraryRefreshing: boolean;
  roundsQueryError: unknown;
  refreshLibrary: () => Promise<void>;
  standaloneRoundCount: number;
  heroGroupCount: number;
  roundsWithScriptCount: number;
  disabledRoundIdsSize: number;
  disabledIdsLoaded: boolean;
  actionButtonsDisabled: boolean;
  installRoundsFromFolder: () => Promise<void>;
  importRoundsFromFile: () => Promise<void>;
  openWebsiteRoundDialog: () => void;
  openEroScriptsDialog: () => void;
  openExportDatabaseDialog: () => void;
  isExportingDatabase: boolean;
  selectionMode: boolean;
  setSelectionMode: (v: boolean | ((prev: boolean) => boolean)) => void;
  selectedRoundIds: Set<string>;
  setSelectedRoundIds: (v: Set<string> | ((prev: Set<string>) => Set<string>)) => void;
  selectedHeroIds: Set<string>;
  setSelectedHeroIds: (v: Set<string> | ((prev: Set<string>) => Set<string>)) => void;
  filteredRounds: RoundLibraryEntry[];
  openBulkTagsDialog: () => void;
  openDeleteSelectedRoundsDialog: () => void;
  isSavingEdit: boolean;
  renderRows: RoundRenderRow[];
  expandedGroupKeySet: Set<string>;
  setExpandedHeroGroups: (
    v: Record<string, boolean> | ((prev: Record<string, boolean>) => Record<string, boolean>)
  ) => void;
  visibleGroupKeys: string[];
  allVisibleGroupsExpanded: boolean;
  scrollContainer: HTMLElement | null;
  setVisibleRoundIds: (v: string[]) => void;
  isLibraryScrolling: boolean;
  onLibraryScrollingChange: (isScrolling: boolean) => void;
  cardAssetsByRoundId: ReadonlyMap<string, import("@/services/db").InstalledRoundCardAssets>;
  handlePlayRound: (round: RoundLibraryEntry) => void;
  websiteVideoScanStatusRunning: boolean;
  getDownloadProgressForVideoUri: (
    uri: string | null | undefined
  ) => import("@/services/db").VideoDownloadProgress | null;
  disabledRoundIds: Set<string>;
  selectionToggle: (round: RoundLibraryEntry) => void;
  renderHeroGroupHeader: (row: Extract<RoundRenderRow, { kind: "hero-group" }>) => ReactNode;
  renderPlaylistGroupHeader: (
    row: Extract<RoundRenderRow, { kind: "playlist-group" }>
  ) => ReactNode;
  showFilterTray: boolean;
  setShowFilterTray: (show: boolean) => void;
  inspectedRoundId: string | null;
  inspectRound: (roundId: string | null) => void;
};

function LibrarySectionContent(props: LibrarySectionProps) {
  const { t } = useLingui();
  const {
    queryInput,
    setQueryInput,
    setQuery,
    typeFilter,
    setTypeFilter,
    scriptFilter,
    setScriptFilter,
    tagFilter,
    setTagFilter,
    actorFilter,
    setActorFilter,
    libraryFilter,
    setLibraryFilter,
    sourceFilter,
    setSourceFilter,
    addedDateFilter,
    setAddedDateFilter,
    sortMode,
    updateSearch,
    showDisabledRounds,
    metadataOptions,
    activeFilterCount,
    hasActiveFilters,
    sortModeLabel,
    groupModeLabel,
    groupMode,
    playlistGroupingLoading,
    sfwMode,
    handleHoverSfx,
    handleSelectSfx,
    isInitialLibraryLoading,
    hasInitialLibraryError,
    isLibraryRefreshing,
    roundsQueryError,
    refreshLibrary,
    standaloneRoundCount,
    heroGroupCount,
    roundsWithScriptCount,
    disabledRoundIdsSize,
    disabledIdsLoaded,
    actionButtonsDisabled,
    installRoundsFromFolder,
    importRoundsFromFile,
    openWebsiteRoundDialog,
    openEroScriptsDialog,
    openExportDatabaseDialog,
    isExportingDatabase,
    selectionMode,
    setSelectionMode,
    selectedRoundIds,
    setSelectedRoundIds,
    selectedHeroIds,
    setSelectedHeroIds,
    filteredRounds,
    openBulkTagsDialog,
    openDeleteSelectedRoundsDialog,
    isSavingEdit,
    renderRows,
    expandedGroupKeySet,
    setExpandedHeroGroups,
    visibleGroupKeys,
    allVisibleGroupsExpanded,
    scrollContainer,
    setVisibleRoundIds,
    isLibraryScrolling,
    onLibraryScrollingChange,
    cardAssetsByRoundId,
    handlePlayRound,
    websiteVideoScanStatusRunning,
    getDownloadProgressForVideoUri,
    disabledRoundIds,
    selectionToggle,
    renderHeroGroupHeader,
    renderPlaylistGroupHeader,
    showFilterTray,
    setShowFilterTray,
    inspectedRoundId,
    inspectRound,
  } = props;

  return (
    <div className="relative space-y-4">
      <div className="round-library-sticky-toolbar sticky top-0 z-40 -mx-2 flex flex-wrap items-center gap-2 border-b border-white/[0.06] px-2 py-3 backdrop-blur-md">
        <div className="relative min-w-[15rem] flex-1">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-600">
            ⌕
          </span>
          <input
            aria-label={t`Search installed rounds`}
            value={queryInput}
            onChange={(event) => {
              setQueryInput(event.target.value);
              setQuery(event.target.value);
            }}
            placeholder={t`Search rounds, heroes, authors…`}
            className="h-10 w-full rounded-xl border border-white/[0.08] bg-white/[0.04] pl-9 pr-3 text-sm text-zinc-100 outline-none transition focus:border-cyan-300/40 focus:bg-white/[0.06]"
          />
        </div>
        <button
          type="button"
          onClick={() => setShowFilterTray(!showFilterTray)}
          className={`round-library-toolbar-button ${showFilterTray || activeFilterCount > 0 ? "is-active" : ""}`}
        >
          <Trans>Filters</Trans>
          {activeFilterCount > 0 && (
            <span className="round-library-count-badge">{activeFilterCount}</span>
          )}
        </button>
        <div className="flex rounded-xl border border-white/[0.08] bg-white/[0.03] p-1">
          {(["hero", "playlist"] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              disabled={mode === "playlist" && playlistGroupingLoading}
              onClick={() => updateSearch({ groupMode: mode })}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                groupMode === mode ? "bg-white/10 text-white" : "text-zinc-500 hover:text-zinc-200"
              }`}
            >
              {mode === "hero" ? t`Heroes` : t`Playlists`}
            </button>
          ))}
        </div>
        <select
          aria-label={t`Sort rounds`}
          value={sortMode}
          onChange={(event) => updateSearch({ sortMode: event.target.value as SortMode })}
          className="round-library-native-select"
        >
          <option value="newest">{t`Newest`}</option>
          <option value="oldest">{t`Oldest`}</option>
          <option value="difficulty">{t`Difficulty`}</option>
          <option value="bpm">{t`BPM`}</option>
          <option value="length">{t`Length`}</option>
          <option value="name">{t`Name`}</option>
          <option value="excluded">{t`Excluded`}</option>
        </select>
        <button
          type="button"
          onClick={() => {
            setSelectionMode(!selectionMode);
            if (selectionMode) {
              setSelectedRoundIds(new Set());
              setSelectedHeroIds(new Set());
            }
          }}
          className={`round-library-toolbar-button ${selectionMode ? "is-active" : ""}`}
        >
          {selectionMode ? t`Done` : t`Select`}
        </button>
        <button
          type="button"
          aria-label={allVisibleGroupsExpanded ? t`Collapse groups` : t`Expand groups`}
          onClick={() =>
            setExpandedHeroGroups((previous) => {
              const next = { ...previous };
              for (const key of visibleGroupKeys) next[key] = !allVisibleGroupsExpanded;
              return next;
            })
          }
          className="round-library-icon-button"
        >
          {allVisibleGroupsExpanded ? "⇱" : "⇲"}
        </button>
      </div>

      {selectionMode && (
        <div className="round-library-selection-bar sticky top-[4.15rem] z-30 flex flex-wrap items-center gap-2 rounded-xl border px-3 py-2 shadow-xl">
          <span className="mr-auto text-sm font-semibold text-cyan-100">
            {t`${selectedRoundIds.size} rounds, ${selectedHeroIds.size} heroes selected`}
          </span>
          <button
            className="round-library-toolbar-button"
            onClick={() => setSelectedRoundIds(new Set(filteredRounds.map((round) => round.id)))}
          >
            <Trans>Select matching</Trans>
          </button>
          <button
            className="round-library-toolbar-button"
            disabled={selectedRoundIds.size === 0}
            onClick={openBulkTagsDialog}
          >
            <Trans>Edit tags</Trans>
          </button>
          <button
            className="round-library-toolbar-button"
            disabled={selectedRoundIds.size + selectedHeroIds.size === 0}
            onClick={openExportDatabaseDialog}
          >
            <Trans>Export</Trans>
          </button>
          <button
            className="round-library-toolbar-button is-danger"
            disabled={selectedRoundIds.size === 0}
            onClick={openDeleteSelectedRoundsDialog}
          >
            <Trans>Delete</Trans>
          </button>
        </div>
      )}

      {/* Snapshot panel */}
      <section className="hidden" style={{ animationDelay: "0.05s" }}>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h3 className="text-lg font-extrabold tracking-tight text-violet-100">
              <Trans>Library Snapshot</Trans>
            </h3>
            <p className="mt-1 text-sm text-zinc-300">
              <Trans>
                Keep the main browsing tools, collection health, and import actions in one place.
              </Trans>
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <ActionButton
              label={t`Install Rounds`}
              tone="violet"
              disabled={actionButtonsDisabled}
              onHover={handleHoverSfx}
              onClick={() => {
                handleSelectSfx();
                void installRoundsFromFolder();
              }}
            />
            <ActionButton
              label={t`Import File`}
              tone="emerald"
              disabled={actionButtonsDisabled}
              onHover={handleHoverSfx}
              onClick={() => {
                handleSelectSfx();
                void importRoundsFromFile();
              }}
            />
            <ActionButton
              label={t`Install From Web`}
              tone="violet"
              disabled={actionButtonsDisabled}
              onHover={handleHoverSfx}
              onClick={() => {
                handleSelectSfx();
                openWebsiteRoundDialog();
              }}
            />
            <ActionButton
              label={t`Search EroScripts`}
              tone="cyan"
              disabled={actionButtonsDisabled}
              onHover={handleHoverSfx}
              onClick={() => {
                handleSelectSfx();
                openEroScriptsDialog();
              }}
            />
            <ActionButton
              label={isExportingDatabase ? t`Exporting...` : t`Export`}
              tone="cyan"
              disabled={actionButtonsDisabled}
              onHover={handleHoverSfx}
              onClick={() => {
                handleSelectSfx();
                openExportDatabaseDialog();
              }}
            />
            <ActionButton
              label={selectionMode ? t`Cancel Selection` : t`Select Items`}
              tone="violet"
              onHover={handleHoverSfx}
              onClick={() => {
                handleSelectSfx();
                setSelectionMode((prev) => {
                  const next = !prev;
                  if (next === false) {
                    setSelectedRoundIds(new Set());
                    setSelectedHeroIds(new Set());
                  }
                  return next;
                });
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
                  setSelectionMode((prev) => {
                    const next = !prev;
                    if (!next) {
                      setSelectedRoundIds(new Set());
                      setSelectedHeroIds(new Set());
                    }
                    return next;
                  });
                }}
                className={`rounded-xl border px-4 py-2 font-[family-name:var(--font-jetbrains-mono)] text-xs uppercase tracking-[0.18em] transition-all duration-200 ${
                  selectionMode
                    ? "border-violet-300/60 bg-violet-500/25 text-violet-100"
                    : "border-slate-600 bg-slate-900/70 text-slate-300 hover:border-violet-300/40"
                }`}
              >
                {selectionMode ? t`Cancel Selection` : t`Select Items`}
              </button>
              {selectionMode && (
                <button
                  type="button"
                  disabled={filteredRounds.length === 0}
                  onMouseEnter={handleHoverSfx}
                  onClick={() => {
                    handleSelectSfx();
                    setSelectedRoundIds(new Set(filteredRounds.map((r) => r.id)));
                    setSelectedHeroIds(new Set());
                  }}
                  className={`rounded-xl border px-4 py-2 font-[family-name:var(--font-jetbrains-mono)] text-xs uppercase tracking-[0.18em] transition-all duration-200 ${
                    filteredRounds.length > 0
                      ? "border-cyan-300/50 bg-cyan-500/20 text-cyan-100 hover:border-cyan-200/75"
                      : "cursor-not-allowed border-zinc-700 bg-zinc-900/70 text-zinc-500"
                  }`}
                >
                  <Trans>Select Matching Rounds</Trans>
                </button>
              )}
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
                  <button
                    type="button"
                    disabled={selectedRoundIds.size === 0 || isSavingEdit}
                    onMouseEnter={handleHoverSfx}
                    onClick={() => {
                      handleSelectSfx();
                      openBulkTagsDialog();
                    }}
                    className={`rounded-xl border px-4 py-2 font-[family-name:var(--font-jetbrains-mono)] text-xs uppercase tracking-[0.18em] transition-all duration-200 ${
                      selectedRoundIds.size > 0 && !isSavingEdit
                        ? "border-emerald-300/55 bg-emerald-500/20 text-emerald-100 hover:border-emerald-200/80"
                        : "cursor-not-allowed border-zinc-700 bg-zinc-900/70 text-zinc-500"
                    }`}
                  >
                    <Trans>Edit Tags</Trans>
                  </button>
                  <button
                    type="button"
                    disabled={selectedRoundIds.size === 0 || isSavingEdit}
                    onMouseEnter={handleHoverSfx}
                    onClick={() => {
                      handleSelectSfx();
                      openDeleteSelectedRoundsDialog();
                    }}
                    className={`rounded-xl border px-4 py-2 font-[family-name:var(--font-jetbrains-mono)] text-xs uppercase tracking-[0.18em] transition-all duration-200 ${
                      selectedRoundIds.size > 0 && !isSavingEdit
                        ? "border-rose-300/55 bg-rose-500/20 text-rose-100 hover:border-rose-200/80"
                        : "cursor-not-allowed border-zinc-700 bg-zinc-900/70 text-zinc-500"
                    }`}
                  >
                    <Trans>Delete Selected</Trans>
                  </button>
                </>
              )}
            </div>
          )}
        </div>

        {isInitialLibraryLoading ? (
          <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            {Array.from({ length: 4 }, (_, index) => (
              <div key={index} className="rounded-2xl border border-zinc-700/60 bg-black/25 p-4">
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
              { label: t`Scripts Ready`, value: roundsWithScriptCount, tone: "emerald" },
              {
                label: t`Disabled`,
                value: disabledIdsLoaded ? disabledRoundIdsSize : "…",
                tone: "amber",
              },
            ]}
          />
        )}
      </section>

      {/* Filter bar / error / skeleton */}
      {isInitialLibraryLoading ? (
        <FilterSkeleton />
      ) : hasInitialLibraryError ? (
        <section className="animate-entrance rounded-3xl border border-rose-400/25 bg-zinc-950/55 p-5 backdrop-blur-xl">
          <div className="rounded-2xl border border-rose-400/30 bg-rose-500/10 p-8 text-center">
            <p className="font-[family-name:var(--font-jetbrains-mono)] text-sm uppercase tracking-[0.28em] text-rose-200">
              <Trans>Failed to load installed rounds</Trans>
            </p>
            <p className="mt-3 text-sm text-zinc-300">
              {roundsQueryError instanceof Error
                ? roundsQueryError.message
                : t`Failed to load installed rounds.`}
            </p>
            <div className="mt-5 flex justify-center">
              <ActionButton
                label={t`Retry`}
                tone="rose"
                onHover={handleHoverSfx}
                onClick={() => {
                  handleSelectSfx();
                  void refreshLibrary();
                }}
              />
            </div>
          </div>
        </section>
      ) : showFilterTray ? (
        <section className="rounded-2xl border border-white/[0.07] bg-[#0c0e13] p-4">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <h3 className="text-sm font-bold text-zinc-100">
                <Trans>Filter library</Trans>
              </h3>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-2 rounded-lg border border-zinc-700 bg-black/30 px-3 py-2 text-xs uppercase tracking-[0.18em] text-zinc-300">
                <input
                  type="checkbox"
                  checked={showDisabledRounds}
                  onChange={(event) => updateSearch({ showDisabled: event.target.checked })}
                />
                <Trans>Show Disabled Imports</Trans>
              </label>
              <button
                type="button"
                onMouseEnter={handleHoverSfx}
                onClick={() => {
                  handleSelectSfx();
                  setQueryInput("");
                  setQuery("");
                  setTypeFilter("all");
                  setScriptFilter("all");
                  setTagFilter("all");
                  setActorFilter("all");
                  setLibraryFilter("all");
                  setSourceFilter("all");
                  setAddedDateFilter({ mode: "all" });
                  updateSearch({ sortMode: "newest" });
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

          <div className="mt-5 grid grid-cols-1 gap-3 lg:grid-cols-7">
            <div className="hidden">
              <span className="mb-2 block font-[family-name:var(--font-jetbrains-mono)] text-[10px] uppercase tracking-[0.25em] text-zinc-300">
                <Trans>Search</Trans>
              </span>
              <input
                id="round-library-search"
                aria-label={t`Search installed rounds`}
                value={queryInput}
                onChange={(event) => {
                  const nextValue = event.target.value;
                  setQueryInput(nextValue);
                  setQuery(nextValue);
                }}
                onFocus={handleHoverSfx}
                onMouseEnter={handleHoverSfx}
                placeholder={t`Search title, hero, author`}
                className="w-full rounded-xl border border-purple-300/30 bg-black/45 px-4 py-3 text-sm text-zinc-100 outline-none transition-all duration-200 focus:border-purple-300/75 focus:ring-2 focus:ring-purple-400/30"
              />
            </div>

            <GameDropdown
              label={t`Type`}
              value={typeFilter}
              options={[
                { value: "all", label: t`All` },
                { value: "Normal", label: t`Normal` },
                { value: "Interjection", label: t`Interjection` },
                { value: "Cum", label: abbreviateNsfwText(t`Cum`, sfwMode) },
              ]}
              onChange={(value) => setTypeFilter(value as TypeFilter)}
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
              onChange={(value) => setScriptFilter(value as ScriptFilter)}
              onHoverSfx={handleHoverSfx}
              onSelectSfx={handleSelectSfx}
            />

            <GameDropdown
              label={t`Tag`}
              value={tagFilter}
              options={[
                { value: "all", label: t`All` },
                ...metadataOptions.tags.map((tag) => ({ value: tag, label: tag })),
              ]}
              onChange={(value) => setTagFilter(value as MetadataFilter)}
              onHoverSfx={handleHoverSfx}
              onSelectSfx={handleSelectSfx}
            />

            <GameDropdown
              label={t`Author`}
              value={actorFilter}
              options={[
                { value: "all", label: t`All` },
                ...metadataOptions.authorNames.map((author) => ({ value: author, label: author })),
              ]}
              onChange={(value) => setActorFilter(value as MetadataFilter)}
              onHoverSfx={handleHoverSfx}
              onSelectSfx={handleSelectSfx}
            />

            <GameDropdown
              label={t`Library`}
              value={libraryFilter}
              options={[
                { value: "all", label: t`All` },
                ...metadataOptions.libraryLabels.map((label) => ({ value: label, label })),
              ]}
              onChange={(value) => setLibraryFilter(value as MetadataFilter)}
              onHoverSfx={handleHoverSfx}
              onSelectSfx={handleSelectSfx}
            />

            <GameDropdown
              label={t`Source`}
              value={sourceFilter}
              options={[
                { value: "all", label: t`All` },
                { value: "stash", label: t`Stash` },
                { value: "web", label: t`Web` },
                { value: "local", label: t`Local` },
              ]}
              onChange={(value) => setSourceFilter(value as SourceFilter)}
              onHoverSfx={handleHoverSfx}
              onSelectSfx={handleSelectSfx}
            />

            <GameDropdown
              label={t`Added`}
              value={addedDateFilter.mode}
              options={[
                { value: "all", label: t`Any Time` },
                { value: "since", label: t`Since Date` },
                { value: "before", label: t`Before Date` },
                { value: "between", label: t`Between Dates` },
              ]}
              onChange={(value) => {
                const mode = value as AddedDateFilter["mode"];
                setAddedDateFilter((current) => {
                  const currentFrom =
                    current.mode === "since" || current.mode === "between" ? current.fromDate : "";
                  const currentTo =
                    current.mode === "before" || current.mode === "between" ? current.toDate : "";
                  if (mode === "since") return { mode, fromDate: currentFrom };
                  if (mode === "before") return { mode, toDate: currentTo };
                  if (mode === "between") return { mode, fromDate: currentFrom, toDate: currentTo };
                  return { mode: "all" };
                });
              }}
              onHoverSfx={handleHoverSfx}
              onSelectSfx={handleSelectSfx}
            />

            <div className="flex flex-wrap items-end gap-3 lg:col-span-2">
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
                onChange={(value) => updateSearch({ sortMode: value as SortMode })}
                onHoverSfx={handleHoverSfx}
                onSelectSfx={handleSelectSfx}
              />
            </div>

            {addedDateFilter.mode === "since" && (
              <DateFilterInput
                label={t`From`}
                value={addedDateFilter.fromDate}
                onChange={(fromDate) => setAddedDateFilter({ mode: "since", fromDate })}
              />
            )}
            {addedDateFilter.mode === "before" && (
              <DateFilterInput
                label={t`To`}
                value={addedDateFilter.toDate}
                onChange={(toDate) => setAddedDateFilter({ mode: "before", toDate })}
              />
            )}
            {addedDateFilter.mode === "between" && (
              <>
                <DateFilterInput
                  label={t`From`}
                  value={addedDateFilter.fromDate}
                  onChange={(fromDate) =>
                    setAddedDateFilter((current) =>
                      current.mode === "between"
                        ? { ...current, fromDate }
                        : { mode: "between", fromDate, toDate: "" }
                    )
                  }
                />
                <DateFilterInput
                  label={t`To`}
                  value={addedDateFilter.toDate}
                  onChange={(toDate) =>
                    setAddedDateFilter((current) =>
                      current.mode === "between"
                        ? { ...current, toDate }
                        : { mode: "between", fromDate: "", toDate }
                    )
                  }
                />
              </>
            )}
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
      ) : null}

      {/* Grid */}
      {isLibraryRefreshing && (
        <div
          role="status"
          aria-label={t`Refreshing library`}
          data-testid="library-refresh-hairline"
          className="round-library-themed-rule pointer-events-none absolute inset-x-0 top-0 h-0.5 animate-pulse"
        >
          <span className="sr-only">
            <Trans>Refreshing library</Trans>
          </span>
        </div>
      )}
      {!isInitialLibraryLoading && !hasInitialLibraryError && (
        <section className="relative min-h-[20rem]">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-bold text-zinc-200">
                {t`${filteredRounds.length} rounds`}
              </h3>
              <p className="mt-0.5 text-xs text-zinc-600">
                {filteredRounds.length === 0
                  ? t`No rounds currently match the active search and filter state.`
                  : t`${filteredRounds.length} matching rounds are currently available.`}
              </p>
            </div>
            <div className="hidden">
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

          {filteredRounds.length === 0 ? (
            <div className="rounded-2xl border border-zinc-700/60 bg-zinc-950/60 p-8 text-center backdrop-blur-xl">
              <p className="font-[family-name:var(--font-jetbrains-mono)] text-sm uppercase tracking-[0.28em] text-zinc-400">
                <Trans>No rounds match this filter</Trans>
              </p>
              <p className="mt-3 text-sm text-zinc-400">
                {hasActiveFilters
                  ? t`Clear the current filters to get back to the full library.`
                  : t`Install a folder or import a portable file to start building the library.`}
              </p>
            </div>
          ) : (
            <RoundGrid
              rows={renderRows}
              expandedGroupKeys={expandedGroupKeySet}
              scrollContainer={scrollContainer}
              onVisibleRoundIdsChange={setVisibleRoundIds}
              onScrollingChange={onLibraryScrollingChange}
              renderCard={(item) => {
                const cardAssets = cardAssetsByRoundId.get(item.round.id);
                return (
                  <RoundCard
                    key={item.key}
                    round={item.round}
                    cardAssets={cardAssets}
                    index={item.renderIndex}
                    onHoverSfx={handleHoverSfx}
                    onPlay={handlePlayRound}
                    showDisabledBadge={
                      ("isDisabled" in item.round && item.round.isDisabled) ||
                      disabledRoundIds.has(item.round.id)
                    }
                    isWebsiteVideoCaching={websiteVideoScanStatusRunning}
                    downloadProgress={
                      cardAssets?.previewVideoUri
                        ? getDownloadProgressForVideoUri(cardAssets.previewVideoUri)
                        : null
                    }
                    selectionMode={selectionMode}
                    selected={selectedRoundIds.has(item.round.id)}
                    onToggleSelection={selectionToggle}
                    mediaEnabled={!isLibraryScrolling}
                    inspected={inspectedRoundId === item.round.id}
                    onInspect={inspectRound}
                  />
                );
              }}
              renderGroupHeader={(shelf) => {
                const row = shelf.row;
                if (row.kind === "hero-group") return renderHeroGroupHeader(row);
                return renderPlaylistGroupHeader(row);
              }}
            />
          )}
        </section>
      )}
    </div>
  );
}

// Placeholder — wired by the page component via closure. Defined here to keep the
// LibrarySectionContent signature stable; the parent injects the real setter.

function FilterSkeleton() {
  return (
    <section className="animate-entrance rounded-3xl border border-purple-400/25 bg-zinc-950/55 p-5 backdrop-blur-xl">
      <div className="h-6 w-44 animate-pulse rounded bg-violet-200/20" />
      <div className="mt-5 grid grid-cols-1 gap-3 lg:grid-cols-5">
        <div className="h-12 rounded-xl border border-purple-300/20 bg-black/45 animate-pulse lg:col-span-2" />
        <div className="h-12 rounded-xl border border-zinc-700 bg-black/30 animate-pulse" />
        <div className="h-12 rounded-xl border border-zinc-700 bg-black/30 animate-pulse" />
        <div className="h-12 rounded-xl border border-zinc-700 bg-black/30 animate-pulse" />
      </div>
    </section>
  );
}

// ─── Hero / Playlist group header shells (wire props from the page) ───────────

function HeroGroupHeaderShell({
  row,
  expandedGroupKeySet,
  setExpandedHeroGroups,
  convertingHeroGroupKey,
  convertingHardModeHeroId,
  cardAssetsByRoundId,
  websiteVideoScanStatusRunning,
  selectionMode,
  selectedRoundIds,
  selectedHeroIds,
  toggleHeroGroupSelection,
  openHeroGroupRoundConversion,
  openHeroHardModeConversion,
  revertHardModeForRound,
  revertingHardModeRoundId,
  editHeroEntry,
  deleteHeroEntry,
  handleRetryTemplateLinkingForHero,
  setRepairingTemplateHero,
  handleHoverSfx,
  handleSelectSfx,
}: {
  row: Extract<RoundRenderRow, { kind: "hero-group" }>;
  expandedGroupKeySet: Set<string>;
  setExpandedHeroGroups: (
    v: Record<string, boolean> | ((prev: Record<string, boolean>) => Record<string, boolean>)
  ) => void;
  convertingHeroGroupKey: string | null;
  convertingHardModeHeroId: string | null;
  cardAssetsByRoundId: ReadonlyMap<string, import("@/services/db").InstalledRoundCardAssets>;
  websiteVideoScanStatusRunning: boolean;
  selectionMode: boolean;
  selectedRoundIds: Set<string>;
  selectedHeroIds: Set<string>;
  toggleHeroGroupSelection: (group: Extract<RoundRenderRow, { kind: "hero-group" }>) => void;
  openHeroGroupRoundConversion: (group: Extract<RoundRenderRow, { kind: "hero-group" }>) => void;
  openHeroHardModeConversion: (group: Extract<RoundRenderRow, { kind: "hero-group" }>) => void;
  revertHardModeForRound: (round: RoundLibraryEntry) => Promise<void>;
  revertingHardModeRoundId: string | null;
  editHeroEntry: (round: RoundLibraryEntry) => Promise<void>;
  deleteHeroEntry: (draft: HeroEditDraft | null) => void;
  handleRetryTemplateLinkingForHero: (heroId: string) => Promise<void>;
  setRepairingTemplateHero: (v: HeroTemplateRepairState | null) => void;
  handleHoverSfx: () => void;
  handleSelectSfx: () => void;
}) {
  const isExpanded = expandedGroupKeySet.has(row.groupKey);
  const heroId = row.rounds[0]?.heroId;
  const groupRoundIds = row.rounds.map((r) => r.id);
  const allRoundsSelected = groupRoundIds.every((id) => selectedRoundIds.has(id));
  const heroSelected = heroId ? selectedHeroIds.has(heroId) : false;
  const isGroupSelected = groupRoundIds.length > 0 && allRoundsSelected && heroSelected;
  const { pendingCacheCount, pendingPreviewCount } = summarizeHeroGroupPreviewState(
    row.rounds,
    cardAssetsByRoundId,
    websiteVideoScanStatusRunning
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
      convertingHardMode={convertingHardModeHeroId === heroId || revertingHardModeRoundId !== null}
      isHardModeConverted={row.rounds.some((round) => round.isHardModeConverted)}
      hasTemplateRounds={row.rounds.some((round) => isTemplateRound(round))}
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
      onConvertLegacyFunscript={() => {
        handleSelectSfx();
        void openHeroHardModeConversion(row);
      }}
      onRevertHardModeFunscript={() => {
        const firstRound = row.rounds[0];
        if (!firstRound) return;
        handleSelectSfx();
        void revertHardModeForRound(firstRound);
      }}
      onEditHero={() => {
        const firstRound = row.rounds[0];
        if (!firstRound) return;
        void editHeroEntry(firstRound);
      }}
      onDeleteHero={() => {
        const draft = toHeroEditDraft(row.rounds[0]);
        if (!draft) return;
        handleSelectSfx();
        deleteHeroEntry(draft);
      }}
      onRetryTemplateLinking={() => {
        const heroId = row.rounds[0]?.heroId;
        if (!heroId) return;
        handleSelectSfx();
        void handleRetryTemplateLinkingForHero(heroId);
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

function PlaylistGroupHeaderShell({
  row,
  expandedGroupKeySet,
  setExpandedHeroGroups,
  cardAssetsByRoundId,
  websiteVideoScanStatusRunning,
  handleHoverSfx,
  handleSelectSfx,
}: {
  row: Extract<RoundRenderRow, { kind: "playlist-group" }>;
  expandedGroupKeySet: Set<string>;
  setExpandedHeroGroups: (
    v: Record<string, boolean> | ((prev: Record<string, boolean>) => Record<string, boolean>)
  ) => void;
  cardAssetsByRoundId: ReadonlyMap<string, import("@/services/db").InstalledRoundCardAssets>;
  websiteVideoScanStatusRunning: boolean;
  handleHoverSfx: () => void;
  handleSelectSfx: () => void;
}) {
  const isExpanded = expandedGroupKeySet.has(row.groupKey);
  const { pendingCacheCount } = summarizeHeroGroupPreviewState(
    row.rounds,
    cardAssetsByRoundId,
    websiteVideoScanStatusRunning
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
}
