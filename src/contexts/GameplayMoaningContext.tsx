import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  clampMoaningVolume,
  DEFAULT_MOANING_ENABLED,
  DEFAULT_MOANING_VOLUME,
  MOANING_ENABLED_KEY,
  MOANING_QUEUE_KEY,
  MOANING_VOLUME_KEY,
  normalizeMoaningQueue,
  type MoaningQueueEntry,
} from "../constants/moaningSettings";
import {
  SFW_MODE_ENABLED_EVENT,
  SFW_MODE_ENABLED_KEY,
  DEFAULT_SFW_MODE_ENABLED,
} from "../constants/experimentalFeatures";
import { trpc } from "../services/trpc";
import { useMcpSettingsRevision } from "../mcp/useMcpSettingsRevision";

type GameplayMoaningState = {
  enabled: boolean;
  queue: MoaningQueueEntry[];
  volume: number;
  isAvailableForGameplay: boolean;
};

type GameplayMoaningActions = {
  setEnabled: (next: boolean) => Promise<void>;
  setVolume: (next: number) => Promise<void>;
  addTracks: (filePaths: string[]) => Promise<void>;
  addTrackFromUrl: (url: string) => Promise<void>;
  addPlaylistFromUrl: (url: string) => Promise<{ addedCount: number; errorCount: number }>;
  removeTrack: (id: string) => Promise<void>;
  moveTrack: (id: string, direction: "up" | "down") => Promise<void>;
  clearQueue: () => Promise<void>;
  previewTrack: (id: string) => Promise<void>;
  stopPreview: () => void;
  playRandomOneShot: () => Promise<void>;
  startContinuousLoop: () => Promise<void>;
  stopContinuousLoop: () => void;
};

type GameplayMoaningContextValue = GameplayMoaningState & GameplayMoaningActions;

const GameplayMoaningContext = createContext<GameplayMoaningContextValue | null>(null);

function getTrackName(filePath: string): string {
  const normalized = filePath.replace(/\\/g, "/");
  return normalized.split("/").pop()?.trim() || "Unknown Track";
}

function buildQueueEntries(filePaths: string[]): MoaningQueueEntry[] {
  return filePaths
    .map((filePath) => filePath.trim())
    .filter((filePath) => filePath.length > 0)
    .map((filePath, index) => ({
      id: `${Date.now()}-moaning-${index}-${filePath}`,
      filePath,
      name: getTrackName(filePath),
    }));
}

function resolveSfwModeFromStorage(): boolean {
  if (typeof window === "undefined") return DEFAULT_SFW_MODE_ENABLED;
  const raw = window.localStorage.getItem(SFW_MODE_ENABLED_KEY);
  if (raw === "true") return true;
  if (raw === "false") return false;
  return DEFAULT_SFW_MODE_ENABLED;
}

export function GameplayMoaningProvider({ children }: { children: React.ReactNode }) {
  const mcpSettingsRevision = useMcpSettingsRevision("moaning.");
  const [enabled, setEnabledState] = useState(DEFAULT_MOANING_ENABLED);
  const [queue, setQueue] = useState<MoaningQueueEntry[]>([]);
  const [volume, setVolumeState] = useState(DEFAULT_MOANING_VOLUME);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [sfwModeEnabled, setSfwModeEnabled] = useState(resolveSfwModeFromStorage);

  const oneShotAudioRef = useRef<HTMLAudioElement | null>(null);
  const loopAudioRef = useRef<HTMLAudioElement | null>(null);
  const activeLoopTrackPathRef = useRef<string | null>(null);
  const lastOneShotTrackPathRef = useRef<string | null>(null);
  const lastLoopTrackPathRef = useRef<string | null>(null);

  const isAvailableForGameplay = enabled && queue.length > 0 && !sfwModeEnabled;

  const persist = useCallback(async (key: string, value: unknown) => {
    await trpc.store.set.mutate({ key, value });
  }, []);

  const pickRandomTrack = useCallback(
    (lastTrackPath: string | null): MoaningQueueEntry | null => {
      if (queue.length === 0) return null;
      const candidates =
        queue.length > 1 && lastTrackPath
          ? queue.filter((entry) => entry.filePath !== lastTrackPath)
          : queue;
      const source = candidates.length > 0 ? candidates : queue;
      return source[Math.floor(Math.random() * source.length)] ?? null;
    },
    [queue]
  );

  const startContinuousLoop = useCallback(async () => {
    const audio = loopAudioRef.current;
    if (!audio || !isAvailableForGameplay) return;
    const nextTrack = pickRandomTrack(lastLoopTrackPathRef.current);
    if (!nextTrack) return;
    lastLoopTrackPathRef.current = nextTrack.filePath;
    activeLoopTrackPathRef.current = nextTrack.filePath;
    audio.src = window.electronAPI.file.convertFileSrc(nextTrack.filePath);
    audio.load();
    try {
      await audio.play();
    } catch (error) {
      console.warn("Failed to start continuous moaning playback", error);
    }
  }, [isAvailableForGameplay, pickRandomTrack]);

  const stopContinuousLoop = useCallback(() => {
    const audio = loopAudioRef.current;
    activeLoopTrackPathRef.current = null;
    if (!audio) return;
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
  }, []);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      trpc.store.get.query({ key: MOANING_ENABLED_KEY }),
      trpc.store.get.query({ key: MOANING_QUEUE_KEY }),
      trpc.store.get.query({ key: MOANING_VOLUME_KEY }),
    ])
      .then(([rawEnabled, rawQueue, rawVolume]) => {
        if (cancelled) return;
        setEnabledState(typeof rawEnabled === "boolean" ? rawEnabled : DEFAULT_MOANING_ENABLED);
        setQueue(normalizeMoaningQueue(rawQueue));
        setVolumeState(clampMoaningVolume(rawVolume));
        setHasLoaded(true);
      })
      .catch((error) => {
        console.warn("Failed to load moaning settings", error);
        if (!cancelled) setHasLoaded(true);
      });

    return () => {
      cancelled = true;
    };
  }, [mcpSettingsRevision]);

  useEffect(() => {
    const handleSfwChange = (event: Event) => {
      const detail = (event as CustomEvent<boolean>).detail;
      setSfwModeEnabled(Boolean(detail));
    };
    window.addEventListener(SFW_MODE_ENABLED_EVENT, handleSfwChange);
    return () => {
      window.removeEventListener(SFW_MODE_ENABLED_EVENT, handleSfwChange);
    };
  }, []);

  useEffect(() => {
    const oneShotAudio = new Audio();
    oneShotAudio.preload = "auto";
    oneShotAudio.volume = DEFAULT_MOANING_VOLUME;
    oneShotAudioRef.current = oneShotAudio;

    const loopAudio = new Audio();
    loopAudio.preload = "auto";
    loopAudio.volume = DEFAULT_MOANING_VOLUME;
    loopAudioRef.current = loopAudio;

    const handleLoopEnded = () => {
      if (!activeLoopTrackPathRef.current) return;
      void startContinuousLoop();
    };
    loopAudio.addEventListener("ended", handleLoopEnded);

    return () => {
      oneShotAudio.pause();
      oneShotAudio.removeAttribute("src");
      oneShotAudio.load();
      loopAudio.pause();
      loopAudio.removeAttribute("src");
      loopAudio.load();
      loopAudio.removeEventListener("ended", handleLoopEnded);
      oneShotAudioRef.current = null;
      loopAudioRef.current = null;
    };
  }, [startContinuousLoop]);

  useEffect(() => {
    if (!hasLoaded) return;
    oneShotAudioRef.current?.pause();
    stopContinuousLoop();
  }, [hasLoaded, stopContinuousLoop, sfwModeEnabled]);

  useEffect(() => {
    if (oneShotAudioRef.current) oneShotAudioRef.current.volume = volume;
    if (loopAudioRef.current) loopAudioRef.current.volume = volume;
  }, [volume]);

  useEffect(() => {
    if (queue.some((entry) => entry.filePath === activeLoopTrackPathRef.current)) return;
    stopContinuousLoop();
  }, [queue, stopContinuousLoop]);

  const setEnabled = useCallback(
    async (next: boolean) => {
      setEnabledState(next);
      await persist(MOANING_ENABLED_KEY, next);
      if (!next) {
        oneShotAudioRef.current?.pause();
        stopContinuousLoop();
      }
    },
    [persist, stopContinuousLoop]
  );

  const setVolume = useCallback(
    async (next: number) => {
      const normalized = clampMoaningVolume(next);
      setVolumeState(normalized);
      await persist(MOANING_VOLUME_KEY, normalized);
    },
    [persist]
  );

  const setAndPersistQueue = useCallback(
    async (nextQueue: MoaningQueueEntry[]) => {
      setQueue(nextQueue);
      await persist(MOANING_QUEUE_KEY, nextQueue);
    },
    [persist]
  );

  const addTracks = useCallback(
    async (filePaths: string[]) => {
      const nextEntries = buildQueueEntries(filePaths).filter(
        (entry) => !queue.some((existing) => existing.filePath === entry.filePath)
      );
      if (nextEntries.length === 0) return;
      await setAndPersistQueue([...queue, ...nextEntries]);
    },
    [queue, setAndPersistQueue]
  );

  const addTrackFromUrl = useCallback(
    async (url: string) => {
      const result = await window.electronAPI.dialog.addMoaningFromUrl(url);
      const trimmedUrl = url.trim();
      const newEntry: MoaningQueueEntry = {
        id: `${Date.now()}-moaning-url-${trimmedUrl}`,
        filePath: result.filePath,
        name: result.title,
        sourceUrl: trimmedUrl,
      };
      if (
        queue.some(
          (existing) => existing.sourceUrl === trimmedUrl || existing.filePath === result.filePath
        )
      ) {
        return;
      }
      await setAndPersistQueue([...queue, newEntry]);
    },
    [queue, setAndPersistQueue]
  );

  const addPlaylistFromUrl = useCallback(
    async (url: string): Promise<{ addedCount: number; errorCount: number }> => {
      const result = await window.electronAPI.dialog.addMoaningPlaylistFromUrl(url);
      const trimmedUrl = url.trim();
      const newEntries: MoaningQueueEntry[] = result.tracks
        .filter((track) => !queue.some((existing) => existing.filePath === track.filePath))
        .map((track, index) => ({
          id: `${Date.now()}-moaning-playlist-${trimmedUrl}-${index}`,
          filePath: track.filePath,
          name: track.title,
          sourceUrl: trimmedUrl,
        }));
      if (newEntries.length === 0) {
        return { addedCount: 0, errorCount: result.errors.length };
      }
      await setAndPersistQueue([...queue, ...newEntries]);
      return { addedCount: newEntries.length, errorCount: result.errors.length };
    },
    [queue, setAndPersistQueue]
  );

  const removeTrack = useCallback(
    async (id: string) => {
      await setAndPersistQueue(queue.filter((entry) => entry.id !== id));
    },
    [queue, setAndPersistQueue]
  );

  const moveTrack = useCallback(
    async (id: string, direction: "up" | "down") => {
      const index = queue.findIndex((entry) => entry.id === id);
      if (index < 0) return;
      const swapIndex = direction === "up" ? index - 1 : index + 1;
      if (swapIndex < 0 || swapIndex >= queue.length) return;
      const nextQueue = [...queue];
      [nextQueue[index], nextQueue[swapIndex]] = [nextQueue[swapIndex]!, nextQueue[index]!];
      await setAndPersistQueue(nextQueue);
    },
    [queue, setAndPersistQueue]
  );

  const clearQueue = useCallback(async () => {
    oneShotAudioRef.current?.pause();
    stopContinuousLoop();
    await setAndPersistQueue([]);
  }, [setAndPersistQueue, stopContinuousLoop]);

  const previewTrack = useCallback(
    async (id: string) => {
      const audio = oneShotAudioRef.current;
      if (!audio || sfwModeEnabled) return;
      const track = queue.find((entry) => entry.id === id);
      if (!track) return;
      lastOneShotTrackPathRef.current = track.filePath;
      audio.pause();
      audio.src = window.electronAPI.file.convertFileSrc(track.filePath);
      audio.currentTime = 0;
      audio.load();
      try {
        await audio.play();
      } catch (error) {
        console.warn("Failed to preview moaning track", error);
      }
    },
    [queue, sfwModeEnabled]
  );

  const stopPreview = useCallback(() => {
    const audio = oneShotAudioRef.current;
    if (!audio) return;
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
  }, []);

  const playRandomOneShot = useCallback(async () => {
    const audio = oneShotAudioRef.current;
    if (!audio || !isAvailableForGameplay) return;
    const nextTrack = pickRandomTrack(lastOneShotTrackPathRef.current);
    if (!nextTrack) return;
    lastOneShotTrackPathRef.current = nextTrack.filePath;
    audio.pause();
    audio.src = window.electronAPI.file.convertFileSrc(nextTrack.filePath);
    audio.currentTime = 0;
    audio.load();
    try {
      await audio.play();
    } catch (error) {
      console.warn("Failed to play moaning one-shot", error);
    }
  }, [isAvailableForGameplay, pickRandomTrack]);

  const value = useMemo<GameplayMoaningContextValue>(
    () => ({
      enabled,
      queue,
      volume,
      isAvailableForGameplay,
      setEnabled,
      setVolume,
      addTracks,
      addTrackFromUrl,
      addPlaylistFromUrl,
      removeTrack,
      moveTrack,
      clearQueue,
      previewTrack,
      stopPreview,
      playRandomOneShot,
      startContinuousLoop,
      stopContinuousLoop,
    }),
    [
      addPlaylistFromUrl,
      addTrackFromUrl,
      addTracks,
      clearQueue,
      enabled,
      isAvailableForGameplay,
      moveTrack,
      playRandomOneShot,
      previewTrack,
      queue,
      removeTrack,
      setEnabled,
      setVolume,
      startContinuousLoop,
      stopPreview,
      stopContinuousLoop,
      volume,
    ]
  );

  return (
    <GameplayMoaningContext.Provider value={value}>{children}</GameplayMoaningContext.Provider>
  );
}

export function useGameplayMoaningContext() {
  const context = useContext(GameplayMoaningContext);
  if (!context) {
    throw new Error("useGameplayMoaningContext must be used within a GameplayMoaningProvider.");
  }
  return context;
}
