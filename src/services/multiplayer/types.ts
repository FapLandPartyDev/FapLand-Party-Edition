import type { SupabaseClient, User } from "@supabase/supabase-js";

export type MultiplayerServerProfile = {
  id: string;
  name: string;
  url: string;
  anonKey: string;
  isDefault: boolean;
  isBuiltIn: boolean;
  createdAtIso: string;
  updatedAtIso: string;
  authRequirement?: MultiplayerAuthRequirement;
};

export type MultiplayerLobbyStatus = "waiting" | "running" | "finished" | "closed";
export type MultiplayerPlayerRole = "host" | "player";
export type MultiplayerPlayerState =
  | "joined"
  | "ready"
  | "in_match"
  | "disconnected"
  | "forfeited"
  | "finished"
  | "came"
  | "kicked";

export type MultiplayerLobby = {
  id: string;
  inviteCode: string;
  hostUserId: string;
  hostMachineIdHash: string;
  name: string;
  status: MultiplayerLobbyStatus;
  isOpen: boolean;
  isPublic: boolean;
  allowLateJoin: boolean;
  serverLabel: string | null;
  playlistSnapshotJson: unknown;
  createdAt: string;
  updatedAt: string;
};

export type MultiplayerLobbyPlayer = {
  id: string;
  lobbyId: string;
  userId: string;
  machineIdHash: string;
  displayName: string;
  role: MultiplayerPlayerRole;
  state: MultiplayerPlayerState;
  joinedAt: string;
  lastSeenAt: string;
  finishAt: string | null;
  finalScore: number | null;
  finalPayloadJson: unknown;
};

export type MultiplayerPlayerProgress = {
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
  updatedAt: string;
};

export type MultiplayerAntiPerkEvent = {
  id: string;
  lobbyId: string;
  senderPlayerId: string;
  targetPlayerId: string;
  perkId: string;
  cost: number;
  cooldownUntil: string;
  status: "applied" | "rejected";
  createdAt: string;
};

export type MultiplayerBanRecord = {
  id: string;
  hostUserId: string;
  bannedUserId: string | null;
  bannedMachineIdHash: string | null;
  reason: string | null;
  createdAt: string;
  revokedAt: string | null;
};

export type MultiplayerMatchHistory = {
  id: string;
  lobbyId: string;
  finishedAt: string;
  resultsJson: unknown;
  playlistSnapshotJson: unknown;
  participantsJson: unknown;
};

export type MultiplayerLobbySnapshot = {
  lobby: MultiplayerLobby;
  players: MultiplayerLobbyPlayer[];
  progressByPlayerId: Record<string, MultiplayerPlayerProgress>;
};

export type MultiplayerCreateLobbyResult = {
  lobbyId: string;
  inviteCode: string;
  playerId: string;
  status: MultiplayerLobbyStatus;
};

export type MultiplayerJoinLobbyResult = {
  lobbyId: string;
  inviteCode: string;
  playerId: string;
  status: MultiplayerLobbyStatus;
  isOpen: boolean;
};

export type MultiplayerPublicLobbySummary = {
  lobbyId: string;
  inviteCode: string;
  name: string;
  playlistName: string;
  playerCount: number;
  status: MultiplayerLobbyStatus;
  isOpen: boolean;
  allowLateJoin: boolean;
  requiredRoundCount: number;
  createdAt: string;
};

export type MultiplayerLobbyJoinPreview = {
  lobbyId: string;
  inviteCode: string;
  name: string;
  playlistName: string;
  playerCount: number;
  status: MultiplayerLobbyStatus;
  isOpen: boolean;
  allowLateJoin: boolean;
  requiredRoundCount: number;
  createdAt: string;
};

export type MultiplayerSendAntiPerkResult = {
  id: string;
  lobbyId: string;
  senderPlayerId: string;
  targetPlayerId: string;
  perkId: string;
  cost: number;
  cooldownUntil: string;
  status: "applied" | "rejected";
  createdAt: string;
};

export type MultiplayerAuthRequirement =
  | "anonymous_only"
  | "discord_required"
  | "email_password_required";

export type MultiplayerAuthStatus = {
  profile: MultiplayerServerProfile;
  client: SupabaseClient;
  user: User;
  requirement: MultiplayerAuthRequirement;
  isAnonymous: boolean;
  hasDiscordIdentity: boolean;
  hasEmail: boolean;
  discordLinkUrl: string | null;
  status: "ready" | "needs_discord" | "needs_email" | "needs_login" | "oauth_unavailable" | "error";
  message: string;
};
