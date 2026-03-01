import React from "react";
import { playHoverSound, playSelectSound } from "../../utils/audio";
import type { ConverterState } from "./useConverterState";

type AutoDetectionPanelProps = {
    funscriptUri: string | null;
    durationMs: number;
    pauseGapDraft: string;
    minRoundDraft: string;
    isDetecting: boolean;
    detectedSegmentCount: number;
    onSetPauseGapDraft: (value: string) => void;
    onSetMinRoundDraft: (value: string) => void;
    onCommitPauseGapDraft: () => void;
    onCommitMinRoundDraft: () => void;
    onRunAutoDetect: () => void;
    onApplyDetected: () => void;
};

export const AutoDetectionPanel: React.FC<AutoDetectionPanelProps> = React.memo(
    ({
        funscriptUri,
        durationMs,
        pauseGapDraft,
        minRoundDraft,
        isDetecting,
        detectedSegmentCount,
        onSetPauseGapDraft,
        onSetMinRoundDraft,
        onCommitPauseGapDraft,
        onCommitMinRoundDraft,
        onRunAutoDetect,
        onApplyDetected,
    }) => {
        const detectDisabled = isDetecting || !funscriptUri || durationMs <= 0;

        return (
            <div className="converter-panel-glass rounded-2xl p-4">
                <h3 className="mb-2 text-sm font-bold uppercase tracking-[0.16em] text-violet-100">
                    Auto Detection
                </h3>

                <div className="grid grid-cols-1 gap-2">
                    <label className="text-xs text-zinc-300">
                        Pause Gap (ms)
                        <input
                            type="number"
                            value={pauseGapDraft}
                            min={100}
                            onChange={(event) => onSetPauseGapDraft(event.target.value)}
                            onBlur={onCommitPauseGapDraft}
                            onKeyDown={(event) => {
                                if (event.key !== "Enter") return;
                                event.preventDefault();
                                onCommitPauseGapDraft();
                                (event.currentTarget as HTMLInputElement).blur();
                            }}
                            className="converter-number-input converter-text-input mt-1 w-full"
                        />
                    </label>
                    <label className="text-xs text-zinc-300">
                        Min Round (ms)
                        <input
                            type="number"
                            value={minRoundDraft}
                            min={500}
                            onChange={(event) => onSetMinRoundDraft(event.target.value)}
                            onBlur={onCommitMinRoundDraft}
                            onKeyDown={(event) => {
                                if (event.key !== "Enter") return;
                                event.preventDefault();
                                onCommitMinRoundDraft();
                                (event.currentTarget as HTMLInputElement).blur();
                            }}
                            className="converter-number-input converter-text-input mt-1 w-full"
                        />
                    </label>
                </div>

                <button
                    type="button"
                    disabled={detectDisabled}
                    onMouseEnter={playHoverSound}
                    onClick={() => {
                        playSelectSound();
                        onRunAutoDetect();
                    }}
                    className={`mt-3 w-full rounded-xl border px-3 py-2 text-sm transition-all duration-200 ${detectDisabled
                            ? "cursor-not-allowed border-zinc-600 bg-zinc-800 text-zinc-500"
                            : "border-cyan-300/60 bg-cyan-500/25 text-cyan-100 hover:bg-cyan-500/40 hover:shadow-[0_0_18px_rgba(34,211,238,0.2)]"
                        }`}
                >
                    {isDetecting ? "Detecting..." : "Detect Round Pauses"}
                </button>

                <button
                    type="button"
                    disabled={detectedSegmentCount === 0}
                    onMouseEnter={playHoverSound}
                    onClick={onApplyDetected}
                    className={`mt-2 w-full rounded-xl border px-3 py-2 text-sm transition-all duration-200 ${detectedSegmentCount === 0
                            ? "cursor-not-allowed border-zinc-600 bg-zinc-800 text-zinc-500"
                            : "border-violet-300/60 bg-violet-500/25 text-violet-100 hover:bg-violet-500/40 hover:shadow-[0_0_18px_rgba(139,92,246,0.2)]"
                        }`}
                >
                    Apply {detectedSegmentCount} Suggestion{detectedSegmentCount === 1 ? "" : "s"}
                </button>
            </div>
        );
    },
);

AutoDetectionPanel.displayName = "AutoDetectionPanel";

export function pickAutoDetectionPanelProps(state: ConverterState): AutoDetectionPanelProps {
    return {
        funscriptUri: state.funscriptUri,
        durationMs: state.durationMs,
        pauseGapDraft: state.pauseGapDraft,
        minRoundDraft: state.minRoundDraft,
        isDetecting: state.isDetecting,
        detectedSegmentCount: state.detectedSegments.length,
        onSetPauseGapDraft: state.setPauseGapDraft,
        onSetMinRoundDraft: state.setMinRoundDraft,
        onCommitPauseGapDraft: state.commitPauseGapDraft,
        onCommitMinRoundDraft: state.commitMinRoundDraft,
        onRunAutoDetect: () => void state.runAutoDetect(),
        onApplyDetected: state.applyDetectedSuggestions,
    };
}
