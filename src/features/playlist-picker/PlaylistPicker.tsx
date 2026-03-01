import { useEffect, useMemo, useRef, useState } from "react";
import { Trans, useLingui } from "@lingui/react/macro";
import { AnimatedBackground } from "../../components/AnimatedBackground";
import { GameDropdown } from "../../components/ui/GameDropdown";
import { useControllerSurface } from "../../controller";
import { useSfwMode } from "../../hooks/useSfwMode";
import type { StoredPlaylist } from "../../services/playlists";
import { abbreviateNsfwText } from "../../utils/sfwText";
import { playHoverSound, playSelectSound } from "../../utils/audio";
import { i18n } from "../../i18n";
import {
  describeRelativeTime,
  getPlaylistBoardMode,
  getPlaylistRoundCount,
  getPlaylistUpdatedMs,
  getVisiblePlaylists,
  normalizeSearchQuery,
  type PlaylistBoardMode,
  type PlaylistModeFilter,
  type PlaylistSortKey,
} from "./playlistPickerHelpers";

export type PlaylistPickerContext = "workshop" | "map-editor";

export type PlaylistPickerNoticeTone = "info" | "success" | "error";

export type PlaylistPickerNotice = {
  message: string;
  tone?: PlaylistPickerNoticeTone;
};

export interface PlaylistPickerProps {
  context: PlaylistPickerContext;
  playlists: StoredPlaylist[];
  activePlaylistId: string;
  notice?: PlaylistPickerNotice | null;
  /** Per-playlist id currently performing a background action (shows a spinner/disabled state). */
  pendingActionPlaylistId?: string | null;
  /** When provided, the toolbar "New Playlist" button calls this (workshop opens its own dialog). */
  onRequestCreate?: () => void;
  /** Inline create form props (map-editor). Used only when `onRequestCreate` is not provided. */
  newPlaylistName?: string;
  createPending?: boolean;
  onNewPlaylistNameChange?: (name: string) => void;
  onCreatePlaylist?: () => void;
  /** Optional toolbar import button (workshop). */
  onImportPlaylists?: () => void;
  // Per-playlist actions. Omit a prop to hide its affordance.
  onOpenPlaylist: (playlist: StoredPlaylist) => void;
  onDuplicatePlaylist?: (playlist: StoredPlaylist) => void;
  onRenamePlaylist?: (playlist: StoredPlaylist) => void;
  onExportFplay?: (playlist: StoredPlaylist) => void;
  onDeletePlaylist?: (playlist: StoredPlaylist) => void;
  /** Gates rename/delete per playlist (defaults to always true). */
  canManage?: (playlist: StoredPlaylist) => boolean;
  onNavigateBack: () => void;
}

const MODE_BADGE_CLASS: Record<PlaylistBoardMode, string> = {
  linear: "border-cyan-400/45 bg-cyan-500/12 text-cyan-100",
  graph: "border-amber-400/50 bg-amber-500/15 text-amber-100",
  endless: "border-sky-400/45 bg-sky-500/15 text-sky-100",
};

const MODE_CARD_ACCENT_CLASS: Record<PlaylistBoardMode, string> = {
  linear: "hover:border-cyan-300/45 hover:bg-cyan-500/[0.06]",
  graph: "border-amber-400/35 hover:border-amber-300/60 hover:bg-amber-500/[0.08]",
  endless: "hover:border-sky-300/45 hover:bg-sky-500/[0.06]",
};

function getModeLabel(mode: PlaylistBoardMode): string {
  switch (mode) {
    case "linear":
      return i18n._({ id: "playlist-picker.mode.linear", message: "Linear" });
    case "graph":
      return i18n._({ id: "playlist-picker.mode.graph", message: "Graph" });
    case "endless":
      return i18n._({ id: "playlist-picker.mode.endless", message: "Endless" });
  }
}

function getRoundCountLabel(count: number): string {
  return i18n._({
    id: "playlist-picker.round-count",
    message: "{count, plural, one {# round} other {# rounds}}",
    values: { count },
  });
}

function getPlaylistCountLabel(count: number): string {
  return i18n._({
    id: "playlist-picker.count",
    message: "{count, plural, one {# Playlist} other {# Playlists}}",
    values: { count },
  });
}

function getRelativeTimeLabel(updatedMs: number): string {
  const { key, value } = describeRelativeTime(updatedMs);
  switch (key) {
    case "just-now":
      return i18n._({ id: "playlist-picker.updated.just-now", message: "just now" });
    case "minutes":
      return i18n._({
        id: "playlist-picker.updated.minutes",
        message: "{value, plural, one {# minute ago} other {# minutes ago}}",
        values: { value },
      });
    case "hours":
      return i18n._({
        id: "playlist-picker.updated.hours",
        message: "{value, plural, one {# hour ago} other {# hours ago}}",
        values: { value },
      });
    case "days":
      return i18n._({
        id: "playlist-picker.updated.days",
        message: "{value, plural, one {# day ago} other {# days ago}}",
        values: { value },
      });
    case "date":
      return new Date(value).toLocaleDateString();
  }
}

const NOTICE_TONE_CLASS: Record<PlaylistPickerNoticeTone, string> = {
  info: "border-cyan-400/40 bg-cyan-500/10 text-cyan-100",
  success: "border-emerald-400/40 bg-emerald-500/10 text-emerald-100",
  error: "border-rose-400/40 bg-rose-500/10 text-rose-100",
};

export function PlaylistPicker({
  context,
  playlists,
  activePlaylistId,
  notice,
  pendingActionPlaylistId,
  onRequestCreate,
  newPlaylistName,
  createPending,
  onNewPlaylistNameChange,
  onCreatePlaylist,
  onImportPlaylists,
  onOpenPlaylist,
  onDuplicatePlaylist,
  onRenamePlaylist,
  onExportFplay,
  onDeletePlaylist,
  canManage,
  onNavigateBack,
}: PlaylistPickerProps) {
  const { t } = useLingui();
  const sfwMode = useSfwMode();
  const scopeRef = useRef<HTMLDivElement | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [sortKey, setSortKey] = useState<PlaylistSortKey>("updated-desc");
  const [modeFilter, setModeFilter] = useState<PlaylistModeFilter>("all");
  const [openOverflowId, setOpenOverflowId] = useState<string | null>(null);
  const [showInlineCreate, setShowInlineCreate] = useState(false);

  const usesInlineCreate = !onRequestCreate;
  const isWorkshop = context === "workshop";
  const eyebrow = isWorkshop ? t`Playlist Workshop` : t`Map Editor`;
  const accentText = isWorkshop ? "text-violet-200/80" : "text-cyan-200/80";
  const accentBorder = isWorkshop ? "border-violet-300/25" : "border-cyan-300/25";
  const accentButton = isWorkshop
    ? "border-violet-300/55 bg-violet-500/15 text-violet-100 hover:bg-violet-500/25"
    : "border-cyan-300/55 bg-cyan-500/15 text-cyan-100 hover:bg-cyan-500/25";

  const normalizedQuery = normalizeSearchQuery(searchQuery);
  const visiblePlaylists = useMemo(
    () =>
      getVisiblePlaylists(
        playlists,
        modeFilter,
        normalizedQuery,
        sortKey,
        activePlaylistId
      ),
    [playlists, modeFilter, normalizedQuery, sortKey, activePlaylistId]
  );

  const hasAnyPlaylists = playlists.length > 0;
  const hasSecondaryActions = Boolean(
    onDuplicatePlaylist || onRenamePlaylist || onExportFplay || onDeletePlaylist
  );

  const firstPlaylistId = visiblePlaylists[0]?.id;

  useControllerSurface({
    id: `playlist-picker-${context}`,
    scopeRef,
    priority: 20,
    initialFocusId: firstPlaylistId
      ? `playlist-picker-card-${firstPlaylistId}`
      : onRequestCreate
        ? `playlist-picker-create`
        : "playlist-picker-search",
    onBack: () => {
      onNavigateBack();
      return true;
    },
  });

  useEffect(() => {
    if (!openOverflowId) return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      const root = scopeRef.current;
      if (root && !root.contains(target)) {
        setOpenOverflowId(null);
        return;
      }
      const menu = (event.target as HTMLElement | null)?.closest(
        `[data-overflow-menu="${openOverflowId}"]`
      );
      const trigger = (event.target as HTMLElement | null)?.closest(
        `[data-overflow-trigger="${openOverflowId}"]`
      );
      if (!menu && !trigger) {
        setOpenOverflowId(null);
      }
    };
    window.addEventListener("mousedown", onPointerDown);
    return () => window.removeEventListener("mousedown", onPointerDown);
  }, [openOverflowId]);

  const handleToggleCreate = () => {
    playSelectSound();
    if (onRequestCreate) {
      onRequestCreate();
      return;
    }
    setShowInlineCreate((prev) => !prev);
  };

  const handleCreateSubmit = () => {
    if (!onCreatePlaylist) return;
    playSelectSound();
    onCreatePlaylist();
  };

  const modeFilters: Array<{ id: PlaylistModeFilter; label: string }> = [
    { id: "all", label: t`All` },
    { id: "linear", label: t`Linear` },
    { id: "graph", label: t`Graph` },
    { id: "endless", label: t`Endless` },
  ];

  const sortOptions = [
    { value: "name-asc" as const, label: t`Name (A–Z)` },
    { value: "name-desc" as const, label: t`Name (Z–A)` },
    { value: "updated-desc" as const, label: t`Recently updated` },
    { value: "mode" as const, label: t`Board type` },
  ];

  return (
    <div ref={scopeRef} className="relative h-screen overflow-hidden">
      <AnimatedBackground quality="minimal" />
      <main className="relative z-10 flex h-full w-full flex-col px-3 py-3 md:px-4 md:py-4 lg:px-5 lg:py-5">
        <div
          className={`mx-auto flex h-full min-h-0 w-full max-w-5xl flex-col rounded-3xl border ${accentBorder} bg-black/40 p-4 shadow-2xl backdrop-blur-xl sm:p-5`}
        >
          {/* Header */}
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p
                className={`font-[family-name:var(--font-jetbrains-mono)] text-[0.65rem] uppercase tracking-[0.32em] ${accentText}`}
              >
                {eyebrow}
              </p>
              <h1 className="mt-1.5 text-2xl font-black tracking-tight text-white sm:text-3xl">
                <Trans>Select Playlist</Trans>
              </h1>
              <p className="mt-1 text-sm text-zinc-300">
                {isWorkshop ? (
                  <Trans>Choose a playlist to edit, or create one from here.</Trans>
                ) : (
                  <Trans>Choose a playlist to edit, or create a new playlist first.</Trans>
                )}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-300">
                {getPlaylistCountLabel(playlists.length)}
              </span>
              <button
                type="button"
                className="rounded-xl border border-zinc-600/70 bg-zinc-900/70 px-3 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-zinc-200 transition-colors hover:border-zinc-300/70 hover:text-white"
                onMouseEnter={playHoverSound}
                onClick={onNavigateBack}
                data-controller-focus-id="playlist-picker-back"
                data-controller-back="true"
              >
                <Trans>Back</Trans>
              </button>
            </div>
          </div>

          {notice && notice.message && (
            <div
              role="status"
              aria-live="polite"
              className={`mt-3 rounded-lg border px-3 py-2 text-xs ${
                NOTICE_TONE_CLASS[notice.tone ?? "info"]
              }`}
            >
              {notice.message}
            </div>
          )}

          {/* Toolbar */}
          <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="relative flex-1">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xs text-zinc-500">
                ⌕
              </span>
              <input
                type="text"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder={t`Search playlists…`}
                aria-label={t`Search playlists`}
                className="w-full rounded-xl border border-white/10 bg-black/40 py-2 pl-8 pr-3 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-white/25 focus:outline-none"
                data-controller-focus-id="playlist-picker-search"
              />
            </div>
            <div className="flex items-center gap-2">
              <div className="w-44">
                <GameDropdown<PlaylistSortKey>
                  value={sortKey}
                  options={sortOptions}
                  onChange={(next) => {
                    playSelectSound();
                    setSortKey(next);
                  }}
                  onHoverSfx={playHoverSound}
                  onSelectSfx={playSelectSound}
                />
              </div>
              <button
                type="button"
                onMouseEnter={playHoverSound}
                onClick={handleToggleCreate}
                className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-semibold uppercase tracking-[0.14em] transition-colors ${accentButton}`}
                data-controller-focus-id="playlist-picker-create"
              >
                <span className="text-sm leading-none">+</span>
                <Trans>New Playlist</Trans>
              </button>
              {onImportPlaylists && (
                <button
                  type="button"
                  onMouseEnter={playHoverSound}
                  onClick={() => {
                    playSelectSound();
                    onImportPlaylists();
                  }}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-white/12 bg-white/5 px-3 py-2 text-xs font-semibold uppercase tracking-[0.14em] text-zinc-200 transition-colors hover:bg-white/10"
                  data-controller-focus-id="playlist-picker-import"
                >
                  <Trans>Import</Trans>
                </button>
              )}
            </div>
          </div>

          {/* Mode filter chips */}
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            {modeFilters.map((filter) => {
              const active = filter.id === modeFilter;
              return (
                <button
                  key={filter.id}
                  type="button"
                  onMouseEnter={playHoverSound}
                  onClick={() => {
                    playSelectSound();
                    setModeFilter(filter.id);
                  }}
                  className={`rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] transition-colors ${
                    active
                      ? "border-white/35 bg-white/15 text-white"
                      : "border-white/10 bg-black/30 text-zinc-400 hover:text-zinc-200"
                  }`}
                >
                  {filter.label}
                </button>
              );
            })}
          </div>

          {/* Inline create form (map-editor context) */}
          {usesInlineCreate && showInlineCreate && (
            <div className="mt-3 rounded-2xl border border-white/10 bg-black/30 p-3">
              <p className="text-[11px] uppercase tracking-[0.14em] text-zinc-400">
                <Trans>Create new playlist</Trans>
              </p>
              <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                <input
                  type="text"
                  aria-label={t`Playlist name`}
                  placeholder={t`New playlist name`}
                  value={newPlaylistName ?? ""}
                  onChange={(event) => onNewPlaylistNameChange?.(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      handleCreateSubmit();
                    }
                  }}
                  className="flex-1 rounded-lg border border-zinc-600/60 bg-zinc-950/70 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-white/25 focus:outline-none"
                  data-controller-focus-id="playlist-picker-new-name"
                />
                <button
                  type="button"
                  disabled={createPending}
                  onMouseEnter={playHoverSound}
                  onClick={handleCreateSubmit}
                  className="rounded-lg border border-cyan-400/60 bg-cyan-500/15 px-4 py-2 text-xs font-semibold uppercase tracking-[0.12em] text-cyan-100 transition-colors hover:bg-cyan-500/25 disabled:opacity-50"
                  data-controller-focus-id="playlist-picker-new-submit"
                >
                  {createPending ? t`Creating…` : t`Create Playlist`}
                </button>
              </div>
            </div>
          )}

          {/* List */}
          <div className="mt-4 min-h-0 flex-1 overflow-y-auto pr-1">
            {!hasAnyPlaylists ? (
              <EmptyState
                title={t`No playlists yet`}
                description={
                  isWorkshop
                    ? t`Create your first playlist to start arranging rounds.`
                    : t`Create a playlist to start building your map.`
                }
                actionLabel={t`Create Playlist`}
                onAction={handleToggleCreate}
                accentButton={accentButton}
              />
            ) : visiblePlaylists.length === 0 ? (
              <EmptyState
                title={t`No playlists match your search`}
                description={t`Try a different name or clear the filters.`}
                actionLabel={t`Clear filters`}
                onAction={() => {
                  setSearchQuery("");
                  setModeFilter("all");
                }}
                accentButton={accentButton}
              />
            ) : (
              <ul className="flex flex-col gap-2.5">
                {visiblePlaylists.map((playlist) => (
                  <PlaylistCard
                    key={playlist.id}
                    playlist={playlist}
                    isActive={playlist.id === activePlaylistId}
                    isPending={playlist.id === pendingActionPlaylistId}
                    sfwMode={sfwMode}
                    hasSecondaryActions={hasSecondaryActions}
                    canManage={canManage ? canManage(playlist) : true}
                    overflowOpen={openOverflowId === playlist.id}
                    onToggleOverflow={() =>
                      setOpenOverflowId((current) =>
                        current === playlist.id ? null : playlist.id
                      )
                    }
                    onOpen={() => {
                      playSelectSound();
                      onOpenPlaylist(playlist);
                    }}
                    onDuplicate={
                      onDuplicatePlaylist
                        ? () => {
                            setOpenOverflowId(null);
                            onDuplicatePlaylist(playlist);
                          }
                        : undefined
                    }
                    onRename={
                      onRenamePlaylist
                        ? () => {
                            setOpenOverflowId(null);
                            onRenamePlaylist(playlist);
                          }
                        : undefined
                    }
                    onExportFplay={
                      onExportFplay
                        ? () => {
                            setOpenOverflowId(null);
                            onExportFplay(playlist);
                          }
                        : undefined
                    }
                    onDelete={
                      onDeletePlaylist
                        ? () => {
                            setOpenOverflowId(null);
                            onDeletePlaylist(playlist);
                          }
                        : undefined
                    }
                  />
                ))}
              </ul>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

interface PlaylistCardProps {
  playlist: StoredPlaylist;
  isActive: boolean;
  isPending: boolean;
  sfwMode: boolean;
  hasSecondaryActions: boolean;
  canManage: boolean;
  overflowOpen: boolean;
  onToggleOverflow: () => void;
  onOpen: () => void;
  onDuplicate?: () => void;
  onRename?: () => void;
  onExportFplay?: () => void;
  onDelete?: () => void;
}

function PlaylistCard({
  playlist,
  isActive,
  isPending,
  sfwMode,
  hasSecondaryActions,
  canManage,
  overflowOpen,
  onToggleOverflow,
  onOpen,
  onDuplicate,
  onRename,
  onExportFplay,
  onDelete,
}: PlaylistCardProps) {
  const { t } = useLingui();
  const mode = getPlaylistBoardMode(playlist);
  const roundCount = getPlaylistRoundCount(playlist);
  const updatedLabel = getRelativeTimeLabel(getPlaylistUpdatedMs(playlist));
  const description = playlist.description?.trim();
  const secondaryItems = [
    onDuplicate && { label: t`Copy`, onClick: onDuplicate, tone: "default" as const },
    onRename && canManage && { label: t`Rename`, onClick: onRename, tone: "default" as const },
    onExportFplay &&
      canManage && { label: t`Export .fplay`, onClick: onExportFplay, tone: "default" as const },
    onDelete && canManage && { label: t`Delete`, onClick: onDelete, tone: "danger" as const },
  ].filter(Boolean) as Array<{
    label: string;
    onClick: () => void;
    tone: "default" | "danger";
  }>;

  return (
    <li
      className={`group relative flex items-stretch gap-2 rounded-2xl border border-white/10 bg-gradient-to-br from-white/[0.04] to-black/30 px-3 py-3 transition-all duration-200 ${
        isActive ? "ring-1 ring-emerald-400/40" : ""
      } ${MODE_CARD_ACCENT_CLASS[mode]}`}
    >
      <button
        type="button"
        onMouseEnter={playHoverSound}
        onClick={onOpen}
        disabled={isPending}
        className="flex min-w-0 flex-1 flex-col items-start gap-1.5 text-left disabled:cursor-wait"
        data-controller-focus-id={`playlist-picker-card-${playlist.id}`}
        data-controller-initial={isActive ? "true" : undefined}
      >
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate text-base font-semibold text-white">
            {abbreviateNsfwText(playlist.name, sfwMode)}
          </span>
          <span
            className={`shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.1em] ${MODE_BADGE_CLASS[mode]}`}
          >
            {getModeLabel(mode)}
          </span>
          {isActive && (
            <span className="shrink-0 rounded border border-emerald-400/55 bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.1em] text-emerald-100">
              <Trans>Active</Trans>
            </span>
          )}
          {isPending && (
            <span className="shrink-0 text-[10px] uppercase tracking-[0.14em] text-zinc-400 animate-pulse">
              <Trans>Working…</Trans>
            </span>
          )}
        </div>
        {description && (
          <p className="line-clamp-1 text-xs text-zinc-400">{abbreviateNsfwText(description, sfwMode)}</p>
        )}
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-zinc-500">
          <span>{getRoundCountLabel(roundCount)}</span>
          <span className="text-zinc-700">·</span>
          <span className="uppercase tracking-[0.12em]">{getModeLabel(mode)}</span>
          <span className="text-zinc-700">·</span>
          <span>{updatedLabel}</span>
        </div>
      </button>

      <div className="flex shrink-0 items-start gap-1.5">
        <button
          type="button"
          onMouseEnter={playHoverSound}
          onClick={onOpen}
          disabled={isPending}
          className="rounded-lg border border-cyan-400/45 bg-cyan-500/10 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-cyan-100 transition-colors hover:bg-cyan-500/20 disabled:opacity-50"
        >
          <Trans>Open</Trans>
        </button>
        {hasSecondaryActions && secondaryItems.length > 0 && (
          <div className="relative">
            <button
              type="button"
              onMouseEnter={playHoverSound}
              onClick={onToggleOverflow}
              aria-label={t`More actions`}
              className={`flex h-[30px] w-[30px] items-center justify-center rounded-lg border border-white/12 bg-black/40 text-zinc-300 transition-colors hover:bg-white/10 hover:text-white ${
                overflowOpen ? "border-white/30 bg-white/10 text-white" : ""
              }`}
              data-overflow-trigger={playlist.id}
            >
              ⋯
            </button>
            {overflowOpen && (
              <div
                data-overflow-menu={playlist.id}
                className="absolute right-0 top-[calc(100%+6px)] z-[120] min-w-[11rem] rounded-xl border border-white/12 bg-zinc-950/95 p-1.5 shadow-2xl backdrop-blur-xl"
              >
                {secondaryItems.map((item) => (
                  <button
                    key={item.label}
                    type="button"
                    onMouseEnter={playHoverSound}
                    onClick={item.onClick}
                    className={`mb-1 w-full rounded-lg border px-3 py-1.5 text-left text-xs last:mb-0 ${
                      item.tone === "danger"
                        ? "border-rose-400/40 bg-rose-500/10 text-rose-100 hover:bg-rose-500/20"
                        : "border-transparent bg-transparent text-zinc-200 hover:bg-white/10"
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </li>
  );
}

interface EmptyStateProps {
  title: string;
  description: string;
  actionLabel: string;
  onAction: () => void;
  accentButton: string;
}

function EmptyState({ title, description, actionLabel, onAction, accentButton }: EmptyStateProps) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-white/12 bg-black/20 px-6 py-12 text-center">
      <p className="text-lg font-semibold text-zinc-200">{title}</p>
      <p className="max-w-sm text-sm text-zinc-400">{description}</p>
      <button
        type="button"
        onMouseEnter={playHoverSound}
        onClick={onAction}
        className={`mt-1 inline-flex items-center gap-1.5 rounded-xl border px-4 py-2 text-xs font-semibold uppercase tracking-[0.14em] transition-colors ${accentButton}`}
      >
        {actionLabel}
      </button>
    </div>
  );
}
