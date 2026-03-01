import type { ReactElement } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function createLinearPlaylistConfig(totalIndices: number) {
  return {
    playlistVersion: 1,
    boardConfig: {
      mode: "linear" as const,
      totalIndices,
      safePointIndices: [],
      safePointRestMsByIndex: {},
      normalRoundRefsByIndex: {},
      normalRoundOrder: [],
      cumRoundRefs: [],
    },
    perkSelection: { optionsPerPick: 3, triggerChancePerCompletedRound: 0.35 },
    perkPool: { enabledPerkIds: [], enabledAntiPerkIds: [] },
    probabilityScaling: {
      initialIntermediaryProbability: 0,
      initialAntiPerkProbability: 0,
      intermediaryIncreasePerRound: 0.02,
      antiPerkIncreasePerRound: 0.015,
      maxIntermediaryProbability: 1,
      maxAntiPerkProbability: 0.75,
    },
    economy: {
      startingMoney: 120,
      moneyPerCompletedRound: 50,
      startingScore: 0,
      scorePerCompletedRound: 100,
      scorePerIntermediary: 30,
      scorePerActiveAntiPerk: 25,
      scorePerCumRoundSuccess: 420,
    },
  };
}

const mocks = vi.hoisted(() => ({
  loaderData: {
    activePlaylist: {
      id: "playlist-1",
      name: "Playlist One",
      config: createLinearPlaylistConfig(100),
    },
    availablePlaylists: [
      {
        id: "playlist-1",
        name: "Playlist One",
        config: createLinearPlaylistConfig(100),
      },
    ],
    installedRoundCount: 100,
    profiles: [
      {
        id: "default-server",
        name: "F-Land Online",
        url: "https://hosted.supabase.co",
        anonKey: "hosted-key",
        isDefault: true,
        isBuiltIn: true,
        createdAtIso: "2026-03-08T00:00:00.000Z",
        updatedAtIso: "2026-03-08T00:00:00.000Z",
      },
    ],
    activeProfile: {
      id: "default-server",
      name: "F-Land Online",
      url: "https://hosted.supabase.co",
      anonKey: "hosted-key",
      isDefault: true,
      isBuiltIn: true,
      createdAtIso: "2026-03-08T00:00:00.000Z",
      updatedAtIso: "2026-03-08T00:00:00.000Z",
    },
    skipRoundsCheck: false,
  },
  search: {
    inviteCode: "",
  },
  navigate: vi.fn(),
  resolveMultiplayerAuthStatus: vi.fn(),
  getPreferredMultiplayerServerProfile: vi.fn(),
  getOptionalActiveMultiplayerServerProfile: vi.fn(),
  listMultiplayerServerProfiles: vi.fn(),
  setActiveMultiplayerServerProfile: vi.fn(),
  saveMultiplayerServerProfile: vi.fn(),
  removeMultiplayerServerProfile: vi.fn(),
  joinLobby: vi.fn(),
  getLobbyJoinPreview: vi.fn(),
  listPublicLobbies: vi.fn(),
  createLobby: vi.fn(),
  startDiscordMultiplayerLink: vi.fn(),
  subscribeToMultiplayerAuthRefresh: vi.fn(() => () => { }),
  buildMultiplayerPlaylistSnapshot: vi.fn(() => ({ playlistVersion: 1 })),
  isLikelyConfiguredSupabaseServer: vi.fn((profile: { url: string; anonKey: string }) => profile.url.length > 0 && profile.anonKey.length > 0),
  useAppUpdate: vi.fn(() => ({
    state: { status: "up_to_date" },
    isBusy: false,
    actionLabel: "Check Again",
    menuBadge: undefined,
    menuTone: "success",
    systemMessage: "Installed build is current.",
    triggerPrimaryAction: vi.fn(),
  })),
  sfwModeEnabled: false,
  assertMultiplayerAllowed: vi.fn(),
  countInstalled: vi.fn(async () => 100),
  findInstalled: vi.fn(async () =>
    Array.from({ length: 100 }, (_, index) => ({
      id: `round-${index + 1}`,
    }))
  ),
}));

function createAuthStatus(overrides: Record<string, unknown> = {}) {
  return {
    profile: mocks.loaderData.activeProfile,
    client: {},
    user: { id: "user-1", email: null, identities: [] },
    requirement: "anonymous_only",
    isAnonymous: true,
    hasDiscordIdentity: false,
    hasEmail: false,
    discordLinkUrl: null,
    status: "ready",
    message: "This server allows anonymous multiplayer.",
    ...overrides,
  };
}

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (config: Record<string, unknown>) => ({
    ...config,
    useLoaderData: () => mocks.loaderData,
    useSearch: () => mocks.search,
  }),
  useNavigate: () => mocks.navigate,
}));

vi.mock("../components/AnimatedBackground", () => ({
  AnimatedBackground: () => null,
}));

vi.mock("../services/db", () => ({
  db: {
    round: {
      countInstalled: mocks.countInstalled,
      findInstalled: mocks.findInstalled,
    },
  },
}));

vi.mock("../services/multiplayer", () => ({
  buildMultiplayerPlaylistSnapshot: mocks.buildMultiplayerPlaylistSnapshot,
  createLobby: mocks.createLobby,
  getOptionalActiveMultiplayerServerProfile: mocks.getOptionalActiveMultiplayerServerProfile,
  getPreferredMultiplayerServerProfile: mocks.getPreferredMultiplayerServerProfile,
  isLikelyConfiguredSupabaseServer: mocks.isLikelyConfiguredSupabaseServer,
  getLobbyJoinPreview: mocks.getLobbyJoinPreview,
  joinLobby: mocks.joinLobby,
  listPublicLobbies: mocks.listPublicLobbies,
  listMultiplayerServerProfiles: mocks.listMultiplayerServerProfiles,
  removeMultiplayerServerProfile: mocks.removeMultiplayerServerProfile,
  resolveMultiplayerAuthStatus: mocks.resolveMultiplayerAuthStatus,
  saveMultiplayerServerProfile: mocks.saveMultiplayerServerProfile,
  setActiveMultiplayerServerProfile: mocks.setActiveMultiplayerServerProfile,
  startDiscordMultiplayerLink: mocks.startDiscordMultiplayerLink,
  subscribeToMultiplayerAuthRefresh: mocks.subscribeToMultiplayerAuthRefresh,
}));

vi.mock("../services/playlists", () => ({
  playlists: {
    list: vi.fn(),
    getActive: vi.fn(),
  },
}));

vi.mock("../utils/audio", () => ({
  playHoverSound: vi.fn(),
  playSelectSound: vi.fn(),
}));

vi.mock("../hooks/useAppUpdate", () => ({
  useAppUpdate: mocks.useAppUpdate,
}));

vi.mock("../hooks/useMultiplayerSfwGuard", () => ({
  assertMultiplayerAllowed: mocks.assertMultiplayerAllowed,
  useMultiplayerSfwRedirect: () => mocks.sfwModeEnabled,
}));

import { Route } from "./multiplayer";

beforeEach(() => {
  mocks.navigate.mockReset();
  mocks.sfwModeEnabled = false;
  mocks.loaderData.activePlaylist = {
    id: "playlist-1",
    name: "Playlist One",
    config: createLinearPlaylistConfig(100),
  };
  mocks.loaderData.availablePlaylists = [
    {
      id: "playlist-1",
      name: "Playlist One",
      config: createLinearPlaylistConfig(100),
    },
  ];
  mocks.loaderData.installedRoundCount = 100;
  mocks.countInstalled.mockResolvedValue(100);
  mocks.findInstalled.mockResolvedValue(
    Array.from({ length: 100 }, (_, index) => ({
      id: `round-${index + 1}`,
    }))
  );
  mocks.loaderData.skipRoundsCheck = false;
  mocks.search.inviteCode = "";
  mocks.assertMultiplayerAllowed.mockResolvedValue(undefined);
  mocks.resolveMultiplayerAuthStatus.mockResolvedValue(createAuthStatus());
  mocks.getPreferredMultiplayerServerProfile.mockResolvedValue(mocks.loaderData.activeProfile);
  mocks.getOptionalActiveMultiplayerServerProfile.mockResolvedValue(mocks.loaderData.activeProfile);
  mocks.listMultiplayerServerProfiles.mockResolvedValue(mocks.loaderData.profiles);
  mocks.listPublicLobbies.mockResolvedValue([]);
  mocks.setActiveMultiplayerServerProfile.mockResolvedValue(mocks.loaderData.activeProfile);
  mocks.saveMultiplayerServerProfile.mockResolvedValue(mocks.loaderData.activeProfile);
  mocks.removeMultiplayerServerProfile.mockResolvedValue(undefined);
  mocks.getLobbyJoinPreview.mockResolvedValue({
    lobbyId: "lobby-1",
    inviteCode: "ABCD",
    name: "Preview Lobby",
    playlistName: "Playlist One",
    playerCount: 2,
    status: "waiting",
    isOpen: true,
    allowLateJoin: true,
    requiredRoundCount: 100,
    createdAt: "2026-03-29T00:00:00.000Z",
  });
  mocks.joinLobby.mockResolvedValue({
    lobbyId: "lobby-1",
    inviteCode: "ABCD",
    playerId: "player-1",
  });
  mocks.createLobby.mockResolvedValue({
    lobbyId: "lobby-1",
    inviteCode: "ABCD",
    playerId: "player-1",
  });
  mocks.startDiscordMultiplayerLink.mockResolvedValue(undefined);
  mocks.subscribeToMultiplayerAuthRefresh.mockReturnValue(() => { });
  mocks.isLikelyConfiguredSupabaseServer.mockImplementation((profile: { url: string; anonKey: string }) => profile.url.length > 0 && profile.anonKey.length > 0);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("MultiplayerRoute", () => {
  it("loads multiplayer menu data via installed round count only", async () => {
    const loader = (Route as unknown as { loader: () => Promise<unknown> }).loader;

    await loader();

    expect(mocks.countInstalled).toHaveBeenCalled();
    expect(mocks.findInstalled).not.toHaveBeenCalled();
  });

  it("shows a go back button in the header and returns to the main menu", () => {
    const Component = (Route as unknown as { component: () => ReactElement }).component;
    render(<Component />);

    fireEvent.click(screen.getByRole("button", { name: "Go Back" }));

    expect(mocks.navigate).toHaveBeenCalledWith({ to: "/" });
  });

  it("renders nothing while sfw mode is enabled", () => {
    mocks.sfwModeEnabled = true;

    const Component = (Route as unknown as { component: () => ReactElement }).component;
    const { container } = render(<Component />);

    expect(container.innerHTML).toBe("");
  });

  it("allows anonymous-only servers to play after bootstrap", async () => {
    const Component = (Route as unknown as { component: () => ReactElement }).component;
    render(<Component />);

    await waitFor(() => {
      expect(mocks.resolveMultiplayerAuthStatus).toHaveBeenCalledWith(mocks.loaderData.activeProfile);
      expect(screen.getByText("Ready")).toBeDefined();
      expect(screen.getByText("Ready to join or host")).toBeDefined();
    });

    expect(screen.getByRole("button", { name: "Create Lobby" }).hasAttribute("disabled")).toBe(false);
    expect(screen.getByRole("button", { name: "Join Lobby" }).hasAttribute("disabled")).toBe(true);
  });

  it("forwards public visibility when creating a lobby", async () => {
    const Component = (Route as unknown as { component: () => ReactElement }).component;
    render(<Component />);

    await waitFor(() => {
      expect(screen.getByText("Ready")).toBeDefined();
    });

    fireEvent.click(screen.getByLabelText("Advertise on Public List"));
    fireEvent.click(screen.getByRole("button", { name: "Create Lobby" }));

    await waitFor(() => {
      expect(mocks.createLobby).toHaveBeenCalledWith(
        expect.objectContaining({
          isPublic: true,
        }),
        mocks.loaderData.activeProfile,
      );
      expect(mocks.buildMultiplayerPlaylistSnapshot).toHaveBeenCalledWith(
        mocks.loaderData.activePlaylist.config,
        expect.any(Array),
        { name: "Playlist One" },
      );
      expect(mocks.findInstalled).toHaveBeenCalled();
    });
  });

  it("blocks lobby creation when the playlist requirement exceeds installed rounds", async () => {
    mocks.loaderData.activePlaylist = {
      id: "playlist-1",
      name: "Playlist One",
      config: createLinearPlaylistConfig(140),
    };
    mocks.loaderData.availablePlaylists = [mocks.loaderData.activePlaylist];
    mocks.loaderData.installedRoundCount = 110;

    const Component = (Route as unknown as { component: () => ReactElement }).component;
    render(<Component />);

    await waitFor(() => {
      expect(screen.getByText("Playlist One requires 140 installed rounds.")).toBeDefined();
    });

    expect(screen.getByRole("button", { name: "Create Lobby" }).hasAttribute("disabled")).toBe(true);
    expect(
      screen.getByText("This playlist requires at least 140 installed rounds. You have 110.")
    ).toBeDefined();
  });

  it("blocks invite-code joins when the preview requires more rounds than installed", async () => {
    mocks.loaderData.installedRoundCount = 110;
    mocks.getLobbyJoinPreview.mockResolvedValue({
      lobbyId: "lobby-2",
      inviteCode: "ROOM140",
      name: "Big Lobby",
      playlistName: "Huge Playlist",
      playerCount: 3,
      status: "waiting",
      isOpen: true,
      allowLateJoin: true,
      requiredRoundCount: 140,
      createdAt: "2026-03-29T00:00:00.000Z",
    });

    const Component = (Route as unknown as { component: () => ReactElement }).component;
    render(<Component />);

    await waitFor(() => {
      expect(screen.getByText("Ready")).toBeDefined();
    });

    fireEvent.change(screen.getByLabelText("Invite Code"), { target: { value: "room140" } });
    fireEvent.click(screen.getByRole("button", { name: "Join Lobby" }));

    await waitFor(() => {
      expect(mocks.getLobbyJoinPreview).toHaveBeenCalledWith("ROOM140", mocks.loaderData.activeProfile);
      expect(screen.getByText("This lobby requires at least 140 installed rounds. You have 110.")).toBeDefined();
    });

    expect(mocks.joinLobby).not.toHaveBeenCalled();
  });

  it("lists and joins public lobbies in one click", async () => {
    mocks.listPublicLobbies.mockResolvedValue([
      {
        lobbyId: "lobby-public",
        inviteCode: "PUBLIC1",
        name: "Public Lobby",
        playlistName: "Playlist One",
        playerCount: 4,
        status: "waiting",
        isOpen: true,
        allowLateJoin: true,
        requiredRoundCount: 100,
        createdAt: "2026-03-29T00:00:00.000Z",
      },
    ]);

    const Component = (Route as unknown as { component: () => ReactElement }).component;
    render(<Component />);

    await waitFor(() => {
      expect(screen.getByText("Public Lobby")).toBeDefined();
    });

    fireEvent.click(screen.getByRole("button", { name: "Join Public Lobby" }));

    await waitFor(() => {
      expect(mocks.joinLobby).toHaveBeenCalledWith(
        {
          inviteCode: "PUBLIC1",
          displayName: "Player",
        },
        mocks.loaderData.activeProfile,
      );
    });
  });

  it("hides built-in endpoint credentials from the editor", async () => {
    const Component = (Route as unknown as { component: () => ReactElement }).component;
    render(<Component />);

    await waitFor(() => {
      expect(screen.getByText("Ready")).toBeDefined();
    });

    fireEvent.click(screen.getByRole("button", { name: "Show Advanced" }));

    expect(screen.queryByRole("button", { name: "Load Into Editor" })).toBeNull();
    expect(screen.getAllByText("Hidden for built-in server").length).toBeGreaterThan(0);
    expect(screen.getByText("Built-in server credentials stay hidden and cannot be edited.")).toBeDefined();
  });

  it("shows discord linking requirements and blocks play", async () => {
    mocks.resolveMultiplayerAuthStatus.mockResolvedValue(createAuthStatus({
      requirement: "discord_required",
      status: "needs_discord",
      message: "Link a Discord account with email to upgrade this anonymous multiplayer account.",
      discordLinkUrl: "https://discord.example/auth",
    }));

    const Component = (Route as unknown as { component: () => ReactElement }).component;
    render(<Component />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Link Discord" })).toBeDefined();
      expect(screen.getByText("Discord linking required")).toBeDefined();
    });

    expect(screen.getByRole("button", { name: "Create Lobby" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: "Join Lobby" }).hasAttribute("disabled")).toBe(true);

    fireEvent.click(screen.getAllByRole("button", { name: "Link Discord" })[0]!);
    await waitFor(() => {
      expect(mocks.startDiscordMultiplayerLink).toHaveBeenCalledWith(mocks.loaderData.activeProfile);
    });
  });

  it("shows missing email state for linked discord accounts", async () => {
    mocks.resolveMultiplayerAuthStatus.mockResolvedValue(createAuthStatus({
      user: { id: "user-1", email: null, identities: [{ provider: "discord" }] },
      requirement: "discord_required",
      isAnonymous: false,
      hasDiscordIdentity: true,
      hasEmail: false,
      status: "needs_email",
      message: "This Discord-linked account has no email attached. Add an email in Discord and recheck.",
    }));

    const Component = (Route as unknown as { component: () => ReactElement }).component;
    render(<Component />);

    await waitFor(() => {
      expect(screen.getByText("Email Required")).toBeDefined();
      expect(screen.getByText("Discord account needs an email")).toBeDefined();
    });
  });

  it("shows unavailable state and opens advanced when no configured server exists", async () => {
    mocks.getPreferredMultiplayerServerProfile.mockResolvedValue({
      ...mocks.loaderData.activeProfile,
      url: "",
      anonKey: "",
    });
    mocks.isLikelyConfiguredSupabaseServer.mockReturnValue(false);

    const Component = (Route as unknown as { component: () => ReactElement }).component;
    render(<Component />);

    await waitFor(() => {
      expect(screen.getByText("Unavailable")).toBeDefined();
      expect(screen.getByRole("button", { name: "Hide Advanced" })).toBeDefined();
    });

    expect(mocks.resolveMultiplayerAuthStatus).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Create Lobby" }).hasAttribute("disabled")).toBe(true);
  });

  it("shows retry after auth failure and retries bootstrap", async () => {
    mocks.resolveMultiplayerAuthStatus
      .mockRejectedValueOnce(new Error("Boom"))
      .mockResolvedValueOnce(createAuthStatus({
        user: { id: "user-1", email: "test@example.com", identities: [{ provider: "discord" }] },
        requirement: "discord_required",
        isAnonymous: false,
        hasDiscordIdentity: true,
        hasEmail: true,
        status: "ready",
        message: "Discord is linked and ready for multiplayer.",
      }));

    const Component = (Route as unknown as { component: () => ReactElement }).component;
    render(<Component />);

    await waitFor(() => {
      expect(screen.getByText("Boom")).toBeDefined();
      expect(screen.getByRole("button", { name: "Retry" })).toBeDefined();
    });

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    await waitFor(() => {
      expect(mocks.resolveMultiplayerAuthStatus).toHaveBeenCalledTimes(2);
      expect(screen.getByText("Ready")).toBeDefined();
    });
  });

  it("creates a new custom endpoint without reusing the built-in profile id", async () => {
    const Component = (Route as unknown as { component: () => ReactElement }).component;
    render(<Component />);

    await waitFor(() => {
      expect(screen.getByText("Ready")).toBeDefined();
    });

    fireEvent.click(screen.getByRole("button", { name: "Show Advanced" }));
    fireEvent.click(screen.getByRole("button", { name: "New Endpoint" }));
    fireEvent.change(screen.getByLabelText("Server Name"), { target: { value: "My Server" } });
    fireEvent.change(screen.getByLabelText("Supabase URL"), { target: { value: "https://custom.supabase.co" } });
    fireEvent.change(screen.getByLabelText("Anon Key"), { target: { value: "custom-key" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Endpoint" }));

    await waitFor(() => {
      expect(mocks.saveMultiplayerServerProfile).toHaveBeenCalledWith({
        id: undefined,
        name: "My Server",
        url: "https://custom.supabase.co",
        anonKey: "custom-key",
      });
    });
  });

  it("redirects to home if an update is available", async () => {
    mocks.useAppUpdate.mockReturnValue({
      state: { status: "update_available" },
      isBusy: false,
      actionLabel: "Download",
      menuBadge: "v2",
      menuTone: "warning",
      systemMessage: "New version available.",
      triggerPrimaryAction: vi.fn(),
    } as any);

    const Component = (Route as unknown as { component: () => ReactElement }).component;
    render(<Component />);

    await waitFor(() => {
      expect(mocks.navigate).toHaveBeenCalledWith({ to: "/" });
    });
  });
});
