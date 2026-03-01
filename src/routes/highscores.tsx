import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { db, type SinglePlayerRunHistoryRow } from "../services/db";
import { resolveAssetUrl } from "../utils/audio";
import {
  getMatchHistoryByLobby,
  listMatchHistory,
  parseHistoryStandings,
  parseStandingsJson,
  type MultiplayerStandingRow,
} from "../services/multiplayer";

type HighscoreMatchView = {
  lobbyId: string;
  finishedAtIso: string;
  isFinal: boolean;
  rows: MultiplayerStandingRow[];
};

const singlePlayerReasonLabel: Record<string, string> = {
  finished: "Campaign Completed",
  self_reported_cum: "Manual Cum Report",
  cum_instruction_failed: "Cum Instruction Failed",
};

function toIsoString(value: unknown): string | null {
  if (typeof value === "string" && value.trim().length > 0) return value;
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString();
  return null;
}

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

function toMatchView(input: {
  lobbyId: string;
  finishedAtIso: string;
  isFinal: boolean;
  resultsJson: unknown;
}): HighscoreMatchView | null {
  const rows = parseStandingsJson(input.resultsJson);
  if (rows.length === 0) return null;
  return {
    lobbyId: input.lobbyId,
    finishedAtIso: input.finishedAtIso,
    isFinal: input.isFinal,
    rows,
  };
}

async function buildCachedViews(limit = 100): Promise<HighscoreMatchView[]> {
  const cached = await db.multiplayer.listMatchCache(limit);
  return cached.flatMap((entry) => {
    const finishedAtIso = toIsoString(entry.finishedAt) ?? toIsoString(entry.updatedAt) ?? new Date().toISOString();
    const view = toMatchView({
      lobbyId: entry.lobbyId,
      finishedAtIso,
      isFinal: entry.isFinal,
      resultsJson: entry.resultsJson,
    });
    return view ? [view] : [];
  }).sort((a, b) => Date.parse(b.finishedAtIso) - Date.parse(a.finishedAtIso));
}

export const Route = createFileRoute("/highscores")({
  loader: async () => {
    const [localHighscore, singleRuns, cachedViews, queued] = await Promise.all([
      db.gameProfile.getLocalHighscore().catch(() => 0),
      db.singlePlayerHistory.listRuns(100).catch(() => []),
      buildCachedViews().catch(() => []),
      db.multiplayer.listResultSyncLobbies().catch(() => []),
    ]);

    return {
      localHighscore,
      singleRuns,
      cachedViews,
      initialSyncQueueCount: queued.length,
    };
  },
  component: HighscoresRoute,
});

function HighscoresRoute() {
  const navigate = useNavigate();
  const {
    localHighscore: initialHighscore,
    singleRuns: initialSingleRuns,
    cachedViews,
    initialSyncQueueCount,
  } = Route.useLoaderData();

  const [localHighscore, setLocalHighscore] = useState(initialHighscore);
  const [singleRuns, setSingleRuns] = useState<SinglePlayerRunHistoryRow[]>(initialSingleRuns);
  const [matches, setMatches] = useState<HighscoreMatchView[]>(cachedViews);
  const [syncQueueCount, setSyncQueueCount] = useState(initialSyncQueueCount);
  const [expandedLobbyId, setExpandedLobbyId] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const playHover = useCallback(() => {
    const a = new Audio(resolveAssetUrl("/sounds/ui-hover.wav"));
    a.volume = 0.3;
    a.play().catch(() => { });
  }, []);

  const playClick = useCallback(() => {
    const a = new Audio(resolveAssetUrl("/sounds/ui-select.wav"));
    a.volume = 0.6;
    a.play().catch(() => { });
  }, []);

  const playReveal = useCallback(() => {
    const a = new Audio(resolveAssetUrl("/sounds/ui-hover.wav"));
    a.volume = 0.5;
    a.play().catch(() => { });
  }, []);

  useEffect(() => {
    const drone = new Audio(resolveAssetUrl("/sounds/highscore-drone.wav"));
    drone.loop = true;
    drone.volume = 0.15;
    drone.play().catch(() => { });
    return () => {
      drone.pause();
    };
  }, []);

  const syncNow = useCallback(async () => {
    setSyncing(true);
    setError(null);

    try {
      const [freshHighscore, freshSingleRuns, queuedRows] = await Promise.all([
        db.gameProfile.getLocalHighscore().catch(() => null),
        db.singlePlayerHistory.listRuns(100).catch(() => []),
        db.multiplayer.listResultSyncLobbies().catch(() => []),
      ]);
      if (typeof freshHighscore === "number") {
        setLocalHighscore(Math.max(0, Math.floor(freshHighscore)));
      }
      setSingleRuns(freshSingleRuns);

      const remoteHistory = await listMatchHistory();
      for (const history of remoteHistory) {
        const rows = parseHistoryStandings(history);
        if (rows.length === 0) continue;
        await db.multiplayer.upsertMatchCache({
          lobbyId: history.lobbyId,
          finishedAtIso: history.finishedAt,
          isFinal: true,
          resultsJson: toResultJson(rows),
        });
        await db.multiplayer.removeResultSyncLobby(history.lobbyId);
      }

      for (const queueItem of queuedRows) {
        const history = await getMatchHistoryByLobby(queueItem.lobbyId).catch(() => null);
        if (history) {
          const rows = parseHistoryStandings(history);
          if (rows.length > 0) {
            await db.multiplayer.upsertMatchCache({
              lobbyId: history.lobbyId,
              finishedAtIso: history.finishedAt,
              isFinal: true,
              resultsJson: toResultJson(rows),
            });
          }
          await db.multiplayer.removeResultSyncLobby(queueItem.lobbyId);
        } else {
          await db.multiplayer.touchResultSyncLobby(queueItem.lobbyId).catch(() => {
            // noop
          });
        }
      }

      const [nextCachedViews, nextQueue] = await Promise.all([
        buildCachedViews(),
        db.multiplayer.listResultSyncLobbies().catch(() => []),
      ]);
      setMatches(nextCachedViews);
      setSyncQueueCount(nextQueue.length);
    } catch (syncError) {
      setError(syncError instanceof Error ? syncError.message : "Could not sync remote results. Showing cached data.");
      const [nextCachedViews, nextQueue] = await Promise.all([
        buildCachedViews().catch(() => []),
        db.multiplayer.listResultSyncLobbies().catch(() => []),
      ]);
      setMatches(nextCachedViews);
      setSyncQueueCount(nextQueue.length);
    } finally {
      setSyncing(false);
    }
  }, []);

  useEffect(() => {
    void syncNow();
    const interval = window.setInterval(() => {
      void syncNow();
    }, 15000);
    return () => {
      window.clearInterval(interval);
    };
  }, [syncNow]);

  const finalMatchCount = useMemo(
    () => matches.filter((match) => match.isFinal).length,
    [matches],
  );
  const singleRunCount = singleRuns.length;
  const singleRunNewBestCount = useMemo(
    () => singleRuns.filter((run) => run.wasNewHighscore).length,
    [singleRuns],
  );

  return (
    <div className="relative h-screen overflow-y-auto overflow-x-hidden bg-[#030713] text-zinc-100 selection:bg-cyan-500/30">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_12%_18%,rgba(34,211,238,0.28),transparent_40%),radial-gradient(circle_at_82%_16%,rgba(236,72,153,0.26),transparent_35%),radial-gradient(circle_at_55%_95%,rgba(244,114,182,0.15),transparent_45%),linear-gradient(145deg,#020611_0%,#06112a_56%,#18081f_100%)] animate-pulse" style={{ animationDuration: '4s' }} />
      <div className="pointer-events-none fixed inset-0 bg-[linear-gradient(to_bottom,rgba(255,255,255,0.04)_1px,transparent_1px)] bg-[length:100%_4px] opacity-20 mix-blend-overlay" />

      <main className="relative z-10 mx-auto flex w-full max-w-6xl flex-col gap-4 px-4 py-6 sm:px-8 sm:py-8">
        <header className="rounded-3xl border border-cyan-300/30 bg-[#041026]/78 p-5 shadow-[0_0_42px_rgba(34,211,238,0.16)] backdrop-blur-xl sm:p-6 transition-all duration-500 hover:shadow-[0_0_60px_rgba(34,211,238,0.25)]">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="font-[family-name:var(--font-jetbrains-mono)] text-xs uppercase tracking-[0.26em] text-cyan-100/90">Result Nexus</p>
              <h1 className="mt-2 text-3xl font-black uppercase tracking-[0.07em] sm:text-5xl">Highscore Hub</h1>
              <p className="mt-2 text-sm text-zinc-300">
                Local DB powered history for single-player highscores and multiplayer opponent results.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onMouseEnter={playHover}
                onClick={() => {
                  playClick();
                  void syncNow();
                }}
                className="rounded-xl border border-cyan-300/60 bg-cyan-500/15 px-4 py-2 text-sm font-semibold text-cyan-100 transition duration-300 hover:border-cyan-200 hover:bg-cyan-400/25 hover:shadow-[0_0_15px_rgba(34,211,238,0.4)] active:scale-95"
              >
                {syncing ? "Syncing..." : "Sync Now"}
              </button>
              <button
                type="button"
                onMouseEnter={playHover}
                onClick={() => {
                  playClick();
                  void navigate({ to: "/" });
                }}
                className="rounded-xl border border-zinc-400/45 bg-zinc-900/70 px-4 py-2 text-sm font-semibold text-zinc-100 transition duration-300 hover:border-zinc-300 hover:bg-zinc-800 hover:shadow-[0_0_15px_rgba(255,255,255,0.2)] active:scale-95"
              >
                Main Menu
              </button>
            </div>
          </div>
          {error && (
            <p className="mt-3 rounded-lg border border-amber-300/55 bg-amber-500/15 px-3 py-2 text-sm text-amber-100">
              {error}
            </p>
          )}
        </header>

        <section className="grid gap-4 sm:grid-cols-3">
          <article className="group relative overflow-hidden rounded-2xl border border-fuchsia-300/40 bg-fuchsia-500/12 p-4 shadow-[0_0_26px_rgba(217,70,239,0.18)] transition duration-500 hover:border-fuchsia-300/70 hover:shadow-[0_0_40px_rgba(217,70,239,0.3)] hover:-translate-y-0.5">
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-tr from-fuchsia-500/10 via-transparent to-transparent opacity-0 transition duration-500 group-hover:opacity-100" />
            <p className="relative z-10 font-[family-name:var(--font-jetbrains-mono)] text-[11px] uppercase tracking-[0.18em] text-fuchsia-100/90 drop-shadow-[0_0_5px_rgba(217,70,239,0.5)]">Local Best</p>
            <p className="relative z-10 mt-2 text-4xl font-black text-fuchsia-100 drop-shadow-[0_0_10px_rgba(217,70,239,0.8)]">{localHighscore}</p>
            <p className="relative z-10 mt-1 text-xs text-zinc-300">Single-player highscore from SQLite profile.</p>
          </article>
          <article className="group relative overflow-hidden rounded-2xl border border-cyan-300/35 bg-cyan-500/10 p-4 transition duration-500 hover:border-cyan-300/70 hover:shadow-[0_0_40px_rgba(34,211,238,0.25)] hover:-translate-y-0.5">
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-tr from-cyan-500/10 via-transparent to-transparent opacity-0 transition duration-500 group-hover:opacity-100" />
            <p className="relative z-10 font-[family-name:var(--font-jetbrains-mono)] text-[11px] uppercase tracking-[0.18em] text-cyan-100/90 drop-shadow-[0_0_5px_rgba(34,211,238,0.5)]">Single Runs</p>
            <p className="relative z-10 mt-2 text-4xl font-black text-cyan-100 drop-shadow-[0_0_10px_rgba(34,211,238,0.8)]">{singleRunCount}</p>
            <p className="relative z-10 mt-1 text-xs text-zinc-300">All completed local single-player sessions.</p>
          </article>
          <article className="group relative overflow-hidden rounded-2xl border border-emerald-300/35 bg-emerald-500/10 p-4 transition duration-500 hover:border-emerald-300/70 hover:shadow-[0_0_40px_rgba(16,185,129,0.25)] hover:-translate-y-0.5">
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-tr from-emerald-500/10 via-transparent to-transparent opacity-0 transition duration-500 group-hover:opacity-100" />
            <p className="relative z-10 font-[family-name:var(--font-jetbrains-mono)] text-[11px] uppercase tracking-[0.18em] text-emerald-100/90 drop-shadow-[0_0_5px_rgba(16,185,129,0.5)]">Single New Bests</p>
            <p className="relative z-10 mt-2 text-4xl font-black text-emerald-100 drop-shadow-[0_0_10px_rgba(16,185,129,0.8)]">{singleRunNewBestCount}</p>
            <p className="relative z-10 mt-1 text-xs text-zinc-300">Runs that set a new local highscore.</p>
          </article>
        </section>

        <section className="rounded-2xl border border-fuchsia-300/25 bg-[#1a0825]/70 p-3 shadow-[0_0_34px_rgba(217,70,239,0.14)] backdrop-blur-xl sm:p-4">
          <h2 className="font-[family-name:var(--font-jetbrains-mono)] text-sm uppercase tracking-[0.2em] text-fuchsia-100/90">
            Singleplayer Run History
          </h2>
          <div className="mt-3 space-y-3">
            {singleRuns.length === 0 && (
              <div className="rounded-xl border border-zinc-700/70 bg-zinc-900/75 px-4 py-3 text-sm text-zinc-300">
                No single-player history yet.
              </div>
            )}
            {singleRuns.map((run) => (
              <article key={run.id} className="group relative overflow-hidden rounded-xl border border-fuchsia-300/25 bg-fuchsia-500/5 p-3 transition duration-300 hover:border-fuchsia-300/50 hover:bg-fuchsia-500/10">
                <div className="flex flex-wrap items-center justify-between gap-2 relative z-10">
                  <div>
                    <p className="text-sm font-bold text-zinc-100 group-hover:text-fuchsia-100 transition-colors drop-shadow-[0_0_8px_rgba(217,70,239,0)] group-hover:drop-shadow-[0_0_8px_rgba(217,70,239,0.5)]">{singlePlayerReasonLabel[run.completionReason] ?? run.completionReason}</p>
                    <p className="text-xs text-zinc-400">
                      {new Date(run.finishedAt).toLocaleString()} | Playlist: {run.playlistName}
                    </p>
                  </div>
                  <p className="rounded-lg border border-fuchsia-300/40 bg-fuchsia-500/15 px-2.5 py-1 text-xs font-semibold uppercase tracking-[0.1em] text-fuchsia-100 shadow-[0_0_10px_rgba(217,70,239,0.2)]">
                    Score {run.score}
                  </p>
                </div>
                <div className="mt-2 grid gap-1 text-xs text-zinc-300 sm:grid-cols-4 relative z-10">
                  <p>Highscore Before: <span className="text-zinc-100">{run.highscoreBefore}</span></p>
                  <p>Highscore After: <span className="text-zinc-100 drop-shadow-[0_0_3px_rgba(255,255,255,0.4)]">{run.highscoreAfter}</span></p>
                  <p>Ending Position: <span className="text-zinc-100">{run.endingPosition}</span></p>
                  <p>Turn: <span className="text-zinc-100">{run.turn}</span></p>
                </div>
                <div className="mt-2 grid gap-1 text-xs text-zinc-300 sm:grid-cols-3 relative z-10">
                  <p>New Best: <span className="text-zinc-100">{run.wasNewHighscore ? "Yes" : "No"}</span></p>
                  <p>Playlist ID: <span className="text-zinc-100">{run.playlistId ?? "N/A"}</span></p>
                  <p>Playlist Format: <span className="text-zinc-100">{run.playlistFormatVersion ?? "N/A"}</span></p>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="grid gap-4 sm:grid-cols-2">
          <article className="group relative overflow-hidden rounded-2xl border border-cyan-300/35 bg-cyan-500/10 p-4 transition duration-500 hover:border-cyan-300/70 hover:shadow-[0_0_40px_rgba(34,211,238,0.25)] hover:-translate-y-0.5">
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-tr from-cyan-500/10 via-transparent to-transparent opacity-0 transition duration-500 group-hover:opacity-100" />
            <p className="relative z-10 font-[family-name:var(--font-jetbrains-mono)] text-[11px] uppercase tracking-[0.18em] text-cyan-100/90 drop-shadow-[0_0_5px_rgba(34,211,238,0.5)]">Matches Cached</p>
            <p className="relative z-10 mt-2 text-4xl font-black text-cyan-100 drop-shadow-[0_0_10px_rgba(34,211,238,0.8)]">{matches.length}</p>
            <p className="relative z-10 mt-1 text-xs text-zinc-300">Includes cached temporary and final standings.</p>
          </article>
          <article className="group relative overflow-hidden rounded-2xl border border-emerald-300/35 bg-emerald-500/10 p-4 transition duration-500 hover:border-emerald-300/70 hover:shadow-[0_0_40px_rgba(16,185,129,0.25)] hover:-translate-y-0.5">
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-tr from-emerald-500/10 via-transparent to-transparent opacity-0 transition duration-500 group-hover:opacity-100" />
            <p className="relative z-10 font-[family-name:var(--font-jetbrains-mono)] text-[11px] uppercase tracking-[0.18em] text-emerald-100/90 drop-shadow-[0_0_5px_rgba(16,185,129,0.5)]">Finalized</p>
            <p className="relative z-10 mt-2 text-4xl font-black text-emerald-100 drop-shadow-[0_0_10px_rgba(16,185,129,0.8)]">{finalMatchCount}</p>
            <p className="relative z-10 mt-1 text-xs text-zinc-300">Pending sync queue: {syncQueueCount}</p>
          </article>
        </section>

        <section className="rounded-2xl border border-cyan-300/25 bg-[#050d1e]/76 p-3 shadow-[0_0_34px_rgba(34,211,238,0.12)] backdrop-blur-xl sm:p-4">
          <h2 className="font-[family-name:var(--font-jetbrains-mono)] text-sm uppercase tracking-[0.2em] text-cyan-100/90">
            Multiplayer Result History
          </h2>
          <div className="mt-3 space-y-3">
            {matches.length === 0 && (
              <div className="rounded-xl border border-zinc-700/70 bg-zinc-900/75 px-4 py-3 text-sm text-zinc-300">
                No multiplayer result cache yet.
              </div>
            )}
            {matches.map((match) => {
              const expanded = expandedLobbyId === match.lobbyId;
              return (
                <article key={match.lobbyId} className="group relative overflow-hidden rounded-xl border border-cyan-300/25 bg-cyan-500/5 p-3 transition duration-300 hover:border-cyan-300/40">
                  <div className="flex flex-wrap items-center justify-between gap-2 relative z-10">
                    <div>
                      <p className="text-sm font-bold text-zinc-100 group-hover:text-cyan-100 group-hover:drop-shadow-[0_0_8px_rgba(34,211,238,0.5)] transition-all">Lobby {match.lobbyId.slice(0, 12)}</p>
                      <p className="text-xs text-zinc-400">
                        {match.isFinal ? "Final result" : "Temporary snapshot"} | {new Date(match.finishedAtIso).toLocaleString()}
                      </p>
                    </div>
                    <button
                      type="button"
                      onMouseEnter={playHover}
                      onClick={() => {
                        playClick();
                        if (!expanded) playReveal();
                        setExpandedLobbyId(expanded ? null : match.lobbyId);
                      }}
                      className="rounded-lg border border-cyan-300/40 bg-cyan-500/12 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.1em] text-cyan-100 transition duration-300 hover:border-cyan-300 hover:bg-cyan-500/25 hover:shadow-[0_0_15px_rgba(34,211,238,0.3)] active:scale-95"
                    >
                      {expanded ? "Hide Players" : "Show Players"}
                    </button>
                  </div>
                  {expanded && (
                    <div className="mt-3 grid gap-2">
                      {match.rows.map((row) => (
                        <div key={row.playerId} className="animate-in fade-in slide-in-from-top-2 duration-300 rounded-lg border border-cyan-400/20 bg-black/40 px-3 py-2 shadow-inner">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <p className="font-semibold text-zinc-100 drop-shadow-[0_0_5px_rgba(255,255,255,0.3)]">#{row.place} {row.displayName}</p>
                            <p className="text-sm font-bold text-cyan-200 drop-shadow-[0_0_8px_rgba(34,211,238,0.6)]">Score {row.finalScore}</p>
                          </div>
                          <div className="mt-1 grid gap-1 text-xs text-zinc-300 sm:grid-cols-3">
                            <p>state: <span className="text-zinc-100">{row.state}</span></p>
                            <p>player_id: <span className="text-zinc-100">{row.playerId}</span></p>
                            <p>user_id: <span className="text-zinc-100">{row.userId}</span></p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        </section>
      </main>
    </div>
  );
}
