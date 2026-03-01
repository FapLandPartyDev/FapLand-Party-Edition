import React from "react";
import { useSfwMode } from "../../hooks/useSfwMode";
import { playSelectSound } from "../../utils/audio";
import { abbreviateNsfwText } from "../../utils/sfwText";
import { GameDropdown } from "../../components/ui/GameDropdown";
import { formatMs, type SegmentDraft, type SegmentType } from "./types";

type SegmentCardProps = {
  segment: SegmentDraft;
  index: number;
  isSelected: boolean;
  hasNext: boolean;
  heroName: string;
  onSelect: () => void;
  onJumpStart: () => void;
  onJumpEnd: () => void;
  onMergeWithNext: () => void;
  onRemoveCut: (cutId: string) => void;
  onJumpCutStart: (cutId: string) => void;
  onJumpCutEnd: (cutId: string) => void;
  onSetCustomName: (name: string) => void;
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

export const SegmentCard: React.FC<SegmentCardProps> = React.memo(
  ({
    segment,
    index,
    isSelected,
    hasNext,
    heroName,
    onSelect,
    onJumpStart,
    onJumpEnd,
    onMergeWithNext,
    onRemoveCut,
    onJumpCutStart,
    onJumpCutEnd,
    onSetCustomName,
    onSetBpm,
    onResetBpm,
    onSetDifficulty,
    onResetDifficulty,
    onSetType,
    onUpdateTiming,
  }) => {
    const sfwMode = useSfwMode();
    const durationSec = ((segment.endTimeMs - segment.startTimeMs) / 1000).toFixed(1);
    const [expanded, setExpanded] = React.useState(true);
    const difficultyLevel =
      segment.difficulty == null ? 0 : Math.max(1, Math.min(5, segment.difficulty));

    return (
      <div
        className={`group border-l-[3px] py-2 pl-3 transition-all duration-150 ${TYPE_ACCENT[segment.type]} ${isSelected ? "bg-violet-500/10" : "hover:bg-white/[0.02]"}`}
        onClick={onSelect}
      >
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0 flex-1">
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
            <span className="text-xs font-semibold text-zinc-200 shrink-0">R{index + 1}</span>
            <input
              type="text"
              value={segment.customName ?? ""}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => onSetCustomName(e.target.value)}
              placeholder={`${heroName.trim() || "Hero"} - round ${index + 1}`}
              className="min-w-0 flex-1 bg-transparent text-xs text-zinc-100 outline-none border-b border-transparent focus:border-violet-400/50"
            />
          </div>
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
                <span className="text-zinc-500">BPM:</span>
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
                <span className="text-zinc-500">Difficulty:</span>
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
              <span className="text-zinc-500">Timing:</span>
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
                  Cuts
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
                        Start
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
                        End
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onRemoveCut(cut.id);
                        }}
                        className="text-rose-300 hover:text-rose-200"
                      >
                        Delete
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
