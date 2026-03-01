import React from "react";
import { playHoverSound } from "../../../utils/audio";
import type { InstalledRound } from "../../../services/db";
import type { EditorGraphConfig } from "../EditorState";
import { resolvePortableRoundRef } from "../../../game/playlistRuntime";
import type { PerkDefinition } from "../../../game/types";

interface GraphSettingsPanelProps {
    perkSelection: EditorGraphConfig["perkSelection"];
    perkPool: EditorGraphConfig["perkPool"];
    probabilityScaling: EditorGraphConfig["probabilityScaling"];
    economy: EditorGraphConfig["economy"];
    perkOptions: ReadonlyArray<PerkDefinition>;
    antiPerkOptions: ReadonlyArray<PerkDefinition>;
    cumRoundRefs: EditorGraphConfig["cumRoundRefs"];
    cumRounds: ReadonlyArray<InstalledRound>;
    installedRounds: ReadonlyArray<InstalledRound>;
    selectedCumRoundIdSet: ReadonlySet<string>;
    onSetPerkTriggerChance: (value: number) => void;
    onSetProbabilityScaling: (key: keyof EditorGraphConfig["probabilityScaling"], value: number) => void;
    onSetCumRoundBonusScore: (value: number) => void;
    onTogglePerk: (perkId: string) => void;
    onToggleAntiPerk: (perkId: string) => void;
    onSetAllPerksEnabled: (enabled: boolean) => void;
    onSetAllAntiPerksEnabled: (enabled: boolean) => void;
    onToggleCumRound: (round: InstalledRound) => void;
    onMoveCumRound: (roundId: string, direction: -1 | 1) => void;
    onRemoveCumRoundByIndex: (index: number) => void;
}

const percent = (value: number): number => Math.round(value * 100);
const toRatio = (value: string): number => Math.max(0, Math.min(100, Number.parseInt(value, 10) || 0)) / 100;

function renderPerkToggleList(
    options: ReadonlyArray<PerkDefinition>,
    enabledIds: ReadonlyArray<string>,
    accent: "emerald" | "rose",
    emptyLabel: string,
    onToggle: (perkId: string) => void,
) {
    const enabledSet = new Set(enabledIds);
    if (options.length === 0) {
        return (
            <p className="rounded-lg border border-dashed border-zinc-700/50 px-3 py-3 text-center text-[11px] text-zinc-600">
                {emptyLabel}
            </p>
        );
    }

    return (
        <div className="space-y-1.5">
            {options.map((perk) => {
                const selected = enabledSet.has(perk.id);
                return (
                    <button
                        key={perk.id}
                        type="button"
                        aria-pressed={selected}
                        className={`block w-full rounded-lg border px-2.5 py-2 text-left text-xs transition-all ${selected
                            ? accent === "emerald"
                                ? "border-emerald-400/45 bg-emerald-500/10 text-emerald-100"
                                : "border-rose-400/45 bg-rose-500/10 text-rose-100"
                            : "border-zinc-700/40 text-zinc-400 hover:border-zinc-600/50 hover:text-zinc-300"
                            }`}
                        onMouseEnter={playHoverSound}
                        onClick={() => onToggle(perk.id)}
                    >
                        <div className="flex items-center justify-between gap-2">
                            <span className="truncate">{perk.name}</span>
                            <span className={`flex-shrink-0 rounded border px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${selected
                                ? accent === "emerald"
                                    ? "border-emerald-300/45 bg-emerald-500/20 text-emerald-100"
                                    : "border-rose-300/45 bg-rose-500/20 text-rose-100"
                                : "border-zinc-700/50 bg-zinc-900/70 text-zinc-400"
                                }`}>
                                {selected ? "Active" : "Inactive"}
                            </span>
                        </div>
                    </button>
                );
            })}
        </div>
    );
}

export const GraphSettingsPanel: React.FC<GraphSettingsPanelProps> = React.memo(({
    perkSelection,
    perkPool,
    probabilityScaling,
    economy,
    perkOptions,
    antiPerkOptions,
    cumRoundRefs,
    cumRounds,
    installedRounds,
    selectedCumRoundIdSet,
    onSetPerkTriggerChance,
    onSetProbabilityScaling,
    onSetCumRoundBonusScore,
    onTogglePerk,
    onToggleAntiPerk,
    onSetAllPerksEnabled,
    onSetAllAntiPerksEnabled,
    onToggleCumRound,
    onMoveCumRound,
    onRemoveCumRoundByIndex,
}) => (
    <div className="space-y-3 p-3">
        <div className="space-y-2 rounded-xl border border-zinc-700/40 bg-zinc-950/40 p-3">
            <div>
                <p className="text-[11px] font-medium uppercase tracking-[0.1em] text-zinc-500">Perk Rates</p>
                <p className="mt-1 text-[11px] text-zinc-600">Match the singleplayer trigger and per-round chance growth.</p>
            </div>
            <label className="block space-y-1">
                <span className="text-[11px] font-medium uppercase tracking-[0.1em] text-zinc-500">Random perk selection chance</span>
                <input
                    aria-label="Random perk selection chance"
                    type="number"
                    min={0}
                    max={100}
                    step={1}
                    value={percent(perkSelection.triggerChancePerCompletedRound)}
                    onChange={(event) => onSetPerkTriggerChance(toRatio(event.target.value))}
                    className="w-full rounded-lg border border-zinc-700/50 bg-zinc-950 px-2.5 py-2 text-sm text-zinc-100 outline-none transition focus:border-cyan-400/50"
                />
                <p className="text-[10px] text-zinc-600">Percent chance after each completed round.</p>
            </label>
            <div className="grid gap-2 sm:grid-cols-2">
                <label className="block space-y-1">
                    <span className="text-[11px] font-medium uppercase tracking-[0.1em] text-zinc-500">Intermediary initial</span>
                    <input
                        aria-label="Intermediary initial"
                        type="number"
                        min={0}
                        max={100}
                        step={1}
                        value={percent(probabilityScaling.initialIntermediaryProbability)}
                        onChange={(event) => onSetProbabilityScaling("initialIntermediaryProbability", toRatio(event.target.value))}
                        className="w-full rounded-lg border border-zinc-700/50 bg-zinc-950 px-2.5 py-2 text-sm text-zinc-100 outline-none transition focus:border-cyan-400/50"
                    />
                    <p className="text-[10px] text-zinc-600">Starting percent chance.</p>
                </label>
                <label className="block space-y-1">
                    <span className="text-[11px] font-medium uppercase tracking-[0.1em] text-zinc-500">Intermediary increase</span>
                    <input
                        aria-label="Intermediary increase"
                        type="number"
                        min={0}
                        max={100}
                        step={1}
                        value={percent(probabilityScaling.intermediaryIncreasePerRound)}
                        onChange={(event) => onSetProbabilityScaling("intermediaryIncreasePerRound", toRatio(event.target.value))}
                        className="w-full rounded-lg border border-zinc-700/50 bg-zinc-950 px-2.5 py-2 text-sm text-zinc-100 outline-none transition focus:border-cyan-400/50"
                    />
                    <p className="text-[10px] text-zinc-600">Percent added per round.</p>
                </label>
                <label className="block space-y-1">
                    <span className="text-[11px] font-medium uppercase tracking-[0.1em] text-zinc-500">Intermediary max</span>
                    <input
                        aria-label="Intermediary max"
                        type="number"
                        min={0}
                        max={100}
                        step={1}
                        value={percent(probabilityScaling.maxIntermediaryProbability)}
                        onChange={(event) => onSetProbabilityScaling("maxIntermediaryProbability", toRatio(event.target.value))}
                        className="w-full rounded-lg border border-zinc-700/50 bg-zinc-950 px-2.5 py-2 text-sm text-zinc-100 outline-none transition focus:border-cyan-400/50"
                    />
                    <p className="text-[10px] text-zinc-600">Highest intermediary chance allowed.</p>
                </label>
                <label className="block space-y-1">
                    <span className="text-[11px] font-medium uppercase tracking-[0.1em] text-zinc-500">Anti-perk initial</span>
                    <input
                        aria-label="Anti-perk initial"
                        type="number"
                        min={0}
                        max={100}
                        step={1}
                        value={percent(probabilityScaling.initialAntiPerkProbability)}
                        onChange={(event) => onSetProbabilityScaling("initialAntiPerkProbability", toRatio(event.target.value))}
                        className="w-full rounded-lg border border-zinc-700/50 bg-zinc-950 px-2.5 py-2 text-sm text-zinc-100 outline-none transition focus:border-cyan-400/50"
                    />
                    <p className="text-[10px] text-zinc-600">Starting percent chance.</p>
                </label>
                <label className="block space-y-1">
                    <span className="text-[11px] font-medium uppercase tracking-[0.1em] text-zinc-500">Anti-perk increase</span>
                    <input
                        aria-label="Anti-perk increase"
                        type="number"
                        min={0}
                        max={100}
                        step={1}
                        value={percent(probabilityScaling.antiPerkIncreasePerRound)}
                        onChange={(event) => onSetProbabilityScaling("antiPerkIncreasePerRound", toRatio(event.target.value))}
                        className="w-full rounded-lg border border-zinc-700/50 bg-zinc-950 px-2.5 py-2 text-sm text-zinc-100 outline-none transition focus:border-cyan-400/50"
                    />
                    <p className="text-[10px] text-zinc-600">Percent added per round.</p>
                </label>
                <label className="block space-y-1">
                    <span className="text-[11px] font-medium uppercase tracking-[0.1em] text-zinc-500">Anti-perk max</span>
                    <input
                        aria-label="Anti-perk max"
                        type="number"
                        min={0}
                        max={100}
                        step={1}
                        value={percent(probabilityScaling.maxAntiPerkProbability)}
                        onChange={(event) => onSetProbabilityScaling("maxAntiPerkProbability", toRatio(event.target.value))}
                        className="w-full rounded-lg border border-zinc-700/50 bg-zinc-950 px-2.5 py-2 text-sm text-zinc-100 outline-none transition focus:border-cyan-400/50"
                    />
                    <p className="text-[10px] text-zinc-600">Highest anti-perk chance allowed.</p>
                </label>
                <label className="block space-y-1 sm:col-span-2">
                    <span className="text-[11px] font-medium uppercase tracking-[0.1em] text-zinc-500">Cum round bonus score</span>
                    <input
                        aria-label="Cum round bonus score"
                        type="number"
                        min={0}
                        max={100000}
                        step={1}
                        value={economy.scorePerCumRoundSuccess}
                        onChange={(event) => onSetCumRoundBonusScore(Number.parseInt(event.target.value, 10) || 0)}
                        className="w-full rounded-lg border border-zinc-700/50 bg-zinc-950 px-2.5 py-2 text-sm text-zinc-100 outline-none transition focus:border-cyan-400/50"
                    />
                    <p className="text-[10px] text-zinc-600">Score awarded when a cum round succeeds.</p>
                </label>
            </div>
        </div>

        <div className="space-y-2 rounded-xl border border-zinc-700/40 bg-zinc-950/40 p-3">
            <div className="flex items-center justify-between gap-2">
                <div>
                    <p className="text-[11px] font-medium uppercase tracking-[0.1em] text-zinc-500">Perks</p>
                    <p className="mt-1 text-[11px] text-zinc-600">{perkPool.enabledPerkIds.length}/{perkOptions.length} active</p>
                </div>
                <div className="flex gap-1.5">
                    <button
                        type="button"
                        className="rounded border border-emerald-500/30 px-2 py-1 text-[10px] uppercase tracking-wide text-emerald-200 transition-colors hover:bg-emerald-500/10"
                        onClick={() => onSetAllPerksEnabled(true)}
                    >
                        Activate all
                    </button>
                    <button
                        type="button"
                        className="rounded border border-zinc-700/40 px-2 py-1 text-[10px] uppercase tracking-wide text-zinc-300 transition-colors hover:bg-zinc-800/70"
                        onClick={() => onSetAllPerksEnabled(false)}
                    >
                        Deactivate all
                    </button>
                </div>
            </div>
            {renderPerkToggleList(perkOptions, perkPool.enabledPerkIds, "emerald", "No perks available.", onTogglePerk)}
        </div>

        <div className="space-y-2 rounded-xl border border-zinc-700/40 bg-zinc-950/40 p-3">
            <div className="flex items-center justify-between gap-2">
                <div>
                    <p className="text-[11px] font-medium uppercase tracking-[0.1em] text-zinc-500">Anti-Perks</p>
                    <p className="mt-1 text-[11px] text-zinc-600">{perkPool.enabledAntiPerkIds.length}/{antiPerkOptions.length} active</p>
                </div>
                <div className="flex gap-1.5">
                    <button
                        type="button"
                        className="rounded border border-rose-500/30 px-2 py-1 text-[10px] uppercase tracking-wide text-rose-200 transition-colors hover:bg-rose-500/10"
                        onClick={() => onSetAllAntiPerksEnabled(true)}
                    >
                        Activate all
                    </button>
                    <button
                        type="button"
                        className="rounded border border-zinc-700/40 px-2 py-1 text-[10px] uppercase tracking-wide text-zinc-300 transition-colors hover:bg-zinc-800/70"
                        onClick={() => onSetAllAntiPerksEnabled(false)}
                    >
                        Deactivate all
                    </button>
                </div>
            </div>
            {renderPerkToggleList(antiPerkOptions, perkPool.enabledAntiPerkIds, "rose", "No anti-perks available.", onToggleAntiPerk)}
        </div>

        <div>
            <p className="text-[11px] font-medium uppercase tracking-[0.1em] text-zinc-500">Cum Rounds</p>
            <p className="mt-1 text-[11px] text-zinc-600">Landing on any end node queues these rounds in order.</p>
        </div>

        {/* ── Selected cum rounds ─────────────────── */}
        <div className="space-y-1.5">
            {cumRoundRefs.length === 0 && (
                <p className="rounded-lg border border-dashed border-zinc-700/50 px-3 py-3 text-center text-[11px] text-zinc-600">
                    No cum rounds selected.
                </p>
            )}
            {cumRoundRefs.map((ref, index) => {
                const resolved = resolvePortableRoundRef(ref, installedRounds);
                const roundId = resolved?.id ?? ref.idHint ?? `cum-ref-${index}`;
                return (
                    <div key={`${roundId}-${index}`} className="flex items-center gap-2 rounded-lg border border-zinc-700/40 bg-zinc-950/50 px-2.5 py-2">
                        <div className="min-w-0 flex-1">
                            <p className="truncate text-xs text-zinc-200">{resolved?.name ?? ref.name}</p>
                            {!resolved && (
                                <p className="text-[10px] text-amber-400/70">Unresolved</p>
                            )}
                        </div>
                        <div className="flex flex-shrink-0 items-center gap-1">
                            <button
                                type="button"
                                className="rounded border border-zinc-700/40 px-1.5 py-0.5 text-[10px] text-zinc-400 transition-colors hover:text-zinc-200 disabled:opacity-30"
                                onClick={() => onMoveCumRound(roundId, -1)}
                                disabled={index === 0}
                            >
                                ↑
                            </button>
                            <button
                                type="button"
                                className="rounded border border-zinc-700/40 px-1.5 py-0.5 text-[10px] text-zinc-400 transition-colors hover:text-zinc-200 disabled:opacity-30"
                                onClick={() => onMoveCumRound(roundId, 1)}
                                disabled={index === cumRoundRefs.length - 1}
                            >
                                ↓
                            </button>
                            <button
                                type="button"
                                className="rounded border border-rose-500/30 px-1.5 py-0.5 text-[10px] text-rose-300 transition-colors hover:bg-rose-500/10"
                                onClick={() => {
                                    const round = cumRounds.find((entry) => entry.id === roundId);
                                    if (round) {
                                        onToggleCumRound(round);
                                        return;
                                    }
                                    onRemoveCumRoundByIndex(index);
                                }}
                            >
                                ✕
                            </button>
                        </div>
                    </div>
                );
            })}
        </div>

        {/* ── Available cum rounds ─────────────────── */}
        <div className="space-y-1.5">
            <p className="text-[11px] font-medium uppercase tracking-[0.1em] text-zinc-500">Available</p>
            {cumRounds.map((round) => {
                const selected = selectedCumRoundIdSet.has(round.id);
                return (
                    <button
                        key={round.id}
                        type="button"
                        className={`block w-full rounded-lg border px-2.5 py-2 text-left text-xs transition-all ${selected
                            ? "border-cyan-500/40 bg-cyan-500/10 text-cyan-200"
                            : "border-zinc-700/40 text-zinc-400 hover:border-zinc-600/50 hover:text-zinc-300"
                            }`}
                        onMouseEnter={playHoverSound}
                        onClick={() => onToggleCumRound(round)}
                    >
                        <div className="flex items-center justify-between gap-2">
                            <span className="truncate">{round.name}</span>
                            <span className="flex-shrink-0 text-[10px] uppercase tracking-wide text-zinc-600">
                                {selected ? "✓" : "+"}
                            </span>
                        </div>
                    </button>
                );
            })}
            {cumRounds.length === 0 && (
                <p className="rounded-lg border border-dashed border-zinc-700/50 px-3 py-3 text-center text-[11px] text-zinc-600">
                    No installed cum rounds found.
                </p>
            )}
        </div>
    </div>
));

GraphSettingsPanel.displayName = "GraphSettingsPanel";
