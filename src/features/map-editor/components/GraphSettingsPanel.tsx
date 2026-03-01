import React from "react";
import { Trans, useLingui } from "@lingui/react/macro";
import { playHoverSound } from "../../../utils/audio";
import { useSfwMode } from "../../../hooks/useSfwMode";
import type { InstalledRound, InstalledRoundCatalogEntry } from "../../../services/db";
import { abbreviateNsfwText } from "../../../utils/sfwText";
import type { EditorGraphConfig } from "../EditorState";
import { normalizeRoadPalette, ROAD_PALETTE_PRESETS } from "../EditorState";
import { resolvePortableRoundRef } from "../../../game/playlistRuntime";
import type { PerkDefinition } from "../../../game/types";

interface GraphSettingsPanelProps {
  perkSelection: EditorGraphConfig["perkSelection"];
  perkPool: EditorGraphConfig["perkPool"];
  probabilityScaling: EditorGraphConfig["probabilityScaling"];
  economy: EditorGraphConfig["economy"];
  dice: EditorGraphConfig["dice"];
  saveMode: EditorGraphConfig["saveMode"];
  style: EditorGraphConfig["style"];
  perkOptions: ReadonlyArray<PerkDefinition>;
  antiPerkOptions: ReadonlyArray<PerkDefinition>;
  cumRoundRefs: EditorGraphConfig["cumRoundRefs"];
  cumRounds: ReadonlyArray<InstalledRound | InstalledRoundCatalogEntry>;
  installedRounds: ReadonlyArray<InstalledRound | InstalledRoundCatalogEntry>;
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
  onChooseMapBackground: () => void;
  onSetMapBackground: (background: EditorGraphConfig["style"]["background"] | undefined) => void;
  onPatchMapBackground: (
    patch: Partial<NonNullable<EditorGraphConfig["style"]["background"]>>
  ) => void;
  onSetRoadPalette: (palette: EditorGraphConfig["style"]["roadPalette"]) => void;
  onPatchRoadPalette: (
    patch: Partial<NonNullable<EditorGraphConfig["style"]["roadPalette"]>>
  ) => void;
  onResetRoadPalette: () => void;
  onTogglePerk: (perkId: string) => void;
  onToggleAntiPerk: (perkId: string) => void;
  onSetAllPerksEnabled: (enabled: boolean) => void;
  onSetAllAntiPerksEnabled: (enabled: boolean) => void;
  onToggleCumRound: (round: InstalledRound | InstalledRoundCatalogEntry) => void;
  onMoveCumRound: (roundId: string, direction: -1 | 1) => void;
  onRemoveCumRoundByIndex: (index: number) => void;
  music: EditorGraphConfig["music"];
  onChoosePlaylistMusicFiles: () => void;
  onAddPlaylistMusicFromUrl: (input: {
    url: string;
    mode: "track" | "playlist";
  }) => Promise<{ addedCount: number; errorCount: number }>;
  onRemovePlaylistMusicTrack: (trackId: string) => void;
  onMovePlaylistMusicTrack: (trackId: string, direction: -1 | 1) => void;
  onClearPlaylistMusicTracks: () => void;
  onSetPlaylistMusicLoop: (value: boolean) => void;
}

const percent = (value: number): number => Math.round(value * 100);
const toRatio = (value: string): number =>
  Math.max(0, Math.min(100, Number.parseInt(value, 10) || 0)) / 100;
type BackgroundNumberKey =
  | "opacity"
  | "dim"
  | "blur"
  | "scale"
  | "offsetX"
  | "offsetY"
  | "parallaxStrength";
type RoadPaletteColorKey = "body" | "railA" | "railB" | "glow" | "center" | "gate" | "marker";

const backgroundNumberPatch = (
  key: BackgroundNumberKey,
  value: number
): Partial<NonNullable<EditorGraphConfig["style"]["background"]>> => {
  switch (key) {
    case "opacity":
      return { opacity: value };
    case "dim":
      return { dim: value };
    case "blur":
      return { blur: value };
    case "scale":
      return { scale: value };
    case "offsetX":
      return { offsetX: value };
    case "offsetY":
      return { offsetY: value };
    case "parallaxStrength":
      return { parallaxStrength: value };
    default:
      return {};
  }
};

const roadColorPatch = (
  key: RoadPaletteColorKey,
  value: string
): Partial<NonNullable<EditorGraphConfig["style"]["roadPalette"]>> => {
  switch (key) {
    case "body":
      return { body: value, presetId: "custom" };
    case "railA":
      return { railA: value, presetId: "custom" };
    case "railB":
      return { railB: value, presetId: "custom" };
    case "glow":
      return { glow: value, presetId: "custom" };
    case "center":
      return { center: value, presetId: "custom" };
    case "gate":
      return { gate: value, presetId: "custom" };
    case "marker":
      return { marker: value, presetId: "custom" };
    default:
      return { presetId: "custom" };
  }
};

function renderPerkToggleList(
  options: ReadonlyArray<PerkDefinition>,
  enabledIds: ReadonlyArray<string>,
  accent: "emerald" | "rose",
  emptyLabel: string,
  onToggle: (perkId: string) => void,
  labels: { device: string; active: string; inactive: string }
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
            className={`block w-full rounded-lg border px-2.5 py-2 text-left text-xs transition-all ${
              selected
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
                    {labels.device}
                  </span>
                )}
              </span>
              <span
                className={`flex-shrink-0 rounded border px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${
                  selected
                    ? accent === "emerald"
                      ? "border-emerald-300/45 bg-emerald-500/20 text-emerald-100"
                      : "border-rose-300/45 bg-rose-500/20 text-rose-100"
                    : "border-zinc-700/50 bg-zinc-900/70 text-zinc-400"
                }`}
              >
                {selected ? labels.active : labels.inactive}
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
    style,
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
    onChooseMapBackground,
    onSetMapBackground,
    onPatchMapBackground,
    onSetRoadPalette,
    onPatchRoadPalette,
    onResetRoadPalette,
    onTogglePerk,
    onToggleAntiPerk,
    onSetAllPerksEnabled,
    onSetAllAntiPerksEnabled,
    onToggleCumRound,
    onMoveCumRound,
    onRemoveCumRoundByIndex,
    music,
    onChoosePlaylistMusicFiles,
    onAddPlaylistMusicFromUrl,
    onRemovePlaylistMusicTrack,
    onMovePlaylistMusicTrack,
    onClearPlaylistMusicTracks,
    onSetPlaylistMusicLoop,
  }) => {
    const { t } = useLingui();
    const sfwMode = useSfwMode();
    const background = style.background;
    const roadPalette = normalizeRoadPalette(style.roadPalette);
    const [showMusicUrlInput, setShowMusicUrlInput] = React.useState(false);
    const [musicUrlInput, setMusicUrlInput] = React.useState("");
    const [musicUrlMode, setMusicUrlMode] = React.useState<"track" | "playlist">("track");
    const [isAddingMusicUrl, setIsAddingMusicUrl] = React.useState(false);
    const [musicUrlError, setMusicUrlError] = React.useState<string | null>(null);
    const [musicUrlResult, setMusicUrlResult] = React.useState<{
      added: number;
      errors: number;
    } | null>(null);

    const handleAddMusicUrl = React.useCallback(async () => {
      if (isAddingMusicUrl) return;
      const trimmed = musicUrlInput.trim();
      if (!trimmed) {
        setMusicUrlError(t`Please enter a URL`);
        return;
      }
      try {
        new URL(trimmed);
      } catch {
        setMusicUrlError(t`Invalid URL format`);
        return;
      }

      setIsAddingMusicUrl(true);
      setMusicUrlError(null);
      setMusicUrlResult(null);
      try {
        const result = await onAddPlaylistMusicFromUrl({ url: trimmed, mode: musicUrlMode });
        setMusicUrlResult({ added: result.addedCount, errors: result.errorCount });
        if (result.addedCount > 0 && result.errorCount === 0) {
          setMusicUrlInput("");
          setShowMusicUrlInput(false);
        }
      } catch (error) {
        setMusicUrlError(error instanceof Error ? error.message : t`Failed to add from URL`);
      } finally {
        setIsAddingMusicUrl(false);
      }
    }, [isAddingMusicUrl, musicUrlInput, musicUrlMode, onAddPlaylistMusicFromUrl, t]);

    return (
      <div className="space-y-3 p-3">
        <div className="space-y-3 rounded-xl border border-cyan-400/20 bg-zinc-950/50 p-3">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-[0.1em] text-cyan-300/80">
              <Trans>Map Appearance</Trans>
            </p>
            <p className="mt-1 text-[11px] text-zinc-600">
              <Trans>Set background media and the road colors used between nodes.</Trans>
            </p>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[11px] font-medium uppercase tracking-[0.1em] text-zinc-500">
                <Trans>Background</Trans>
              </p>
              <div className="flex gap-1.5">
                <button
                  type="button"
                  onMouseEnter={playHoverSound}
                  onClick={onChooseMapBackground}
                  className="rounded-lg border border-cyan-400/30 bg-cyan-500/10 px-2.5 py-1.5 text-[11px] font-semibold text-cyan-100 transition hover:border-cyan-300/60"
                >
                  <Trans>Choose media</Trans>
                </button>
                {background && (
                  <button
                    type="button"
                    onMouseEnter={playHoverSound}
                    onClick={() => onSetMapBackground(undefined)}
                    className="rounded-lg border border-rose-400/30 px-2.5 py-1.5 text-[11px] font-semibold text-rose-200 transition hover:bg-rose-500/10"
                    aria-label={t`Remove background`}
                  >
                    <Trans>Remove</Trans>
                  </button>
                )}
              </div>
            </div>

            {background ? (
              <div className="overflow-hidden rounded-lg border border-zinc-700/50 bg-black/40">
                <div className="relative aspect-video bg-zinc-950">
                  {background.kind === "video" ? (
                    <video
                      src={background.uri}
                      className="h-full w-full object-cover"
                      muted
                      loop
                      autoPlay
                      playsInline
                    />
                  ) : (
                    <img
                      src={background.uri}
                      alt=""
                      className="h-full w-full object-cover"
                      draggable={false}
                    />
                  )}
                </div>
                <p className="truncate px-2.5 py-2 text-[11px] text-zinc-300">
                  {background.name ?? background.uri}
                </p>
              </div>
            ) : (
              <p className="rounded-lg border border-dashed border-zinc-700/50 px-3 py-3 text-center text-[11px] text-zinc-600">
                <Trans>No background media selected.</Trans>
              </p>
            )}

            {background && (
              <div className="space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  {(["cover", "contain", "stretch", "tile"] as const).map((fit) => (
                    <button
                      key={fit}
                      type="button"
                      onMouseEnter={playHoverSound}
                      onClick={() => onPatchMapBackground({ fit })}
                      className={`rounded-lg border px-2 py-1.5 text-[11px] capitalize transition ${
                        background.fit === fit
                          ? "border-cyan-400/50 bg-cyan-500/15 text-cyan-100"
                          : "border-zinc-700/50 text-zinc-400 hover:text-zinc-200"
                      }`}
                    >
                      {fit}
                    </button>
                  ))}
                </div>
                <div className="grid grid-cols-5 gap-1">
                  {(["center", "top", "bottom", "left", "right"] as const).map((position) => (
                    <button
                      key={position}
                      type="button"
                      onMouseEnter={playHoverSound}
                      onClick={() => onPatchMapBackground({ position })}
                      className={`rounded border px-1 py-1 text-[10px] capitalize transition ${
                        background.position === position
                          ? "border-cyan-400/50 bg-cyan-500/15 text-cyan-100"
                          : "border-zinc-700/50 text-zinc-500 hover:text-zinc-300"
                      }`}
                    >
                      {position.slice(0, 3)}
                    </button>
                  ))}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {(["fixed", "parallax"] as const).map((motion) => (
                    <button
                      key={motion}
                      type="button"
                      onMouseEnter={playHoverSound}
                      onClick={() => onPatchMapBackground({ motion })}
                      className={`rounded-lg border px-2 py-1.5 text-[11px] capitalize transition ${
                        background.motion === motion
                          ? "border-cyan-400/50 bg-cyan-500/15 text-cyan-100"
                          : "border-zinc-700/50 text-zinc-400 hover:text-zinc-200"
                      }`}
                    >
                      {motion === "fixed" ? <Trans>Fixed</Trans> : <Trans>Parallax</Trans>}
                    </button>
                  ))}
                </div>
                {[
                  { key: "opacity" as const, label: t`Opacity`, min: 0, max: 1, step: 0.05 },
                  { key: "dim" as const, label: t`Dim`, min: 0, max: 1, step: 0.05 },
                  { key: "blur" as const, label: t`Blur`, min: 0, max: 24, step: 1 },
                  { key: "scale" as const, label: t`Scale`, min: 0.25, max: 4, step: 0.05 },
                  ...(background.motion === "parallax"
                    ? [
                        {
                          key: "parallaxStrength" as const,
                          label: t`Parallax`,
                          min: 0,
                          max: 1,
                          step: 0.02,
                        },
                      ]
                    : []),
                ].map((control) => {
                  const inputId = `map-background-${control.key}`;
                  return (
                    <div key={control.key} className="block space-y-1">
                      <label
                        htmlFor={inputId}
                        className="flex justify-between text-[10px] uppercase tracking-[0.08em] text-zinc-500"
                      >
                        <span>{control.label}</span>
                        <span>
                          {Number(background[control.key]).toFixed(control.key === "blur" ? 0 : 2)}
                        </span>
                      </label>
                      <input
                        id={inputId}
                        type="range"
                        min={control.min}
                        max={control.max}
                        step={control.step}
                        value={background[control.key]}
                        onChange={(event) =>
                          onPatchMapBackground(
                            backgroundNumberPatch(control.key, Number(event.target.value))
                          )
                        }
                        className="w-full accent-cyan-400"
                      />
                    </div>
                  );
                })}
                <div className="grid grid-cols-2 gap-2">
                  {(["offsetX", "offsetY"] as const).map((key) => (
                    <label key={key} className="block space-y-1">
                      <span className="text-[10px] uppercase tracking-[0.08em] text-zinc-500">
                        {key === "offsetX" ? t`Offset X` : t`Offset Y`}
                      </span>
                      <input
                        type="number"
                        value={background[key]}
                        onChange={(event) =>
                          onPatchMapBackground(
                            backgroundNumberPatch(key, Number.parseFloat(event.target.value) || 0)
                          )
                        }
                        className="w-full rounded-lg border border-zinc-700/50 bg-zinc-950 px-2 py-1.5 text-xs text-zinc-100 outline-none focus:border-cyan-400/50"
                      />
                    </label>
                  ))}
                </div>
                <button
                  type="button"
                  onMouseEnter={playHoverSound}
                  onClick={() => onPatchMapBackground({ offsetX: 0, offsetY: 0, scale: 1 })}
                  className="w-full rounded-lg border border-zinc-700/50 px-2.5 py-1.5 text-[11px] text-zinc-300 transition hover:border-zinc-500"
                >
                  <Trans>Reset position</Trans>
                </button>
              </div>
            )}
          </div>

          <div className="space-y-2 border-t border-zinc-800/80 pt-3">
            <div className="flex items-center justify-between">
              <p className="text-[11px] font-medium uppercase tracking-[0.1em] text-zinc-500">
                <Trans>Road Palette</Trans>
              </p>
              <button
                type="button"
                onMouseEnter={playHoverSound}
                onClick={onResetRoadPalette}
                className="rounded border border-zinc-700/50 px-2 py-1 text-[10px] text-zinc-400 transition hover:text-zinc-200"
              >
                <Trans>Reset roads</Trans>
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {ROAD_PALETTE_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  onMouseEnter={playHoverSound}
                  onClick={() => onSetRoadPalette({ ...preset.palette })}
                  className={`rounded-lg border px-2 py-1.5 text-left text-[11px] transition ${
                    roadPalette.presetId === preset.id
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
            </div>
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
                ] as Array<[RoadPaletteColorKey, string]>
              ).map(([key, label]) => (
                <label key={key} className="flex items-center justify-between gap-2">
                  <span className="text-[10px] uppercase tracking-[0.08em] text-zinc-500">
                    {label}
                  </span>
                  <input
                    type="color"
                    value={roadPalette[key]}
                    onChange={(event) =>
                      onPatchRoadPalette(roadColorPatch(key, event.target.value))
                    }
                    className="h-8 w-12 rounded border border-zinc-700/60 bg-zinc-950 p-1"
                  />
                </label>
              ))}
            </div>
          </div>
        </div>

        <div className="space-y-3 rounded-xl border border-cyan-400/20 bg-zinc-950/50 p-3">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-[0.1em] text-cyan-300/80">
              <Trans>Playlist Music</Trans>
            </p>
            <p className="mt-1 text-[11px] text-zinc-600">
              <Trans>
                Music added here is used only while this playlist is running. It will not be added
                to the global music playlist.
              </Trans>
            </p>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onMouseEnter={playHoverSound}
                onClick={onChoosePlaylistMusicFiles}
                className="rounded-lg border border-cyan-400/30 bg-cyan-500/10 px-2.5 py-1.5 text-[11px] font-semibold text-cyan-100 transition hover:border-cyan-300/60"
              >
                <Trans>Add music</Trans>
              </button>
              <button
                type="button"
                onMouseEnter={playHoverSound}
                onClick={() => {
                  setShowMusicUrlInput((current) => !current);
                  setMusicUrlError(null);
                  setMusicUrlResult(null);
                }}
                className={`rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold transition ${
                  showMusicUrlInput
                    ? "border-zinc-500/70 bg-zinc-700/40 text-zinc-100"
                    : "border-cyan-400/30 bg-cyan-500/10 text-cyan-100 hover:border-cyan-300/60"
                }`}
              >
                {showMusicUrlInput ? t`Cancel` : t`Add from URL`}
              </button>
            </div>
            <label className="flex items-center gap-1.5 text-[11px] text-zinc-400">
              <input
                type="checkbox"
                checked={music.loop}
                onChange={(event) => onSetPlaylistMusicLoop(event.target.checked)}
                className="rounded border-zinc-600 bg-zinc-950"
              />
              <Trans>Loop</Trans>
            </label>
          </div>

          {showMusicUrlInput && (
            <div className="space-y-2 rounded-lg border border-cyan-400/20 bg-cyan-950/10 p-2.5">
              <div className="inline-flex rounded-lg border border-zinc-700/60 bg-zinc-950/70 p-0.5">
                {(["track", "playlist"] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onMouseEnter={playHoverSound}
                    onClick={() => {
                      setMusicUrlMode(mode);
                      setMusicUrlResult(null);
                      setMusicUrlError(null);
                    }}
                    className={`rounded-md px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] transition ${
                      musicUrlMode === mode
                        ? "bg-cyan-400/20 text-cyan-100"
                        : "text-zinc-500 hover:text-zinc-300"
                    }`}
                    aria-pressed={musicUrlMode === mode}
                  >
                    {mode === "track" ? t`Track` : t`Playlist`}
                  </button>
                ))}
              </div>
              <div className="flex flex-col gap-2 sm:flex-row">
                <label className="sr-only" htmlFor="playlist-music-url">
                  <Trans>Playlist music URL</Trans>
                </label>
                <input
                  id="playlist-music-url"
                  aria-label={t`Playlist music URL`}
                  type="url"
                  value={musicUrlInput}
                  onChange={(event) => {
                    setMusicUrlInput(event.target.value);
                    setMusicUrlError(null);
                    setMusicUrlResult(null);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      void handleAddMusicUrl();
                    }
                  }}
                  placeholder={
                    musicUrlMode === "playlist"
                      ? t`Paste playlist or set URL`
                      : t`Paste track URL`
                  }
                  disabled={isAddingMusicUrl}
                  className={`min-w-0 flex-1 rounded-lg border bg-zinc-950/70 px-2.5 py-1.5 text-xs text-zinc-100 placeholder-zinc-600 outline-none transition ${
                    musicUrlError
                      ? "border-rose-400/60"
                      : "border-zinc-700/60 focus:border-cyan-300/70"
                  }`}
                />
                <button
                  type="button"
                  onMouseEnter={playHoverSound}
                  onClick={() => void handleAddMusicUrl()}
                  disabled={isAddingMusicUrl}
                  className="rounded-lg border border-cyan-400/30 bg-cyan-500/10 px-3 py-1.5 text-[11px] font-semibold text-cyan-100 transition hover:border-cyan-300/60 disabled:cursor-wait disabled:opacity-60"
                >
                  {isAddingMusicUrl ? t`Downloading...` : t`Add`}
                </button>
              </div>
              {musicUrlResult && (
                <p className="text-[11px] text-cyan-200/80">
                  {musicUrlResult.errors > 0
                    ? t`Added ${musicUrlResult.added} track${musicUrlResult.added !== 1 ? "s" : ""}, ${musicUrlResult.errors} failed`
                    : t`Added ${musicUrlResult.added} track${musicUrlResult.added !== 1 ? "s" : ""}`}
                </p>
              )}
              {musicUrlError && <p className="text-[11px] text-rose-300">{musicUrlError}</p>}
            </div>
          )}

          {music.tracks.length === 0 ? (
            <p className="rounded-lg border border-dashed border-zinc-700/50 px-3 py-3 text-center text-[11px] text-zinc-600">
              <Trans>No playlist music configured.</Trans>
            </p>
          ) : (
            <div className="space-y-1.5">
              {music.tracks.map((track, index) => (
                <div
                  key={track.id}
                  className="flex items-center gap-1.5 rounded-lg border border-zinc-700/40 px-2.5 py-2 text-xs text-zinc-300"
                >
                  <span className="flex-1 truncate" title={track.name}>
                    {track.name}
                  </span>
                  <button
                    type="button"
                    onMouseEnter={playHoverSound}
                    onClick={() => onMovePlaylistMusicTrack(track.id, -1)}
                    disabled={index === 0}
                    className="rounded p-1 text-zinc-500 transition hover:text-zinc-300 disabled:opacity-30"
                    aria-label={t`Move up`}
                  >
                    ▲
                  </button>
                  <button
                    type="button"
                    onMouseEnter={playHoverSound}
                    onClick={() => onMovePlaylistMusicTrack(track.id, 1)}
                    disabled={index === music.tracks.length - 1}
                    className="rounded p-1 text-zinc-500 transition hover:text-zinc-300 disabled:opacity-30"
                    aria-label={t`Move down`}
                  >
                    ▼
                  </button>
                  <button
                    type="button"
                    onMouseEnter={playHoverSound}
                    onClick={() => onRemovePlaylistMusicTrack(track.id)}
                    className="rounded p-1 text-rose-400/70 transition hover:text-rose-300"
                    aria-label={t`Remove`}
                  >
                    ✕
                  </button>
                </div>
              ))}
              <button
                type="button"
                onMouseEnter={playHoverSound}
                onClick={onClearPlaylistMusicTracks}
                className="w-full rounded-lg border border-rose-400/30 bg-rose-500/10 px-2.5 py-1.5 text-[11px] font-semibold text-rose-100 transition hover:border-rose-300/60"
              >
                <Trans>Clear all</Trans>
              </button>
            </div>
          )}
        </div>

        <div className="space-y-3 rounded-xl border border-zinc-700/40 bg-zinc-950/40 p-3">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-[0.1em] text-zinc-500">
              <Trans>Dice Roll Limits</Trans>
            </p>
            <p className="mt-1 text-[11px] text-zinc-600">
              <Trans>Controls the range of the dice used for movement.</Trans>
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="block space-y-1">
              <span className="text-[11px] font-medium uppercase tracking-[0.1em] text-zinc-500">
                <Trans>Minimum Roll</Trans>
              </span>
              <input
                aria-label={t`Minimum Roll`}
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
                <Trans>Maximum Roll</Trans>
              </span>
              <input
                aria-label={t`Maximum Roll`}
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
              <Trans>Save Mode</Trans>
            </p>
            <p className="mt-1 text-[11px] text-zinc-600">
              <Trans>
                Save-enabled runs are marked as assisted in local highscores and run history.
              </Trans>
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {[
              { value: "none" as const, label: t`No Saves` },
              { value: "checkpoint" as const, label: t`Only Checkpoint` },
              { value: "everywhere" as const, label: t`Everywhere`, fullWidth: true },
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
              {saveMode === "checkpoint" ? "🚩" : "💾"}
              {t` Warning: runs from this playlist are marked as assisted on the highscore and in run history.`}
            </p>
          )}
        </div>

        <div className="space-y-2 rounded-xl border border-zinc-700/40 bg-zinc-950/40 p-3">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-[0.1em] text-zinc-500">
              <Trans>Perk Rates</Trans>
            </p>
            <p className="mt-1 text-[11px] text-zinc-600">
              <Trans>Match the singleplayer trigger and per-round chance growth.</Trans>
            </p>
          </div>
          <label className="block space-y-1">
            <span className="text-[11px] font-medium uppercase tracking-[0.1em] text-zinc-500">
              <Trans>Random perk selection chance</Trans>
            </span>
            <input
              aria-label={t`Random perk selection chance`}
              type="number"
              min={0}
              max={100}
              step={1}
              value={percent(perkSelection.triggerChancePerCompletedRound)}
              onChange={(event) => onSetPerkTriggerChance(toRatio(event.target.value))}
              className="w-full rounded-lg border border-zinc-700/50 bg-zinc-950 px-2.5 py-2 text-sm text-zinc-100 outline-none transition focus:border-cyan-400/50"
            />
            <p className="text-[10px] text-zinc-600">
              <Trans>Percent chance after each completed round.</Trans>
            </p>
          </label>
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="block space-y-1">
              <span className="text-[11px] font-medium uppercase tracking-[0.1em] text-zinc-500">
                <Trans>Intermediary initial</Trans>
              </span>
              <input
                aria-label={t`Intermediary initial`}
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
              <p className="text-[10px] text-zinc-600">
                <Trans>Starting percent chance.</Trans>
              </p>
            </label>
            <label className="block space-y-1">
              <span className="text-[11px] font-medium uppercase tracking-[0.1em] text-zinc-500">
                <Trans>Intermediary increase</Trans>
              </span>
              <input
                aria-label={t`Intermediary increase`}
                type="number"
                min={0}
                max={100}
                step={1}
                value={percent(probabilityScaling.intermediaryIncreasePerRound)}
                onChange={(event) =>
                  onSetProbabilityScaling(
                    "intermediaryIncreasePerRound",
                    toRatio(event.target.value)
                  )
                }
                className="w-full rounded-lg border border-zinc-700/50 bg-zinc-950 px-2.5 py-2 text-sm text-zinc-100 outline-none transition focus:border-cyan-400/50"
              />
              <p className="text-[10px] text-zinc-600">
                <Trans>Percent added per round.</Trans>
              </p>
            </label>
            <label className="block space-y-1">
              <span className="text-[11px] font-medium uppercase tracking-[0.1em] text-zinc-500">
                <Trans>Intermediary max</Trans>
              </span>
              <input
                aria-label={t`Intermediary max`}
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
              <p className="text-[10px] text-zinc-600">
                <Trans>Highest intermediary chance allowed.</Trans>
              </p>
            </label>
            <label className="block space-y-1">
              <span className="text-[11px] font-medium uppercase tracking-[0.1em] text-zinc-500">
                <Trans>Anti-perk initial</Trans>
              </span>
              <input
                aria-label={t`Anti-perk initial`}
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
              <p className="text-[10px] text-zinc-600">
                <Trans>Starting percent chance.</Trans>
              </p>
            </label>
            <label className="block space-y-1">
              <span className="text-[11px] font-medium uppercase tracking-[0.1em] text-zinc-500">
                <Trans>Anti-perk increase</Trans>
              </span>
              <input
                aria-label={t`Anti-perk increase`}
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
              <p className="text-[10px] text-zinc-600">
                <Trans>Percent added per round.</Trans>
              </p>
            </label>
            <label className="block space-y-1">
              <span className="text-[11px] font-medium uppercase tracking-[0.1em] text-zinc-500">
                <Trans>Anti-perk max</Trans>
              </span>
              <input
                aria-label={t`Anti-perk max`}
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
              <p className="text-[10px] text-zinc-600">
                <Trans>Highest anti-perk chance allowed.</Trans>
              </p>
            </label>
            <label className="block space-y-1 sm:col-span-2">
              <span className="text-[11px] font-medium uppercase tracking-[0.1em] text-zinc-500">
                <Trans>Starting Money</Trans>
              </span>
              <input
                aria-label={t`Starting Money`}
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
                <Trans>Money available at the start of a new run from this playlist.</Trans>
              </p>
            </label>
            <label className="block space-y-1 sm:col-span-2">
              <span className="text-[11px] font-medium uppercase tracking-[0.1em] text-zinc-500">
                {abbreviateNsfwText(t`Cum round bonus score`, sfwMode)}
              </span>
              <input
                aria-label={abbreviateNsfwText(t`Cum round bonus score`, sfwMode)}
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
                {abbreviateNsfwText(t`Score awarded when a cum round succeeds.`, sfwMode)}
              </p>
            </label>
          </div>
        </div>

        <div className="space-y-2 rounded-xl border border-zinc-700/40 bg-zinc-950/40 p-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <p className="text-[11px] font-medium uppercase tracking-[0.1em] text-zinc-500">
                <Trans>Perks</Trans>
              </p>
              <p className="mt-1 text-[11px] text-zinc-600">
                {t`${perkPool.enabledPerkIds.length}/${perkOptions.length} active`}
              </p>
            </div>
            <div className="flex gap-1.5">
              <button
                type="button"
                className="rounded border border-emerald-500/30 px-2 py-1 text-[10px] uppercase tracking-wide text-emerald-200 transition-colors hover:bg-emerald-500/10"
                onClick={() => onSetAllPerksEnabled(true)}
              >
                <Trans>Activate all</Trans>
              </button>
              <button
                type="button"
                className="rounded border border-zinc-700/40 px-2 py-1 text-[10px] uppercase tracking-wide text-zinc-300 transition-colors hover:bg-zinc-800/70"
                onClick={() => onSetAllPerksEnabled(false)}
              >
                <Trans>Deactivate all</Trans>
              </button>
            </div>
          </div>
          {renderPerkToggleList(
            perkOptions,
            perkPool.enabledPerkIds,
            "emerald",
            t`No perks available.`,
            onTogglePerk,
            { device: t`Device`, active: t`Active`, inactive: t`Inactive` }
          )}
        </div>

        <div className="space-y-2 rounded-xl border border-zinc-700/40 bg-zinc-950/40 p-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <p className="text-[11px] font-medium uppercase tracking-[0.1em] text-zinc-500">
                <Trans>Anti-Perks</Trans>
              </p>
              <p className="mt-1 text-[11px] text-zinc-600">
                {t`${perkPool.enabledAntiPerkIds.length}/${antiPerkOptions.length} active`}
              </p>
            </div>
            <div className="flex gap-1.5">
              <button
                type="button"
                className="rounded border border-rose-500/30 px-2 py-1 text-[10px] uppercase tracking-wide text-rose-200 transition-colors hover:bg-rose-500/10"
                onClick={() => onSetAllAntiPerksEnabled(true)}
              >
                <Trans>Activate all</Trans>
              </button>
              <button
                type="button"
                className="rounded border border-zinc-700/40 px-2 py-1 text-[10px] uppercase tracking-wide text-zinc-300 transition-colors hover:bg-zinc-800/70"
                onClick={() => onSetAllAntiPerksEnabled(false)}
              >
                <Trans>Deactivate all</Trans>
              </button>
            </div>
          </div>
          {renderPerkToggleList(
            antiPerkOptions,
            perkPool.enabledAntiPerkIds,
            "rose",
            t`No anti-perks available.`,
            onToggleAntiPerk,
            { device: t`Device`, active: t`Active`, inactive: t`Inactive` }
          )}
        </div>

        <div>
          <p className="text-[11px] font-medium uppercase tracking-[0.1em] text-zinc-500">
            {abbreviateNsfwText(t`Cum Rounds`, sfwMode)}
          </p>
          <p className="mt-1 text-[11px] text-zinc-600">
            <Trans>Landing on any end node queues these rounds in order.</Trans>
          </p>
        </div>

        {/* ── Selected cum rounds ─────────────────── */}
        <div className="space-y-1.5">
          {cumRoundRefs.length === 0 && (
            <p className="rounded-lg border border-dashed border-zinc-700/50 px-3 py-3 text-center text-[11px] text-zinc-600">
              {abbreviateNsfwText(t`No cum rounds selected.`, sfwMode)}
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
                  {!resolved && (
                    <p className="text-[10px] text-amber-400/70">
                      <Trans>Unresolved</Trans>
                    </p>
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
          <p className="text-[11px] font-medium uppercase tracking-[0.1em] text-zinc-500">
            <Trans>Available</Trans>
          </p>
          {cumRounds.map((round) => {
            const selected = selectedCumRoundIdSet.has(round.id);
            return (
              <button
                key={round.id}
                type="button"
                className={`block w-full rounded-lg border px-2.5 py-2 text-left text-xs transition-all ${
                  selected
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
              {abbreviateNsfwText(t`No installed cum rounds found.`, sfwMode)}
            </p>
          )}
        </div>
      </div>
    );
  }
);

GraphSettingsPanel.displayName = "GraphSettingsPanel";
