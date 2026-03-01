import React from "react";
import { Trans, useLingui } from "@lingui/react/macro";
import {
  playHoverSound,
  playSelectSound,
  playMapInvalidActionSound,
} from "../../../../utils/audio";
import { normalizeGraphBackgroundMedia } from "../../EditorState";

type BackgroundPreset = {
  kind?: "image" | "video";
  uri?: string;
  name?: string;
  fit?: "cover" | "contain" | "stretch" | "tile";
  position?: "center" | "top" | "bottom" | "left" | "right";
  opacity?: number;
  blur?: number;
  dim?: number;
  scale?: number;
  offsetX?: number;
  offsetY?: number;
  motion?: "fixed" | "parallax";
  parallaxStrength?: number;
};

type BackgroundPresetEditorProps = {
  preset: BackgroundPreset;
  onPatchPreset: (patch: Partial<BackgroundPreset>) => void;
};

const clampNum = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

const getFileNameFromPath = (filePath: string): string => {
  const normalized = filePath.replace(/\\/g, "/");
  return normalized.split("/").pop() ?? "Background";
};

export const BackgroundPresetEditor: React.FC<BackgroundPresetEditorProps> = React.memo(
  ({ preset, onPatchPreset }) => {
    const { t } = useLingui();
    const [collapsed, setCollapsed] = React.useState(false);

    const handleChooseMedia = React.useCallback(async () => {
      try {
        const filePath = await window.electronAPI.dialog.selectMapBackgroundFile();
        if (!filePath) return;
        const uri = window.electronAPI.file.convertFileSrc(filePath);
        const normalized = normalizeGraphBackgroundMedia({
          ...preset,
          uri,
          name: getFileNameFromPath(filePath),
        });
        if (!normalized) {
          playMapInvalidActionSound();
          return;
        }
        onPatchPreset(normalized);
        playSelectSound();
      } catch {
        playMapInvalidActionSound();
      }
    }, [preset, onPatchPreset]);

    const handleRemoveMedia = React.useCallback(() => {
      onPatchPreset({ uri: undefined, kind: undefined, name: undefined });
    }, [onPatchPreset]);

    const hasMedia = typeof preset.uri === "string" && preset.uri.trim().length > 0;

    const controls: Array<{
      key: keyof BackgroundPreset;
      label: string;
      min: number;
      max: number;
      step: number;
      decimals: number;
      show?: boolean;
    }> = [
      { key: "opacity", label: t`Opacity`, min: 0, max: 1, step: 0.05, decimals: 2 },
      { key: "dim", label: t`Dim`, min: 0, max: 1, step: 0.05, decimals: 2 },
      { key: "blur", label: t`Blur`, min: 0, max: 24, step: 1, decimals: 0 },
      { key: "scale", label: t`Scale`, min: 0.25, max: 4, step: 0.05, decimals: 2 },
      {
        key: "parallaxStrength",
        label: t`Parallax`,
        min: 0,
        max: 1,
        step: 0.02,
        decimals: 2,
        show: preset.motion === "parallax",
      },
    ];

    return (
      <div className="space-y-2 rounded-md border border-zinc-700/30 bg-zinc-950/30 p-2">
        <div className="flex items-center justify-between">
          <p className="text-[10px] font-medium uppercase tracking-[0.1em] text-zinc-500">
            <Trans>Background</Trans>
          </p>
          <div className="flex gap-1.5">
            <button
              type="button"
              onMouseEnter={playHoverSound}
              onClick={handleChooseMedia}
              className="rounded-lg border border-cyan-400/30 bg-cyan-500/10 px-2 py-1 text-[10px] font-semibold text-cyan-100 transition hover:border-cyan-300/60"
            >
              <Trans>Choose media</Trans>
            </button>
            {hasMedia && (
              <button
                type="button"
                onMouseEnter={playHoverSound}
                onClick={handleRemoveMedia}
                className="rounded-lg border border-rose-400/30 px-2 py-1 text-[10px] font-semibold text-rose-200 transition hover:bg-rose-500/10"
              >
                <Trans>Remove</Trans>
              </button>
            )}
          </div>
        </div>

        {hasMedia ? (
          <div className="space-y-2">
            <div className="overflow-hidden rounded-lg border border-zinc-700/50 bg-black/40">
              <div className="relative aspect-video bg-zinc-950">
                {preset.kind === "video" ? (
                  <video
                    src={preset.uri}
                    className="h-full w-full object-cover"
                    muted
                    loop
                    autoPlay
                    playsInline
                  />
                ) : (
                  <img
                    src={preset.uri}
                    alt=""
                    className="h-full w-full object-cover"
                    draggable={false}
                  />
                )}
              </div>
              <p className="truncate px-2 py-1.5 text-[10px] text-zinc-400">
                {preset.name ?? preset.uri}
              </p>
            </div>

            {!collapsed && (
              <>
                <div className="grid grid-cols-4 gap-1">
                  {(["cover", "contain", "stretch", "tile"] as const).map((fit) => (
                    <button
                      key={fit}
                      type="button"
                      onMouseEnter={playHoverSound}
                      onClick={() => onPatchPreset({ fit })}
                      className={`rounded border px-1 py-1 text-[10px] capitalize transition ${
                        preset.fit === fit
                          ? "border-cyan-400/50 bg-cyan-500/15 text-cyan-100"
                          : "border-zinc-700/50 text-zinc-500 hover:text-zinc-300"
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
                      onClick={() => onPatchPreset({ position })}
                      className={`rounded border px-1 py-1 text-[10px] capitalize transition ${
                        preset.position === position
                          ? "border-cyan-400/50 bg-cyan-500/15 text-cyan-100"
                          : "border-zinc-700/50 text-zinc-500 hover:text-zinc-300"
                      }`}
                    >
                      {position.slice(0, 3)}
                    </button>
                  ))}
                </div>
                <div className="grid grid-cols-2 gap-1">
                  {(["fixed", "parallax"] as const).map((motion) => (
                    <button
                      key={motion}
                      type="button"
                      onMouseEnter={playHoverSound}
                      onClick={() => onPatchPreset({ motion })}
                      className={`rounded border px-1 py-1 text-[10px] capitalize transition ${
                        preset.motion === motion
                          ? "border-cyan-400/50 bg-cyan-500/15 text-cyan-100"
                          : "border-zinc-700/50 text-zinc-500 hover:text-zinc-300"
                      }`}
                    >
                      {motion === "fixed" ? t`Fixed` : t`Parallax`}
                    </button>
                  ))}
                </div>
                {controls
                  .filter((c) => c.show !== false)
                  .map((control) => {
                    const raw = preset[control.key];
                    const value = typeof raw === "number" ? raw : control.min;
                    return (
                      <div key={control.key} className="block space-y-0.5">
                        <label className="flex justify-between text-[10px] uppercase tracking-[0.08em] text-zinc-500">
                          <span>{control.label}</span>
                          <span>{value.toFixed(control.decimals)}</span>
                        </label>
                        <input
                          type="range"
                          min={control.min}
                          max={control.max}
                          step={control.step}
                          value={value}
                          onChange={(e) =>
                            onPatchPreset({
                              [control.key]: clampNum(
                                Number.parseFloat(e.target.value),
                                control.min,
                                control.max
                              ),
                            })
                          }
                          className="w-full accent-cyan-400"
                        />
                      </div>
                    );
                  })}
                <div className="grid grid-cols-2 gap-2">
                  {(["offsetX", "offsetY"] as const).map((key) => (
                    <label key={key} className="block space-y-0.5">
                      <span className="text-[10px] uppercase tracking-[0.08em] text-zinc-500">
                        {key === "offsetX" ? t`Offset X` : t`Offset Y`}
                      </span>
                      <input
                        type="number"
                        value={preset[key] ?? 0}
                        onChange={(e) =>
                          onPatchPreset({
                            [key]: Number.parseFloat(e.target.value) || 0,
                          })
                        }
                        className="w-full rounded-md border border-zinc-700/50 bg-zinc-950/60 px-2 py-1 text-[11px] text-zinc-100 outline-none focus:border-cyan-400/50"
                      />
                    </label>
                  ))}
                </div>
                <label className="block space-y-0.5">
                  <span className="text-[10px] uppercase tracking-[0.08em] text-zinc-500">
                    <Trans>Name</Trans>
                  </span>
                  <input
                    type="text"
                    value={preset.name ?? ""}
                    onChange={(e) => onPatchPreset({ name: e.target.value || undefined })}
                    placeholder={t`Optional label`}
                    className="w-full rounded-md border border-zinc-700/50 bg-zinc-950/60 px-2 py-1 text-[11px] text-zinc-100 outline-none focus:border-cyan-400/50"
                  />
                </label>
              </>
            )}

            <button
              type="button"
              className="w-full rounded-md border border-zinc-700/30 bg-zinc-950/30 py-1 text-[10px] text-zinc-400 hover:text-zinc-200 hover:border-zinc-500/40"
              onClick={() => setCollapsed((prev) => !prev)}
            >
              {collapsed ? t`Show settings` : t`Hide settings`}
            </button>
          </div>
        ) : (
          <p className="rounded-lg border border-dashed border-zinc-700/50 px-3 py-2 text-center text-[10px] text-zinc-600">
            <Trans>No media selected. Click "Choose media" to attach a file.</Trans>
          </p>
        )}
      </div>
    );
  }
);

BackgroundPresetEditor.displayName = "BackgroundPresetEditor";
