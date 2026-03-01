import React from "react";
import { Trans, useLingui } from "@lingui/react/macro";
import type { PortableRoundRef } from "../../../game/playlistSchema";
import { resolvePortableRoundRef } from "../../../game/playlistRuntime";
import { useInstalledRoundMedia } from "../../../hooks/useInstalledRoundMedia";
import { usePlayableVideoFallback } from "../../../hooks/usePlayableVideoFallback";
import { SfwGuard } from "../../../components/SfwGuard";
import { playHoverSound, playSelectSound } from "../../../utils/audio";
import { GameDropdown } from "../../../components/ui/GameDropdown";
import type { InstalledRound, InstalledRoundCatalogEntry } from "../../../services/db";
import type { EditorEdge, EditorNode, EditorSelectionState } from "../EditorState";
import { getNodeKindColor, toColorInputValue } from "../nodeVisuals";
import { normalizeRoadPalette, ROAD_PALETTE_PRESETS } from "../EditorState";
import type { GraphRoadPalette } from "../../../game/playlistSchema";
import type { CustomRoadPalette } from "../../../constants/customPaletteSettings";

interface PerkOption {
  id: string;
  name: string;
}

const NODE_KIND_OPTIONS: EditorNode["kind"][] = [
  "start",
  "end",
  "path",
  "safePoint",
  "campfire",
  "round",
  "randomRound",
  "perk",
  "event",
  "catapult",
];

interface NodeInspectorPanelProps {
  selectedNode: EditorNode | null;
  outgoingEdges: ReadonlyArray<EditorEdge>;
  installedRounds: ReadonlyArray<InstalledRound | InstalledRoundCatalogEntry>;
  randomPoolIds: ReadonlyArray<string>;
  perkOptions: ReadonlyArray<PerkOption>;
  antiPerkOptions: ReadonlyArray<PerkOption>;
  customPalettes: ReadonlyArray<CustomRoadPalette>;
  saveMode?: "none" | "checkpoint" | "everywhere";
  cumRoundCount?: number;
  onPatchNode: (nodeId: string, patch: Partial<EditorNode>) => void;
  onCommitSelection: (selection: EditorSelectionState) => void;
  onSetTool: (tool: "connect") => void;
  onSetConnectFrom: (nodeId: string) => void;
  onCreateAutomationForNode: (nodeId: string) => void;
}

function formatInstalledRoundMeta(
  round: Pick<InstalledRound | InstalledRoundCatalogEntry, "author" | "difficulty" | "type">,
  labels: { unknownAuthor: string; normal: string; difficulty: (value: number) => string }
): string {
  const parts = [round.author ?? labels.unknownAuthor, round.type ?? labels.normal];
  if (typeof round.difficulty === "number") {
    parts.push(labels.difficulty(round.difficulty));
  }
  return parts.join(" • ");
}

function toCsv(values: string[] | undefined): string {
  return (values ?? []).join(", ");
}

function fromCsv(value: string): string[] | undefined {
  const items = value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  return items.length > 0 ? [...new Set(items)] : undefined;
}

interface CsvFilterInputProps {
  label: React.ReactNode;
  values: string[] | undefined;
  placeholder: string;
  onChange: (values: string[] | undefined) => void;
}

const CsvFilterInput: React.FC<CsvFilterInputProps> = ({
  label,
  values,
  placeholder,
  onChange,
}) => {
  const [draft, setDraft] = React.useState(() => toCsv(values));
  const isEditingRef = React.useRef(false);
  const formattedValue = toCsv(values);

  React.useEffect(() => {
    if (!isEditingRef.current) {
      setDraft(formattedValue);
    }
  }, [formattedValue]);

  return (
    <label className="block">
      <span className="text-[11px] font-medium uppercase tracking-[0.1em] text-zinc-500">
        {label}
      </span>
      <input
        type="text"
        value={draft}
        onFocus={() => {
          isEditingRef.current = true;
        }}
        onChange={(event) => {
          const nextValue = event.target.value;
          setDraft(nextValue);
          onChange(fromCsv(nextValue));
        }}
        onBlur={(event) => {
          isEditingRef.current = false;
          setDraft(toCsv(fromCsv(event.target.value)));
        }}
        placeholder={placeholder}
        className="mt-1 w-full rounded-md border border-zinc-700/50 bg-zinc-950/60 px-2.5 py-1.5 text-xs text-zinc-100 outline-none transition-colors focus:border-cyan-500/50"
      />
    </label>
  );
};

function toPortableRoundRefFromInstalledRound(
  round: InstalledRound | InstalledRoundCatalogEntry
): PortableRoundRef {
  return {
    idHint: round.id,
    name: round.name,
    author: round.author ?? undefined,
    type: round.type ?? undefined,
    installSourceKeyHint: round.installSourceKey ?? undefined,
    phash: round.phash ?? undefined,
  };
}

type TransitionPaletteColorKey = "body" | "railA" | "railB" | "glow" | "center" | "gate" | "marker";

function RoundTransitionSettings({
  countdownDurationSec,
  overlineLabel,
  transitionPalette,
  customPalettes,
  onPatchNode,
  nodeId,
}: {
  countdownDurationSec?: number;
  overlineLabel?: string;
  transitionPalette?: GraphRoadPalette;
  customPalettes: ReadonlyArray<CustomRoadPalette>;
  onPatchNode: (nodeId: string, patch: Partial<EditorNode>) => void;
  nodeId: string;
}) {
  const { t } = useLingui();
  const [paletteExpanded, setPaletteExpanded] = React.useState(false);
  const [overlineDraft, setOverlineDraft] = React.useState(() => overlineLabel ?? "");
  const isEditingOverlineRef = React.useRef(false);

  React.useEffect(() => {
    if (!isEditingOverlineRef.current) {
      setOverlineDraft(overlineLabel ?? "");
    }
  }, [overlineLabel]);

  const currentPalette = transitionPalette ? normalizeRoadPalette(transitionPalette) : null;

  return (
    <div className="space-y-2 rounded-lg border border-zinc-700/30 bg-zinc-900/40 p-2.5">
      <p className="text-[11px] font-medium uppercase tracking-[0.1em] text-zinc-500">
        <Trans>Round Transition</Trans>
      </p>
      <label className="block">
        <span className="text-[10px] uppercase tracking-[0.08em] text-zinc-500">
          <Trans>Countdown duration (seconds)</Trans>
        </span>
        <input
          type="number"
          min="0.5"
          max="15"
          step="0.5"
          value={typeof countdownDurationSec === "number" ? String(countdownDurationSec) : ""}
          placeholder="3"
          onKeyDown={(e) => e.stopPropagation()}
          onChange={(event) => {
            const raw = event.target.value.trim();
            const value = Number.parseFloat(raw);
            onPatchNode(nodeId, {
              roundCountdownDurationSec:
                raw.length > 0 && Number.isFinite(value) && value > 0 ? value : undefined,
            });
          }}
          className="mt-1 w-full rounded-md border border-zinc-700/50 bg-zinc-950/60 px-2.5 py-1.5 text-xs text-zinc-100 outline-none transition-colors focus:border-cyan-500/50"
        />
      </label>
      <label className="block">
        <span className="text-[10px] uppercase tracking-[0.08em] text-zinc-500">
          <Trans>Overline label</Trans>
        </span>
        <input
          type="text"
          maxLength={50}
          value={overlineDraft}
          placeholder={t`NORMAL ROUND`}
          onKeyDown={(e) => e.stopPropagation()}
          onFocus={() => {
            isEditingOverlineRef.current = true;
          }}
          onChange={(event) => {
            const value = event.target.value;
            setOverlineDraft(value);
            const trimmed = value.trim();
            onPatchNode(nodeId, {
              roundOverlineLabel: trimmed.length > 0 ? trimmed : undefined,
            });
          }}
          onBlur={(event) => {
            isEditingOverlineRef.current = false;
            const trimmed = event.target.value.trim();
            setOverlineDraft(trimmed);
            onPatchNode(nodeId, {
              roundOverlineLabel: trimmed.length > 0 ? trimmed : undefined,
            });
          }}
          className="mt-1 w-full rounded-md border border-zinc-700/50 bg-zinc-950/60 px-2.5 py-1.5 text-xs text-zinc-100 outline-none transition-colors focus:border-cyan-500/50"
        />
      </label>
      <div className="space-y-2">
        <button
          type="button"
          onClick={() => setPaletteExpanded((prev) => !prev)}
          className="flex w-full items-center justify-between text-[10px] uppercase tracking-[0.08em] text-zinc-500 transition hover:text-zinc-300"
        >
          <span>
            <Trans>Transition palette</Trans>
          </span>
          <span className="text-[9px]">{paletteExpanded ? "▾" : "▸"}</span>
        </button>
        {paletteExpanded && (
          <>
            <p className="text-[10px] text-zinc-600">
              <Trans>You can add custom palettes in the settings panel.</Trans>
            </p>
            {currentPalette && (
              <button
                type="button"
                onMouseEnter={playHoverSound}
                onClick={() => onPatchNode(nodeId, { roundTransitionPalette: undefined })}
                className="w-full rounded-lg border border-zinc-700/50 px-2.5 py-1.5 text-[11px] text-zinc-400 transition hover:border-zinc-500 hover:text-zinc-200"
              >
                <Trans>Reset to map palette</Trans>
              </button>
            )}
            <div className="grid grid-cols-2 gap-2">
              {ROAD_PALETTE_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  onMouseEnter={playHoverSound}
                  onClick={() =>
                    onPatchNode(nodeId, { roundTransitionPalette: { ...preset.palette } })
                  }
                  className={`rounded-lg border px-2 py-1.5 text-left text-[11px] transition ${
                    currentPalette?.presetId === preset.id
                      ? "border-cyan-400/50 bg-cyan-500/15 text-cyan-100"
                      : "border-zinc-700/50 text-zinc-400 hover:text-zinc-200"
                  }`}
                >
                  <span className="mb-1 flex gap-1">
                    {(["railA", "railB", "glow"] as const).map((key) => (
                      <span
                        key={key}
                        className="h-2.5 w-5 rounded-sm border border-white/10"
                        style={{ backgroundColor: preset.palette[key] }}
                      />
                    ))}
                  </span>
                  {preset.name}
                </button>
              ))}
              {customPalettes.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  onMouseEnter={playHoverSound}
                  onClick={() =>
                    onPatchNode(nodeId, {
                      roundTransitionPalette: { ...entry.palette, presetId: entry.id },
                    })
                  }
                  className={`rounded-lg border px-2 py-1.5 text-left text-[11px] transition ${
                    currentPalette?.presetId === entry.id
                      ? "border-cyan-400/50 bg-cyan-500/15 text-cyan-100"
                      : "border-zinc-700/50 text-zinc-400 hover:text-zinc-200"
                  }`}
                >
                  <span className="mb-1 flex gap-1">
                    {(["railA", "railB", "glow"] as const).map((key) => (
                      <span
                        key={key}
                        className="h-2.5 w-5 rounded-sm border border-white/10"
                        style={{ backgroundColor: entry.palette[key] }}
                      />
                    ))}
                  </span>
                  <span className="truncate">{entry.name}</span>
                </button>
              ))}
            </div>
            {currentPalette && (
              <div className="grid gap-2">
                {(
                  [
                    ["body", t`Body`],
                    ["railA", t`Rail A`],
                    ["railB", t`Rail B`],
                    ["glow", t`Glow`],
                    ["center", t`Center`],
                    ["gate", t`Gate`],
                    ["marker", t`Markers`],
                  ] as Array<[TransitionPaletteColorKey, string]>
                ).map(([key, label]) => (
                  <label key={key} className="flex items-center justify-between gap-2">
                    <span className="text-[10px] uppercase tracking-[0.08em] text-zinc-500">
                      {label}
                    </span>
                    <input
                      type="color"
                      value={currentPalette[key]}
                      onChange={(event) => {
                        const updated = {
                          ...currentPalette,
                          [key]: event.target.value,
                          presetId: "custom" as const,
                        };
                        onPatchNode(nodeId, { roundTransitionPalette: updated });
                      }}
                      className="h-8 w-12 rounded border border-zinc-700/60 bg-zinc-950 p-1"
                    />
                  </label>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export const NodeInspectorPanel: React.FC<NodeInspectorPanelProps> = React.memo(
  ({
    selectedNode,
    outgoingEdges,
    installedRounds,
    randomPoolIds,
    perkOptions,
    antiPerkOptions,
    customPalettes,
    saveMode = "none",
    cumRoundCount = 0,
    onPatchNode,
    onCommitSelection,
    onSetTool,
    onSetConnectFrom,
    onCreateAutomationForNode,
  }) => {
    const { t } = useLingui();
    if (!selectedNode) {
      return (
        <div className="flex items-center justify-center py-8 text-xs text-zinc-600">
          <Trans>Select a node to inspect</Trans>
        </div>
      );
    }

    const fallbackColor = getNodeKindColor(selectedNode.kind);
    const colorValue = toColorInputValue(selectedNode.styleHint?.color, fallbackColor);
    const sizeValue =
      typeof selectedNode.styleHint?.size === "number" ? String(selectedNode.styleHint.size) : "";

    return (
      <div className="space-y-3 p-3">
        {/* ── Name ─────────────────── */}
        <label className="block">
          <span className="text-[11px] font-medium uppercase tracking-[0.1em] text-zinc-500">
            <Trans>Name</Trans>
          </span>
          <input
            type="text"
            value={selectedNode.name}
            onChange={(event) =>
              onPatchNode(selectedNode.id, { name: event.target.value || selectedNode.name })
            }
            className="mt-1 w-full rounded-md border border-zinc-700/50 bg-zinc-950/60 px-2.5 py-1.5 text-xs text-zinc-100 outline-none transition-colors focus:border-cyan-500/50"
          />
        </label>

        {/* ── Kind ─────────────────── */}
        <div className="block">
          <span className="text-[11px] font-medium uppercase tracking-[0.1em] text-zinc-500">
            <Trans>Kind</Trans>
          </span>
          <GameDropdown
            value={selectedNode.kind}
            options={NODE_KIND_OPTIONS.map((kind) => ({
              value: kind,
              label:
                kind === "start"
                  ? t`Start`
                  : kind === "end"
                    ? t`End`
                    : kind === "path"
                      ? t`Path`
                      : kind === "safePoint"
                        ? t`Safe Point`
                        : kind === "campfire"
                          ? t`Campfire`
                          : kind === "round"
                            ? t`Round`
                            : kind === "randomRound"
                              ? t`Random Round`
                              : kind === "event"
                                ? t`Event`
                                : kind === "catapult"
                                  ? t`Catapult`
                                  : t`Perk`,
            }))}
            onChange={(kind) => {
              onPatchNode(selectedNode.id, {
                kind: kind as EditorNode["kind"],
                roundRef:
                  kind === "round" ? (selectedNode.roundRef ?? { name: t`Round` }) : undefined,
                forceStop: kind === "round" || kind === "perk" ? selectedNode.forceStop : undefined,
                skippable: kind === "round" ? selectedNode.skippable : undefined,
                autoAdvanceAfterCompletion:
                  kind === "round" || kind === "randomRound"
                    ? selectedNode.autoAdvanceAfterCompletion
                    : undefined,
                roundPlaylistRefs:
                  kind === "round"
                    ? (selectedNode.roundPlaylistRefs ??
                      (selectedNode.roundRef ? [selectedNode.roundRef] : undefined))
                    : undefined,
                hiddenFromMap: undefined,
                selectionMode:
                  kind === "randomRound" ? (selectedNode.selectionMode ?? "installed") : undefined,
                filter: kind === "randomRound" ? selectedNode.filter : undefined,
                checkpointRestMs: kind === "safePoint" ? selectedNode.checkpointRestMs : undefined,
                cumPoint: kind === "safePoint" ? selectedNode.cumPoint : undefined,
                pauseBonusMs: kind === "campfire" ? selectedNode.pauseBonusMs : undefined,
                visualId:
                  kind === "perk" ? (selectedNode.visualId ?? perkOptions[0]?.id) : undefined,
                giftGuaranteedPerk: kind === "perk" ? selectedNode.giftGuaranteedPerk : undefined,
                catapultForward:
                  kind === "catapult" ? (selectedNode.catapultForward ?? 2) : undefined,
                catapultLandingOnly:
                  kind === "catapult" ? selectedNode.catapultLandingOnly : undefined,
                randomPoolId: undefined,
              });
            }}
          />
        </div>

        <button
          type="button"
          className="w-full rounded-md border border-fuchsia-500/35 bg-fuchsia-500/10 px-3 py-2 text-left text-xs font-medium text-fuchsia-100 transition-colors hover:border-fuchsia-400/55 hover:bg-fuchsia-500/20"
          onClick={() => onCreateAutomationForNode(selectedNode.id)}
        >
          <Trans>Add automation for this node</Trans>
        </button>

        <div className="rounded-lg border border-white/6 bg-black/20 p-2.5">
          <p className="text-[11px] font-medium uppercase tracking-[0.1em] text-zinc-500">
            <Trans>Appearance</Trans>
          </p>
          <div className="mt-2 space-y-3">
            <label className="block">
              <span className="text-[11px] font-medium uppercase tracking-[0.1em] text-zinc-500">
                <Trans>Color</Trans>
              </span>
              <div className="mt-1 flex items-center gap-2">
                <input
                  aria-label={t`Node color`}
                  type="color"
                  value={colorValue}
                  onChange={(event) =>
                    onPatchNode(selectedNode.id, {
                      styleHint: {
                        color: event.target.value,
                      },
                    })
                  }
                  className="h-9 w-14 rounded border border-zinc-700/50 bg-zinc-950/60 p-1"
                />
                <button
                  type="button"
                  aria-label={t`Reset node color`}
                  className="rounded-md border border-zinc-700/50 bg-zinc-950/60 px-2.5 py-1.5 text-xs text-zinc-200 transition-colors hover:border-zinc-500/60 hover:text-white"
                  onClick={() => onPatchNode(selectedNode.id, { styleHint: { color: undefined } })}
                >
                  <Trans>Reset</Trans>
                </button>
              </div>
            </label>
            <label className="block">
              <span className="text-[11px] font-medium uppercase tracking-[0.1em] text-zinc-500">
                <Trans>Size</Trans>
              </span>
              <div className="mt-1 flex items-center gap-2">
                <input
                  aria-label={t`Node size`}
                  type="number"
                  min="0.5"
                  max="3"
                  step="0.1"
                  value={sizeValue}
                  onChange={(event) => {
                    const value = event.target.value.trim();
                    if (value.length === 0) {
                      onPatchNode(selectedNode.id, { styleHint: { size: undefined } });
                      return;
                    }

                    const parsed = Number.parseFloat(value);
                    onPatchNode(selectedNode.id, {
                      styleHint: {
                        size: Number.isFinite(parsed)
                          ? Math.min(3, Math.max(0.5, parsed))
                          : undefined,
                      },
                    });
                  }}
                  className="w-full rounded-md border border-zinc-700/50 bg-zinc-950/60 px-2.5 py-1.5 text-xs text-zinc-100 outline-none transition-colors focus:border-cyan-500/50"
                  placeholder={t`1.0`}
                />
                <button
                  type="button"
                  aria-label={t`Reset node size`}
                  className="rounded-md border border-zinc-700/50 bg-zinc-950/60 px-2.5 py-1.5 text-xs text-zinc-200 transition-colors hover:border-zinc-500/60 hover:text-white"
                  onClick={() => onPatchNode(selectedNode.id, { styleHint: { size: undefined } })}
                >
                  <Trans>Reset</Trans>
                </button>
              </div>
            </label>
          </div>
        </div>

        {/* ── Round-specific fields ─────────────────── */}
        {selectedNode.kind === "round" && (
          <>
            <label className="block">
              <span className="text-[11px] font-medium uppercase tracking-[0.1em] text-zinc-500">
                <Trans>Round name</Trans>
              </span>
              <input
                type="text"
                value={selectedNode.roundRef?.name ?? ""}
                onChange={(event) =>
                  onPatchNode(selectedNode.id, {
                    roundRef: {
                      ...(selectedNode.roundRef ?? {}),
                      name: event.target.value.trim().length > 0 ? event.target.value : t`Round`,
                    },
                  })
                }
                className="mt-1 w-full rounded-md border border-zinc-700/50 bg-zinc-950/60 px-2.5 py-1.5 text-xs text-zinc-100 outline-none transition-colors focus:border-cyan-500/50"
              />
            </label>
            <div className="block">
              <span className="text-[11px] font-medium uppercase tracking-[0.1em] text-zinc-500">
                <Trans>Installed round</Trans>
              </span>
              <InstalledRoundPicker
                key={selectedNode.id}
                selectedRoundId={selectedNode.roundRef?.idHint ?? null}
                installedRounds={installedRounds}
                onClearSelection={() => {
                  onPatchNode(selectedNode.id, {
                    roundRef: {
                      name: selectedNode.roundRef?.name?.trim() || t`Round`,
                    },
                    roundPlaylistRefs: undefined,
                  });
                }}
                onSelectRound={(round) => {
                  const roundRef = toPortableRoundRefFromInstalledRound(round);
                  onPatchNode(selectedNode.id, {
                    roundRef,
                    roundPlaylistRefs: [roundRef],
                  });
                }}
              />
            </div>
            <RoundQueueEditor
              selectedNode={selectedNode}
              installedRounds={installedRounds}
              onPatchNode={onPatchNode}
            />
            <label className="block">
              <span className="text-[11px] font-medium uppercase tracking-[0.1em] text-zinc-500">
                <Trans>Force stop</Trans>
              </span>
              <label className="mt-1 flex items-start gap-2 rounded-md border border-zinc-700/50 bg-zinc-950/60 px-2.5 py-2 text-xs text-zinc-200">
                <input
                  type="checkbox"
                  checked={Boolean(selectedNode.forceStop)}
                  onChange={(event) =>
                    onPatchNode(selectedNode.id, { forceStop: event.target.checked })
                  }
                  className="mt-0.5"
                />
                <span>
                  <Trans>
                    Stop movement as soon as a player reaches this round tile and start the round
                    immediately.
                  </Trans>
                </span>
              </label>
            </label>
            <label className="block">
              <span className="text-[11px] font-medium uppercase tracking-[0.1em] text-zinc-500">
                <Trans>Skippable</Trans>
              </span>
              <label className="mt-1 flex items-start gap-2 rounded-md border border-zinc-700/50 bg-zinc-950/60 px-2.5 py-2 text-xs text-zinc-200">
                <input
                  type="checkbox"
                  checked={Boolean(selectedNode.skippable)}
                  onChange={(event) =>
                    onPatchNode(selectedNode.id, { skippable: event.target.checked })
                  }
                  className="mt-0.5"
                />
                <span>
                  <Trans>
                    Let the player choose to play this round or skip it and roll from this tile
                    instead.
                  </Trans>
                </span>
              </label>
            </label>
            <label className="block">
              <label className="mt-1 flex items-start gap-2 rounded-md border border-zinc-700/50 bg-zinc-950/60 px-2.5 py-2 text-xs text-zinc-200">
                <input
                  type="checkbox"
                  checked={Boolean(selectedNode.autoAdvanceAfterCompletion)}
                  onChange={(event) =>
                    onPatchNode(selectedNode.id, {
                      autoAdvanceAfterCompletion: event.target.checked || undefined,
                    })
                  }
                  className="mt-0.5"
                />
                <span>
                  <Trans>Auto-advance to the next node after this round completes.</Trans>
                </span>
              </label>
            </label>
            <RoundTransitionSettings
              countdownDurationSec={selectedNode.roundCountdownDurationSec}
              overlineLabel={selectedNode.roundOverlineLabel}
              transitionPalette={selectedNode.roundTransitionPalette}
              customPalettes={customPalettes}
              onPatchNode={onPatchNode}
              nodeId={selectedNode.id}
            />
            <SelectedRoundPreview
              round={
                selectedNode.roundRef
                  ? resolvePortableRoundRef(selectedNode.roundRef, installedRounds)
                  : null
              }
            />
          </>
        )}

        {selectedNode.kind === "safePoint" && (
          <div className="space-y-3">
            <label className="block">
              <span className="text-[11px] font-medium uppercase tracking-[0.1em] text-zinc-500">
                <Trans>Additional Rest (sec)</Trans>
              </span>
              <input
                type="number"
                min="0"
                step="1"
                value={
                  typeof selectedNode.checkpointRestMs === "number" &&
                  selectedNode.checkpointRestMs > 0
                    ? Math.floor(selectedNode.checkpointRestMs / 1000)
                    : ""
                }
                onChange={(event) => {
                  const value = event.target.value.trim();
                  if (value.length === 0) {
                    onPatchNode(selectedNode.id, { checkpointRestMs: undefined });
                    return;
                  }
                  const seconds = Number.parseInt(value, 10);
                  onPatchNode(selectedNode.id, {
                    checkpointRestMs:
                      Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : undefined,
                  });
                }}
                className="mt-1 w-full rounded-md border border-zinc-700/50 bg-zinc-950/60 px-2.5 py-1.5 text-xs text-zinc-100 outline-none transition-colors focus:border-cyan-500/50"
                placeholder={t`Adds to normal rest when set`}
              />
            </label>
            <label
              className={`flex items-start gap-2 rounded-lg border px-3 py-2 ${
                saveMode !== "none" && cumRoundCount > 0
                  ? "border-fuchsia-400/30 bg-fuchsia-500/10 text-fuchsia-100"
                  : "border-zinc-700/50 bg-zinc-950/40 text-zinc-500"
              }`}
            >
              <input
                type="checkbox"
                checked={selectedNode.cumPoint ?? false}
                disabled={saveMode === "none" || cumRoundCount === 0}
                onChange={(event) =>
                  onPatchNode(selectedNode.id, {
                    cumPoint: event.target.checked ? true : undefined,
                  })
                }
                className="mt-0.5 h-4 w-4 rounded border-fuchsia-300/40 bg-black/45 text-fuchsia-400 focus:ring-fuchsia-400/60"
              />
              <span>
                <span className="block text-xs font-semibold">
                  <Trans>Offer Cum & save here</Trans>
                </span>
                <span className="mt-0.5 block text-[11px] opacity-70">
                  {saveMode === "none" ? (
                    <Trans>Enable Checkpoint or Everywhere saving first.</Trans>
                  ) : cumRoundCount === 0 ? (
                    <Trans>Add at least one Cum Round first.</Trans>
                  ) : (
                    <Trans>
                      In single-player, offer a Cum Round and keep this checkpoint for later resume.
                    </Trans>
                  )}
                </span>
              </span>
            </label>
          </div>
        )}

        {selectedNode.kind === "campfire" && (
          <label className="block">
            <span className="text-[11px] font-medium uppercase tracking-[0.1em] text-zinc-500">
              <Trans>Pause Bonus (ms)</Trans>
            </span>
            <input
              type="number"
              min="0"
              step="1"
              value={
                typeof selectedNode.pauseBonusMs === "number" && selectedNode.pauseBonusMs > 0
                  ? String(selectedNode.pauseBonusMs)
                  : ""
              }
              onChange={(event) => {
                const value = event.target.value.trim();
                if (value.length === 0) {
                  onPatchNode(selectedNode.id, { pauseBonusMs: undefined });
                  return;
                }
                const ms = Number.parseInt(value, 10);
                onPatchNode(selectedNode.id, {
                  pauseBonusMs: Number.isFinite(ms) && ms > 0 ? ms : undefined,
                });
              }}
              className="mt-1 w-full rounded-md border border-zinc-700/50 bg-zinc-950/60 px-2.5 py-1.5 text-xs text-zinc-100 outline-none transition-colors focus:border-cyan-500/50"
              placeholder={t`Adds extra pause when landed on`}
            />
          </label>
        )}

        {selectedNode.kind === "randomRound" && (
          <div className="space-y-3 rounded-lg border border-amber-400/20 bg-amber-500/8 p-2.5">
            <GameDropdown
              label={t`Selection mode`}
              value={selectedNode.selectionMode ?? "installed"}
              options={[
                { value: "installed", label: t`Installed library` },
                { value: "pool", label: t`Named pool` },
              ]}
              onChange={(value) =>
                onPatchNode(selectedNode.id, { selectionMode: value as "installed" | "pool" })
              }
            />
            <GameDropdown
              label={t`Random pool`}
              value={selectedNode.randomPoolId ?? ""}
              options={[
                { value: "", label: t`None` },
                ...randomPoolIds.map((poolId) => ({ value: poolId, label: poolId })),
              ]}
              onChange={(value) =>
                onPatchNode(selectedNode.id, { randomPoolId: value.trim() || undefined })
              }
            />
            <CsvFilterInput
              label={<Trans>Tags filter</Trans>}
              values={selectedNode.filter?.tags}
              onChange={(values) =>
                onPatchNode(selectedNode.id, {
                  filter: { ...(selectedNode.filter ?? {}), tags: values },
                })
              }
              placeholder={t`tag-one, tag-two`}
            />
            <CsvFilterInput
              label={<Trans>Author filter</Trans>}
              values={selectedNode.filter?.authorNames}
              onChange={(values) =>
                onPatchNode(selectedNode.id, {
                  filter: {
                    ...(selectedNode.filter ?? {}),
                    authorNames: values,
                  },
                })
              }
              placeholder={t`author-one, author-two`}
            />
            <CsvFilterInput
              label={<Trans>Library filter</Trans>}
              values={selectedNode.filter?.libraryLabels}
              onChange={(values) =>
                onPatchNode(selectedNode.id, {
                  filter: {
                    ...(selectedNode.filter ?? {}),
                    libraryLabels: values,
                  },
                })
              }
              placeholder={t`library-one, library-two`}
            />
            <label className="block">
              <label className="mt-1 flex items-start gap-2 rounded-md border border-zinc-700/50 bg-zinc-950/60 px-2.5 py-2 text-xs text-zinc-200">
                <input
                  type="checkbox"
                  checked={Boolean(selectedNode.autoAdvanceAfterCompletion)}
                  onChange={(event) =>
                    onPatchNode(selectedNode.id, {
                      autoAdvanceAfterCompletion: event.target.checked || undefined,
                    })
                  }
                  className="mt-0.5"
                />
                <span>
                  <Trans>Auto-advance to the next node after this scene completes.</Trans>
                </span>
              </label>
            </label>
            <RoundTransitionSettings
              countdownDurationSec={selectedNode.roundCountdownDurationSec}
              overlineLabel={selectedNode.roundOverlineLabel}
              transitionPalette={selectedNode.roundTransitionPalette}
              customPalettes={customPalettes}
              onPatchNode={onPatchNode}
              nodeId={selectedNode.id}
            />
          </div>
        )}

        {/* ── Catapult-specific fields ─────────────────── */}
        {selectedNode.kind === "catapult" && (
          <>
            <label className="block">
              <span className="text-[11px] font-medium uppercase tracking-[0.1em] text-zinc-500">
                <Trans>Forward steps</Trans>
              </span>
              <input
                type="number"
                min="1"
                max="20"
                step="1"
                value={
                  typeof selectedNode.catapultForward === "number" &&
                  selectedNode.catapultForward > 0
                    ? String(selectedNode.catapultForward)
                    : ""
                }
                onChange={(event) => {
                  const value = event.target.value.trim();
                  if (value.length === 0) {
                    onPatchNode(selectedNode.id, { catapultForward: undefined });
                    return;
                  }
                  const parsed = Number.parseInt(value, 10);
                  onPatchNode(selectedNode.id, {
                    catapultForward:
                      Number.isFinite(parsed) && parsed >= 1 ? Math.min(20, parsed) : undefined,
                  });
                }}
                className="mt-1 w-full rounded-md border border-zinc-700/50 bg-zinc-950/60 px-2.5 py-1.5 text-xs text-zinc-100 outline-none transition-colors focus:border-cyan-500/50"
                placeholder={t`2`}
              />
              <p className="mt-1 text-[11px] text-zinc-500">
                <Trans>
                  Number of additional nodes the player moves forward when landing here.
                </Trans>
              </p>
            </label>
            <label className="block">
              <label className="mt-1 flex items-start gap-2 rounded-md border border-zinc-700/50 bg-zinc-950/60 px-2.5 py-2 text-xs text-zinc-200">
                <input
                  type="checkbox"
                  checked={Boolean(selectedNode.catapultLandingOnly)}
                  onChange={(event) =>
                    onPatchNode(selectedNode.id, {
                      catapultLandingOnly: event.target.checked || undefined,
                    })
                  }
                  className="mt-0.5"
                />
                <span>
                  <Trans>
                    Apply boost only when landing directly on this tile (not when passing over it).
                  </Trans>
                </span>
              </label>
            </label>
          </>
        )}

        {/* ── Perk-specific fields ─────────────────── */}
        {selectedNode.kind === "perk" && (
          <>
            <label className="block">
              <span className="text-[11px] font-medium uppercase tracking-[0.1em] text-zinc-500">
                <Trans>Force stop</Trans>
              </span>
              <label className="mt-1 flex items-start gap-2 rounded-md border border-zinc-700/50 bg-zinc-950/60 px-2.5 py-2 text-xs text-zinc-200">
                <input
                  type="checkbox"
                  checked={Boolean(selectedNode.forceStop)}
                  onChange={(event) =>
                    onPatchNode(selectedNode.id, { forceStop: event.target.checked })
                  }
                  className="mt-0.5"
                />
                <span>
                  <Trans>
                    Stop movement as soon as a player reaches this perk tile and resolve the perk
                    immediately.
                  </Trans>
                </span>
              </label>
            </label>
            <div className="block">
              <span className="text-[11px] font-medium uppercase tracking-[0.1em] text-zinc-500">
                <Trans>Guaranteed perk</Trans>
              </span>
              <PerkPicker
                selectedPerkId={selectedNode.visualId ?? ""}
                perkOptions={perkOptions}
                antiPerkOptions={antiPerkOptions}
                onSelect={(perkId, isAntiPerk) => {
                  const patch: Partial<EditorNode> = {
                    visualId: perkId,
                    styleHint: { color: isAntiPerk ? ANTI_PERK_COLOR : PERK_COLOR },
                  };
                  onPatchNode(selectedNode.id, patch);
                }}
              />
            </div>
            <label className="block">
              <span className="text-[11px] font-medium uppercase tracking-[0.1em] text-zinc-500">
                <Trans>Gift guaranteed perk</Trans>
              </span>
              <label className="mt-1 flex items-start gap-2 rounded-md border border-zinc-700/50 bg-zinc-950/60 px-2.5 py-2 text-xs text-zinc-200">
                <input
                  type="checkbox"
                  checked={Boolean(selectedNode.giftGuaranteedPerk)}
                  onChange={(event) =>
                    onPatchNode(selectedNode.id, { giftGuaranteedPerk: event.target.checked })
                  }
                  className="mt-0.5"
                />
                <span>
                  <Trans>
                    Add the guaranteed perk to the player's inventory instead of applying it
                    immediately.
                  </Trans>
                </span>
              </label>
            </label>
          </>
        )}

        {/* ── Paths / outgoing edges ─────────────────── */}
        <div className="rounded-lg border border-white/6 bg-black/20 p-2.5">
          <p className="text-[11px] font-medium uppercase tracking-[0.1em] text-zinc-500">
            <Trans>Outgoing Paths</Trans>
          </p>
          <p className="mt-1 text-xs text-zinc-400">
            {t`${outgoingEdges.length} edge${outgoingEdges.length !== 1 ? "s" : ""}`}
          </p>
          {selectedNode.kind === "end" && (
            <p className="mt-1 text-[11px] text-amber-400/80">
              <Trans>End nodes are terminal.</Trans>
            </p>
          )}
          <button
            type="button"
            className="mt-2 rounded-md border border-cyan-500/40 bg-cyan-500/8 px-2 py-1 text-[11px] font-semibold text-cyan-300 transition-colors hover:bg-cyan-500/15 disabled:opacity-40"
            onMouseEnter={playHoverSound}
            onClick={() => {
              playSelectSound();
              onSetTool("connect");
              onSetConnectFrom(selectedNode.id);
            }}
            disabled={selectedNode.kind === "end"}
          >
            <Trans>Connect From Here</Trans>
          </button>
          {outgoingEdges.map((edge) => (
            <button
              key={edge.id}
              type="button"
              className="mt-1.5 block w-full rounded-md border border-zinc-700/40 bg-zinc-950/50 px-2 py-1 text-left text-[11px] text-zinc-400 transition-colors hover:border-zinc-600/50 hover:text-zinc-300"
              onClick={() =>
                onCommitSelection({
                  selectedNodeIds: [],
                  primaryNodeId: null,
                  selectedEdgeId: edge.id,
                  selectedTextAnnotationId: null,
                })
              }
            >
              {edge.fromNodeId} → {edge.toNodeId}
              <span className="ml-2 text-zinc-600">
                {t`gate $${edge.gateCost ?? 0} · w${edge.weight ?? 1}`}
              </span>
            </button>
          ))}
        </div>
      </div>
    );
  }
);

NodeInspectorPanel.displayName = "NodeInspectorPanel";

const PERK_COLOR = "#ec4899";
const ANTI_PERK_COLOR = "#ef4444";

const PerkPicker: React.FC<{
  selectedPerkId: string;
  perkOptions: ReadonlyArray<PerkOption>;
  antiPerkOptions: ReadonlyArray<PerkOption>;
  onSelect: (perkId: string, isAntiPerk: boolean) => void;
}> = React.memo(({ selectedPerkId, perkOptions, antiPerkOptions, onSelect }) => {
  return (
    <div className="mt-1 space-y-1 rounded-lg border border-zinc-700/50 bg-zinc-950/40 p-2">
      <button
        type="button"
        className={`block w-full rounded-md border px-2.5 py-2 text-left text-xs transition-colors ${
          !selectedPerkId
            ? "border-pink-400/50 bg-pink-500/12 text-pink-100"
            : "border-zinc-700/50 bg-zinc-950/60 text-zinc-300 hover:border-zinc-500/60 hover:text-white"
        }`}
        onMouseEnter={playHoverSound}
        onClick={() => {
          playSelectSound();
          onSelect("", false);
        }}
      >
        <Trans>None (random perk)</Trans>
      </button>
      <div className="max-h-56 space-y-1 overflow-y-auto pr-1">
        {perkOptions.map((perk) => {
          const selected = perk.id === selectedPerkId;
          return (
            <button
              key={perk.id}
              type="button"
              className={`block w-full rounded-md border px-2.5 py-2 text-left text-xs transition-colors ${
                selected
                  ? "border-pink-400/50 bg-pink-500/12 text-pink-100"
                  : "border-zinc-700/40 bg-zinc-950/50 text-zinc-300 hover:border-zinc-500/60 hover:text-white"
              }`}
              onMouseEnter={playHoverSound}
              onClick={() => {
                playSelectSound();
                onSelect(perk.id, false);
              }}
            >
              <span className="truncate font-medium">{perk.name}</span>
            </button>
          );
        })}
        {antiPerkOptions.length > 0 && (
          <>
            <div className="border-t border-white/10 px-1 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-[0.15em] text-zinc-500">
              <Trans>Anti-Perks</Trans>
            </div>
            {antiPerkOptions.map((perk) => {
              const selected = perk.id === selectedPerkId;
              return (
                <button
                  key={perk.id}
                  type="button"
                  className={`block w-full rounded-md border px-2.5 py-2 text-left text-xs transition-colors ${
                    selected
                      ? "border-red-400/50 bg-red-500/12 text-red-100"
                      : "border-zinc-700/40 bg-zinc-950/50 text-zinc-300 hover:border-zinc-500/60 hover:text-white"
                  }`}
                  onMouseEnter={playHoverSound}
                  onClick={() => {
                    playSelectSound();
                    onSelect(perk.id, true);
                  }}
                >
                  <span className="truncate font-medium">{perk.name}</span>
                </button>
              );
            })}
          </>
        )}
      </div>
    </div>
  );
});

PerkPicker.displayName = "PerkPicker";

const RoundQueueEditor: React.FC<{
  selectedNode: EditorNode;
  installedRounds: ReadonlyArray<InstalledRound | InstalledRoundCatalogEntry>;
  onPatchNode: (nodeId: string, patch: Partial<EditorNode>) => void;
}> = React.memo(({ selectedNode, installedRounds, onPatchNode }) => {
  const { t } = useLingui();
  const queue = selectedNode.roundPlaylistRefs?.length
    ? selectedNode.roundPlaylistRefs
    : selectedNode.roundRef
      ? [selectedNode.roundRef]
      : [];

  const commitQueue = React.useCallback(
    (nextQueue: PortableRoundRef[]) => {
      const cleanQueue = nextQueue.filter((ref) => ref.name?.trim());
      onPatchNode(selectedNode.id, {
        roundPlaylistRefs: cleanQueue.length > 1 ? cleanQueue : undefined,
        roundRef: cleanQueue[0] ?? selectedNode.roundRef,
      });
    },
    [onPatchNode, selectedNode.id, selectedNode.roundRef]
  );

  const selectedIds = new Set(queue.map((ref) => ref.idHint).filter(Boolean));

  return (
    <div className="rounded-lg border border-cyan-400/20 bg-cyan-500/8 p-2.5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-[0.1em] text-cyan-200">
            <Trans>Video Queue</Trans>
          </p>
          <p className="mt-1 text-[11px] text-zinc-400">
            <Trans>Play intros, the main round, and outros back to back.</Trans>
          </p>
        </div>
        <span className="shrink-0 rounded border border-cyan-400/30 px-2 py-1 text-[10px] font-medium text-cyan-100">
          {queue.length}
        </span>
      </div>

      <div className="mt-2 space-y-1.5">
        {queue.map((ref, index) => (
          <div
            key={`${ref.idHint ?? ref.name}-${index}`}
            className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 rounded-md border border-zinc-700/45 bg-zinc-950/60 px-2.5 py-2 text-xs"
          >
            <div className="min-w-0">
              <div className="truncate font-medium text-zinc-100">
                {index + 1}. {ref.name}
              </div>
              <div className="mt-0.5 truncate text-[11px] text-zinc-500">
                {ref.author ?? t`Unknown Author`}
              </div>
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                aria-label={t`Move video up`}
                disabled={index === 0}
                className="rounded border border-zinc-700/50 px-2 py-1 text-[11px] text-zinc-300 transition-colors hover:border-zinc-500/60 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                onClick={() => {
                  const next = [...queue];
                  const [item] = next.splice(index, 1);
                  if (!item) return;
                  next.splice(index - 1, 0, item);
                  commitQueue(next);
                }}
              >
                <Trans>Up</Trans>
              </button>
              <button
                type="button"
                aria-label={t`Move video down`}
                disabled={index === queue.length - 1}
                className="rounded border border-zinc-700/50 px-2 py-1 text-[11px] text-zinc-300 transition-colors hover:border-zinc-500/60 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                onClick={() => {
                  const next = [...queue];
                  const [item] = next.splice(index, 1);
                  if (!item) return;
                  next.splice(index + 1, 0, item);
                  commitQueue(next);
                }}
              >
                <Trans>Down</Trans>
              </button>
              <button
                type="button"
                aria-label={t`Remove video`}
                disabled={queue.length <= 1}
                className="rounded border border-red-500/35 px-2 py-1 text-[11px] text-red-100 transition-colors hover:border-red-400/60 disabled:cursor-not-allowed disabled:opacity-40"
                onClick={() => commitQueue(queue.filter((_, entryIndex) => entryIndex !== index))}
              >
                <Trans>Remove</Trans>
              </button>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-2">
        <InstalledRoundPicker
          selectedRoundId={null}
          installedRounds={installedRounds.filter((round) => !selectedIds.has(round.id))}
          hideClearSelection
          onClearSelection={() => undefined}
          onSelectRound={(round) => {
            commitQueue([...queue, toPortableRoundRefFromInstalledRound(round)]);
          }}
        />
      </div>
    </div>
  );
});

RoundQueueEditor.displayName = "RoundQueueEditor";

const InstalledRoundPicker: React.FC<{
  selectedRoundId: string | null;
  installedRounds: ReadonlyArray<InstalledRound | InstalledRoundCatalogEntry>;
  onSelectRound: (round: InstalledRound | InstalledRoundCatalogEntry) => void;
  onClearSelection: () => void;
  hideClearSelection?: boolean;
}> = React.memo(
  ({
    selectedRoundId,
    installedRounds,
    onSelectRound,
    onClearSelection,
    hideClearSelection = false,
  }) => {
    const { t } = useLingui();
    const [query, setQuery] = React.useState("");

    const filteredRounds = React.useMemo(() => {
      const normalizedQuery = query.trim().toLowerCase();
      const matches = installedRounds.filter((round) => {
        if (!normalizedQuery) return true;
        const haystack =
          `${round.name} ${round.author ?? ""} ${round.type ?? t`Normal`} ${round.difficulty ?? ""}`.toLowerCase();
        return haystack.includes(normalizedQuery);
      });

      return [...matches].sort((left, right) => {
        if (left.id === selectedRoundId) return -1;
        if (right.id === selectedRoundId) return 1;
        return left.name.localeCompare(right.name, undefined, {
          sensitivity: "base",
          numeric: true,
        });
      });
    }, [installedRounds, query, selectedRoundId]);

    React.useEffect(() => {
      setQuery("");
    }, [selectedRoundId]);

    return (
      <div className="mt-1 space-y-2 rounded-lg border border-zinc-700/50 bg-zinc-950/40 p-2">
        <input
          type="text"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="w-full rounded-md border border-zinc-700/50 bg-zinc-950/70 px-2.5 py-2 text-xs text-zinc-100 outline-none transition-colors focus:border-cyan-500/50"
          placeholder={t`Search by round, author, or type`}
        />
        {!hideClearSelection && (
          <button
            type="button"
            className={`block w-full rounded-md border px-2.5 py-2 text-left text-xs transition-colors ${
              selectedRoundId
                ? "border-zinc-700/50 bg-zinc-950/60 text-zinc-300 hover:border-zinc-500/60 hover:text-white"
                : "border-cyan-400/50 bg-cyan-500/12 text-cyan-100"
            }`}
            onMouseEnter={playHoverSound}
            onClick={onClearSelection}
          >
            <div className="font-medium">{t`Custom / none`}</div>
            <div className="mt-1 text-[11px] text-zinc-500">
              <Trans>Keep the manual round name without linking to an installed round.</Trans>
            </div>
          </button>
        )}
        <div className="max-h-56 space-y-1 overflow-y-auto pr-1">
          {filteredRounds.map((round) => {
            const selected = round.id === selectedRoundId;
            return (
              <button
                key={round.id}
                type="button"
                className={`block w-full rounded-md border px-2.5 py-2 text-left text-xs transition-colors ${
                  selected
                    ? "border-cyan-400/50 bg-cyan-500/12 text-cyan-100"
                    : "border-zinc-700/40 bg-zinc-950/50 text-zinc-300 hover:border-zinc-500/60 hover:text-white"
                }`}
                onMouseEnter={playHoverSound}
                onClick={() => {
                  playSelectSound();
                  onSelectRound(round);
                }}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-medium">{round.name}</span>
                  {selected && (
                    <span className="text-[10px] uppercase tracking-[0.1em]">{t`Selected`}</span>
                  )}
                </div>
                <div className="mt-1 text-[11px] text-zinc-500">
                  {formatInstalledRoundMeta(round, {
                    unknownAuthor: t`Unknown Author`,
                    normal: t`Normal`,
                    difficulty: (value) => t`Difficulty ${value}`,
                  })}
                </div>
              </button>
            );
          })}
          {filteredRounds.length === 0 && (
            <div className="rounded-md border border-zinc-800 bg-black/25 px-2.5 py-3 text-xs text-zinc-400">
              <Trans>No installed rounds match the current filter.</Trans>
            </div>
          )}
        </div>
      </div>
    );
  }
);

InstalledRoundPicker.displayName = "InstalledRoundPicker";

function SelectedRoundPreview({
  round,
}: {
  round: InstalledRound | InstalledRoundCatalogEntry | null;
}) {
  const { t } = useLingui();
  const { mediaResources, isLoading, loadMediaResources } = useInstalledRoundMedia(
    round?.id ?? null
  );
  const previewUri = mediaResources?.resources[0]?.videoUri ?? null;
  const previewImage = round && "previewImage" in round ? (round.previewImage ?? null) : null;
  const videoRef = React.useRef<HTMLVideoElement | null>(null);
  const [isPreviewActive, setIsPreviewActive] = React.useState(false);
  const { getVideoSrc, ensurePlayableVideo, handleVideoError } = usePlayableVideoFallback();
  const shouldLoadPreview = Boolean(previewUri) && isPreviewActive;
  const previewVideoSrc = shouldLoadPreview ? getVideoSrc(previewUri) : undefined;

  const previewWindowSec = React.useMemo(() => {
    const startMs =
      typeof round?.startTime === "number" && Number.isFinite(round.startTime)
        ? Math.max(0, round.startTime)
        : 0;
    const rawEndMs =
      typeof round?.endTime === "number" && Number.isFinite(round.endTime)
        ? Math.max(0, round.endTime)
        : null;
    const endMs = rawEndMs !== null && rawEndMs > startMs ? rawEndMs : null;
    return {
      startSec: startMs / 1000,
      endSec: endMs === null ? null : endMs / 1000,
    };
  }, [round?.endTime, round?.startTime]);

  const resolvePreviewWindow = (video: HTMLVideoElement) => {
    const hasFiniteDuration = Number.isFinite(video.duration) && video.duration > 0;
    const startSec = hasFiniteDuration
      ? Math.min(previewWindowSec.startSec, video.duration)
      : previewWindowSec.startSec;
    let endSec = previewWindowSec.endSec;
    if (endSec !== null && hasFiniteDuration) {
      endSec = Math.min(endSec, video.duration);
    }
    if (endSec !== null && endSec <= startSec + 0.001) {
      endSec = null;
    }
    return { startSec, endSec };
  };

  const startPreview = async () => {
    setIsPreviewActive(true);
    const ensuredResources = previewUri || !round ? mediaResources : await loadMediaResources();
    const ensuredPreviewUri = previewUri ?? ensuredResources?.resources[0]?.videoUri ?? null;
    if (!ensuredPreviewUri) return;
    const video = videoRef.current;
    if (!video || video.readyState < HTMLMediaElement.HAVE_METADATA) return;
    const { startSec } = resolvePreviewWindow(video);
    video.currentTime = startSec;
    try {
      await video.play();
    } catch (error) {
      console.error("Map editor preview play blocked", error);
    }
  };

  const stopPreview = () => {
    setIsPreviewActive(false);
    const video = videoRef.current;
    if (!video) return;
    video.pause();
    const { startSec } = resolvePreviewWindow(video);
    video.currentTime = startSec;
  };

  return (
    <div className="rounded-lg border border-white/6 bg-black/20 p-2.5">
      <p className="text-[11px] font-medium uppercase tracking-[0.1em] text-zinc-500">
        <Trans>Round preview</Trans>
      </p>
      {round ? (
        <>
          <div
            className={`group/video relative mt-2 aspect-video overflow-hidden rounded-lg border border-cyan-400/20 bg-gradient-to-br from-[#1b1130] via-[#120a25] to-[#0d1a33] ${previewUri ? "cursor-pointer" : ""}`}
            onMouseEnter={() => {
              void startPreview();
            }}
            onMouseLeave={stopPreview}
            onFocus={() => {
              void startPreview();
            }}
            onBlur={stopPreview}
            tabIndex={previewUri ? 0 : undefined}
            role={previewUri ? "button" : undefined}
            aria-label={previewUri ? t`Preview ${round.name}` : undefined}
          >
            {previewImage && (
              <SfwGuard>
                <img
                  src={previewImage}
                  alt={t`${round.name} preview`}
                  className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover/video:scale-[1.03] group-focus-within/video:scale-[1.03]"
                  loading="lazy"
                  decoding="async"
                />
              </SfwGuard>
            )}
            {previewUri ? (
              <SfwGuard>
                <video
                  ref={videoRef}
                  className={`h-full w-full object-cover transition-transform duration-500 group-hover/video:scale-[1.06] group-focus-within/video:scale-[1.06] ${previewImage ? "opacity-0 group-hover/video:opacity-100 group-focus-within/video:opacity-100" : ""}`}
                  src={previewVideoSrc}
                  muted
                  preload={shouldLoadPreview ? "metadata" : "none"}
                  playsInline
                  poster={previewImage ?? undefined}
                  onError={() => {
                    void handleVideoError(previewUri);
                  }}
                  onLoadedMetadata={() => {
                    if (!isPreviewActive) return;
                    void ensurePlayableVideo(previewUri);
                    const video = videoRef.current;
                    if (!video) return;
                    const { startSec } = resolvePreviewWindow(video);
                    video.currentTime = startSec;
                  }}
                  onLoadedData={() => {
                    if (!isPreviewActive) return;
                    const video = videoRef.current;
                    if (!video) return;
                    const { startSec } = resolvePreviewWindow(video);
                    video.currentTime = startSec;
                    void video.play().catch(() => {});
                  }}
                  onTimeUpdate={() => {
                    if (!isPreviewActive) return;
                    const video = videoRef.current;
                    if (!video) return;
                    const { startSec, endSec } = resolvePreviewWindow(video);
                    if (video.currentTime < startSec) {
                      video.currentTime = startSec;
                      return;
                    }
                    if (endSec !== null && video.currentTime >= endSec - 0.04) {
                      video.currentTime = startSec;
                      if (video.paused) {
                        void video.play().catch(() => {});
                      }
                    }
                  }}
                  onEnded={() => {
                    if (!isPreviewActive) return;
                    const video = videoRef.current;
                    if (!video) return;
                    const { startSec } = resolvePreviewWindow(video);
                    video.currentTime = startSec;
                    void video.play().catch(() => {});
                  }}
                />
              </SfwGuard>
            ) : !previewImage ? (
              <div className="flex h-full items-center justify-center text-[10px] font-[family-name:var(--font-jetbrains-mono)] uppercase tracking-[0.25em] text-zinc-500">
                {isLoading ? t`Loading...` : t`No Preview`}
              </div>
            ) : null}

            <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/70 via-black/15 to-transparent" />
            {previewUri && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <span className="flex h-10 w-10 items-center justify-center rounded-full border border-white/45 bg-black/45 text-sm text-white opacity-0 transition-opacity duration-200 group-hover/video:opacity-100 group-focus-within/video:opacity-100">
                  ▶
                </span>
              </div>
            )}
          </div>
          <div className="mt-2 space-y-1">
            <p className="text-xs font-semibold text-zinc-100">{round.name}</p>
            <div className="flex flex-wrap gap-1.5">
              <span className="rounded-md border border-cyan-400/30 bg-cyan-500/10 px-1.5 py-0.5 text-[10px] uppercase tracking-[0.14em] text-cyan-100">
                {round.type ?? t`Normal`}
              </span>
              {round.author && (
                <span className="rounded-md border border-white/10 bg-white/5 px-1.5 py-0.5 text-[10px] text-zinc-300">
                  {round.author}
                </span>
              )}
            </div>
          </div>
        </>
      ) : (
        <p className="mt-1 text-xs text-zinc-500">
          <Trans>Select an installed round to see its preview here.</Trans>
        </p>
      )}
    </div>
  );
}
