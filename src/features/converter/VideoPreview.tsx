import React, { type RefObject } from "react";
import {
    playConverterMarkInSound,
    playConverterMarkOutSound,
    playHoverSound,
    playSelectSound,
} from "../../utils/audio";
import type { ConverterState } from "./useConverterState";

type VideoPreviewProps = {
    videoRef: RefObject<HTMLVideoElement | null>;
    videoUri: string;
    durationMs: number;
    currentTimeMs: number;
    markInMs: number | null;
    markOutMs: number | null;
    getVideoSrc: (uri: string) => string;
    onLoadedMetadata: (video: HTMLVideoElement) => void;
    onTimeUpdate: (currentTimeMs: number) => void;
    onVideoError: () => void;
    onTogglePlayback: () => void;
    onSetMarkIn: () => void;
    onSetMarkOut: () => void;
    onAddSegment: () => void;
    onRandomJump: () => void;
};

export const VideoPreview: React.FC<VideoPreviewProps> = React.memo(
    ({
        videoRef,
        videoUri,
        durationMs,
        markInMs,
        markOutMs,
        getVideoSrc,
        onLoadedMetadata,
        onTimeUpdate,
        onVideoError,
        onTogglePlayback,
        onSetMarkIn,
        onSetMarkOut,
        onAddSegment,
        onRandomJump,
    }) => (
        <div>
            <div className="overflow-hidden rounded-2xl border border-violet-300/25 bg-black/45">
                {videoUri ? (
                    <video
                        ref={videoRef}
                        src={getVideoSrc(videoUri)}
                        className="aspect-video w-full bg-black object-contain"
                        preload="metadata"
                        controls
                        onError={onVideoError}
                        onLoadedMetadata={(event) => onLoadedMetadata(event.currentTarget)}
                        onTimeUpdate={(event) =>
                            onTimeUpdate(Math.floor(event.currentTarget.currentTime * 1000))
                        }
                    />
                ) : (
                    <div className="flex aspect-video flex-col items-center justify-center gap-3 text-zinc-500">
                        <span className="text-4xl opacity-30">🎬</span>
                        <span className="text-sm">Select a source video to start editing.</span>
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
                    className={`converter-action-button border-cyan-300/60 bg-cyan-500/20 text-cyan-100 hover:bg-cyan-500/30 ${markInMs !== null ? "shadow-[0_0_10px_rgba(34,211,238,0.2)]" : ""
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
                    className={`converter-action-button border-indigo-300/60 bg-indigo-500/20 text-indigo-100 hover:bg-indigo-500/30 ${markOutMs !== null ? "shadow-[0_0_10px_rgba(99,102,241,0.2)]" : ""
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
                    disabled={durationMs <= 0}
                    onMouseEnter={playHoverSound}
                    onClick={onRandomJump}
                    className={`converter-action-button ${durationMs <= 0
                        ? "cursor-not-allowed border-zinc-600 bg-zinc-800 text-zinc-500"
                        : "border-emerald-300/60 bg-emerald-500/20 text-emerald-100 hover:bg-emerald-500/30"
                        }`}
                >
                    Random <kbd className="converter-kbd">R</kbd>
                </button>
            </div>
        </div>
    ),
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
        getVideoSrc: (uri: string) => state.getVideoSrc(uri) ?? uri,
        onLoadedMetadata: (video: HTMLVideoElement) => {
            const nextDuration = Number.isFinite(video.duration) ? Math.floor(video.duration * 1000) : 0;
            state.setDurationMs(nextDuration);
            state.setCurrentTimeMs(0);
            void state.ensurePlayableVideo(state.videoUri);
        },
        onTimeUpdate: (ms: number) => state.setCurrentTimeMs(ms),
        onVideoError: () => void state.handleVideoError(state.videoUri),
        onTogglePlayback: () => void state.togglePlayback(),
        onSetMarkIn: () => state.setMarkInMs(state.currentTimeMs),
        onSetMarkOut: () => state.setMarkOutMs(state.currentTimeMs),
        onAddSegment: state.addSegmentFromMarks,
        onRandomJump: state.jumpToRandomPoint,
    };
}
