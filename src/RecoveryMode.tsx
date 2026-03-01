import { useState } from "react";
import { I18nProvider as LinguiProvider } from "@lingui/react";
import { ClearDataDialog, DEFAULT_CLEAR_DATA_SELECTIONS, type ClearDataSelections } from "./components/ClearDataDialog";
import { db } from "./services/db";
import { i18n } from "./i18n/config";

export function RecoveryMode() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selections, setSelections] = useState<ClearDataSelections>(DEFAULT_CLEAR_DATA_SELECTIONS);
  const [isClearing, setIsClearing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isStartingNormally, setIsStartingNormally] = useState(false);

  const startNormally = async () => {
    if (isStartingNormally) return;
    setIsStartingNormally(true);
    try {
      await window.electronAPI?.startupRecovery?.startNormally?.();
      window.location.reload();
    } catch (err) {
      console.error("Failed to start normally", err);
      setIsStartingNormally(false);
    }
  };

  const clearData = async () => {
    if (isClearing) return;
    setIsClearing(true);
    setError(null);
    setNotice(null);
    try {
      await db.install.clearAllData(selections);
      if (selections.settings) {
        window.localStorage.clear();
        window.sessionStorage.clear();
        window.location.reload();
        return;
      }
      setDialogOpen(false);
      setNotice("Selected recovery data was cleared.");
    } catch (clearError) {
      console.error("Failed to clear recovery data", clearError);
      setError(clearError instanceof Error ? clearError.message : "Failed to clear data.");
    } finally {
      setIsClearing(false);
    }
  };

  return (
    <LinguiProvider i18n={i18n}>
      <div className="min-h-screen bg-[#050508] text-zinc-100">
        <div className="fixed inset-0 bg-[radial-gradient(circle_at_top,rgba(244,63,94,0.22),transparent_36%),linear-gradient(135deg,rgba(127,29,29,0.35),transparent_42%,rgba(24,24,27,0.88))]" />
        <main className="relative mx-auto flex min-h-screen w-full max-w-3xl flex-col justify-center px-5 py-10">
          <p className="font-[family-name:var(--font-jetbrains-mono)] text-xs uppercase tracking-[0.35em] text-rose-200/80">
            Emergency Startup
          </p>
          <h1 className="mt-4 text-4xl font-black tracking-tight text-rose-50 sm:text-5xl">
            Emergency Recovery Mode
          </h1>
          <p className="mt-4 max-w-2xl text-base leading-7 text-zinc-300">
            You have entered recovery mode. Use this mode only when broken or corrupt local data
            prevents the app from starting normally.
          </p>

          <div className="mt-8 rounded-2xl border border-amber-300/35 bg-amber-500/10 p-4 text-sm leading-6 text-amber-100">
            Clearing data can permanently remove installed library entries, playlists, highscores,
            histories, caches, and settings from this device. Start normally if you do not need
            emergency maintenance.
          </div>

          {error ? (
            <div className="mt-5 rounded-2xl border border-rose-300/35 bg-rose-500/10 p-4 text-sm text-rose-100">
              {error}
            </div>
          ) : null}

          {notice ? (
            <div className="mt-5 rounded-2xl border border-emerald-300/35 bg-emerald-500/10 p-4 text-sm text-emerald-100">
              {notice}
            </div>
          ) : null}

          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <button
              type="button"
              disabled={isStartingNormally}
              onClick={() => void startNormally()}
              className={`rounded-xl border px-5 py-3 text-sm font-bold transition-all duration-200 ${
                isStartingNormally
                  ? "cursor-not-allowed border-zinc-600 bg-zinc-800 text-zinc-500"
                  : "border-emerald-300/70 bg-emerald-500/20 text-emerald-50 hover:border-emerald-200 hover:bg-emerald-500/30"
              }`}
            >
              {isStartingNormally ? "Starting..." : "Start Normally"}
            </button>
            <button
              type="button"
              disabled={isClearing}
              onClick={() => setDialogOpen(true)}
              className={`rounded-xl border px-5 py-3 text-sm font-bold transition-all duration-200 ${
                isClearing
                  ? "cursor-not-allowed border-zinc-600 bg-zinc-800 text-zinc-500"
                  : "border-rose-300/70 bg-rose-500/20 text-rose-50 hover:border-rose-200 hover:bg-rose-500/30"
              }`}
            >
              {isClearing ? "Clearing..." : "Manage & Clear Data"}
            </button>
          </div>

          <p className="mt-6 text-xs text-zinc-500">
            Recovery was opened with the startup R shortcut. Click &ldquo;Start Normally&rdquo; to
            reload the app, or restart and do not press R to skip this screen entirely.
          </p>
        </main>

        <ClearDataDialog
          isOpen={dialogOpen}
          isPending={isClearing}
          selections={selections}
          copy={{
            eyebrow: "Emergency Maintenance",
            title: "Clear Recovery Data",
            description:
              "Choose which local data categories to wipe.",
            warning: "Emergency deletion cannot be undone. A database backup is attempted first.",
          }}
          onSelectionChange={setSelections}
          onCancel={() => {
            if (!isClearing) setDialogOpen(false);
          }}
          onConfirm={() => void clearData()}
        />
      </div>
    </LinguiProvider>
  );
}
