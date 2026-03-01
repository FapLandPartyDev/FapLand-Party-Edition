import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { z } from "zod";
import { db } from "../services/db";
import {
  buildTemporaryStandings,
  finalizeMatchIfComplete,
  getLobbySnapshot,
  getMatchHistoryByLobby,
  getOwnLobbyPlayer,
  hasActivePlayers,
  parseHistoryStandings,
  parseStandingsJson,
  type MultiplayerLobbySnapshot,
  type MultiplayerStandingRow,
} from "../services/multiplayer";

const MultiplayerResultSearchSchema = z.object({
  lobbyId: z.string().min(1),
  playerId: z.string().optional(),
});

function toResultJson(rows: MultiplayerStandingRow[]) {
  return rows.map((row) => ({
    player_id: row.playerId,
    user_id: row.userId,
    display_name: row.displayName,
    state: row.state,
    final_score: row.finalScore,
    finish_at: row.finishAt,
    final_payload_json: row.finalPayloadJson ?? {},
  }));
}

function toIsoString(value: unknown): string | null {
  if (typeof value === "string" && value.trim().length > 0) return value;
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString();
  return null;
}

async function safe<T>(work: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await work();
  } catch {
    return fallback;
  }
}

export const Route = createFileRoute("/multiplayer-result")({
  validateSearch: (search) => MultiplayerResultSearchSchema.parse(search),
  loader: async ({ location }) => {
    const search = MultiplayerResultSearchSchema.parse(location.search);
    const [snapshot, ownPlayer, finalHistory, cached] = await Promise.all([
      safe(() => getLobbySnapshot(search.lobbyId), null),
      safe(() => getOwnLobbyPlayer(search.lobbyId), null),
      safe(() => getMatchHistoryByLobby(search.lobbyId), null),
      safe(() => db.multiplayer.getMatchCache(search.lobbyId), null),
    ]);

    const finalRows = finalHistory ? parseHistoryStandings(finalHistory) : [];
    const snapshotRows = snapshot ? buildTemporaryStandings(snapshot) : [];
    const cachedRows = cached ? parseStandingsJson(cached.resultsJson) : [];
    const initialRows = finalRows.length > 0
      ? finalRows
      : snapshotRows.length > 0
        ? snapshotRows
        : cachedRows;
    const initialIsFinal = finalRows.length > 0 || Boolean(cached?.isFinal && cachedRows.length > 0);
    const finishedAtIso = finalHistory?.finishedAt
      ?? toIsoString(cached?.finishedAt)
      ?? null;

    return {
      search,
      initialSnapshot: snapshot,
      initialRows,
      initialIsFinal,
      ownPlayerId: search.playerId ?? ownPlayer?.id ?? "",
      finishedAtIso,
    };
  },
  component: MultiplayerResultRoute,
});

function MultiplayerResultRoute() {
  const navigate = useNavigate();
  const { search, initialRows, initialIsFinal, initialSnapshot, ownPlayerId, finishedAtIso } = Route.useLoaderData();

  const [rows, setRows] = useState<MultiplayerStandingRow[]>(initialRows);
  const [snapshot, setSnapshot] = useState<MultiplayerLobbySnapshot | null>(initialSnapshot);
  const [isFinal, setIsFinal] = useState(initialIsFinal);
  const [finalizedAtIso, setFinalizedAtIso] = useState<string | null>(finishedAtIso);
  const [error, setError] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const persistRows = useCallback(async (nextRows: MultiplayerStandingRow[], finalFlag: boolean, finishedAt: string | null) => {
    if (nextRows.length === 0) return;
    await db.multiplayer.upsertMatchCache({
      lobbyId: search.lobbyId,
      finishedAtIso: finishedAt ?? new Date().toISOString(),
      isFinal: finalFlag,
      resultsJson: toResultJson(nextRows),
    });
  }, [search.lobbyId]);

  const resolveHistory = useCallback(async () => {
    const history = await getMatchHistoryByLobby(search.lobbyId);
    if (!history) return false;

    const historyRows = parseHistoryStandings(history);
    setRows(historyRows);
    setIsFinal(true);
    setFinalizedAtIso(history.finishedAt);
    await persistRows(historyRows, true, history.finishedAt);
    await db.multiplayer.removeResultSyncLobby(search.lobbyId);
    return true;
  }, [persistRows, search.lobbyId]);

  const refresh = useCallback(async () => {
    setIsRefreshing(true);
    setError(null);
    try {
      if (await resolveHistory()) return;

      await db.multiplayer.enqueueResultSyncLobby(search.lobbyId);
      await db.multiplayer.touchResultSyncLobby(search.lobbyId);

      await safe(() => finalizeMatchIfComplete(search.lobbyId), false);
      if (await resolveHistory()) return;

      const nextSnapshot = await getLobbySnapshot(search.lobbyId);
      setSnapshot(nextSnapshot);
      if (nextSnapshot) {
        const temporaryRows = buildTemporaryStandings(nextSnapshot);
        setRows(temporaryRows);
        setIsFinal(false);
        await persistRows(temporaryRows, false, new Date().toISOString());
        if (!hasActivePlayers(nextSnapshot)) {
          await safe(() => finalizeMatchIfComplete(search.lobbyId), false);
        }
      }
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : "Failed to refresh result.");
    } finally {
      setIsRefreshing(false);
    }
  }, [persistRows, resolveHistory, search.lobbyId]);

  useEffect(() => {
    void persistRows(rows, isFinal, finalizedAtIso).catch(() => {
      // noop
    });
    if (!isFinal) {
      void db.multiplayer.enqueueResultSyncLobby(search.lobbyId).catch(() => {
        // noop
      });
    }
  }, [finalizedAtIso, isFinal, persistRows, rows, search.lobbyId]);

  useEffect(() => {
    if (isFinal) return;
    void refresh();
    const interval = window.setInterval(() => {
      void refresh();
    }, 5000);
    return () => {
      window.clearInterval(interval);
    };
  }, [isFinal, refresh]);

  const ownRow = useMemo(() => rows.find((row) => row.playerId === ownPlayerId) ?? null, [ownPlayerId, rows]);
  const activePlayers = useMemo(
    () => snapshot?.players.filter((player) => !["finished", "forfeited", "kicked", "came"].includes(player.state)).length ?? 0,
    [snapshot?.players],
  );

  return (
    <div className="relative min-h-screen overflow-hidden bg-[#030713] text-zinc-100">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_14%_12%,rgba(34,211,238,0.27),transparent_40%),radial-gradient(circle_at_86%_18%,rgba(236,72,153,0.26),transparent_36%),radial-gradient(circle_at_52%_90%,rgba(56,189,248,0.18),transparent_35%),linear-gradient(140deg,#020612_0%,#06122b_55%,#18051f_100%)]" />
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_bottom,rgba(255,255,255,0.04)_1px,transparent_1px)] bg-[length:100%_4px] opacity-20" />

      <main className="relative z-10 mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-4 px-4 py-6 sm:px-8 sm:py-8">
        <header className="rounded-2xl border border-cyan-300/30 bg-[#050f23]/80 p-5 shadow-[0_0_38px_rgba(34,211,238,0.14)] backdrop-blur-xl">
          <p className="font-[family-name:var(--font-jetbrains-mono)] text-xs uppercase tracking-[0.24em] text-cyan-100/90">
            Multiplayer Result
          </p>
          <h1 className="mt-2 text-3xl font-black uppercase tracking-[0.07em] sm:text-4xl">
            {isFinal ? "Final Standings" : "Temporary Standings"}
          </h1>
          <p className="mt-2 text-sm text-zinc-300">
            {isFinal
              ? `Final result synced${finalizedAtIso ? ` at ${new Date(finalizedAtIso).toLocaleString()}` : "."}`
              : `This result is temporary. ${activePlayers} player(s) still active. Final standings will auto-sync.`}
          </p>
          {error && (
            <p className="mt-2 rounded-lg border border-rose-400/60 bg-rose-500/10 px-3 py-2 text-sm text-rose-100">
              {error}
            </p>
          )}
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => {
                void refresh();
              }}
              className="rounded-xl border border-cyan-300/55 bg-cyan-500/15 px-4 py-2 text-sm font-semibold text-cyan-100 transition hover:border-cyan-200"
            >
              {isRefreshing ? "Refreshing..." : "Refresh"}
            </button>
            <button
              type="button"
              onClick={() => {
                void navigate({ to: "/highscores" });
              }}
              className="rounded-xl border border-fuchsia-300/50 bg-fuchsia-500/15 px-4 py-2 text-sm font-semibold text-fuchsia-100 transition hover:border-fuchsia-200"
            >
              Highscore Hub
            </button>
            <button
              type="button"
              onClick={() => {
                void navigate({ to: "/" });
              }}
              className="rounded-xl border border-zinc-400/45 bg-zinc-900/70 px-4 py-2 text-sm font-semibold text-zinc-100 transition hover:border-zinc-300"
            >
              Main Menu
            </button>
          </div>
        </header>

        {ownRow && (
          <section className="rounded-2xl border border-fuchsia-300/35 bg-fuchsia-500/10 p-4 shadow-[0_0_30px_rgba(217,70,239,0.16)]">
            <p className="font-[family-name:var(--font-jetbrains-mono)] text-[11px] uppercase tracking-[0.2em] text-fuchsia-100/90">Your Placement</p>
            <div className="mt-1 flex flex-wrap items-end gap-3">
              <p className="text-5xl font-black text-fuchsia-100">#{ownRow.place}</p>
              <p className="pb-1 text-lg font-semibold text-zinc-100">{ownRow.displayName}</p>
              <p className="pb-1 text-sm text-zinc-300">Score {ownRow.finalScore}</p>
            </div>
          </section>
        )}

        <section className="rounded-2xl border border-cyan-300/25 bg-[#040c1d]/78 p-3 shadow-[0_0_36px_rgba(34,211,238,0.11)] backdrop-blur-xl sm:p-4">
          <div className="grid gap-2">
            {rows.length === 0 && (
              <div className="rounded-xl border border-zinc-700/70 bg-zinc-900/75 px-4 py-3 text-sm text-zinc-300">
                No standings available yet. Keep this page open or check back from the Highscore Hub later.
              </div>
            )}
            {rows.map((row) => (
              <article
                key={row.playerId}
                className={`rounded-xl border px-4 py-3 ${
                  row.playerId === ownPlayerId
                    ? "border-fuchsia-300/60 bg-fuchsia-500/15 shadow-[0_0_20px_rgba(217,70,239,0.18)]"
                    : "border-cyan-300/25 bg-cyan-500/5"
                }`}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="inline-flex min-w-10 items-center justify-center rounded-md border border-cyan-300/45 bg-cyan-400/15 px-2 py-0.5 text-sm font-black text-cyan-100">
                        #{row.place}
                      </span>
                      <h2 className="text-lg font-bold text-zinc-100">{row.displayName}</h2>
                    </div>
                    <p className="mt-1 font-[family-name:var(--font-jetbrains-mono)] text-[11px] uppercase tracking-[0.14em] text-zinc-400">
                      state {row.state}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-2xl font-black text-cyan-100">{row.finalScore}</p>
                    <p className="font-[family-name:var(--font-jetbrains-mono)] text-[10px] uppercase tracking-[0.14em] text-zinc-400">
                      score
                    </p>
                  </div>
                </div>
                <div className="mt-3 grid gap-2 text-xs text-zinc-300 sm:grid-cols-2">
                  <p className="rounded-lg border border-white/10 bg-black/20 px-2.5 py-1.5">
                    player_id: <span className="text-zinc-100">{row.playerId}</span>
                  </p>
                  <p className="rounded-lg border border-white/10 bg-black/20 px-2.5 py-1.5">
                    user_id: <span className="text-zinc-100">{row.userId}</span>
                  </p>
                </div>
              </article>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}

