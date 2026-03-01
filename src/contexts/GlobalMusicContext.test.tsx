import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { useEffect, useRef } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MusicLoopMode } from "../constants/musicSettings";
import { ForegroundMediaProvider, useForegroundMedia } from "./ForegroundMediaContext";
import { GlobalMusicProvider } from "./GlobalMusicContext";
import { useGlobalMusic } from "../hooks/useGlobalMusic";

const mocks = vi.hoisted(() => ({
  getQuery: vi.fn(),
  setMutate: vi.fn(),
  overrideActionsStable: vi.fn(),
}));

vi.mock("../services/trpc", () => ({
  trpc: {
    store: {
      get: {
        query: mocks.getQuery,
      },
      set: {
        mutate: mocks.setMutate,
      },
    },
  },
}));

class FakeAudio extends EventTarget {
  src = "";
  currentTime = 0;
  duration = 180;
  paused = true;
  volume = 1;
  preload = "auto";
  play = vi.fn(async () => {
    this.paused = false;
    this.dispatchEvent(new Event("play"));
  });
  pause = vi.fn(() => {
    const wasPaused = this.paused;
    this.paused = true;
    if (!wasPaused) {
      this.dispatchEvent(new Event("pause"));
    }
  });
  load = vi.fn(() => {
    this.dispatchEvent(new Event("loadedmetadata"));
  });
  removeAttribute = vi.fn((name: string) => {
    if (name === "src") this.src = "";
  });
}

const audioInstances: FakeAudio[] = [];

function installAudioMock() {
  audioInstances.length = 0;
  vi.stubGlobal(
    "Audio",
    vi.fn(function (this: FakeAudio) {
      const audio = new FakeAudio();
      audioInstances.push(audio);
      return audio;
    })
  );
}

function Suppressor() {
  const media = useForegroundMedia();
  return (
    <div>
      <button type="button" onClick={() => media.register("video")}>
        register
      </button>
      <button type="button" onClick={() => media.setPlaying("video", true)}>
        play-video
      </button>
      <button type="button" onClick={() => media.setPlaying("video", false)}>
        pause-video
      </button>
    </div>
  );
}

function Consumer() {
  const music = useGlobalMusic();
  const initialStartOverrideRef = useRef(music.startTemporaryQueueOverride);
  const initialStopOverrideRef = useRef(music.stopTemporaryQueueOverride);

  useEffect(() => {
    mocks.overrideActionsStable(
      initialStartOverrideRef.current === music.startTemporaryQueueOverride &&
        initialStopOverrideRef.current === music.stopTemporaryQueueOverride
    );
  }, [music.startTemporaryQueueOverride, music.stopTemporaryQueueOverride]);

  return (
    <div>
      <div data-testid="track">{music.currentTrack?.name ?? "none"}</div>
      <div data-testid="playing">{String(music.isPlaying)}</div>
      <div data-testid="suppressed">{String(music.isSuppressedByVideo)}</div>
      <div data-testid="loop-mode">{music.loopMode}</div>
      <button type="button" onClick={() => void music.pause()}>
        pause
      </button>
      <button type="button" onClick={() => void music.play()}>
        play
      </button>
      <button type="button" onClick={() => void music.next()}>
        next
      </button>
      <button type="button" onClick={() => void music.setLoopMode("off")}>
        loop-off
      </button>
      <button
        type="button"
        onClick={() =>
          music.startTemporaryQueueOverride({
            id: "test-override",
            tracks: [
              { id: "pm1", filePath: "/playlist/track1.mp3", name: "Playlist Track 1" },
              { id: "pm2", filePath: "/playlist/track2.mp3", name: "Playlist Track 2" },
            ],
            loop: true,
          })
        }
      >
        start-override
      </button>
      <button type="button" onClick={() => music.stopTemporaryQueueOverride("test-override")}>
        stop-override
      </button>
    </div>
  );
}

function renderProviders() {
  return render(
    <ForegroundMediaProvider>
      <GlobalMusicProvider>
        <Suppressor />
        <Consumer />
      </GlobalMusicProvider>
    </ForegroundMediaProvider>
  );
}

describe("GlobalMusicContext", () => {
  beforeEach(() => {
    cleanup();
    installAudioMock();
    window.electronAPI = {
      file: {
        convertFileSrc: vi.fn((filePath: string) => `app://media/${encodeURIComponent(filePath)}`),
      },
      dialog: {
        selectFolders: vi.fn(),
        selectInstallImportFile: vi.fn(),
        selectPlaylistImportFile: vi.fn(),
        selectPlaylistExportPath: vi.fn(),
        selectPlaylistExportDirectory: vi.fn(),
        selectWebsiteVideoCacheDirectory: vi.fn(),
        selectEroScriptsCacheDirectory: vi.fn(),
        selectMusicCacheDirectory: vi.fn(),
        selectMoaningCacheDirectory: vi.fn(),
        selectConverterVideoFile: vi.fn(),
        selectMapBackgroundFile: vi.fn(),
        selectMusicFiles: vi.fn(),
        selectMoaningFiles: vi.fn(),
        addMusicFromUrl: vi.fn(),
        addMusicPlaylistFromUrl: vi.fn(),
        addMoaningFromUrl: vi.fn(),
        addMoaningPlaylistFromUrl: vi.fn(),
        selectConverterFunscriptFile: vi.fn(),
        selectFpackExtractionDirectory: vi.fn(),
      },
      window: {
        isFullscreen: vi.fn(),
        setFullscreen: vi.fn(),
        toggleFullscreen: vi.fn(),
        close: vi.fn(),
      },
      updates: {
        subscribe: vi.fn(() => () => {}),
      },
      appOpen: {
        consumePendingFiles: vi.fn(async () => []),
        subscribe: vi.fn(() => () => {}),
      },
      eroscripts: {
        subscribeToLoginStatus: vi.fn(() => () => {}),
      },
    };
    mocks.setMutate.mockResolvedValue(undefined);
    mocks.overrideActionsStable.mockClear();
    const values = new Map<string, unknown>([
      ["music.enabled", true],
      [
        "music.queue",
        [
          { id: "t1", filePath: "/music/one.mp3", name: "one.mp3" },
          { id: "t2", filePath: "/music/two.mp3", name: "two.mp3" },
        ],
      ],
      ["music.volume", 0.5],
      ["music.shuffle", false],
      ["music.loopMode", "queue" satisfies MusicLoopMode],
      ["music.currentIndex", 0],
    ]);
    mocks.getQuery.mockImplementation(async ({ key }: { key: string }) => values.get(key));
  });

  it("loads the persisted queue and starts playback when enabled", async () => {
    renderProviders();

    await waitFor(() => {
      expect(screen.getByTestId("track").textContent).toBe("one.mp3");
      expect(audioInstances[0]?.play).toHaveBeenCalled();
    });
  });

  it("defaults to enabled when no persisted music toggle exists", async () => {
    mocks.getQuery.mockImplementation(async ({ key }: { key: string }) => {
      if (key === "music.enabled") return null;
      if (key === "music.queue") {
        return [{ id: "t1", filePath: "/music/one.mp3", name: "one.mp3" }];
      }
      if (key === "music.volume") return 0.5;
      if (key === "music.shuffle") return false;
      if (key === "music.loopMode") return "queue" satisfies MusicLoopMode;
      if (key === "music.currentIndex") return 0;
      return null;
    });

    renderProviders();

    await waitFor(() => {
      expect(screen.getByTestId("track").textContent).toBe("one.mp3");
      expect(audioInstances[0]?.play).toHaveBeenCalled();
    });
  });

  it("pauses for foreground video and resumes from the same timestamp", async () => {
    renderProviders();

    await waitFor(() => {
      expect(audioInstances[0]?.play).toHaveBeenCalledTimes(1);
    });

    audioInstances[0]!.currentTime = 37;

    act(() => {
      screen.getByText("register").click();
      screen.getByText("play-video").click();
    });

    expect(audioInstances[0]!.pause).toHaveBeenCalled();
    expect(screen.getByTestId("suppressed").textContent).toBe("true");

    act(() => {
      screen.getByText("pause-video").click();
    });

    await waitFor(() => {
      expect(audioInstances[0]!.play).toHaveBeenCalledTimes(2);
    });
    expect(audioInstances[0]!.currentTime).toBe(37);
  });

  it("does not auto-resume after a manual pause", async () => {
    renderProviders();

    await waitFor(() => {
      expect(audioInstances[0]?.play).toHaveBeenCalledTimes(1);
    });

    act(() => {
      screen.getByText("pause").click();
      screen.getByText("register").click();
      screen.getByText("play-video").click();
      screen.getByText("pause-video").click();
    });

    await waitFor(() => {
      expect(audioInstances[0]!.play).toHaveBeenCalledTimes(1);
    });
  });

  it("advances and stops at the end when loop mode is off", async () => {
    renderProviders();

    await waitFor(() => {
      expect(audioInstances[0]?.play).toHaveBeenCalledTimes(1);
    });

    act(() => {
      screen.getByText("loop-off").click();
    });
    act(() => {
      audioInstances[0]!.dispatchEvent(new Event("ended"));
    });

    await waitFor(() => {
      expect(screen.getByTestId("track").textContent).toBe("two.mp3");
    });

    act(() => {
      audioInstances[0]!.dispatchEvent(new Event("ended"));
    });

    expect(screen.getByTestId("playing").textContent).toBe("false");
  });

  it("temporary override plays override queue without persisting it", async () => {
    renderProviders();

    await waitFor(() => {
      expect(screen.getByTestId("track").textContent).toBe("one.mp3");
    });

    act(() => {
      screen.getByText("start-override").click();
    });

    await waitFor(() => {
      expect(screen.getByTestId("track").textContent).toBe("Playlist Track 1");
    });
    expect(mocks.overrideActionsStable).toHaveBeenLastCalledWith(true);

    expect(mocks.setMutate).not.toHaveBeenCalledWith(
      expect.objectContaining({ key: "music.queue" })
    );
  });

  it("does not persist current index changes while a temporary override is active", async () => {
    renderProviders();

    await waitFor(() => {
      expect(screen.getByTestId("track").textContent).toBe("one.mp3");
    });

    act(() => {
      screen.getByText("start-override").click();
    });

    await waitFor(() => {
      expect(screen.getByTestId("track").textContent).toBe("Playlist Track 1");
    });

    mocks.setMutate.mockClear();

    act(() => {
      screen.getByText("next").click();
    });

    await waitFor(() => {
      expect(screen.getByTestId("track").textContent).toBe("Playlist Track 2");
    });

    expect(mocks.setMutate).not.toHaveBeenCalledWith(
      expect.objectContaining({ key: "music.currentIndex" })
    );
  });

  it("override loops by default", async () => {
    renderProviders();

    await waitFor(() => {
      expect(screen.getByTestId("track").textContent).toBe("one.mp3");
    });

    act(() => {
      screen.getByText("start-override").click();
    });

    await waitFor(() => {
      expect(screen.getByTestId("track").textContent).toBe("Playlist Track 1");
    });

    act(() => {
      audioInstances[0]!.dispatchEvent(new Event("ended"));
    });

    await waitFor(() => {
      expect(screen.getByTestId("track").textContent).toBe("Playlist Track 2");
    });

    act(() => {
      audioInstances[0]!.dispatchEvent(new Event("ended"));
    });

    await waitFor(() => {
      expect(screen.getByTestId("track").textContent).toBe("Playlist Track 1");
    });
  });

  it("stopping override restores prior queue and current track", async () => {
    renderProviders();

    await waitFor(() => {
      expect(screen.getByTestId("track").textContent).toBe("one.mp3");
    });

    act(() => {
      screen.getByText("start-override").click();
    });

    await waitFor(() => {
      expect(screen.getByTestId("track").textContent).toBe("Playlist Track 1");
    });

    act(() => {
      screen.getByText("stop-override").click();
    });

    await waitFor(() => {
      expect(screen.getByTestId("track").textContent).toBe("one.mp3");
    });
  });

  it("stopping override resumes prior playback only if it was playing", async () => {
    renderProviders();

    await waitFor(() => {
      expect(audioInstances[0]?.play).toHaveBeenCalledTimes(1);
    });

    act(() => {
      screen.getByText("pause").click();
    });

    act(() => {
      screen.getByText("start-override").click();
    });

    await waitFor(() => {
      expect(screen.getByTestId("track").textContent).toBe("Playlist Track 1");
    });

    const playCountBeforeStop = audioInstances[0]!.play.mock.calls.length;

    act(() => {
      screen.getByText("stop-override").click();
    });

    await waitFor(() => {
      expect(screen.getByTestId("track").textContent).toBe("one.mp3");
    });

    expect(audioInstances[0]!.play.mock.calls.length).toBe(playCountBeforeStop);
  });
});
