import { Trans } from "@lingui/react/macro";
import React, { useEffect, useMemo, useState, type RefObject } from "react";
import { useSfwMode } from "../../hooks/useSfwMode";
import { playHoverSound } from "../../utils/audio";
import { abbreviateNsfwText } from "../../utils/sfwText";
import {
  assignSegmentLanes,
  DEFAULT_ZOOM_PX_PER_SEC,
  formatMs,
  type DragState,
  type SegmentDraft,
} from "./types";
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
  onTimelinePointerDown: (event: React.PointerEvent<HTMLDivElement>) => void;
  onSelectSegment: (id: string) => void;
  onZoomChange: (next: number) => void;
};

const WAVEFORM_HEIGHT = 40;
const WAVEFORM_BUCKET_PX = 3;
const SEGMENT_LANE_TOP = 56;
const SEGMENT_LANE_HEIGHT = 32;
const SEGMENT_LANE_GAP = 6;
const TIMELINE_BOTTOM_PADDING = 22;

function buildWaveformPath(
  actions: FunscriptAction[],
  durationMs: number,
  widthPx: number
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
    onTimelinePointerDown,
    onSelectSegment,
    onZoomChange,
  }) => {
    const sfwMode = useSfwMode();
    const waveformPath = useMemo(
      () => buildWaveformPath(funscriptActions, durationMs, timelineWidthPx),
      [funscriptActions, durationMs, timelineWidthPx]
    );
    const segmentLanes = useMemo(() => assignSegmentLanes(sortedSegments), [sortedSegments]);
    const laneCount = Math.max(1, ...segmentLanes.map((entry) => entry.lane + 1));
    const laneAreaHeight =
      laneCount * SEGMENT_LANE_HEIGHT + (laneCount - 1) * SEGMENT_LANE_GAP;
    const timelineHeight = SEGMENT_LANE_TOP + laneAreaHeight + TIMELINE_BOTTOM_PADDING;
    const [zoomDraft, setZoomDraft] = useState(() => `${zoomPxPerSec}`);

    useEffect(() => {
      setZoomDraft(`${zoomPxPerSec}`);
    }, [zoomPxPerSec]);

    const commitZoomDraft = () => {
      const parsed = Number(zoomDraft.trim());
      if (!Number.isFinite(parsed)) {
        setZoomDraft(`${zoomPxPerSec}`);
        return;
      }
      onZoomChange(parsed);
    };

    const zoomPercent = Math.round((zoomPxPerSec / DEFAULT_ZOOM_PX_PER_SEC) * 100);

    return (
      <>
        {/* Zoom controls */}
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-bold text-violet-100">
            <Trans>Preview + Timeline</Trans>
          </h2>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onMouseEnter={playHoverSound}
              onClick={() => onZoomChange(zoomPxPerSec - 10)}
              className="converter-zoom-button"
            >
              −
            </button>
            <label className="flex items-center gap-2 rounded-full border border-violet-300/20 bg-black/35 px-3 py-1.5 text-xs text-zinc-300">
              <span className="uppercase tracking-[0.2em] text-zinc-400">
                <Trans>Zoom</Trans>
              </span>
              <input
                type="number"
                inputMode="numeric"
                min={1}
                max={480}
                step={1}
                value={zoomDraft}
                onChange={(event) => setZoomDraft(event.currentTarget.value)}
                onBlur={commitZoomDraft}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    commitZoomDraft();
                    event.currentTarget.blur();
                  }
                  if (event.key === "Escape") {
                    event.preventDefault();
                    setZoomDraft(`${zoomPxPerSec}`);
                    event.currentTarget.blur();
                  }
                }}
                aria-label="Timeline zoom"
                className="w-16 border-0 bg-transparent text-right font-medium text-zinc-100 outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
              />
              <span className="text-zinc-500">px/s</span>
            </label>
            <span className="converter-zoom-badge">{zoomPercent}%</span>
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
            className="relative"
            style={{ width: `${timelineWidthPx}px`, height: `${timelineHeight}px` }}
            onPointerDown={onTimelinePointerDown}
          >
            {/* Track bar */}
            <div
              className="absolute left-0 right-0 rounded-full bg-zinc-800/90"
              style={{
                top: `${SEGMENT_LANE_TOP + SEGMENT_LANE_HEIGHT / 2 - 2}px`,
                height: "4px",
              }}
            />

            {/* Waveform */}
            {waveformPath && (
              <svg
                className="absolute left-0 opacity-25"
                width={timelineWidthPx}
                height={WAVEFORM_HEIGHT}
                preserveAspectRatio="none"
                style={{ top: `${SEGMENT_LANE_TOP - 4}px`, pointerEvents: "none" }}
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
                    height: `${timelineHeight - 20}px`,
                  }}
                />
                {/* Mark IN */}
                {markInMs !== null && (
                  <div
                    className="absolute w-[2px] bg-cyan-300/90"
                    style={{
                      left: `${(markInMs / durationMs) * timelineWidthPx}px`,
                      top: `${SEGMENT_LANE_TOP - 14}px`,
                      height: `${laneAreaHeight + 28}px`,
                    }}
                    title={`IN ${formatMs(markInMs)}`}
                  />
                )}
                {/* Mark OUT */}
                {markOutMs !== null && (
                  <div
                    className="absolute w-[2px] bg-indigo-300/90"
                    style={{
                      left: `${(markOutMs / durationMs) * timelineWidthPx}px`,
                      top: `${SEGMENT_LANE_TOP - 14}px`,
                      height: `${laneAreaHeight + 28}px`,
                    }}
                    title={`OUT ${formatMs(markOutMs)}`}
                  />
                )}
              </>
            )}

            {/* Segments */}
            {segmentLanes.map(({ segment, lane }) => {
              const left =
                durationMs > 0 ? (segment.startTimeMs / durationMs) * timelineWidthPx : 0;
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
              const top = SEGMENT_LANE_TOP + lane * (SEGMENT_LANE_HEIGHT + SEGMENT_LANE_GAP);

              return (
                <button
                  key={segment.id}
                  type="button"
                  data-segment-lane={lane}
                  onClick={() => onSelectSegment(segment.id)}
                  onMouseEnter={playHoverSound}
                  className={`converter-segment-enter absolute rounded-md border ${tone} transition-shadow duration-150 ${
                    selected
                      ? "ring-2 ring-white/80 shadow-[0_0_14px_rgba(255,255,255,0.15)]"
                      : "hover:brightness-125"
                  }`}
                  style={{ left, top, width: Math.max(6, width), height: SEGMENT_LANE_HEIGHT }}
                  title={`${abbreviateNsfwText(segment.type, sfwMode)} • ${formatMs(segment.startTimeMs)}-${formatMs(segment.endTimeMs)}`}
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
                            currentPointerX: event.clientX,
                            initialScrollLeft: timelineScrollRef.current?.scrollLeft ?? 0,
                            initialStartTimeMs: segment.startTimeMs,
                            initialEndTimeMs: segment.endTimeMs,
                          };
                        }}
                        className="absolute -left-1 top-0 h-full w-2 cursor-ew-resize rounded bg-white/85"
                      />
                      <span
                        role="presentation"
                        onPointerDown={(event) => {
                          event.preventDefault();
                          dragStateRef.current = {
                            segmentId: segment.id,
                            edge: "end",
                            pointerX: event.clientX,
                            currentPointerX: event.clientX,
                            initialScrollLeft: timelineScrollRef.current?.scrollLeft ?? 0,
                            initialStartTimeMs: segment.startTimeMs,
                            initialEndTimeMs: segment.endTimeMs,
                          };
                        }}
                        className="absolute -right-1 top-0 h-full w-2 cursor-ew-resize rounded bg-white/85"
                      />
                    </>
                  )}
                </button>
              );
            })}

            {/* Cuts */}
            {sortedSegments.flatMap((segment) =>
              segment.cutRanges.map((cut) => {
                const left = durationMs > 0 ? (cut.startTimeMs / durationMs) * timelineWidthPx : 0;
                const width =
                  durationMs > 0
                    ? ((cut.endTimeMs - cut.startTimeMs) / durationMs) * timelineWidthPx
                    : 0;
                return (
                  <div
                    key={`${segment.id}-${cut.id}`}
                    aria-label="Cut range"
                    className="pointer-events-none absolute rounded border border-rose-200/70 bg-[repeating-linear-gradient(135deg,rgba(244,63,94,0.42)_0,rgba(244,63,94,0.42)_6px,rgba(127,29,29,0.22)_6px,rgba(127,29,29,0.22)_12px)]"
                    style={{
                      left,
                      top: `${SEGMENT_LANE_TOP - 4}px`,
                      width: Math.max(4, width),
                      height: `${laneAreaHeight + 8}px`,
                    }}
                    title={`Cut ${formatMs(cut.startTimeMs)}-${formatMs(cut.endTimeMs)}`}
                  />
                );
              })
            )}

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
  }
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
  onTimelinePointerDown: (event: React.PointerEvent<HTMLDivElement>) => void;
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
    onTimelinePointerDown: state.onTimelinePointerDown,
    onSelectSegment: state.setSelectedSegmentId,
    onZoomChange: state.setZoomWithSfx,
  };
}
