import { Trans, useLingui } from "@lingui/react/macro";
import React from "react";
import { playHoverSound, playSelectSound } from "../../utils/audio";
import { GameDropdown } from "../../components/ui/GameDropdown";
import type { ConverterState } from "./useConverterState";

type SourcePanelProps = {
  sourceMode: "local" | "installed";
  videoUri: string;
  funscriptUri: string | null;
  installedSourceOptions: ConverterState["installedSourceOptions"];
  selectedInstalledId: string;
  onSetSourceMode: (mode: "local" | "installed") => void;
  onSetSelectedInstalledId: (id: string) => void;
  onSetDeleteSourceRound: (value: boolean) => void;
  onChooseLocalVideo: () => void;
  onChooseLocalFunscript: () => void;
};

export const SourcePanel: React.FC<SourcePanelProps> = React.memo(
  ({
    sourceMode,
    videoUri,
    funscriptUri,
    installedSourceOptions,
    selectedInstalledId,
    onSetSourceMode,
    onSetSelectedInstalledId,
    onSetDeleteSourceRound,
    onChooseLocalVideo,
    onChooseLocalFunscript,
  }) => {
    const { t } = useLingui();

    return (
      <div className="converter-panel-glass rounded-2xl p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-bold text-violet-100">
            <Trans>Source</Trans>
          </h2>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onMouseEnter={playHoverSound}
              onClick={() => {
                playSelectSound();
                onSetSourceMode("local");
                onSetDeleteSourceRound(false);
              }}
              className={`converter-mode-toggle ${
                sourceMode === "local"
                  ? "border-violet-300/70 bg-violet-500/25 text-violet-100 shadow-[0_0_12px_rgba(139,92,246,0.2)]"
                  : "border-zinc-700 bg-zinc-900/60 text-zinc-400 hover:border-zinc-600"
              }`}
            >
              <Trans>Local</Trans>
            </button>
            <button
              type="button"
              onMouseEnter={playHoverSound}
              onClick={() => {
                playSelectSound();
                onSetSourceMode("installed");
                onSetDeleteSourceRound(true);
              }}
              className={`converter-mode-toggle ${
                sourceMode === "installed"
                  ? "border-violet-300/70 bg-violet-500/25 text-violet-100 shadow-[0_0_12px_rgba(139,92,246,0.2)]"
                  : "border-zinc-700 bg-zinc-900/60 text-zinc-400 hover:border-zinc-600"
              }`}
            >
              <Trans>Installed</Trans>
            </button>
          </div>
        </div>

        {sourceMode === "local" ? (
          <div className="space-y-3">
            <button
              type="button"
              onMouseEnter={playHoverSound}
              onClick={() => {
                playSelectSound();
                onChooseLocalVideo();
              }}
              className="converter-action-button w-full border-violet-300/60 bg-violet-500/20 text-violet-100 hover:bg-violet-500/35 hover:shadow-[0_0_18px_rgba(139,92,246,0.25)]"
            >
              <span className="mr-2 text-base">📂</span> <Trans>Select Video File</Trans>
            </button>
            <button
              type="button"
              onMouseEnter={playHoverSound}
              onClick={() => {
                playSelectSound();
                onChooseLocalFunscript();
              }}
              className="converter-action-button w-full border-cyan-300/60 bg-cyan-500/20 text-cyan-100 hover:bg-cyan-500/35 hover:shadow-[0_0_18px_rgba(34,211,238,0.25)]"
            >
              <span className="mr-2 text-base">🔗</span> <Trans>Attach Funscript (Optional)</Trans>
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            <GameDropdown
              value={selectedInstalledId}
              options={[
                { value: "" as string, label: t`Select Installed Round` },
                ...installedSourceOptions.map((option) => ({
                  value: option.id,
                  label: option.label,
                })),
              ]}
              onSelectSfx={playSelectSound}
              onChange={(value) => {
                onSetSelectedInstalledId(value);
                playSelectSound();
              }}
            />
            <p className="text-xs text-zinc-400">
              <Trans>Installed rounds from local or external sources can be used.</Trans>
            </p>
          </div>
        )}

        <div className="mt-4 space-y-1.5 rounded-xl border border-zinc-700/60 bg-black/30 p-3 text-xs text-zinc-400">
          <div className="flex items-start gap-2">
            <span className="mt-0.5 text-violet-300/70">▸</span>
            <span className="break-all">
              <Trans>Video:</Trans>{" "}
              {videoUri || <span className="italic text-zinc-500">{t`Not selected`}</span>}
            </span>
          </div>
          <div className="flex items-start gap-2">
            <span className="mt-0.5 text-cyan-300/70">▸</span>
            <span className="break-all">
              <Trans>Funscript:</Trans>{" "}
              {funscriptUri || <span className="italic text-zinc-500">{t`Not attached`}</span>}
            </span>
          </div>
        </div>
      </div>
    );
  }
);

SourcePanel.displayName = "SourcePanel";

export function pickSourcePanelProps(state: ConverterState): SourcePanelProps {
  return {
    sourceMode: state.sourceMode,
    videoUri: state.videoUri,
    funscriptUri: state.funscriptUri,
    installedSourceOptions: state.installedSourceOptions,
    selectedInstalledId: state.selectedInstalledId,
    onSetSourceMode: state.setSourceMode,
    onSetSelectedInstalledId: state.setSelectedInstalledId,
    onSetDeleteSourceRound: state.setDeleteSourceRound,
    onChooseLocalVideo: () => void state.chooseLocalVideo(),
    onChooseLocalFunscript: () => void state.chooseLocalFunscript(),
  };
}
