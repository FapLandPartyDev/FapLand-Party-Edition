import { Trans, useLingui } from "@lingui/react/macro";
import React from "react";
import { playHoverSound, playSelectSound } from "../../utils/audio";
import type { ConverterState, ConverterStep, SelectedSourceInfo } from "./useConverterState";

type ConverterHeaderBaseProps = {
  step: ConverterStep;
  selectedSourceInfo: SelectedSourceInfo;
  segmentCount: number;
  sourceSummary: string;
  showHotkeys: boolean;
  canLoadPreviousUnconverted: boolean;
  canLoadNextUnconverted: boolean;
  unconvertedPositionLabel: string | null;
};

type ConverterHeaderProps = ConverterHeaderBaseProps & {
  onGoToSelect: () => void;
  onAttachFunscript: () => void;
  onLoadPreviousUnconverted: () => void;
  onLoadNextUnconverted: () => void;
  onShowHotkeys: () => void;
  onHideHotkeys: () => void;
};

export const ConverterHeader: React.FC<ConverterHeaderProps> = React.memo(
  ({
    step,
    selectedSourceInfo,
    segmentCount,
    sourceSummary,
    showHotkeys,
    canLoadPreviousUnconverted,
    canLoadNextUnconverted,
    unconvertedPositionLabel,
    onGoToSelect,
    onAttachFunscript,
    onLoadPreviousUnconverted,
    onLoadNextUnconverted,
    onShowHotkeys,
    onHideHotkeys,
  }) => {
    const { t } = useLingui();

    if (step === "select") {
      return (
        <header className="animate-entrance rounded-3xl border border-purple-400/25 bg-zinc-950/55 p-6 backdrop-blur-xl">
          <p className="font-[family-name:var(--font-jetbrains-mono)] text-xs uppercase tracking-[0.45em] text-purple-200/85">
            <Trans>Conversion Lab</Trans>
          </p>
          <div className="mt-3 flex flex-wrap items-end justify-between gap-4">
            <h1 className="text-2xl font-black tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-violet-200 via-purple-100 to-indigo-200 drop-shadow-[0_0_20px_rgba(139,92,246,0.45)] sm:text-3xl">
              <Trans>Round Converter</Trans>
            </h1>
          </div>
          <p className="mt-2 text-sm text-zinc-400">
            <Trans>
              Select a source to convert rounds into hero segments, or add more rounds to an
              existing hero.
            </Trans>
          </p>
        </header>
      );
    }

    return (
      <header className="animate-entrance rounded-3xl border border-purple-400/25 bg-zinc-950/55 p-6 backdrop-blur-xl">
        <div className="flex items-center gap-3">
          <button
            type="button"
            disabled={!canLoadPreviousUnconverted}
            onMouseEnter={playHoverSound}
            onClick={() => {
              playSelectSound();
              onLoadPreviousUnconverted();
            }}
            className={`rounded-xl border px-4 py-2 font-[family-name:var(--font-jetbrains-mono)] text-xs uppercase tracking-[0.2em] transition-all duration-200 ${
              canLoadPreviousUnconverted
                ? "border-emerald-300/55 bg-emerald-500/18 text-emerald-100 hover:border-emerald-200/80 hover:bg-emerald-500/30"
                : "cursor-not-allowed border-zinc-700 bg-zinc-900/70 text-zinc-500"
            }`}
          >
            <Trans>Prev</Trans> <kbd className="converter-kbd ml-1">Alt+←</kbd>
          </button>
          <button
            type="button"
            disabled={!canLoadNextUnconverted}
            onMouseEnter={playHoverSound}
            onClick={() => {
              playSelectSound();
              onLoadNextUnconverted();
            }}
            className={`rounded-xl border px-4 py-2 font-[family-name:var(--font-jetbrains-mono)] text-xs uppercase tracking-[0.2em] transition-all duration-200 ${
              canLoadNextUnconverted
                ? "border-emerald-300/55 bg-emerald-500/18 text-emerald-100 hover:border-emerald-200/80 hover:bg-emerald-500/30"
                : "cursor-not-allowed border-zinc-700 bg-zinc-900/70 text-zinc-500"
            }`}
          >
            <Trans>Next</Trans> <kbd className="converter-kbd ml-1">Alt+→</kbd>
          </button>
          <button
            type="button"
            onMouseEnter={playHoverSound}
            onClick={() => {
              playSelectSound();
              onGoToSelect();
            }}
            className="rounded-xl border border-violet-300/55 bg-violet-500/20 px-4 py-2 font-[family-name:var(--font-jetbrains-mono)] text-xs uppercase tracking-[0.2em] text-violet-100 transition-all duration-200 hover:border-violet-200/80 hover:bg-violet-500/35"
          >
            <Trans>Change Source</Trans>
          </button>
          <button
            type="button"
            onMouseEnter={playHoverSound}
            onClick={() => {
              playSelectSound();
              onAttachFunscript();
            }}
            className="rounded-xl border border-cyan-300/55 bg-cyan-500/20 px-4 py-2 font-[family-name:var(--font-jetbrains-mono)] text-xs uppercase tracking-[0.2em] text-cyan-100 transition-all duration-200 hover:border-cyan-200/80 hover:bg-cyan-500/35"
          >
            <Trans>Attach Funscript</Trans>
          </button>
          <button
            type="button"
            onMouseEnter={playHoverSound}
            onClick={() => {
              playSelectSound();
              if (showHotkeys) {
                onHideHotkeys();
                return;
              }
              onShowHotkeys();
            }}
            className="rounded-xl border border-zinc-500/60 bg-black/35 px-4 py-2 font-[family-name:var(--font-jetbrains-mono)] text-xs uppercase tracking-[0.2em] text-zinc-100 transition-all duration-200 hover:border-zinc-300/80 hover:bg-black/50"
          >
            {showHotkeys ? t`Hide Shortcuts` : t`Show Shortcuts`} <kbd className="converter-kbd ml-1">?</kbd>
          </button>
          <p className="font-[family-name:var(--font-jetbrains-mono)] text-xs uppercase tracking-[0.45em] text-purple-200/85">
            <Trans>Conversion Lab</Trans>
          </p>
          {unconvertedPositionLabel ? (
            <p className="rounded-lg border border-emerald-300/30 bg-emerald-500/10 px-3 py-1.5 font-[family-name:var(--font-jetbrains-mono)] text-[10px] uppercase tracking-[0.16em] text-emerald-100">
              {unconvertedPositionLabel}
            </p>
          ) : null}
        </div>

        <div className="mt-3 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-black tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-violet-200 via-purple-100 to-indigo-200 drop-shadow-[0_0_20px_rgba(139,92,246,0.45)] sm:text-3xl">
              {selectedSourceInfo?.name ?? t`Editor`}
            </h1>
            {selectedSourceInfo && (
              <p className="mt-1 text-xs text-zinc-400">
                {selectedSourceInfo.kind === "round"
                  ? t`Converting standalone round to hero`
                  : selectedSourceInfo.kind === "hero"
                    ? t`Editing hero rounds`
                    : t`Converting local video file`}
              </p>
            )}
          </div>
          <div className="rounded-xl border border-violet-200/30 bg-violet-400/10 px-4 py-2 font-[family-name:var(--font-jetbrains-mono)] text-xs uppercase tracking-[0.2em] text-violet-100">
            <Trans>{segmentCount} Segment{segmentCount === 1 ? "" : "s"}</Trans> • {sourceSummary}
          </div>
        </div>
      </header>
    );
  }
);

ConverterHeader.displayName = "ConverterHeader";

export function pickConverterHeaderProps(state: ConverterState): ConverterHeaderBaseProps {
  return {
    step: state.step,
    selectedSourceInfo: state.selectedSourceInfo,
    segmentCount: state.sortedSegments.length,
    sourceSummary: state.sourceSummary,
    showHotkeys: state.showHotkeys,
    canLoadPreviousUnconverted: state.canLoadPreviousUnconverted,
    canLoadNextUnconverted: state.canLoadNextUnconverted,
    unconvertedPositionLabel: state.unconvertedPositionLabel,
  };
}
