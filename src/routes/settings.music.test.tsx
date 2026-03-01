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
      connectionKey: "",
      appApiKey: "default-app-key",
      appApiKeyOverride: "",
      isUsingDefaultAppApiKey: true,
      localIp: "",
      offsetMs: 0,
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
      adjustOffset: vi.fn(async (deltaMs: number) => deltaMs),
      resetOffset: vi.fn(async () => {}),
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
            else if (key === "experimental.controllerSupportEnabled") values[key] = false;
            else if (key === "experimental.installWebFunscriptUrlEnabled") values[key] = false;
            else if (key === "experimental.systemLanguageEnabled") values[key] = false;
            else if (key === "experimental.playlistCacheOngoingRestrictionDisabled") values[key] = false;
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
  },
}));

vi.mock("../hooks/useGlobalMusic", () => ({
  useGlobalMusic: () => mocks.globalMusic,
}));

vi.mock("../hooks/useGameplayMoaning", () => ({
  useGameplayMoaning: () => mocks.gameplayMoaning,
}));

vi.mock("../contexts/HandyContext", () => ({
  useHandy: () => mocks.handy,
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
    mocks.handy.disconnect.mockClear();
    mocks.handy.forceStop.mockClear();
    mocks.handy.adjustOffset.mockClear();
    mocks.handy.resetOffset.mockClear();
    mocks.handy.offsetMs = 0;
    mocks.appUpdate.triggerPrimaryAction.mockClear();

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

    fireEvent.click(screen.getAllByRole("button", { name: /Hardware & Sync/ })[0]!);
    fireEvent.change(screen.getByLabelText("Connection Key / Channel Ref"), {
      target: { value: "conn-key-123" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));

    await waitFor(() => {
      expect(mocks.handy.connect).toHaveBeenCalledWith("conn-key-123", "", "");
    });
  });

  it("renders and uses TheHandy offset controls in hardware settings", async () => {
    mocks.handy.offsetMs = 75;
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
    expect(screen.getByText("Reconnect TheHandy using the saved connection settings.")).toBeDefined();
    expect(screen.getByText("Save converted rounds to the current hero.")).toBeDefined();
  });

  it("renders a dedicated changelog section from bundled markdown", async () => {
    render(<SettingsPage />);

    const helpButton = screen.getAllByRole("button", { name: /Help/ })[0]!;
    const changelogButton = screen.getByRole("button", { name: "What's New" });
    const creditsButton = screen.getByRole("button", { name: /Credits \/ License/ });

    expect(
      (helpButton.compareDocumentPosition(changelogButton) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
    ).toBe(true);
    expect(
      (changelogButton.compareDocumentPosition(creditsButton) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
    ).toBe(true);

    fireEvent.click(changelogButton);

    expect(await screen.findByText("Release Notes")).toBeDefined();
    expect(screen.getAllByText("What's New").length).toBeGreaterThan(0);
    expect(screen.getByText("v0.2.8-beta")).toBeDefined();
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

    expect(await screen.findByText("v0.2.8-beta")).toBeDefined();
    expect(
      screen.getByText("Release notes and shipped improvements bundled directly into the app.")
    ).toBeDefined();
  });

  it("hides debug shortcuts in production builds", () => {
    expect(getVisibleShortcutGroups(testI18n, true).some((group) => group.id === "game-debug")).toBe(
      false
    );
    expect(getVisibleShortcutGroups(testI18n, false).some((group) => group.id === "game-debug")).toBe(
      true
    );
  });
});
