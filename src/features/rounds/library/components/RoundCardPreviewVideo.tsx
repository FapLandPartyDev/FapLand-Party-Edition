import { useCallback, useEffect, useMemo } from "react";
import { SfwGuard } from "@/components/SfwGuard";
import { usePlayableVideoFallback } from "@/hooks/usePlayableVideoFallback";
import { isJsdomRuntime } from "../helpers";

export function RoundCardPreviewVideo({
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
      if (!isJsdomRuntime()) {
        video.pause();
      }
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
  }, [active, resolvePreviewWindow, videoRef]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !active || !previewVideoSrc) return;
    video.load();
  }, [active, previewVideoSrc, videoRef]);

  return (
    <SfwGuard>
      <video
        ref={videoRef}
        className={`h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.06] ${
          previewImage
            ? "opacity-0 group-hover/video:opacity-100 group-focus-within/video:opacity-100"
            : ""
        }`}
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
}
