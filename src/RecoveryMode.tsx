import { useEffect, useState } from "react";
import { I18nProvider as LinguiProvider } from "@lingui/react";
import {
  ClearDataDialog,
  DEFAULT_CLEAR_DATA_SELECTIONS,
  type ClearDataSelections,
} from "./components/ClearDataDialog";
import { db } from "./services/db";
import { trpc } from "./services/trpc";
import { i18n } from "./i18n/config";
import {
  DEBUG_LOG_LEVELS,
  normalizeDebugLogLevel,
  type DebugLogLevel,
} from "./constants/debugSettings";
import {
  clearStartNormallyOnce,
  normalizeAlwaysRecoveryMode,
  setStartNormallyOnce,
} from "./constants/startupSettings";

type RecoveryStatus = {
  databasePath: string | null;
  databaseExists: boolean;
  databaseBytes: number | null;
  integrity: "ok" | "missing" | "unavailable" | "corrupt";
  integrityMessage: string;
};

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
  const [recoveryStatus, setRecoveryStatus] = useState<RecoveryStatus | null>(null);
  const [activeRecoveryAction, setActiveRecoveryAction] = useState<string | null>(null);
  const [alwaysRecoveryMode, setAlwaysRecoveryMode] = useState(false);
  const [isTogglingAlwaysRecovery, setIsTogglingAlwaysRecovery] = useState(false);

  useEffect(() => {
    trpc.debug.getState
      .query()
      .then((state) => {
        setLogLevel(normalizeDebugLogLevel(state.logLevel));
      })
      .catch(() => {});
    void window.electronAPI?.startupRecovery
      ?.getStatus?.()
      .then(setRecoveryStatus)
      .catch(() => {});
    void window.electronAPI?.startupRecovery
      ?.getAlwaysRecoveryMode?.()
      .then((value) => {
        setAlwaysRecoveryMode(normalizeAlwaysRecoveryMode(value));
      })
      .catch(() => {});
  }, []);

  const runRecoveryAction = async (
    actionName: string,
    action: () => Promise<unknown>,
    successMessage: string,
    restartAfter = false
  ) => {
    if (activeRecoveryAction) return;
    setActiveRecoveryAction(actionName);
    setError(null);
    setNotice(null);
    try {
      await action();
      setNotice(successMessage);
      const status = await window.electronAPI?.startupRecovery?.getStatus?.();
      if (status) setRecoveryStatus(status);
      if (restartAfter) await window.electronAPI?.startupRecovery?.restart?.();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : `${actionName} failed.`);
    } finally {
      setActiveRecoveryAction(null);
    }
  };

  const startNormally = async () => {
    if (isStartingNormally) return;
    setIsStartingNormally(true);
    setStartNormallyOnce();
    try {
      await window.electronAPI?.startupRecovery?.startNormally?.();
      window.location.reload();
    } catch (err) {
      console.error("Failed to start normally", err);
      clearStartNormallyOnce();
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
      const recoveryApi = window.electronAPI?.startupRecovery;
      if (!recoveryApi?.backupDatabase) throw new Error("Recovery API is unavailable.");
      await recoveryApi.backupDatabase();
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
      setError(err instanceof Error ? err.message : "Failed to create plaintext settings file.");
    } finally {
      setIsCreatingPlaintextSettings(false);
    }
  };

  const toggleAlwaysRecoveryMode = async () => {
    if (isTogglingAlwaysRecovery) return;
    setIsTogglingAlwaysRecovery(true);
    setError(null);
    setNotice(null);
    const next = !alwaysRecoveryMode;
    try {
      await window.electronAPI?.startupRecovery?.setAlwaysRecoveryMode?.(next);
      setAlwaysRecoveryMode(next);
      setNotice(
        next
          ? "The app will always start in recovery mode until disabled."
          : "Always start in recovery mode disabled."
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to toggle recovery mode.");
    } finally {
      setIsTogglingAlwaysRecovery(false);
    }
  };

  return (
    <LinguiProvider i18n={i18n}>
      <div
        data-testid="recovery-scroll-container"
        className="fixed inset-0 overflow-y-auto overscroll-contain bg-[#050508] text-zinc-100"
      >
        <div className="fixed inset-0 bg-[radial-gradient(circle_at_top,rgba(244,63,94,0.22),transparent_36%),linear-gradient(135deg,rgba(127,29,29,0.35),transparent_42%,rgba(24,24,27,0.88))]" />
        <main className="relative mx-auto flex min-h-full w-full max-w-3xl flex-col px-5 py-10">
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

          <section className="mt-10 border-t border-zinc-800 pt-8">
            <h2 className="text-lg font-bold text-zinc-200">Guided Recovery</h2>
            <p className="mt-1 text-sm text-zinc-400">
              Try these in order. Your database is backed up before repairs or a reset.
            </p>

            {recoveryStatus ? (
              <div
                className={`mt-4 rounded-xl border p-3 text-sm ${
                  recoveryStatus.integrity === "ok"
                    ? "border-emerald-400/30 bg-emerald-500/10 text-emerald-100"
                    : recoveryStatus.integrity === "corrupt"
                      ? "border-rose-400/30 bg-rose-500/10 text-rose-100"
                      : "border-zinc-700 bg-zinc-900 text-zinc-300"
                }`}
              >
                <div className="font-semibold">Database: {recoveryStatus.integrity}</div>
                <div className="mt-1 break-words text-xs opacity-80">
                  {recoveryStatus.integrityMessage}
                  {recoveryStatus.databaseBytes !== null
                    ? ` (${(recoveryStatus.databaseBytes / 1024 / 1024).toFixed(1)} MB)`
                    : ""}
                </div>
              </div>
            ) : null}

            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <RecoveryActionButton
                title="1. Repair & Optimize Database"
                description="Checks integrity, creates a backup, applies every migration, rebuilds indexes, and compacts SQLite."
                pending={activeRecoveryAction === "database repair"}
                disabled={Boolean(activeRecoveryAction)}
                onClick={() =>
                  void runRecoveryAction(
                    "database repair",
                    async () => {
                      const api = window.electronAPI?.startupRecovery;
                      if (!api?.repairDatabase) throw new Error("Recovery API is unavailable.");
                      await api.repairDatabase();
                    },
                    "Database repaired and optimized. Restart the app when ready."
                  )
                }
              />
              <RecoveryActionButton
                title="2. Clear Caches"
                description="Removes Chromium, GPU, video, music, package, and website caches without touching the database or settings."
                pending={activeRecoveryAction === "cache cleanup"}
                disabled={Boolean(activeRecoveryAction)}
                onClick={() =>
                  void runRecoveryAction(
                    "cache cleanup",
                    async () => {
                      const api = window.electronAPI?.startupRecovery;
                      if (!api?.clearCaches) throw new Error("Recovery API is unavailable.");
                      await api.clearCaches();
                    },
                    "Caches cleared. Restart recommended."
                  )
                }
              />
              <RecoveryActionButton
                title="3. Reset Settings"
                description="Backs up and removes app preferences and graphics flags. The database stays untouched."
                pending={activeRecoveryAction === "settings reset"}
                disabled={Boolean(activeRecoveryAction)}
                onClick={() => {
                  if (!window.confirm("Reset all app settings? The database will be kept.")) return;
                  void runRecoveryAction(
                    "settings reset",
                    async () => {
                      const api = window.electronAPI?.startupRecovery;
                      if (!api?.resetSettings) throw new Error("Recovery API is unavailable.");
                      await api.resetSettings();
                    },
                    "Settings reset. Restarting...",
                    true
                  );
                }}
              />
              <RecoveryActionButton
                title="4. Reset App, Keep Database"
                description="Clears the installation state and caches, but preserves the SQLite database plus a separate recovery copy."
                pending={activeRecoveryAction === "installation reset"}
                disabled={Boolean(activeRecoveryAction)}
                onClick={() => {
                  if (!window.confirm("Reset the app installation while keeping the database?"))
                    return;
                  void runRecoveryAction(
                    "installation reset",
                    async () => {
                      const api = window.electronAPI?.startupRecovery;
                      if (!api?.resetInstallation) throw new Error("Recovery API is unavailable.");
                      await api.resetInstallation(true);
                    },
                    "Installation reset while preserving the database. Restarting...",
                    true
                  );
                }}
              />
            </div>

            <div className="mt-4 rounded-2xl border border-rose-500/35 bg-rose-950/30 p-4">
              <h3 className="font-bold text-rose-100">Last resort: start with a clean database</h3>
              <p className="mt-1 text-xs leading-5 text-rose-200/75">
                Archives the existing database and sidecar files, then clears the installation. The
                app creates a fresh database after restart, while the old one remains recoverable.
              </p>
              <button
                type="button"
                disabled={Boolean(activeRecoveryAction)}
                onClick={() => {
                  if (
                    !window.confirm(
                      "Factory reset the app? The old database will only remain as a recovery archive."
                    )
                  )
                    return;
                  void runRecoveryAction(
                    "factory reset",
                    async () => {
                      const api = window.electronAPI?.startupRecovery;
                      if (!api?.resetInstallation) throw new Error("Recovery API is unavailable.");
                      await api.resetInstallation(false);
                    },
                    "Factory reset complete. Restarting...",
                    true
                  );
                }}
                className="mt-3 rounded-xl border border-rose-300/70 bg-rose-500/20 px-4 py-2 text-sm font-bold text-rose-50 hover:bg-rose-500/30 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {activeRecoveryAction === "factory reset" ? "Resetting..." : "Factory Reset"}
              </button>
            </div>
          </section>

          <div className="mt-10 border-t border-zinc-800 pt-8">
            <h2 className="text-lg font-bold text-zinc-200">Utilities</h2>
            <p className="mt-1 text-sm text-zinc-400">
              Backup data or change the log level without leaving recovery mode.
            </p>

            <div className="mt-5 flex flex-col gap-3">
              <div
                className={`flex items-start justify-between gap-4 rounded-2xl border p-4 transition-colors ${
                  alwaysRecoveryMode
                    ? "border-rose-400/40 bg-rose-500/10"
                    : "border-zinc-700 bg-zinc-900/60 hover:border-zinc-600"
                }`}
              >
                <div>
                  <p className="text-sm font-semibold text-zinc-100">
                    Always Start in Recovery Mode
                  </p>
                  <p className="mt-1 text-xs leading-5 text-zinc-400">
                    Boots directly into recovery mode on every app launch. &ldquo;Start
                    Normally&rdquo; still opens the app once; a full restart returns here.
                  </p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={alwaysRecoveryMode}
                  disabled={isTogglingAlwaysRecovery}
                  onClick={() => void toggleAlwaysRecoveryMode()}
                  className={`relative mt-1 h-8 w-16 shrink-0 self-start overflow-hidden rounded-full border transition-all duration-200 ${
                    alwaysRecoveryMode
                      ? "border-rose-300/80 bg-rose-500/50"
                      : "border-zinc-600 bg-zinc-800"
                  } ${isTogglingAlwaysRecovery ? "cursor-not-allowed opacity-60" : "cursor-pointer"}`}
                >
                  <span
                    className={`absolute left-1 top-1 h-6 w-6 rounded-full bg-white shadow-md transition-transform duration-200 ${
                      alwaysRecoveryMode ? "translate-x-8" : "translate-x-0"
                    }`}
                  />
                </button>
              </div>

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
                  {isCreatingPlaintextSettings ? "Creating..." : "Create Plaintext Settings File"}
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
            description: "Choose which local data categories to wipe.",
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

function RecoveryActionButton({
  title,
  description,
  pending,
  disabled,
  onClick,
}: {
  title: string;
  description: string;
  pending: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="rounded-2xl border border-sky-400/30 bg-sky-500/10 p-4 text-left transition-colors hover:border-sky-300/60 hover:bg-sky-500/15 disabled:cursor-not-allowed disabled:opacity-50"
    >
      <div className="text-sm font-bold text-sky-100">{pending ? "Working..." : title}</div>
      <div className="mt-1 text-xs leading-5 text-zinc-400">{description}</div>
    </button>
  );
}
