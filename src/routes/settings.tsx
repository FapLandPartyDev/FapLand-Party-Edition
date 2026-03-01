import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { AnimatedBackground } from "../components/AnimatedBackground";
import { MenuButton } from "../components/MenuButton";
import { ensureBooruMediaCache } from "../services/booru";
import { db } from "../services/db";
import { integrations, type ExternalSource, type IntegrationSyncStatus, type StashTagResult } from "../services/integrations";
import { trpc } from "../services/trpc";
import { playHoverSound, playSelectSound } from "../utils/audio";
import {
  normalizeVideoHashFfmpegSourcePreference,
  VIDEOHASH_FFMPEG_SOURCE_PREFERENCE_KEY,
  type VideoHashFfmpegSourcePreference,
} from "../constants/videohashSettings";
import {
  BACKGROUND_VIDEO_ENABLED_EVENT,
  BACKGROUND_VIDEO_ENABLED_KEY,
  DEFAULT_BACKGROUND_VIDEO_ENABLED,
} from "../constants/backgroundSettings";

const INTERMEDIARY_LOADING_PROMPT_KEY = "game.intermediary.loadingPrompt";
const INTERMEDIARY_LOADING_DURATION_KEY = "game.intermediary.loadingDurationSec";
const INTERMEDIARY_RETURN_PAUSE_KEY = "game.intermediary.returnPauseSec";
const DEFAULT_INTERMEDIARY_LOADING_PROMPT = "animated gif webm";
const DEFAULT_INTERMEDIARY_LOADING_DURATION_SEC = 10;
const DEFAULT_INTERMEDIARY_RETURN_PAUSE_SEC = 4;

type ToggleSetting = {
  id: string;
  type: "toggle";
  label: string;
  description: string;
  value: boolean;
  onChange: (next: boolean) => Promise<void>;
};

type TextSetting = {
  id: string;
  type: "text";
  label: string;
  description: string;
  value: string;
  placeholder?: string;
  onChange: (next: string) => Promise<void>;
};

type NumberSetting = {
  id: string;
  type: "number";
  label: string;
  description: string;
  value: number;
  min: number;
  max: number;
  onChange: (next: number) => Promise<void>;
};

type SelectSetting = {
  id: string;
  type: "select";
  label: string;
  description: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (next: string) => Promise<void>;
};

type SettingDefinition = ToggleSetting | TextSetting | NumberSetting | SelectSetting;

type SettingsSection = {
  id: string;
  title: string;
  description: string;
  settings: SettingDefinition[];
};

export const Route = createFileRoute("/settings")({
  component: SettingsPage,
});

function SettingsPage() {
  const navigate = useNavigate();
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isLoadingFullscreen, setIsLoadingFullscreen] = useState(true);
  const [intermediaryLoadingPrompt, setIntermediaryLoadingPrompt] = useState(DEFAULT_INTERMEDIARY_LOADING_PROMPT);
  const [intermediaryLoadingDurationSec, setIntermediaryLoadingDurationSec] = useState(DEFAULT_INTERMEDIARY_LOADING_DURATION_SEC);
  const [intermediaryReturnPauseSec, setIntermediaryReturnPauseSec] = useState(DEFAULT_INTERMEDIARY_RETURN_PAUSE_SEC);
  const [videoHashFfmpegSourcePreference, setVideoHashFfmpegSourcePreference] = useState<VideoHashFfmpegSourcePreference>("auto");
  const [backgroundVideoEnabled, setBackgroundVideoEnabled] = useState(DEFAULT_BACKGROUND_VIDEO_ENABLED);
  const [isLoadingPrompt, setIsLoadingPrompt] = useState(true);
  const [isLoadingVideoHashPreference, setIsLoadingVideoHashPreference] = useState(true);
  const [isLoadingBackgroundVideoEnabled, setIsLoadingBackgroundVideoEnabled] = useState(true);
  const [autoScanFolders, setAutoScanFolders] = useState<string[]>([]);
  const [isLoadingAutoScanFolders, setIsLoadingAutoScanFolders] = useState(true);
  const [isUpdatingAutoScanFolders, setIsUpdatingAutoScanFolders] = useState(false);
  const [isClearDataDialogOpen, setIsClearDataDialogOpen] = useState(false);
  const [isClearingData, setIsClearingData] = useState(false);
  const [clearDataError, setClearDataError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    const loadSettings = async () => {
      try {
        const [fullscreen, rawPrompt, rawDuration, rawReturnPause, rawVideoHashPreference, rawBackgroundVideoEnabled, folders] = await Promise.all([
          window.electronAPI.window.isFullscreen(),
          trpc.store.get.query({ key: INTERMEDIARY_LOADING_PROMPT_KEY }),
          trpc.store.get.query({ key: INTERMEDIARY_LOADING_DURATION_KEY }),
          trpc.store.get.query({ key: INTERMEDIARY_RETURN_PAUSE_KEY }),
          trpc.store.get.query({ key: VIDEOHASH_FFMPEG_SOURCE_PREFERENCE_KEY }),
          trpc.store.get.query({ key: BACKGROUND_VIDEO_ENABLED_KEY }),
          db.install.getAutoScanFolders(),
        ]);

        if (mounted) setIsFullscreen(fullscreen);
        if (mounted) {
          const nextPrompt =
            typeof rawPrompt === "string" && rawPrompt.trim().length > 0
              ? rawPrompt.trim()
              : DEFAULT_INTERMEDIARY_LOADING_PROMPT;
          setIntermediaryLoadingPrompt(nextPrompt);
          const parsedDuration = typeof rawDuration === "number" ? rawDuration : Number(rawDuration);
          const nextDuration =
            Number.isFinite(parsedDuration) ? Math.max(1, Math.min(60, Math.floor(parsedDuration))) : DEFAULT_INTERMEDIARY_LOADING_DURATION_SEC;
          setIntermediaryLoadingDurationSec(nextDuration);
          const parsedReturnPause = typeof rawReturnPause === "number" ? rawReturnPause : Number(rawReturnPause);
          const nextReturnPause =
            Number.isFinite(parsedReturnPause) ? Math.max(0, Math.min(60, Math.floor(parsedReturnPause))) : DEFAULT_INTERMEDIARY_RETURN_PAUSE_SEC;
          setIntermediaryReturnPauseSec(nextReturnPause);
          setVideoHashFfmpegSourcePreference(normalizeVideoHashFfmpegSourcePreference(rawVideoHashPreference));
          setBackgroundVideoEnabled(
            typeof rawBackgroundVideoEnabled === "boolean" ? rawBackgroundVideoEnabled : DEFAULT_BACKGROUND_VIDEO_ENABLED,
          );
          setAutoScanFolders(folders);
        }
      } catch (error) {
        console.error("Failed to read settings state", error);
      } finally {
        if (mounted) {
          setIsLoadingFullscreen(false);
          setIsLoadingPrompt(false);
          setIsLoadingVideoHashPreference(false);
          setIsLoadingBackgroundVideoEnabled(false);
          setIsLoadingAutoScanFolders(false);
        }
      }
    };

    void loadSettings();

    return () => {
      mounted = false;
    };
  }, []);

  const sections: SettingsSection[] = useMemo(
    () => [
      {
        id: "display",
        title: "Display",
        description: "Window and rendering preferences.",
        settings: [
          {
            id: "fullscreen",
            type: "toggle",
            label: "Fullscreen",
            description: "Enable or disable fullscreen mode for the game window.",
            value: isFullscreen,
            onChange: async (next: boolean) => {
              const applied = await window.electronAPI.window.setFullscreen(next);
              setIsFullscreen(applied);
            },
          },
          {
            id: "background-video-enabled",
            type: "toggle",
            label: "Load Background Videos",
            description: "When disabled, animated backgrounds keep the visual effects but skip loading video files.",
            value: backgroundVideoEnabled,
            onChange: async (next: boolean) => {
              await trpc.store.set.mutate({ key: BACKGROUND_VIDEO_ENABLED_KEY, value: next });
              setBackgroundVideoEnabled(next);
              window.dispatchEvent(new CustomEvent<boolean>(BACKGROUND_VIDEO_ENABLED_EVENT, { detail: next }));
            },
          },
          {
            id: "videohash-ffmpeg-source",
            type: "select",
            label: "VideoHash FFmpeg Source",
            description: "Auto keeps current behavior (prefer newer system binaries). Use Bundled/System to force source selection.",
            value: videoHashFfmpegSourcePreference,
            options: [
              { value: "auto", label: "Auto (Default)" },
              { value: "bundled", label: "Bundled Only" },
              { value: "system", label: "System Only" },
            ],
            onChange: async (next: string) => {
              const value = normalizeVideoHashFfmpegSourcePreference(next);
              await trpc.store.set.mutate({ key: VIDEOHASH_FFMPEG_SOURCE_PREFERENCE_KEY, value });
              setVideoHashFfmpegSourcePreference(value);
            },
          },
        ],
      },
      {
        id: "gameplay",
        title: "Gameplay",
        description: "Intermediary loading and game session behavior.",
        settings: [
          {
            id: "intermediary-loading-prompt",
            type: "text",
            label: "Intermediary Loading Prompt",
            description: "Search prompt used for loading-screen media from rule34/booru sites.",
            value: intermediaryLoadingPrompt,
            placeholder: "animated gif webm",
            onChange: async (next: string) => {
              const trimmed = next.trim();
              const value = trimmed.length > 0 ? trimmed : DEFAULT_INTERMEDIARY_LOADING_PROMPT;
              await trpc.store.set.mutate({ key: INTERMEDIARY_LOADING_PROMPT_KEY, value });
              setIntermediaryLoadingPrompt(value);
              void ensureBooruMediaCache(value, 18);
            },
          },
          {
            id: "intermediary-loading-duration",
            type: "number",
            label: "Intermediary Loading Duration (s)",
            description: "How long the intermediary loading countdown runs before switching videos.",
            value: intermediaryLoadingDurationSec,
            min: 1,
            max: 60,
            onChange: async (next: number) => {
              const value = Math.max(1, Math.min(60, Math.floor(next)));
              await trpc.store.set.mutate({ key: INTERMEDIARY_LOADING_DURATION_KEY, value });
              setIntermediaryLoadingDurationSec(value);
            },
          },
          {
            id: "intermediary-return-pause",
            type: "number",
            label: "Return Pause After Intermediary (s)",
            description: "Pause duration after intermediary ends before resuming the main round.",
            value: intermediaryReturnPauseSec,
            min: 0,
            max: 60,
            onChange: async (next: number) => {
              const value = Math.max(0, Math.min(60, Math.floor(next)));
              await trpc.store.set.mutate({ key: INTERMEDIARY_RETURN_PAUSE_KEY, value });
              setIntermediaryReturnPauseSec(value);
            },
          },
        ],
      },
      {
        id: "sources",
        title: "Sources",
        description: "External source integrations and sync controls.",
        settings: [],
      },
      {
        id: "app",
        title: "App",
        description: "Application-wide maintenance and destructive actions.",
        settings: [],
      },
      {
        id: "credits",
        title: "Credits",
        description: "Special thanks & inspiration.",
        settings: [],
      },
    ],
    [
      backgroundVideoEnabled,
      intermediaryLoadingDurationSec,
      intermediaryLoadingPrompt,
      intermediaryReturnPauseSec,
      isFullscreen,
      videoHashFfmpegSourcePreference,
    ]
  );
  const [activeSectionId, setActiveSectionId] = useState<string>(sections[0]?.id ?? "display");

  useEffect(() => {
    if (!sections.some((section) => section.id === activeSectionId)) {
      setActiveSectionId(sections[0]?.id ?? "display");
    }
  }, [sections, activeSectionId]);

  const activeSection = sections.find((section) => section.id === activeSectionId) ?? sections[0];

  const addFolders = async () => {
    if (isUpdatingAutoScanFolders) return;
    setIsUpdatingAutoScanFolders(true);
    try {
      const selected = await window.electronAPI.dialog.selectFolders();
      if (selected.length === 0) return;

      let latest = autoScanFolders;
      for (const folderPath of selected) {
        latest = await db.install.addAutoScanFolder(folderPath);
      }
      setAutoScanFolders(latest);
    } catch (error) {
      console.error("Failed to add auto-scan folders", error);
    } finally {
      setIsUpdatingAutoScanFolders(false);
    }
  };

  const removeFolder = async (folderPath: string) => {
    if (isUpdatingAutoScanFolders) return;
    setIsUpdatingAutoScanFolders(true);
    try {
      const next = await db.install.removeAutoScanFolder(folderPath);
      setAutoScanFolders(next);
    } catch (error) {
      console.error("Failed to remove auto-scan folder", error);
    } finally {
      setIsUpdatingAutoScanFolders(false);
    }
  };

  const clearAllData = async () => {
    if (isClearingData) return;

    setIsClearingData(true);
    setClearDataError(null);
    try {
      await db.install.clearAllData();
      window.localStorage.clear();
      window.sessionStorage.clear();
      window.location.reload();
    } catch (error) {
      console.error("Failed to clear all data", error);
      setClearDataError(error instanceof Error ? error.message : "Failed to clear all data.");
      setIsClearingData(false);
    }
  };

  return (
    <div className="relative min-h-screen overflow-hidden">
      <AnimatedBackground />

      <div className="relative z-10 h-screen overflow-y-auto px-4 py-8 sm:px-8">
        <main className="parallax-ui-none mx-auto flex w-full max-w-5xl flex-col gap-6">
          <header className="animate-entrance rounded-3xl border border-purple-400/35 bg-zinc-950/60 p-6 backdrop-blur-xl shadow-[0_0_50px_rgba(139,92,246,0.28)]">
            <p className="font-[family-name:var(--font-jetbrains-mono)] text-xs uppercase tracking-[0.45em] text-purple-200/85">
              System Config
            </p>
            <div className="mt-3 flex flex-wrap items-end justify-between gap-4">
              <h1 className="text-3xl font-black tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-violet-200 via-purple-100 to-indigo-200 drop-shadow-[0_0_30px_rgba(139,92,246,0.55)] sm:text-5xl">
                Settings
              </h1>
            </div>
          </header>

          <section className="animate-entrance rounded-3xl border border-purple-400/25 bg-zinc-950/55 p-3 backdrop-blur-xl sm:p-4">
            <div className="flex flex-wrap gap-2">
              {sections.map((section) => {
                const active = section.id === activeSectionId;
                return (
                  <button
                    key={section.id}
                    type="button"
                    onMouseEnter={playHoverSound}
                    onFocus={playHoverSound}
                    onClick={() => {
                      playSelectSound();
                      setActiveSectionId(section.id);
                    }}
                    className={`rounded-xl border px-4 py-2 font-[family-name:var(--font-jetbrains-mono)] text-xs uppercase tracking-[0.2em] transition-all duration-200 ${active ? "border-violet-200/60 bg-violet-500/25 text-violet-100 shadow-[0_0_20px_rgba(139,92,246,0.4)]" : "border-zinc-700 bg-zinc-900/70 text-zinc-400 hover:border-violet-300/45 hover:text-zinc-200"}`}
                  >
                    {section.title}
                  </button>
                );
              })}
            </div>
          </section>

          {activeSection && activeSection.id === "sources" ? (
            <>
              <SourceIntegrationsCard />
              <AutoScanFoldersCard
                folders={autoScanFolders}
                isLoading={isLoadingAutoScanFolders}
                isPending={isUpdatingAutoScanFolders}
                onAddFolders={() => {
                  playSelectSound();
                  void addFolders();
                }}
                onRemoveFolder={(folderPath) => {
                  playSelectSound();
                  void removeFolder(folderPath);
                }}
              />
            </>
          ) : activeSection && activeSection.id === "app" ? (
            <>
              <SettingsSectionCard section={activeSection} loading={false} />
              <DangerZoneCard
                error={clearDataError}
                isPending={isClearingData}
                onOpenConfirm={() => {
                  playSelectSound();
                  setClearDataError(null);
                  setIsClearDataDialogOpen(true);
                }}
              />
            </>
          ) : activeSection && activeSection.id === "credits" ? (
            <CreditsCard />
          ) : activeSection ? (
            <SettingsSectionCard
              section={activeSection}
              loading={isLoadingFullscreen || isLoadingPrompt || isLoadingVideoHashPreference || isLoadingBackgroundVideoEnabled}
            />
          ) : null}

          <div className="mx-auto grid w-full max-w-md grid-cols-1 gap-2 pb-6">
            <MenuButton
              label="Back to Main Menu"
              onHover={playHoverSound}
              onClick={() => {
                playSelectSound();
                navigate({ to: "/" });
              }}
            />
          </div>
        </main>
      </div>

      <ConfirmDestructiveDialog
        confirmLabel={isClearingData ? "Clearing..." : "Clear All Data"}
        description="This deletes saved playlists, installed rounds/resources, scores, history, cached matches, source integrations, and stored settings."
        isOpen={isClearDataDialogOpen}
        isPending={isClearingData}
        title="Clear all app data?"
        warning="This cannot be undone."
        onCancel={() => {
          if (isClearingData) return;
          playSelectSound();
          setIsClearDataDialogOpen(false);
        }}
        onConfirm={() => {
          playSelectSound();
          void clearAllData();
        }}
      />
    </div>
  );
}

function DangerZoneCard({
  error,
  isPending,
  onOpenConfirm,
}: {
  error: string | null;
  isPending: boolean;
  onOpenConfirm: () => void;
}) {
  return (
    <section
      className="animate-entrance rounded-3xl border border-rose-400/30 bg-rose-950/20 p-5 backdrop-blur-xl"
      style={{ animationDelay: "0.12s" }}
    >
      <div className="mb-4">
        <h2 className="text-lg font-extrabold tracking-tight text-rose-100">Danger Zone</h2>
        <p className="mt-1 text-sm text-rose-100/80">
          Permanently remove all saved data from this app installation.
        </p>
      </div>

      {error ? (
        <div className="mb-4 rounded-xl border border-rose-300/35 bg-black/35 p-3 text-sm text-rose-100">
          {error}
        </div>
      ) : null}

      <button
        type="button"
        disabled={isPending}
        onMouseEnter={playHoverSound}
        onClick={onOpenConfirm}
        className={`rounded-xl border px-4 py-2 text-sm font-semibold transition-all duration-200 ${isPending
          ? "cursor-not-allowed border-zinc-600 bg-zinc-800 text-zinc-500"
          : "border-rose-300/70 bg-rose-500/25 text-rose-100 hover:border-rose-200/90 hover:bg-rose-500/40"
          }`}
      >
        {isPending ? "Clearing..." : "Clear All Data"}
      </button>
    </section>
  );
}

function ConfirmDestructiveDialog({
  confirmLabel,
  description,
  isOpen,
  isPending,
  title,
  warning,
  onCancel,
  onConfirm,
}: {
  confirmLabel: string;
  description: string;
  isOpen: boolean;
  isPending: boolean;
  title: string;
  warning: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/70 px-4 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-3xl border border-rose-300/35 bg-zinc-950/95 p-6 shadow-[0_0_60px_rgba(244,63,94,0.28)]">
        <p className="font-[family-name:var(--font-jetbrains-mono)] text-xs uppercase tracking-[0.35em] text-rose-200/80">
          Warning
        </p>
        <h2 className="mt-3 text-2xl font-black tracking-tight text-rose-50">{title}</h2>
        <p className="mt-3 text-sm text-zinc-300">{description}</p>
        <p className="mt-2 text-sm font-semibold text-rose-200">{warning}</p>

        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            disabled={isPending}
            onMouseEnter={playHoverSound}
            onClick={onCancel}
            className={`rounded-xl border px-4 py-2 text-sm font-semibold transition-all duration-200 ${isPending
              ? "cursor-not-allowed border-zinc-700 bg-zinc-900 text-zinc-500"
              : "border-zinc-600 bg-zinc-900/80 text-zinc-200 hover:border-zinc-400 hover:text-zinc-100"
              }`}
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={isPending}
            onMouseEnter={playHoverSound}
            onClick={onConfirm}
            className={`rounded-xl border px-4 py-2 text-sm font-semibold transition-all duration-200 ${isPending
              ? "cursor-not-allowed border-zinc-600 bg-zinc-800 text-zinc-500"
              : "border-rose-300/70 bg-rose-500/25 text-rose-100 hover:border-rose-200/90 hover:bg-rose-500/40"
              }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

function AutoScanFoldersCard({
  folders,
  isLoading,
  isPending,
  onAddFolders,
  onRemoveFolder,
}: {
  folders: string[];
  isLoading: boolean;
  isPending: boolean;
  onAddFolders: () => void;
  onRemoveFolder: (folderPath: string) => void;
}) {
  return (
    <section
      className="animate-entrance rounded-3xl border border-purple-400/25 bg-zinc-950/55 p-5 backdrop-blur-xl"
      style={{ animationDelay: "0.11s" }}
    >
      <div className="mb-4">
        <h2 className="text-lg font-extrabold tracking-tight text-violet-100">Library</h2>
        <p className="mt-1 text-sm text-zinc-300">
          Folders that are automatically scanned for new .round and .hero sidecars on startup.
        </p>
      </div>

      <div className="space-y-2">
        {isLoading ? (
          <div className="rounded-xl border border-zinc-700 bg-black/30 px-3 py-2 text-sm text-zinc-400">
            Loading folders...
          </div>
        ) : folders.length === 0 ? (
          <div className="rounded-xl border border-zinc-700 bg-black/30 px-3 py-2 text-sm text-zinc-400">
            No auto-scan folders configured.
          </div>
        ) : (
          folders.map((folderPath) => (
            <div
              key={folderPath}
              className="flex items-center justify-between gap-3 rounded-xl border border-violet-300/25 bg-black/35 px-3 py-2"
            >
              <div className="min-w-0 text-xs text-zinc-200 truncate">{folderPath}</div>
              <button
                type="button"
                disabled={isPending}
                onClick={() => onRemoveFolder(folderPath)}
                className={`rounded-lg border px-3 py-1 text-xs font-semibold uppercase tracking-[0.12em] ${isPending
                  ? "cursor-not-allowed border-zinc-600 bg-zinc-800 text-zinc-500"
                  : "border-rose-300/60 bg-rose-500/20 text-rose-100 hover:bg-rose-500/35"
                  }`}
              >
                Remove
              </button>
            </div>
          ))
        )}
      </div>

      <button
        type="button"
        onMouseEnter={playHoverSound}
        disabled={isPending}
        onClick={onAddFolders}
        className={`mt-4 rounded-xl border px-4 py-2 text-sm font-semibold transition-all duration-200 ${isPending
          ? "cursor-not-allowed border-zinc-600 bg-zinc-800 text-zinc-500"
          : "border-violet-300/60 bg-violet-500/30 text-violet-100 hover:border-violet-200/80 hover:bg-violet-500/45"
          }`}
      >
        {isPending ? "Updating..." : "Add Folder"}
      </button>
    </section>
  );
}

type SourceDraft = {
  name: string;
  baseUrl: string;
  authMode: "apiKey" | "login";
  apiKey: string;
  username: string;
  password: string;
  enabled: boolean;
  tagSelections: Array<{ id: string; name: string; roundTypeFallback: "Normal" | "Interjection" | "Cum" }>;
};

function toSourceDraft(source: ExternalSource): SourceDraft {
  return {
    name: source.name,
    baseUrl: source.baseUrl,
    authMode: source.authMode,
    apiKey: source.apiKey ?? "",
    username: source.username ?? "",
    password: source.password ?? "",
    enabled: source.enabled,
    tagSelections: source.tagSelections.map((entry) => ({
      id: entry.id,
      name: entry.name,
      roundTypeFallback: entry.roundTypeFallback,
    })),
  };
}

function SourceIntegrationsCard() {
  const [sources, setSources] = useState<ExternalSource[]>([]);
  const [drafts, setDrafts] = useState<Record<string, SourceDraft>>({});
  const [syncStatus, setSyncStatus] = useState<IntegrationSyncStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [pendingSourceId, setPendingSourceId] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [tagSearchQueryBySource, setTagSearchQueryBySource] = useState<Record<string, string>>({});
  const [tagSearchResultsBySource, setTagSearchResultsBySource] = useState<Record<string, StashTagResult["tags"]>>({});
  const [tagSearchPendingBySource, setTagSearchPendingBySource] = useState<Record<string, boolean>>({});
  const [newSourceDraft, setNewSourceDraft] = useState<SourceDraft>({
    name: "",
    baseUrl: "",
    authMode: "apiKey",
    apiKey: "",
    username: "",
    password: "",
    enabled: true,
    tagSelections: [],
  });

  const refresh = async () => {
    const [nextSources, nextSyncStatus] = await Promise.all([integrations.listSources(), integrations.getSyncStatus()]);
    setSources(nextSources);
    setSyncStatus(nextSyncStatus);
    setDrafts(
      nextSources.reduce<Record<string, SourceDraft>>((acc, source) => {
        acc[source.id] = toSourceDraft(source);
        return acc;
      }, {}),
    );
  };

  useEffect(() => {
    let mounted = true;

    const load = async () => {
      try {
        await refresh();
      } catch (error) {
        if (mounted) {
          setStatusMessage(error instanceof Error ? error.message : "Failed to load sources.");
        }
      } finally {
        if (mounted) {
          setIsLoading(false);
        }
      }
    };

    void load();
    const interval = window.setInterval(() => {
      void integrations
        .getSyncStatus()
        .then((status) => {
          if (mounted) setSyncStatus(status);
        })
        .catch(() => {
          // Ignore polling errors.
        });
    }, 3000);

    return () => {
      mounted = false;
      window.clearInterval(interval);
    };
  }, []);

  const syncNow = async () => {
    if (isSyncing) return;
    setIsSyncing(true);
    setStatusMessage(null);
    try {
      const status = await integrations.syncNow();
      setSyncStatus(status);
      await refresh();
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Failed to sync sources.");
    } finally {
      setIsSyncing(false);
    }
  };

  const createSource = async () => {
    setStatusMessage(null);
    try {
      await integrations.createStashSource({
        name: newSourceDraft.name,
        baseUrl: newSourceDraft.baseUrl,
        authMode: newSourceDraft.authMode,
        apiKey: newSourceDraft.apiKey || null,
        username: newSourceDraft.username || null,
        password: newSourceDraft.password || null,
        enabled: newSourceDraft.enabled,
        tagSelections: newSourceDraft.tagSelections,
      });
      setNewSourceDraft({
        name: "",
        baseUrl: "",
        authMode: "apiKey",
        apiKey: "",
        username: "",
        password: "",
        enabled: true,
        tagSelections: [],
      });
      await refresh();
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Failed to create source.");
    }
  };

  const saveSource = async (sourceId: string) => {
    const draft = drafts[sourceId];
    if (!draft) return;

    setPendingSourceId(sourceId);
    setStatusMessage(null);
    try {
      await integrations.updateStashSource({
        sourceId,
        name: draft.name,
        baseUrl: draft.baseUrl,
        authMode: draft.authMode,
        apiKey: draft.apiKey || null,
        username: draft.username || null,
        password: draft.password || null,
        enabled: draft.enabled,
        tagSelections: draft.tagSelections,
      });
      await refresh();
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Failed to update source.");
    } finally {
      setPendingSourceId(null);
    }
  };

  const deleteSource = async (sourceId: string) => {
    setPendingSourceId(sourceId);
    setStatusMessage(null);
    try {
      await integrations.deleteSource(sourceId);
      await refresh();
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Failed to delete source.");
    } finally {
      setPendingSourceId(null);
    }
  };

  const testConnection = async (sourceId: string) => {
    setPendingSourceId(sourceId);
    setStatusMessage(null);
    try {
      await integrations.testStashConnection(sourceId);
      setStatusMessage("Stash connection succeeded.");
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Stash connection failed.");
    } finally {
      setPendingSourceId(null);
    }
  };

  const searchTags = async (sourceId: string) => {
    const query = (tagSearchQueryBySource[sourceId] ?? "").trim();
    setTagSearchPendingBySource((prev) => ({ ...prev, [sourceId]: true }));
    try {
      const result = await integrations.searchStashTags({ sourceId, query, page: 1, perPage: 24 });
      setTagSearchResultsBySource((prev) => ({ ...prev, [sourceId]: result.tags }));
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Tag search failed.");
    } finally {
      setTagSearchPendingBySource((prev) => ({ ...prev, [sourceId]: false }));
    }
  };

  const patchDraft = (sourceId: string, patch: Partial<SourceDraft>) => {
    setDrafts((prev) => {
      const existing = prev[sourceId];
      if (!existing) return prev;
      return { ...prev, [sourceId]: { ...existing, ...patch } };
    });
  };

  const addTagSelection = (sourceId: string, tag: { id: string; name: string }) => {
    const draft = drafts[sourceId];
    if (!draft) return;
    if (draft.tagSelections.some((entry) => entry.id === tag.id)) return;
    patchDraft(sourceId, {
      tagSelections: [...draft.tagSelections, { id: tag.id, name: tag.name, roundTypeFallback: "Normal" }],
    });
  };

  if (isLoading) {
    return (
      <section className="animate-entrance rounded-3xl border border-purple-400/25 bg-zinc-950/55 p-5 backdrop-blur-xl">
        <p className="text-sm text-zinc-300">Loading external sources...</p>
      </section>
    );
  }

  return (
    <section className="animate-entrance rounded-3xl border border-purple-400/25 bg-zinc-950/55 p-5 backdrop-blur-xl">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-extrabold tracking-tight text-violet-100">Sources</h2>
          <p className="mt-1 text-sm text-zinc-300">Configure Stash instances, tags, and run sync.</p>
        </div>
        <button
          type="button"
          onMouseEnter={playHoverSound}
          disabled={isSyncing}
          onClick={() => {
            playSelectSound();
            void syncNow();
          }}
          className={`rounded-xl border px-4 py-2 text-sm font-semibold transition-all duration-200 ${isSyncing
            ? "cursor-not-allowed border-zinc-600 bg-zinc-800 text-zinc-500"
            : "border-violet-300/60 bg-violet-500/30 text-violet-100 hover:border-violet-200/80 hover:bg-violet-500/45"
            }`}
        >
          {isSyncing ? "Syncing..." : "Sync Now"}
        </button>
      </div>

      {syncStatus && (
        <div className="mb-4 rounded-xl border border-violet-300/25 bg-black/35 p-3 text-xs text-zinc-300">
          <div>State: {syncStatus.state}</div>
          <div>Sources: {syncStatus.stats.sourcesSynced}/{syncStatus.stats.sourcesSeen}</div>
          <div>Scenes: {syncStatus.stats.scenesSeen}</div>
          <div>Created/Updated/Linked: {syncStatus.stats.roundsCreated}/{syncStatus.stats.roundsUpdated}/{syncStatus.stats.roundsLinked}</div>
          <div>Resources Added: {syncStatus.stats.resourcesAdded}</div>
        </div>
      )}

      {statusMessage && (
        <div className="mb-4 rounded-xl border border-zinc-600 bg-black/40 p-3 text-xs text-zinc-200">
          {statusMessage}
        </div>
      )}

      <div className="mb-6 rounded-2xl border border-violet-300/25 bg-black/35 p-4">
        <p className="mb-3 text-sm font-semibold text-zinc-100">Add Stash Source</p>
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
          <input
            className="rounded-xl border border-violet-300/30 bg-black/45 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-violet-300/75"
            placeholder="Source name"
            value={newSourceDraft.name}
            onChange={(event) => setNewSourceDraft((prev) => ({ ...prev, name: event.target.value }))}
          />
          <input
            className="rounded-xl border border-violet-300/30 bg-black/45 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-violet-300/75"
            placeholder="https://stash.example.com"
            value={newSourceDraft.baseUrl}
            onChange={(event) => setNewSourceDraft((prev) => ({ ...prev, baseUrl: event.target.value }))}
          />
          <select
            className="rounded-xl border border-violet-300/30 bg-black/45 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-violet-300/75"
            value={newSourceDraft.authMode}
            onChange={(event) => setNewSourceDraft((prev) => ({ ...prev, authMode: event.target.value as "apiKey" | "login" }))}
          >
            <option value="apiKey">API Key</option>
            <option value="login">Login</option>
          </select>
          {newSourceDraft.authMode === "apiKey" ? (
            <input
              className="rounded-xl border border-violet-300/30 bg-black/45 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-violet-300/75"
              placeholder="API key"
              value={newSourceDraft.apiKey}
              onChange={(event) => setNewSourceDraft((prev) => ({ ...prev, apiKey: event.target.value }))}
            />
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <input
                className="rounded-xl border border-violet-300/30 bg-black/45 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-violet-300/75"
                placeholder="Username"
                value={newSourceDraft.username}
                onChange={(event) => setNewSourceDraft((prev) => ({ ...prev, username: event.target.value }))}
              />
              <input
                className="rounded-xl border border-violet-300/30 bg-black/45 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-violet-300/75"
                placeholder="Password"
                type="password"
                value={newSourceDraft.password}
                onChange={(event) => setNewSourceDraft((prev) => ({ ...prev, password: event.target.value }))}
              />
            </div>
          )}
        </div>
        <button
          type="button"
          onMouseEnter={playHoverSound}
          onClick={() => {
            playSelectSound();
            void createSource();
          }}
          className="mt-3 rounded-xl border border-violet-300/60 bg-violet-500/30 px-4 py-2 text-sm font-semibold text-violet-100 hover:border-violet-200/80 hover:bg-violet-500/45"
        >
          Add Source
        </button>
      </div>

      <div className="space-y-4">
        {sources.length === 0 ? (
          <div className="rounded-xl border border-zinc-700 bg-black/30 px-3 py-2 text-sm text-zinc-400">
            No sources configured yet.
          </div>
        ) : (
          sources.map((source) => {
            const draft = drafts[source.id];
            if (!draft) return null;

            return (
              <div key={source.id} className="rounded-2xl border border-violet-300/25 bg-black/35 p-4">
                <div className="mb-3 grid grid-cols-1 gap-2 md:grid-cols-2">
                  <input
                    className="rounded-xl border border-violet-300/30 bg-black/45 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-violet-300/75"
                    value={draft.name}
                    onChange={(event) => patchDraft(source.id, { name: event.target.value })}
                  />
                  <input
                    className="rounded-xl border border-violet-300/30 bg-black/45 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-violet-300/75"
                    value={draft.baseUrl}
                    onChange={(event) => patchDraft(source.id, { baseUrl: event.target.value })}
                  />
                </div>
                <div className="mb-3 grid grid-cols-1 gap-2 md:grid-cols-2">
                  <select
                    className="rounded-xl border border-violet-300/30 bg-black/45 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-violet-300/75"
                    value={draft.authMode}
                    onChange={(event) => patchDraft(source.id, { authMode: event.target.value as "apiKey" | "login" })}
                  >
                    <option value="apiKey">API Key</option>
                    <option value="login">Login</option>
                  </select>
                  {draft.authMode === "apiKey" ? (
                    <input
                      className="rounded-xl border border-violet-300/30 bg-black/45 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-violet-300/75"
                      placeholder="API key"
                      value={draft.apiKey}
                      onChange={(event) => patchDraft(source.id, { apiKey: event.target.value })}
                    />
                  ) : (
                    <div className="grid grid-cols-2 gap-2">
                      <input
                        className="rounded-xl border border-violet-300/30 bg-black/45 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-violet-300/75"
                        placeholder="Username"
                        value={draft.username}
                        onChange={(event) => patchDraft(source.id, { username: event.target.value })}
                      />
                      <input
                        className="rounded-xl border border-violet-300/30 bg-black/45 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-violet-300/75"
                        placeholder="Password"
                        type="password"
                        value={draft.password}
                        onChange={(event) => patchDraft(source.id, { password: event.target.value })}
                      />
                    </div>
                  )}
                </div>

                <div className="mb-3">
                  <div className="mb-2 text-xs uppercase tracking-[0.2em] text-zinc-400">Tags</div>
                  <div className="mb-2 flex gap-2">
                    <input
                      className="w-full rounded-xl border border-violet-300/30 bg-black/45 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-violet-300/75"
                      placeholder="Search tags"
                      value={tagSearchQueryBySource[source.id] ?? ""}
                      onChange={(event) =>
                        setTagSearchQueryBySource((prev) => ({ ...prev, [source.id]: event.target.value }))
                      }
                    />
                    <button
                      type="button"
                      onClick={() => void searchTags(source.id)}
                      disabled={Boolean(tagSearchPendingBySource[source.id])}
                      className="rounded-xl border border-violet-300/60 bg-violet-500/25 px-3 py-2 text-xs font-semibold text-violet-100 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Search
                    </button>
                  </div>
                  <div className="max-h-28 space-y-1 overflow-y-auto">
                    {(tagSearchResultsBySource[source.id] ?? []).map((tag) => (
                      <button
                        key={tag.id}
                        type="button"
                        onClick={() => addTagSelection(source.id, tag)}
                        className="block w-full rounded-lg border border-zinc-700 bg-black/30 px-2 py-1 text-left text-xs text-zinc-200 hover:border-violet-300/60"
                      >
                        + {tag.name}
                      </button>
                    ))}
                  </div>

                  <div className="mt-3 space-y-2">
                    {draft.tagSelections.map((entry) => (
                      <div key={entry.id} className="flex items-center gap-2 rounded-lg border border-zinc-700 bg-black/30 px-2 py-2">
                        <div className="min-w-0 flex-1 truncate text-xs text-zinc-200">{entry.name}</div>
                        <select
                          className="rounded border border-zinc-600 bg-black px-2 py-1 text-xs text-zinc-100"
                          value={entry.roundTypeFallback}
                          onChange={(event) =>
                            patchDraft(source.id, {
                              tagSelections: draft.tagSelections.map((selection) =>
                                selection.id === entry.id
                                  ? { ...selection, roundTypeFallback: event.target.value as "Normal" | "Interjection" | "Cum" }
                                  : selection,
                              ),
                            })
                          }
                        >
                          <option value="Normal">Normal</option>
                          <option value="Interjection">Interjection</option>
                          <option value="Cum">Cum</option>
                        </select>
                        <button
                          type="button"
                          onClick={() =>
                            patchDraft(source.id, {
                              tagSelections: draft.tagSelections.filter((selection) => selection.id !== entry.id),
                            })
                          }
                          className="rounded border border-rose-400/60 bg-rose-500/20 px-2 py-1 text-xs text-rose-100"
                        >
                          Remove
                        </button>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={pendingSourceId === source.id}
                    onClick={() => void saveSource(source.id)}
                    className="rounded-xl border border-violet-300/60 bg-violet-500/30 px-3 py-2 text-xs font-semibold text-violet-100 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Save
                  </button>
                  <button
                    type="button"
                    disabled={pendingSourceId === source.id}
                    onClick={() => void testConnection(source.id)}
                    className="rounded-xl border border-cyan-300/60 bg-cyan-500/25 px-3 py-2 text-xs font-semibold text-cyan-100 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Test
                  </button>
                  <button
                    type="button"
                    disabled={pendingSourceId === source.id}
                    onClick={() => void integrations.setSourceEnabled(source.id, !source.enabled).then(refresh)}
                    className="rounded-xl border border-zinc-500/60 bg-zinc-700/40 px-3 py-2 text-xs font-semibold text-zinc-100 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {source.enabled ? "Disable" : "Enable"}
                  </button>
                  <button
                    type="button"
                    disabled={pendingSourceId === source.id}
                    onClick={() => void deleteSource(source.id)}
                    className="rounded-xl border border-rose-300/60 bg-rose-500/25 px-3 py-2 text-xs font-semibold text-rose-100 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Delete
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}

function SettingsSectionCard({ section, loading }: { section: SettingsSection; loading: boolean }) {
  return (
    <section
      className="animate-entrance rounded-3xl border border-purple-400/25 bg-zinc-950/55 p-5 backdrop-blur-xl"
      style={{ animationDelay: "0.08s" }}
    >
      <div className="mb-4">
        <h2 className="text-lg font-extrabold tracking-tight text-violet-100">{section.title}</h2>
        <p className="mt-1 text-sm text-zinc-300">{section.description}</p>
      </div>

      <div className="space-y-3">
        {section.settings.map((setting) => (
          <SettingRow key={setting.id} setting={setting} disabled={loading} />
        ))}
      </div>
    </section>
  );
}

function SettingRow({ setting, disabled }: { setting: SettingDefinition; disabled: boolean }) {
  if (setting.type === "toggle") {
    return <ToggleRow setting={setting} disabled={disabled} />;
  }
  if (setting.type === "text") {
    return <TextRow setting={setting} disabled={disabled} />;
  }
  if (setting.type === "number") {
    return <NumberRow setting={setting} disabled={disabled} />;
  }
  if (setting.type === "select") {
    return <SelectRow setting={setting} disabled={disabled} />;
  }

  return null;
}

function SelectRow({ setting, disabled }: { setting: SelectSetting; disabled: boolean }) {
  const [draft, setDraft] = useState(setting.value);
  const [isPending, setIsPending] = useState(false);

  useEffect(() => {
    setDraft(setting.value);
  }, [setting.value]);

  const save = async () => {
    if (disabled || isPending) return;
    playSelectSound();
    setIsPending(true);
    try {
      await setting.onChange(draft);
    } catch (error) {
      console.error(`Failed to update setting '${setting.id}'`, error);
    } finally {
      setIsPending(false);
    }
  };

  return (
    <div className="rounded-2xl border border-violet-300/25 bg-black/35 p-4 transition-colors duration-200 hover:border-violet-300/45" onMouseEnter={playHoverSound}>
      <div className="mb-3">
        <p className="font-semibold text-zinc-100">{setting.label}</p>
        <p className="text-sm text-zinc-400">{setting.description}</p>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <select
          className="w-full rounded-xl border border-violet-300/30 bg-black/45 px-3 py-2 text-sm text-zinc-100 outline-none transition-all duration-200 focus:border-violet-300/75 focus:ring-2 focus:ring-violet-400/30"
          disabled={disabled || isPending}
          onChange={(event) => setDraft(event.target.value)}
          value={draft}
        >
          {setting.options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <button
          className={`rounded-xl border px-4 py-2 text-sm font-semibold transition-all duration-200 ${disabled || isPending ? "cursor-not-allowed border-zinc-600 bg-zinc-800 text-zinc-500" : "border-violet-300/60 bg-violet-500/30 text-violet-100 hover:border-violet-200/80 hover:bg-violet-500/45"}`}
          disabled={disabled || isPending}
          onClick={() => void save()}
          type="button"
        >
          Save
        </button>
      </div>
    </div>
  );
}

function NumberRow({ setting, disabled }: { setting: NumberSetting; disabled: boolean }) {
  const [draft, setDraft] = useState(`${setting.value}`);
  const [isPending, setIsPending] = useState(false);

  useEffect(() => {
    setDraft(`${setting.value}`);
  }, [setting.value]);

  const save = async () => {
    if (disabled || isPending) return;
    playSelectSound();
    setIsPending(true);
    try {
      const numeric = Number(draft);
      if (!Number.isFinite(numeric)) {
        setDraft(`${setting.value}`);
        return;
      }
      await setting.onChange(numeric);
    } catch (error) {
      console.error(`Failed to update setting '${setting.id}'`, error);
    } finally {
      setIsPending(false);
    }
  };

  return (
    <div className="rounded-2xl border border-violet-300/25 bg-black/35 p-4 transition-colors duration-200 hover:border-violet-300/45" onMouseEnter={playHoverSound}>
      <div className="mb-3">
        <p className="font-semibold text-zinc-100">{setting.label}</p>
        <p className="text-sm text-zinc-400">{setting.description}</p>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          className="w-full rounded-xl border border-violet-300/30 bg-black/45 px-3 py-2 text-sm text-zinc-100 outline-none transition-all duration-200 focus:border-violet-300/75 focus:ring-2 focus:ring-violet-400/30"
          disabled={disabled || isPending}
          max={setting.max}
          min={setting.min}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void save();
            }
          }}
          type="number"
          value={draft}
        />
        <button
          className={`rounded-xl border px-4 py-2 text-sm font-semibold transition-all duration-200 ${disabled || isPending ? "cursor-not-allowed border-zinc-600 bg-zinc-800 text-zinc-500" : "border-violet-300/60 bg-violet-500/30 text-violet-100 hover:border-violet-200/80 hover:bg-violet-500/45"}`}
          disabled={disabled || isPending}
          onClick={() => void save()}
          type="button"
        >
          Save
        </button>
      </div>
    </div>
  );
}

function ToggleRow({ setting, disabled }: { setting: ToggleSetting; disabled: boolean }) {
  const [isPending, setIsPending] = useState(false);

  const handleToggle = async () => {
    if (disabled || isPending) return;
    playSelectSound();
    setIsPending(true);
    try {
      await setting.onChange(!setting.value);
    } catch (error) {
      console.error(`Failed to update setting '${setting.id}'`, error);
    } finally {
      setIsPending(false);
    }
  };

  const switchedOn = setting.value;

  return (
    <div className="flex items-center justify-between gap-4 rounded-2xl border border-violet-300/25 bg-black/35 p-4 transition-colors duration-200 hover:border-violet-300/45" onMouseEnter={playHoverSound}>
      <div>
        <p className="font-semibold text-zinc-100">{setting.label}</p>
        <p className="text-sm text-zinc-400">{setting.description}</p>
      </div>

      <button
        type="button"
        aria-label={`Toggle ${setting.label}`}
        role="switch"
        aria-checked={switchedOn}
        disabled={disabled || isPending}
        onClick={() => void handleToggle()}
        className={`relative h-8 w-16 rounded-full border transition-all duration-200 ${switchedOn ? "border-violet-300/80 bg-violet-500/50 shadow-[0_0_20px_rgba(139,92,246,0.45)]" : "border-zinc-600 bg-zinc-800"} ${(disabled || isPending) ? "opacity-60 cursor-not-allowed" : "cursor-pointer"}`}
      >
        <span
          className={`absolute top-1 h-6 w-6 rounded-full bg-white shadow-md transition-all duration-200 ${switchedOn ? "left-9" : "left-1"}`}
        />
      </button>
    </div>
  );
}

function TextRow({ setting, disabled }: { setting: TextSetting; disabled: boolean }) {
  const [draft, setDraft] = useState(setting.value);
  const [isPending, setIsPending] = useState(false);

  useEffect(() => {
    setDraft(setting.value);
  }, [setting.value]);

  const save = async () => {
    if (disabled || isPending) return;
    playSelectSound();
    setIsPending(true);
    try {
      await setting.onChange(draft);
    } catch (error) {
      console.error(`Failed to update setting '${setting.id}'`, error);
    } finally {
      setIsPending(false);
    }
  };

  return (
    <div className="rounded-2xl border border-violet-300/25 bg-black/35 p-4 transition-colors duration-200 hover:border-violet-300/45" onMouseEnter={playHoverSound}>
      <div className="mb-3">
        <p className="font-semibold text-zinc-100">{setting.label}</p>
        <p className="text-sm text-zinc-400">{setting.description}</p>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          className="w-full rounded-xl border border-violet-300/30 bg-black/45 px-3 py-2 text-sm text-zinc-100 outline-none transition-all duration-200 focus:border-violet-300/75 focus:ring-2 focus:ring-violet-400/30"
          disabled={disabled || isPending}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void save();
            }
          }}
          placeholder={setting.placeholder}
          type="text"
          value={draft}
        />
        <button
          className={`rounded-xl border px-4 py-2 text-sm font-semibold transition-all duration-200 ${disabled || isPending ? "cursor-not-allowed border-zinc-600 bg-zinc-800 text-zinc-500" : "border-violet-300/60 bg-violet-500/30 text-violet-100 hover:border-violet-200/80 hover:bg-violet-500/45"}`}
          disabled={disabled || isPending}
          onClick={() => void save()}
          type="button"
        >
          Save
        </button>
      </div>
    </div>
  );
}

function CreditsCard() {
  return (
    <section className="animate-entrance rounded-3xl border border-purple-400/25 bg-zinc-950/55 p-5 backdrop-blur-xl" style={{ animationDelay: "0.12s" }}>
      <div className="mb-6">
        <h2 className="text-xl font-extrabold tracking-tight text-violet-100">Credits</h2>
        <p className="mt-1 text-sm text-zinc-300">
          Special thanks to the community and creators who inspired this project.
        </p>
      </div>

      <div className="space-y-4">
        <div
          className="rounded-2xl border border-violet-300/25 bg-black/35 p-4 transition-colors duration-200 hover:border-violet-300/45"
          onMouseEnter={playHoverSound}
        >
          <h3 className="font-semibold text-zinc-100">FapLandPartyDev</h3>
          <p className="mt-1 text-sm text-zinc-400">Creator of the game.</p>
        </div>

        <div
          className="rounded-2xl border border-violet-300/25 bg-black/35 p-4 transition-colors duration-200 hover:border-violet-300/45"
          onMouseEnter={playHoverSound}
        >
          <h3 className="font-semibold text-zinc-100">nakkub</h3>
          <p className="mt-1 text-sm text-zinc-400">Credit for the original Godot version.</p>
        </div>

        <div
          className="rounded-2xl border border-violet-300/25 bg-black/35 p-4 transition-colors duration-200 hover:border-violet-300/45"
          onMouseEnter={playHoverSound}
        >
          <h3 className="font-semibold text-zinc-100">tomper</h3>
          <p className="mt-1 text-sm text-zinc-400">
            For{" "}
            <a
              href="https://discuss.eroscripts.com/t/fapland-handy-edition/260780"
              target="_blank"
              rel="noreferrer"
              className="text-violet-300 hover:text-violet-200 underline decoration-violet-300/50 underline-offset-2"
              onMouseEnter={playHoverSound}
              onClick={playSelectSound}
            >
              TheHandy version
            </a>{" "}
            that inspired this project.
          </p>
        </div>
      </div>
    </section>
  );
}
