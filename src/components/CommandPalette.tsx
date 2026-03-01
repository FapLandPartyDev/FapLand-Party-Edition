// @i18n-enforced
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Trans, useLingui } from "@lingui/react/macro";
import { openGlobalHandyOverlay } from "./globalHandyOverlayControls";
import { openGlobalMusicOverlay } from "./globalMusicOverlayControls";
import { playHoverSound, playSelectSound } from "../utils/audio";
import { useCommandPaletteGuard } from "../contexts/CommandPaletteGuardContext";
import { useHandy } from "../contexts/HandyContext";
import { i18n } from "../i18n";

let _setOpenFromOutside: ((open: boolean) => void) | null = null;

export function openGlobalCommandPalette() {
  _setOpenFromOutside?.(true);
}

type CommandItem = {
  id: string;
  label: string;
  description?: string;
  category: string;
  to?: string;
  action?: () => void | string | Promise<void | string>;
  keywords?: string[];
};

function buildNavigationCommands(): CommandItem[] {
  return [
    {
      id: "home",
      label: i18n._({ id: "command-palette.home", message: "Home" }),
      description: i18n._({ id: "command-palette.home.description", message: "Main menu" }),
      category: i18n._({ id: "command-palette.category.navigation", message: "Navigation" }),
      to: "/",
    },
    {
      id: "single-player",
      label: i18n._({ id: "command-palette.single-player", message: "Single Player" }),
      description: i18n._({
        id: "command-palette.single-player.description",
        message: "Start a single-player game",
      }),
      category: i18n._({ id: "command-palette.category.play", message: "Play" }),
      to: "/single-player-setup",
    },
    {
      id: "multiplayer",
      label: i18n._({ id: "command-palette.multiplayer", message: "Multiplayer" }),
      description: i18n._({
        id: "command-palette.multiplayer.description",
        message: "Join or host a multiplayer lobby",
      }),
      category: i18n._({ id: "command-palette.category.play", message: "Play" }),
      to: "/multiplayer",
    },
    {
      id: "rounds",
      label: i18n._({ id: "command-palette.rounds", message: "Installed Rounds" }),
      description: i18n._({
        id: "command-palette.rounds.description",
        message: "Manage your round library",
      }),
      category: i18n._({ id: "command-palette.category.workshop", message: "Workshop" }),
      to: "/rounds",
    },
    {
      id: "converter",
      label: i18n._({ id: "command-palette.converter", message: "Round Converter" }),
      description: i18n._({
        id: "command-palette.converter.description",
        message: "Convert videos to playable rounds",
      }),
      category: i18n._({ id: "command-palette.category.workshop", message: "Workshop" }),
      to: "/converter",
    },
    {
      id: "playlist-workshop",
      label: i18n._({ id: "command-palette.playlist-workshop", message: "Playlist Workshop" }),
      description: i18n._({
        id: "command-palette.playlist-workshop.description",
        message: "Create and edit playlists",
      }),
      category: i18n._({ id: "command-palette.category.workshop", message: "Workshop" }),
      to: "/playlist-workshop",
    },
    {
      id: "map-editor",
      label: i18n._({ id: "command-palette.map-editor", message: "Map Editor" }),
      description: i18n._({
        id: "command-palette.map-editor.description",
        message: "Design board layouts",
      }),
      category: i18n._({ id: "command-palette.category.workshop", message: "Workshop" }),
      to: "/map-editor",
    },
    {
      id: "highscores",
      label: i18n._({ id: "command-palette.highscores", message: "Highscores" }),
      description: i18n._({
        id: "command-palette.highscores.description",
        message: "View score history",
      }),
      category: i18n._({ id: "command-palette.category.navigation", message: "Navigation" }),
      to: "/highscores",
    },
    {
      id: "settings-general",
      label: i18n._({ id: "command-palette.settings-general", message: "Settings - General" }),
      description: i18n._({
        id: "command-palette.settings-general.description",
        message: "Fullscreen, background videos",
      }),
      category: i18n._({ id: "command-palette.category.settings", message: "Settings" }),
      to: "/settings?section=general",
    },
    {
      id: "settings-gameplay",
      label: i18n._({ id: "command-palette.settings-gameplay", message: "Settings - Gameplay" }),
      description: i18n._({
        id: "command-palette.settings-gameplay.description",
        message: "HUD, perks, cheat mode",
      }),
      category: i18n._({ id: "command-palette.category.settings", message: "Settings" }),
      to: "/settings?section=gameplay",
    },
    {
      id: "settings-audio",
      label: i18n._({ id: "command-palette.settings-audio", message: "Settings - Audio" }),
      description: i18n._({
        id: "command-palette.settings-audio.description",
        message: "Music queue, volume",
      }),
      category: i18n._({ id: "command-palette.category.settings", message: "Settings" }),
      to: "/settings?section=audio",
    },
    {
      id: "settings-hardware",
      label: i18n._({
        id: "command-palette.settings-hardware",
        message: "Settings - Hardware & Sync",
      }),
      description: i18n._({
        id: "command-palette.settings-hardware.description",
        message: "TheHandy, funscripts",
      }),
      category: i18n._({ id: "command-palette.category.settings", message: "Settings" }),
      to: "/settings?section=hardware",
      keywords: ["handy", "funscript", "device"],
    },
    {
      id: "settings-sources",
      label: i18n._({
        id: "command-palette.settings-sources",
        message: "Settings - Sources & Library",
      }),
      description: i18n._({
        id: "command-palette.settings-sources.description",
        message: "Stash, auto-scan folders",
      }),
      category: i18n._({ id: "command-palette.category.settings", message: "Settings" }),
      to: "/settings?section=sources",
      keywords: ["stash", "scan", "library"],
    },
    {
      id: "settings-security",
      label: i18n._({
        id: "command-palette.settings-security",
        message: "Settings - Security & Privacy",
      }),
      description: i18n._({
        id: "command-palette.settings-security.description",
        message: "SFW mode, safe domains",
      }),
      category: i18n._({ id: "command-palette.category.settings", message: "Settings" }),
      to: "/settings?section=security-privacy",
      keywords: ["sfw", "safe", "domains"],
    },
    {
      id: "settings-data",
      label: i18n._({ id: "command-palette.settings-data", message: "Settings - Data & Storage" }),
      description: i18n._({
        id: "command-palette.settings-data.description",
        message: "Cache, clear data",
      }),
      category: i18n._({ id: "command-palette.category.settings", message: "Settings" }),
      to: "/settings?section=app",
      keywords: ["cache", "storage", "phash"],
    },
    {
      id: "settings-advanced",
      label: i18n._({ id: "command-palette.settings-advanced", message: "Settings - Advanced" }),
      description: i18n._({
        id: "command-palette.settings-advanced.description",
        message: "FFmpeg, yt-dlp",
      }),
      category: i18n._({ id: "command-palette.category.settings", message: "Settings" }),
      to: "/settings?section=advanced",
      keywords: ["ffmpeg", "ytdlp", "binary"],
    },
    {
      id: "settings-experimental",
      label: i18n._({
        id: "command-palette.settings-experimental",
        message: "Settings - Experimental",
      }),
      description: i18n._({
        id: "command-palette.settings-experimental.description",
        message: "Controller support, web funscripts",
      }),
      category: i18n._({ id: "command-palette.category.settings", message: "Settings" }),
      to: "/settings?section=experimental",
      keywords: ["controller", "gamepad", "experimental"],
    },
    {
      id: "settings-help",
      label: i18n._({ id: "command-palette.settings-help", message: "Settings - Help" }),
      description: i18n._({
        id: "command-palette.settings-help.description",
        message: "Keyboard shortcut reference",
      }),
      category: i18n._({ id: "command-palette.category.settings", message: "Settings" }),
      to: "/settings?section=help",
      keywords: ["shortcuts", "keyboard", "hotkeys"],
    },
  ];
}

export function CommandPalette() {
  const { t } = useLingui();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [toast, setToast] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const navigate = useNavigate();
  const guard = useCommandPaletteGuard();
  const { manuallyStopped, toggleManualStop } = useHandy();

  const closePalette = useCallback(() => {
    setOpen(false);
    setQuery("");
    window.setTimeout(() => {
      const previous = previousFocusRef.current;
      if (previous?.isConnected) {
        previous.focus();
      }
    }, 0);
  }, []);

  const openPalette = useCallback(() => {
    previousFocusRef.current = document.activeElement as HTMLElement | null;
    setOpen(true);
    setQuery("");
    setSelectedIndex(0);
    setTimeout(() => inputRef.current?.focus(), 50);
  }, []);

  useEffect(() => {
    _setOpenFromOutside = (value: boolean) => {
      if (value) {
        openPalette();
      } else {
        closePalette();
      }
    };
    return () => {
      _setOpenFromOutside = null;
    };
  }, [closePalette, openPalette]);

  const commands = useMemo<CommandItem[]>(
    () => [
      ...buildNavigationCommands(),
      {
        id: "rounds-install-web",
        label: i18n._({ id: "command-palette.rounds-install-web", message: "Install From Web" }),
        description: i18n._({
          id: "command-palette.rounds-install-web.description",
          message: "Open the website round installer",
        }),
        category: i18n._({ id: "command-palette.category.workshop", message: "Workshop" }),
        action: () => navigate({ to: "/rounds", search: { open: "install-web" } }),
        keywords: ["rounds", "install", "web", "url", "website"],
      },
      {
        id: "rounds-install-folder",
        label: i18n._({ id: "command-palette.rounds-install-folder", message: "Install Rounds" }),
        description: i18n._({
          id: "command-palette.rounds-install-folder.description",
          message: "Open the folder picker for round installs",
        }),
        category: i18n._({ id: "command-palette.category.workshop", message: "Workshop" }),
        action: () => navigate({ to: "/rounds", search: { open: "install-rounds" } }),
        keywords: ["rounds", "install", "folder", "import", "scan"],
      },
      {
        id: "music-menu",
        label: i18n._({ id: "command-palette.music-menu", message: "Music Menu" }),
        description: i18n._({
          id: "command-palette.music-menu.description",
          message: "Open the global music overlay",
        }),
        category: i18n._({ id: "command-palette.category.media", message: "Media" }),
        action: openGlobalMusicOverlay,
        keywords: ["music", "player", "overlay", "queue"],
      },
      {
        id: "thehandy-menu",
        label: i18n._({ id: "command-palette.thehandy-menu", message: "TheHandy Menu" }),
        description: i18n._({
          id: "command-palette.thehandy-menu.description",
          message: "Open the global TheHandy overlay",
        }),
        category: i18n._({ id: "command-palette.category.hardware", message: "Hardware" }),
        action: openGlobalHandyOverlay,
        keywords: ["handy", "thehandy", "device", "sync", "overlay", "offset"],
      },
      {
        id: "thehandy-toggle",
        label: manuallyStopped
          ? i18n._({ id: "command-palette.thehandy-start", message: "Start TheHandy" })
          : i18n._({ id: "command-palette.thehandy-stop", message: "Stop TheHandy" }),
        description: i18n._({
          id: "command-palette.thehandy-toggle.description",
          message: "Toggle TheHandy manual stop state",
        }),
        category: i18n._({ id: "command-palette.category.hardware", message: "Hardware" }),
        action: async () => {
          const result = await toggleManualStop();
          if (result === "stopped") {
            return i18n._({ id: "command-palette.thehandy-stopped", message: "TheHandy stopped." });
          }
          if (result === "resumed") {
            return i18n._({ id: "command-palette.thehandy-resumed", message: "TheHandy resumed." });
          }
          return i18n._({
            id: "command-palette.thehandy-unavailable",
            message: "No connected TheHandy to toggle.",
          });
        },
        keywords: ["handy", "thehandy", "device", "sync", "start", "stop", "resume"],
      },
    ],
    [manuallyStopped, navigate, toggleManualStop]
  );

  const filtered = useMemo(() => {
    if (!query.trim()) return commands;
    const lower = query.toLowerCase();
    const terms = lower.split(/\s+/).filter(Boolean);
    return commands.filter((cmd) => {
      const haystack =
        `${cmd.label} ${cmd.description ?? ""} ${(cmd.keywords ?? []).join(" ")}`.toLowerCase();
      return terms.every((term) => haystack.includes(term));
    });
  }, [commands, query]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        if (guard.blocked) {
          setToast(guard.reason ?? t`You cannot use the command palette here.`);
          return;
        }
        if (open) {
          closePalette();
        } else {
          openPalette();
        }
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [closePalette, guard.blocked, guard.reason, open, openPalette, t]);

  const execute = useCallback(
    async (cmd: CommandItem) => {
      playSelectSound();
      closePalette();
      if (cmd.to) {
        void navigate({ to: cmd.to });
      }
      const message = await cmd.action?.();
      if (typeof message === "string" && message.length > 0) {
        setToast(message);
      }
    },
    [closePalette, navigate]
  );

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        event.stopPropagation();
        closePalette();
        return;
      }

      if (event.key === "ArrowDown") {
        event.preventDefault();
        setSelectedIndex((i) => Math.min(i + 1, filtered.length - 1));
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        setSelectedIndex((i) => Math.max(i - 1, 0));
      } else if (event.key === "Enter") {
        event.preventDefault();
        const cmd = filtered[selectedIndex];
        if (cmd) execute(cmd);
      } else if (event.key === "Escape") {
        event.preventDefault();
        closePalette();
      }
    },
    [closePalette, execute, filtered, selectedIndex]
  );

  useEffect(() => {
    const selected = listRef.current?.children[selectedIndex] as HTMLElement | undefined;
    selected?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  useEffect(() => {
    if (!toast) return;
    const handle = window.setTimeout(() => setToast(null), 2400);
    return () => window.clearTimeout(handle);
  }, [toast]);

  if (!open) {
    return toast ? <CommandPaletteToast message={toast} /> : null;
  }

  return (
    <div className="fixed inset-0 z-[300] flex items-start justify-center pt-[15vh]">
      <button
        type="button"
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        aria-label={t`Close command palette`}
        onClick={closePalette}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="command-palette-title"
        className="relative w-full max-w-lg animate-entrance overflow-hidden rounded-2xl border border-violet-300/30 bg-zinc-950/90 shadow-2xl backdrop-blur-xl"
      >
        <h2 id="command-palette-title" className="sr-only">
          <Trans>Command Palette</Trans>
        </h2>
        <div className="flex items-center gap-3 border-b border-violet-300/15 px-4 py-3">
          <svg
            className="h-4 w-4 shrink-0 text-zinc-500"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
          <input
            ref={inputRef}
            className="flex-1 bg-transparent text-sm text-zinc-100 outline-none placeholder:text-zinc-600"
            placeholder={t`Search pages, settings, actions...`}
            aria-label={t`Search commands`}
            aria-controls="command-palette-results"
            aria-activedescendant={
              filtered[selectedIndex] ? `command-option-${filtered[selectedIndex].id}` : undefined
            }
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedIndex(0);
            }}
            onKeyDown={handleKeyDown}
          />
          <kbd className="converter-kbd">Ctrl/Cmd+K</kbd>
          <kbd className="converter-kbd">Esc</kbd>
        </div>

        <div
          ref={listRef}
          id="command-palette-results"
          role="listbox"
          className="max-h-72 overflow-y-auto p-2"
        >
          {filtered.length === 0 && (
            <div className="px-3 py-6 text-center text-sm text-zinc-600">
              <Trans>No results found.</Trans>
            </div>
          )}
          {filtered.map((cmd, index) => (
            <div
              id={`command-option-${cmd.id}`}
              key={cmd.id}
              role="option"
              aria-selected={index === selectedIndex}
            >
              <button
                type="button"
                className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors duration-100 ${
                  index === selectedIndex
                    ? "bg-violet-500/20 text-violet-100"
                    : "text-zinc-400 hover:bg-white/5 hover:text-zinc-200"
                }`}
                onClick={() => execute(cmd)}
                onMouseEnter={() => {
                  setSelectedIndex(index);
                  playHoverSound();
                }}
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{cmd.label}</p>
                  {cmd.description && (
                    <p className="truncate text-xs text-zinc-500">{cmd.description}</p>
                  )}
                </div>
                <span className="shrink-0 rounded-md bg-violet-500/10 px-2 py-0.5 font-mono text-[10px] text-violet-400/70">
                  {cmd.category}
                </span>
              </button>
            </div>
          ))}
        </div>

        <div className="flex items-center gap-4 border-t border-violet-300/10 px-4 py-2 text-[10px] text-zinc-600">
          <span className="flex items-center gap-1">
            <kbd className="converter-kbd">↑↓</kbd> <Trans>navigate</Trans>
          </span>
          <span className="flex items-center gap-1">
            <kbd className="converter-kbd">↵</kbd> <Trans>open</Trans>
          </span>
          <span className="flex items-center gap-1">
            <kbd className="converter-kbd">Esc</kbd> <Trans>close</Trans>
          </span>
          <span className="flex items-center gap-1">
            <kbd className="converter-kbd">Ctrl/Cmd+K</kbd> <Trans>toggle</Trans>
          </span>
        </div>
      </div>
    </div>
  );
}

function CommandPaletteToast({ message }: { message: string }) {
  return (
    <div className="pointer-events-none fixed bottom-8 left-1/2 z-[300] -translate-x-1/2 animate-entrance">
      <div className="rounded-xl border border-amber-300/30 bg-zinc-950/90 px-5 py-3 text-sm font-medium text-amber-200 shadow-lg backdrop-blur-xl">
        {message}
      </div>
    </div>
  );
}
