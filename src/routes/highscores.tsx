import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatedBackground } from "../components/AnimatedBackground";
import { MenuButton } from "../components/MenuButton";
import { InlineMetrics } from "../components/ui";
import { useControllerSurface } from "../controller";
import { getAssistedTooltip, getSaveModeEmoji } from "../game/saveMode";
import { useSfwMode } from "../hooks/useSfwMode";
import { db, type SinglePlayerRunHistoryRow } from "../services/db";
import { playHoverSound, playSelectSound } from "../utils/audio";
import { formatDurationLabel } from "../utils/duration";
import { abbreviateNsfwText } from "../utils/sfwText";
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
type HighscoreAssistedSaveMode = "checkpoint" | "everywhere";
type HighscoreSectionId = "overview" | "single" | "multiplayer";
type HighscoreSection = {
  id: HighscoreSectionId;
  icon: string;
  title: MessageDescriptor;
  description: MessageDescriptor;
};

function getHighscoreSections(): HighscoreSection[] {
  return [
    {
      id: "overview",
      icon: "🏆",
      title: msg({
        id: "highscores.section.overview.title",
        message: "Overview",
      }),
      description: msg({
        id: "highscores.section.overview.description",
        message: "Top-level score health, sync status, and quick actions.",
      }),
    },
    {
      id: "single",
      icon: "🎯",
      title: msg({
        id: "highscores.section.single.title",
        message: "Single-Player",
      }),
      description: msg({
        id: "highscores.section.single.description",
        message: "Inspect local run history, survival time, and highscore progression.",
      }),
    },
    {
      id: "multiplayer",
      icon: "🌐",
      title: msg({
        id: "highscores.section.multiplayer.title",
        message: "Multiplayer",
      }),
      description: msg({
        id: "highscores.section.multiplayer.description",
        message: "Review cached match standings and sync queued remote results.",
      }),
    },
  ];
}

function getSinglePlayerReasonLabel(t: ReturnType<typeof useLingui>["t"], reason: string): string {
  switch (reason) {
    case "finished":
      return t`Campaign Completed`;
    case "self_reported_cum":
      return t`Manual Cum Report`;
    case "cum_instruction_failed":
      return t`Cum Instruction Failed`;
    default:
      return reason || t`Unknown`;
  }
}

function toIsoString(value: unknown): string | null {
  if (typeof value === "string" && value.trim().length > 0) return value;
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString();
  return null;
}

function toHighscoreAssistedSaveMode(value: unknown): HighscoreAssistedSaveMode | null {
  return value === "checkpoint" || value === "everywhere" ? value : null;
}

function formatRunSurvival(
  run: SinglePlayerRunHistoryRow,
  t: ReturnType<typeof useLingui>["t"]
): string {
  if (typeof run.survivedDurationSec !== "number" || !Number.isFinite(run.survivedDurationSec)) {
    return t`Legacy run`;
  }
  return formatDurationLabel(run.survivedDurationSec);
}

function formatPlaylistLabel(
  run: SinglePlayerRunHistoryRow,
  t: ReturnType<typeof useLingui>["t"]
): string {
  if (typeof run.playlistName === "string" && run.playlistName.trim().length > 0) {
    return run.playlistName;
  }
  if (typeof run.playlistId === "string" && run.playlistId.trim().length > 0) {
    return run.playlistId;
  }
  return t`N/A`;
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
  return cached
    .flatMap((entry) => {
      const finishedAtIso =
        toIsoString(entry.finishedAt) ?? toIsoString(entry.updatedAt) ?? new Date().toISOString();
      const view = toMatchView({
        lobbyId: entry.lobbyId,
        finishedAtIso,
        isFinal: entry.isFinal,
        resultsJson: entry.resultsJson,
      });
      return view ? [view] : [];
    })
    .sort((a, b) => Date.parse(b.finishedAtIso) - Date.parse(a.finishedAtIso));
}

export const Route = createFileRoute("/highscores")({
  loader: async () => {
    const [localHighscoreResult, singleRuns, cachedViews, queued] = await Promise.all([
      db.gameProfile.getLocalHighscore().catch(() => ({
        highscore: 0,
        highscoreCheatMode: false,
        highscoreAssisted: false,
        highscoreAssistedSaveMode: null,
      })),
      db.singlePlayerHistory.listRuns(100).catch(() => []),
      buildCachedViews().catch(() => []),
      db.multiplayer.listResultSyncLobbies().catch(() => []),
    ]);

    const localHighscore =
      typeof localHighscoreResult === "number"
        ? localHighscoreResult
        : localHighscoreResult.highscore;
    const localHighscoreCheatMode =
      typeof localHighscoreResult === "number" ? false : localHighscoreResult.highscoreCheatMode;
    const localHighscoreAssisted =
      typeof localHighscoreResult === "number"
        ? false
        : (localHighscoreResult.highscoreAssisted ?? false);
    const localHighscoreAssistedSaveMode =
      typeof localHighscoreResult === "number"
        ? null
        : toHighscoreAssistedSaveMode(localHighscoreResult.highscoreAssistedSaveMode);

    return {
      localHighscore,
      localHighscoreCheatMode,
      localHighscoreAssisted,
      localHighscoreAssistedSaveMode,
      singleRuns,
      cachedViews,
      initialSyncQueueCount: queued.length,
    };
  },
  component: HighscoresPage,
});

function HighscoresPage() {
  const { i18n, t } = useLingui();
  const sfwMode = useSfwMode();
  const navigate = useNavigate();
  const highscoreSections = getHighscoreSections();
  const {
    localHighscore: initialHighscore,
    localHighscoreCheatMode: initialHighscoreCheatMode,
    localHighscoreAssisted: initialHighscoreAssisted,
    localHighscoreAssistedSaveMode: initialHighscoreAssistedSaveMode,
    singleRuns: initialSingleRuns,
    cachedViews,
    initialSyncQueueCount,
  } = Route.useLoaderData();

  const [localHighscore, setLocalHighscore] = useState(initialHighscore);
  const [localHighscoreCheatMode, setLocalHighscoreCheatMode] = useState(initialHighscoreCheatMode);
  const [localHighscoreAssisted, setLocalHighscoreAssisted] = useState(initialHighscoreAssisted);
  const [localHighscoreAssistedSaveMode, setLocalHighscoreAssistedSaveMode] =
    useState<HighscoreAssistedSaveMode | null>(initialHighscoreAssistedSaveMode);
  const [singleRuns, setSingleRuns] = useState<SinglePlayerRunHistoryRow[]>(initialSingleRuns);
  const [matches, setMatches] = useState<HighscoreMatchView[]>(cachedViews);
  const [syncQueueCount, setSyncQueueCount] = useState(initialSyncQueueCount);
  const [expandedLobbyId, setExpandedLobbyId] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [deletingRunId, setDeletingRunId] = useState<string | null>(null);
  const [pendingDeleteRunId, setPendingDeleteRunId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeSectionId, setActiveSectionId] = useState<HighscoreSectionId>("overview");
  const scopeRef = useRef<HTMLDivElement | null>(null);

  const playHover = useCallback(() => {
    playHoverSound();
  }, []);

  const playClick = useCallback(() => {
    playSelectSound();
  }, []);

  const playReveal = useCallback(() => {
    playSelectSound();
  }, []);

  const syncNow = useCallback(async () => {
    setSyncing(true);
    setError(null);

    try {
      const [freshHighscoreResult, freshSingleRuns, queuedRows] = await Promise.all([
        db.gameProfile.getLocalHighscore().catch(() => null),
        db.singlePlayerHistory.listRuns(100).catch(() => []),
        db.multiplayer.listResultSyncLobbies().catch(() => []),
      ]);
      if (freshHighscoreResult) {
        if (typeof freshHighscoreResult === "number") {
          setLocalHighscore(Math.max(0, Math.floor(freshHighscoreResult)));
          setLocalHighscoreCheatMode(false);
          setLocalHighscoreAssisted(false);
          setLocalHighscoreAssistedSaveMode(null);
        } else {
          setLocalHighscore(Math.max(0, Math.floor(freshHighscoreResult.highscore)));
          setLocalHighscoreCheatMode(freshHighscoreResult.highscoreCheatMode ?? false);
          setLocalHighscoreAssisted(freshHighscoreResult.highscoreAssisted ?? false);
          setLocalHighscoreAssistedSaveMode(
            toHighscoreAssistedSaveMode(freshHighscoreResult.highscoreAssistedSaveMode)
          );
        }
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
      setError(
        syncError instanceof Error
          ? syncError.message
          : t`Could not sync remote results. Showing cached data.`
      );
      const [nextCachedViews, nextQueue] = await Promise.all([
        buildCachedViews().catch(() => []),
        db.multiplayer.listResultSyncLobbies().catch(() => []),
      ]);
      setMatches(nextCachedViews);
      setSyncQueueCount(nextQueue.length);
    } finally {
      setSyncing(false);
    }
  }, [t]);

  useEffect(() => {
    void syncNow();
    const interval = window.setInterval(() => {
      void syncNow();
    }, 15000);
    return () => {
      window.clearInterval(interval);
    };
  }, [syncNow]);

  const handleDeleteRun = useCallback(
    async (runId: string) => {
      setDeletingRunId(runId);
      setError(null);

      try {
        const result = await db.singlePlayerHistory.deleteRun(runId);
        setSingleRuns((current) => current.filter((run) => run.id !== runId));
        setLocalHighscore(Math.max(0, Math.floor(result.highscore ?? 0)));
        setLocalHighscoreCheatMode(result.highscoreCheatMode ?? false);
        setLocalHighscoreAssisted(result.highscoreAssisted ?? false);
        setLocalHighscoreAssistedSaveMode(
          toHighscoreAssistedSaveMode(result.highscoreAssistedSaveMode)
        );
        setPendingDeleteRunId((current) => (current === runId ? null : current));
      } catch (deleteError) {
        setError(
          deleteError instanceof Error
            ? deleteError.message
            : t`Could not delete single-player run.`
        );
      } finally {
        setDeletingRunId(null);
      }
    },
    [t]
  );

  const pendingDeleteRun = useMemo(
    () => singleRuns.find((run) => run.id === pendingDeleteRunId) ?? null,
    [pendingDeleteRunId, singleRuns]
  );

  const finalMatchCount = useMemo(() => matches.filter((match) => match.isFinal).length, [matches]);
  const singleRunCount = singleRuns.length;
  const singleRunNewBestCount = useMemo(
    () => singleRuns.filter((run) => run.wasNewHighscore).length,
    [singleRuns]
  );
  const activeSection =
    highscoreSections.find((section) => section.id === activeSectionId) ?? highscoreSections[0];
  const latestSingleRun = singleRuns[0] ?? null;
  const topMultiplayerScore = useMemo(
    () =>
      matches
        .flatMap((match) => match.rows)
        .reduce((best, row) => Math.max(best, row.finalScore), 0),
    [matches]
  );

  useControllerSurface({
    id: "highscores-route",
    scopeRef,
    priority: 10,
    initialFocusId: "highscores-sync",
    onBack: () => {
      void navigate({ to: "/" });
      return true;
    },
  });

  return (
    <div
      ref={scopeRef}
      className="relative min-h-screen overflow-hidden text-zinc-100 selection:bg-cyan-500/30"
    >
      <AnimatedBackground />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_12%_18%,rgba(34,211,238,0.18),transparent_40%),radial-gradient(circle_at_82%_16%,rgba(236,72,153,0.18),transparent_35%),radial-gradient(circle_at_55%_95%,rgba(244,114,182,0.12),transparent_45%)]" />

      <div className="relative z-10 flex h-screen flex-col overflow-hidden lg:flex-row">
        <nav className="animate-entrance flex shrink-0 flex-row gap-1 overflow-x-auto border-b border-purple-400/20 bg-zinc-950/70 px-3 py-2 backdrop-blur-xl lg:w-64 lg:flex-col lg:gap-0.5 lg:overflow-x-visible lg:overflow-y-auto lg:border-b-0 lg:border-r lg:px-3 lg:py-6">
          <div className="hidden lg:mb-5 lg:block lg:px-3">
            <p className="font-[family-name:var(--font-jetbrains-mono)] text-[0.6rem] uppercase tracking-[0.45em] text-purple-200/70">
              <Trans>Result Nexus</Trans>
            </p>
            <h1 className="mt-1.5 text-xl font-black tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-violet-200 via-purple-100 to-indigo-200 drop-shadow-[0_0_20px_rgba(139,92,246,0.45)]">
              <Trans>Highscore Hub</Trans>
            </h1>
            <p className="mt-2 text-sm text-zinc-400">
              <Trans>
                Track local runs, compare multiplayer standings, and keep cached results in sync.
              </Trans>
            </p>
          </div>

          {highscoreSections.map((section) => {
            const active = section.id === activeSectionId;
            return (
              <button
                key={section.id}
                type="button"
                onMouseEnter={playHover}
                onFocus={playHover}
                onClick={() => {
                  playClick();
                  setActiveSectionId(section.id);
                }}
                className={`settings-sidebar-item whitespace-nowrap ${active ? "is-active" : ""}`}
              >
                <span aria-hidden="true" className="settings-sidebar-icon">
                  {section.icon}
                </span>
                <span>{abbreviateNsfwText(i18n._(section.title), sfwMode)}</span>
              </button>
            );
          })}

          <div className="hidden lg:mt-auto lg:block lg:px-1 lg:pt-4">
            <MenuButton
              label={t`← Back`}
              onHover={playHover}
              onClick={() => {
                playClick();
                void navigate({ to: "/" });
              }}
              controllerFocusId="highscores-main-menu"
              controllerBack
            />
          </div>
        </nav>

        <div className="flex-1 overflow-y-auto px-4 py-6 sm:px-8 lg:px-10 lg:py-8">
          <main className="parallax-ui-none mx-auto flex w-full max-w-6xl flex-col gap-5">
            <header className="settings-panel-enter mb-1">
              <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
                <div>
                  <p className="font-[family-name:var(--font-jetbrains-mono)] text-[10px] uppercase tracking-[0.34em] text-violet-200/75">
                    <Trans>Highscore Hub</Trans>
                  </p>
                  <h2 className="mt-2 text-3xl font-black tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-violet-200 via-purple-100 to-indigo-200 drop-shadow-[0_0_20px_rgba(139,92,246,0.4)] sm:text-4xl">
                    {abbreviateNsfwText(i18n._(activeSection.title), sfwMode)}
                  </h2>
                  <p className="mt-2 max-w-3xl text-sm text-zinc-400">
                    {i18n._(activeSection.description)}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <div className="rounded-xl border border-violet-200/30 bg-violet-400/10 px-4 py-2 font-[family-name:var(--font-jetbrains-mono)] text-xs uppercase tracking-[0.24em] text-violet-100">
                    {t`Local Best`} {localHighscore}
                    {localHighscoreCheatMode ? " 🎭" : ""}
                    {localHighscoreAssisted && localHighscoreAssistedSaveMode
                      ? ` ${getSaveModeEmoji(localHighscoreAssistedSaveMode)}`
                      : ""}
                  </div>
                  <div className="rounded-xl border border-cyan-300/30 bg-cyan-500/10 px-4 py-2 font-[family-name:var(--font-jetbrains-mono)] text-xs uppercase tracking-[0.24em] text-cyan-100">
                    {t`Queue`} {syncQueueCount}
                  </div>
                  <button
                    type="button"
                    onMouseEnter={playHover}
                    onClick={() => {
                      playClick();
                      void syncNow();
                    }}
                    className="rounded-xl border border-cyan-300/55 bg-cyan-500/16 px-4 py-2 font-[family-name:var(--font-jetbrains-mono)] text-xs uppercase tracking-[0.2em] text-cyan-100 transition-all duration-200 hover:border-cyan-200/80 hover:bg-cyan-500/30"
                    data-controller-focus-id="highscores-sync"
                    data-controller-initial="true"
                  >
                    {syncing ? t`Syncing...` : t`Sync Now`}
                  </button>
                </div>
              </div>
              {error && (
                <p className="mt-4 rounded-xl border border-amber-300/35 bg-amber-500/15 px-4 py-3 text-sm text-amber-100">
                  {error}
                </p>
              )}
            </header>

            <div
              className="settings-panel-enter flex flex-col gap-5"
              key={`content-${activeSection.id}`}
            >
              {activeSection.id === "overview" && (
                <>
                  <section
                    className="animate-entrance rounded-3xl border border-purple-400/25 bg-zinc-950/55 p-5 backdrop-blur-xl"
                    style={{ animationDelay: "0.05s" }}
                  >
                    <div className="mb-5">
                      <h3 className="text-lg font-extrabold tracking-tight text-violet-100">
                        <Trans>Score Snapshot</Trans>
                      </h3>
                      <p className="mt-1 text-sm text-zinc-300">
                        <Trans>
                          The fastest read on current local progress and multiplayer cache health.
                        </Trans>
                      </p>
                    </div>
                    <InlineMetrics
                      className="mb-5"
                      metrics={[
                        { label: t`Local Best`, value: localHighscore, tone: "violet" },
                        { label: t`Single Runs`, value: singleRunCount, tone: "cyan" },
                        { label: t`Final Matches`, value: finalMatchCount, tone: "emerald" },
                        { label: t`Sync Queue`, value: syncQueueCount, tone: "amber" },
                      ]}
                    />
                  </section>

                  <section className="grid gap-5 xl:grid-cols-[1.05fr_0.95fr]">
                    <div
                      className="animate-entrance rounded-3xl border border-purple-400/25 bg-zinc-950/55 p-5 backdrop-blur-xl"
                      style={{ animationDelay: "0.08s" }}
                    >
                      <div className="mb-4">
                        <h3 className="text-lg font-extrabold tracking-tight text-violet-100">
                          <Trans>Sync & Cache</Trans>
                        </h3>
                        <p className="mt-1 text-sm text-zinc-300">
                          <Trans>
                            Pull remote match history into the local cache, then browse it instantly
                            from the multiplayer section.
                          </Trans>
                        </p>
                      </div>
                      <div className="space-y-3">
                        <HighscoreActionButton
                          label={syncing ? t`Syncing...` : t`Sync Now`}
                          description={t`Refresh local highscore data and attempt multiplayer result cache updates.`}
                          tone="cyan"
                          onHover={playHover}
                          onClick={() => {
                            playClick();
                            void syncNow();
                          }}
                        />
                        <div className="rounded-2xl border border-zinc-700/70 bg-black/25 p-4">
                          <p className="font-[family-name:var(--font-jetbrains-mono)] text-[10px] uppercase tracking-[0.22em] text-zinc-400">
                            <Trans>Current Status</Trans>
                          </p>
                          <p className="mt-2 text-sm text-zinc-100">
                            {syncing
                              ? t`Refreshing local and remote result history.`
                              : t`Idle. Cached history is ready to browse.`}
                          </p>
                          <p className="mt-2 text-sm text-zinc-400">
                            {syncQueueCount > 0
                              ? syncQueueCount === 1
                                ? t`1 multiplayer result entry is still queued.`
                                : t`${syncQueueCount} multiplayer result entries are still queued.`
                              : t`No queued multiplayer results remain.`}
                          </p>
                        </div>
                      </div>
                    </div>

                    <div
                      className="animate-entrance rounded-3xl border border-purple-400/25 bg-zinc-950/55 p-5 backdrop-blur-xl"
                      style={{ animationDelay: "0.11s" }}
                    >
                      <div className="mb-4">
                        <h3 className="text-lg font-extrabold tracking-tight text-violet-100">
                          <Trans>Quick Jumps</Trans>
                        </h3>
                        <p className="mt-1 text-sm text-zinc-300">
                          <Trans>
                            Move straight to the detailed score views when you know what you want to
                            inspect.
                          </Trans>
                        </p>
                      </div>
                      <div className="space-y-3">
                        <button
                          type="button"
                          onMouseEnter={playHover}
                          onClick={() => {
                            playClick();
                            setActiveSectionId("single");
                          }}
                          className="w-full rounded-2xl border border-violet-300/25 bg-black/30 px-4 py-4 text-left transition-all duration-200 hover:border-violet-200/60 hover:bg-violet-500/10"
                        >
                          <div className="font-semibold text-zinc-100">
                            <Trans>Open single-player history</Trans>
                          </div>
                          <div className="mt-1 text-sm text-zinc-400">
                            <Trans>
                              Review {singleRunCount} stored runs, including survival time and
                              playlist provenance.
                            </Trans>
                          </div>
                        </button>
                        <button
                          type="button"
                          onMouseEnter={playHover}
                          onClick={() => {
                            playClick();
                            setActiveSectionId("multiplayer");
                          }}
                          className="w-full rounded-2xl border border-cyan-300/25 bg-black/30 px-4 py-4 text-left transition-all duration-200 hover:border-cyan-200/60 hover:bg-cyan-500/10"
                        >
                          <div className="font-semibold text-zinc-100">
                            <Trans>Open multiplayer standings</Trans>
                          </div>
                          <div className="mt-1 text-sm text-zinc-400">
                            {matches.length === 1
                              ? t`Browse 1 cached match result and expand individual player standings.`
                              : t`Browse ${matches.length} cached match results and expand individual player standings.`}
                          </div>
                        </button>
                      </div>
                    </div>
                  </section>
                </>
              )}

              {activeSection.id === "single" && (
                <>
                  <section
                    className="animate-entrance rounded-3xl border border-purple-400/25 bg-zinc-950/55 p-5 backdrop-blur-xl"
                    style={{ animationDelay: "0.05s" }}
                  >
                    <div className="mb-5">
                      <h3 className="text-lg font-extrabold tracking-tight text-violet-100">
                        <Trans>Single-Player Summary</Trans>
                      </h3>
                      <p className="mt-1 text-sm text-zinc-300">
                        <Trans>
                          Local run history is stored directly in the app database, including legacy
                          rows and newer survival-time data.
                        </Trans>
                      </p>
                    </div>
                    <InlineMetrics
                      className="mb-5"
                      metrics={[
                        { label: t`Best Score`, value: localHighscore, tone: "violet" },
                        { label: t`Run Count`, value: singleRunCount, tone: "cyan" },
                        { label: t`New Bests`, value: singleRunNewBestCount, tone: "emerald" },
                        {
                          label: t`Latest Survival`,
                          value: latestSingleRun ? formatRunSurvival(latestSingleRun, t) : t`N/A`,
                          tone: "amber",
                        },
                      ]}
                    />
                  </section>

                  <section
                    className="animate-entrance rounded-3xl border border-purple-400/25 bg-zinc-950/55 p-5 backdrop-blur-xl"
                    style={{ animationDelay: "0.08s" }}
                  >
                    <div className="mb-4">
                      <h3 className="text-lg font-extrabold tracking-tight text-violet-100">
                        <Trans>Singleplayer Run History</Trans>
                      </h3>
                      <p className="mt-1 text-sm text-zinc-300">
                        <Trans>
                          Each row preserves score progression, completion reason, playlist
                          reference, and survival duration when available.
                        </Trans>
                      </p>
                    </div>
                    {singleRuns.length === 0 && (
                      <div className="rounded-xl border border-zinc-700/70 bg-zinc-900/75 px-4 py-3 text-sm text-zinc-300">
                        <Trans>No single-player history yet.</Trans>
                      </div>
                    )}
                    {singleRuns.length > 0 && (
                      <div className="divide-y divide-violet-300/10">
                        {singleRuns.map((run) => (
                          <div
                            key={run.id}
                            className="py-3 transition-colors hover:bg-violet-500/5 -mx-2 px-2"
                            title={
                              run.cheatModeActive
                                ? t`This run was completed with cheat mode active`
                                : run.assistedActive
                                  ? getAssistedTooltip(run.assistedSaveMode ?? null)
                                  : undefined
                            }
                          >
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div className="flex items-center gap-3">
                                <span className="font-bold text-zinc-100">
                                  {run.score}
                                  {run.cheatModeActive ? " 🎭" : ""}
                                  {run.assistedActive && run.assistedSaveMode
                                    ? ` ${getSaveModeEmoji(run.assistedSaveMode)}`
                                    : ""}
                                </span>
                                <span className="text-xs text-zinc-400">
                                  {abbreviateNsfwText(
                                    getSinglePlayerReasonLabel(t, run.completionReason ?? ""),
                                    sfwMode
                                  )}
                                </span>
                              </div>
                              <div className="flex items-center gap-2">
                                <span className="text-xs text-zinc-500">
                                  {new Date(run.finishedAt).toLocaleDateString()}
                                </span>
                                <button
                                  type="button"
                                  onMouseEnter={playHover}
                                  onFocus={playHover}
                                  onClick={() => {
                                    playClick();
                                    setPendingDeleteRunId(run.id);
                                  }}
                                  disabled={deletingRunId === run.id}
                                  className="rounded-lg border border-rose-300/35 bg-rose-500/10 px-2.5 py-1 font-[family-name:var(--font-jetbrains-mono)] text-[10px] uppercase tracking-[0.14em] text-rose-100 transition-all duration-200 hover:border-rose-200/70 hover:bg-rose-500/20 disabled:cursor-not-allowed disabled:opacity-50"
                                  aria-label={t`Delete run ${run.score}`}
                                >
                                  {deletingRunId === run.id ? t`Deleting...` : t`Delete`}
                                </button>
                              </div>
                            </div>
                            <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-400">
                              <span>
                                <Trans>Survived:</Trans>{" "}
                                <span className="text-zinc-200">{formatRunSurvival(run, t)}</span>
                              </span>
                              <span>
                                <Trans>Playlist:</Trans>{" "}
                                <span className="text-zinc-200">{formatPlaylistLabel(run, t)}</span>
                              </span>
                              <span>
                                <Trans>Before:</Trans>{" "}
                                <span className="text-zinc-200">{run.highscoreBefore}</span> →{" "}
                                <Trans>After:</Trans>{" "}
                                <span className="text-zinc-200">{run.highscoreAfter}</span>
                              </span>
                              <span className={run.wasNewHighscore ? "text-emerald-300" : ""}>
                                {run.wasNewHighscore ? t`New Best!` : ""}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </section>
                </>
              )}

              {activeSection.id === "multiplayer" && (
                <>
                  <section
                    className="animate-entrance rounded-3xl border border-purple-400/25 bg-zinc-950/55 p-5 backdrop-blur-xl"
                    style={{ animationDelay: "0.05s" }}
                  >
                    <div className="mb-5">
                      <h3 className="text-lg font-extrabold tracking-tight text-violet-100">
                        <Trans>Multiplayer Summary</Trans>
                      </h3>
                      <p className="mt-1 text-sm text-zinc-300">
                        <Trans>
                          Cached standings let you revisit prior lobbies even when the remote
                          service is unavailable.
                        </Trans>
                      </p>
                    </div>
                    <InlineMetrics
                      className="mb-5"
                      metrics={[
                        { label: t`Cached Matches`, value: matches.length, tone: "cyan" },
                        { label: t`Finalized`, value: finalMatchCount, tone: "emerald" },
                        { label: t`Pending Queue`, value: syncQueueCount, tone: "amber" },
                        { label: t`Top Score`, value: topMultiplayerScore, tone: "violet" },
                      ]}
                    />
                  </section>

                  <section
                    className="animate-entrance rounded-3xl border border-purple-400/25 bg-zinc-950/55 p-5 backdrop-blur-xl"
                    style={{ animationDelay: "0.08s" }}
                  >
                    <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                      <div>
                        <h3 className="text-lg font-extrabold tracking-tight text-violet-100">
                          <Trans>Multiplayer Result History</Trans>
                        </h3>
                        <p className="mt-1 text-sm text-zinc-300">
                          <Trans>
                            Expand a cached match to review every player row from the stored
                            standings snapshot.
                          </Trans>
                        </p>
                      </div>
                      <HighscoreActionButton
                        label={syncing ? t`Syncing...` : t`Refresh Multiplayer`}
                        tone="cyan"
                        onHover={playHover}
                        onClick={() => {
                          playClick();
                          void syncNow();
                        }}
                      />
                    </div>
                    {matches.length === 0 && (
                      <div className="rounded-xl border border-zinc-700/70 bg-zinc-900/75 px-4 py-3 text-sm text-zinc-300">
                        <Trans>No multiplayer result cache yet.</Trans>
                      </div>
                    )}
                    {matches.length > 0 && (
                      <div className="divide-y divide-cyan-300/10">
                        {matches.map((match) => {
                          const expanded = expandedLobbyId === match.lobbyId;
                          return (
                            <div key={match.lobbyId} className="py-2">
                              <button
                                type="button"
                                onMouseEnter={playHover}
                                onClick={() => {
                                  playClick();
                                  if (!expanded) playReveal();
                                  setExpandedLobbyId(expanded ? null : match.lobbyId);
                                }}
                                className="flex w-full items-center justify-between gap-3 py-2 text-left transition-colors hover:bg-cyan-500/5 -mx-2 px-2 rounded-lg"
                                data-controller-focus-id={`highscores-match-${match.lobbyId}`}
                              >
                                <div className="flex items-center gap-3">
                                  <span
                                    className={`text-xs text-cyan-200 transition-transform duration-200 ${expanded ? "rotate-180" : ""}`}
                                  >
                                    ▾
                                  </span>
                                  <span className="font-semibold text-zinc-100">
                                    {t`Lobby`} {match.lobbyId.slice(0, 12)}
                                  </span>
                                  <span className="text-xs text-zinc-400">
                                    {match.isFinal ? t`Final` : t`Draft`}
                                  </span>
                                </div>
                                <span className="text-xs text-zinc-500">
                                  {new Date(match.finishedAtIso).toLocaleDateString()}
                                </span>
                              </button>
                              {expanded && (
                                <div className="ml-6 mt-2 space-y-1 border-l-2 border-cyan-500/30 pl-3">
                                  {match.rows.map((row) => (
                                    <div
                                      key={row.playerId}
                                      className="flex items-center justify-between gap-3 py-1.5 text-sm"
                                    >
                                      <span className="text-zinc-100">
                                        <span className="text-cyan-300">#{row.place}</span>{" "}
                                        {row.displayName}
                                      </span>
                                      <span className="font-bold text-cyan-200">
                                        {row.finalScore}
                                      </span>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </section>
                </>
              )}
            </div>

            <div className="mx-auto grid w-full max-w-md grid-cols-1 gap-2 pb-6 lg:hidden">
              <MenuButton
                label={t`Back to Main Menu`}
                onHover={playHover}
                onClick={() => {
                  playClick();
                  void navigate({ to: "/" });
                }}
                controllerFocusId="highscores-main-menu"
                controllerBack
              />
            </div>
          </main>
        </div>
      </div>
      <DeleteRunConfirmDialog
        run={pendingDeleteRun}
        isPending={pendingDeleteRunId !== null && deletingRunId === pendingDeleteRunId}
        onCancel={() => {
          if (deletingRunId) return;
          setPendingDeleteRunId(null);
        }}
        onConfirm={() => {
          if (!pendingDeleteRunId) return;
          playClick();
          void handleDeleteRun(pendingDeleteRunId);
        }}
      />
    </div>
  );
}

export function HighscoreStatCard({
  label,
  value,
  description,
  tone = "violet",
  cheatMode,
  assisted,
  assistedSaveMode,
}: {
  label: string;
  value: string | number;
  description: string;
  tone?: "violet" | "cyan" | "emerald" | "amber";
  cheatMode?: boolean;
  assisted?: boolean;
  assistedSaveMode?: "checkpoint" | "everywhere" | null;
}) {
  const { t } = useLingui();
  const toneClass =
    tone === "cyan"
      ? "border-cyan-300/25 bg-cyan-500/10"
      : tone === "emerald"
        ? "border-emerald-300/25 bg-emerald-500/10"
        : tone === "amber"
          ? "border-amber-300/25 bg-amber-500/10"
          : "border-violet-300/25 bg-violet-500/10";

  return (
    <div
      className={`rounded-2xl border p-4 ${toneClass}`}
      title={
        cheatMode
          ? t`This highscore was achieved with cheat mode active`
          : assisted
            ? getAssistedTooltip(assistedSaveMode)
            : undefined
      }
    >
      <p className="font-[family-name:var(--font-jetbrains-mono)] text-[10px] uppercase tracking-[0.2em] text-zinc-300">
        {label}
      </p>
      <p className="mt-2 text-2xl font-black tracking-tight text-zinc-50">
        {value}
        {cheatMode && <span className="ml-1.5 text-lg cursor-help">🎭</span>}
        {assisted && assistedSaveMode && (
          <span className="ml-1.5 text-lg cursor-help" title={getAssistedTooltip(assistedSaveMode)}>
            {getSaveModeEmoji(assistedSaveMode)}
          </span>
        )}
      </p>
      <p className="mt-2 text-sm text-zinc-400">{description}</p>
    </div>
  );
}

function HighscoreActionButton({
  label,
  onClick,
  onHover,
  description,
  tone = "cyan",
}: {
  label: string;
  onClick: () => void;
  onHover: () => void;
  description?: string;
  tone?: "cyan" | "violet";
}) {
  const toneClass =
    tone === "violet"
      ? "border-violet-300/55 bg-violet-500/18 text-violet-100 hover:border-violet-200/80 hover:bg-violet-500/30"
      : "border-cyan-300/55 bg-cyan-500/18 text-cyan-100 hover:border-cyan-200/80 hover:bg-cyan-500/30";

  return (
    <button
      type="button"
      onMouseEnter={onHover}
      onFocus={onHover}
      onClick={onClick}
      className={`rounded-2xl border px-4 py-3 text-left font-[family-name:var(--font-jetbrains-mono)] text-xs uppercase tracking-[0.18em] transition-all duration-200 ${toneClass}`}
    >
      <div>{label}</div>
      {description && (
        <div className="mt-2 text-[11px] normal-case tracking-normal opacity-80">{description}</div>
      )}
    </button>
  );
}

function DeleteRunConfirmDialog({
  run,
  isPending,
  onCancel,
  onConfirm,
}: {
  run: SinglePlayerRunHistoryRow | null;
  isPending: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { t } = useLingui();

  if (!run) return null;

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/70 px-4 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-3xl border border-rose-300/35 bg-zinc-950/95 p-6 shadow-[0_0_60px_rgba(244,63,94,0.28)]">
        <p className="font-[family-name:var(--font-jetbrains-mono)] text-xs uppercase tracking-[0.35em] text-rose-200/80">
          <Trans>Confirm Deletion</Trans>
        </p>
        <h2 className="mt-3 text-2xl font-black tracking-tight text-rose-50">
          <Trans>Delete Highscore Entry?</Trans>
        </h2>
        <p className="mt-2 text-sm text-zinc-400">
          <Trans>
            This removes the stored single-player run from local history and may lower your local
            best score.
          </Trans>
        </p>

        <div className="mt-5 rounded-2xl border border-rose-300/25 bg-rose-500/10 p-4">
          <p className="text-sm text-zinc-100">
            <Trans>Score:</Trans> <span className="font-semibold">{run.score}</span>
          </p>
          <p className="mt-1 text-sm text-zinc-300">
            <Trans>Playlist:</Trans> {formatPlaylistLabel(run, t)}
          </p>
          <p className="mt-1 text-sm text-zinc-300">
            <Trans>Finished:</Trans> {new Date(run.finishedAt).toLocaleString()}
          </p>
        </div>

        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            disabled={isPending}
            onMouseEnter={playHoverSound}
            onClick={onCancel}
            className={`rounded-xl border px-4 py-2 text-sm font-semibold transition-all duration-200 ${
              isPending
                ? "cursor-not-allowed border-zinc-700 bg-zinc-900 text-zinc-500"
                : "border-zinc-600 bg-zinc-900/80 text-zinc-200 hover:border-zinc-400 hover:text-zinc-100"
            }`}
          >
            <Trans>Cancel</Trans>
          </button>
          <button
            type="button"
            disabled={isPending}
            onMouseEnter={playHoverSound}
            onClick={onConfirm}
            className={`rounded-xl border px-4 py-2 text-sm font-semibold transition-all duration-200 ${
              isPending
                ? "cursor-not-allowed border-zinc-600 bg-zinc-800 text-zinc-500"
                : "border-rose-300/70 bg-rose-500/25 text-rose-100 hover:border-rose-200/90 hover:bg-rose-500/40"
            }`}
          >
            {isPending ? t`Deleting...` : t`Confirm Deletion`}
          </button>
        </div>
      </div>
    </div>
  );
}
