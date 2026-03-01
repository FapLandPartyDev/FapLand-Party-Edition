import { describe, expect, it } from "vitest";
import { buildTemporaryStandings, hasActivePlayers, parseStandingsJson } from "./results";
import type { MultiplayerLobbySnapshot } from "./types";

function makeSnapshot(): MultiplayerLobbySnapshot {
  return {
    lobby: {
      id: "lobby-1",
      inviteCode: "ABC123",
      hostUserId: "user-host",
      hostMachineIdHash: "machine-host",
      name: "Lobby",
      status: "running",
      isOpen: true,
      allowLateJoin: true,
      serverLabel: "Local",
      playlistSnapshotJson: {},
      createdAt: "2026-03-05T12:00:00.000Z",
      updatedAt: "2026-03-05T12:00:00.000Z",
    },
    players: [
      {
        id: "p1",
        lobbyId: "lobby-1",
        userId: "u1",
        machineIdHash: "m1",
        displayName: "Alpha",
        role: "player",
        state: "in_match",
        joinedAt: "2026-03-05T12:00:00.000Z",
        lastSeenAt: "2026-03-05T12:01:00.000Z",
        finishAt: null,
        finalScore: null,
        finalPayloadJson: {},
      },
      {
        id: "p2",
        lobbyId: "lobby-1",
        userId: "u2",
        machineIdHash: "m2",
        displayName: "Beta",
        role: "player",
        state: "came",
        joinedAt: "2026-03-05T12:00:00.000Z",
        lastSeenAt: "2026-03-05T12:01:00.000Z",
        finishAt: "2026-03-05T12:02:00.000Z",
        finalScore: 220,
        finalPayloadJson: {},
      },
    ],
    progressByPlayerId: {
      p1: {
        lobbyId: "lobby-1",
        playerId: "p1",
        positionNodeId: "node-1",
        positionIndex: 5,
        money: 100,
        score: 180,
        statsJson: {},
        inventoryJson: [],
        activeEffectsJson: [],
        lastRoll: 4,
        updatedAt: "2026-03-05T12:01:00.000Z",
      },
    },
  };
}

describe("multiplayer result helpers", () => {
  it("builds temporary standings with ids and sorted placement", () => {
    const rows = buildTemporaryStandings(makeSnapshot());
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      playerId: "p2",
      userId: "u2",
      displayName: "Beta",
      finalScore: 220,
      place: 1,
    });
    expect(rows[1]).toMatchObject({
      playerId: "p1",
      userId: "u1",
      displayName: "Alpha",
      finalScore: 180,
      place: 2,
    });
  });

  it("flags active players and parses cached result json ids", () => {
    const snapshot = makeSnapshot();
    expect(hasActivePlayers(snapshot)).toBe(true);

    const parsed = parseStandingsJson([{
      player_id: "p3",
      user_id: "u3",
      display_name: "Gamma",
      state: "finished",
      final_score: 99,
      finish_at: "2026-03-05T12:03:00.000Z",
    }]);
    expect(parsed[0]).toMatchObject({
      playerId: "p3",
      userId: "u3",
      displayName: "Gamma",
      place: 1,
    });
  });
});

