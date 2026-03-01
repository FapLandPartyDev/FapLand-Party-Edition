import type { SupabaseClient } from "@supabase/supabase-js";
import {
  getMultiplayerContext,
  getSupabaseClientForProfile,
} from "./supabaseClient";
import type {
  MultiplayerAntiPerkEvent,
  MultiplayerBanRecord,
  MultiplayerCreateLobbyResult,
  MultiplayerJoinLobbyResult,
  MultiplayerLobby,
  MultiplayerLobbyPlayer,
  MultiplayerLobbySnapshot,
  MultiplayerMatchHistory,
  MultiplayerPlayerProgress,
  MultiplayerSendAntiPerkResult,
  MultiplayerServerProfile,
} from "./types";

function toErrorMessage(error: unknown, fallback: string): string {
  if (error && typeof error === "object" && "message" in error && typeof (error as { message: unknown }).message === "string") {
    return (error as { message: string }).message;
  }
  return fallback;
}

function assertNoSupabaseError(error: unknown, fallback: string): void {
  if (!error) return;
  throw new Error(toErrorMessage(error, fallback));
}

function isIgnorableProgressUpdateError(error: unknown): boolean {
  const message = toErrorMessage(error, "");
  return message === "Player not allowed to update progress";
}

function mapLobby(row: Record<string, unknown>): MultiplayerLobby {
  return {
    id: String(row.id),
    inviteCode: String(row.invite_code),
    hostUserId: String(row.host_user_id),
    hostMachineIdHash: String(row.host_machine_id_hash),
    name: String(row.name),
    status: String(row.status) as MultiplayerLobby["status"],
    isOpen: Boolean(row.is_open),
    allowLateJoin: Boolean(row.allow_late_join),
    serverLabel: row.server_label ? String(row.server_label) : null,
    playlistSnapshotJson: row.playlist_snapshot_json,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function mapLobbyPlayer(row: Record<string, unknown>): MultiplayerLobbyPlayer {
  return {
    id: String(row.id),
    lobbyId: String(row.lobby_id),
    userId: String(row.user_id),
    machineIdHash: String(row.machine_id_hash),
    displayName: String(row.display_name),
    role: String(row.role) as MultiplayerLobbyPlayer["role"],
    state: String(row.state) as MultiplayerLobbyPlayer["state"],
    joinedAt: String(row.joined_at),
    lastSeenAt: String(row.last_seen_at),
    finishAt: row.finish_at ? String(row.finish_at) : null,
    finalScore: typeof row.final_score === "number" ? row.final_score : row.final_score ? Number(row.final_score) : null,
    finalPayloadJson: row.final_payload_json ?? {},
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
    updatedAt: String(row.updated_at),
  };
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

function mapBan(row: Record<string, unknown>): MultiplayerBanRecord {
  return {
    id: String(row.id),
    hostUserId: String(row.host_user_id),
    bannedUserId: row.banned_user_id ? String(row.banned_user_id) : null,
    bannedMachineIdHash: row.banned_machine_id_hash ? String(row.banned_machine_id_hash) : null,
    reason: row.reason ? String(row.reason) : null,
    createdAt: String(row.created_at),
    revokedAt: row.revoked_at ? String(row.revoked_at) : null,
  };
}

function mapHistory(row: Record<string, unknown>): MultiplayerMatchHistory {
  return {
    id: String(row.id),
    lobbyId: String(row.lobby_id),
    finishedAt: String(row.finished_at),
    resultsJson: row.results_json,
    playlistSnapshotJson: row.playlist_snapshot_json,
    participantsJson: row.participants_json,
  };
}

async function withClient(profile?: MultiplayerServerProfile): Promise<{ client: SupabaseClient; userId: string; machineIdHash: string }> {
  const { client, user, machineIdHash } = await getMultiplayerContext(profile);
  return {
    client,
    userId: user.id,
    machineIdHash,
  };
}

export async function getLobbyByInviteCode(inviteCode: string, profile?: MultiplayerServerProfile): Promise<MultiplayerLobby | null> {
  const { client } = await getSupabaseClientForProfile(profile);
  const { data, error } = await client
    .from("mp_lobbies")
    .select("*")
    .eq("invite_code", inviteCode.trim().toUpperCase())
    .maybeSingle();

  if (error && error.code !== "PGRST116") {
    throw new Error(error.message);
  }

  if (!data) return null;
  return mapLobby(data as Record<string, unknown>);
}

export async function getLobbyById(lobbyId: string, profile?: MultiplayerServerProfile): Promise<MultiplayerLobby | null> {
  const { client } = await getSupabaseClientForProfile(profile);
  const { data, error } = await client
    .from("mp_lobbies")
    .select("*")
    .eq("id", lobbyId)
    .maybeSingle();

  if (error && error.code !== "PGRST116") {
    throw new Error(error.message);
  }

  if (!data) return null;
  return mapLobby(data as Record<string, unknown>);
}

export async function listLobbyPlayers(lobbyId: string, profile?: MultiplayerServerProfile): Promise<MultiplayerLobbyPlayer[]> {
  const { client } = await getSupabaseClientForProfile(profile);
  const { data, error } = await client
    .from("mp_lobby_players")
    .select("*")
    .eq("lobby_id", lobbyId)
    .order("joined_at", { ascending: true });

  assertNoSupabaseError(error, "Failed to load lobby players.");
  return (data ?? []).map((row) => mapLobbyPlayer(row as Record<string, unknown>));
}

export async function listLobbyProgress(lobbyId: string, profile?: MultiplayerServerProfile): Promise<Record<string, MultiplayerPlayerProgress>> {
  const { client } = await getSupabaseClientForProfile(profile);
  const { data, error } = await client
    .from("mp_player_progress")
    .select("*")
    .eq("lobby_id", lobbyId);

  assertNoSupabaseError(error, "Failed to load lobby progress.");

  return (data ?? []).reduce<Record<string, MultiplayerPlayerProgress>>((acc, row) => {
    const mapped = mapProgress(row as Record<string, unknown>);
    acc[mapped.playerId] = mapped;
    return acc;
  }, {});
}

export async function getLobbySnapshot(lobbyId: string, profile?: MultiplayerServerProfile): Promise<MultiplayerLobbySnapshot | null> {
  const lobby = await getLobbyById(lobbyId, profile);
  if (!lobby) return null;

  const [players, progressByPlayerId] = await Promise.all([
    listLobbyPlayers(lobbyId, profile),
    listLobbyProgress(lobbyId, profile),
  ]);

  return { lobby, players, progressByPlayerId };
}

export async function getOwnLobbyPlayer(lobbyId: string, profile?: MultiplayerServerProfile): Promise<MultiplayerLobbyPlayer | null> {
  const { client, userId } = await withClient(profile);
  const { data, error } = await client
    .from("mp_lobby_players")
    .select("*")
    .eq("lobby_id", lobbyId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error && error.code !== "PGRST116") {
    throw new Error(error.message);
  }

  if (!data) return null;
  return mapLobbyPlayer(data as Record<string, unknown>);
}

export async function createLobby(input: {
  name: string;
  playlistSnapshotJson: unknown;
  displayName: string;
  allowLateJoin?: boolean;
  serverLabel?: string | null;
}, profile?: MultiplayerServerProfile): Promise<MultiplayerCreateLobbyResult> {
  const { client, machineIdHash } = await withClient(profile);
  const { data, error } = await client.rpc("mp_create_lobby", {
    p_name: input.name,
    p_playlist_snapshot_json: input.playlistSnapshotJson,
    p_machine_id_hash: machineIdHash,
    p_display_name: input.displayName,
    p_allow_late_join: input.allowLateJoin ?? true,
    p_server_label: input.serverLabel ?? null,
  });

  assertNoSupabaseError(error, "Failed to create lobby.");

  const payload = data as Record<string, unknown>;
  return {
    lobbyId: String(payload.lobby_id),
    inviteCode: String(payload.invite_code),
    playerId: String(payload.player_id),
    status: String(payload.status) as MultiplayerCreateLobbyResult["status"],
  };
}

export async function joinLobby(input: {
  inviteCode: string;
  displayName: string;
}, profile?: MultiplayerServerProfile): Promise<MultiplayerJoinLobbyResult> {
  const { client, machineIdHash } = await withClient(profile);
  const { data, error } = await client.rpc("mp_join_lobby", {
    p_invite_code: input.inviteCode,
    p_machine_id_hash: machineIdHash,
    p_display_name: input.displayName,
  });

  assertNoSupabaseError(error, "Failed to join lobby.");

  const payload = data as Record<string, unknown>;
  return {
    lobbyId: String(payload.lobby_id),
    inviteCode: String(payload.invite_code),
    playerId: String(payload.player_id),
    status: String(payload.status) as MultiplayerJoinLobbyResult["status"],
    isOpen: Boolean(payload.is_open),
  };
}

export async function setLobbyReady(input: {
  lobbyId: string;
  playerId: string;
  mappingJson: unknown;
  unresolvedCount: number;
}, profile?: MultiplayerServerProfile): Promise<void> {
  const { client } = await withClient(profile);
  const { error } = await client.rpc("mp_set_ready", {
    p_lobby_id: input.lobbyId,
    p_player_id: input.playerId,
    p_mapping_json: input.mappingJson,
    p_unresolved_count: input.unresolvedCount,
  });

  assertNoSupabaseError(error, "Failed to set ready state.");
}

export async function startLobbyForAll(lobbyId: string, profile?: MultiplayerServerProfile): Promise<void> {
  const { client } = await withClient(profile);
  const { error } = await client.rpc("mp_start_for_all", {
    p_lobby_id: lobbyId,
  });

  assertNoSupabaseError(error, "Failed to start lobby for all players.");
}

export async function setLobbyOpenState(lobbyId: string, isOpen: boolean, profile?: MultiplayerServerProfile): Promise<void> {
  const { client } = await withClient(profile);
  const { error } = await client.rpc("mp_set_lobby_open", {
    p_lobby_id: lobbyId,
    p_is_open: isOpen,
  });

  assertNoSupabaseError(error, "Failed to update lobby state.");
}

export async function kickLobbyPlayer(lobbyId: string, targetPlayerId: string, profile?: MultiplayerServerProfile): Promise<void> {
  const { client } = await withClient(profile);
  const { error } = await client.rpc("mp_kick_player", {
    p_lobby_id: lobbyId,
    p_target_player_id: targetPlayerId,
  });

  assertNoSupabaseError(error, "Failed to kick player.");
}

export async function banLobbyPlayer(lobbyId: string, targetPlayerId: string, reason: string | null, profile?: MultiplayerServerProfile): Promise<string> {
  const { client } = await withClient(profile);
  const { data, error } = await client.rpc("mp_ban_player", {
    p_lobby_id: lobbyId,
    p_target_player_id: targetPlayerId,
    p_reason: reason,
  });

  assertNoSupabaseError(error, "Failed to ban player.");
  return String(data);
}

export async function listActiveBans(profile?: MultiplayerServerProfile): Promise<MultiplayerBanRecord[]> {
  const { client } = await withClient(profile);
  const { data, error } = await client
    .from("mp_bans")
    .select("*")
    .is("revoked_at", null)
    .order("created_at", { ascending: false });

  assertNoSupabaseError(error, "Failed to list bans.");
  return (data ?? []).map((row) => mapBan(row as Record<string, unknown>));
}

export async function unbanPlayer(banId: string, profile?: MultiplayerServerProfile): Promise<void> {
  const { client } = await withClient(profile);
  const { error } = await client.rpc("mp_unban", {
    p_ban_id: banId,
  });

  assertNoSupabaseError(error, "Failed to unban player.");
}

export async function sendAntiPerk(input: {
  lobbyId: string;
  senderPlayerId: string;
  targetPlayerId: string;
  perkId: string;
  cost: number;
  cooldownSeconds?: number;
}, profile?: MultiplayerServerProfile): Promise<MultiplayerSendAntiPerkResult> {
  const { client } = await withClient(profile);
  const { data, error } = await client.rpc("mp_send_anti_perk", {
    p_lobby_id: input.lobbyId,
    p_sender_player_id: input.senderPlayerId,
    p_target_player_id: input.targetPlayerId,
    p_perk_id: input.perkId,
    p_cost: input.cost,
    p_cooldown_seconds: input.cooldownSeconds ?? 10,
  });

  assertNoSupabaseError(error, "Failed to send anti-perk.");

  const payload = data as Record<string, unknown>;
  return {
    id: String(payload.id),
    lobbyId: String(payload.lobby_id),
    senderPlayerId: String(payload.sender_player_id),
    targetPlayerId: String(payload.target_player_id),
    perkId: String(payload.perk_id),
    cost: Number(payload.cost ?? 0),
    cooldownUntil: String(payload.cooldown_until),
    status: String(payload.status) as MultiplayerSendAntiPerkResult["status"],
    createdAt: String(payload.created_at),
  };
}

export async function updateOwnProgress(input: {
  lobbyId: string;
  playerId: string;
  positionNodeId: string | null;
  positionIndex: number;
  money: number;
  score: number;
  statsJson: unknown;
  inventoryJson: unknown;
  activeEffectsJson: unknown;
  lastRoll: number | null;
}, profile?: MultiplayerServerProfile): Promise<void> {
  const { client } = await withClient(profile);
  const { error } = await client.rpc("mp_update_progress", {
    p_lobby_id: input.lobbyId,
    p_player_id: input.playerId,
    p_position_node_id: input.positionNodeId,
    p_position_index: input.positionIndex,
    p_money: input.money,
    p_score: input.score,
    p_stats_json: input.statsJson,
    p_inventory_json: input.inventoryJson,
    p_active_effects_json: input.activeEffectsJson,
    p_last_roll: input.lastRoll,
  });

  if (isIgnorableProgressUpdateError(error)) {
    return;
  }
  assertNoSupabaseError(error, "Failed to update player progress.");
}

export async function heartbeat(lobbyId: string, playerId: string, profile?: MultiplayerServerProfile): Promise<void> {
  const { client } = await withClient(profile);
  const { error } = await client.rpc("mp_heartbeat", {
    p_lobby_id: lobbyId,
    p_player_id: playerId,
  });

  assertNoSupabaseError(error, "Failed to heartbeat.");
}

export async function markDisconnected(lobbyId: string, playerId: string, profile?: MultiplayerServerProfile): Promise<void> {
  const { client } = await withClient(profile);
  const { error } = await client.rpc("mp_mark_disconnected", {
    p_lobby_id: lobbyId,
    p_player_id: playerId,
  });

  assertNoSupabaseError(error, "Failed to mark disconnected.");
}

export async function sweepForfeits(lobbyId: string, graceSeconds = 300, profile?: MultiplayerServerProfile): Promise<number> {
  const { client } = await withClient(profile);
  const { data, error } = await client.rpc("mp_sweep_forfeits", {
    p_lobby_id: lobbyId,
    p_grace_seconds: graceSeconds,
  });

  assertNoSupabaseError(error, "Failed to sweep forfeits.");
  return typeof data === "number" ? data : Number(data ?? 0);
}

export async function finishPlayer(
  lobbyId: string,
  playerId: string,
  finalScore: number,
  options?: { finalState?: "finished" | "came" | "forfeited"; finalPayload?: unknown },
  profile?: MultiplayerServerProfile,
): Promise<void> {
  const { client } = await withClient(profile);
  const { error } = await client.rpc("mp_finish_player", {
    p_lobby_id: lobbyId,
    p_player_id: playerId,
    p_final_score: finalScore,
    p_final_payload: options?.finalPayload ?? {},
    p_final_state: options?.finalState ?? "finished",
  });

  assertNoSupabaseError(error, "Failed to finish player.");
}

export async function finalizeMatchIfComplete(lobbyId: string, profile?: MultiplayerServerProfile): Promise<boolean> {
  const { client } = await withClient(profile);
  const { data, error } = await client.rpc("mp_finalize_match_if_complete", {
    p_lobby_id: lobbyId,
  });

  assertNoSupabaseError(error, "Failed to finalize match.");
  return Boolean(data);
}

export async function listRecentAntiPerkEvents(lobbyId: string, profile?: MultiplayerServerProfile): Promise<MultiplayerAntiPerkEvent[]> {
  const { client } = await getSupabaseClientForProfile(profile);
  const { data, error } = await client
    .from("mp_anti_perk_events")
    .select("*")
    .eq("lobby_id", lobbyId)
    .order("created_at", { ascending: false })
    .limit(30);

  assertNoSupabaseError(error, "Failed to fetch anti-perk events.");
  return (data ?? []).map((row) => mapAntiPerkEvent(row as Record<string, unknown>));
}

export async function listMatchHistory(profile?: MultiplayerServerProfile): Promise<MultiplayerMatchHistory[]> {
  const { client } = await withClient(profile);
  const { data, error } = await client
    .from("mp_match_history")
    .select("*")
    .order("finished_at", { ascending: false })
    .limit(50);

  assertNoSupabaseError(error, "Failed to fetch match history.");
  return (data ?? []).map((row) => mapHistory(row as Record<string, unknown>));
}

export async function getMatchHistoryByLobby(lobbyId: string, profile?: MultiplayerServerProfile): Promise<MultiplayerMatchHistory | null> {
  const { client } = await withClient(profile);
  const { data, error } = await client
    .from("mp_match_history")
    .select("*")
    .eq("lobby_id", lobbyId)
    .maybeSingle();

  if (error && error.code !== "PGRST116") {
    throw new Error(error.message);
  }

  if (!data) return null;
  return mapHistory(data as Record<string, unknown>);
}
