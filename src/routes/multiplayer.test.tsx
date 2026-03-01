import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  loaderData: {
    activePlaylist: {
      id: "playlist-1",
      name: "Playlist One",
      config: { playlistVersion: 1 },
    },
    availablePlaylists: [
      {
        id: "playlist-1",
        name: "Playlist One",
        config: { playlistVersion: 1 },
      },
    ],
    installedRounds: [],
    profiles: [
      {
        id: "default-server",
        name: "F-Land Online",
        url: "https://hosted.supabase.co",
        anonKey: "hosted-key",
        isDefault: true,
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
      createdAtIso: "2026-03-08T00:00:00.000Z",
      updatedAtIso: "2026-03-08T00:00:00.000Z",
    },
  },
  search: {
    inviteCode: "",
  },
  navigate: vi.fn(),
  ensureMultiplayerAuth: vi.fn(),
  getPreferredMultiplayerServerProfile: vi.fn(),
  getOptionalActiveMultiplayerServerProfile: vi.fn(),
  listMultiplayerServerProfiles: vi.fn(),
  setActiveMultiplayerServerProfile: vi.fn(),
  saveMultiplayerServerProfile: vi.fn(),
  removeMultiplayerServerProfile: vi.fn(),
  joinLobby: vi.fn(),
  createLobby: vi.fn(),
  buildMultiplayerPlaylistSnapshot: vi.fn(() => ({ playlistVersion: 1 })),
  isLikelyConfiguredSupabaseServer: vi.fn((profile: { url: string; anonKey: string }) => profile.url.length > 0 && profile.anonKey.length > 0),
}));

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
      findInstalled: vi.fn(),
    },
  },
}));

vi.mock("../services/multiplayer", () => ({
  buildMultiplayerPlaylistSnapshot: mocks.buildMultiplayerPlaylistSnapshot,
  createLobby: mocks.createLobby,
  ensureMultiplayerAuth: mocks.ensureMultiplayerAuth,
  getOptionalActiveMultiplayerServerProfile: mocks.getOptionalActiveMultiplayerServerProfile,
  getPreferredMultiplayerServerProfile: mocks.getPreferredMultiplayerServerProfile,
  isLikelyConfiguredSupabaseServer: mocks.isLikelyConfiguredSupabaseServer,
  joinLobby: mocks.joinLobby,
  listMultiplayerServerProfiles: mocks.listMultiplayerServerProfiles,
  removeMultiplayerServerProfile: mocks.removeMultiplayerServerProfile,
  saveMultiplayerServerProfile: mocks.saveMultiplayerServerProfile,
  setActiveMultiplayerServerProfile: mocks.setActiveMultiplayerServerProfile,
}));

vi.mock("../services/playlists", () => ({
  playlists: {
    list: vi.fn(),
    getActive: vi.fn(),
  },
}));

import { Route } from "./multiplayer";

beforeEach(() => {
  mocks.navigate.mockReset();
  mocks.ensureMultiplayerAuth.mockResolvedValue({
    profile: mocks.loaderData.activeProfile,
    client: {},
    user: { id: "user-1" },
  });
  mocks.getPreferredMultiplayerServerProfile.mockResolvedValue(mocks.loaderData.activeProfile);
  mocks.getOptionalActiveMultiplayerServerProfile.mockResolvedValue(mocks.loaderData.activeProfile);
  mocks.listMultiplayerServerProfiles.mockResolvedValue(mocks.loaderData.profiles);
  mocks.setActiveMultiplayerServerProfile.mockResolvedValue(mocks.loaderData.activeProfile);
  mocks.saveMultiplayerServerProfile.mockResolvedValue(mocks.loaderData.activeProfile);
  mocks.removeMultiplayerServerProfile.mockResolvedValue(undefined);
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
  mocks.isLikelyConfiguredSupabaseServer.mockImplementation((profile: { url: string; anonKey: string }) => profile.url.length > 0 && profile.anonKey.length > 0);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("MultiplayerRoute", () => {
  it("bootstraps anonymous auth automatically and enables play when ready", async () => {
    const Component = (Route as unknown as { component: () => JSX.Element }).component;
    render(<Component />);

    await waitFor(() => {
      expect(mocks.ensureMultiplayerAuth).toHaveBeenCalledWith(mocks.loaderData.activeProfile);
      expect(screen.getByText("Ready")).toBeDefined();
    });

    expect(screen.getByRole("button", { name: "Create Lobby" }).hasAttribute("disabled")).toBe(false);
    expect(screen.getByRole("button", { name: "Join Lobby" }).hasAttribute("disabled")).toBe(true);
  });

  it("shows unavailable state and opens advanced when no configured server exists", async () => {
    mocks.getPreferredMultiplayerServerProfile.mockResolvedValue({
      ...mocks.loaderData.activeProfile,
      url: "",
      anonKey: "",
    });
    mocks.isLikelyConfiguredSupabaseServer.mockReturnValue(false);

    const Component = (Route as unknown as { component: () => JSX.Element }).component;
    render(<Component />);

    await waitFor(() => {
      expect(screen.getByText("Unavailable")).toBeDefined();
      expect(screen.getByRole("button", { name: "Hide Advanced" })).toBeDefined();
    });

    expect(mocks.ensureMultiplayerAuth).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Create Lobby" }).hasAttribute("disabled")).toBe(true);
  });

  it("shows retry after auth failure and retries bootstrap", async () => {
    mocks.ensureMultiplayerAuth
      .mockRejectedValueOnce(new Error("Boom"))
      .mockResolvedValueOnce({
        profile: mocks.loaderData.activeProfile,
        client: {},
        user: { id: "user-1" },
      });

    const Component = (Route as unknown as { component: () => JSX.Element }).component;
    render(<Component />);

    await waitFor(() => {
      expect(screen.getByText("Boom")).toBeDefined();
      expect(screen.getByRole("button", { name: "Retry" })).toBeDefined();
    });

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    await waitFor(() => {
      expect(mocks.ensureMultiplayerAuth).toHaveBeenCalledTimes(2);
      expect(screen.getByText("Ready")).toBeDefined();
    });
  });
});
