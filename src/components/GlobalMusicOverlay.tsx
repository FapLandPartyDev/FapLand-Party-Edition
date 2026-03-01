import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useControllerSubscription, useControllerSurface } from "../controller";
import type { MusicLoopMode } from "../constants/musicSettings";
import { useGlobalMusic } from "../hooks/useGlobalMusic";
import { ConfirmDialog } from "./ui/ConfirmDialog";
import { subscribeToGlobalMusicOverlayOpen } from "./globalMusicOverlayControls";
import { playHoverSound, playSelectSound } from "../utils/audio";

export { openGlobalMusicOverlay } from "./globalMusicOverlayControls";

function isEditableElement(target: Element | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tagName = target.tagName.toLowerCase();
  return (
    target.isContentEditable ||
    tagName === "input" ||
    tagName === "textarea" ||
    tagName === "select"
  );
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (isEditableElement(target instanceof Element ? target : null)) return true;
  return isEditableElement(document.activeElement);
}

function formatTime(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return "0:00";
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

function formatPlaybackStatus({
  enabled,
  isPlaying,
  isSuppressedByVideo,
}: {
  enabled: boolean;
  isPlaying: boolean;
  isSuppressedByVideo: boolean;
}): string {
  if (isSuppressedByVideo) return "Blocked by video";
  if (!enabled) return "Music disabled";
  return isPlaying ? "Now playing" : "Ready to play";
}

function WaveformBars({ isPlaying }: { isPlaying: boolean }) {
  return (
    <div className="flex items-end justify-center gap-[3px] h-8">
      {[0.6, 1, 0.7, 0.9, 0.5].map((_, i) => (
        <div
          key={i}
          className="w-1 bg-gradient-to-t from-cyan-400 to-white rounded-full"
          style={{
            height: isPlaying ? "100%" : "40%",
            animation: isPlaying ? `music-wave-bar 0.8s ease-in-out infinite ${i * 0.1}s` : "none",
          }}
        />
      ))}
    </div>
  );
}

export function GlobalMusicOverlay() {
  const {
    enabled,
    queue,
    currentTrack,
    isPlaying,
    isSuppressedByVideo,
    volume,
    shuffle,
    loopMode,
    currentTime,
    duration,
    setEnabled,
    addTracks,
    addTrackFromUrl,
    addPlaylistFromUrl,
    clearQueue,
    play,
    pause,
    next,
    previous,
    setCurrentTrack,
    setVolume,
    setShuffle,
    setLoopMode,
    seek,
  } = useGlobalMusic();
  const [open, setOpen] = useState(false);
  const setOpenRef = useRef(setOpen);
  setOpenRef.current = setOpen;

  useEffect(() => {
    return subscribeToGlobalMusicOverlayOpen(() => {
      setOpenRef.current(true);
    });
  }, []);
  const [isAddingTracks, setIsAddingTracks] = useState(false);
  const [showUrlInput, setShowUrlInput] = useState(false);
  const [urlInput, setUrlInput] = useState("");
  const [isAddingFromUrl, setIsAddingFromUrl] = useState(false);
  const [urlError, setUrlError] = useState<string | null>(null);
  const [urlMode, setUrlMode] = useState<"track" | "playlist">("track");
  const [urlResult, setUrlResult] = useState<{ added: number; errors: number } | null>(null);
  const [showQueue, setShowQueue] = useState(true);
  const [isClearConfirmOpen, setIsClearConfirmOpen] = useState(false);
  const [volumeDraft, setVolumeDraft] = useState(() => Math.round(volume * 100));
  const overlayRef = useRef<HTMLElement | null>(null);
  const progressRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setVolumeDraft(Math.round(volume * 100));
  }, [volume]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        (event.ctrlKey || event.metaKey) &&
        event.key.toLowerCase() === "m" &&
        !event.shiftKey &&
        !event.altKey
      ) {
        event.preventDefault();
        if (!open && isEditableTarget(event.target)) return;
        setOpen((current) => !current);
        return;
      }
      if (event.key === "Escape") {
        setOpen(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  const statusLabel = useMemo(
    () => formatPlaybackStatus({ enabled, isPlaying, isSuppressedByVideo }),
    [enabled, isPlaying, isSuppressedByVideo]
  );

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  const addSelectedTracks = async () => {
    if (isAddingTracks) return;
    setIsAddingTracks(true);
    try {
      const filePaths = await window.electronAPI.dialog.selectMusicFiles();
      if (filePaths.length === 0) return;
      await addTracks(filePaths);
    } catch (error) {
      console.error("Failed to add music tracks", error);
    } finally {
      setIsAddingTracks(false);
    }
  };

  const handleAddFromUrl = async () => {
    if (isAddingFromUrl) return;
    const trimmed = urlInput.trim();
    if (!trimmed) {
      setUrlError("Please enter a URL");
      return;
    }
    try {
      new URL(trimmed);
    } catch {
      setUrlError("Invalid URL format");
      return;
    }
    setUrlError(null);
    setIsAddingFromUrl(true);
    setUrlResult(null);
    try {
      if (urlMode === "playlist") {
        const result = await addPlaylistFromUrl(trimmed);
        setUrlResult({ added: result.addedCount, errors: result.errorCount });
        if (result.addedCount > 0) {
          setUrlInput("");
          setShowUrlInput(false);
        }
      } else {
        await addTrackFromUrl(trimmed);
        setUrlInput("");
        setShowUrlInput(false);
      }
    } catch (error) {
      setUrlError(error instanceof Error ? error.message : "Failed to add from URL");
    } finally {
      setIsAddingFromUrl(false);
    }
  };

  const togglePlayback = async () => {
    playSelectSound();
    if (isPlaying) {
      pause();
      return;
    }
    if (isSuppressedByVideo || !enabled || !currentTrack) return;
    await play();
  };

  const commitVolumeDraft = async () => {
    await setVolume(volumeDraft / 100);
  };

  const handleProgressClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!progressRef.current || duration === 0) return;
    const rect = progressRef.current.getBoundingClientRect();
    const clickX = event.clientX - rect.left;
    const percentage = clickX / rect.width;
    seek(percentage * duration);
  };

  const handleToggleOverlay = useCallback(() => {
    setOpen((current) => !current);
  }, []);

  const handleRequestClearQueue = useCallback(() => {
    if (queue.length === 0) return;
    playSelectSound();
    setIsClearConfirmOpen(true);
  }, [queue.length]);

  const handleConfirmClearQueue = useCallback(() => {
    playSelectSound();
    setIsClearConfirmOpen(false);
    void clearQueue();
  }, [clearQueue]);

  const handleCancelClearQueue = useCallback(() => {
    playSelectSound();
    setIsClearConfirmOpen(false);
  }, []);

  useControllerSubscription(
    useCallback(
      (action) => {
        if (action === "START") {
          handleToggleOverlay();
        }
      },
      [handleToggleOverlay]
    )
  );

  useControllerSurface({
    id: "global-music-overlay",
    scopeRef: overlayRef,
    priority: 240,
    enabled: open,
    initialFocusId: "music-enabled-toggle",
    onBack: () => {
      setOpen(false);
      return true;
    },
  });

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          key="music-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[240] flex items-center justify-center overflow-hidden bg-[radial-gradient(circle_at_top,_rgba(34,211,238,0.08),_transparent_40%),linear-gradient(180deg,rgba(8,12,20,0.92),rgba(5,8,14,0.97))] px-3 py-3 sm:px-4 sm:py-4 backdrop-blur-lg"
          onClick={() => setOpen(false)}
        >
          <motion.section
            ref={overlayRef}
            initial={{ opacity: 0, y: 24, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.97 }}
            transition={{ type: "spring", stiffness: 280, damping: 26 }}
            onClick={(event) => event.stopPropagation()}
            className="relative flex max-h-[calc(100vh-1.5rem)] w-full max-w-2xl flex-col overflow-hidden rounded-[1.75rem] border border-white/[0.08] bg-[linear-gradient(160deg,rgba(18,28,46,0.92),rgba(9,14,24,0.96))] text-zinc-100 shadow-[0_28px_100px_rgba(0,0,0,0.5)] sm:max-h-[calc(100vh-2rem)]"
            role="dialog"
            aria-modal="true"
            aria-label="Global music controls"
          >
            <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-[inherit]">
              <div className="absolute -left-20 -top-20 h-48 w-48 rounded-full bg-cyan-400/10 blur-[80px]" />
              <div className="absolute -bottom-16 -right-16 h-40 w-40 rounded-full bg-amber-400/8 blur-[70px]" />
            </div>

            <header className="relative flex items-center justify-between gap-4 border-b border-white/[0.06] px-5 py-4 sm:px-6">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.28em] text-cyan-300/80">
                  Global Music
                </p>
                <p className="mt-0.5 text-xs text-zinc-400">
                  Press{" "}
                  <span className="rounded border border-white/15 bg-white/5 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                    Ctrl+M
                  </span>{" "}
                  to toggle
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onMouseEnter={playHoverSound}
                  onClick={() => {
                    playSelectSound();
                    void setEnabled(!enabled);
                  }}
                  className={`rounded-full border px-3.5 py-1.5 text-xs font-semibold transition-all ${
                    enabled
                      ? "border-emerald-300/40 bg-emerald-400/12 text-emerald-100 shadow-[0_0_20px_rgba(52,211,153,0.15)]"
                      : "border-zinc-600/50 bg-black/20 text-zinc-400"
                  }`}
                  data-controller-focus-id="music-enabled-toggle"
                  data-controller-initial="true"
                >
                  {enabled ? "Music On" : "Music Off"}
                </button>
                <button
                  type="button"
                  onMouseEnter={playHoverSound}
                  onClick={() => {
                    playSelectSound();
                    setOpen(false);
                  }}
                  className="rounded-full border border-white/10 bg-white/5 px-3.5 py-1.5 text-xs font-semibold text-zinc-300 transition hover:bg-white/10"
                  aria-label="Close music overlay"
                  data-controller-focus-id="music-close"
                  data-controller-back="true"
                >
                  Close
                </button>
              </div>
            </header>

            <div className="relative min-h-0 flex-1 overflow-y-auto">
              <div className="p-5 sm:p-6 space-y-5">
                <div className="flex items-center gap-5">
                  <div
                    className={`relative flex h-20 w-20 flex-shrink-0 items-center justify-center overflow-hidden rounded-2xl border ${
                      isPlaying && enabled && !isSuppressedByVideo
                        ? "border-cyan-300/30 bg-gradient-to-br from-cyan-500/20 to-purple-500/20 shadow-[0_0_30px_rgba(34,211,238,0.2)]"
                        : "border-white/10 bg-gradient-to-br from-zinc-700/40 to-zinc-800/40"
                    }`}
                  >
                    <div className="absolute inset-0 flex items-center justify-center">
                      <span className="text-3xl opacity-40">♪</span>
                    </div>
                    <div className="absolute inset-x-0 bottom-2">
                      <WaveformBars isPlaying={isPlaying && enabled && !isSuppressedByVideo} />
                    </div>
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-amber-200/70">
                        {statusLabel}
                      </p>
                      {isPlaying && enabled && !isSuppressedByVideo && (
                        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
                      )}
                    </div>
                    <h2 className="mt-1 truncate text-lg font-bold text-white sm:text-xl">
                      {currentTrack?.name ?? "No track selected"}
                    </h2>
                    <p className="mt-0.5 truncate text-xs text-zinc-500">
                      {currentTrack?.filePath ?? "Add local audio files to start"}
                    </p>
                  </div>
                </div>

                {isSuppressedByVideo && (
                  <div className="flex items-center gap-2 rounded-xl border border-amber-300/20 bg-amber-400/8 px-3 py-2 text-xs text-amber-100">
                    <span>⚠</span>
                    <span>Playback paused while a foreground video is active</span>
                  </div>
                )}

                <div className="space-y-2">
                  <div
                    ref={progressRef}
                    onClick={handleProgressClick}
                    onKeyDown={(e) => {
                      if (e.key === "ArrowLeft") {
                        seek(Math.max(0, currentTime - 5));
                      } else if (e.key === "ArrowRight") {
                        seek(Math.min(duration, currentTime + 5));
                      }
                    }}
                    role="slider"
                    aria-label="Track progress"
                    aria-valuemin={0}
                    aria-valuemax={duration}
                    aria-valuenow={currentTime}
                    tabIndex={0}
                    className={`relative h-2 overflow-hidden rounded-full bg-white/10 ${
                      currentTrack && enabled && !isSuppressedByVideo
                        ? "cursor-pointer"
                        : "cursor-not-allowed"
                    }`}
                  >
                    <motion.div
                      className="absolute inset-y-0 left-0 bg-gradient-to-r from-cyan-400 to-cyan-300"
                      style={{ width: `${progress}%` }}
                      layoutId="music-progress"
                    />
                    {progress > 0 && (
                      <div
                        className="absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-cyan-300 bg-zinc-900 shadow-[0_0_12px_rgba(34,211,238,0.5)]"
                        style={{ left: `${progress}%` }}
                      />
                    )}
                  </div>
                  <div className="flex justify-between text-[10px] font-medium text-zinc-400">
                    <span>{formatTime(currentTime)}</span>
                    <span>{formatTime(duration)}</span>
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-center gap-2 sm:gap-3">
                  <button
                    type="button"
                    onMouseEnter={playHoverSound}
                    onClick={() => {
                      playSelectSound();
                      void previous();
                    }}
                    className="rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-xs font-semibold text-zinc-200 transition hover:bg-white/10 hover:border-white/20"
                    data-controller-focus-id="music-previous"
                  >
                    ◀◀ Prev
                  </button>
                  <button
                    type="button"
                    onMouseEnter={playHoverSound}
                    onClick={() => void togglePlayback()}
                    disabled={!currentTrack || !enabled || isSuppressedByVideo}
                    className={`min-w-[100px] rounded-xl px-6 py-2.5 text-sm font-bold transition-all ${
                      !currentTrack || !enabled || isSuppressedByVideo
                        ? "cursor-not-allowed border border-zinc-700/50 bg-zinc-800/50 text-zinc-500"
                        : isPlaying
                          ? "border border-cyan-300/40 bg-cyan-400/15 text-cyan-50 shadow-[0_0_30px_rgba(34,211,238,0.25)] hover:bg-cyan-400/25"
                          : "border border-emerald-300/40 bg-emerald-400/15 text-emerald-50 shadow-[0_0_24px_rgba(52,211,153,0.2)] hover:bg-emerald-400/25"
                    }`}
                    data-controller-focus-id="music-toggle-playback"
                  >
                    {isPlaying ? "⏸ Pause" : "▶ Play"}
                  </button>
                  <button
                    type="button"
                    onMouseEnter={playHoverSound}
                    onClick={() => {
                      playSelectSound();
                      void next();
                    }}
                    className="rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-xs font-semibold text-zinc-200 transition hover:bg-white/10 hover:border-white/20"
                    data-controller-focus-id="music-next"
                  >
                    Next ▶▶
                  </button>
                  <button
                    type="button"
                    onMouseEnter={playHoverSound}
                    onClick={() => void addSelectedTracks()}
                    disabled={isAddingTracks}
                    className={`rounded-xl px-4 py-2.5 text-xs font-semibold transition-all ${
                      isAddingTracks
                        ? "cursor-not-allowed border border-zinc-700/50 bg-zinc-800/50 text-zinc-500"
                        : "border border-amber-300/30 bg-amber-400/10 text-amber-100 hover:bg-amber-400/18 hover:border-amber-300/50"
                    }`}
                    data-controller-focus-id="music-add-tracks"
                  >
                    {isAddingTracks ? "Adding..." : "+ Add Tracks"}
                  </button>
                  <button
                    type="button"
                    onMouseEnter={playHoverSound}
                    onClick={() => {
                      playSelectSound();
                      setShowUrlInput((current) => !current);
                      setUrlError(null);
                    }}
                    className={`rounded-xl px-4 py-2.5 text-xs font-semibold transition-all ${
                      showUrlInput
                        ? "border border-cyan-300/40 bg-cyan-400/15 text-cyan-100"
                        : "border border-purple-300/30 bg-purple-400/10 text-purple-100 hover:bg-purple-400/18 hover:border-purple-300/50"
                    }`}
                    data-controller-focus-id="music-add-url"
                  >
                    {showUrlInput ? "✕ Cancel" : "⊕ Add from URL"}
                  </button>
                </div>

                {showUrlInput && (
                  <div className="space-y-3 rounded-xl border border-white/[0.06] bg-black/20 p-4">
                    <div>
                      <p className="text-xs font-semibold text-white">
                        Add from any yt-dlp-supported URL
                      </p>
                      <p className="mt-0.5 text-[10px] text-zinc-500">
                        The audio will be downloaded as MP3 via yt-dlp and added to your queue
                      </p>
                    </div>
                    <div className="flex gap-1.5">
                      <button
                        type="button"
                        onMouseEnter={playHoverSound}
                        onClick={() => {
                          playSelectSound();
                          setUrlMode("track");
                          setUrlResult(null);
                        }}
                        className={`rounded-lg border px-3 py-1.5 text-[10px] font-bold uppercase tracking-wide transition ${
                          urlMode === "track"
                            ? "border-cyan-300/40 bg-cyan-400/15 text-cyan-100"
                            : "border-white/10 bg-white/5 text-zinc-400 hover:bg-white/10"
                        }`}
                      >
                        Single Track
                      </button>
                      <button
                        type="button"
                        onMouseEnter={playHoverSound}
                        onClick={() => {
                          playSelectSound();
                          setUrlMode("playlist");
                          setUrlResult(null);
                        }}
                        className={`rounded-lg border px-3 py-1.5 text-[10px] font-bold uppercase tracking-wide transition ${
                          urlMode === "playlist"
                            ? "border-cyan-300/40 bg-cyan-400/15 text-cyan-100"
                            : "border-white/10 bg-white/5 text-zinc-400 hover:bg-white/10"
                        }`}
                      >
                        Playlist
                      </button>
                    </div>
                    <div className="flex gap-2">
                      <input
                        type="url"
                        placeholder={
                          urlMode === "playlist"
                            ? "https://example.com/playlist-or-collection"
                            : "https://example.com/video-or-audio"
                        }
                        value={urlInput}
                        onChange={(e) => {
                          setUrlInput(e.target.value);
                          setUrlError(null);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            void handleAddFromUrl();
                          }
                        }}
                        disabled={isAddingFromUrl}
                        className={`flex-1 rounded-lg border bg-white/5 px-3 py-2 text-xs text-white placeholder-zinc-500 outline-none transition ${
                          urlError
                            ? "border-rose-400/40 focus:border-rose-400/60"
                            : "border-white/10 focus:border-cyan-400/60"
                        }`}
                        data-controller-focus-id="music-url-input"
                      />
                      <button
                        type="button"
                        onMouseEnter={playHoverSound}
                        onClick={() => void handleAddFromUrl()}
                        disabled={isAddingFromUrl}
                        className={`rounded-lg px-4 py-2 text-xs font-semibold transition-all ${
                          isAddingFromUrl
                            ? "cursor-not-allowed border border-zinc-700/50 bg-zinc-800/50 text-zinc-500"
                            : "border border-cyan-300/40 bg-cyan-400/15 text-cyan-50 hover:bg-cyan-400/25"
                        }`}
                        data-controller-focus-id="music-url-add-button"
                      >
                        {isAddingFromUrl
                          ? urlMode === "playlist"
                            ? "Downloading..."
                            : "Downloading..."
                          : "Add"}
                      </button>
                    </div>
                    {urlResult && (
                      <p className="text-xs text-emerald-300">
                        Added {urlResult.added} track{urlResult.added !== 1 ? "s" : ""}
                        {urlResult.errors > 0 ? ` (${urlResult.errors} failed)` : ""}
                      </p>
                    )}
                    {urlError && <p className="text-xs text-rose-300">{urlError}</p>}
                  </div>
                )}

                <div className="grid gap-4 sm:grid-cols-3">
                  <div className="rounded-xl border border-white/[0.06] bg-black/20 p-4">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-semibold text-white">Volume</p>
                      <span className="text-xs font-bold text-cyan-300">{volumeDraft}%</span>
                    </div>
                    <input
                      aria-label="Music volume"
                      type="range"
                      min={0}
                      max={100}
                      step={1}
                      value={volumeDraft}
                      onChange={(event) => setVolumeDraft(Number(event.target.value))}
                      onMouseUp={() => void commitVolumeDraft()}
                      onTouchEnd={() => void commitVolumeDraft()}
                      onKeyUp={() => void commitVolumeDraft()}
                      onBlur={() => void commitVolumeDraft()}
                      className="mt-3 w-full accent-cyan-400"
                    />
                  </div>

                  <div className="rounded-xl border border-white/[0.06] bg-black/20 p-4">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-semibold text-white">Shuffle</p>
                      <button
                        type="button"
                        aria-pressed={shuffle}
                        onMouseEnter={playHoverSound}
                        onClick={() => {
                          playSelectSound();
                          void setShuffle(!shuffle);
                        }}
                        className={`rounded-lg border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide transition ${
                          shuffle
                            ? "border-cyan-300/40 bg-cyan-400/15 text-cyan-100"
                            : "border-white/10 bg-white/5 text-zinc-400 hover:bg-white/10"
                        }`}
                      >
                        {shuffle ? "On" : "Off"}
                      </button>
                    </div>
                    <p className="mt-2 text-[10px] text-zinc-500">Randomize track order</p>
                  </div>

                  <div className="rounded-xl border border-white/[0.06] bg-black/20 p-4">
                    <p className="text-xs font-semibold text-white">Loop</p>
                    <div className="mt-2 flex gap-1.5">
                      {(
                        [
                          ["queue", "Queue"],
                          ["track", "Track"],
                          ["off", "Off"],
                        ] as const satisfies ReadonlyArray<readonly [MusicLoopMode, string]>
                      ).map(([value, label]) => (
                        <button
                          key={value}
                          type="button"
                          onMouseEnter={playHoverSound}
                          onClick={() => {
                            playSelectSound();
                            void setLoopMode(value);
                          }}
                          className={`flex-1 rounded-lg border px-2 py-1 text-[10px] font-bold uppercase tracking-wide transition ${
                            loopMode === value
                              ? "border-amber-300/40 bg-amber-400/15 text-amber-100"
                              : "border-white/10 bg-white/5 text-zinc-400 hover:bg-white/10"
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="rounded-xl border border-white/[0.06] bg-black/20">
                  <div className="flex items-center justify-between p-4">
                    <button
                      type="button"
                      onMouseEnter={playHoverSound}
                      onClick={() => {
                        playSelectSound();
                        setShowQueue((current) => !current);
                      }}
                      className="flex items-center gap-3 text-left"
                      data-controller-focus-id="music-toggle-queue"
                    >
                      <div>
                        <p className="text-xs font-semibold text-white">Queue</p>
                        <p className="text-[10px] text-zinc-500">{queue.length} tracks</p>
                      </div>
                      <span className="text-xs text-zinc-400">{showQueue ? "▲" : "▼"}</span>
                    </button>
                    {queue.length > 0 && (
                      <button
                        type="button"
                        onMouseEnter={playHoverSound}
                        onClick={handleRequestClearQueue}
                        className="rounded-lg border border-rose-300/30 bg-rose-400/10 px-2.5 py-1 text-[10px] font-semibold text-rose-200 transition hover:bg-rose-400/18"
                      >
                        Clear
                      </button>
                    )}
                  </div>

                  {showQueue && (
                    <div className="max-h-[200px] overflow-y-auto border-t border-white/[0.04] px-2 py-2">
                      {queue.length === 0 ? (
                        <div className="rounded-lg border border-dashed border-white/10 px-4 py-6 text-center text-xs text-zinc-500">
                          Your queue is empty
                        </div>
                      ) : (
                        <div className="space-y-1">
                          {queue.map((entry) => {
                            const isCurrent = currentTrack?.id === entry.id;
                            return (
                              <button
                                key={entry.id}
                                type="button"
                                onClick={() => {
                                  playSelectSound();
                                  void setCurrentTrack(entry.id);
                                }}
                                className={`flex w-full items-center gap-3 rounded-lg border px-3 py-2 text-left transition ${
                                  isCurrent
                                    ? "border-cyan-300/30 bg-cyan-400/10 shadow-[0_0_16px_rgba(34,211,238,0.1)]"
                                    : "border-transparent bg-white/[0.02] hover:bg-white/[0.05]"
                                }`}
                              >
                                <span
                                  className={`text-xs ${isCurrent ? "text-cyan-300" : "text-zinc-500"}`}
                                >
                                  {isCurrent && isPlaying ? "▶" : "•"}
                                </span>
                                <div className="min-w-0 flex-1">
                                  <p
                                    className={`truncate text-xs font-medium ${isCurrent ? "text-white" : "text-zinc-300"}`}
                                  >
                                    {entry.name}
                                  </p>
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </motion.section>
          <ConfirmDialog
            isOpen={isClearConfirmOpen}
            title="Clear music playlist?"
            message="This will remove every track from the current music playlist."
            confirmLabel="Clear Playlist"
            cancelLabel="Keep Playlist"
            variant="warning"
            onConfirm={handleConfirmClearQueue}
            onCancel={handleCancelClearQueue}
          />
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
