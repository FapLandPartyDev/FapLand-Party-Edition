import { useLingui } from "@lingui/react/macro";
import React, { type RefObject, useId } from "react";
import {
  playConverterMarkInSound,
  playConverterMarkOutSound,
  playHoverSound,
  playSelectSound,
} from "../../utils/audio";
import { useForegroundVideoRegistration } from "../../hooks/useForegroundVideoRegistration";
import { SfwGuard } from "../../components/SfwGuard";
import type { ConverterState } from "./useConverterState";

type VideoPreviewProps = {
  videoRef: RefObject<HTMLVideoElement | null>;
  videoUri: string;
  durationMs: number;
  currentTimeMs: number;
  markInMs: number | null;
  markOutMs: number | null;
  hasSelectedSegment: boolean;
  previewSkipsCuts: boolean;
  getVideoSrc: (uri: string) => string | undefined;
  onLoadedMetadata: (video: HTMLVideoElement) => void;
  onTimeUpdate: (currentTimeMs: number) => void;
  onVideoError: () => void;
  onTogglePlayback: () => void;
  onSetMarkIn: () => void;
  onSetMarkOut: () => void;
  onAddSegment: () => void;
  onMoveSelectedStartToPlayhead: () => void;
  onMoveSelectedEndToPlayhead: () => void;
  onRandomJump: () => void;
  onPreviewSkipsCutsChange: (enabled: boolean) => void;
};

export const VideoPreview: React.FC<VideoPreviewProps> = React.memo(
  ({
    videoRef,
    videoUri,
    durationMs,
    currentTimeMs,
    markInMs,
    markOutMs,
    hasSelectedSegment,
    previewSkipsCuts,
    getVideoSrc,
    onLoadedMetadata,
    onTimeUpdate,
    onVideoError,
    onTogglePlayback,
    onSetMarkIn,
    onSetMarkOut,
    onAddSegment,
    onMoveSelectedStartToPlayhead,
    onMoveSelectedEndToPlayhead,
    onRandomJump,
    onPreviewSkipsCutsChange,
  }) => {
    const { t } = useLingui();
    const foregroundVideoId = useId();
    const foregroundVideo = useForegroundVideoRegistration(
      `converter-preview:${foregroundVideoId}`
    );
    const progressPercent =
      durationMs > 0 ? Math.max(0, Math.min(100, (currentTimeMs / durationMs) * 100)) : 0;

    return (
      <div>
        <div className="relative aspect-video overflow-hidden rounded-2xl border border-violet-300/25 bg-black/45">
          {videoUri ? (
            <SfwGuard>
              <video
                ref={videoRef}
                src={getVideoSrc(videoUri)}
                className="h-full w-full bg-black object-contain"
                preload="metadata"
                controls
                onPlay={foregroundVideo.handlePlay}
                onPause={foregroundVideo.handlePause}
                onEnded={foregroundVideo.handleEnded}
                onError={onVideoError}
                onLoadedMetadata={(event) => onLoadedMetadata(event.currentTarget)}
                onTimeUpdate={(event) =>
                  onTimeUpdate(Math.floor(event.currentTarget.currentTime * 1000))
                }
              />
              <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1 overflow-hidden bg-white/8">
                <div
                  className="h-full bg-violet-400/90 shadow-[0_0_8px_rgba(167,139,250,0.75),0_0_16px_rgba(139,92,246,0.4)] transition-[width] duration-150 ease-out"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
            </SfwGuard>
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-zinc-500">
              <span className="text-4xl opacity-30">🎬</span>
              <span className="text-sm">{t`Select a source video to start editing.`}</span>
            </div>
          )}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onMouseEnter={playHoverSound}
            onClick={() => {
              playSelectSound();
              onTogglePlayback();
            }}
            className="converter-action-button border-zinc-600 bg-black/45 text-zinc-100 hover:border-zinc-500"
          >
            ▶ Play/Pause <kbd className="converter-kbd">Space</kbd>
          </button>
          <button
            type="button"
            onMouseEnter={playHoverSound}
            onClick={() => {
              onSetMarkIn();
              playConverterMarkInSound();
            }}
            className={`converter-action-button border-cyan-300/60 bg-cyan-500/20 text-cyan-100 hover:bg-cyan-500/30 ${
              markInMs !== null ? "shadow-[0_0_10px_rgba(34,211,238,0.2)]" : ""
            }`}
          >
            Mark IN <kbd className="converter-kbd">I</kbd>
          </button>
          <button
            type="button"
            onMouseEnter={playHoverSound}
            onClick={() => {
              onSetMarkOut();
              playConverterMarkOutSound();
            }}
            className={`converter-action-button border-indigo-300/60 bg-indigo-500/20 text-indigo-100 hover:bg-indigo-500/30 ${
              markOutMs !== null ? "shadow-[0_0_10px_rgba(99,102,241,0.2)]" : ""
            }`}
          >
            Mark OUT <kbd className="converter-kbd">O</kbd>
          </button>
          <button
            type="button"
            onMouseEnter={playHoverSound}
            onClick={onAddSegment}
            className="converter-action-button border-violet-300/60 bg-violet-500/20 text-violet-100 hover:bg-violet-500/30"
          >
            Add Segment <kbd className="converter-kbd">Enter</kbd>
          </button>
          <button
            type="button"
            disabled={!hasSelectedSegment}
            onMouseEnter={playHoverSound}
            onClick={onMoveSelectedStartToPlayhead}
            className={`converter-action-button ${
              !hasSelectedSegment
                ? "cursor-not-allowed border-zinc-600 bg-zinc-800 text-zinc-500"
                : "border-cyan-300/60 bg-cyan-500/15 text-cyan-100 hover:bg-cyan-500/25"
            }`}
          >
            Move Start Here <kbd className="converter-kbd">S</kbd>
          </button>
          <button
            type="button"
            disabled={!hasSelectedSegment}
            onMouseEnter={playHoverSound}
            onClick={onMoveSelectedEndToPlayhead}
            className={`converter-action-button ${
              !hasSelectedSegment
                ? "cursor-not-allowed border-zinc-600 bg-zinc-800 text-zinc-500"
                : "border-indigo-300/60 bg-indigo-500/15 text-indigo-100 hover:bg-indigo-500/25"
            }`}
          >
            Move End Here <kbd className="converter-kbd">E</kbd>
          </button>
          <button
            type="button"
            disabled={durationMs <= 0}
            onMouseEnter={playHoverSound}
            onClick={onRandomJump}
            className={`converter-action-button ${
              durationMs <= 0
                ? "cursor-not-allowed border-zinc-600 bg-zinc-800 text-zinc-500"
                : "border-emerald-300/60 bg-emerald-500/20 text-emerald-100 hover:bg-emerald-500/30"
            }`}
          >
            Random <kbd className="converter-kbd">R</kbd>
          </button>
          <label className="ml-auto flex cursor-pointer items-center gap-2 rounded-xl border border-zinc-600 bg-black/35 px-3 py-2 text-xs text-zinc-200">
            <input
              type="checkbox"
              checked={previewSkipsCuts}
              onChange={(event) => onPreviewSkipsCutsChange(event.currentTarget.checked)}
              className="h-4 w-4 accent-violet-400"
            />
            Skip cuts in preview
          </label>
        </div>
      </div>
    );
  }
);

VideoPreview.displayName = "VideoPreview";

export function pickVideoPreviewProps(state: ConverterState): VideoPreviewProps {
  return {
    videoRef: state.videoRef,
    videoUri: state.videoUri,
    durationMs: state.durationMs,
    currentTimeMs: state.currentTimeMs,
    markInMs: state.markInMs,
    markOutMs: state.markOutMs,
    hasSelectedSegment: state.selectedSegment !== null,
    previewSkipsCuts: state.previewSkipsCuts,
    getVideoSrc: (uri: string) => state.getVideoSrc(uri),
    onLoadedMetadata: (video: HTMLVideoElement) => {
      const nextDuration = Number.isFinite(video.duration) ? Math.floor(video.duration * 1000) : 0;
      state.setDurationMs(nextDuration);
      state.setCurrentTimeMs(0);
      void state.ensurePlayableVideo(state.videoUri);
    },
    onTimeUpdate: (ms: number) => state.syncPreviewTimeMs(ms),
    onVideoError: () => void state.handleVideoError(state.videoUri),
    onTogglePlayback: () => void state.togglePlayback(),
    onSetMarkIn: () => state.setMarkInMs(state.currentTimeMs),
    onSetMarkOut: () => state.setMarkOutMs(state.currentTimeMs),
    onAddSegment: state.addSegmentFromMarks,
    onMoveSelectedStartToPlayhead: state.moveSelectedSegmentStartToPlayhead,
    onMoveSelectedEndToPlayhead: state.moveSelectedSegmentEndToPlayhead,
    onRandomJump: state.jumpToRandomPoint,
    onPreviewSkipsCutsChange: state.setPreviewSkipsCuts,
  };
}
