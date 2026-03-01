import type { ReactElement } from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  loaderData: {
    search: {
      lobbyId: "lobby-1",
      inviteCode: "ABCD",
      playerId: "player-1",
    },
    initialSnapshot: {
      lobby: {
        id: "lobby-1",
        inviteCode: "ABCD",
        hostUserId: "host-1",
        hostMachineIdHash: "machine-host",
        name: "Test Lobby",
        status: "waiting",
        isOpen: true,
        isPublic: false,
        allowLateJoin: false,
        serverLabel: "F-Land Online",
        playlistSnapshotJson: {
          config: {
            playlistVersion: 1,
            boardConfig: {
              mode: "linear",
              totalIndices: 3,
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
          },
          difficultyHintsByRefKey: {},
          exportedAt: "2026-03-09T00:00:00.000Z",
        },
        createdAt: "2026-03-09T00:00:00.000Z",
        updatedAt: "2026-03-09T00:00:00.000Z",
      },
      players: [
        {
          id: "player-1",
          lobbyId: "lobby-1",
          userId: "user-1",
          machineIdHash: "machine-1",
          displayName: "Tester",
          role: "player",
          state: "joined",
          joinedAt: "2026-03-09T00:00:00.000Z",
          lastSeenAt: "2026-03-09T00:00:00.000Z",
          finishAt: null,
          finalScore: null,
          finalPayloadJson: null,
        },
      ],
      progressByPlayerId: {},
    },
    initialOwnPlayer: {
      id: "player-1",
      lobbyId: "lobby-1",
      userId: "user-1",
      machineIdHash: "machine-1",
      displayName: "Tester",
      role: "player",
      state: "joined",
      joinedAt: "2026-03-09T00:00:00.000Z",
      lastSeenAt: "2026-03-09T00:00:00.000Z",
      finishAt: null,
      finalScore: null,
      finalPayloadJson: null,
    },
    installedRounds: [],
  },
  navigate: vi.fn(),
  db: {
    round: {
      findInstalled: vi.fn(async () => []),
    },
  },
  multiplayer: {
    banLobbyPlayer: vi.fn(),
    getLobbySnapshot: vi.fn(),
    getOwnLobbyPlayer: vi.fn(),
    heartbeat: vi.fn(),
    isTerminalPlayerState: vi.fn((state: string) => ["kicked", "forfeited", "finished", "came"].includes(state)),
    kickLobbyPlayer: vi.fn(),
    markDisconnected: vi.fn(),
    resolvePlaylistConflicts: vi.fn(),
    setLobbyPublicState: vi.fn(),
    setLobbyOpenState: vi.fn(),
    setLobbyReady: vi.fn(),
    startLobbyForAll: vi.fn(),
    subscribeLobbyRealtime: vi.fn(async () => async () => undefined),
    sweepForfeits: vi.fn(),
  },
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (config: Record<string, unknown>) => ({
    ...config,
    useLoaderData: () => mocks.loaderData,
  }),
  useNavigate: () => mocks.navigate,
}));

vi.mock("../components/multiplayer/MultiplayerUpdateGuard", () => ({
  MultiplayerUpdateGuard: ({ children }: { children: ReactElement }) => children,
}));

vi.mock("../components/AnimatedBackground", () => ({
  AnimatedBackground: () => null,
}));

vi.mock("../services/db", () => ({
  db: mocks.db,
}));

vi.mock("../services/multiplayer", () => mocks.multiplayer);

vi.mock("../hooks/useMultiplayerSfwGuard", () => ({
  assertMultiplayerAllowed: vi.fn(),
  useMultiplayerSfwRedirect: () => false,
}));

import { Route } from "./multiplayer-lobby";

beforeEach(() => {
  window.localStorage.clear();
  mocks.loaderData.initialSnapshot.lobby.hostUserId = "host-1";
  mocks.loaderData.initialSnapshot.lobby.isPublic = false;
  mocks.loaderData.initialOwnPlayer.role = "player";
  mocks.multiplayer.getLobbySnapshot.mockResolvedValue(mocks.loaderData.initialSnapshot);
  mocks.multiplayer.getOwnLobbyPlayer.mockResolvedValue(mocks.loaderData.initialOwnPlayer);
  mocks.multiplayer.heartbeat.mockResolvedValue(undefined);
  mocks.multiplayer.sweepForfeits.mockResolvedValue(undefined);
  mocks.multiplayer.setLobbyReady.mockResolvedValue(undefined);
  mocks.multiplayer.setLobbyPublicState.mockResolvedValue(undefined);
  mocks.multiplayer.resolvePlaylistConflicts.mockReturnValue({
    exactMapping: {},
    suggestedMapping: {},
    issues: [
      {
        key: "linear.normalRoundOrder.0",
        label: "Normal round queue #1",
        kind: "missing",
        ref: { name: "Missing Round", type: "Normal" },
        defaultRoundId: null,
        suggestions: [],
      },
    ],
    counts: {
      exact: 0,
      suggested: 0,
      missing: 1,
    },
    mapping: {},
    unresolved: [
      {
        key: "linear.normalRoundOrder.0",
        label: "Normal round queue #1",
        kind: "missing",
        ref: { name: "Missing Round", type: "Normal" },
        defaultRoundId: null,
        suggestions: [],
      },
    ],
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("MultiplayerLobbyRoute", () => {
  it("shows resolver UI and blocks ready while refs remain unresolved", async () => {
    const Component = (Route as unknown as { component: () => ReactElement }).component;
    render(<Component />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Resolve Missing" })).toBeDefined();
      expect(screen.getByText("Playlist Resolution")).toBeDefined();
    });

    expect(screen.getByRole("button", { name: "Ready (Manual Retry)" }).hasAttribute("disabled")).toBe(true);
  });

  it("restores saved manual overrides from local storage and unblocks ready", async () => {
    window.localStorage.setItem(
      "multiplayer-playlist-resolution:lobby-1:player-1:2026-03-09T00:00:00.000Z",
      JSON.stringify({
        "linear.normalRoundOrder.0": "round-installed",
      }),
    );

    const Component = (Route as unknown as { component: () => ReactElement }).component;
    render(<Component />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Ready (Manual Retry)" }).hasAttribute("disabled")).toBe(false);
    });
  });

  it("shows a host visibility toggle for public advertising", async () => {
    mocks.loaderData.initialSnapshot.lobby.hostUserId = "user-1";
    mocks.loaderData.initialOwnPlayer.role = "host";

    const Component = (Route as unknown as { component: () => ReactElement }).component;
    render(<Component />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Private Lobby (Click to Advertise)" })).toBeDefined();
    });
  });
});
