import type { MultiplayerLobbySnapshot, MultiplayerMatchHistory, MultiplayerPlayerState } from "./types";

export type MultiplayerStandingRow = {
  playerId: string;
  userId: string;
  displayName: string;
  state: MultiplayerPlayerState | string;
  finalScore: number;
  finishAt: string | null;
  finalPayloadJson: unknown;
  place: number;
};

const TERMINAL_PLAYER_STATES = new Set<MultiplayerPlayerState>([
  "finished",
  "forfeited",
  "kicked",
  "came",
]);

function toSafeString(value: unknown, fallback = ""): string {
  if (typeof value !== "string") return fallback;
  return value;
}

function toSafeScore(value: unknown): number {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.floor(numeric));
}

function sortRows(rows: Omit<MultiplayerStandingRow, "place">[]): MultiplayerStandingRow[] {
  const sorted = [...rows].sort((a, b) => {
    if (b.finalScore !== a.finalScore) return b.finalScore - a.finalScore;
    const aFinish = a.finishAt ? Date.parse(a.finishAt) : Number.POSITIVE_INFINITY;
    const bFinish = b.finishAt ? Date.parse(b.finishAt) : Number.POSITIVE_INFINITY;
    if (aFinish !== bFinish) return aFinish - bFinish;
    return a.displayName.localeCompare(b.displayName);
  });

  return sorted.map((row, index) => ({ ...row, place: index + 1 }));
}

export function isTerminalPlayerState(state: MultiplayerPlayerState | string): boolean {
  return TERMINAL_PLAYER_STATES.has(state as MultiplayerPlayerState);
}

export function hasActivePlayers(snapshot: MultiplayerLobbySnapshot): boolean {
  return snapshot.players.some((player) => !isTerminalPlayerState(player.state));
}

export function buildTemporaryStandings(snapshot: MultiplayerLobbySnapshot): MultiplayerStandingRow[] {
  const rows: Omit<MultiplayerStandingRow, "place">[] = snapshot.players.map((player) => {
    const progress = snapshot.progressByPlayerId[player.id];
    return {
      playerId: player.id,
      userId: player.userId,
      displayName: player.displayName,
      state: player.state,
      finalScore: toSafeScore(progress?.score ?? player.finalScore ?? 0),
      finishAt: player.finishAt,
      finalPayloadJson: player.finalPayloadJson ?? {},
    };
  });
  return sortRows(rows);
}

export function parseHistoryStandings(history: MultiplayerMatchHistory): MultiplayerStandingRow[] {
  return parseStandingsJson(history.resultsJson);
}

export function parseStandingsJson(resultsJson: unknown): MultiplayerStandingRow[] {
  if (!Array.isArray(resultsJson)) return [];
  const rows = resultsJson.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const raw = entry as Record<string, unknown>;
    const playerId = toSafeString(raw.player_id).trim();
    const userId = toSafeString(raw.user_id).trim();
    const displayName = toSafeString(raw.display_name).trim();
    if (playerId.length === 0 || userId.length === 0 || displayName.length === 0) return [];

    const finishAtRaw = raw.finish_at;
    const finishAt = typeof finishAtRaw === "string" && finishAtRaw.trim().length > 0 ? finishAtRaw : null;

    return [{
      playerId,
      userId,
      displayName,
      state: toSafeString(raw.state, "finished"),
      finalScore: toSafeScore(raw.final_score),
      finishAt,
      finalPayloadJson: raw.final_payload_json ?? {},
    }];
  });

  return sortRows(rows);
}
