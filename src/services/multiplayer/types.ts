export type MultiplayerServerProfile = {
  id: string;
  name: string;
  url: string;
  anonKey: string;
  isDefault: boolean;
  createdAtIso: string;
  updatedAtIso: string;
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
