import { type RealtimeChannel } from "@supabase/supabase-js";
import { getSupabaseClientForProfile } from "./supabaseClient";
import type {
  MultiplayerAntiPerkEvent,
  MultiplayerPlayerProgress,
  MultiplayerServerProfile,
} from "./types";

type LobbyRealtimeHandlers = {
  onAnyChange?: () => void;
  onAntiPerkEvent?: (event: MultiplayerAntiPerkEvent) => void;
  onPlayerProgressUpsert?: (progress: MultiplayerPlayerProgress) => void;
};

function toPayloadRow(payload: { new: unknown; old: unknown }): Record<string, unknown> | null {
  if (payload.new && typeof payload.new === "object") return payload.new as Record<string, unknown>;
  if (payload.old && typeof payload.old === "object") return payload.old as Record<string, unknown>;
  return null;
}

function rowMatchesLobby(row: Record<string, unknown> | null, lobbyId: string, lobbyIdField: "id" | "lobby_id"): boolean {
  if (!row) return false;
  const value = row[lobbyIdField];
  return typeof value === "string" ? value === lobbyId : String(value ?? "") === lobbyId;
}

function mapAntiPerkEvent(row: Record<string, unknown>): MultiplayerAntiPerkEvent {
  return {
    id: String(row.id),
    lobbyId: String(row.lobby_id),
    senderPlayerId: String(row.sender_player_id),
    targetPlayerId: String(row.target_player_id),
    perkId: String(row.perk_id),
    cost: typeof row.cost === "number" ? row.cost : Number(row.cost ?? 0),
    cooldownUntil: String(row.cooldown_until),
    status: String(row.status) as MultiplayerAntiPerkEvent["status"],
    createdAt: String(row.created_at),
  };
}

function mapProgress(row: Record<string, unknown>): MultiplayerPlayerProgress {
  return {
    lobbyId: String(row.lobby_id),
    playerId: String(row.player_id),
    positionNodeId: row.position_node_id ? String(row.position_node_id) : null,
    positionIndex: typeof row.position_index === "number" ? row.position_index : Number(row.position_index ?? 0),
    money: typeof row.money === "number" ? row.money : Number(row.money ?? 0),
    score: typeof row.score === "number" ? row.score : Number(row.score ?? 0),
    statsJson: row.stats_json ?? {},
    inventoryJson: row.inventory_json ?? [],
    activeEffectsJson: row.active_effects_json ?? [],
    lastRoll: typeof row.last_roll === "number" ? row.last_roll : row.last_roll ? Number(row.last_roll) : null,
    updatedAt: String(row.updated_at ?? new Date().toISOString()),
  };
}

async function unsubscribeChannel(clientChannel: RealtimeChannel): Promise<void> {
  try {
    await clientChannel.unsubscribe();
  } catch (error) {
    console.warn("Failed to unsubscribe lobby realtime channel", error);
  }
}

export async function subscribeLobbyRealtime(
  lobbyId: string,
  handlers: LobbyRealtimeHandlers,
  profile?: MultiplayerServerProfile,
): Promise<() => Promise<void>> {
  const { client } = await getSupabaseClientForProfile(profile);
  const channel = client.channel(`mp-lobby:${lobbyId}:${Math.random().toString(36).slice(2, 8)}`);

  const handleAny = () => {
    handlers.onAnyChange?.();
  };

  channel.on(
    "postgres_changes",
    {
      event: "*",
      schema: "public",
      table: "mp_lobbies",
    },
    (payload) => {
      if (!rowMatchesLobby(toPayloadRow(payload), lobbyId, "id")) return;
      handleAny();
    },
  );

  channel.on(
    "postgres_changes",
    {
      event: "*",
      schema: "public",
      table: "mp_lobby_players",
    },
    (payload) => {
      if (!rowMatchesLobby(toPayloadRow(payload), lobbyId, "lobby_id")) return;
      handleAny();
    },
  );

  channel.on(
    "postgres_changes",
    {
      event: "*",
      schema: "public",
      table: "mp_player_progress",
    },
    (payload) => {
      const row = toPayloadRow(payload);
      if (!rowMatchesLobby(row, lobbyId, "lobby_id")) return;
      if (row && payload.eventType !== "DELETE") {
        handlers.onPlayerProgressUpsert?.(mapProgress(row));
      }
      handleAny();
    },
  );

  channel.on(
    "postgres_changes",
    {
      event: "INSERT",
      schema: "public",
      table: "mp_anti_perk_events",
    },
    (payload) => {
      const row = toPayloadRow(payload);
      if (!row || !rowMatchesLobby(row, lobbyId, "lobby_id")) return;
      handlers.onAntiPerkEvent?.(mapAntiPerkEvent(row));
      handleAny();
    },
  );

  channel.subscribe((status) => {
    if (status === "SUBSCRIBED") {
      handleAny();
    }
  });

  return async () => {
    await unsubscribeChannel(channel);
  };
}
