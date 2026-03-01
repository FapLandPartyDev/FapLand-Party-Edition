import React, { useMemo, type RefObject } from "react";
import { playHoverSound } from "../../utils/audio";
import { DEFAULT_ZOOM_PX_PER_SEC, formatMs, type DragState, type SegmentDraft } from "./types";
import type { FunscriptAction } from "../../game/media/playback";

type TimelineProps = {
    timelineScrollRef: RefObject<HTMLDivElement | null>;
    dragStateRef: React.MutableRefObject<DragState | null>;
    durationMs: number;
    currentTimeMs: number;
    markInMs: number | null;
    markOutMs: number | null;
    zoomPxPerSec: number;
    timelineWidthPx: number;
    sortedSegments: SegmentDraft[];
    selectedSegmentId: string | null;
    funscriptActions: FunscriptAction[];
    onTimelineWheel: (event: React.WheelEvent<HTMLDivElement>) => void;
    onTimelineClick: (event: React.MouseEvent<HTMLDivElement>) => void;
    onSelectSegment: (id: string) => void;
    onZoomChange: (next: number) => void;
};

const WAVEFORM_HEIGHT = 40;
const WAVEFORM_BUCKET_PX = 3;

function buildWaveformPath(
    actions: FunscriptAction[],
    durationMs: number,
    widthPx: number,
): string {
    if (actions.length < 2 || durationMs <= 0 || widthPx <= 0) return "";

    const bucketCount = Math.max(1, Math.floor(widthPx / WAVEFORM_BUCKET_PX));
    const bucketMs = durationMs / bucketCount;
    const peaks = new Float32Array(bucketCount);

    for (const action of actions) {
        const bucket = Math.min(Math.floor(action.at / bucketMs), bucketCount - 1);
        const normalizedPos = (action.pos ?? 0) / 100;
        if (normalizedPos > peaks[bucket]!) {
            peaks[bucket] = normalizedPos;
        }
    }

    const parts: string[] = [`M 0 ${WAVEFORM_HEIGHT}`];
    for (let i = 0; i < bucketCount; i++) {
        const x = (i / bucketCount) * widthPx;
        const y = WAVEFORM_HEIGHT - peaks[i]! * WAVEFORM_HEIGHT;
        parts.push(`L ${x.toFixed(1)} ${y.toFixed(1)}`);
    }
    parts.push(`L ${widthPx} ${WAVEFORM_HEIGHT} Z`);
    return parts.join(" ");
}

export const Timeline: React.FC<TimelineProps> = React.memo(
    ({
        timelineScrollRef,
        dragStateRef,
        durationMs,
        currentTimeMs,
        markInMs,
        markOutMs,
        zoomPxPerSec,
        timelineWidthPx,
        sortedSegments,
        selectedSegmentId,
        funscriptActions,
        onTimelineWheel,
        onTimelineClick,
        onSelectSegment,
        onZoomChange,
    }) => {
        const waveformPath = useMemo(
            () => buildWaveformPath(funscriptActions, durationMs, timelineWidthPx),
            [funscriptActions, durationMs, timelineWidthPx],
        );

        const zoomPercent = Math.round((zoomPxPerSec / DEFAULT_ZOOM_PX_PER_SEC) * 100);

        return (
            <>
                {/* Zoom controls */}
                <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                    <h2 className="text-lg font-bold text-violet-100">Preview + Timeline</h2>
                    <div className="flex items-center gap-2">
                        <button
                            type="button"
                            onMouseEnter={playHoverSound}
                            onClick={() => onZoomChange(zoomPxPerSec - 10)}
                            className="converter-zoom-button"
                        >
                            −
                        </button>
                        <span className="converter-zoom-badge">
                            {zoomPercent}%
                        </span>
                        <button
                            type="button"
                            onMouseEnter={playHoverSound}
                            onClick={() => onZoomChange(zoomPxPerSec + 10)}
                            className="converter-zoom-button"
                        >
                            +
                        </button>
                    </div>
                </div>

                {/* Timeline strip */}
                <div
                    ref={timelineScrollRef}
                    onWheel={onTimelineWheel}
                    className="mt-4 overflow-x-auto rounded-2xl border border-violet-300/20 bg-black/40 p-4"
                >
                    <div
                        className="relative h-36"
                        style={{ width: `${timelineWidthPx}px` }}
                        onClick={onTimelineClick}
                    >
                        {/* Track bar */}
                        <div className="absolute left-0 right-0 top-16 h-4 rounded-full bg-zinc-800/90" />

                        {/* Waveform */}
                        {waveformPath && (
                            <svg
                                className="absolute left-0 top-[52px] opacity-25"
                                width={timelineWidthPx}
                                height={WAVEFORM_HEIGHT}
                                preserveAspectRatio="none"
                                style={{ pointerEvents: "none" }}
                            >
                                <path d={waveformPath} fill="rgba(139,92,246,0.5)" />
                            </svg>
                        )}

                        {durationMs > 0 && (
                            <>
                                {/* Playhead */}
                                <div
                                    className="converter-playhead absolute top-5 w-[2px]"
                                    style={{
                                        left: `${(currentTimeMs / durationMs) * timelineWidthPx}px`,
                                        height: "95px",
                                    }}
                                />
                                {/* Mark IN */}
                                {markInMs !== null && (
                                    <div
                                        className="absolute top-10 h-24 w-[2px] bg-cyan-300/90"
                                        style={{ left: `${(markInMs / durationMs) * timelineWidthPx}px` }}
                                        title={`IN ${formatMs(markInMs)}`}
                                    />
                                )}
                                {/* Mark OUT */}
                                {markOutMs !== null && (
                                    <div
                                        className="absolute top-10 h-24 w-[2px] bg-indigo-300/90"
                                        style={{ left: `${(markOutMs / durationMs) * timelineWidthPx}px` }}
                                        title={`OUT ${formatMs(markOutMs)}`}
                                    />
                                )}
                            </>
                        )}

                        {/* Segments */}
                        {sortedSegments.map((segment) => {
                            const left = durationMs > 0 ? (segment.startTimeMs / durationMs) * timelineWidthPx : 0;
                            const width =
                                durationMs > 0
                                    ? ((segment.endTimeMs - segment.startTimeMs) / durationMs) * timelineWidthPx
                                    : 0;

                            const tone =
                                segment.type === "Interjection"
                                    ? "bg-amber-500/45 border-amber-300/70"
                                    : segment.type === "Cum"
                                        ? "bg-rose-500/45 border-rose-300/70"
                                        : "bg-emerald-500/45 border-emerald-300/70";

                            const selected = selectedSegmentId === segment.id;

                            return (
                                <button
                                    key={segment.id}
                                    type="button"
                                    onClick={() => onSelectSegment(segment.id)}
                                    onMouseEnter={playHoverSound}
                                    className={`converter-segment-enter absolute top-14 h-8 rounded-md border ${tone} transition-shadow duration-150 ${selected ? "ring-2 ring-white/80 shadow-[0_0_14px_rgba(255,255,255,0.15)]" : "hover:brightness-125"
                                        }`}
                                    style={{ left, width: Math.max(6, width) }}
                                    title={`${segment.type} • ${formatMs(segment.startTimeMs)}-${formatMs(segment.endTimeMs)}`}
                                >
                                    {selected && (
                                        <>
                                            <span
                                                role="presentation"
                                                onPointerDown={(event) => {
                                                    event.preventDefault();
                                                    dragStateRef.current = {
                                                        segmentId: segment.id,
                                                        edge: "start",
                                                        pointerX: event.clientX,
                                                        initialStartTimeMs: segment.startTimeMs,
                                                        initialEndTimeMs: segment.endTimeMs,
                                                    };
                                                }}
                                                className="absolute -left-1 top-0 h-8 w-2 cursor-ew-resize rounded bg-white/85"
                                            />
                                            <span
                                                role="presentation"
                                                onPointerDown={(event) => {
                                                    event.preventDefault();
                                                    dragStateRef.current = {
                                                        segmentId: segment.id,
                                                        edge: "end",
                                                        pointerX: event.clientX,
                                                        initialStartTimeMs: segment.startTimeMs,
                                                        initialEndTimeMs: segment.endTimeMs,
                                                    };
                                                }}
                                                className="absolute -right-1 top-0 h-8 w-2 cursor-ew-resize rounded bg-white/85"
                                            />
                                        </>
                                    )}
                                </button>
                            );
                        })}

                        {/* Ruler */}
                        {durationMs > 0 && (
                            <div className="absolute left-0 right-0 top-[2px] flex justify-between text-[10px] text-zinc-400">
                                {Array.from({ length: 11 }, (_, index) => {
                                    const pointMs = Math.floor((durationMs * index) / 10);
                                    return <span key={index}>{formatMs(pointMs)}</span>;
                                })}
                            </div>
                        )}
                    </div>
                </div>
            </>
        );
    },
);

Timeline.displayName = "Timeline";

export function pickTimelineProps(state: {
    timelineScrollRef: RefObject<HTMLDivElement | null>;
    dragStateRef: React.MutableRefObject<DragState | null>;
    durationMs: number;
    currentTimeMs: number;
    markInMs: number | null;
    markOutMs: number | null;
    zoomPxPerSec: number;
    timelineWidthPx: number;
    sortedSegments: SegmentDraft[];
    selectedSegmentId: string | null;
    funscriptActions: FunscriptAction[];
    onTimelineWheel: (event: React.WheelEvent<HTMLDivElement>) => void;
    onTimelineClick: (event: React.MouseEvent<HTMLDivElement>) => void;
    setSelectedSegmentId: (id: string) => void;
    setZoomWithSfx: (next: number) => void;
}): TimelineProps {
    return {
        timelineScrollRef: state.timelineScrollRef,
        dragStateRef: state.dragStateRef,
        durationMs: state.durationMs,
        currentTimeMs: state.currentTimeMs,
        markInMs: state.markInMs,
        markOutMs: state.markOutMs,
        zoomPxPerSec: state.zoomPxPerSec,
        timelineWidthPx: state.timelineWidthPx,
        sortedSegments: state.sortedSegments,
        selectedSegmentId: state.selectedSegmentId,
        funscriptActions: state.funscriptActions,
        onTimelineWheel: state.onTimelineWheel,
        onTimelineClick: state.onTimelineClick,
        onSelectSegment: state.setSelectedSegmentId,
        onZoomChange: state.setZoomWithSfx,
    };
}
