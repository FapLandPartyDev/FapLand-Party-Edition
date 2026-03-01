import React from "react";
import { playHoverSound } from "../../../utils/audio";
import { useSfwMode } from "../../../hooks/useSfwMode";
import type { InstalledRound } from "../../../services/db";
import { abbreviateNsfwText } from "../../../utils/sfwText";
import type { EditorGraphConfig } from "../EditorState";
import { resolvePortableRoundRef } from "../../../game/playlistRuntime";
import type { PerkDefinition } from "../../../game/types";

interface GraphSettingsPanelProps {
  perkSelection: EditorGraphConfig["perkSelection"];
  perkPool: EditorGraphConfig["perkPool"];
  probabilityScaling: EditorGraphConfig["probabilityScaling"];
  economy: EditorGraphConfig["economy"];
  dice: EditorGraphConfig["dice"];
  saveMode: EditorGraphConfig["saveMode"];
  perkOptions: ReadonlyArray<PerkDefinition>;
  antiPerkOptions: ReadonlyArray<PerkDefinition>;
  cumRoundRefs: EditorGraphConfig["cumRoundRefs"];
  cumRounds: ReadonlyArray<InstalledRound>;
  installedRounds: ReadonlyArray<InstalledRound>;
  selectedCumRoundIdSet: ReadonlySet<string>;
  onSetPerkTriggerChance: (value: number) => void;
  onSetProbabilityScaling: (
    key: keyof EditorGraphConfig["probabilityScaling"],
    value: number
  ) => void;
  onSetDiceLimit: (key: keyof EditorGraphConfig["dice"], value: number) => void;
  onSetSaveMode: (value: EditorGraphConfig["saveMode"]) => void;
  onSetStartingMoney: (value: number) => void;
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
const toRatio = (value: string): number =>
  Math.max(0, Math.min(100, Number.parseInt(value, 10) || 0)) / 100;

function renderPerkToggleList(
  options: ReadonlyArray<PerkDefinition>,
  enabledIds: ReadonlyArray<string>,
  accent: "emerald" | "rose",
  emptyLabel: string,
  onToggle: (perkId: string) => void
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
              <span className="flex items-center gap-1.5 truncate">
                <span className="truncate">{perk.name}</span>
                {perk.requiresHandy && (
                  <span className="flex-shrink-0 rounded border border-amber-500/40 bg-amber-500/15 px-1 py-0.5 text-[8px] font-medium uppercase tracking-[0.04em] text-amber-200/90">
                    Device
                  </span>
                )}
              </span>
              <span
                className={`flex-shrink-0 rounded border px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${selected
                    ? accent === "emerald"
                      ? "border-emerald-300/45 bg-emerald-500/20 text-emerald-100"
                      : "border-rose-300/45 bg-rose-500/20 text-rose-100"
                    : "border-zinc-700/50 bg-zinc-900/70 text-zinc-400"
                  }`}
              >
                {selected ? "Active" : "Inactive"}
              </span>
            </div>
          </button>
        );
      })}
    </div>
  );
}

export const GraphSettingsPanel: React.FC<GraphSettingsPanelProps> = React.memo(
  ({
    perkSelection,
    perkPool,
    probabilityScaling,
    economy,
    dice,
    saveMode,
    perkOptions,
    antiPerkOptions,
    cumRoundRefs,
    cumRounds,
    installedRounds,
    selectedCumRoundIdSet,
    onSetPerkTriggerChance,
    onSetProbabilityScaling,
    onSetDiceLimit,
    onSetSaveMode,
    onSetStartingMoney,
    onSetCumRoundBonusScore,
    onTogglePerk,
    onToggleAntiPerk,
    onSetAllPerksEnabled,
    onSetAllAntiPerksEnabled,
    onToggleCumRound,
    onMoveCumRound,
    onRemoveCumRoundByIndex,
  }) => {
    const sfwMode = useSfwMode();

    return (
    <div className="space-y-3 p-3">
      <div className="space-y-3 rounded-xl border border-zinc-700/40 bg-zinc-950/40 p-3">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-[0.1em] text-zinc-500">
            Dice Roll Limits
          </p>
          <p className="mt-1 text-[11px] text-zinc-600">
            Controls the range of the dice used for movement.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label className="block space-y-1">
            <span className="text-[11px] font-medium uppercase tracking-[0.1em] text-zinc-500">
              Minimum Roll
            </span>
            <input
              aria-label="Minimum Roll"
              type="number"
              min={1}
              max={20}
              step={1}
              value={dice.min}
              onChange={(event) =>
                onSetDiceLimit("min", Number.parseInt(event.target.value, 10) || 1)
              }
              className="w-full rounded-lg border border-zinc-700/50 bg-zinc-950 px-2.5 py-2 text-sm text-zinc-100 outline-none transition focus:border-cyan-400/50"
            />
          </label>
          <label className="block space-y-1">
            <span className="text-[11px] font-medium uppercase tracking-[0.1em] text-zinc-500">
              Maximum Roll
            </span>
            <input
              aria-label="Maximum Roll"
              type="number"
              min={1}
              max={20}
              step={1}
              value={dice.max}
              onChange={(event) =>
                onSetDiceLimit("max", Number.parseInt(event.target.value, 10) || 6)
              }
              className="w-full rounded-lg border border-zinc-700/50 bg-zinc-950 px-2.5 py-2 text-sm text-zinc-100 outline-none transition focus:border-cyan-400/50"
            />
          </label>
        </div>
      </div>

      <div className="space-y-3 rounded-xl border border-zinc-700/40 bg-zinc-950/40 p-3">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-[0.1em] text-zinc-500">
            Save Mode
          </p>
          <p className="mt-1 text-[11px] text-zinc-600">
            Save-enabled runs are marked as assisted in local highscores and run history.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {[
            { value: "none" as const, label: "No Saves" },
            { value: "checkpoint" as const, label: "Only Checkpoint" },
            { value: "everywhere" as const, label: "Everywhere", fullWidth: true },
          ].map((option) => (
            <button
              key={option.value}
              type="button"
              onMouseEnter={playHoverSound}
              onClick={() => onSetSaveMode(option.value)}
              className={`min-w-0 rounded-lg border px-2.5 py-2 text-sm leading-tight whitespace-normal transition ${
                option.fullWidth ? "col-span-2 " : ""
              }${
                saveMode === option.value
                  ? "border-cyan-400/60 bg-cyan-500/15 text-cyan-100"
                  : "border-zinc-700/50 bg-zinc-950 text-zinc-300"
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
        {saveMode !== "none" && (
          <p className="rounded-lg border border-amber-300/25 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-200">
            {saveMode === "checkpoint" ? "🚩" : "💾"} Warning: runs from this playlist are marked
            as assisted on the highscore and in run history.
          </p>
        )}
      </div>

      <div className="space-y-2 rounded-xl border border-zinc-700/40 bg-zinc-950/40 p-3">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-[0.1em] text-zinc-500">
            Perk Rates
          </p>
          <p className="mt-1 text-[11px] text-zinc-600">
            Match the singleplayer trigger and per-round chance growth.
          </p>
        </div>
        <label className="block space-y-1">
          <span className="text-[11px] font-medium uppercase tracking-[0.1em] text-zinc-500">
            Random perk selection chance
          </span>
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
            <span className="text-[11px] font-medium uppercase tracking-[0.1em] text-zinc-500">
              Intermediary initial
            </span>
            <input
              aria-label="Intermediary initial"
              type="number"
              min={0}
              max={100}
              step={1}
              value={percent(probabilityScaling.initialIntermediaryProbability)}
              onChange={(event) =>
                onSetProbabilityScaling(
                  "initialIntermediaryProbability",
                  toRatio(event.target.value)
                )
              }
              className="w-full rounded-lg border border-zinc-700/50 bg-zinc-950 px-2.5 py-2 text-sm text-zinc-100 outline-none transition focus:border-cyan-400/50"
            />
            <p className="text-[10px] text-zinc-600">Starting percent chance.</p>
          </label>
          <label className="block space-y-1">
            <span className="text-[11px] font-medium uppercase tracking-[0.1em] text-zinc-500">
              Intermediary increase
            </span>
            <input
              aria-label="Intermediary increase"
              type="number"
              min={0}
              max={100}
              step={1}
              value={percent(probabilityScaling.intermediaryIncreasePerRound)}
              onChange={(event) =>
                onSetProbabilityScaling("intermediaryIncreasePerRound", toRatio(event.target.value))
              }
              className="w-full rounded-lg border border-zinc-700/50 bg-zinc-950 px-2.5 py-2 text-sm text-zinc-100 outline-none transition focus:border-cyan-400/50"
            />
            <p className="text-[10px] text-zinc-600">Percent added per round.</p>
          </label>
          <label className="block space-y-1">
            <span className="text-[11px] font-medium uppercase tracking-[0.1em] text-zinc-500">
              Intermediary max
            </span>
            <input
              aria-label="Intermediary max"
              type="number"
              min={0}
              max={100}
              step={1}
              value={percent(probabilityScaling.maxIntermediaryProbability)}
              onChange={(event) =>
                onSetProbabilityScaling("maxIntermediaryProbability", toRatio(event.target.value))
              }
              className="w-full rounded-lg border border-zinc-700/50 bg-zinc-950 px-2.5 py-2 text-sm text-zinc-100 outline-none transition focus:border-cyan-400/50"
            />
            <p className="text-[10px] text-zinc-600">Highest intermediary chance allowed.</p>
          </label>
          <label className="block space-y-1">
            <span className="text-[11px] font-medium uppercase tracking-[0.1em] text-zinc-500">
              Anti-perk initial
            </span>
            <input
              aria-label="Anti-perk initial"
              type="number"
              min={0}
              max={100}
              step={1}
              value={percent(probabilityScaling.initialAntiPerkProbability)}
              onChange={(event) =>
                onSetProbabilityScaling("initialAntiPerkProbability", toRatio(event.target.value))
              }
              className="w-full rounded-lg border border-zinc-700/50 bg-zinc-950 px-2.5 py-2 text-sm text-zinc-100 outline-none transition focus:border-cyan-400/50"
            />
            <p className="text-[10px] text-zinc-600">Starting percent chance.</p>
          </label>
          <label className="block space-y-1">
            <span className="text-[11px] font-medium uppercase tracking-[0.1em] text-zinc-500">
              Anti-perk increase
            </span>
            <input
              aria-label="Anti-perk increase"
              type="number"
              min={0}
              max={100}
              step={1}
              value={percent(probabilityScaling.antiPerkIncreasePerRound)}
              onChange={(event) =>
                onSetProbabilityScaling("antiPerkIncreasePerRound", toRatio(event.target.value))
              }
              className="w-full rounded-lg border border-zinc-700/50 bg-zinc-950 px-2.5 py-2 text-sm text-zinc-100 outline-none transition focus:border-cyan-400/50"
            />
            <p className="text-[10px] text-zinc-600">Percent added per round.</p>
          </label>
          <label className="block space-y-1">
            <span className="text-[11px] font-medium uppercase tracking-[0.1em] text-zinc-500">
              Anti-perk max
            </span>
            <input
              aria-label="Anti-perk max"
              type="number"
              min={0}
              max={100}
              step={1}
              value={percent(probabilityScaling.maxAntiPerkProbability)}
              onChange={(event) =>
                onSetProbabilityScaling("maxAntiPerkProbability", toRatio(event.target.value))
              }
              className="w-full rounded-lg border border-zinc-700/50 bg-zinc-950 px-2.5 py-2 text-sm text-zinc-100 outline-none transition focus:border-cyan-400/50"
            />
            <p className="text-[10px] text-zinc-600">Highest anti-perk chance allowed.</p>
          </label>
          <label className="block space-y-1 sm:col-span-2">
            <span className="text-[11px] font-medium uppercase tracking-[0.1em] text-zinc-500">
              Starting Money
            </span>
            <input
              aria-label="Starting Money"
              type="number"
              min={0}
              max={100000}
              step={1}
              value={economy.startingMoney}
              onChange={(event) =>
                onSetStartingMoney(Number.parseInt(event.target.value, 10) || 0)
              }
              className="w-full rounded-lg border border-zinc-700/50 bg-zinc-950 px-2.5 py-2 text-sm text-zinc-100 outline-none transition focus:border-cyan-400/50"
            />
            <p className="text-[10px] text-zinc-600">
              Money available at the start of a new run from this playlist.
            </p>
          </label>
          <label className="block space-y-1 sm:col-span-2">
            <span className="text-[11px] font-medium uppercase tracking-[0.1em] text-zinc-500">
              {abbreviateNsfwText("Cum round bonus score", sfwMode)}
            </span>
            <input
              aria-label={abbreviateNsfwText("Cum round bonus score", sfwMode)}
              type="number"
              min={0}
              max={100000}
              step={1}
              value={economy.scorePerCumRoundSuccess}
              onChange={(event) =>
                onSetCumRoundBonusScore(Number.parseInt(event.target.value, 10) || 0)
              }
              className="w-full rounded-lg border border-zinc-700/50 bg-zinc-950 px-2.5 py-2 text-sm text-zinc-100 outline-none transition focus:border-cyan-400/50"
            />
            <p className="text-[10px] text-zinc-600">
              {abbreviateNsfwText("Score awarded when a cum round succeeds.", sfwMode)}
            </p>
          </label>
        </div>
      </div>

      <div className="space-y-2 rounded-xl border border-zinc-700/40 bg-zinc-950/40 p-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-[0.1em] text-zinc-500">
              Perks
            </p>
            <p className="mt-1 text-[11px] text-zinc-600">
              {perkPool.enabledPerkIds.length}/{perkOptions.length} active
            </p>
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
        {renderPerkToggleList(
          perkOptions,
          perkPool.enabledPerkIds,
          "emerald",
          "No perks available.",
          onTogglePerk
        )}
      </div>

      <div className="space-y-2 rounded-xl border border-zinc-700/40 bg-zinc-950/40 p-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-[0.1em] text-zinc-500">
              Anti-Perks
            </p>
            <p className="mt-1 text-[11px] text-zinc-600">
              {perkPool.enabledAntiPerkIds.length}/{antiPerkOptions.length} active
            </p>
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
        {renderPerkToggleList(
          antiPerkOptions,
          perkPool.enabledAntiPerkIds,
          "rose",
          "No anti-perks available.",
          onToggleAntiPerk
        )}
      </div>

      <div>
        <p className="text-[11px] font-medium uppercase tracking-[0.1em] text-zinc-500">
          {abbreviateNsfwText("Cum Rounds", sfwMode)}
        </p>
        <p className="mt-1 text-[11px] text-zinc-600">
          Landing on any end node queues these rounds in order.
        </p>
      </div>

      {/* ── Selected cum rounds ─────────────────── */}
      <div className="space-y-1.5">
        {cumRoundRefs.length === 0 && (
          <p className="rounded-lg border border-dashed border-zinc-700/50 px-3 py-3 text-center text-[11px] text-zinc-600">
            {abbreviateNsfwText("No cum rounds selected.", sfwMode)}
          </p>
        )}
        {cumRoundRefs.map((ref, index) => {
          const resolved = resolvePortableRoundRef(ref, installedRounds);
          const roundId = resolved?.id ?? ref.idHint ?? `cum-ref-${index}`;
          return (
            <div
              key={`${roundId}-${index}`}
              className="flex items-center gap-2 rounded-lg border border-zinc-700/40 bg-zinc-950/50 px-2.5 py-2"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs text-zinc-200">{resolved?.name ?? ref.name}</p>
                {!resolved && <p className="text-[10px] text-amber-400/70">Unresolved</p>}
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
        <p className="text-[11px] font-medium uppercase tracking-[0.1em] text-zinc-500">
          Available
        </p>
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
            {abbreviateNsfwText("No installed cum rounds found.", sfwMode)}
          </p>
        )}
      </div>
    </div>
    );
  }
);

GraphSettingsPanel.displayName = "GraphSettingsPanel";
