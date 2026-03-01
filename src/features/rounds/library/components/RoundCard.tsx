import { memo, useCallback, useEffect, useRef, useState } from "react";
import { useLingui } from "@lingui/react/macro";
import type { InstalledRoundCardAssets, VideoDownloadProgress } from "@/services/db";
import { DeferredImage } from "@/features/library/components/DeferredImage";
import { SfwGuard } from "@/components/SfwGuard";
import { useSfwMode } from "@/hooks/useSfwMode";
import { formatDurationLabel, getRoundDurationSec } from "@/utils/duration";
import { abbreviateNsfwText } from "@/utils/sfwText";
import {
  getRoundDisplayType,
  getRoundInstallSourceLabel,
  isJsdomRuntime,
  isTemplateRound,
  roundHasFunscript,
} from "../helpers";
import { ROUND_CARD_PREVIEW_HOVER_DELAY_MS } from "../constants";
import type { RoundLibraryEntry } from "../types";
import { RoundCardPreviewVideo } from "./RoundCardPreviewVideo";

export type RoundCardProps = {
  round: RoundLibraryEntry;
  cardAssets?: InstalledRoundCardAssets;
  index: number;
  onHoverSfx: () => void;
  onPlay: (round: RoundLibraryEntry) => void;
  showDisabledBadge: boolean;
  isWebsiteVideoCaching?: boolean;
  downloadProgress?: VideoDownloadProgress | null;
  selectionMode?: boolean;
  selected?: boolean;
  onToggleSelection?: (round: RoundLibraryEntry) => void;
  mediaEnabled?: boolean;
  inspected?: boolean;
  onInspect: (roundId: string) => void;
};

export const RoundCard = memo(function RoundCard({
  round,
  cardAssets,
  index,
  onHoverSfx,
  onPlay,
  showDisabledBadge,
  isWebsiteVideoCaching = false,
  downloadProgress = null,
  selectionMode = false,
  selected = false,
  onToggleSelection,
  mediaEnabled = true,
  inspected = false,
  onInspect,
}: RoundCardProps) {
  const { t } = useLingui();
  const sfwMode = useSfwMode();
  const [hasActivatedPreview, setHasActivatedPreview] = useState(false);
  const [isPreviewActive, setIsPreviewActive] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hoverTimerRef = useRef<number | null>(null);

  const previewImage = cardAssets?.previewImage ?? null;
  const previewUri = cardAssets?.previewVideoUri ?? null;
  const isWebsiteRound = round.installSourceKey?.startsWith("website:") ?? false;
  const cachePending = isWebsiteRound && cardAssets?.websiteVideoCacheStatus === "pending";
  const previewGenerating =
    isWebsiteVideoCaching && isWebsiteRound && cardAssets != null && !previewImage;
  const displayName = abbreviateNsfwText(round.name, sfwMode);
  const displayAuthor = abbreviateNsfwText(
    round.author ?? round.hero?.name ?? t`Unknown creator`,
    sfwMode
  );
  const typeLabel = abbreviateNsfwText(getRoundDisplayType(round.type, "Normal"), sfwMode);
  const sourceLabel = abbreviateNsfwText(
    getRoundInstallSourceLabel(round.installSourceKey, {
      stash: t`Stash`,
      web: t`Web`,
      local: t`Local`,
    }),
    sfwMode
  );

  const clearHoverTimer = useCallback(() => {
    if (hoverTimerRef.current === null) return;
    window.clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = null;
  }, []);

  const stopPreview = useCallback(() => {
    clearHoverTimer();
    setIsPreviewActive(false);
    setHasActivatedPreview(false);
    const video = videoRef.current;
    if (!video) return;
    if (!isJsdomRuntime()) video.pause();
    video.removeAttribute("src");
    if (!isJsdomRuntime()) video.load();
  }, [clearHoverTimer]);

  const startPreview = useCallback(() => {
    if (!mediaEnabled || !previewUri || cachePending) return;
    onHoverSfx();
    clearHoverTimer();
    hoverTimerRef.current = window.setTimeout(() => {
      hoverTimerRef.current = null;
      setHasActivatedPreview(true);
      setIsPreviewActive(true);
    }, ROUND_CARD_PREVIEW_HOVER_DELAY_MS);
  }, [cachePending, clearHoverTimer, mediaEnabled, onHoverSfx, previewUri]);

  useEffect(() => () => clearHoverTimer(), [clearHoverTimer]);
  useEffect(() => {
    if (!mediaEnabled) stopPreview();
  }, [mediaEnabled, stopPreview]);

  const toggleOrInspect = () => {
    if (selectionMode) {
      onToggleSelection?.(round);
      return;
    }
    onInspect(round.id);
  };

  return (
    <article
      className={`round-poster-card group ${inspected ? "is-inspected" : ""} ${
        selected ? "is-selected" : ""
      }`}
      onMouseEnter={startPreview}
      onMouseLeave={stopPreview}
      onFocus={startPreview}
      onBlur={stopPreview}
    >
      <button
        type="button"
        aria-label={selectionMode ? t`Select ${displayName}` : t`Inspect ${displayName}`}
        onClick={toggleOrInspect}
        className="absolute inset-0 z-10 rounded-[18px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/70"
      />

      <div className="round-poster-media relative aspect-video overflow-hidden rounded-t-[17px] bg-[#101218]">
        {previewImage && (
          <SfwGuard>
            <DeferredImage
              src={previewImage}
              alt={t`${displayName} preview`}
              loading="lazy"
              decoding="async"
              activationPriority={Math.min(index, 5)}
              suspended={!mediaEnabled}
              className="absolute inset-0 h-full w-full object-cover"
            />
          </SfwGuard>
        )}
        {mediaEnabled && hasActivatedPreview && previewUri && !cachePending && (
          <RoundCardPreviewVideo
            videoRef={videoRef}
            previewUri={previewUri}
            previewImage={previewImage}
            startTime={round.startTime}
            endTime={round.endTime}
            active={isPreviewActive}
          />
        )}
        {!previewImage && (
          <div className="absolute inset-0 grid place-items-center bg-[radial-gradient(circle_at_30%_20%,rgba(34,211,238,0.08),transparent_38%),#101218]">
            <span className="font-[family-name:var(--font-jetbrains-mono)] text-[10px] uppercase tracking-[0.18em] text-zinc-600">
              {cachePending
                ? t`Caching`
                : previewGenerating
                  ? t`Generating preview`
                  : t`No preview`}
            </span>
          </div>
        )}
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-black/15" />

        <div className="absolute left-2 top-2 z-20 flex gap-1.5">
          {selectionMode && (
            <span className={`round-poster-check ${selected ? "is-selected" : ""}`}>
              {selected ? "✓" : ""}
            </span>
          )}
          <span className="round-poster-badge">{typeLabel}</span>
          {showDisabledBadge && <span className="round-poster-badge is-danger">{t`Disabled`}</span>}
        </div>

        <button
          type="button"
          aria-label={t`Play ${displayName}`}
          disabled={cachePending || cardAssets == null}
          onClick={(event) => {
            event.stopPropagation();
            stopPreview();
            onPlay(round);
          }}
          className="round-poster-play z-30"
        >
          ▶
        </button>

        <div className="absolute bottom-2 left-2 right-2 z-20 flex items-end justify-between gap-2">
          <div className="flex min-w-0 gap-1.5">
            <span className={`round-poster-badge ${roundHasFunscript(round) ? "is-ready" : ""}`}>
              {roundHasFunscript(round) ? t`Script` : t`No script`}
            </span>
            {isTemplateRound(round) && <span className="round-poster-badge">{t`Template`}</span>}
          </div>
          <span className="round-poster-duration">
            {formatDurationLabel(getRoundDurationSec(round))}
          </span>
        </div>
        {downloadProgress && (
          <div className="absolute inset-x-0 bottom-0 z-30 h-0.5 bg-black/50">
            <div className="h-full bg-cyan-300" style={{ width: `${downloadProgress.percent}%` }} />
          </div>
        )}
      </div>

      <div className="min-w-0 px-3 py-2.5">
        <h2 className="truncate text-sm font-bold tracking-tight text-zinc-100">{displayName}</h2>
        <div className="mt-1 flex items-center justify-between gap-2 text-[11px] text-zinc-500">
          <span className="truncate">{displayAuthor}</span>
          <span className="shrink-0 font-[family-name:var(--font-jetbrains-mono)] text-[9px] uppercase tracking-[0.12em]">
            {sourceLabel}
          </span>
        </div>
      </div>
    </article>
  );
});
