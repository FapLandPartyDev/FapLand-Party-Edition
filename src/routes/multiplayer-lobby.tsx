import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as z from "zod";
import { AnimatedBackground } from "../components/AnimatedBackground";
import { useControllerSurface } from "../controller";
import { PlaylistResolutionModal } from "../components/PlaylistResolutionModal";
import {
  assertMultiplayerAllowed,
  useMultiplayerSfwRedirect,
} from "../hooks/useMultiplayerSfwGuard";
import { getInstalledRoundCatalogCached } from "../services/installedRoundsCache";
import {
  banLobbyPlayer,
  getLobbySnapshot,
  getOwnLobbyPlayer,
  heartbeat,
  isTerminalPlayerState,
  kickLobbyPlayer,
  markDisconnected,
  resolvePlaylistConflicts,
  setLobbyPublicState,
  setLobbyOpenState,
  setLobbyReady,
  startLobbyForAll,
  subscribeLobbyRealtime,
  sweepForfeits,
  type MultiplayerAntiPerkEvent,
  type MultiplayerLobbyPlayer,
  type MultiplayerLobbySnapshot,
} from "../services/multiplayer";
import { MultiplayerUpdateGuard } from "../components/multiplayer/MultiplayerUpdateGuard";

const LobbySearchSchema = z.object({
  lobbyId: z.string().min(1),
  inviteCode: z.string().optional(),
  playerId: z.string().min(1).optional(),
});

export const Route = createFileRoute("/multiplayer-lobby")({
  validateSearch: (search) => LobbySearchSchema.parse(search),
  loader: async ({ location }) => {
    await assertMultiplayerAllowed();
    const search = LobbySearchSchema.parse(location.search);
    const [snapshot, ownPlayer, installedRounds] = await Promise.all([
      getLobbySnapshot(search.lobbyId),
      getOwnLobbyPlayer(search.lobbyId),
      getInstalledRoundCatalogCached(),
    ]);

    return {
      search,
      initialSnapshot: snapshot,
      initialOwnPlayer: ownPlayer,
      installedRounds,
    };
  },
  component: MultiplayerLobbyRoute,
});

function formatRole(player: MultiplayerLobbyPlayer): string {
  if (player.role === "host") return "Host";
  return "Player";
}

function getResolutionStorageKey(
  lobbyId: string,
  playerId: string,
  snapshot: MultiplayerLobbySnapshot | null
): string | null {
  if (!playerId || !snapshot) return null;
  const playlistSnapshot = snapshot.lobby.playlistSnapshotJson;
  const exportedAt =
    playlistSnapshot && typeof playlistSnapshot === "object" && "exportedAt" in playlistSnapshot
      ? String((playlistSnapshot as { exportedAt?: unknown }).exportedAt ?? "unknown")
      : "unknown";
  return `multiplayer-playlist-resolution:${lobbyId}:${playerId}:${exportedAt}`;
}

function MultiplayerLobbyRoute() {
  const navigate = useNavigate();
  const sfwModeEnabled = useMultiplayerSfwRedirect();
  const {
    search,
    initialSnapshot,
    initialOwnPlayer,
    installedRounds: initialInstalledRounds,
  } = Route.useLoaderData();

  if (sfwModeEnabled) {
    return null;
  }

  const handleControllerBack = () => {
    void navigate({ to: "/multiplayer" });
    return true;
  };

  useControllerSurface({
    id: "multiplayer-lobby-page",
    priority: 10,
    enabled:
      typeof window !== "undefined" &&
      localStorage.getItem("experimental.controllerSupportEnabled") === "true",
    onBack: handleControllerBack,
  });

  const [snapshot, setSnapshot] = useState<MultiplayerLobbySnapshot | null>(initialSnapshot);
  const [ownPlayer, setOwnPlayer] = useState<MultiplayerLobbyPlayer | null>(initialOwnPlayer);
  const installedRounds = initialInstalledRounds;
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedTarget, setCopiedTarget] = useState<"code" | "link" | null>(null);
  const [antiPerkFeed, setAntiPerkFeed] = useState<MultiplayerAntiPerkEvent[]>([]);
  const [resolutionModalOpen, setResolutionModalOpen] = useState(false);
  const [manualOverrides, setManualOverrides] = useState<Record<string, string | null | undefined>>(
    {}
  );
  const [manualOverridesLoaded, setManualOverridesLoaded] = useState(false);
  const autoEnterInFlightRef = useRef(false);
  const autoEnterNavigatedRef = useRef(false);
  const lastAutoEnterAttemptKeyRef = useRef<string | null>(null);
  const autoReadyInFlightRef = useRef(false);
  const lastAutoReadyAttemptKeyRef = useRef<string | null>(null);
  const autoOpenedResolutionRef = useRef<string | null>(null);
  const copyResetTimeoutRef = useRef<number | null>(null);

  const ownPlayerId = ownPlayer?.id ?? search.playerId ?? "";
  const resolutionStorageKey = useMemo(
    () => getResolutionStorageKey(search.lobbyId, ownPlayerId, snapshot),
    [ownPlayerId, search.lobbyId, snapshot]
  );

  const refreshLobby = useCallback(async () => {
    const [nextSnapshot, nextOwnPlayer] = await Promise.all([
      getLobbySnapshot(search.lobbyId),
      getOwnLobbyPlayer(search.lobbyId),
    ]);

    setSnapshot(nextSnapshot);
    setOwnPlayer(nextOwnPlayer);
  }, [search.lobbyId]);

  useEffect(() => {
    let mounted = true;
    let unsubscribe: (() => Promise<void>) | null = null;

    void (async () => {
      try {
        unsubscribe = await subscribeLobbyRealtime(search.lobbyId, {
          onAnyChange: () => {
            if (!mounted) return;
            void refreshLobby().catch((refreshError) => {
              if (!mounted) return;
              setError(
                refreshError instanceof Error ? refreshError.message : "Failed to refresh lobby."
              );
            });
          },
          onAntiPerkEvent: (event) => {
            if (!mounted) return;
            setAntiPerkFeed((prev) => [event, ...prev].slice(0, 12));
          },
        });
      } catch (subscribeError) {
        if (!mounted) return;
        setError(
          subscribeError instanceof Error
            ? subscribeError.message
            : "Failed to subscribe to lobby updates."
        );
      }
    })();

    return () => {
      mounted = false;
      if (unsubscribe) {
        void unsubscribe();
      }
    };
  }, [refreshLobby, search.lobbyId]);

  useEffect(() => {
    if (!ownPlayerId) return;

    const interval = window.setInterval(() => {
      void heartbeat(search.lobbyId, ownPlayerId)
        .then(() => sweepForfeits(search.lobbyId, 300))
        .catch((heartbeatError) => {
          setError(
            heartbeatError instanceof Error
              ? heartbeatError.message
              : "Failed to send lobby heartbeat."
          );
        });
    }, 15000);

    const onBeforeUnload = () => {
      void markDisconnected(search.lobbyId, ownPlayerId).catch(() => {
        // noop
      });
    };

    window.addEventListener("beforeunload", onBeforeUnload);

    return () => {
      window.clearInterval(interval);
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, [ownPlayerId, search.lobbyId]);

  useEffect(() => {
    autoEnterInFlightRef.current = false;
    autoEnterNavigatedRef.current = false;
    lastAutoEnterAttemptKeyRef.current = null;
    autoReadyInFlightRef.current = false;
    lastAutoReadyAttemptKeyRef.current = null;
    autoOpenedResolutionRef.current = null;
  }, [search.lobbyId, ownPlayerId]);

  useEffect(() => {
    if (!resolutionStorageKey) {
      setManualOverrides({});
      setManualOverridesLoaded(true);
      return;
    }

    setManualOverridesLoaded(false);
    try {
      const raw = window.localStorage.getItem(resolutionStorageKey);
      if (!raw) {
        setManualOverrides({});
        setManualOverridesLoaded(true);
        return;
      }
      const parsed = JSON.parse(raw) as unknown;
      if (!parsed || typeof parsed !== "object") {
        setManualOverrides({});
        setManualOverridesLoaded(true);
        return;
      }
      const nextOverrides = Object.entries(parsed as Record<string, unknown>).reduce<
        Record<string, string | null | undefined>
      >((acc, [key, value]) => {
        if (value === null) {
          acc[key] = null;
          return acc;
        }
        if (typeof value === "string" && value.trim().length > 0) {
          acc[key] = value;
        }
        return acc;
      }, {});
      setManualOverrides(nextOverrides);
      setManualOverridesLoaded(true);
    } catch {
      setManualOverrides({});
      setManualOverridesLoaded(true);
    }
  }, [resolutionStorageKey]);

  useEffect(() => {
    if (!manualOverridesLoaded) return;
    if (!resolutionStorageKey) return;
    window.localStorage.setItem(resolutionStorageKey, JSON.stringify(manualOverrides));
  }, [manualOverrides, manualOverridesLoaded, resolutionStorageKey]);

  useEffect(
    () => () => {
      if (copyResetTimeoutRef.current !== null) {
        window.clearTimeout(copyResetTimeoutRef.current);
      }
    },
    []
  );

  useEffect(() => {
    const interval = window.setInterval(() => {
      void refreshLobby().catch((refreshError) => {
        setError(refreshError instanceof Error ? refreshError.message : "Failed to refresh lobby.");
      });
    }, 15000);

    return () => {
      window.clearInterval(interval);
    };
  }, [refreshLobby]);

  const resolution = useMemo(() => {
    if (!snapshot) {
      return {
        exactMapping: {},
        suggestedMapping: {},
        issues: [],
        counts: { exact: 0, suggested: 0, missing: 0 },
        mapping: {},
        unresolved: [],
      };
    }
    return resolvePlaylistConflicts(snapshot.lobby.playlistSnapshotJson, installedRounds);
  }, [installedRounds, snapshot]);
  const effectiveMapping = useMemo(() => {
    const nextMapping: Record<string, string> = {
      ...resolution.exactMapping,
      ...resolution.suggestedMapping,
    };

    for (const [key, value] of Object.entries(manualOverrides)) {
      if (value === null) {
        delete nextMapping[key];
        continue;
      }
      if (typeof value === "string" && value.trim().length > 0) {
        nextMapping[key] = value;
      }
    }

    return nextMapping;
  }, [manualOverrides, resolution.exactMapping, resolution.suggestedMapping]);
  const unresolvedIssues = useMemo(
    () => resolution.issues.filter((issue) => !effectiveMapping[issue.key]),
    [effectiveMapping, resolution.issues]
  );
  const unresolvedCount = unresolvedIssues.length;

  const isHost = ownPlayer?.role === "host";
  const ownPlayerState = ownPlayer?.state ?? null;
  const ownPlayerIsTerminal = ownPlayerState ? isTerminalPlayerState(ownPlayerState) : false;
  const activePlayerCount = useMemo(
    () =>
      (snapshot?.players ?? []).filter(
        (player) => player.state !== "kicked" && !isTerminalPlayerState(player.state)
      ).length,
    [snapshot]
  );

  useEffect(() => {
    if (!manualOverridesLoaded) return;
    if (!snapshot) return;
    if (resolution.counts.missing === 0 || unresolvedCount === 0) return;
    const autoOpenKey = `${search.lobbyId}:${ownPlayerId}:${resolutionStorageKey ?? "none"}`;
    if (autoOpenedResolutionRef.current === autoOpenKey) return;
    autoOpenedResolutionRef.current = autoOpenKey;
    setResolutionModalOpen(true);
  }, [
    manualOverridesLoaded,
    ownPlayerId,
    resolution.counts.missing,
    resolutionStorageKey,
    search.lobbyId,
    snapshot,
    unresolvedCount,
  ]);

  const handleReady = async () => {
    if (!ownPlayerId) {
      setError("Missing player id.");
      return;
    }

    setPending(true);
    setError(null);
    try {
      await setLobbyReady({
        lobbyId: search.lobbyId,
        playerId: ownPlayerId,
        mappingJson: effectiveMapping,
        unresolvedCount,
      });
      await refreshLobby();
    } catch (readyError) {
      setError(readyError instanceof Error ? readyError.message : "Failed to set ready state.");
    } finally {
      setPending(false);
    }
  };

  const handleStartForAll = async () => {
    if (!snapshot) {
      setError("Missing lobby snapshot.");
      return;
    }

    setPending(true);
    setError(null);
    try {
      await startLobbyForAll(snapshot.lobby.id);
      await refreshLobby();
    } catch (startError) {
      setError(
        startError instanceof Error ? startError.message : "Failed to start for all players."
      );
    } finally {
      setPending(false);
    }
  };

  useEffect(() => {
    const lobby = snapshot?.lobby;
    if (!lobby || lobby.status !== "waiting") return;
    if (!ownPlayerId || !ownPlayer) return;
    if (ownPlayer.state !== "joined" && ownPlayer.state !== "disconnected") return;
    if (ownPlayerIsTerminal) return;
    if (unresolvedCount > 0) return;
    if (pending || autoReadyInFlightRef.current) return;

    const attemptKey = `${search.lobbyId}:${ownPlayer.id}:${ownPlayer.state}:${unresolvedCount}`;
    if (lastAutoReadyAttemptKeyRef.current === attemptKey) return;
    lastAutoReadyAttemptKeyRef.current = attemptKey;
    autoReadyInFlightRef.current = true;

    void (async () => {
      try {
        await setLobbyReady({
          lobbyId: search.lobbyId,
          playerId: ownPlayerId,
          mappingJson: effectiveMapping,
          unresolvedCount: 0,
        });
        await refreshLobby();
      } catch (readyError) {
        setError(
          readyError instanceof Error ? readyError.message : "Failed to auto-set ready state."
        );
      } finally {
        autoReadyInFlightRef.current = false;
      }
    })();
  }, [
    effectiveMapping,
    ownPlayer,
    ownPlayerId,
    ownPlayerIsTerminal,
    pending,
    refreshLobby,
    search.lobbyId,
    snapshot,
    unresolvedCount,
  ]);

  useEffect(() => {
    const lobby = snapshot?.lobby;
    if (!lobby || lobby.status !== "running") return;
    if (!ownPlayerId || !ownPlayer) return;
    if (ownPlayer.role === "host" && activePlayerCount <= 1) return;
    if (ownPlayer.state === "kicked" || ownPlayerIsTerminal) return;
    if (unresolvedCount > 0) return;
    if (autoEnterInFlightRef.current || autoEnterNavigatedRef.current) return;

    const attemptKey = `${search.lobbyId}:${ownPlayer.id}:${ownPlayer.state}:${unresolvedCount}`;
    if (lastAutoEnterAttemptKeyRef.current === attemptKey) return;
    lastAutoEnterAttemptKeyRef.current = attemptKey;
    autoEnterInFlightRef.current = true;

    void (async () => {
      try {
        if (
          ownPlayer.state === "joined" ||
          ownPlayer.state === "disconnected" ||
          ownPlayer.state === "ready"
        ) {
          await setLobbyReady({
            lobbyId: search.lobbyId,
            playerId: ownPlayerId,
            mappingJson: effectiveMapping,
            unresolvedCount: 0,
          });
          await refreshLobby();
        }

        autoEnterNavigatedRef.current = true;
        await navigate({
          to: "/multiplayer-match",
          search: {
            lobbyId: search.lobbyId,
            playerId: ownPlayerId,
          },
          replace: true,
        });
      } catch (autoEnterError) {
        autoEnterNavigatedRef.current = false;
        setError(
          autoEnterError instanceof Error ? autoEnterError.message : "Failed to join running match."
        );
      } finally {
        autoEnterInFlightRef.current = false;
      }
    })();
  }, [
    activePlayerCount,
    effectiveMapping,
    navigate,
    ownPlayer,
    ownPlayerId,
    ownPlayerIsTerminal,
    refreshLobby,
    search.lobbyId,
    snapshot,
    unresolvedCount,
  ]);

  const lobby = snapshot?.lobby ?? null;
  const players = snapshot?.players ?? [];
  const inviteCode = (search.inviteCode ?? lobby?.inviteCode ?? "").trim().toUpperCase();
  const showRunningConflictBlocker =
    lobby?.status === "running" &&
    unresolvedCount > 0 &&
    ownPlayerState !== "kicked" &&
    !ownPlayerIsTerminal;

  const copyFallback = useCallback((text: string) => {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "true");
    textarea.style.position = "absolute";
    textarea.style.left = "-9999px";
    document.body.appendChild(textarea);
    textarea.select();
    const success = document.execCommand("copy");
    document.body.removeChild(textarea);
    if (!success) {
      throw new Error("Failed to copy invite info.");
    }
  }, []);

  const copyToClipboard = useCallback(
    async (text: string, target: "code" | "link") => {
      if (!text) return;
      try {
        if (navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(text);
        } else {
          copyFallback(text);
        }
        setCopiedTarget(target);
        if (copyResetTimeoutRef.current !== null) {
          window.clearTimeout(copyResetTimeoutRef.current);
        }
        copyResetTimeoutRef.current = window.setTimeout(() => {
          setCopiedTarget(null);
          copyResetTimeoutRef.current = null;
        }, 1200);
      } catch (copyError) {
        setError(copyError instanceof Error ? copyError.message : "Failed to copy invite info.");
      }
    },
    [copyFallback]
  );

  return (
    <MultiplayerUpdateGuard>
      <div className="relative h-screen overflow-y-auto px-4 py-6 text-zinc-100 sm:px-6 sm:py-8">
        <AnimatedBackground />
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(34,211,238,0.14),transparent_42%),radial-gradient(circle_at_82%_22%,rgba(129,140,248,0.18),transparent_34%),radial-gradient(circle_at_10%_100%,rgba(16,185,129,0.12),transparent_38%)]" />

        <div className="relative mx-auto flex w-full max-w-6xl flex-col gap-6">
          <header className="glass noise rounded-2xl p-4 sm:p-5">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <p className="mb-2 inline-flex items-center rounded-full border border-cyan-300/40 bg-cyan-400/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-cyan-100">
                  Matchmaking Terminal
                </p>
                <h1 className="font-[family-name:var(--font-jetbrains-mono)] text-3xl font-bold uppercase tracking-[0.08em] sm:text-4xl">
                  Lobby <span className="text-cyan-400">{inviteCode || "Unknown"}</span>
                </h1>
                <p className="mt-2 text-sm font-medium tracking-wide text-zinc-300">
                  Status:{" "}
                  <span
                    className={lobby?.status === "running" ? "text-emerald-400" : "text-amber-400"}
                  >
                    {lobby?.status ?? "unknown"}
                  </span>{" "}
                  | Lobby: {lobby?.name ?? "-"}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="rounded-xl border border-white/20 bg-black/30 px-4 py-2 text-sm font-semibold tracking-wide transition hover:border-white/40 active:scale-[0.98]"
                  onClick={() => {
                    void navigate({ to: "/multiplayer" });
                  }}
                >
                  Back
                </button>
                <button
                  type="button"
                  className="rounded-xl border border-emerald-300/45 bg-emerald-400/15 px-4 py-2 text-sm font-semibold tracking-wide text-emerald-100 transition hover:border-emerald-300/70 disabled:opacity-50 active:scale-[0.98]"
                  onClick={() => {
                    void navigate({
                      to: "/multiplayer-match",
                      search: {
                        lobbyId: search.lobbyId,
                        playerId: ownPlayerId,
                      },
                    });
                  }}
                  disabled={!ownPlayerId || (lobby?.status === "running" && unresolvedCount > 0)}
                >
                  Open Match View
                </button>
              </div>
            </div>
          </header>

          {error && (
            <div className="glass animated-entrance rounded-xl border border-rose-400/55 bg-rose-500/12 px-4 py-3 text-sm font-medium tracking-wide text-rose-100">
              {error}
            </div>
          )}

          {inviteCode && (
            <div
              className="group relative cursor-pointer overflow-hidden rounded-2xl border border-cyan-500/40 bg-cyan-950/40 p-1 transition-all duration-300 hover:scale-[1.01] hover:border-cyan-400/70 hover:shadow-[0_0_30px_rgba(34,211,238,0.2)] active:scale-[0.99]"
              onClick={() => void copyToClipboard(inviteCode, "code")}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  void copyToClipboard(inviteCode, "code");
                }
              }}
              role="button"
              tabIndex={0}
              aria-label="Copy invite code"
            >
              <div className="absolute inset-0 bg-gradient-to-r from-transparent via-cyan-400/10 to-transparent translate-x-[-100%] transition-transform duration-1000 group-hover:translate-x-[100%]" />
              <div className="glass noise flex flex-col items-center justify-center rounded-xl py-8 sm:py-12 relative z-10">
                <p className="text-sm font-semibold uppercase tracking-[0.3em] text-cyan-300 transition-colors group-hover:text-cyan-200">
                  {copiedTarget === "code" ? "Copied to Clipboard!" : "Click to Copy Invite Code"}
                </p>
                <div className="mt-4 font-[family-name:var(--font-jetbrains-mono)] text-6xl font-black tracking-[0.2em] text-cyan-50 drop-shadow-[0_0_15px_rgba(34,211,238,0.5)] sm:text-7xl transition-all group-hover:drop-shadow-[0_0_25px_rgba(34,211,238,0.8)] group-hover:scale-105">
                  {inviteCode}
                </div>
              </div>
            </div>
          )}

          {lobby && (
            <section className="glass noise rounded-2xl p-4 sm:p-5 border-cyan-300/20">
              <h2 className="font-[family-name:var(--font-jetbrains-mono)] text-lg font-bold uppercase tracking-[0.06em] text-cyan-100">
                Lobby Controls
              </h2>
              <p className="mt-1 text-xs text-zinc-300 font-medium tracking-wide">
                Visibility is{" "}
                <span className="font-semibold text-cyan-300">
                  {lobby.isPublic ? "public" : "private"}
                </span>
                . Late join is{" "}
                <span className="font-semibold text-cyan-300">
                  {lobby.allowLateJoin ? "enabled" : "disabled"}
                </span>
                .{" "}
                {lobby.isPublic
                  ? "Public lobbies appear in the browser when they are also open and joinable."
                  : "Private lobbies are invite-code only."}
              </p>

              <div className="mt-5 flex flex-wrap gap-3">
                <button
                  type="button"
                  disabled={pending || unresolvedCount > 0}
                  className="rounded-xl border border-cyan-400/50 bg-cyan-500/20 px-5 py-3 text-sm font-bold uppercase tracking-wider text-cyan-50 shadow-[0_0_15px_rgba(34,211,238,0.15)] transition-all hover:bg-cyan-500/30 hover:shadow-[0_0_25px_rgba(34,211,238,0.3)] disabled:opacity-50 active:scale-[0.98]"
                  onClick={() => void handleReady()}
                >
                  {pending ? "Submitting..." : "Ready (Manual Retry)"}
                </button>

                {isHost && (
                  <button
                    type="button"
                    disabled={pending || lobby.status !== "waiting" || ownPlayerState !== "ready"}
                    className="rounded-xl border border-rose-400/50 bg-gradient-to-r from-rose-500/20 to-pink-500/20 px-5 py-3 text-sm font-bold uppercase tracking-wider text-rose-50 shadow-[0_0_15px_rgba(244,63,94,0.15)] transition-all hover:shadow-[0_0_25px_rgba(244,63,94,0.3)] hover:brightness-125 disabled:opacity-50 active:scale-[0.98]"
                    onClick={() => void handleStartForAll()}
                  >
                    START MATCH
                  </button>
                )}

                {isHost && (
                  <button
                    type="button"
                    className="rounded-xl border border-emerald-400/40 bg-emerald-500/10 px-5 py-3 text-sm font-bold uppercase tracking-wider text-emerald-100 shadow-[0_0_15px_rgba(16,185,129,0.05)] transition-all hover:bg-emerald-500/20 hover:shadow-[0_0_20px_rgba(16,185,129,0.2)] active:scale-[0.98]"
                    onClick={() => {
                      void (async () => {
                        try {
                          await setLobbyPublicState(lobby.id, !lobby.isPublic);
                          await refreshLobby();
                        } catch (visibilityError) {
                          setError(
                            visibilityError instanceof Error
                              ? visibilityError.message
                              : "Failed to update public lobby visibility."
                          );
                        }
                      })();
                    }}
                  >
                    {lobby.isPublic
                      ? "Public Listing Enabled (Click to Hide)"
                      : "Private Lobby (Click to Advertise)"}
                  </button>
                )}

                {isHost && (
                  <button
                    type="button"
                    className="rounded-xl border border-amber-400/40 bg-amber-500/10 px-5 py-3 text-sm font-bold uppercase tracking-wider text-amber-100 shadow-[0_0_15px_rgba(245,158,11,0.05)] transition-all hover:bg-amber-500/20 hover:shadow-[0_0_20px_rgba(245,158,11,0.2)] active:scale-[0.98]"
                    onClick={() => {
                      void (async () => {
                        try {
                          await setLobbyOpenState(lobby.id, !lobby.isOpen);
                          await refreshLobby();
                        } catch (openError) {
                          setError(
                            openError instanceof Error
                              ? openError.message
                              : "Failed to update lobby lock state."
                          );
                        }
                      })();
                    }}
                  >
                    {lobby.isOpen
                      ? "Lobby Unlocked (Click to Lock)"
                      : "Lobby Locked (Click to Unlock)"}
                  </button>
                )}
              </div>

              {(resolution.issues.length > 0 || unresolvedCount > 0) && (
                <div className="mt-5 rounded-xl border border-rose-500/30 bg-rose-950/40 p-4">
                  <div className="text-xs font-semibold uppercase tracking-widest text-rose-300">
                    Exact:{" "}
                    <span className="font-bold text-emerald-300">{resolution.counts.exact}</span>
                    {" • "}
                    Suggested:{" "}
                    <span className="font-bold text-cyan-300">{resolution.counts.suggested}</span>
                    {" • "}
                    Remaining missing:{" "}
                    <span className="font-bold text-rose-400">{unresolvedCount}</span>
                  </div>
                  <div className="mt-3">
                    <button
                      type="button"
                      className="rounded-xl border border-cyan-400/45 bg-cyan-500/15 px-4 py-2 text-sm font-semibold text-cyan-100 hover:bg-cyan-500/25"
                      onClick={() => setResolutionModalOpen(true)}
                    >
                      {unresolvedCount > 0 ? "Resolve Missing" : "Review Auto-Resolve"}
                    </button>
                  </div>
                  <ul className="mt-3 grid gap-2 sm:grid-cols-2 text-xs font-medium text-zinc-300">
                    {unresolvedIssues.slice(0, 10).map((item) => (
                      <li
                        key={item.key}
                        className="flex items-center gap-2 rounded-lg bg-black/40 px-3 py-2"
                      >
                        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-rose-500 shadow-[0_0_5px_rgba(244,63,94,0.8)]"></span>
                        <span className="truncate">
                          {item.ref.name}{" "}
                          <span className="opacity-50">({item.ref.type ?? "Unknown"})</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {showRunningConflictBlocker && (
                <div className="mt-4 rounded-xl border border-amber-500/60 bg-amber-500/10 p-4 font-medium text-sm text-amber-200 shadow-[0_0_20px_rgba(245,158,11,0.1)]">
                  Match started. Install or resolve missing rounds to automatically join.
                </div>
              )}
            </section>
          )}

          <section className="grid grid-cols-1 gap-6 lg:grid-cols-3 pb-8">
            <div className="glass noise rounded-2xl p-4 sm:p-5 lg:col-span-2 flex flex-col gap-4 border-emerald-300/20">
              <h2 className="font-[family-name:var(--font-jetbrains-mono)] text-lg font-bold uppercase tracking-[0.06em] text-emerald-100">
                Active Players
              </h2>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {players.map((player) => {
                  const progress = snapshot?.progressByPlayerId[player.id];
                  const isReady = player.state === "ready" || player.state === "joined";
                  const isHostPlayer = player.role === "host";
                  const borderClass = isReady
                    ? "border-emerald-500/40 shadow-[0_0_20px_rgba(16,185,129,0.1)]"
                    : "border-white/10";
                  const bgClass = isReady ? "bg-emerald-500/10" : "bg-black/30";

                  return (
                    <div
                      key={player.id}
                      className={`group relative flex flex-col justify-between overflow-hidden rounded-xl border ${borderClass} ${bgClass} p-4 transition-all hover:scale-[1.02] hover:bg-black/40`}
                    >
                      <div className="absolute top-0 right-0 w-16 h-16 bg-gradient-to-bl from-white/5 to-transparent rounded-bl-full pointer-events-none" />

                      <div className="flex items-start justify-between gap-3 relative z-10">
                        <div className="min-w-0 flex-1">
                          <div className="font-[family-name:var(--font-jetbrains-mono)] text-xl font-bold text-zinc-100 truncate flex items-center gap-2">
                            {isHostPlayer && (
                              <span title="Host" className="text-amber-400">
                                ★
                              </span>
                            )}
                            {player.displayName}
                          </div>
                          <div className="mt-1.5 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-zinc-400">
                            <span className={isHostPlayer ? "text-amber-400" : ""}>
                              {formatRole(player)}
                            </span>
                            <span className="h-1 w-1 rounded-full bg-zinc-600"></span>
                            <span className={isReady ? "text-emerald-400" : "text-amber-400"}>
                              {player.state}
                            </span>
                          </div>
                        </div>
                        <div className="flex shrink-0 flex-col items-end text-right text-[11px] font-semibold tracking-widest text-zinc-400 bg-black/40 rounded-lg p-2 border border-white/5">
                          <span className="mb-1">
                            POS{" "}
                            <span className="text-zinc-200 text-xs">
                              {progress?.positionIndex ?? 0}
                            </span>
                          </span>
                          <span className="mb-1">
                            PTS{" "}
                            <span className="text-zinc-200 text-xs">
                              {progress?.score ?? player.finalScore ?? 0}
                            </span>
                          </span>
                          <span className="text-amber-400">₪ {progress?.money ?? 0}</span>
                        </div>
                      </div>

                      {isHost && !isHostPlayer && (
                        <div className="mt-4 flex gap-2 border-t border-white/10 pt-3 relative z-10 opacity-0 transition-opacity group-hover:opacity-100">
                          <button
                            type="button"
                            className="flex-1 rounded-lg border border-zinc-700 bg-zinc-900/80 px-2 py-2 text-xs font-bold tracking-widest uppercase text-zinc-300 transition hover:border-zinc-500 hover:text-white active:scale-95"
                            onClick={() => {
                              void (async () => {
                                try {
                                  await kickLobbyPlayer(search.lobbyId, player.id);
                                  await refreshLobby();
                                } catch (kickError) {
                                  setError(
                                    kickError instanceof Error
                                      ? kickError.message
                                      : "Failed to kick player."
                                  );
                                }
                              })();
                            }}
                          >
                            Kick
                          </button>
                          <button
                            type="button"
                            className="flex-1 rounded-lg border border-rose-500/40 bg-rose-500/10 px-2 py-2 text-xs font-bold tracking-widest uppercase text-rose-300 transition hover:bg-rose-500/20 hover:text-rose-200 active:scale-95"
                            onClick={() => {
                              void (async () => {
                                try {
                                  await banLobbyPlayer(search.lobbyId, player.id, "Host ban");
                                  await refreshLobby();
                                } catch (banError) {
                                  setError(
                                    banError instanceof Error
                                      ? banError.message
                                      : "Failed to ban player."
                                  );
                                }
                              })();
                            }}
                          >
                            Ban
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="glass noise rounded-2xl p-4 sm:p-5 flex flex-col border-rose-500/20 max-h-[500px]">
              <h2 className="font-[family-name:var(--font-jetbrains-mono)] text-lg font-bold uppercase tracking-[0.06em] text-rose-300 flex items-center gap-2">
                <span className="relative flex h-3 w-3">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-3 w-3 bg-rose-500"></span>
                </span>
                Anti-Perk Feed
              </h2>
              <div className="mt-5 flex flex-1 flex-col gap-3 overflow-y-auto pr-2 custom-scrollbar">
                {antiPerkFeed.length === 0 && (
                  <div className="flex h-32 items-center justify-center rounded-xl border border-white/5 bg-black/20 text-xs font-semibold tracking-widest text-zinc-500">
                    NO ACTIVE THREATS
                  </div>
                )}
                {antiPerkFeed.map((event) => (
                  <div
                    key={event.id}
                    className="relative overflow-hidden rounded-xl border border-rose-500/30 bg-rose-950/40 p-3 shadow-[0_0_15px_rgba(244,63,94,0.05)] transition-all hover:border-rose-400/50"
                  >
                    <div className="absolute left-0 top-0 h-full w-1 bg-gradient-to-b from-rose-400 to-pink-600"></div>
                    <div className="pl-3 flex flex-col gap-1">
                      <div className="font-[family-name:var(--font-jetbrains-mono)] text-sm font-bold tracking-wider text-rose-100">
                        {event.perkId} ACTIVATED
                      </div>
                      <div className="text-[10px] font-bold tracking-[0.2em] text-rose-300/80">
                        IMPACT COST: ₪{event.cost}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>
        </div>

        {snapshot && (
          <PlaylistResolutionModal
            open={resolutionModalOpen}
            title={`Resolve ${lobby?.name ?? "Lobby Playlist"}`}
            installedRounds={installedRounds}
            analysis={resolution}
            initialOverrides={manualOverrides}
            primaryActionLabel="Save Resolutions"
            onClose={() => setResolutionModalOpen(false)}
            onPrimaryAction={(overrides) => {
              setManualOverrides(overrides);
              setResolutionModalOpen(false);
            }}
          />
        )}
      </div>
    </MultiplayerUpdateGuard>
  );
}
