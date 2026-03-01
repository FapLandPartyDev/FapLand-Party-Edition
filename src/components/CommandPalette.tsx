import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { openGlobalHandyOverlay } from "./globalHandyOverlayControls";
import { openGlobalMusicOverlay } from "./globalMusicOverlayControls";
import { playHoverSound, playSelectSound } from "../utils/audio";
import { useCommandPaletteGuard } from "../contexts/CommandPaletteGuardContext";
import { useHandy } from "../contexts/HandyContext";

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

const NAVIGATION_COMMANDS: CommandItem[] = [
  { id: "home", label: "Home", description: "Main menu", category: "Navigation", to: "/" },
  {
    id: "single-player",
    label: "Single Player",
    description: "Start a single-player game",
    category: "Play",
    to: "/single-player-setup",
  },
  {
    id: "multiplayer",
    label: "Multiplayer",
    description: "Join or host a multiplayer lobby",
    category: "Play",
    to: "/multiplayer",
  },
  {
    id: "rounds",
    label: "Installed Rounds",
    description: "Manage your round library",
    category: "Workshop",
    to: "/rounds",
  },
  {
    id: "converter",
    label: "Round Converter",
    description: "Convert videos to playable rounds",
    category: "Workshop",
    to: "/converter",
  },
  {
    id: "playlist-workshop",
    label: "Playlist Workshop",
    description: "Create and edit playlists",
    category: "Workshop",
    to: "/playlist-workshop",
  },
  {
    id: "map-editor",
    label: "Map Editor",
    description: "Design board layouts",
    category: "Workshop",
    to: "/map-editor",
  },
  {
    id: "highscores",
    label: "Highscores",
    description: "View score history",
    category: "Navigation",
    to: "/highscores",
  },
  {
    id: "settings-general",
    label: "Settings — General",
    description: "Fullscreen, background videos",
    category: "Settings",
    to: "/settings?section=general",
  },
  {
    id: "settings-gameplay",
    label: "Settings — Gameplay",
    description: "HUD, perks, cheat mode",
    category: "Settings",
    to: "/settings?section=gameplay",
  },
  {
    id: "settings-audio",
    label: "Settings — Audio",
    description: "Music queue, volume",
    category: "Settings",
    to: "/settings?section=audio",
  },
  {
    id: "settings-hardware",
    label: "Settings — Hardware & Sync",
    description: "TheHandy, funscripts",
    category: "Settings",
    to: "/settings?section=hardware",
    keywords: ["handy", "funscript", "device"],
  },
  {
    id: "settings-sources",
    label: "Settings — Sources & Library",
    description: "Stash, auto-scan folders",
    category: "Settings",
    to: "/settings?section=sources",
    keywords: ["stash", "scan", "library"],
  },
  {
    id: "settings-security",
    label: "Settings — Security & Privacy",
    description: "SFW mode, safe domains",
    category: "Settings",
    to: "/settings?section=security-privacy",
    keywords: ["sfw", "safe", "domains"],
  },
  {
    id: "settings-data",
    label: "Settings — Data & Storage",
    description: "Cache, clear data",
    category: "Settings",
    to: "/settings?section=app",
    keywords: ["cache", "storage", "phash"],
  },
  {
    id: "settings-advanced",
    label: "Settings — Advanced",
    description: "FFmpeg, yt-dlp",
    category: "Settings",
    to: "/settings?section=advanced",
    keywords: ["ffmpeg", "ytdlp", "binary"],
  },
  {
    id: "settings-experimental",
    label: "Settings — Experimental",
    description: "Controller support, web funscripts",
    category: "Settings",
    to: "/settings?section=experimental",
    keywords: ["controller", "gamepad", "experimental"],
  },
  {
    id: "settings-help",
    label: "Settings — Help",
    description: "Keyboard shortcut reference",
    category: "Settings",
    to: "/settings?section=help",
    keywords: ["shortcuts", "keyboard", "hotkeys"],
  },
];

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [toast, setToast] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const guard = useCommandPaletteGuard();
  const { manuallyStopped, toggleManualStop } = useHandy();

  useEffect(() => {
    _setOpenFromOutside = (value: boolean) => {
      setOpen(value);
      if (value) {
        setQuery("");
        setTimeout(() => inputRef.current?.focus(), 50);
      }
    };
    return () => {
      _setOpenFromOutside = null;
    };
  }, []);

  const commands = useMemo<CommandItem[]>(
    () => [
      ...NAVIGATION_COMMANDS,
      {
        id: "rounds-install-web",
        label: "Install From Web",
        description: "Open the website round installer",
        category: "Workshop",
        action: () => navigate({ to: "/rounds", search: { open: "install-web" } }),
        keywords: ["rounds", "install", "web", "url", "website"],
      },
      {
        id: "rounds-install-folder",
        label: "Install Rounds",
        description: "Open the folder picker for round installs",
        category: "Workshop",
        action: () => navigate({ to: "/rounds", search: { open: "install-rounds" } }),
        keywords: ["rounds", "install", "folder", "import", "scan"],
      },
      {
        id: "music-menu",
        label: "Music Menu",
        description: "Open the global music overlay",
        category: "Media",
        action: openGlobalMusicOverlay,
        keywords: ["music", "player", "overlay", "queue"],
      },
      {
        id: "thehandy-menu",
        label: "TheHandy Menu",
        description: "Open the global TheHandy overlay",
        category: "Hardware",
        action: openGlobalHandyOverlay,
        keywords: ["handy", "thehandy", "device", "sync", "overlay", "offset"],
      },
      {
        id: "thehandy-toggle",
        label: manuallyStopped ? "Start TheHandy" : "Stop TheHandy",
        description: "Toggle TheHandy manual stop state",
        category: "Hardware",
        action: async () => {
          const result = await toggleManualStop();
          if (result === "stopped") return "TheHandy stopped.";
          if (result === "resumed") return "TheHandy resumed.";
          return "No connected TheHandy to toggle.";
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
          setToast(guard.reason ?? "You cannot use the command palette here.");
          return;
        }
        setOpen((prev) => !prev);
        setQuery("");
        if (!open) {
          setTimeout(() => inputRef.current?.focus(), 50);
        }
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [guard.blocked, guard.reason, open]);

  const execute = useCallback(
    async (cmd: CommandItem) => {
      playSelectSound();
      setOpen(false);
      setQuery("");
      if (cmd.to) {
        void navigate({ to: cmd.to });
      }
      const message = await cmd.action?.();
      if (typeof message === "string" && message.length > 0) {
        setToast(message);
      }
    },
    [navigate]
  );

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        event.stopPropagation();
        setOpen(false);
        setQuery("");
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
        setOpen(false);
        setQuery("");
      }
    },
    [execute, filtered, selectedIndex]
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
    <div
      className="fixed inset-0 z-[300] flex items-start justify-center pt-[15vh]"
      onClick={() => {
        setOpen(false);
        setQuery("");
      }}
      onKeyDown={() => {}}
      role="button"
      tabIndex={-1}
      aria-label="Close command palette"
    >
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions */}
      <div
        className="relative w-full max-w-lg animate-entrance overflow-hidden rounded-2xl border border-violet-300/30 bg-zinc-950/90 shadow-2xl backdrop-blur-xl"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
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
            placeholder="Search pages, settings, actions..."
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedIndex(0);
            }}
            onKeyDown={handleKeyDown}
          />
          <kbd className="converter-kbd">Esc</kbd>
        </div>

        <div ref={listRef} className="max-h-72 overflow-y-auto p-2">
          {filtered.length === 0 && (
            <div className="px-3 py-6 text-center text-sm text-zinc-600">No results found.</div>
          )}
          {filtered.map((cmd, index) => (
            <button
              key={cmd.id}
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
          ))}
        </div>

        <div className="flex items-center gap-4 border-t border-violet-300/10 px-4 py-2 text-[10px] text-zinc-600">
          <span className="flex items-center gap-1">
            <kbd className="converter-kbd">↑↓</kbd> navigate
          </span>
          <span className="flex items-center gap-1">
            <kbd className="converter-kbd">↵</kbd> open
          </span>
          <span className="flex items-center gap-1">
            <kbd className="converter-kbd">Esc</kbd> close
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
