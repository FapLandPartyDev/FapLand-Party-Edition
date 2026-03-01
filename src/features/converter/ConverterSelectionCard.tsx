import React, { useEffect, useMemo, useRef, useState } from "react";
import { SfwGuard } from "../../components/SfwGuard";
import { usePlayableVideoFallback } from "../../hooks/usePlayableVideoFallback";
import { useSfwMode } from "../../hooks/useSfwMode";
import { abbreviateNsfwText } from "../../utils/sfwText";
import { playHoverSound, playSelectSound } from "../../utils/audio";

type ConverterSelectionCardProps = {
  kind: "round" | "hero";
  name: string;
  author?: string | null;
  description?: string | null;
  type?: "Normal" | "Interjection" | "Cum" | null;
  bpm?: number | null;
  durationMs?: number | null;
  roundCount?: number;
  hasFunscript?: boolean;
  previewImage?: string | null;
  previewVideoUri?: string | null;
  previewStartTimeMs?: number | null;
  previewEndTimeMs?: number | null;
  onClick: () => void;
};

function formatDuration(ms: number | null | undefined): string {
  if (ms == null || ms <= 0) return "";
  const totalSec = Math.floor(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}:${sec.toString().padStart(2, "0")}`;
}

const TYPE_STYLES: Record<string, string> = {
  Normal: "border-violet-300/40 bg-violet-500/15 text-violet-100",
  Interjection: "border-cyan-300/40 bg-cyan-500/15 text-cyan-100",
  Cum: "border-rose-300/40 bg-rose-500/15 text-rose-100",
};

export const ConverterSelectionCard: React.FC<ConverterSelectionCardProps> = React.memo(
  ({
    kind,
    name,
    author,
    description,
    type,
    bpm,
    durationMs,
    roundCount,
    hasFunscript,
    previewImage,
    previewVideoUri,
    previewStartTimeMs,
    previewEndTimeMs,
    onClick,
  }) => {
    const sfwMode = useSfwMode();
    const displayName = abbreviateNsfwText(name, sfwMode);
    const displayAuthor = author ? abbreviateNsfwText(author, sfwMode) : author;
    const displayDescription = description ? abbreviateNsfwText(description, sfwMode) : description;
    const displayType = type ? abbreviateNsfwText(type, sfwMode) : type;
    const typeStyle = type ? (TYPE_STYLES[type] ?? TYPE_STYLES.Normal) : null;
    const [hasActivatedPreview, setHasActivatedPreview] = useState(false);
    const [isPreviewActive, setIsPreviewActive] = useState(false);

    const handlePreviewActivate = () => {
      if (!previewVideoUri) return;
      setHasActivatedPreview(true);
      setIsPreviewActive(true);
    };

    const handlePreviewDeactivate = () => {
      setIsPreviewActive(false);
    };

    const handleActivate = () => {
      playSelectSound();
      onClick();
    };

    return (
      <div
        role="button"
        tabIndex={0}
        onMouseEnter={playHoverSound}
        onMouseMove={handlePreviewActivate}
        onMouseLeave={handlePreviewDeactivate}
        onFocus={handlePreviewActivate}
        onBlur={handlePreviewDeactivate}
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget) return;
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          handleActivate();
        }}
        onClick={(event) => {
          const target = event.target as HTMLElement;
          const interactiveTarget = target.closest(
            'button, a, input, select, textarea, [role="button"], [role="link"]'
          );
          if (interactiveTarget && interactiveTarget !== event.currentTarget) {
            return;
          }
          handleActivate();
        }}
        className="group flex flex-col gap-2 rounded-2xl border border-purple-400/25 bg-zinc-950/55 p-4 text-left backdrop-blur-xl transition-all duration-200 hover:border-violet-300/50 hover:bg-zinc-950/70"
      >
        {kind === "round" && (
          <div className="group/video relative -m-4 mb-2 aspect-video overflow-hidden rounded-t-2xl border-b border-purple-400/20 bg-gradient-to-br from-[#1b1130] via-[#120a25] to-[#0d1a33]">
            {previewImage && (
              <SfwGuard>
                <img
                  src={previewImage}
                  alt={`${displayName} preview`}
                  className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover/video:scale-[1.04] group-focus-within/video:scale-[1.04]"
                  loading="lazy"
                  decoding="async"
                />
              </SfwGuard>
            )}
            {previewVideoUri && hasActivatedPreview ? (
              <ConverterSelectionPreviewVideo
                previewUri={previewVideoUri}
                previewImage={previewImage ?? null}
                startTimeMs={previewStartTimeMs ?? null}
                endTimeMs={previewEndTimeMs ?? null}
                active={isPreviewActive}
              />
            ) : !previewImage ? (
              <div className="flex h-full items-center justify-center font-[family-name:var(--font-jetbrains-mono)] text-xs uppercase tracking-[0.28em] text-zinc-500">
                No Preview
              </div>
            ) : null}
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/65 via-transparent to-white/5" />
          </div>
        )}

        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-base font-bold text-violet-100 group-hover:text-violet-50">
              {displayName}
            </h3>
            {displayAuthor && (
              <p className="mt-0.5 truncate text-xs text-zinc-400">
                by {displayAuthor}
              </p>
            )}
          </div>
          {typeStyle && (
            <span
              className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.15em] ${typeStyle}`}
            >
              {displayType}
            </span>
          )}
        </div>

        {displayDescription && (
          <p className="line-clamp-2 text-xs text-zinc-400">{displayDescription}</p>
        )}

        <div className="mt-auto flex flex-wrap items-center gap-2 text-[11px] font-[family-name:var(--font-jetbrains-mono)]">
          {durationMs != null && durationMs > 0 && (
            <span className="rounded-md bg-black/30 px-1.5 py-0.5 text-zinc-300">
              {formatDuration(durationMs)}
            </span>
          )}
          {bpm != null && bpm > 0 && (
            <span className="rounded-md bg-black/30 px-1.5 py-0.5 text-zinc-300">
              {bpm} BPM
            </span>
          )}
          {kind === "hero" && roundCount != null && (
            <span className="rounded-md bg-black/30 px-1.5 py-0.5 text-cyan-200/80">
              {roundCount} {roundCount === 1 ? "round" : "rounds"}
            </span>
          )}
          {hasFunscript && (
            <span className="rounded-md border border-cyan-400/25 bg-cyan-500/10 px-1.5 py-0.5 text-cyan-200/80">
              script
            </span>
          )}
        </div>
      </div>
    );
  }
);

ConverterSelectionCard.displayName = "ConverterSelectionCard";

const ConverterSelectionPreviewVideo = React.memo(function ConverterSelectionPreviewVideo({
  previewUri,
  previewImage,
  startTimeMs,
  endTimeMs,
  active,
}: {
  previewUri: string;
  previewImage: string | null;
  startTimeMs: number | null;
  endTimeMs: number | null;
  active: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const { getVideoSrc, ensurePlayableVideo, handleVideoError } = usePlayableVideoFallback();
  const previewVideoSrc = getVideoSrc(previewUri);
  const previewWindowSec = useMemo(() => {
    const startMs =
      typeof startTimeMs === "number" && Number.isFinite(startTimeMs) ? Math.max(0, startTimeMs) : 0;
    const rawEndMs =
      typeof endTimeMs === "number" && Number.isFinite(endTimeMs) ? Math.max(0, endTimeMs) : null;
    const resolvedEndMs = rawEndMs !== null && rawEndMs > startMs ? rawEndMs : null;
    return {
      startSec: startMs / 1000,
      endSec: resolvedEndMs === null ? null : resolvedEndMs / 1000,
    };
  }, [endTimeMs, startTimeMs]);

  const resolvePreviewWindow = React.useCallback(
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
    void video.play().catch(() => undefined);
  }, [active, resolvePreviewWindow]);

  return (
    <SfwGuard>
      <video
        ref={videoRef}
        className={`h-full w-full object-cover transition-transform duration-500 group-hover/video:scale-[1.06] group-focus-within/video:scale-[1.06] ${previewImage ? "opacity-0 group-hover/video:opacity-100 group-focus-within/video:opacity-100" : ""}`}
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
