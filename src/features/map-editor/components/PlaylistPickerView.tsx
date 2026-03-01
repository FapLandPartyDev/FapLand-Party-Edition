import React from "react";
import { AnimatedBackground } from "../../../components/AnimatedBackground";
import { playHoverSound } from "../../../utils/audio";
import type { StoredPlaylist } from "../../../services/playlists";

interface PlaylistPickerViewProps {
    playlistList: StoredPlaylist[];
    activePlaylistId: string;
    newPlaylistName: string;
    createPlaylistPending: boolean;
    saveNotice: string | null;
    importPending: boolean;
    onNewPlaylistNameChange: (name: string) => void;
    onCreatePlaylist: () => void;
    onImportPlaylist: () => void;
    onOpenPlaylist: (playlist: StoredPlaylist) => void;
    onNavigateBack: () => void;
}

export const PlaylistPickerView: React.FC<PlaylistPickerViewProps> = React.memo(({
    playlistList,
    activePlaylistId,
    newPlaylistName,
    createPlaylistPending,
    saveNotice,
    importPending,
    onNewPlaylistNameChange,
    onCreatePlaylist,
    onImportPlaylist,
    onOpenPlaylist,
    onNavigateBack,
}) => (
    <div className="relative h-screen overflow-hidden">
        <AnimatedBackground videoUris={[]} />
        <main className="relative z-10 flex h-full w-full flex-col px-3 py-3 md:px-4 md:py-4 lg:px-5 lg:py-5">
            <div className="mx-auto flex h-full min-h-0 w-full max-w-5xl flex-col rounded-2xl border border-violet-300/25 bg-black/35 p-4 backdrop-blur-lg">
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                        <p className="text-xs uppercase tracking-[0.16em] text-violet-200/80">Map Editor</p>
                        <h1 className="text-3xl font-black tracking-tight text-white">Select Playlist</h1>
                        <p className="mt-1 text-sm text-zinc-300">
                            Choose a playlist to edit, or create a new playlist first.
                        </p>
                    </div>
                    <button
                        type="button"
                        className="rounded-xl border border-zinc-600/70 bg-zinc-900/70 px-3 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-zinc-200 transition-colors hover:border-zinc-300/70 hover:text-white"
                        onMouseEnter={playHoverSound}
                        onClick={onNavigateBack}
                    >
                        Back
                    </button>
                </div>

                {saveNotice && (
                    <div className="mt-3 rounded-lg border border-amber-500/45 bg-amber-950/30 px-3 py-2 text-xs text-amber-100">
                        {saveNotice}
                    </div>
                )}

                <div className="mt-4 grid min-h-0 flex-1 gap-3 lg:grid-cols-2">
                    <section className="min-h-0 overflow-y-auto rounded-xl border border-white/10 bg-black/25 p-3">
                        <p className="text-xs uppercase tracking-[0.14em] text-zinc-400">Playlists</p>
                        <div className="mt-3 space-y-2">
                            {playlistList.map((playlist) => (
                                <button
                                    key={playlist.id}
                                    type="button"
                                    className="w-full rounded-lg border border-zinc-700/70 bg-zinc-900/60 px-3 py-2 text-left hover:border-cyan-400/60"
                                    onMouseEnter={playHoverSound}
                                    onClick={() => onOpenPlaylist(playlist)}
                                >
                                    <div className="flex items-center justify-between gap-3">
                                        <p className="text-sm font-semibold text-zinc-100">{playlist.name}</p>
                                        {playlist.id === activePlaylistId && (
                                            <span className="rounded border border-emerald-500/55 bg-emerald-500/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.1em] text-emerald-100">
                                                Active
                                            </span>
                                        )}
                                    </div>
                                    <p className="mt-1 text-xs text-zinc-400">{playlist.description ?? "No description"}</p>
                                    <p className="mt-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-cyan-200">
                                        Edit {playlist.name}
                                    </p>
                                </button>
                            ))}
                        </div>
                    </section>

                    <section className="rounded-xl border border-white/10 bg-black/25 p-3">
                        <p className="text-xs uppercase tracking-[0.14em] text-zinc-400">Create New</p>
                        <label className="mt-3 block">
                            <span className="text-[11px] uppercase tracking-[0.1em] text-zinc-400">Playlist name</span>
                            <input
                                type="text"
                                placeholder="New playlist name"
                                value={newPlaylistName}
                                onChange={(event) => onNewPlaylistNameChange(event.target.value)}
                                className="mt-1 w-full rounded border border-zinc-600/60 bg-zinc-950/70 px-3 py-2 text-sm text-zinc-100"
                            />
                        </label>
                        <button
                            type="button"
                            className="mt-3 rounded-lg border border-cyan-400/60 bg-cyan-500/15 px-3 py-2 text-xs font-semibold uppercase tracking-[0.12em] text-cyan-100 disabled:opacity-50"
                            onMouseEnter={playHoverSound}
                            onClick={onCreatePlaylist}
                            disabled={createPlaylistPending}
                        >
                            {createPlaylistPending ? "Creating..." : "Create Playlist"}
                        </button>
                        <button
                            type="button"
                            className="mt-2 rounded-lg border border-violet-400/50 bg-violet-500/10 px-3 py-2 text-xs font-semibold uppercase tracking-[0.12em] text-violet-100 disabled:opacity-50"
                            onMouseEnter={playHoverSound}
                            onClick={onImportPlaylist}
                            disabled={importPending}
                        >
                            {importPending ? "Importing..." : "Import .fplay"}
                        </button>
                    </section>
                </div>
            </div>
        </main>
    </div>
));

PlaylistPickerView.displayName = "PlaylistPickerView";
