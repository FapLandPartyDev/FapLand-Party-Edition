import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GlobalMusicOverlay } from "./GlobalMusicOverlay";

const mocks = vi.hoisted(() => ({
  globalMusic: {
    enabled: true,
    queue: [
      { id: "track-1", filePath: "/music/one.mp3", name: "one.mp3" },
      { id: "track-2", filePath: "/music/two.mp3", name: "two.mp3" },
    ],
    currentIndex: 0,
    currentTrack: { id: "track-1", filePath: "/music/one.mp3", name: "one.mp3" },
    isPlaying: false,
    isSuppressedByVideo: false,
    volume: 0.45,
    shuffle: false,
    loopMode: "queue" as const,
    currentTime: 45,
    duration: 180,
    setEnabled: vi.fn(async () => {}),
    addTracks: vi.fn(async () => {}),
    removeTrack: vi.fn(async () => {}),
    moveTrack: vi.fn(async () => {}),
    clearQueue: vi.fn(async () => {}),
    play: vi.fn(async () => {}),
    pause: vi.fn(),
    next: vi.fn(async () => {}),
    previous: vi.fn(async () => {}),
    setCurrentTrack: vi.fn(async () => {}),
    setVolume: vi.fn(async () => {}),
    setShuffle: vi.fn(async () => {}),
    setLoopMode: vi.fn(async () => {}),
    seek: vi.fn(),
  },
}));

vi.mock("../hooks/useGlobalMusic", () => ({
  useGlobalMusic: () => mocks.globalMusic,
}));

vi.mock("../utils/audio", () => ({
  playHoverSound: vi.fn(),
  playSelectSound: vi.fn(),
}));

describe("GlobalMusicOverlay", () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    Object.assign(mocks.globalMusic, {
      enabled: true,
      queue: [
        { id: "track-1", filePath: "/music/one.mp3", name: "one.mp3" },
        { id: "track-2", filePath: "/music/two.mp3", name: "two.mp3" },
      ],
      currentIndex: 0,
      currentTrack: { id: "track-1", filePath: "/music/one.mp3", name: "one.mp3" },
      isPlaying: false,
      isSuppressedByVideo: false,
      volume: 0.45,
      shuffle: false,
      loopMode: "queue",
      currentTime: 45,
      duration: 180,
    });
    window.electronAPI = {
      file: {
        convertFileSrc: vi.fn(),
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
        selectMusicFiles: vi.fn(async () => ["/music/three.mp3"]),
        selectMoaningFiles: vi.fn(async () => []),
        addMusicFromUrl: vi.fn(async () => ({
          filePath: "/music-cache/test/audio.mp3",
          title: "Test Track",
        })),
        addMusicPlaylistFromUrl: vi.fn(async () => ({
          playlistTitle: "Test Playlist",
          totalTracks: 2,
          tracks: [
            { filePath: "/music-cache/test/track1.mp3", title: "Track 1" },
            { filePath: "/music-cache/test/track2.mp3", title: "Track 2" },
          ],
          errors: [],
        })),
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
        consumePendingFiles: vi.fn(),
        subscribe: vi.fn(() => () => {}),
      },
      eroscripts: {
        subscribeToLoginStatus: vi.fn(() => () => {}),
      },
    };
  });

  it("opens from Ctrl+M and forwards play", async () => {
    render(<GlobalMusicOverlay />);

    fireEvent.keyDown(window, { key: "m", ctrlKey: true });

    expect(screen.getByRole("dialog", { name: "Global music controls" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Play/ }));

    await waitFor(() => {
      expect(mocks.globalMusic.play).toHaveBeenCalled();
    });
  });

  it("closes when Ctrl+M is pressed again", async () => {
    render(<GlobalMusicOverlay />);

    fireEvent.keyDown(window, { key: "m", ctrlKey: true });
    expect(screen.getByRole("dialog", { name: "Global music controls" })).toBeTruthy();

    fireEvent.keyDown(window, { key: "m", ctrlKey: true });
    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Global music controls" })).toBeNull();
    });
  });

  it("ignores the shortcut inside editable fields", () => {
    render(
      <div>
        <input aria-label="editor" />
        <GlobalMusicOverlay />
      </div>
    );

    const input = screen.getByLabelText("editor");
    input.focus();
    fireEvent.keyDown(window, { key: "m", ctrlKey: true });

    expect(screen.queryByRole("dialog", { name: "Global music controls" })).toBeNull();
  });

  it("shows the suppression state and blocks play while video is active", async () => {
    mocks.globalMusic.isSuppressedByVideo = true;

    render(<GlobalMusicOverlay />);
    fireEvent.keyDown(window, { key: "m", ctrlKey: true });

    expect(screen.getByText("Blocked by video")).toBeTruthy();

    const playButton = screen.getByRole("button", { name: /Play/ });
    expect(playButton.hasAttribute("disabled")).toBe(true);

    fireEvent.click(playButton);

    await waitFor(() => {
      expect(mocks.globalMusic.play).not.toHaveBeenCalled();
    });
  });

  it("only persists volume when interaction completes", async () => {
    render(<GlobalMusicOverlay />);
    fireEvent.keyDown(window, { key: "m", ctrlKey: true });

    const volume = screen.getByLabelText("Music volume");
    fireEvent.change(volume, { target: { value: "72" } });

    expect(mocks.globalMusic.setVolume).not.toHaveBeenCalled();

    fireEvent.mouseUp(volume);

    await waitFor(() => {
      expect(mocks.globalMusic.setVolume).toHaveBeenCalledWith(0.72);
    });
  });

  it("confirms before clearing the overlay playlist", async () => {
    render(<GlobalMusicOverlay />);
    fireEvent.keyDown(window, { key: "m", ctrlKey: true });

    fireEvent.click(screen.getByRole("button", { name: "Clear" }));

    expect(mocks.globalMusic.clearQueue).not.toHaveBeenCalled();
    expect(screen.getByText("Clear music playlist?")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Clear Playlist" }));

    await waitFor(() => {
      expect(mocks.globalMusic.clearQueue).toHaveBeenCalled();
    });
  });
});
