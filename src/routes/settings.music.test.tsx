import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
    gameplayMoaning: {
      enabled: true,
      queue: [
        { id: "moan-1", filePath: "/moans/one.mp3", name: "one.mp3" },
        { id: "moan-2", filePath: "/moans/two.mp3", name: "two.mp3" },
      ],
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
    },
    handy: {
      provider: "thehandy" as "thehandy" | "intiface",
      setProvider: vi.fn(async (provider: "thehandy" | "intiface") => {
        mocks.handy.provider = provider;
      }),
      connectionKey: "",
      appApiKey: "default-app-key",
      appApiKeyOverride: "",
      isUsingDefaultAppApiKey: true,
      localIp: "",
      intifaceWebsocketUrl: "ws://127.0.0.1:12345",
      intifaceDeviceName: null as string | null,
      intifaceDeviceIndex: null as number | null,
      offsetMs: 0,
      strokeMin: 0,
      strokeMax: 1,
      strokePercent: 100,
      strokeLoading: false,
      strokeError: null as string | null,
      connected: false,
      manuallyStopped: false,
      synced: false,
      syncError: null as string | null,
      testDeviceStarting: false,
      testDeviceRunning: false,
      testDeviceStartedAtMs: null as number | null,
      testDeviceError: null as string | null,
      isConnecting: false,
      error: null as string | null,
      connect: vi.fn(async () => true),
      connectIntiface: vi.fn(async () => true),
      reconnect: vi.fn(async () => true),
      disconnect: vi.fn(async () => {}),
      forceStop: vi.fn(async () => {}),
      adjustOffset: vi.fn(async (deltaMs: number) => deltaMs),
      resetOffset: vi.fn(async () => {}),
      startTestDevice: vi.fn(async () => {}),
      stopTestDevice: vi.fn(async () => {}),
      refreshStroke: vi.fn(async () => {}),
      setStrokePercent: vi.fn(async () => {}),
      setStrokeBounds: vi.fn(async () => {}),
      resetStroke: vi.fn(async () => {}),
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
  clearBooruMediaCache: vi.fn(),
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
      startScanManual: vi.fn(async () => {}),
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
    binaries: {
      getResolvedVersions: {
        query: vi.fn(async () => ({
          ffmpeg: {
            tool: "ffmpeg",
            preference: "auto",
            source: "bundled",
            path: "/bundle/ffmpeg",
            version: "7.1.0",
            error: null,
          },
          ffprobe: {
            tool: "ffprobe",
            preference: "auto",
            source: "bundled",
            path: "/bundle/ffprobe",
            version: "7.1.0",
            error: null,
          },
          ytDlp: {
            tool: "yt-dlp",
            preference: "auto",
            source: "bundled",
            path: "/bundle/yt-dlp",
            version: "2026.04.01",
            error: null,
          },
          checkedAtIso: "2026-04-28T00:00:00.000Z",
        })),
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
      get: {
        query: vi.fn(async () => null),
      },
      getMany: {
        query: vi.fn(async ({ keys }: { keys: string[] }) => {
          const values: Record<string, unknown> = {};
          for (const key of keys) {
            if (key === "game.intermediary.loadingPrompt")
              values[key] = "animated gif webm score:>300";
            else if (key === "game.intermediary.loadingDurationSec") values[key] = 5;
            else if (key === "game.intermediary.returnPauseSec") values[key] = 4;
            else if (key === "videoHash.ffmpegSourcePreference") values[key] = "auto";
            else if (key === "webVideo.ytDlpBinaryPreference") values[key] = "auto";
            else if (key === "background.video.enabled") values[key] = true;
            else if (key === "experimental.controllerSupportEnabled") values[key] = false;
            else if (key === "experimental.installWebFunscriptUrlEnabled") values[key] = false;
            else if (key === "experimental.systemLanguageEnabled") values[key] = false;
            else if (key === "experimental.playlistCacheOngoingRestrictionDisabled")
              values[key] = false;
            else if (key === "experimental.deviceAnimationTestEnabled") values[key] = true;
            else if (key === "round.video.progressBarAlwaysVisible") values[key] = false;
            else values[key] = null;
          }
          return values;
        }),
      },
      set: {
        mutate: vi.fn(async () => {}),
      },
    },
    debug: {
      getState: {
        query: vi.fn(async () => ({
          logLevel: "off",
          anonymizedLogFilePath: "/logs/app.log",
          logFileSizeBytes: 0,
        })),
      },
      getDiagnostics: {
        query: vi.fn(async () => ({
          app: {},
          storage: {},
          hardware: {},
          database: {},
          runtime: {},
          collectionErrors: [],
        })),
      },
      getAllSettings: {
        query: vi.fn(async () => ({})),
      },
    },
  },
}));

vi.mock("../hooks/useGlobalMusic", () => ({
  useGlobalMusic: () => mocks.globalMusic,
}));

vi.mock("../hooks/useGameplayMoaning", () => ({
  useGameplayMoaning: () => mocks.gameplayMoaning,
}));

vi.mock("../contexts/HandyContext", () => ({
  HAPTICS_TEST_PERIOD_MS: 12000,
  HAPTICS_TEST_ACTIONS: [
    { at: 0, pos: 8 },
    { at: 12000, pos: 8 },
  ],
  useHandy: () => mocks.handy,
}));

vi.mock("../components/ui/ToastHost", () => ({
  useToast: () => ({ showToast: vi.fn() }),
}));

vi.mock("../hooks/useAppUpdate", () => ({
  useAppUpdate: () => mocks.appUpdate,
}));

import { trpc } from "../services/trpc";
import { getVisibleShortcutGroups, SettingsPage } from "./settings";

const testI18n = {
  _: (descriptor: { id: string; message?: string } | string) =>
    typeof descriptor === "string" ? descriptor : (descriptor.message ?? descriptor.id),
} as Parameters<typeof getVisibleShortcutGroups>[0];

describe("Settings music section", () => {
  beforeEach(() => {
    cleanup();
    mocks.search.section = undefined;
    mocks.navigate.mockClear();
    mocks.globalMusic.addTracks.mockClear();
    mocks.globalMusic.clearQueue.mockClear();
    mocks.globalMusic.moveTrack.mockClear();
    mocks.globalMusic.removeTrack.mockClear();
    mocks.globalMusic.setVolume.mockClear();
    mocks.gameplayMoaning.clearQueue.mockClear();
    mocks.handy.connect.mockClear();
    mocks.handy.connectIntiface.mockClear();
    mocks.handy.setProvider.mockClear();
    mocks.handy.disconnect.mockClear();
    mocks.handy.forceStop.mockClear();
    mocks.handy.adjustOffset.mockClear();
    mocks.handy.resetOffset.mockClear();
    mocks.handy.provider = "thehandy";
    mocks.handy.error = null;
    mocks.handy.connected = false;
    mocks.handy.intifaceWebsocketUrl = "ws://127.0.0.1:12345";
    mocks.handy.intifaceDeviceName = null;
    mocks.handy.intifaceDeviceIndex = null;
    mocks.handy.offsetMs = 0;
    mocks.appUpdate.triggerPrimaryAction.mockClear();
    vi.mocked(trpc.binaries.getResolvedVersions.query).mockClear();

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
        selectMusicFiles: vi.fn(async () => ["/music/three.mp3", "/music/four.mp3"]),
        selectMoaningFiles: vi.fn(async () => ["/moans/one.mp3"]),
        addMusicFromUrl: vi.fn(),
        addMusicPlaylistFromUrl: vi.fn(),
        addMoaningFromUrl: vi.fn(),
        addMoaningPlaylistFromUrl: vi.fn(),
        selectConverterFunscriptFile: vi.fn(),
        selectFpackExtractionDirectory: vi.fn(),
        selectMigrationTargetDirectory: vi.fn(),
        selectPortableInstallation: vi.fn(),
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

  it("adds tracks through the music picker and forwards queue actions", async () => {
    render(<SettingsPage />);

    fireEvent.click(screen.getAllByRole("button", { name: /Audio/ })[0]!);
    fireEvent.click(screen.getByText("Add Tracks"));

    await waitFor(() => {
      expect(window.electronAPI.dialog.selectMusicFiles).toHaveBeenCalled();
      expect(mocks.globalMusic.addTracks).toHaveBeenCalledWith([
        "/music/three.mp3",
        "/music/four.mp3",
      ]);
    });

    fireEvent.click(screen.getAllByText("↓")[0]!);
    await waitFor(() => {
      expect(mocks.globalMusic.moveTrack).toHaveBeenCalledWith("track-1", "down");
    });

    fireEvent.click(screen.getAllByText("✕")[0]!);
    await waitFor(() => {
      expect(mocks.globalMusic.removeTrack).toHaveBeenCalledWith("track-1");
    });
  });

  it("confirms before clearing the music playlist", async () => {
    render(<SettingsPage />);

    fireEvent.click(screen.getAllByRole("button", { name: /Audio/ })[0]!);
    fireEvent.click(screen.getAllByRole("button", { name: "Clear" })[0]!);

    expect(mocks.globalMusic.clearQueue).not.toHaveBeenCalled();
    expect(screen.getByText("Clear music playlist?")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Clear Playlist" }));

    await waitFor(() => {
      expect(mocks.globalMusic.clearQueue).toHaveBeenCalled();
    });
  });

  it("confirms before clearing the moaning playlist", async () => {
    render(<SettingsPage />);

    fireEvent.click(screen.getAllByRole("button", { name: /Audio/ })[0]!);
    fireEvent.click(screen.getAllByRole("button", { name: "Clear" })[1]!);

    expect(mocks.gameplayMoaning.clearQueue).not.toHaveBeenCalled();
    expect(screen.getByText("Clear moaning playlist?")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Clear Playlist" }));

    await waitFor(() => {
      expect(mocks.gameplayMoaning.clearQueue).toHaveBeenCalled();
    });
  });

  it("keeps the selected settings section when sidebar navigation follows a command palette deep link", async () => {
    mocks.search.section = "general";

    render(<SettingsPage />);

    fireEvent.click(screen.getAllByRole("button", { name: /Audio/ })[0]!);

    await waitFor(() => {
      expect(screen.queryByText("Add Tracks")).not.toBeNull();
    });

    expect(mocks.navigate).toHaveBeenCalledWith({
      to: "/settings",
      search: { section: "audio" },
      replace: true,
    });
  });

  it("shows the updated multiplayer safeguards warning in gameplay settings", async () => {
    render(<SettingsPage />);

    fireEvent.click(screen.getAllByRole("button", { name: /Gameplay/ })[0]!);

    await waitFor(() => {
      expect(screen.getByText("Skip Multiplayer Safeguards")).toBeDefined();
    });

    fireEvent.click(screen.getByRole("switch", { name: "Toggle Skip Multiplayer Safeguards" }));

    await waitFor(() => {
      expect(
        screen.getByText(/general minimum round count and any playlist-specific round requirement/i)
      ).toBeDefined();
      expect(screen.getAllByText(/bad user experience/i).length).toBeGreaterThan(0);
    });
  });

  it("persists experimental controller support when toggled", async () => {
    const setMutate = vi.mocked(trpc.store.set.mutate);

    render(<SettingsPage />);

    fireEvent.click(screen.getAllByRole("button", { name: /Experimental/ })[0]!);

    const toggle = await screen.findByRole("switch", { name: "Toggle Controller Support" });
    expect(toggle.getAttribute("aria-checked")).toBe("false");

    fireEvent.click(toggle);

    await waitFor(() => {
      expect(setMutate).toHaveBeenCalledWith({
        key: "experimental.controllerSupportEnabled",
        value: true,
      });
    });
  });

  it("shows language selection in general settings and system language in experimental settings", async () => {
    render(<SettingsPage />);

    expect(
      screen.getByText(
        "Choose the language used for app labels, dialogs, and safe mode prompts. English stays the default unless the experimental system language option is enabled."
      )
    ).toBeDefined();
    expect(screen.getByText("Language / Language")).toBeDefined();
    expect(screen.queryByRole("switch", { name: "Toggle Use System Language" })).toBeNull();

    fireEvent.click(screen.getAllByRole("button", { name: /Experimental/ })[0]!);

    await waitFor(() => {
      expect(
        screen.getByRole("switch", {
          name: "Toggle Use System Language",
        })
      ).toBeDefined();
      expect(screen.queryByText("Language / Language")).toBeNull();
    });
  });

  it("renders and applies app zoom controls in general settings", async () => {
    render(<SettingsPage />);

    await waitFor(() => {
      expect(window.electronAPI.window.getZoomPercent).toHaveBeenCalled();
      expect(screen.getAllByText("100%").length).toBeGreaterThan(0);
    });

    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));

    await waitFor(() => {
      expect(window.electronAPI.window.zoomIn).toHaveBeenCalled();
      expect(screen.getByText("110%")).toBeDefined();
    });

    fireEvent.click(screen.getByRole("button", { name: "Zoom out" }));

    await waitFor(() => {
      expect(window.electronAPI.window.zoomOut).toHaveBeenCalled();
      expect(screen.getByText("90%")).toBeDefined();
    });

    fireEvent.click(screen.getByRole("button", { name: "Reset zoom" }));

    await waitFor(() => {
      expect(window.electronAPI.window.resetZoom).toHaveBeenCalled();
      expect(screen.getAllByText("100%").length).toBeGreaterThan(0);
    });
  });

  it("persists the experimental use system language toggle", async () => {
    const setMutate = vi.mocked(trpc.store.set.mutate);

    render(<SettingsPage />);

    fireEvent.click(screen.getAllByRole("button", { name: /Experimental/ })[0]!);

    const toggle = await screen.findByRole("switch", {
      name: "Toggle Use System Language",
    });
    expect(toggle.getAttribute("aria-checked")).toBe("false");

    fireEvent.click(toggle);

    await waitFor(() => {
      expect(setMutate).toHaveBeenCalledWith({
        key: "experimental.systemLanguageEnabled",
        value: true,
      });
    });
  });

  it("persists the install web funscript URL experimental toggle", async () => {
    const setMutate = vi.mocked(trpc.store.set.mutate);

    render(<SettingsPage />);

    fireEvent.click(screen.getAllByRole("button", { name: /Experimental/ })[0]!);

    const toggle = await screen.findByRole("switch", {
      name: "Toggle Show Web Install Funscript URL",
    });
    await waitFor(() => {
      expect(toggle.getAttribute("aria-checked")).toBe("false");
      expect(toggle.hasAttribute("disabled")).toBe(false);
    });

    fireEvent.click(toggle);

    await waitFor(() => {
      expect(setMutate).toHaveBeenCalledWith({
        key: "experimental.installWebFunscriptUrlEnabled",
        value: true,
      });
    });
  });

  it("persists the playlist cache ongoing override toggle", async () => {
    const setMutate = vi.mocked(trpc.store.set.mutate);

    render(<SettingsPage />);

    fireEvent.click(screen.getAllByRole("button", { name: /Experimental/ })[0]!);

    const toggle = await screen.findByRole("switch", {
      name: "Toggle Allow Playlist Start During Cache Ongoing",
    });
    expect(toggle.getAttribute("aria-checked")).toBe("false");

    fireEvent.click(toggle);

    await waitFor(() => {
      expect(setMutate).toHaveBeenCalledWith({
        key: "experimental.playlistCacheOngoingRestrictionDisabled",
        value: true,
      });
    });
  });

  it("only persists settings volume when slider interaction completes", async () => {
    render(<SettingsPage />);

    fireEvent.click(screen.getAllByRole("button", { name: /Audio/ })[0]!);

    const volume = screen.getByLabelText("Music volume");
    fireEvent.change(volume, { target: { value: "72" } });

    expect(mocks.globalMusic.setVolume).not.toHaveBeenCalled();

    fireEvent.mouseUp(volume);

    await waitFor(() => {
      expect(mocks.globalMusic.setVolume).toHaveBeenCalledWith(0.72);
    });
  });

  it("renders hardware connection controls inline in settings", async () => {
    render(<SettingsPage />);

    await waitFor(() => {
      expect(screen.queryByText("Loading...")).toBeNull();
    });

    fireEvent.click(screen.getAllByRole("button", { name: /Hardware & Sync/ })[0]!);
    expect(screen.getByTestId("haptics-test-device-layer")).toBeDefined();
    expect(screen.queryByTestId("anti-perk-beat-note")).toBeNull();
    fireEvent.change(screen.getByLabelText("Connection Key / Channel Ref"), {
      target: { value: "conn-key-123" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));

    await waitFor(() => {
      expect(mocks.handy.connect).toHaveBeenCalledWith("conn-key-123", "", "");
    });
  });

  it("starts the hardware test device loop from hardware settings", async () => {
    mocks.handy.connected = true;
    vi.mocked(trpc.store.getMany.query).mockImplementationOnce(
      async ({ keys }: { keys: string[] }) => {
        const values: Record<string, unknown> = {};
        for (const key of keys) {
          if (key === "experimental.deviceAnimationTestEnabled") values[key] = true;
          else if (key === "experimental.controllerSupportEnabled") values[key] = false;
          else if (key === "experimental.installWebFunscriptUrlEnabled") values[key] = false;
          else if (key === "experimental.systemLanguageEnabled") values[key] = false;
          else if (key === "experimental.playlistCacheOngoingRestrictionDisabled")
            values[key] = false;
          else if (key === "background.video.enabled") values[key] = true;
          else if (key === "round.video.progressBarAlwaysVisible") values[key] = false;
          else values[key] = null;
        }
        return values;
      }
    );
    render(<SettingsPage />);

    await waitFor(() => {
      expect(screen.queryByText("Loading...")).toBeNull();
    });

    fireEvent.click(screen.getAllByRole("button", { name: /Hardware & Sync/ })[0]!);
    fireEvent.click(screen.getByRole("button", { name: "Start Test" }));

    await waitFor(() => {
      expect(mocks.handy.startTestDevice).toHaveBeenCalled();
    });
  });

  it("renders Intiface connection controls inline in settings", async () => {
    mocks.handy.provider = "intiface";
    mocks.handy.intifaceWebsocketUrl = "ws://127.0.0.1:12345";
    render(<SettingsPage />);

    fireEvent.click(screen.getAllByRole("button", { name: /Hardware & Sync/ })[0]!);
    fireEvent.change(screen.getByLabelText("Intiface WebSocket URL"), {
      target: { value: "ws://localhost:12345" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));

    await waitFor(() => {
      expect(mocks.handy.connectIntiface).toHaveBeenCalledWith("ws://localhost:12345");
    });
  });

  it("shows Intiface connection errors in hardware settings", async () => {
    mocks.handy.provider = "intiface";
    mocks.handy.error = "Intiface connected, but no linear/position-capable device was found.";
    render(<SettingsPage />);

    fireEvent.click(screen.getAllByRole("button", { name: /Hardware & Sync/ })[0]!);

    expect(
      screen.getByText("Intiface connected, but no linear/position-capable device was found.")
    ).toBeDefined();
  });

  it("renders and uses TheHandy offset controls in hardware settings", async () => {
    mocks.handy.offsetMs = 75;
    mocks.handy.strokeMin = 0.12;
    mocks.handy.strokeMax = 0.88;
    mocks.handy.strokePercent = 76;
    render(<SettingsPage />);

    fireEvent.click(screen.getAllByRole("button", { name: /Hardware & Sync/ })[0]!);

    expect(screen.getByText("Global Sync Offset")).toBeDefined();
    const offsetLayer = screen.getByTestId("thehandy-offset-layer");
    const connectButton = screen.getByRole("button", { name: "Connect" });
    expect(
      (connectButton.compareDocumentPosition(offsetLayer) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
    ).toBe(true);
    fireEvent.change(screen.getByLabelText("TheHandy offset slider"), {
      target: { value: "120" },
    });

    fireEvent.click(screen.getByRole("button", { name: "-25ms" }));
    fireEvent.click(screen.getByRole("button", { name: "-1ms" }));
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    fireEvent.click(screen.getByRole("button", { name: "+1ms" }));
    fireEvent.click(screen.getByRole("button", { name: "+25ms" }));

    await waitFor(() => {
      expect(mocks.handy.adjustOffset).toHaveBeenNthCalledWith(1, 45);
      expect(mocks.handy.adjustOffset).toHaveBeenNthCalledWith(2, -25);
      expect(mocks.handy.adjustOffset).toHaveBeenNthCalledWith(3, -1);
      expect(mocks.handy.resetOffset).toHaveBeenCalledTimes(1);
      expect(mocks.handy.adjustOffset).toHaveBeenNthCalledWith(4, 1);
      expect(mocks.handy.adjustOffset).toHaveBeenNthCalledWith(5, 25);
    });
  });

  it("renders and uses TheHandy stroke controls in hardware settings", async () => {
    mocks.handy.strokeMin = 0.12;
    mocks.handy.strokeMax = 0.88;
    mocks.handy.strokePercent = 76;
    mocks.handy.connected = true;
    render(<SettingsPage />);

    fireEvent.click(screen.getAllByRole("button", { name: /Hardware & Sync/ })[0]!);

    expect(screen.getByText("Stroke Adjustment")).toBeDefined();
    expect(screen.getByText("Current stroke: 12% - 88%")).toBeDefined();

    const minThumb = screen.getByLabelText("TheHandy stroke minimum slider");
    const maxThumb = screen.getByLabelText("TheHandy stroke maximum slider");
    fireEvent.keyDown(minThumb, { key: "ArrowRight" });
    fireEvent.keyDown(maxThumb, { key: "ArrowLeft" });
    fireEvent.click(screen.getByRole("button", { name: "Reset Stroke" }));

    await waitFor(() => {
      expect(mocks.handy.setStrokeBounds).toHaveBeenNthCalledWith(1, 13, 88);
      expect(mocks.handy.setStrokeBounds).toHaveBeenNthCalledWith(2, 13, 87);
      expect(mocks.handy.resetStroke).toHaveBeenCalledTimes(1);
    });
  });

  it("can relaunch the first start workflow from settings", async () => {
    render(<SettingsPage />);

    fireEvent.click(screen.getAllByRole("button", { name: /General/ })[0]!);
    fireEvent.click(screen.getByRole("button", { name: "Open First Start Workflow" }));

    await waitFor(() => {
      expect(mocks.navigate).toHaveBeenCalledWith({
        to: "/first-start",
        search: { returnTo: "settings" },
      });
    });
  });

  it("keeps update actions available in the app settings section", async () => {
    render(<SettingsPage />);

    fireEvent.click(screen.getAllByRole("button", { name: /Data & Storage/ })[0]!);
    fireEvent.click(screen.getByRole("button", { name: "Check Again" }));

    await waitFor(() => {
      expect(screen.getByText("Updates")).toBeDefined();
      expect(mocks.appUpdate.triggerPrimaryAction).toHaveBeenCalledTimes(1);
    });
  });

  it("renders a help section with documented keyboard shortcut groups", async () => {
    render(<SettingsPage />);

    fireEvent.click(screen.getAllByRole("button", { name: /Help/ })[0]!);

    expect(await screen.findByText("Keyboard Shortcuts")).toBeDefined();
    expect(screen.getByText("Global")).toBeDefined();
    expect(screen.getByText("Keyboard Controller Navigation")).toBeDefined();
    expect(screen.getByText("Game Session")).toBeDefined();
    expect(screen.getByText("Converter")).toBeDefined();
    expect(screen.getByText("Map Editor")).toBeDefined();
    expect(screen.getByText("Ctrl/Cmd+M")).toBeDefined();
    expect(screen.getByText("Ctrl/Cmd+R")).toBeDefined();
    expect(screen.getAllByText("Ctrl/Cmd+S").length).toBeGreaterThan(0);
    expect(screen.getByText("Open or close the global music overlay.")).toBeDefined();
    expect(
      screen.getByText("Reconnect TheHandy using the saved connection settings.")
    ).toBeDefined();
    expect(screen.getByText("Save converted rounds to the current hero.")).toBeDefined();
  });

  it("renders a dedicated changelog section from bundled markdown", async () => {
    render(<SettingsPage />);

    await waitFor(() => {
      expect(screen.queryByText("Loading...")).toBeNull();
    });

    const helpButton = screen.getAllByRole("button", { name: /Help/ })[0]!;
    const changelogButton = screen.getByRole("button", { name: /What's New/ });
    const creditsButton = screen.getByRole("button", { name: /Credits \/ License/ });

    expect(
      (helpButton.compareDocumentPosition(changelogButton) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
    ).toBe(true);
    expect(
      (changelogButton.compareDocumentPosition(creditsButton) &
        Node.DOCUMENT_POSITION_FOLLOWING) !==
        0
    ).toBe(true);

    fireEvent.click(changelogButton);

    expect(await screen.findByText("Release Notes")).toBeDefined();
    expect(screen.getAllByText("What's New").length).toBeGreaterThan(0);
    expect(screen.getByText("v0.2.9-beta")).toBeDefined();
    expect(
      screen.getByText("In-app release notes are now available directly from Settings.")
    ).toBeDefined();

    const repositoryLink = screen.getByRole("link", {
      name: "https://github.com/FapLandPartyDev/FapLand-Party-Edition",
    });
    expect(repositoryLink.getAttribute("target")).toBe("_blank");
    expect(repositoryLink.getAttribute("rel")).toBe("noreferrer");
  });

  it("supports changelog deep links through the settings search section", async () => {
    mocks.search.section = "changelog";

    render(<SettingsPage />);

    await waitFor(() => {
      expect(screen.queryByText("Loading...")).toBeNull();
    });

    expect(await screen.findByText("v0.2.9-beta")).toBeDefined();
    expect(
      screen.getByText("Release notes and shipped improvements bundled directly into the app.")
    ).toBeDefined();
  });

  it("hides debug shortcuts in production builds", () => {
    expect(
      getVisibleShortcutGroups(testI18n, true).some((group) => group.id === "game-debug")
    ).toBe(false);
    expect(
      getVisibleShortcutGroups(testI18n, false).some((group) => group.id === "game-debug")
    ).toBe(true);
  });

  it("shows live program versions in Advanced and refreshes after source changes", async () => {
    render(<SettingsPage />);

    await waitFor(() => {
      expect(screen.queryByText("Loading...")).toBeNull();
    });

    fireEvent.click(screen.getByRole("button", { name: /Advanced/ }));

    await screen.findByText("Program Versions");
    expect(screen.getByText("/bundle/ffmpeg")).toBeDefined();
    expect(screen.getByText("/bundle/ffprobe")).toBeDefined();
    expect(screen.getByText("/bundle/yt-dlp")).toBeDefined();
    expect(vi.mocked(trpc.binaries.getResolvedVersions.query)).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await waitFor(() => {
      expect(vi.mocked(trpc.binaries.getResolvedVersions.query)).toHaveBeenCalledTimes(2);
    });

    fireEvent.click(screen.getAllByRole("button", { name: /Auto \(Default\)/ })[0]!);
    fireEvent.click(screen.getByRole("option", { name: "System Only" }));
    fireEvent.click(screen.getAllByRole("button", { name: "Save" })[0]!);
    await waitFor(() => {
      expect(vi.mocked(trpc.store.set.mutate)).toHaveBeenCalledWith({
        key: "hash.videophash.ffmpegSourcePreference",
        value: "system",
      });
      expect(vi.mocked(trpc.binaries.getResolvedVersions.query)).toHaveBeenCalledTimes(3);
    });

    fireEvent.click(screen.getAllByRole("button", { name: /Auto \(Default\)/ })[0]!);
    fireEvent.click(screen.getByRole("option", { name: "System Only" }));
    fireEvent.click(screen.getAllByRole("button", { name: "Save" })[1]!);
    await waitFor(() => {
      expect(vi.mocked(trpc.store.set.mutate)).toHaveBeenCalledWith({
        key: "webVideo.ytDlpBinaryPreference",
        value: "system",
      });
      expect(vi.mocked(trpc.binaries.getResolvedVersions.query)).toHaveBeenCalledTimes(4);
    });
  });

  it("keeps rendering successful versions when one tool is unavailable", async () => {
    vi.mocked(trpc.binaries.getResolvedVersions.query).mockResolvedValueOnce({
      ffmpeg: {
        tool: "ffmpeg",
        preference: "auto",
        source: null,
        path: null,
        version: null,
        error: "ffmpeg missing",
      },
      ffprobe: {
        tool: "ffprobe",
        preference: "auto",
        source: null,
        path: null,
        version: null,
        error: "ffmpeg missing",
      },
      ytDlp: {
        tool: "yt-dlp",
        preference: "auto",
        source: "bundled",
        path: "/bundle/yt-dlp",
        version: "2026.04.01",
        error: null,
      },
      checkedAtIso: "2026-04-28T00:00:00.000Z",
    });

    render(<SettingsPage />);
    fireEvent.click(screen.getByRole("button", { name: /Advanced/ }));

    await screen.findAllByText("Unavailable");
    expect(screen.getAllByText("ffmpeg missing")[0]).toBeDefined();
    expect(screen.getByText("/bundle/yt-dlp")).toBeDefined();
  });
});
