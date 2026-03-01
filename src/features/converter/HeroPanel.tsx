import { Trans, useLingui } from "@lingui/react/macro";
import React from "react";
import { playHoverSound, playSelectSound } from "../../utils/audio";
import type { ConverterState } from "./useConverterState";

type HeroPanelProps = {
  heroName: string;
  heroAuthor: string;
  heroDescription: string;
  sourceMode: "local" | "installed";
  deleteSourceRound: boolean;
  canSave: boolean;
  isSaving: boolean;
  onSetHeroName: (value: string) => void;
  onSetHeroAuthor: (value: string) => void;
  onSetHeroDescription: (value: string) => void;
  onSetDeleteSourceRound: (value: boolean) => void;
  onSave: () => void;
};

export const HeroPanel: React.FC<HeroPanelProps> = React.memo(
  ({
    heroName,
    heroAuthor,
    heroDescription,
    sourceMode,
    deleteSourceRound,
    canSave,
    isSaving,
    onSetHeroName,
    onSetHeroAuthor,
    onSetHeroDescription,
    onSetDeleteSourceRound,
    onSave,
  }) => {
    const { t } = useLingui();

    return (
      <div>
        <h3 className="mb-2 text-xs font-bold uppercase tracking-[0.16em] text-violet-100">
          <Trans>Hero Metadata</Trans>
        </h3>

        <div className="grid grid-cols-1 gap-2">
          <input
            value={heroName}
            onChange={(event) => onSetHeroName(event.target.value)}
            placeholder={t`Hero name *`}
            className="rounded-lg border border-violet-300/30 bg-black/40 px-3 py-2 text-xs text-zinc-100 outline-none transition-colors focus:border-violet-400/60"
          />
          <input
            value={heroAuthor}
            onChange={(event) => onSetHeroAuthor(event.target.value)}
            placeholder={t`Author (optional)`}
            className="rounded-lg border border-violet-300/30 bg-black/40 px-3 py-2 text-xs text-zinc-100 outline-none transition-colors focus:border-violet-400/60"
          />
          <textarea
            value={heroDescription}
            onChange={(event) => onSetHeroDescription(event.target.value)}
            placeholder={t`Description (optional)`}
            className="min-h-16 resize-y rounded-lg border border-violet-300/30 bg-black/40 px-3 py-2 text-xs text-zinc-100 outline-none transition-colors focus:border-violet-400/60"
          />
        </div>

        {sourceMode === "installed" && (
          <div className="mt-2">
            <label className="flex cursor-pointer items-center gap-2 py-1">
              <input
                type="checkbox"
                checked={deleteSourceRound}
                onChange={(event) => onSetDeleteSourceRound(event.target.checked)}
                className="h-3.5 w-3.5 accent-violet-400"
              />
              <span className="text-[11px] text-zinc-300">
                <Trans>Delete source round after save</Trans>{" "}
                <span className="text-violet-300">
                  (<Trans>recommended</Trans>)
                </span>
              </span>
            </label>
          </div>
        )}

        <button
          type="button"
          disabled={isSaving || !canSave}
          onMouseEnter={playHoverSound}
          onClick={() => {
            playSelectSound();
            onSave();
          }}
          className={`mt-3 w-full rounded-lg border px-3 py-2 text-xs font-semibold transition-all duration-200 ${
            isSaving || !canSave
              ? "cursor-not-allowed border-zinc-600 bg-zinc-800 text-zinc-500"
              : "border-emerald-300/60 bg-emerald-500/30 text-emerald-100 hover:bg-emerald-500/45"
          }`}
        >
          {isSaving ? t`Saving...` : t`Save Rounds to Hero`}
          {!isSaving && <kbd className="converter-kbd ml-1">Ctrl/Cmd+S</kbd>}
        </button>
      </div>
    );
  }
);

HeroPanel.displayName = "HeroPanel";

export function pickHeroPanelProps(state: ConverterState): HeroPanelProps {
  return {
    heroName: state.heroName,
    heroAuthor: state.heroAuthor,
    heroDescription: state.heroDescription,
    sourceMode: state.sourceMode,
    deleteSourceRound: state.deleteSourceRound,
    canSave: state.canSave,
    isSaving: state.isSaving,
    onSetHeroName: state.setHeroName,
    onSetHeroAuthor: state.setHeroAuthor,
    onSetHeroDescription: state.setHeroDescription,
    onSetDeleteSourceRound: state.setDeleteSourceRound,
    onSave: () => void state.saveConvertedRounds(),
  };
}
