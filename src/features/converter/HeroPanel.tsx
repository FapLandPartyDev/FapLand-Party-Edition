import React from "react";
import { playHoverSound, playSelectSound } from "../../utils/audio";
import type { ConverterState } from "./useConverterState";

type HeroPanelProps = {
    heroOptions: ConverterState["heroOptions"];
    selectedHeroId: string;
    heroName: string;
    heroAuthor: string;
    heroDescription: string;
    sourceMode: "local" | "installed";
    selectedInstalledOption: ConverterState["selectedInstalledOption"];
    deleteSourceRound: boolean;
    canSave: boolean;
    isSaving: boolean;
    onSetSelectedHeroId: (id: string) => void;
    onLoadSelectedHero: () => void;
    onSetHeroName: (value: string) => void;
    onSetHeroAuthor: (value: string) => void;
    onSetHeroDescription: (value: string) => void;
    onSetDeleteSourceRound: (value: boolean) => void;
    onSave: () => void;
};

export const HeroPanel: React.FC<HeroPanelProps> = React.memo(
    ({
        heroOptions,
        selectedHeroId,
        heroName,
        heroAuthor,
        heroDescription,
        sourceMode,
        selectedInstalledOption,
        deleteSourceRound,
        canSave,
        isSaving,
        onSetSelectedHeroId,
        onLoadSelectedHero,
        onSetHeroName,
        onSetHeroAuthor,
        onSetHeroDescription,
        onSetDeleteSourceRound,
        onSave,
    }) => (
        <div className="converter-panel-glass rounded-2xl p-4">
            <h2 className="mb-3 text-lg font-bold text-violet-100">Hero + Save</h2>

            {/* Hero picker */}
            <div className="mb-3 grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
                <div className="relative">
                    <select
                        value={selectedHeroId}
                        onChange={(event) => {
                            onSetSelectedHeroId(event.target.value);
                            playSelectSound();
                        }}
                        className="converter-native-select converter-select-field w-full border-cyan-300/35 hover:border-cyan-200/55 focus:border-cyan-200/75 focus:ring-cyan-400/30"
                    >
                        <option value="">Load Existing Hero</option>
                        {heroOptions.map((option) => (
                            <option key={option.id} value={option.id}>
                                {option.label}
                            </option>
                        ))}
                    </select>
                    <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-cyan-200/80">
                        ▾
                    </span>
                </div>
                <button
                    type="button"
                    onMouseEnter={playHoverSound}
                    onClick={onLoadSelectedHero}
                    className="converter-action-button border-cyan-300/60 bg-cyan-500/20 px-4 text-cyan-100 hover:bg-cyan-500/35 hover:shadow-[0_0_18px_rgba(34,211,238,0.25)]"
                >
                    Load Hero
                </button>
            </div>

            {/* Hero fields */}
            <div className="grid grid-cols-1 gap-2">
                <input
                    value={heroName}
                    onChange={(event) => onSetHeroName(event.target.value)}
                    placeholder="Hero name"
                    className="converter-text-input"
                />
                <input
                    value={heroAuthor}
                    onChange={(event) => onSetHeroAuthor(event.target.value)}
                    placeholder="Hero author (optional)"
                    className="converter-text-input"
                />
                <textarea
                    value={heroDescription}
                    onChange={(event) => onSetHeroDescription(event.target.value)}
                    placeholder="Hero description (optional)"
                    className="converter-text-input min-h-20 resize-y"
                />
            </div>

            {/* Delete source round checkbox */}
            {sourceMode === "installed" && selectedInstalledOption && (
                <div className="mt-3 space-y-2">
                    <label className="flex cursor-pointer items-start gap-2 rounded-xl border border-zinc-700/80 bg-black/35 px-3 py-2 transition-colors hover:border-zinc-600">
                        <input
                            type="checkbox"
                            checked={deleteSourceRound}
                            onChange={(event) => onSetDeleteSourceRound(event.target.checked)}
                            className="mt-0.5 h-4 w-4 accent-violet-400"
                        />
                        <span className="text-xs text-zinc-200">
                            Delete source round entry after save <span className="text-violet-200">(recommended)</span>
                        </span>
                    </label>
                    <p className="text-[11px] text-zinc-400">
                        This only affects round entries in the app library/database. No video or funscript files are deleted
                        from disk.
                    </p>
                    {!deleteSourceRound && (
                        <div className="rounded-lg border border-amber-300/45 bg-amber-500/15 px-3 py-2 text-[11px] text-amber-100">
                            Recommended: enable deletion to avoid duplicate rounds. If disabled, the source round stays and
                            converted rounds are still saved to the selected hero.
                        </div>
                    )}
                </div>
            )}

            {/* Save button */}
            <button
                type="button"
                disabled={isSaving || !canSave}
                onMouseEnter={playHoverSound}
                onClick={() => {
                    playSelectSound();
                    onSave();
                }}
                className={`mt-4 w-full rounded-xl border px-4 py-2.5 text-sm font-semibold transition-all duration-200 ${isSaving || !canSave
                        ? "cursor-not-allowed border-zinc-600 bg-zinc-800 text-zinc-500"
                        : "border-emerald-300/60 bg-emerald-500/30 text-emerald-100 hover:bg-emerald-500/45 hover:shadow-[0_0_24px_rgba(52,211,153,0.3)]"
                    }`}
            >
                {isSaving ? "Saving..." : "Save Rounds to Hero"}
            </button>
        </div>
    ),
);

HeroPanel.displayName = "HeroPanel";

export function pickHeroPanelProps(state: ConverterState): HeroPanelProps {
    return {
        heroOptions: state.heroOptions,
        selectedHeroId: state.selectedHeroId,
        heroName: state.heroName,
        heroAuthor: state.heroAuthor,
        heroDescription: state.heroDescription,
        sourceMode: state.sourceMode,
        selectedInstalledOption: state.selectedInstalledOption,
        deleteSourceRound: state.deleteSourceRound,
        canSave: state.canSave,
        isSaving: state.isSaving,
        onSetSelectedHeroId: state.setSelectedHeroId,
        onLoadSelectedHero: state.loadSelectedHero,
        onSetHeroName: state.setHeroName,
        onSetHeroAuthor: state.setHeroAuthor,
        onSetHeroDescription: state.setHeroDescription,
        onSetDeleteSourceRound: state.setDeleteSourceRound,
        onSave: () => void state.saveConvertedRounds(),
    };
}
