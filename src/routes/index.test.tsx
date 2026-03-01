import type { ReactElement } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppUpdateState } from "../../electron/services/updater";

type MockAppUpdate = {
  state: AppUpdateState;
  isBusy: boolean;
  actionLabel: string;
  menuBadge: string | undefined;
  menuTone: "default" | "success" | "warning" | "danger";
  systemMessage: string;
  triggerPrimaryAction: ReturnType<typeof vi.fn<() => Promise<void>>>;
};

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  closeWindow: vi.fn(async () => true),
  findBackgroundVideos: vi.fn(async () => []),
  getLocalHighscore: vi.fn(async () => ({
    highscore: 0,
    highscoreCheatMode: false,
    highscoreAssisted: false,
    highscoreAssistedSaveMode: null,
  })),
  listMatchCache: vi.fn(async () => []),
  getCumLoadCount: vi.fn(async () => 0),
  countInstalled: vi.fn(async () => 0),
  appUpdate: {
    state: {
      status: "idle",
      currentVersion: "0.1.2",
      latestVersion: null,
      checkedAtIso: null,
      releasePageUrl: "https://example.com/release",
      downloadUrl: null,
      releaseNotes: null,
      publishedAtIso: null,
      canAutoUpdate: false,
      errorMessage: null,
    } as AppUpdateState,
    isBusy: false,
    actionLabel: "Check for Updates",
    menuBadge: undefined,
    menuTone: "default",
    systemMessage: "No update check has run yet.",
    triggerPrimaryAction: vi.fn(async () => {}),
  } as MockAppUpdate,
  handy: {
    connected: false,
    isConnecting: false,
    error: null,
    connectionKey: "",
  },
  sfwModeEnabled: false,
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (config: Record<string, unknown>) => config,
  useNavigate: () => mocks.navigate,
}));

vi.mock("../components/AnimatedBackground", () => ({
  AnimatedBackground: () => null,
}));

vi.mock("../components/MenuButton", () => ({
  MenuButton: ({
    label,
    onClick,
    badge,
    subLabel,
    disabled,
  }: {
    label: string;
    onClick?: () => void;
    badge?: string;
    subLabel?: string;
    disabled?: boolean;
  }) => (
    <button type="button" onClick={onClick} disabled={disabled}>
      <span>{label}</span>
      {badge ? <span>{badge}</span> : null}
      {subLabel ? <span>{subLabel}</span> : null}
    </button>
  ),
}));

vi.mock("../controller", () => ({
  useControllerSurface: vi.fn(),
}));

vi.mock("../contexts/HandyContext", () => ({
  useHandy: () => mocks.handy,
}));

vi.mock("../hooks/useAppUpdate", () => ({
  useAppUpdate: () => mocks.appUpdate,
}));

vi.mock("../hooks/useSfwMode", () => ({
  useSfwMode: () => mocks.sfwModeEnabled,
}));

vi.mock("../features/library/components/LibraryStatusPoller", () => ({
  LibraryStatusPoller: () => null,
}));

vi.mock("../features/phash/components/PhashScanStatusPoller", () => ({
  PhashScanStatusPoller: () => null,
}));

vi.mock("../features/webVideo/components/WebsiteVideoScanStatusPoller", () => ({
  WebsiteVideoScanStatusPoller: () => null,
}));

vi.mock("../services/db", () => ({
  db: {
    resource: {
      findBackgroundVideos: mocks.findBackgroundVideos,
    },
    gameProfile: {
      getLocalHighscore: mocks.getLocalHighscore,
    },
    multiplayer: {
      listMatchCache: mocks.listMatchCache,
    },
    singlePlayerHistory: {
      getCumLoadCount: mocks.getCumLoadCount,
    },
    round: {
      countInstalled: mocks.countInstalled,
    },
  },
}));

vi.mock("../services/trpc", () => ({
  trpc: {
    store: {
      get: {
        query: vi.fn(async () => true),
      },
    },
  },
}));

vi.mock("../services/multiplayer/results", () => ({
  parseStandingsJson: vi.fn(() => []),
}));

vi.mock("../utils/audio", () => ({
  playHoverSound: vi.fn(),
  playSelectSound: vi.fn(),
}));

import { Route } from "./index";
import { trpc } from "../services/trpc";

describe("Home route update menu", () => {
  beforeEach(() => {
    mocks.navigate.mockReset();
    mocks.closeWindow.mockClear();
    mocks.findBackgroundVideos.mockResolvedValue([]);
    mocks.getLocalHighscore.mockResolvedValue({
      highscore: 0,
      highscoreCheatMode: false,
      highscoreAssisted: false,
      highscoreAssistedSaveMode: null,
    });
    mocks.listMatchCache.mockResolvedValue([]);
    mocks.getCumLoadCount.mockResolvedValue(0);
    mocks.countInstalled.mockResolvedValue(0);
    mocks.appUpdate.state = {
      status: "idle",
      currentVersion: "0.1.2",
      latestVersion: null,
      checkedAtIso: null,
      releasePageUrl: "https://example.com/release",
      downloadUrl: null,
      releaseNotes: null,
      publishedAtIso: null,
      canAutoUpdate: false,
      errorMessage: null,
    } as AppUpdateState;
    mocks.appUpdate.actionLabel = "Check for Updates";
    mocks.appUpdate.menuBadge = undefined;
    mocks.appUpdate.menuTone = "default";
    mocks.appUpdate.systemMessage = "No update check has run yet.";
    mocks.appUpdate.triggerPrimaryAction.mockClear();
    mocks.sfwModeEnabled = false;
    vi.mocked(trpc.store.get.query).mockResolvedValue(true);
    vi.spyOn(window, "open").mockImplementation(() => null);

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
        isFullscreen: vi.fn(async () => false),
        setFullscreen: vi.fn(async () => false),
        toggleFullscreen: vi.fn(async () => false),
        close: mocks.closeWindow,
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

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("hides the update action when no update is available", () => {
    mocks.appUpdate.state = {
      ...mocks.appUpdate.state,
      status: "up_to_date",
      latestVersion: "0.1.2",
    };
    mocks.appUpdate.actionLabel = "Check Again";
    mocks.appUpdate.systemMessage = "Installed build is current.";
    mocks.appUpdate.menuTone = "success";

    const Component = (Route as unknown as { component: () => ReactElement }).component;
    render(<Component />);

    expect(screen.queryByRole("button", { name: /Check Again/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Download Latest Version/ })).toBeNull();
  });

  it("loads home menu data via count and sampled background videos", async () => {
    const Component = (Route as unknown as { component: () => ReactElement }).component;
    render(<Component />);

    await waitFor(() => {
      expect(mocks.findBackgroundVideos).toHaveBeenCalledWith(6);
      expect(mocks.countInstalled).toHaveBeenCalled();
    });
  });

  it("shows the update action when an update is available", async () => {
    mocks.appUpdate.state = {
      ...mocks.appUpdate.state,
      status: "update_available",
      latestVersion: "0.1.3",
      downloadUrl: "https://example.com/download",
    };
    mocks.appUpdate.actionLabel = "Download Latest Version";
    mocks.appUpdate.menuBadge = "v0.1.3";
    mocks.appUpdate.menuTone = "warning";
    mocks.appUpdate.systemMessage = "Newer version available.";

    const Component = (Route as unknown as { component: () => ReactElement }).component;
    render(<Component />);

    fireEvent.click(screen.getByRole("button", { name: /Download Latest Version/i }));

    await waitFor(() => {
      expect(screen.getByText("v0.1.3")).toBeDefined();
      expect(mocks.appUpdate.triggerPrimaryAction).toHaveBeenCalledTimes(1);
    });
  });

  it("opens the bug report thread from the home menu", () => {
    const Component = (Route as unknown as { component: () => ReactElement }).component;
    render(<Component />);

    fireEvent.click(screen.getByRole("button", { name: /Report Bug/i }));

    expect(window.open).toHaveBeenCalledWith(
      "https://discuss.eroscripts.com/t/fapland-party-edition-public-beta-release-feedback-wanted-handy-integration-update-v0-1-28/308265/",
      "_blank",
      "noopener,noreferrer"
    );
  });

  it("blocks bug reporting while an update is available", () => {
    mocks.appUpdate.state = {
      ...mocks.appUpdate.state,
      status: "update_available",
      latestVersion: "0.1.3",
      downloadUrl: "https://example.com/download",
    };

    const Component = (Route as unknown as { component: () => ReactElement }).component;
    render(<Component />);

    const reportBugButton = screen.getByRole("button", { name: /Report Bug/i });
    expect(reportBugButton.hasAttribute("disabled")).toBe(true);
    expect(screen.getByText("Update first before reporting a bug")).toBeDefined();

    fireEvent.click(reportBugButton);

    expect(window.open).not.toHaveBeenCalled();
  });

  it("opens the first start workflow when onboarding was not completed yet", async () => {
    vi.mocked(trpc.store.get.query).mockResolvedValue(false);

    const Component = (Route as unknown as { component: () => ReactElement }).component;
    render(<Component />);

    await waitFor(() => {
      expect(mocks.navigate).toHaveBeenCalledWith({
        to: "/first-start",
        search: { returnTo: "menu" },
      });
    });
  });

  it("blocks multiplayer from the menu while sfw mode is enabled", () => {
    mocks.sfwModeEnabled = true;

    const Component = (Route as unknown as { component: () => ReactElement }).component;
    render(<Component />);

    fireEvent.click(screen.getByRole("button", { name: /Play/i }));

    const multiplayerButton = screen.getByRole("button", { name: /Multiplayer/i });
    expect(multiplayerButton.hasAttribute("disabled")).toBe(true);
    expect(screen.getByText("Blocked By SFW Mode")).toBeDefined();
  });

  it("hides the cum load counter while sfw mode is enabled", () => {
    mocks.sfwModeEnabled = true;
    mocks.getLocalHighscore.mockResolvedValue({
      highscore: 900,
      highscoreCheatMode: false,
      highscoreAssisted: false,
      highscoreAssistedSaveMode: null,
    });
    mocks.getCumLoadCount.mockResolvedValue(7);

    const Component = (Route as unknown as { component: () => ReactElement }).component;
    render(<Component />);

    expect(screen.queryByText(/7 total/i)).toBeNull();
  });

  it("replaces the main menu title while sfw mode is enabled", () => {
    mocks.sfwModeEnabled = true;

    const Component = (Route as unknown as { component: () => ReactElement }).component;
    render(<Component />);

    expect(screen.queryByRole("heading", { name: /fap land/i })).toBeNull();
    expect(screen.getByRole("heading", { name: /safe mode/i })).toBeDefined();
    expect(screen.queryByText(/party edition/i)).toBeNull();
    expect(screen.getByText(/safe experience/i)).toBeDefined();
  });
});
