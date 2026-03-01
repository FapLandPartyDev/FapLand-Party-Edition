import { useCallback, useEffect, useMemo, useState } from "react";
import type { AppUpdateState } from "../../electron/services/updater";
import { trpc } from "../services/trpc";

const FALLBACK_STATE: AppUpdateState = {
  status: "idle",
  currentVersion: import.meta.env.VITE_APP_VERSION,
  latestVersion: null,
  checkedAtIso: null,
  releasePageUrl: "",
  downloadUrl: null,
  releaseNotes: null,
  publishedAtIso: null,
  canAutoUpdate: false,
  errorMessage: null,
};

function isStale(checkedAtIso: string | null): boolean {
  if (!checkedAtIso) return true;
  const checkedAtMs = Date.parse(checkedAtIso);
  if (!Number.isFinite(checkedAtMs)) return true;
  return Date.now() - checkedAtMs >= 15 * 60 * 1000;
}

export function useAppUpdate() {
  const [state, setState] = useState<AppUpdateState>(FALLBACK_STATE);
  const [isActing, setIsActing] = useState(false);

  useEffect(() => {
    let mounted = true;

    const load = async () => {
      try {
        const initial = await trpc.updater.getState.query();
        if (!mounted) return;
        setState(initial);

        if (initial.status === "idle" || isStale(initial.checkedAtIso)) {
          const fresh = await trpc.updater.ensureFresh.mutate();
          if (mounted) {
            setState(fresh);
          }
        }
      } catch (error) {
        console.error("Failed to load update state", error);
      }
    };

    void load();
    const unsubscribe = window.electronAPI.updates.subscribe((nextState) => {
      if (mounted) {
        setState(nextState);
      }
    });

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  const runWithBusyState = useCallback(async (action: () => Promise<AppUpdateState>) => {
    setIsActing(true);
    try {
      const nextState = await action();
      setState(nextState);
    } catch (error) {
      console.error("Update action failed", error);
    } finally {
      setIsActing(false);
    }
  }, []);

  const actionLabel = useMemo(() => {
    if (isActing || state.status === "checking") {
      return "Checking...";
    }
    if (state.status === "update_available") {
      return state.downloadUrl ? "Download Latest Version" : "Open Latest Release";
    }
    if (state.status === "up_to_date") {
      return "Up to Date";
    }
    if (state.status === "error") {
      if ((state.errorMessage ?? "").toLowerCase().includes("not configured")) {
        return "Update config error";
      }
      return "Retry Check";
    }
    return "Check for Updates";
  }, [isActing, state.downloadUrl, state.status]);

  const systemMessage = useMemo(() => {
    if (state.status === "checking") {
      return "Checking GitHub Releases for a newer build.";
    }
    if (state.status === "update_available") {
      const targetLabel = state.downloadUrl?.toLowerCase().endsWith(".appimage")
        ? "AppImage download ready."
        : "Newer version available.";
      return state.latestVersion ? `${targetLabel} Latest: v${state.latestVersion}.` : targetLabel;
    }
    if (state.status === "up_to_date") {
      return "Installed build is current.";
    }
    if (state.status === "error") {
      return state.errorMessage ?? "Update check failed.";
    }
    return "No update check has run yet.";
  }, [state.downloadUrl, state.errorMessage, state.latestVersion, state.status]);

  const menuBadge = state.status === "update_available" && state.latestVersion
    ? `v${state.latestVersion}`
    : state.status === "error"
      ? "Retry"
      : undefined;

  const menuTone = state.status === "update_available"
    ? "warning"
    : state.status === "error"
      ? "danger"
      : state.status === "up_to_date"
        ? "success"
        : "default";

  const triggerPrimaryAction = useCallback(async () => {
    if (isActing) return;

    if (state.status === "update_available") {
      await runWithBusyState(() => trpc.updater.openLatestDownload.mutate());
      return;
    }

    await runWithBusyState(() => trpc.updater.check.mutate({ force: true }));
  }, [isActing, runWithBusyState, state.status]);

  return {
    state,
    isBusy: isActing || state.status === "checking",
    actionLabel,
    menuBadge,
    menuTone,
    systemMessage,
    triggerPrimaryAction,
  };
}
