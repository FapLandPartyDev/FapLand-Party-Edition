import { Trans, useLingui } from "@lingui/react/macro";
import React from "react";
import { playHoverSound, playSelectSound } from "../../utils/audio";
import type { ConverterState } from "./useConverterState";

type AutoDetectionPanelProps = {
  funscriptUri: string | null;
  durationMs: number;
  pauseGapDraft: string;
  minRoundDraft: string;
  autoTrimRounds: boolean;
  trimAllowanceDraft: string;
  targetSegmentCountDraft: string;
  targetDetectionResultSummary: string | null;
  targetSegmentCountInputRef: React.RefObject<HTMLInputElement | null>;
  isDetecting: boolean;
  detectedSegmentCount: number;
  existingSegmentCount: number;
  onSetPauseGapDraft: (value: string) => void;
  onSetMinRoundDraft: (value: string) => void;
  onSetAutoTrimRounds: (value: boolean) => void;
  onSetTrimAllowanceDraft: (value: string) => void;
  onSetTargetSegmentCountDraft: (value: string) => void;
  onCommitPauseGapDraft: () => void;
  onCommitMinRoundDraft: () => void;
  onCommitTrimAllowanceDraft: () => void;
  onRunAutoDetect: () => void;
  onRunAdaptiveAutoDetect: () => void;
  onRunTargetCountAutoDetect: () => void;
  onApplyDetected: () => void;
  onTrimExisting: () => void;
};

export const AutoDetectionPanel: React.FC<AutoDetectionPanelProps> = React.memo(
  ({
    funscriptUri,
    durationMs,
    pauseGapDraft,
    minRoundDraft,
    autoTrimRounds,
    trimAllowanceDraft,
    targetSegmentCountDraft,
    targetDetectionResultSummary,
    targetSegmentCountInputRef,
    isDetecting,
    detectedSegmentCount,
    existingSegmentCount,
    onSetPauseGapDraft,
    onSetMinRoundDraft,
    onSetAutoTrimRounds,
    onSetTrimAllowanceDraft,
    onSetTargetSegmentCountDraft,
    onCommitPauseGapDraft,
    onCommitMinRoundDraft,
    onCommitTrimAllowanceDraft,
    onRunAutoDetect,
    onRunAdaptiveAutoDetect,
    onRunTargetCountAutoDetect,
    onApplyDetected,
    onTrimExisting,
  }) => {
    const { t } = useLingui();
    const detectDisabled = isDetecting || !funscriptUri || durationMs <= 0;
    const targetCount = Number(targetSegmentCountDraft.trim());
    const targetDetectDisabled = detectDisabled || !Number.isFinite(targetCount) || targetCount < 1;

    return (
      <div>
        <h3 className="mb-2 text-xs font-bold uppercase tracking-[0.16em] text-violet-100">
          <Trans>Auto Detection</Trans>
        </h3>

        <div className="grid grid-cols-3 gap-2">
          <label className="text-[11px] text-zinc-300">
            <Trans>Pause Gap (ms)</Trans>
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
              className="converter-number-input mt-1 w-full rounded-lg border border-zinc-600 bg-black/40 px-2 py-1.5 text-xs text-zinc-100"
            />
          </label>
          <label className="text-[11px] text-zinc-300">
            <Trans>Min Round (ms)</Trans>
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
              className="converter-number-input mt-1 w-full rounded-lg border border-zinc-600 bg-black/40 px-2 py-1.5 text-xs text-zinc-100"
            />
          </label>
          <label className="text-[11px] text-zinc-300">
            <span className="flex items-center justify-between gap-1">
              <Trans>Target Count</Trans>
              <kbd className="converter-kbd">Alt+T</kbd>
            </span>
            <input
              id="converter-target-segment-count"
              ref={targetSegmentCountInputRef}
              type="number"
              aria-label={t`Target Count`}
              value={targetSegmentCountDraft}
              min={1}
              onChange={(event) => onSetTargetSegmentCountDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== "Enter") return;
                event.preventDefault();
                onRunTargetCountAutoDetect();
              }}
              className="converter-number-input mt-1 w-full rounded-lg border border-zinc-600 bg-black/40 px-2 py-1.5 text-xs text-zinc-100"
            />
          </label>
        </div>

        <div className="mt-2 grid grid-cols-3 items-end gap-2">
          <label className="flex items-center gap-2 rounded-lg border border-zinc-700 bg-black/20 px-2 py-1.5 text-[11px] text-zinc-300">
            <input
              type="checkbox"
              checked={autoTrimRounds}
              onChange={(event) => onSetAutoTrimRounds(event.target.checked)}
              className="accent-violet-500"
            />
            <Trans>Auto trim rounds</Trans>
          </label>
          <label className="text-[11px] text-zinc-300">
            <Trans>Trim Allowance (ms)</Trans>
            <input
              type="number"
              aria-label={t`Trim Allowance (ms)`}
              value={trimAllowanceDraft}
              min={0}
              onChange={(event) => onSetTrimAllowanceDraft(event.target.value)}
              onBlur={onCommitTrimAllowanceDraft}
              onKeyDown={(event) => {
                if (event.key !== "Enter") return;
                event.preventDefault();
                onCommitTrimAllowanceDraft();
                (event.currentTarget as HTMLInputElement).blur();
              }}
              className="converter-number-input mt-1 w-full rounded-lg border border-zinc-600 bg-black/40 px-2 py-1.5 text-xs text-zinc-100"
            />
          </label>
          <button
            type="button"
            disabled={isDetecting || !funscriptUri || durationMs <= 0 || existingSegmentCount === 0}
            onMouseEnter={playHoverSound}
            onClick={() => {
              playSelectSound();
              onTrimExisting();
            }}
            className={`rounded-lg border px-2 py-1.5 text-xs transition-all duration-200 ${
              isDetecting || !funscriptUri || durationMs <= 0 || existingSegmentCount === 0
                ? "cursor-not-allowed border-zinc-600 bg-zinc-800 text-zinc-500"
                : "border-amber-300/60 bg-amber-500/25 text-amber-100 hover:bg-amber-500/40"
            }`}
          >
            <Trans>Trim Existing</Trans>
          </button>
        </div>

        <div className="mt-2 grid grid-cols-4 gap-2">
          <button
            type="button"
            disabled={detectDisabled}
            onMouseEnter={playHoverSound}
            onClick={() => {
              playSelectSound();
              onRunAdaptiveAutoDetect();
            }}
            className={`rounded-lg border px-2 py-1.5 text-xs transition-all duration-200 ${
              detectDisabled
                ? "cursor-not-allowed border-zinc-600 bg-zinc-800 text-zinc-500"
                : "border-violet-300/60 bg-violet-500/25 text-violet-100 hover:bg-violet-500/40"
            }`}
          >
            {isDetecting ? t`Detecting...` : t`Auto Split`}
          </button>

          <button
            type="button"
            disabled={detectDisabled}
            onMouseEnter={playHoverSound}
            onClick={() => {
              playSelectSound();
              onRunAutoDetect();
            }}
            className={`rounded-lg border px-2 py-1.5 text-xs transition-all duration-200 ${
              detectDisabled
                ? "cursor-not-allowed border-zinc-600 bg-zinc-800 text-zinc-500"
                : "border-cyan-300/60 bg-cyan-500/25 text-cyan-100 hover:bg-cyan-500/40"
            }`}
          >
            {isDetecting ? t`Detecting...` : t`Detect Pauses`}
            {!isDetecting && <kbd className="converter-kbd ml-1">A</kbd>}
          </button>

          <button
            type="button"
            disabled={targetDetectDisabled}
            onMouseEnter={playHoverSound}
            onClick={() => {
              playSelectSound();
              onRunTargetCountAutoDetect();
            }}
            className={`rounded-lg border px-2 py-1.5 text-xs transition-all duration-200 ${
              targetDetectDisabled
                ? "cursor-not-allowed border-zinc-600 bg-zinc-800 text-zinc-500"
                : "border-emerald-300/60 bg-emerald-500/25 text-emerald-100 hover:bg-emerald-500/40"
            }`}
          >
            {isDetecting ? t`Detecting...` : t`Detect Target`}
            {!isDetecting && <kbd className="converter-kbd ml-1">T</kbd>}
          </button>

          <button
            type="button"
            disabled={detectedSegmentCount === 0}
            onMouseEnter={playHoverSound}
            onClick={onApplyDetected}
            className={`rounded-lg border px-2 py-1.5 text-xs transition-all duration-200 ${
              detectedSegmentCount === 0
                ? "cursor-not-allowed border-zinc-600 bg-zinc-800 text-zinc-500"
                : "border-violet-300/60 bg-violet-500/25 text-violet-100 hover:bg-violet-500/40"
            }`}
          >
            {t`Apply ${detectedSegmentCount || 0}`}{" "}
            <kbd className="converter-kbd ml-1">Shift+A</kbd>
          </button>
        </div>
        {targetDetectionResultSummary ? (
          <p className="mt-2 text-[11px] text-zinc-400">{targetDetectionResultSummary}</p>
        ) : null}
      </div>
    );
  }
);

AutoDetectionPanel.displayName = "AutoDetectionPanel";

export function pickAutoDetectionPanelProps(state: ConverterState): AutoDetectionPanelProps {
  return {
    funscriptUri: state.funscriptUri,
    durationMs: state.durationMs,
    pauseGapDraft: state.pauseGapDraft,
    minRoundDraft: state.minRoundDraft,
    autoTrimRounds: state.autoTrimRounds,
    trimAllowanceDraft: state.trimAllowanceDraft,
    targetSegmentCountDraft: state.targetSegmentCountDraft,
    targetDetectionResultSummary: state.targetDetectionResultSummary,
    targetSegmentCountInputRef: state.targetSegmentCountInputRef,
    isDetecting: state.isDetecting,
    detectedSegmentCount: state.detectedSegments.length,
    existingSegmentCount: state.sortedSegments.length,
    onSetPauseGapDraft: state.setPauseGapDraft,
    onSetMinRoundDraft: state.setMinRoundDraft,
    onSetAutoTrimRounds: state.setAutoTrimRounds,
    onSetTrimAllowanceDraft: state.setTrimAllowanceDraft,
    onSetTargetSegmentCountDraft: state.setTargetSegmentCountDraft,
    onCommitPauseGapDraft: state.commitPauseGapDraft,
    onCommitMinRoundDraft: state.commitMinRoundDraft,
    onCommitTrimAllowanceDraft: state.commitTrimAllowanceDraft,
    onRunAutoDetect: () => void state.runAutoDetect(),
    onRunAdaptiveAutoDetect: () => void state.runAdaptiveAutoDetectAndApply(),
    onRunTargetCountAutoDetect: () => void state.runTargetCountAutoDetect(),
    onApplyDetected: state.applyDetectedSuggestions,
    onTrimExisting: () => void state.trimExistingSegmentsToActions(),
  };
}
