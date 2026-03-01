import type { MultiplayerLobbyPlayer, MultiplayerPlayerState } from "./types";

export type MultiplayerSessionNotification = {
  id: string;
  message: string;
};

type CompletionReason =
  | "finished"
  | "self_reported_cum"
  | "cum_instruction_failed"
  | "gave_up"
  | null;

const ACTIVE_PLAYER_STATES = new Set<MultiplayerPlayerState>(["joined", "ready", "in_match"]);
const LEAVING_PLAYER_STATES = new Set<MultiplayerPlayerState>([
  "disconnected",
  "forfeited",
  "finished",
  "came",
  "kicked",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function toCompletionReason(player: MultiplayerLobbyPlayer): CompletionReason {
  if (!isRecord(player.finalPayloadJson)) return null;
  const reason = player.finalPayloadJson.completionReason;
  if (
    reason === "finished" ||
    reason === "self_reported_cum" ||
    reason === "cum_instruction_failed" ||
    reason === "gave_up"
  ) {
    return reason;
  }
  return null;
}

function isActivePlayerState(state: MultiplayerPlayerState): boolean {
  return ACTIVE_PLAYER_STATES.has(state);
}

function isLeavingPlayerState(state: MultiplayerPlayerState): boolean {
  return LEAVING_PLAYER_STATES.has(state);
}

function formatJoinMessage(player: MultiplayerLobbyPlayer, rejoined: boolean): string {
  return rejoined
    ? `${player.displayName} rejoined the session 🔌`
    : `${player.displayName} joined the session ✨`;
}

function formatLeaveMessage(player: MultiplayerLobbyPlayer): string {
  const completionReason = toCompletionReason(player);
  if (
    player.state === "came" ||
    completionReason === "self_reported_cum" ||
    completionReason === "cum_instruction_failed"
  ) {
    return `${player.displayName} came 💦`;
  }
  if (player.state === "finished" || completionReason === "finished") {
    return `${player.displayName} finished the run 🏁`;
  }
  if (player.state === "forfeited" && completionReason === "gave_up") {
    return `${player.displayName} gave up 🏳️`;
  }
  if (player.state === "forfeited") {
    return `${player.displayName} forfeited the session ⏱️`;
  }
  if (player.state === "kicked") {
    return `${player.displayName} was kicked 👢`;
  }
  if (player.state === "disconnected") {
    return `${player.displayName} disconnected 📡`;
  }
  return `${player.displayName} left the session 🚪`;
}

function buildNotificationId(
  playerId: string,
  previousState: MultiplayerPlayerState | "missing",
  nextState: MultiplayerPlayerState | "missing"
): string {
  return `${playerId}:${previousState}:${nextState}`;
}

export function getMultiplayerSessionNotifications(
  previousPlayers: MultiplayerLobbyPlayer[],
  nextPlayers: MultiplayerLobbyPlayer[],
  ownPlayerId: string
): MultiplayerSessionNotification[] {
  const previousById = new Map(previousPlayers.map((player) => [player.id, player] as const));
  const notifications: MultiplayerSessionNotification[] = [];

  for (const nextPlayer of nextPlayers) {
    if (nextPlayer.id === ownPlayerId) continue;
    const previousPlayer = previousById.get(nextPlayer.id);

    if (!previousPlayer) {
      if (!isActivePlayerState(nextPlayer.state)) continue;
      notifications.push({
        id: buildNotificationId(nextPlayer.id, "missing", nextPlayer.state),
        message: formatJoinMessage(nextPlayer, false),
      });
      continue;
    }

    if (previousPlayer.state === nextPlayer.state) continue;

    if (previousPlayer.state === "disconnected" && isActivePlayerState(nextPlayer.state)) {
      notifications.push({
        id: buildNotificationId(nextPlayer.id, previousPlayer.state, nextPlayer.state),
        message: formatJoinMessage(nextPlayer, true),
      });
      continue;
    }

    if (isLeavingPlayerState(nextPlayer.state) && !isLeavingPlayerState(previousPlayer.state)) {
      notifications.push({
        id: buildNotificationId(nextPlayer.id, previousPlayer.state, nextPlayer.state),
        message: formatLeaveMessage(nextPlayer),
      });
    }
  }

  for (const previousPlayer of previousPlayers) {
    if (previousPlayer.id === ownPlayerId) continue;
    if (nextPlayers.some((player) => player.id === previousPlayer.id)) continue;
    notifications.push({
      id: buildNotificationId(previousPlayer.id, previousPlayer.state, "missing"),
      message: `${previousPlayer.displayName} left the session 🚪`,
    });
  }

  return notifications;
}
