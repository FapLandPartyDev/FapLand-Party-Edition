import { describe, expect, it } from "vitest";
import { getMultiplayerSessionNotifications } from "./sessionNotifications";
import type { MultiplayerLobbyPlayer } from "./types";

function makePlayer(overrides: Partial<MultiplayerLobbyPlayer> = {}): MultiplayerLobbyPlayer {
  return {
    id: "player-1",
    lobbyId: "lobby-1",
    userId: "user-1",
    machineIdHash: "machine-1",
    displayName: "Player One",
    role: "player",
    state: "joined",
    joinedAt: "2026-03-20T10:00:00.000Z",
    lastSeenAt: "2026-03-20T10:00:00.000Z",
    finishAt: null,
    finalScore: null,
    finalPayloadJson: {},
    ...overrides,
  };
}

describe("getMultiplayerSessionNotifications", () => {
  it("reports a newly joined player", () => {
    const notifications = getMultiplayerSessionNotifications(
      [],
      [makePlayer({ id: "player-2", displayName: "Ava", state: "in_match" })],
      "player-1"
    );

    expect(notifications).toEqual([
      {
        id: "player-2:missing:in_match",
        message: "Ava joined the session ✨",
      },
    ]);
  });

  it("reports a disconnected player", () => {
    const notifications = getMultiplayerSessionNotifications(
      [makePlayer({ id: "player-2", displayName: "Ava", state: "in_match" })],
      [makePlayer({ id: "player-2", displayName: "Ava", state: "disconnected" })],
      "player-1"
    );

    expect(notifications).toEqual([
      {
        id: "player-2:in_match:disconnected",
        message: "Ava disconnected 📡",
      },
    ]);
  });

  it("reports a cum completion with themed wording", () => {
    const notifications = getMultiplayerSessionNotifications(
      [makePlayer({ id: "player-2", displayName: "Ava", state: "in_match" })],
      [
        makePlayer({
          id: "player-2",
          displayName: "Ava",
          state: "came",
          finalPayloadJson: { completionReason: "self_reported_cum" },
        }),
      ],
      "player-1"
    );

    expect(notifications).toEqual([
      {
        id: "player-2:in_match:came",
        message: "Ava came 💦",
      },
    ]);
  });

  it("reports a rejoin after disconnect", () => {
    const notifications = getMultiplayerSessionNotifications(
      [makePlayer({ id: "player-2", displayName: "Ava", state: "disconnected" })],
      [makePlayer({ id: "player-2", displayName: "Ava", state: "in_match" })],
      "player-1"
    );

    expect(notifications).toEqual([
      {
        id: "player-2:disconnected:in_match",
        message: "Ava rejoined the session 🔌",
      },
    ]);
  });

  it("ignores the local player", () => {
    const notifications = getMultiplayerSessionNotifications(
      [makePlayer({ id: "player-1", displayName: "Me", state: "in_match" })],
      [makePlayer({ id: "player-1", displayName: "Me", state: "came" })],
      "player-1"
    );

    expect(notifications).toEqual([]);
  });
});
