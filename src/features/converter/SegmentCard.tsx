import { Trans, useLingui } from "@lingui/react/macro";
import React from "react";
import { useSfwMode } from "../../hooks/useSfwMode";
import { playSelectSound } from "../../utils/audio";
import { abbreviateNsfwText } from "../../utils/sfwText";
import { GameDropdown } from "../../components/ui/GameDropdown";
import { formatMs, type SegmentCutMarkDraft, type SegmentDraft, type SegmentType } from "./types";

type SegmentCardProps = {
  segment: SegmentDraft;
  index: number;
  ordinal: number | null;
  isSelected: boolean;
  hasNext: boolean;
  heroName: string;
  currentTimeMs: number;
  segmentCutMarks: SegmentCutMarkDraft;
  onSelect: () => void;
  onSeekToTimeline: (ms: number) => void;
  onJumpStart: () => void;
  onJumpEnd: () => void;
  onMergeWithNext: () => void;
  onSetCutMarkIn: () => void;
  onSetCutMarkOut: () => void;
  onClearCutMarks: () => void;
  onCutSegment: () => void;
  onRemoveCut: (cutId: string) => void;
  onJumpCutStart: (cutId: string) => void;
  onJumpCutEnd: (cutId: string) => void;
  onSetCustomName: (name: string) => void;
  onSetExcludeFromNumbering: (excluded: boolean) => void;
  onSetBpm: (rawValue: string) => void;
  onResetBpm: () => void;
  onSetDifficulty: (rawValue: string) => void;
  onResetDifficulty: () => void;
  onSetType: (type: SegmentType) => void;
  onUpdateTiming: (startTimeMs: number, endTimeMs: number) => void;
};

const TYPE_ACCENT: Record<SegmentType, string> = {
  Normal: "border-l-emerald-400/60",
  Interjection: "border-l-amber-400/60",
  Cum: "border-l-rose-400/60",
};

function toPercent(value: number, startTimeMs: number, endTimeMs: number): number {
  const durationMs = Math.max(1, endTimeMs - startTimeMs);
  return ((value - startTimeMs) / durationMs) * 100;
}

export const SegmentCard: React.FC<SegmentCardProps> = React.memo(
  ({
    segment,
    index,
    ordinal,
    isSelected,
    hasNext,
    heroName,
    currentTimeMs,
    segmentCutMarks,
    onSelect,
    onSeekToTimeline,
    onJumpStart,
    onJumpEnd,
    onMergeWithNext,
    onSetCutMarkIn,
    onSetCutMarkOut,
    onClearCutMarks,
    onCutSegment,
    onRemoveCut,
    onJumpCutStart,
    onJumpCutEnd,
    onSetCustomName,
    onSetExcludeFromNumbering,
    onSetBpm,
    onResetBpm,
    onSetDifficulty,
    onResetDifficulty,
    onSetType,
    onUpdateTiming,
  }) => {
    const sfwMode = useSfwMode();
    const { t } = useLingui();
    const durationSec = ((segment.endTimeMs - segment.startTimeMs) / 1000).toFixed(1);
    const [expanded, setExpanded] = React.useState(true);
    const difficultyLevel =
      segment.difficulty == null ? 0 : Math.max(1, Math.min(5, segment.difficulty));
    const playheadInsideSegment =
      currentTimeMs >= segment.startTimeMs && currentTimeMs <= segment.endTimeMs;
    const markInPercent =
      segmentCutMarks.markInMs === null
        ? null
        : toPercent(segmentCutMarks.markInMs, segment.startTimeMs, segment.endTimeMs);
    const markOutPercent =
      segmentCutMarks.markOutMs === null
        ? null
        : toPercent(segmentCutMarks.markOutMs, segment.startTimeMs, segment.endTimeMs);
    const playheadPercent = playheadInsideSegment
      ? toPercent(currentTimeMs, segment.startTimeMs, segment.endTimeMs)
      : null;

    return (
      <div
        className={`group border-l-[3px] py-2 pl-3 transition-all duration-150 ${TYPE_ACCENT[segment.type]} ${isSelected ? "bg-violet-500/10" : "hover:bg-white/[0.02]"}`}
        onClick={onSelect}
      >
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
          <div className="flex min-w-0 basis-full items-center gap-3">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setExpanded(!expanded);
              }}
              className={`text-xs text-zinc-400 transition-transform ${expanded ? "rotate-90" : ""}`}
            >
              ▸
            </button>
            <span className="text-xs font-semibold text-zinc-200 shrink-0">
              {ordinal === null ? "—" : `R${ordinal}`}
            </span>
            <input
              type="text"
              value={segment.customName ?? ""}
              aria-label={t`Round name`}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => onSetCustomName(e.target.value)}
              placeholder={
                ordinal === null
                  ? t`Custom round name`
                  : t`${heroName.trim() || "Hero"} - round ${ordinal}`
              }
              className="min-w-0 flex-1 rounded-md border border-zinc-700/70 bg-zinc-950/45 px-2.5 py-1.5 text-xs text-zinc-100 outline-none transition-colors placeholder:text-zinc-500 hover:border-zinc-600 focus:border-violet-400 focus:bg-zinc-950/80 focus:ring-2 focus:ring-violet-400/20"
            />
          </div>
          <label className="ml-5 flex cursor-pointer items-center gap-2 text-[10px] text-zinc-300">
            <input
              type="checkbox"
              checked={segment.excludeFromNumbering}
              onClick={(event) => event.stopPropagation()}
              onChange={(event) => onSetExcludeFromNumbering(event.currentTarget.checked)}
              className="h-3.5 w-3.5 accent-violet-400"
            />
            <Trans>Exclude from numbering</Trans>
          </label>
          <div className="flex items-center gap-2 text-[10px] text-zinc-500 shrink-0">
            <span>
              {formatMs(segment.startTimeMs)}–{formatMs(segment.endTimeMs)}
            </span>
            <span className="text-zinc-600">({durationSec}s)</span>
            <GameDropdown
              value={segment.type}
              options={[
                { value: "Normal", label: "Normal" },
                { value: "Interjection", label: "Interj" },
                { value: "Cum", label: abbreviateNsfwText("Cum", sfwMode) },
              ]}
              onSelectSfx={playSelectSound}
              onChange={(value) => onSetType(value as SegmentType)}
              className="w-auto"
            />
          </div>
        </div>

        {expanded && (
          <div className="mt-2 space-y-2 pl-5">
            <div className="rounded border border-violet-400/20 bg-black/20 p-2">
              <div className="mb-2 flex items-center justify-between gap-2 text-[10px] uppercase tracking-[0.14em] text-violet-100">
                <span>
                  <Trans>Segment Timeline</Trans>
                </span>
                <span className="text-zinc-500">
                  {formatMs(segment.startTimeMs)}-{formatMs(segment.endTimeMs)}
                </span>
              </div>
              <button
                type="button"
                aria-label={`Segment timeline for round ${index + 1}`}
                onClick={(event) => {
                  event.stopPropagation();
                  const rect = event.currentTarget.getBoundingClientRect();
                  const ratio = rect.width > 0 ? (event.clientX - rect.left) / rect.width : 0;
                  const clampedRatio = Math.max(0, Math.min(1, ratio));
                  const targetMs =
                    segment.startTimeMs +
                    Math.round((segment.endTimeMs - segment.startTimeMs) * clampedRatio);
                  onSeekToTimeline(targetMs);
                }}
                className="relative block h-8 w-full overflow-hidden rounded border border-zinc-700 bg-zinc-950/80"
              >
                {segment.cutRanges.map((cut) => (
                  <span
                    key={cut.id}
                    aria-label={t`Segment cut overlay`}
                    className="absolute inset-y-0 rounded-sm border border-rose-200/60 bg-[repeating-linear-gradient(135deg,rgba(244,63,94,0.42)_0,rgba(244,63,94,0.42)_6px,rgba(127,29,29,0.22)_6px,rgba(127,29,29,0.22)_12px)]"
                    style={{
                      left: `${toPercent(cut.startTimeMs, segment.startTimeMs, segment.endTimeMs)}%`,
                      width: `${Math.max(1, toPercent(cut.endTimeMs, segment.startTimeMs, segment.endTimeMs) - toPercent(cut.startTimeMs, segment.startTimeMs, segment.endTimeMs))}%`,
                    }}
                  />
                ))}
                {playheadPercent !== null && (
                  <span
                    aria-label={t`Segment playhead`}
                    className="absolute inset-y-0 w-[2px] bg-violet-300/90"
                    style={{ left: `${playheadPercent}%` }}
                  />
                )}
                {markInPercent !== null && (
                  <span
                    aria-label={t`Local cut in`}
                    className="absolute inset-y-0 w-[2px] bg-cyan-300"
                    style={{ left: `${markInPercent}%` }}
                  />
                )}
                {markOutPercent !== null && (
                  <span
                    aria-label={t`Local cut out`}
                    className="absolute inset-y-0 w-[2px] bg-indigo-300"
                    style={{ left: `${markOutPercent}%` }}
                  />
                )}
              </button>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px]">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onSetCutMarkIn();
                  }}
                  className="text-cyan-300 hover:text-cyan-200"
                >
                  <Trans>Set Cut IN</Trans>
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onSetCutMarkOut();
                  }}
                  className="text-indigo-300 hover:text-indigo-200"
                >
                  <Trans>Set Cut OUT</Trans>
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onCutSegment();
                  }}
                  className="text-amber-300 hover:text-amber-200"
                >
                  <Trans>Cut Segment</Trans>
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onClearCutMarks();
                  }}
                  className="text-zinc-400 hover:text-zinc-200"
                >
                  <Trans>Clear Cut Marks</Trans>
                </button>
                {segmentCutMarks.markInMs !== null && (
                  <span className="text-cyan-200">IN {formatMs(segmentCutMarks.markInMs)}</span>
                )}
                {segmentCutMarks.markOutMs !== null && (
                  <span className="text-indigo-200">OUT {formatMs(segmentCutMarks.markOutMs)}</span>
                )}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  playSelectSound();
                  onJumpStart();
                }}
                className="text-[10px] text-cyan-300 hover:text-cyan-200"
              >
                ◀ Start
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  playSelectSound();
                  onJumpEnd();
                }}
                className="text-[10px] text-indigo-300 hover:text-indigo-200"
              >
                End ▶
              </button>
              <button
                type="button"
                disabled={!hasNext}
                onClick={(e) => {
                  e.stopPropagation();
                  onMergeWithNext();
                }}
                className={`text-[10px] ${hasNext ? "text-violet-300 hover:text-violet-200" : "text-zinc-600"}`}
              >
                Merge ↓
              </button>
              <div className="flex-1" />
              <div className="flex items-center gap-1 text-[10px]">
                <span className="text-zinc-500">
                  <Trans>BPM:</Trans>
                </span>
                <input
                  type="number"
                  min={1}
                  max={400}
                  value={segment.bpm ?? ""}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => onSetBpm(e.target.value)}
                  className="w-12 rounded border border-zinc-700 bg-black/45 px-1 py-0.5 text-zinc-200"
                />
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onResetBpm();
                  }}
                  className="text-cyan-300"
                >
                  auto
                </button>
              </div>
              <div className="flex items-center gap-1 text-[10px]">
                <span className="text-zinc-500">
                  <Trans>Difficulty:</Trans>
                </span>
                <div className="flex items-center gap-0.5 rounded border border-zinc-700 bg-black/45 px-1 py-0.5">
                  {[1, 2, 3, 4, 5].map((level) => {
                    const active = level <= difficultyLevel;
                    return (
                      <button
                        key={level}
                        type="button"
                        aria-label={`Set difficulty to ${level} star${level === 1 ? "" : "s"}`}
                        aria-pressed={segment.difficulty === level}
                        onClick={(e) => {
                          e.stopPropagation();
                          onSetDifficulty(`${level}`);
                        }}
                        className={`leading-none transition-colors ${active ? "text-yellow-300" : "text-zinc-600 hover:text-zinc-400"}`}
                      >
                        ★
                      </button>
                    );
                  })}
                </div>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onResetDifficulty();
                  }}
                  className="text-cyan-300"
                >
                  auto
                </button>
              </div>
            </div>
            <div className="flex items-center gap-2 text-[10px]">
              <span className="text-zinc-500">
                <Trans>Timing:</Trans>
              </span>
              <input
                type="number"
                value={segment.startTimeMs}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  if (Number.isFinite(v)) onUpdateTiming(v, segment.endTimeMs);
                }}
                className="w-20 rounded border border-zinc-700 bg-black/45 px-1 py-0.5 text-zinc-200"
              />
              <span className="text-zinc-600">–</span>
              <input
                type="number"
                value={segment.endTimeMs}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  if (Number.isFinite(v)) onUpdateTiming(segment.startTimeMs, v);
                }}
                className="w-20 rounded border border-zinc-700 bg-black/45 px-1 py-0.5 text-zinc-200"
              />
            </div>
            {segment.cutRanges.length > 0 && (
              <div className="rounded border border-rose-400/20 bg-rose-950/10 p-2">
                <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-rose-200">
                  <Trans>Cuts</Trans>
                </div>
                <div className="space-y-1">
                  {segment.cutRanges.map((cut, cutIndex) => (
                    <div
                      key={cut.id}
                      className="flex flex-wrap items-center gap-2 text-[10px] text-zinc-300"
                    >
                      <span className="text-rose-200">C{cutIndex + 1}</span>
                      <span>
                        {formatMs(cut.startTimeMs)}-{formatMs(cut.endTimeMs)}
                      </span>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          playSelectSound();
                          onJumpCutStart(cut.id);
                        }}
                        className="text-cyan-300 hover:text-cyan-200"
                      >
                        <Trans>Start</Trans>
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          playSelectSound();
                          onJumpCutEnd(cut.id);
                        }}
                        className="text-indigo-300 hover:text-indigo-200"
                      >
                        <Trans>End</Trans>
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onRemoveCut(cut.id);
                        }}
                        className="text-rose-300 hover:text-rose-200"
                      >
                        <Trans>Delete</Trans>
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    );
  }
);

SegmentCard.displayName = "SegmentCard";
