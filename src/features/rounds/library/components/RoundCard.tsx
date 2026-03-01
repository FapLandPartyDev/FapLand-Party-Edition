import { memo, useCallback, useEffect, useRef, useState } from "react";
import { Trans, useLingui } from "@lingui/react/macro";
import type { InstalledRoundCardAssets, VideoDownloadProgress } from "@/services/db";
import { DeferredImage } from "@/features/library/components/DeferredImage";
import { SfwGuard } from "@/components/SfwGuard";
import { useSfwMode } from "@/hooks/useSfwMode";
import { formatDurationLabel, getRoundDurationSec } from "@/utils/duration";
import { abbreviateNsfwText } from "@/utils/sfwText";
import {
  formatDate,
  formatWindow,
  getRoundDisplayType,
  getRoundInstallSourceLabel,
  isJsdomRuntime,
  isTemplateRound,
  roundHasFunscript,
  roundHasPlayableResource,
} from "../helpers";
import { ROUND_CARD_PREVIEW_HOVER_DELAY_MS } from "../constants";
import type { RoundLibraryEntry } from "../types";
import { DifficultyBadge } from "./DifficultyBadge";
import { RoundCardPreviewVideo } from "./RoundCardPreviewVideo";
import { TechnicalDetail } from "../ui/ActionButton";

export type RoundCardProps = {
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
};

export const RoundCard = memo(function RoundCard({
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
}: RoundCardProps) {
  const sfwMode = useSfwMode();
  const { t } = useLingui();
  const [showTechnicalDetails, setShowTechnicalDetails] = useState(false);
  const [hasActivatedPreview, setHasActivatedPreview] = useState(false);
  const [isPreviewActive, setIsPreviewActive] = useState(false);
  const [isPreviewSuppressed, setIsPreviewSuppressed] = useState(false);
  const previewVideoRef = useRef<HTMLVideoElement | null>(null);
  const previewHoverTimeoutRef = useRef<number | null>(null);

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

  const clearPreviewHoverTimeout = useCallback(() => {
    if (previewHoverTimeoutRef.current === null) return;
    window.clearTimeout(previewHoverTimeoutRef.current);
    previewHoverTimeoutRef.current = null;
  }, []);

  const activateHoverPreview = useCallback(() => {
    setIsPreviewSuppressed(false);
    onHoverSfx();
    clearPreviewHoverTimeout();
    previewHoverTimeoutRef.current = window.setTimeout(() => {
      previewHoverTimeoutRef.current = null;
      setHasActivatedPreview(true);
      setIsPreviewActive(true);
    }, ROUND_CARD_PREVIEW_HOVER_DELAY_MS);
  }, [clearPreviewHoverTimeout, onHoverSfx]);

  const stopPreviewPlayback = useCallback(() => {
    clearPreviewHoverTimeout();
    setIsPreviewActive(false);
    setHasActivatedPreview(false);
    setIsPreviewSuppressed(true);
    const video = previewVideoRef.current;
    if (!video) return;
    if (!isJsdomRuntime()) {
      video.pause();
    }
    video.currentTime = 0;
    video.removeAttribute("src");
    if (!isJsdomRuntime()) {
      video.load();
    }
  }, [clearPreviewHoverTimeout]);

  useEffect(() => () => clearPreviewHoverTimeout(), [clearPreviewHoverTimeout]);

  return (
    <article
      className={`round-library-card group relative flex h-full w-full min-w-0 flex-col overflow-hidden rounded-[28px] border border-white/10 backdrop-blur-xl transition-all duration-300 ${
        index < 12 ? "animate-entrance" : ""
      }`}
      style={animationDelay ? { animationDelay } : undefined}
      onMouseEnter={activateHoverPreview}
      onMouseOver={activateHoverPreview}
      onMouseLeave={() => {
        clearPreviewHoverTimeout();
        setIsPreviewActive(false);
      }}
      onFocus={() => {
        onHoverSfx();
        clearPreviewHoverTimeout();
        setHasActivatedPreview(true);
        setIsPreviewActive(true);
      }}
      onBlur={() => {
        clearPreviewHoverTimeout();
        setIsPreviewActive(false);
      }}
    >
      <div className="round-library-card-wash pointer-events-none absolute inset-0" />

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

      <div className="round-library-media group/video relative aspect-video shrink-0 overflow-hidden border-b border-white/10">
        {previewImage && (
          <SfwGuard>
            <DeferredImage
              src={previewImage}
              alt={t`${displayName} preview`}
              className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
              loading="lazy"
              decoding="async"
              activationPriority={Math.min(index, 5)}
            />
          </SfwGuard>
        )}
        {hasActivatedPreview && previewUri && canPreview && !isPreviewSuppressed ? (
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
          <span className="round-library-accent-pill rounded-full border px-2.5 py-1 font-[family-name:var(--font-jetbrains-mono)] text-[9px] uppercase tracking-[0.28em] backdrop-blur-md">
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
            className="round-library-accent-button rounded-[1.6rem] border px-2.5 py-1.5 font-[family-name:var(--font-jetbrains-mono)] text-[10px] uppercase tracking-[0.16em] transition-all duration-200"
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
