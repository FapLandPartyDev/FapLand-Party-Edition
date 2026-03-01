import { useEffect, useState } from "react";
import { I18nProvider as LinguiProvider } from "@lingui/react";
import { ClearDataDialog, DEFAULT_CLEAR_DATA_SELECTIONS, type ClearDataSelections } from "./components/ClearDataDialog";
import { db } from "./services/db";
import { trpc } from "./services/trpc";
import { i18n } from "./i18n/config";
import { DEBUG_LOG_LEVELS, normalizeDebugLogLevel, type DebugLogLevel } from "./constants/debugSettings";

export function RecoveryMode() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selections, setSelections] = useState<ClearDataSelections>(DEFAULT_CLEAR_DATA_SELECTIONS);
  const [isClearing, setIsClearing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isStartingNormally, setIsStartingNormally] = useState(false);
  const [logLevel, setLogLevel] = useState<DebugLogLevel>("off");
  const [isBackingUpDb, setIsBackingUpDb] = useState(false);
  const [isBackingUpSettings, setIsBackingUpSettings] = useState(false);
  const [isCreatingPlaintextSettings, setIsCreatingPlaintextSettings] = useState(false);

  useEffect(() => {
    trpc.debug.getState
      .query()
      .then((state) => {
        setLogLevel(normalizeDebugLogLevel(state.logLevel));
      })
      .catch(() => {});
  }, []);

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

  const changeLogLevel = async (level: string) => {
    const normalized = normalizeDebugLogLevel(level);
    try {
      await trpc.debug.setLogLevel.mutate({ level: normalized });
      setLogLevel(normalized);
      setError(null);
      setNotice(`Log level changed to "${normalized}".`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to change log level.");
      setNotice(null);
    }
  };

  const backupDatabase = async () => {
    if (isBackingUpDb) return;
    setIsBackingUpDb(true);
    setError(null);
    setNotice(null);
    try {
      await db.install.backupDatabaseNow();
      setNotice("Database backup created.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to backup database.");
    } finally {
      setIsBackingUpDb(false);
    }
  };

  const backupSettings = async () => {
    if (isBackingUpSettings) return;
    setIsBackingUpSettings(true);
    setError(null);
    setNotice(null);
    try {
      await db.install.backupSettingsNow();
      setNotice("Settings backup created.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to backup settings.");
    } finally {
      setIsBackingUpSettings(false);
    }
  };

  const createPlaintextSettingsFile = async () => {
    if (isCreatingPlaintextSettings) return;
    setIsCreatingPlaintextSettings(true);
    setError(null);
    setNotice(null);
    try {
      await db.install.createPlaintextSettingsFile();
      setNotice("Plaintext settings file created.");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to create plaintext settings file."
      );
    } finally {
      setIsCreatingPlaintextSettings(false);
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

          <div className="mt-10 border-t border-zinc-800 pt-8">
            <h2 className="text-lg font-bold text-zinc-200">Utilities</h2>
            <p className="mt-1 text-sm text-zinc-400">
              Backup data or change the log level without leaving recovery mode.
            </p>

            <div className="mt-5 flex flex-col gap-3">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <label
                  htmlFor="recovery-log-level"
                  className="shrink-0 text-sm font-semibold text-zinc-300"
                >
                  Log Level
                </label>
                <select
                  id="recovery-log-level"
                  value={logLevel}
                  onChange={(e) => void changeLogLevel(e.target.value)}
                  className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-violet-400"
                >
                  {DEBUG_LOG_LEVELS.map((level) => (
                    <option key={level} value={level}>
                      {level.charAt(0).toUpperCase() + level.slice(1)}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex flex-col gap-3 sm:flex-row">
                <button
                  type="button"
                  onClick={() => void trpc.debug.openLogFolder.mutate()}
                  className="rounded-xl border border-sky-300/70 bg-sky-500/20 px-5 py-3 text-sm font-bold text-sky-50 transition-all duration-200 hover:border-sky-200 hover:bg-sky-500/30"
                >
                  Open Log File
                </button>
                <button
                  type="button"
                  disabled={isBackingUpDb}
                  onClick={() => void backupDatabase()}
                  className={`rounded-xl border px-5 py-3 text-sm font-bold transition-all duration-200 ${
                    isBackingUpDb
                      ? "cursor-not-allowed border-zinc-600 bg-zinc-800 text-zinc-500"
                      : "border-sky-300/70 bg-sky-500/20 text-sky-50 hover:border-sky-200 hover:bg-sky-500/30"
                  }`}
                >
                  {isBackingUpDb ? "Backing up..." : "Backup Database"}
                </button>
                <button
                  type="button"
                  disabled={isBackingUpSettings}
                  onClick={() => void backupSettings()}
                  className={`rounded-xl border px-5 py-3 text-sm font-bold transition-all duration-200 ${
                    isBackingUpSettings
                      ? "cursor-not-allowed border-zinc-600 bg-zinc-800 text-zinc-500"
                      : "border-sky-300/70 bg-sky-500/20 text-sky-50 hover:border-sky-200 hover:bg-sky-500/30"
                  }`}
                >
                  {isBackingUpSettings ? "Backing up..." : "Backup Settings"}
                </button>
                <button
                  type="button"
                  disabled={isCreatingPlaintextSettings}
                  onClick={() => void createPlaintextSettingsFile()}
                  className={`rounded-xl border px-5 py-3 text-sm font-bold transition-all duration-200 ${
                    isCreatingPlaintextSettings
                      ? "cursor-not-allowed border-zinc-600 bg-zinc-800 text-zinc-500"
                      : "border-amber-300/70 bg-amber-500/20 text-amber-50 hover:border-amber-200 hover:bg-amber-500/30"
                  }`}
                >
                  {isCreatingPlaintextSettings
                    ? "Creating..."
                    : "Create Plaintext Settings File"}
                </button>
              </div>
            </div>
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
