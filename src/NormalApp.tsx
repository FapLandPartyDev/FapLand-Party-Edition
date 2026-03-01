import { StrictMode, useEffect, useMemo } from "react";
import { RouterProvider } from "@tanstack/react-router";
import { InstallSidecarTrustModalHost } from "./components/InstallSidecarTrustModalHost";
import { InstallConfirmationModalHost } from "./components/InstallConfirmationModalHost";
import { GlobalDragOverlay } from "./components/GlobalDragOverlay";
import { showGlobalToast, ToastProvider } from "./components/ui/ToastHost";
import { GameplayMoaningProvider } from "./contexts/GameplayMoaningContext";
import { I18nProvider } from "./i18n";
import { getRouter } from "./router";
import { refreshStartupBooruMediaCache } from "./services/booru";
import { handleMultiplayerAuthCallback } from "./services/multiplayer";
import { registerGlobalOpenedFileDropHandler } from "./services/openedFileDrop";
import { getOpenedFileKind, importOpenedFile } from "./services/openedFiles";
import { trpc } from "./services/trpc";
import { initializeSfxVolume } from "./utils/audio";
import {
  DEFAULT_STARTUP_SAFE_MODE_SHORTCUT_ENABLED,
  normalizeStartupSafeModeShortcutEnabled,
  SFW_MODE_ENABLED_EVENT,
  SFW_MODE_ENABLED_KEY,
  STARTUP_SAFE_MODE_SHORTCUT_ENABLED_KEY,
} from "./constants/experimentalFeatures";

function readStartupFlag(value: string | undefined): boolean {
  if (value === undefined) return false;
  return value === "1" || value.toLowerCase() === "true";
}

function enableStartupSafeMode() {
  window.localStorage.setItem(SFW_MODE_ENABLED_KEY, "true");
  window.dispatchEvent(new CustomEvent(SFW_MODE_ENABLED_EVENT, { detail: true }));
  void trpc.store.set.mutate({ key: SFW_MODE_ENABLED_KEY, value: true }).catch(() => {});
}

function handleGpuRecoveryHint() {
  if (!window.electronAPI?.gpuRecovery) return undefined;

  const onRecoveryHint = (pending: boolean) => {
    if (pending) {
      showGlobalToast(
        "Graphics instability detected. Try Graphics Safe Mode from Settings.",
        "info"
      );
    }
  };

  void window.electronAPI.gpuRecovery
    .consumeRecoveryHint()
    .then(onRecoveryHint)
    .catch(() => {});

  return window.electronAPI.gpuRecovery.subscribe(onRecoveryHint);
}

function registerOpenedFileHandler(router: ReturnType<typeof getRouter>) {
  if (typeof window === "undefined" || !window.electronAPI?.appOpen) {
    return undefined;
  }

  const navigateForOpenedFile = async (filePath: string) => {
    const kind = getOpenedFileKind(filePath);
    if (kind === "sidecar" || kind === "video" || kind === "folder") {
      await router.navigate({ to: "/rounds" });
    } else if (kind === "playlist") {
      await router.navigate({ to: "/playlist-workshop" });
    }
    return kind;
  };

  let queue = Promise.resolve();
  const enqueue = (filePaths: string[]) => {
    queue = queue.then(async () => {
      for (const filePath of filePaths) {
        try {
          await navigateForOpenedFile(filePath);
          const result = await importOpenedFile(filePath);
          if (
            result.kind === "sidecar" ||
            result.kind === "playlist" ||
            result.kind === "video" ||
            result.kind === "folder"
          ) {
            showGlobalToast(result.feedback.message, result.feedback.variant);
            await router.invalidate();
          }
        } catch (error) {
          console.error(`Failed to handle opened file: ${filePath}`, error);
          showGlobalToast(
            error instanceof Error ? error.message : `Failed to handle opened file: ${filePath}`,
            "error"
          );
        }
      }
    });
  };

  const unsubscribe = window.electronAPI.appOpen.subscribe((filePaths) => {
    enqueue(filePaths);
  });

  void window.electronAPI.appOpen
    .consumePendingFiles()
    .then(enqueue)
    .catch((error) => {
      console.error("Failed to consume pending opened files", error);
    });

  return unsubscribe;
}

function registerMultiplayerAuthCallbackHandler() {
  if (typeof window === "undefined" || !window.electronAPI?.auth) {
    return undefined;
  }

  const handleUrl = (url: string | null) => {
    if (!url) return;
    void handleMultiplayerAuthCallback(url).catch((error) => {
      console.error("Failed to process multiplayer auth callback", error);
    });
  };

  void window.electronAPI.auth
    .consumePendingCallback()
    .then(handleUrl)
    .catch((error) => {
      console.error("Failed to consume pending multiplayer auth callback", error);
    });

  return window.electronAPI.auth.subscribe((url) => {
    handleUrl(url);
  });
}

function registerSafeModeStartupShortcut() {
  if (typeof window === "undefined") return undefined;

  if (readStartupFlag(import.meta.env.FLAND_STARTUP_SAFE_MODE)) {
    enableStartupSafeMode();
    return undefined;
  }

  const rawShortcutEnabled = window.localStorage.getItem(STARTUP_SAFE_MODE_SHORTCUT_ENABLED_KEY);
  const shortcutEnabled =
    rawShortcutEnabled !== null
      ? normalizeStartupSafeModeShortcutEnabled(rawShortcutEnabled === "true")
      : DEFAULT_STARTUP_SAFE_MODE_SHORTCUT_ENABLED;

  if (!shortcutEnabled) return undefined;

  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.key.toLowerCase() === "s") {
      enableStartupSafeMode();
    }
  };

  window.addEventListener("keydown", handleKeyDown);
  const timeoutId = window.setTimeout(() => {
    window.removeEventListener("keydown", handleKeyDown);
  }, 5000);

  return () => {
    window.clearTimeout(timeoutId);
    window.removeEventListener("keydown", handleKeyDown);
  };
}

export function NormalApp() {
  const router = useMemo(() => getRouter(), []);

  useEffect(() => {
    void refreshStartupBooruMediaCache();
    void initializeSfxVolume();

    const cleanupGpuRecoveryHint = handleGpuRecoveryHint();
    const cleanupOpenedFileHandler = registerOpenedFileHandler(router);
    const cleanupDragHandler = registerGlobalOpenedFileDropHandler({ showToast: showGlobalToast });
    const cleanupAuthHandler = registerMultiplayerAuthCallbackHandler();
    const cleanupSafeModeShortcut = registerSafeModeStartupShortcut();

    return () => {
      cleanupGpuRecoveryHint?.();
      cleanupOpenedFileHandler?.();
      cleanupDragHandler?.();
      cleanupAuthHandler?.();
      cleanupSafeModeShortcut?.();
    };
  }, [router]);

  return (
    <StrictMode>
      <I18nProvider>
        <ToastProvider>
          <GameplayMoaningProvider>
            <GlobalDragOverlay />
            <InstallConfirmationModalHost />
            <InstallSidecarTrustModalHost />
            <RouterProvider router={router} />
          </GameplayMoaningProvider>
        </ToastProvider>
      </I18nProvider>
    </StrictMode>
  );
}
