import React, { useRef } from "react";
import { useControllerSurface } from "../../../controller";
import { AnimatedBackground } from "../../../components/AnimatedBackground";
import { playHoverSound } from "../../../utils/audio";
import type { StoredPlaylist } from "../../../services/playlists";

interface PlaylistPickerViewProps {
    playlistList: StoredPlaylist[];
    activePlaylistId: string;
    newPlaylistName: string;
    createPlaylistPending: boolean;
    managePlaylistPendingId: string | null;
    saveNotice: string | null;
    onNewPlaylistNameChange: (name: string) => void;
    onCreatePlaylist: () => void;
    onOpenPlaylist: (playlist: StoredPlaylist) => void;
    onDuplicatePlaylist: (playlist: StoredPlaylist) => void;
    onDeletePlaylist: (playlist: StoredPlaylist) => void;
    onNavigateBack: () => void;
}

export const PlaylistPickerView: React.FC<PlaylistPickerViewProps> = React.memo(({
    playlistList,
    activePlaylistId,
    newPlaylistName,
    createPlaylistPending,
    managePlaylistPendingId,
    saveNotice,
    onNewPlaylistNameChange,
    onCreatePlaylist,
    onOpenPlaylist,
    onDuplicatePlaylist,
    onDeletePlaylist,
    onNavigateBack,
}) => {
    const scopeRef = useRef<HTMLDivElement | null>(null);

    useControllerSurface({
        id: "map-editor-playlist-picker",
        scopeRef,
        priority: 20,
        initialFocusId: playlistList[0] ? `map-editor-picker-${playlistList[0].id}` : "map-editor-picker-name",
        onBack: () => {
            onNavigateBack();
            return true;
        },
    });

    return (
    <div ref={scopeRef} className="relative h-screen overflow-hidden">
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
                        data-controller-focus-id="map-editor-picker-back"
                        data-controller-back="true"
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
                                <div
                                    key={playlist.id}
                                    className="rounded-lg border border-zinc-700/70 bg-zinc-900/60 px-3 py-2"
                                >
                                    <div className="flex items-center justify-between gap-3">
                                        <button
                                            type="button"
                                            className="min-w-0 flex-1 text-left hover:text-cyan-100"
                                            onMouseEnter={playHoverSound}
                                            onClick={() => onOpenPlaylist(playlist)}
                                            data-controller-focus-id={`map-editor-picker-${playlist.id}`}
                                            data-controller-initial={playlist.id === activePlaylistId ? "true" : undefined}
                                        >
                                            <p className="truncate text-sm font-semibold text-zinc-100">{playlist.name}</p>
                                        </button>
                                        {playlist.id === activePlaylistId && (
                                            <span className="rounded border border-emerald-500/55 bg-emerald-500/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.1em] text-emerald-100">
                                                Active
                                            </span>
                                        )}
                                    </div>
                                    <p className="mt-1 text-xs text-zinc-400">{playlist.description ?? "No description"}</p>
                                    <div className="mt-3 flex flex-wrap items-center gap-2">
                                        <button
                                            type="button"
                                            className="rounded-md border border-cyan-500/35 bg-cyan-500/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-cyan-100 hover:border-cyan-400/60 hover:bg-cyan-500/20"
                                            onMouseEnter={playHoverSound}
                                            onClick={() => onOpenPlaylist(playlist)}
                                        >
                                            Edit
                                        </button>
                                        <button
                                            type="button"
                                            disabled={managePlaylistPendingId === playlist.id}
                                            className="rounded-md border border-violet-500/35 bg-violet-500/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-violet-100 hover:border-violet-400/60 hover:bg-violet-500/20 disabled:opacity-50"
                                            onMouseEnter={playHoverSound}
                                            onClick={() => onDuplicatePlaylist(playlist)}
                                        >
                                            {managePlaylistPendingId === playlist.id ? "Working..." : "Copy"}
                                        </button>
                                        <button
                                            type="button"
                                            disabled={managePlaylistPendingId === playlist.id}
                                            className="rounded-md border border-rose-500/35 bg-rose-500/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-rose-100 hover:border-rose-400/60 hover:bg-rose-500/20 disabled:opacity-50"
                                            onMouseEnter={playHoverSound}
                                            onClick={() => onDeletePlaylist(playlist)}
                                        >
                                            Delete
                                        </button>
                                    </div>
                                </div>
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
                                data-controller-focus-id="map-editor-picker-name"
                            />
                        </label>
                        <button
                            type="button"
                            className="mt-3 rounded-lg border border-cyan-400/60 bg-cyan-500/15 px-3 py-2 text-xs font-semibold uppercase tracking-[0.12em] text-cyan-100 disabled:opacity-50"
                            onMouseEnter={playHoverSound}
                            onClick={onCreatePlaylist}
                            disabled={createPlaylistPending}
                            data-controller-focus-id="map-editor-picker-create"
                        >
                            {createPlaylistPending ? "Creating..." : "Create Playlist"}
                        </button>
                    </section>
                </div>
            </div>
        </main>
    </div>
    );
});

PlaylistPickerView.displayName = "PlaylistPickerView";
