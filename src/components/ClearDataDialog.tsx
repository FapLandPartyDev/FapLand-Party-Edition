import { Trans, useLingui } from "@lingui/react/macro";
import { playHoverSound } from "../utils/audio";

export type ClearDataSelections = {
  rounds: boolean;
  playlists: boolean;
  stats: boolean;
  history: boolean;
  cache: boolean;
  videoCache: boolean;
  musicCache: boolean;
  fpackExtraction: boolean;
  eroscriptsCache: boolean;
  acquisitionDownloads: boolean;
  settings: boolean;
};

export const DEFAULT_CLEAR_DATA_SELECTIONS: ClearDataSelections = {
  rounds: true,
  playlists: true,
  stats: true,
  history: true,
  cache: true,
  videoCache: true,
  musicCache: true,
  fpackExtraction: true,
  eroscriptsCache: true,
  acquisitionDownloads: true,
  settings: true,
};

type ClearDataDialogCopy = {
  eyebrow?: string;
  title?: string;
  description?: string;
  warning?: string;
};

export function ClearDataDialog({
  isOpen,
  isPending,
  selections,
  copy,
  onSelectionChange,
  onCancel,
  onConfirm,
}: {
  isOpen: boolean;
  isPending: boolean;
  selections: ClearDataSelections;
  copy?: ClearDataDialogCopy;
  onSelectionChange: (next: ClearDataSelections) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { t } = useLingui();
  if (!isOpen) return null;

  const categories = [
    {
      id: "rounds",
      label: t`Installed Rounds & Heroes`,
      description: t`All downloaded/imported game content.`,
    },
    { id: "playlists", label: t`Playlists`, description: t`Your custom and imported playlists.` },
    {
      id: "history",
      label: t`Run History`,
      description: t`Records of your past games and sessions.`,
    },
    {
      id: "stats",
      label: t`Global Stats`,
      description: t`Highscores and overall career progress.`,
    },
    {
      id: "cache",
      label: t`Multiplayer Cache`,
      description: t`Downloaded match results and sync queue.`,
    },
    {
      id: "videoCache",
      label: t`Video Cache`,
      description: t`Downloaded website videos and generated playback transcodes.`,
    },
    {
      id: "musicCache",
      label: t`Music Cache`,
      description: t`Downloaded menu music and imported YouTube audio.`,
    },
    {
      id: "fpackExtraction",
      label: t`.fpack Extractions`,
      description: t`Extracted pack contents stored for installed portable packages.`,
    },
    {
      id: "eroscriptsCache",
      label: t`EroScripts Cache`,
      description: t`Downloaded EroScripts funscripts and optional video copies.`,
    },
    {
      id: "acquisitionDownloads",
      label: t`Acquisition Downloads`,
      description: t`Downloaded torrent and MEGA files. Their source mappings are retained.`,
    },
    {
      id: "settings",
      label: t`App Settings & Preferences`,
      description: t`Preferences, hardware keys, and window state.`,
    },
  ] as const;

  const toggle = (id: keyof ClearDataSelections) => {
    onSelectionChange({ ...selections, [id]: !selections[id] });
  };

  const hasSelection = Object.values(selections).some(Boolean);

  return (
    <div className="fixed inset-0 z-30 flex items-start justify-center overflow-y-auto bg-black/70 px-4 py-4 backdrop-blur-sm sm:py-6">
      <div className="max-h-[calc(100vh-2rem)] w-full max-w-lg overflow-y-auto rounded-3xl border border-rose-300/35 bg-zinc-950/95 p-6 shadow-[0_0_60px_rgba(244,63,94,0.28)] sm:max-h-[calc(100vh-3rem)]">
        <p className="font-[family-name:var(--font-jetbrains-mono)] text-xs uppercase tracking-[0.35em] text-rose-200/80">
          {copy?.eyebrow ?? <Trans>Selective Maintenance</Trans>}
        </p>
        <h2 className="mt-3 text-2xl font-black tracking-tight text-rose-50">
          {copy?.title ?? <Trans>Clear Data</Trans>}
        </h2>
        <p className="mt-2 text-sm text-zinc-400">
          {copy?.description ?? (
            <Trans>Choose which categories of information to wipe from this device.</Trans>
          )}
        </p>

        <div className="mt-6 space-y-3">
          {categories.map((cat) => (
            <button
              key={cat.id}
              type="button"
              disabled={isPending}
              onClick={() => toggle(cat.id)}
              className={`flex w-full items-start gap-3 rounded-2xl border p-3 text-left transition-all duration-200 ${
                selections[cat.id]
                  ? "border-rose-400/40 bg-rose-500/10"
                  : "border-zinc-800 bg-black/20 hover:border-zinc-700"
              }`}
            >
              <div
                className={`mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded border transition-colors ${selections[cat.id] ? "border-rose-400 bg-rose-500 text-white" : "border-zinc-700 bg-zinc-900"}`}
              >
                {selections[cat.id] && (
                  <svg
                    className="h-3.5 w-3.5"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={4}
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                )}
              </div>
              <div>
                <div className="text-sm font-bold text-zinc-100">{cat.label}</div>
                <div className="text-xs text-zinc-500">{cat.description}</div>
              </div>
            </button>
          ))}
        </div>

        <p className="mt-5 text-sm font-semibold text-rose-200">
          {copy?.warning ?? <Trans>Warning: This cannot be undone.</Trans>}
        </p>

        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            disabled={isPending}
            onMouseEnter={playHoverSound}
            onClick={onCancel}
            className={`rounded-xl border px-4 py-2 text-sm font-semibold transition-all duration-200 ${
              isPending
                ? "cursor-not-allowed border-zinc-700 bg-zinc-900 text-zinc-500"
                : "border-zinc-600 bg-zinc-900/80 text-zinc-200 hover:border-zinc-400 hover:text-zinc-100"
            }`}
          >
            <Trans>Cancel</Trans>
          </button>
          <button
            type="button"
            disabled={isPending || !hasSelection}
            onMouseEnter={playHoverSound}
            onClick={onConfirm}
            className={`rounded-xl border px-4 py-2 text-sm font-semibold transition-all duration-200 ${
              isPending || !hasSelection
                ? "cursor-not-allowed border-zinc-600 bg-zinc-800 text-zinc-500"
                : "border-rose-300/70 bg-rose-500/25 text-rose-100 hover:border-rose-200/90 hover:bg-rose-500/40"
            }`}
          >
            {isPending ? t`Clearing...` : t`Confirm Deletion`}
          </button>
        </div>
      </div>
    </div>
  );
}
