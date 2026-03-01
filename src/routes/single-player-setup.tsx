import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { AnimatedBackground } from "../components/AnimatedBackground";
import { MenuButton } from "../components/MenuButton";
import { PlaylistMapPreview } from "../components/PlaylistMapPreview";
import type { PlaylistConfig } from "../game/playlistSchema";
import { playlists, type StoredPlaylist } from "../services/playlists";
import { playHoverSound, playSelectSound } from "../utils/audio";

const withActivePlaylist = (playlistsToShow: StoredPlaylist[], activePlaylist: StoredPlaylist | null): StoredPlaylist[] => {
  if (!activePlaylist) return playlistsToShow;
  if (playlistsToShow.some((playlist) => playlist.id === activePlaylist.id)) {
    return playlistsToShow;
  }
  return [activePlaylist, ...playlistsToShow];
};

const describeBoard = (config: PlaylistConfig): {
  modeLabel: string;
  nodeCount: number;
  edgeCount: number;
  safePointCount: number;
  roundNodeCount: number;
} => {
  if (config.boardConfig.mode === "linear") {
    return {
      modeLabel: "Linear",
      nodeCount: config.boardConfig.totalIndices + 1,
      edgeCount: config.boardConfig.totalIndices,
      safePointCount: config.boardConfig.safePointIndices.length,
      roundNodeCount: config.boardConfig.totalIndices - config.boardConfig.safePointIndices.length,
    };
  }

  return {
    modeLabel: "Graph",
    nodeCount: config.boardConfig.nodes.length,
    edgeCount: config.boardConfig.edges.length,
    safePointCount: config.boardConfig.nodes.filter((node) => node.kind === "safePoint").length,
    roundNodeCount: config.boardConfig.nodes.filter((node) => node.kind === "round" || node.kind === "randomRound").length,
  };
};

export const Route = createFileRoute("/single-player-setup")({
  loader: async () => {
    const availablePlaylists = await playlists.list();
    const activePlaylist = availablePlaylists.length > 0 ? await playlists.getActive() : null;

    return {
      availablePlaylists: withActivePlaylist(availablePlaylists, activePlaylist),
      activePlaylist,
    };
  },
  component: SinglePlayerSetupRoute,
});

export function SinglePlayerSetupRoute() {
  const navigate = useNavigate();
  const { availablePlaylists, activePlaylist } = Route.useLoaderData() as {
    availablePlaylists: StoredPlaylist[];
    activePlaylist: StoredPlaylist | null;
  };
  const [selectedPlaylistId, setSelectedPlaylistId] = useState(activePlaylist?.id ?? availablePlaylists[0]?.id ?? null);
  const [pendingAction, setPendingAction] = useState<"start" | "workshop" | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const selectedPlaylist = useMemo(
    () => availablePlaylists.find((playlist) => playlist.id === selectedPlaylistId) ?? activePlaylist ?? null,
    [activePlaylist, availablePlaylists, selectedPlaylistId],
  );

  const boardSummary = useMemo(
    () => (selectedPlaylist ? describeBoard(selectedPlaylist.config) : null),
    [selectedPlaylist],
  );

  const activateSelectedPlaylist = async () => {
    if (!selectedPlaylist) {
      throw new Error("No playlist selected.");
    }
    await playlists.setActive(selectedPlaylist.id);
  };

  const handleStart = async () => {
    if (pendingAction) return;
    setPendingAction("start");
    setNotice(null);
    try {
      await activateSelectedPlaylist();
      await navigate({ to: "/game" });
    } catch (error) {
      console.error("Failed to start selected playlist", error);
      setNotice("Failed to start selected playlist.");
    } finally {
      setPendingAction(null);
    }
  };

  const handleOpenWorkshop = async () => {
    if (pendingAction) return;
    setPendingAction("workshop");
    setNotice(null);
    try {
      await activateSelectedPlaylist();
      await navigate({ to: "/playlist-workshop" });
    } catch (error) {
      console.error("Failed to open playlist workshop", error);
      setNotice("Failed to open playlist workshop.");
    } finally {
      setPendingAction(null);
    }
  };

  if (!selectedPlaylist || !boardSummary) {
    return (
      <div className="relative min-h-screen overflow-hidden">
        <AnimatedBackground />

        <div className="relative z-10 h-screen overflow-y-auto px-4 py-8 sm:px-8">
          <main className="mx-auto flex w-full max-w-4xl flex-col gap-6 pb-6">
            <header className="rounded-3xl border border-purple-400/35 bg-zinc-950/60 p-6 backdrop-blur-xl shadow-[0_0_50px_rgba(139,92,246,0.28)]">
              <p className="font-[family-name:var(--font-jetbrains-mono)] text-xs uppercase tracking-[0.45em] text-purple-200/85">
                Single Player
              </p>
              <h1 className="mt-3 text-3xl font-black tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-violet-200 via-purple-100 to-indigo-200 sm:text-5xl">
                No Playlist Yet
              </h1>
              <p className="mt-3 text-sm text-zinc-300">
                Production no longer auto-generates a default playlist. Create one first, then start your run.
              </p>
            </header>

            <section className="rounded-3xl border border-purple-400/25 bg-zinc-950/55 p-5 backdrop-blur-xl">
              <p className="text-sm text-zinc-200">
                Open the playlist workshop to build a linear playlist, or use the map editor if you want a graph-based board.
              </p>
              <div className="mt-5 grid gap-2 sm:grid-cols-2">
                <MenuButton
                  label="Open Playlist Workshop"
                  primary
                  onHover={playHoverSound}
                  onClick={() => {
                    playSelectSound();
                    void navigate({ to: "/playlist-workshop" });
                  }}
                />
                <MenuButton
                  label="Open Map Editor"
                  onHover={playHoverSound}
                  onClick={() => {
                    playSelectSound();
                    void navigate({ to: "/map-editor" });
                  }}
                />
              </div>
            </section>
          </main>
        </div>
      </div>
    );
  }

  return (
    <div className="relative min-h-screen overflow-hidden">
      <AnimatedBackground />

      <div className="relative z-10 h-screen overflow-y-auto px-4 py-8 sm:px-8">
        <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 pb-6">
          <header className="rounded-3xl border border-purple-400/35 bg-zinc-950/60 p-6 backdrop-blur-xl shadow-[0_0_50px_rgba(139,92,246,0.28)]">
            <p className="font-[family-name:var(--font-jetbrains-mono)] text-xs uppercase tracking-[0.45em] text-purple-200/85">
              Single Player
            </p>
            <h1 className="mt-3 text-3xl font-black tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-violet-200 via-purple-100 to-indigo-200 sm:text-5xl">
              Choose Playlist
            </h1>
            <p className="mt-3 text-sm text-zinc-300">
              Pick a playlist, preview the map layout, then start your run.
            </p>
            {notice && (
              <p className="mt-3 text-sm text-rose-200">{notice}</p>
            )}
          </header>

          <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(320px,420px)]">
            <div className="rounded-3xl border border-purple-400/25 bg-zinc-950/55 p-5 backdrop-blur-xl">
              <h2 className="text-lg font-bold text-violet-100">Playlists</h2>
              <div className="mt-4 grid max-h-[62vh] gap-2 overflow-y-auto pr-1">
                {availablePlaylists.map((playlist) => {
                  const isSelected = playlist.id === selectedPlaylist.id;
                  const isActive = playlist.id === activePlaylist?.id;
                  const summary = describeBoard(playlist.config);
                  return (
                    <button
                      key={playlist.id}
                      type="button"
                      onMouseEnter={playHoverSound}
                      onClick={() => {
                        playSelectSound();
                        setSelectedPlaylistId(playlist.id);
                      }}
                      className={`rounded-2xl border px-4 py-3 text-left transition ${
                        isSelected
                          ? "border-emerald-300/60 bg-emerald-500/20 text-emerald-100"
                          : "border-zinc-700 bg-black/35 text-zinc-200 hover:border-violet-300/60 hover:bg-violet-500/20"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <p className="truncate text-sm font-semibold">{playlist.name}</p>
                        <span className="rounded-full border border-zinc-500/70 bg-zinc-900/80 px-2 py-0.5 text-[10px] uppercase tracking-[0.12em] text-zinc-300">
                          {summary.modeLabel}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-zinc-400">{playlist.description ?? "No description"}</p>
                      <div className="mt-2 flex flex-wrap gap-1.5 text-[11px]">
                        <span className="rounded-full border border-zinc-600/70 bg-zinc-900/80 px-2 py-0.5 text-zinc-300">
                          Nodes {summary.nodeCount}
                        </span>
                        <span className="rounded-full border border-zinc-600/70 bg-zinc-900/80 px-2 py-0.5 text-zinc-300">
                          Edges {summary.edgeCount}
                        </span>
                        {isActive && (
                          <span className="rounded-full border border-emerald-300/70 bg-emerald-500/20 px-2 py-0.5 text-emerald-100">
                            Active
                          </span>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="rounded-3xl border border-purple-400/25 bg-zinc-950/55 p-5 backdrop-blur-xl">
              <h2 className="text-lg font-bold text-violet-100">Selected Playlist</h2>
              <p className="mt-2 text-sm text-zinc-200">{selectedPlaylist.name}</p>
              <p className="mt-1 text-xs text-zinc-400">{selectedPlaylist.description ?? "No description"}</p>

              <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                <div className="rounded-xl border border-zinc-700/70 bg-black/35 px-3 py-2 text-zinc-200">
                  Mode: <span className="font-semibold">{boardSummary.modeLabel}</span>
                </div>
                <div className="rounded-xl border border-zinc-700/70 bg-black/35 px-3 py-2 text-zinc-200">
                  Nodes: <span className="font-semibold">{boardSummary.nodeCount}</span>
                </div>
                <div className="rounded-xl border border-zinc-700/70 bg-black/35 px-3 py-2 text-zinc-200">
                  Edges: <span className="font-semibold">{boardSummary.edgeCount}</span>
                </div>
                <div className="rounded-xl border border-zinc-700/70 bg-black/35 px-3 py-2 text-zinc-200">
                  Round nodes: <span className="font-semibold">{Math.max(0, boardSummary.roundNodeCount)}</span>
                </div>
              </div>

              <div className="mt-4 rounded-2xl border border-violet-300/30 bg-black/30 p-3">
                <p className="mb-2 text-xs uppercase tracking-[0.2em] text-zinc-300">Map Preview</p>
                <PlaylistMapPreview config={selectedPlaylist.config} className="h-[220px] w-full" />
              </div>

              <p className="mt-3 text-xs text-zinc-400">
                Safe points: {boardSummary.safePointCount} | Playlist version {selectedPlaylist.config.playlistVersion}
              </p>
            </div>
          </section>

          <div className="mx-auto grid w-full max-w-md grid-cols-1 gap-2">
            <MenuButton
              label={pendingAction === "start" ? "Starting..." : "Start Selected Playlist"}
              primary
              onHover={playHoverSound}
              onClick={() => {
                playSelectSound();
                void handleStart();
              }}
            />
            <MenuButton
              label={pendingAction === "workshop" ? "Opening Workshop..." : "Open Playlist Workshop"}
              onHover={playHoverSound}
              onClick={() => {
                playSelectSound();
                void handleOpenWorkshop();
              }}
            />
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
    </div>
  );
}
