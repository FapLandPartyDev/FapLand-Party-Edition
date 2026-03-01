import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "@tanstack/react-router";
import "./styles.css";
import { InstallSidecarTrustModalHost } from "./components/InstallSidecarTrustModalHost";
import { InstallConfirmationModalHost } from "./components/InstallConfirmationModalHost";
import { ToastProvider } from "./components/ui/ToastHost";
import { GameplayMoaningProvider } from "./contexts/GameplayMoaningContext";

import { getRouter } from "./router";
import { refreshStartupBooruMediaCache } from "./services/booru";
import { handleMultiplayerAuthCallback } from "./services/multiplayer";
import { getOpenedFileKind, importOpenedFile } from "./services/openedFiles";
import { initializeSfxVolume } from "./utils/audio";
import {
  DEFAULT_STARTUP_SAFE_MODE_SHORTCUT_ENABLED,
  normalizeStartupSafeModeShortcutEnabled,
  SFW_MODE_ENABLED_EVENT,
  SFW_MODE_ENABLED_KEY,
  STARTUP_SAFE_MODE_SHORTCUT_ENABLED_KEY,
} from "./constants/experimentalFeatures";
import { trpc } from "./services/trpc";

const router = getRouter();
const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Root element not found");
}

void refreshStartupBooruMediaCache();
void initializeSfxVolume();

function registerOpenedFileHandler() {
  if (typeof window === "undefined" || !window.electronAPI?.appOpen) {
    return;
  }

  const navigateForOpenedFile = async (filePath: string) => {
    const kind = getOpenedFileKind(filePath);
    if (kind === "sidecar") {
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
          if (result.kind === "sidecar") {
            await router.invalidate();
          } else if (result.kind === "playlist") {
            await router.invalidate();
          }
        } catch (error) {
          console.error(`Failed to handle opened file: ${filePath}`, error);
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

registerOpenedFileHandler();

function registerMultiplayerAuthCallbackHandler() {
  if (typeof window === "undefined" || !window.electronAPI?.auth) {
    return;
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

  window.electronAPI.auth.subscribe((url) => {
    handleUrl(url);
  });
}

registerMultiplayerAuthCallbackHandler();

function registerSafeModeStartupShortcut() {
  if (typeof window === "undefined") return;

  const rawShortcutEnabled = window.localStorage.getItem(STARTUP_SAFE_MODE_SHORTCUT_ENABLED_KEY);
  const shortcutEnabled =
    rawShortcutEnabled !== null
      ? normalizeStartupSafeModeShortcutEnabled(rawShortcutEnabled === "true")
      : DEFAULT_STARTUP_SAFE_MODE_SHORTCUT_ENABLED;

  if (!shortcutEnabled) return;

  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.key.toLowerCase() === "s") {
      window.localStorage.setItem(SFW_MODE_ENABLED_KEY, "true");
      window.dispatchEvent(new CustomEvent(SFW_MODE_ENABLED_EVENT, { detail: true }));
      void trpc.store.set.mutate({ key: SFW_MODE_ENABLED_KEY, value: true }).catch(() => {});
    }
  };

  window.addEventListener("keydown", handleKeyDown);
  setTimeout(() => {
    window.removeEventListener("keydown", handleKeyDown);
  }, 5000);
}

registerSafeModeStartupShortcut();

createRoot(rootElement).render(
  <StrictMode>
    <ToastProvider>
      <GameplayMoaningProvider>
        <InstallConfirmationModalHost />
        <InstallSidecarTrustModalHost />
        <RouterProvider router={router} />
      </GameplayMoaningProvider>
    </ToastProvider>
  </StrictMode>
);
