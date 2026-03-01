import React from "react";
import { playSelectSound } from "../../utils/audio";
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
        onSetCustomName,
        onSetBpm,
        onResetBpm,
        onSetDifficulty,
        onResetDifficulty,
        onSetType,
        onUpdateTiming,
    }) => {
        const durationSec = ((segment.endTimeMs - segment.startTimeMs) / 1000).toFixed(1);

        return (
            <div
                className={`converter-segment-enter rounded-xl border-l-[3px] border p-3 transition-all duration-150 ${TYPE_ACCENT[segment.type]
                    } ${isSelected
                        ? "border-violet-300/60 bg-violet-500/10 shadow-[0_0_16px_rgba(139,92,246,0.12)]"
                        : "border-zinc-700 bg-black/30 hover:border-zinc-600"
                    }`}
                onClick={onSelect}
            >
                {/* Header row */}
                <div className="mb-2 flex items-center justify-between">
                    <span className="text-xs font-semibold text-zinc-200">
                        Round {index + 1}
                    </span>
                    <span className="font-[family-name:var(--font-jetbrains-mono)] text-[11px] text-zinc-400">
                        {formatMs(segment.startTimeMs)} – {formatMs(segment.endTimeMs)}{" "}
                        <span className="text-zinc-500">({durationSec}s)</span>
                    </span>
                </div>

                {/* Custom name */}
                <input
                    type="text"
                    value={segment.customName ?? ""}
                    onClick={(event) => event.stopPropagation()}
                    onChange={(event) => onSetCustomName(event.target.value)}
                    placeholder={`Custom name • default: ${heroName.trim() || "Hero"} - round ${index + 1}`}
                    className="converter-text-input mb-2 w-full text-xs"
                />

                {/* Jump + Merge row */}
                <div className="mb-2 grid grid-cols-3 gap-1.5">
                    <button
                        type="button"
                        onClick={(event) => {
                            event.stopPropagation();
                            playSelectSound();
                            onJumpStart();
                        }}
                        className="converter-mini-button border-cyan-300/50 bg-cyan-500/15 text-cyan-100 hover:bg-cyan-500/25"
                    >
                        ◀ Start
                    </button>
                    <button
                        type="button"
                        onClick={(event) => {
                            event.stopPropagation();
                            playSelectSound();
                            onJumpEnd();
                        }}
                        className="converter-mini-button border-indigo-300/50 bg-indigo-500/15 text-indigo-100 hover:bg-indigo-500/25"
                    >
                        End ▶
                    </button>
                    <button
                        type="button"
                        disabled={!hasNext}
                        onClick={(event) => {
                            event.stopPropagation();
                            onMergeWithNext();
                        }}
                        className={`converter-mini-button ${hasNext
                            ? "border-violet-300/50 bg-violet-500/15 text-violet-100 hover:bg-violet-500/25"
                            : "cursor-not-allowed border-zinc-700 bg-zinc-900/40 text-zinc-500"
                            }`}
                    >
                        Merge ↓
                    </button>
                </div>

                {/* Timing inputs */}
                <div className="mb-2 grid grid-cols-2 gap-2">
                    <input
                        type="number"
                        value={segment.startTimeMs}
                        onClick={(event) => event.stopPropagation()}
                        onChange={(event) => {
                            const nextStart = Number(event.target.value);
                            if (!Number.isFinite(nextStart)) return;
                            onUpdateTiming(nextStart, segment.endTimeMs);
                        }}
                        className="converter-number-input converter-text-input text-xs"
                    />
                    <input
                        type="number"
                        value={segment.endTimeMs}
                        onClick={(event) => event.stopPropagation()}
                        onChange={(event) => {
                            const nextEnd = Number(event.target.value);
                            if (!Number.isFinite(nextEnd)) return;
                            onUpdateTiming(segment.startTimeMs, nextEnd);
                        }}
                        className="converter-number-input converter-text-input text-xs"
                    />
                </div>

                {/* BPM + Difficulty */}
                <div className="mb-2 grid grid-cols-2 gap-2">
                    <label className="text-[11px] text-zinc-300">
                        BPM
                        <div className="mt-1 flex items-center gap-1">
                            <input
                                type="number"
                                min={1}
                                max={400}
                                value={segment.bpm ?? ""}
                                onClick={(event) => event.stopPropagation()}
                                onChange={(event) => onSetBpm(event.target.value)}
                                className="converter-number-input converter-text-input w-full text-xs"
                            />
                            <button
                                type="button"
                                onClick={(event) => {
                                    event.stopPropagation();
                                    onResetBpm();
                                }}
                                className="converter-mini-button border-cyan-300/50 bg-cyan-500/15 text-[10px] text-cyan-100"
                            >
                                Auto
                            </button>
                        </div>
                    </label>
                    <label className="text-[11px] text-zinc-300">
                        Difficulty
                        <div className="mt-1 flex items-center gap-1">
                            <input
                                type="number"
                                min={1}
                                max={5}
                                step={1}
                                value={segment.difficulty ?? ""}
                                onClick={(event) => event.stopPropagation()}
                                onChange={(event) => onSetDifficulty(event.target.value)}
                                className="converter-number-input converter-text-input w-full text-xs"
                            />
                            <button
                                type="button"
                                onClick={(event) => {
                                    event.stopPropagation();
                                    onResetDifficulty();
                                }}
                                className="converter-mini-button border-cyan-300/50 bg-cyan-500/15 text-[10px] text-cyan-100"
                            >
                                Auto
                            </button>
                        </div>
                    </label>
                </div>

                {/* Type selector */}
                <div className="relative">
                    <select
                        value={segment.type}
                        onClick={(event) => event.stopPropagation()}
                        onChange={(event) => onSetType(event.target.value as SegmentType)}
                        className="converter-native-select converter-select-field w-full border-zinc-600 focus:border-violet-300/70 focus:ring-violet-400/20"
                    >
                        <option value="Normal">Normal</option>
                        <option value="Interjection">Interjection</option>
                        <option value="Cum">Cum</option>
                    </select>
                    <span className="pointer-events-none absolute inset-y-0 right-2 flex items-center text-[10px] text-violet-200/80">
                        ▾
                    </span>
                </div>
            </div>
        );
    },
);

SegmentCard.displayName = "SegmentCard";
