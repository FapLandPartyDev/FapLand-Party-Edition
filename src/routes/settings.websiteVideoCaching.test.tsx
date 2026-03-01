import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WEBSITE_VIDEO_CACHE_ROOT_PATH_KEY } from "../constants/websiteVideoCacheSettings";

const mocks = vi.hoisted(() => {
  const search = { section: undefined as string | undefined };

  return {
    search,
    navigate: vi.fn((options?: { search?: { section?: string } }) => {
      if (options?.search) {
        Object.assign(search, options.search);
      }
    }),
    globalMusic: {
      enabled: true,
      queue: [],
      currentIndex: 0,
      currentTrack: null,
      isPlaying: false,
      isSuppressedByVideo: false,
      volume: 0.45,
      shuffle: false,
      loopMode: "queue" as const,
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
    },
    handy: {
      connectionKey: "",
      appApiKey: "default-app-key",
      appApiKeyOverride: "",
      isUsingDefaultAppApiKey: true,
      localIp: "",
      connected: false,
      manuallyStopped: false,
      synced: false,
      syncError: null,
      isConnecting: false,
      error: null,
      connect: vi.fn(async () => true),
      reconnect: vi.fn(async () => true),
      disconnect: vi.fn(async () => {}),
      forceStop: vi.fn(async () => {}),
      toggleManualStop: vi.fn(async () => "unavailable" as const),
      setSyncStatus: vi.fn(),
    },
    appUpdate: {
      state: {
        status: "up_to_date" as const,
        currentVersion: "0.1.2",
        latestVersion: "0.1.2",
        checkedAtIso: "2026-03-20T00:00:00.000Z",
        releasePageUrl: "https://example.com/release",
        downloadUrl: null,
        releaseNotes: null,
        publishedAtIso: null,
        canAutoUpdate: false,
        errorMessage: null,
      },
      isBusy: false,
      actionLabel: "Check Again",
      menuBadge: undefined,
      menuTone: "success" as const,
      systemMessage: "Installed build is current.",
      triggerPrimaryAction: vi.fn(async () => {}),
    },
  };
});

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => () => ({
    useSearch: () => mocks.search,
  }),
  useNavigate: () => mocks.navigate,
}));

vi.mock("../components/AnimatedBackground", () => ({
  AnimatedBackground: () => null,
}));

vi.mock("../components/MenuButton", () => ({
  MenuButton: ({ label, onClick }: { label: string; onClick?: () => void }) => (
    <button type="button" onClick={onClick}>
      {label}
    </button>
  ),
}));

vi.mock("../utils/audio", () => ({
  playHoverSound: vi.fn(),
  playSelectSound: vi.fn(),
}));

vi.mock("../services/booru", () => ({
  ensureBooruMediaCache: vi.fn(),
}));

vi.mock("../services/db", () => ({
  db: {
    install: {
      getAutoScanFolders: vi.fn(async () => []),
      clearAllData: vi.fn(async () => {}),
      addAutoScanFolderAndScan: vi.fn(),
      removeAutoScanFolder: vi.fn(),
    },
    phash: {
      getScanStatus: vi.fn(async () => null),
    },
    webVideoCache: {
      getScanStatus: vi.fn(async () => null),
      startScan: vi.fn(async () => {}),
      abortScan: vi.fn(async () => {}),
    },
  },
}));

vi.mock("../services/integrations", () => ({
  integrations: {
    listSources: vi.fn(async () => []),
    getSyncStatus: vi.fn(async () => null),
    syncNow: vi.fn(),
    createStashSource: vi.fn(),
    updateStashSource: vi.fn(),
    deleteSource: vi.fn(),
    testStashConnection: vi.fn(),
    searchStashTags: vi.fn(),
    setSourceEnabled: vi.fn(),
  },
}));

vi.mock("../services/trpc", () => ({
  trpc: {
    db: {
      openConfiguredPath: {
        mutate: vi.fn(async () => ({ path: "/tmp/web-video-cache" })),
      },
      clearAllData: {
        mutate: vi.fn(async () => {}),
      },
    },
    eroscripts: {
      getLoginStatus: {
        query: vi.fn(async () => ({
          loggedIn: false,
          username: null,
          hasCredentials: false,
        })),
      },
    },
    store: {
      getMany: {
        query: vi.fn(async ({ keys }: { keys: string[] }) => {
          const values: Record<string, unknown> = {};
          for (const key of keys) {
            if (key === "game.intermediary.loadingPrompt") values[key] = "animated gif webm score:>300";
            else if (key === "game.intermediary.loadingDurationSec") values[key] = 5;
            else if (key === "game.intermediary.returnPauseSec") values[key] = 4;
            else if (key === "videoHash.ffmpegSourcePreference") values[key] = "auto";
            else if (key === "webVideo.ytDlpBinaryPreference") values[key] = "auto";
            else if (key === "background.video.enabled") values[key] = true;
            else if (key === "game.backgroundWebsiteVideoCaching.enabled") values[key] = true;
            else if (key === "experimental.controllerSupportEnabled") values[key] = false;
            else if (key === "experimental.installWebFunscriptUrlEnabled") values[key] = false;
            else if (key === "round.video.progressBarAlwaysVisible") values[key] = false;
            else if (key === WEBSITE_VIDEO_CACHE_ROOT_PATH_KEY) values[key] = null;
            else values[key] = null;
          }
          return values;
        }),
      },
      set: {
        mutate: vi.fn(async () => {}),
      },
    },
  },
}));

vi.mock("../hooks/useGlobalMusic", () => ({
  useGlobalMusic: () => mocks.globalMusic,
}));

vi.mock("../hooks/useGameplayMoaning", () => ({
  useGameplayMoaning: () => ({
    enabled: true,
    queue: [],
    volume: 0.3,
    isAvailableForGameplay: false,
    setEnabled: vi.fn(async () => {}),
    setVolume: vi.fn(async () => {}),
    addTracks: vi.fn(async () => {}),
    addTrackFromUrl: vi.fn(async () => {}),
    addPlaylistFromUrl: vi.fn(async () => ({ addedCount: 0, errorCount: 0 })),
    removeTrack: vi.fn(async () => {}),
    moveTrack: vi.fn(async () => {}),
    clearQueue: vi.fn(async () => {}),
    previewTrack: vi.fn(async () => {}),
    stopPreview: vi.fn(),
    playRandomOneShot: vi.fn(async () => {}),
    startContinuousLoop: vi.fn(async () => {}),
    stopContinuousLoop: vi.fn(),
  }),
}));

vi.mock("../contexts/HandyContext", () => ({
  useHandy: () => mocks.handy,
}));

vi.mock("../hooks/useAppUpdate", () => ({
  useAppUpdate: () => mocks.appUpdate,
}));

import { SettingsPage } from "./settings";
import { db } from "../services/db";
import { trpc } from "../services/trpc";

describe("Settings website video caching", () => {
  beforeEach(() => {
    vi.clearAllMocks();

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
        selectMusicFiles: vi.fn(async () => []),
        selectMoaningFiles: vi.fn(async () => []),
        addMusicFromUrl: vi.fn(),
        addMusicPlaylistFromUrl: vi.fn(),
        addMoaningFromUrl: vi.fn(),
        addMoaningPlaylistFromUrl: vi.fn(),
        selectConverterFunscriptFile: vi.fn(),
        selectFpackExtractionDirectory: vi.fn(),
      },
      window: {
        isFullscreen: vi.fn(async () => false),
        setFullscreen: vi.fn(async () => false),
        toggleFullscreen: vi.fn(),
        getZoomPercent: vi.fn(async () => 100),
        zoomIn: vi.fn(async () => 110),
        zoomOut: vi.fn(async () => 90),
        resetZoom: vi.fn(async () => 100),
        subscribeToZoom: vi.fn(() => () => {}),
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
  });

  it("does not expose a background website video caching toggle anymore", async () => {
    render(<SettingsPage />);

    expect(
      screen.queryByRole("switch", { name: "Toggle Background Website Video Caching" })
    ).toBeNull();
  });

  it("offers video cache as a separate delete option", async () => {
    const clearAllData = vi.mocked(db.install.clearAllData);

    render(<SettingsPage />);

    fireEvent.click(screen.getAllByRole("button", { name: /Data & Storage/ })[0]!);
    fireEvent.click(screen.getByRole("button", { name: "Manage & Clear Data" }));

    expect(screen.getByText("Video Cache")).toBeDefined();
    expect(
      screen.getByText("Downloaded website videos and generated playback transcodes.")
    ).toBeDefined();
    expect(screen.getByText("Music Cache")).toBeDefined();
    expect(screen.getByText("Downloaded menu music and imported YouTube audio.")).toBeDefined();
    expect(screen.getByText(".fpack Extractions")).toBeDefined();
    expect(
      screen.getByText("Extracted pack contents stored for installed portable packages.")
    ).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: /Video Cache/i }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm Deletion" }));

    await waitFor(() => {
      expect(clearAllData).toHaveBeenCalledWith({
        rounds: true,
        playlists: true,
        stats: true,
        history: true,
        cache: true,
        videoCache: false,
        musicCache: true,
        fpackExtraction: true,
        settings: true,
      });
    });
  });

  it("lets the user clear music and fpack caches independently", async () => {
    const clearAllData = vi.mocked(db.install.clearAllData);

    render(<SettingsPage />);

    fireEvent.click(screen.getAllByRole("button", { name: /Data & Storage/ })[0]!);
    fireEvent.click(screen.getByRole("button", { name: "Manage & Clear Data" }));
    fireEvent.click(screen.getByRole("button", { name: /Music Cache/i }));
    fireEvent.click(screen.getByRole("button", { name: /.fpack Extractions/i }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm Deletion" }));

    await waitFor(() => {
      expect(clearAllData).toHaveBeenCalledWith({
        rounds: true,
        playlists: true,
        stats: true,
        history: true,
        cache: true,
        videoCache: true,
        musicCache: false,
        fpackExtraction: false,
        settings: true,
      });
    });
  });

  it("lets the user choose a custom website video cache folder", async () => {
    const setMutate = vi.mocked(trpc.store.set.mutate);
    vi.mocked(window.electronAPI.dialog.selectWebsiteVideoCacheDirectory).mockResolvedValue(
      "/tmp/custom-web-cache"
    );

    render(<SettingsPage />);

    fireEvent.click(screen.getAllByRole("button", { name: /Data & Storage/ })[0]!);
    fireEvent.click(screen.getAllByRole("button", { name: "Choose Folder" })[1]!);

    await waitFor(() => {
      expect(window.electronAPI.dialog.selectWebsiteVideoCacheDirectory).toHaveBeenCalled();
      expect(setMutate).toHaveBeenCalledWith({
        key: WEBSITE_VIDEO_CACHE_ROOT_PATH_KEY,
        value: "/tmp/custom-web-cache",
      });
    });
  });

  it("can reset the website video cache folder back to the default location", async () => {
    vi.mocked(trpc.store.get.query).mockImplementation(async ({ key }: { key: string }) => {
      if (key === WEBSITE_VIDEO_CACHE_ROOT_PATH_KEY) return "/tmp/custom-web-cache";
      return null;
    });
    const setMutate = vi.mocked(trpc.store.set.mutate);

    render(<SettingsPage />);

    fireEvent.click(screen.getAllByRole("button", { name: /Data & Storage/ })[0]!);
    fireEvent.click(screen.getAllByRole("button", { name: "Use Default" })[1]!);

    await waitFor(() => {
      expect(setMutate).toHaveBeenCalledWith({
        key: WEBSITE_VIDEO_CACHE_ROOT_PATH_KEY,
        value: null,
      });
    });
  });

  it("opens the current website video cache folder", async () => {
    const openConfiguredPathMutate = vi.mocked(trpc.db.openConfiguredPath.mutate);

    render(<SettingsPage />);

    fireEvent.click(screen.getAllByRole("button", { name: /Data & Storage/ })[0]!);
    await waitFor(() => {
      expect(screen.getAllByRole("button", { name: "Open Current Folder" })[1]).toBeDefined();
    });
    fireEvent.click(screen.getAllByRole("button", { name: "Open Current Folder" })[1]!);

    await waitFor(() => {
      expect(openConfiguredPathMutate).toHaveBeenCalledWith({
        target: "website-video-cache",
      });
    });
  });
});
