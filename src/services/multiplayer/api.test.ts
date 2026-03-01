import { beforeEach, describe, expect, it, vi } from "vitest";

const rpcMock = vi.fn();

vi.mock("./supabaseClient", () => ({
  getMultiplayerContext: vi.fn(async () => ({
    client: {
      rpc: rpcMock,
      from: vi.fn(),
    },
    user: { id: "user-1" },
    machineIdHash: "machine-1",
  })),
  getSupabaseClientForProfile: vi.fn(async () => ({
    client: {
      from: vi.fn(),
    },
  })),
}));

import { finishPlayer, sendAntiPerk, startLobbyForAll, updateOwnProgress } from "./api";

describe("multiplayer api finishPlayer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    rpcMock.mockResolvedValue({ data: null, error: null });
  });

  it("sends came terminal state and payload", async () => {
    await finishPlayer("lobby-1", "player-1", 420, {
      finalState: "came",
      finalPayload: { completionReason: "self_reported_cum" },
    });

    expect(rpcMock).toHaveBeenCalledWith("mp_finish_player", expect.objectContaining({
      p_lobby_id: "lobby-1",
      p_player_id: "player-1",
      p_final_score: 420,
      p_final_state: "came",
      p_final_payload: { completionReason: "self_reported_cum" },
    }));
  });

  it("defaults to finished state when no options are provided", async () => {
    await finishPlayer("lobby-2", "player-2", 77);

    expect(rpcMock).toHaveBeenCalledWith("mp_finish_player", expect.objectContaining({
      p_lobby_id: "lobby-2",
      p_player_id: "player-2",
      p_final_score: 77,
      p_final_state: "finished",
      p_final_payload: {},
    }));
  });

  it("forwards forfeited terminal state", async () => {
    await finishPlayer("lobby-3", "player-3", 12, {
      finalState: "forfeited",
      finalPayload: { completionReason: "gave_up" },
    });

    expect(rpcMock).toHaveBeenCalledWith("mp_finish_player", expect.objectContaining({
      p_lobby_id: "lobby-3",
      p_player_id: "player-3",
      p_final_score: 12,
      p_final_state: "forfeited",
      p_final_payload: { completionReason: "gave_up" },
    }));
  });
});

describe("multiplayer api sendAntiPerk", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("forwards high anti-perk cost to RPC payload", async () => {
    rpcMock.mockResolvedValue({
      data: {
        id: "event-1",
        lobby_id: "lobby-1",
        sender_player_id: "sender-1",
        target_player_id: "target-1",
        perk_id: "jammed-dice",
        cost: 240,
        cooldown_until: "2026-03-05T00:00:00.000Z",
        status: "applied",
        created_at: "2026-03-05T00:00:00.000Z",
      },
      error: null,
    });

    await sendAntiPerk({
      lobbyId: "lobby-1",
      senderPlayerId: "sender-1",
      targetPlayerId: "target-1",
      perkId: "jammed-dice",
      cost: 240,
      cooldownSeconds: 0,
    });

    expect(rpcMock).toHaveBeenCalledWith("mp_send_anti_perk", expect.objectContaining({
      p_lobby_id: "lobby-1",
      p_sender_player_id: "sender-1",
      p_target_player_id: "target-1",
      p_perk_id: "jammed-dice",
      p_cost: 240,
      p_cooldown_seconds: 0,
    }));
  });

  it("bubbles insufficient funds error from RPC", async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: { message: "Not enough money" },
    });

    await expect(
      sendAntiPerk({
        lobbyId: "lobby-1",
        senderPlayerId: "sender-1",
        targetPlayerId: "target-1",
        perkId: "jammed-dice",
        cost: 240,
      }),
    ).rejects.toThrow("Not enough money");
  });
});

describe("multiplayer api startLobbyForAll", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    rpcMock.mockResolvedValue({ data: null, error: null });
  });

  it("calls mp_start_for_all with lobby id", async () => {
    await startLobbyForAll("lobby-1");

    expect(rpcMock).toHaveBeenCalledWith("mp_start_for_all", {
      p_lobby_id: "lobby-1",
    });
  });

  it("bubbles RPC errors", async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: { message: "Host must be ready" },
    });

    await expect(startLobbyForAll("lobby-1")).rejects.toThrow("Host must be ready");
  });
});

describe("multiplayer api updateOwnProgress", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("ignores known unauthorized-progress race error", async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: { message: "Player not allowed to update progress" },
    });

    await expect(updateOwnProgress({
      lobbyId: "lobby-1",
      playerId: "player-1",
      positionNodeId: "node-1",
      positionIndex: 1,
      money: 10,
      score: 20,
      statsJson: {},
      inventoryJson: [],
      activeEffectsJson: [],
      lastRoll: 3,
    })).resolves.toBeUndefined();
  });

  it("still throws for other RPC errors", async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: { message: "Failed to update player progress" },
    });

    await expect(updateOwnProgress({
      lobbyId: "lobby-1",
      playerId: "player-1",
      positionNodeId: "node-1",
      positionIndex: 1,
      money: 10,
      score: 20,
      statsJson: {},
      inventoryJson: [],
      activeEffectsJson: [],
      lastRoll: 3,
    })).rejects.toThrow("Failed to update player progress");
  });
});
