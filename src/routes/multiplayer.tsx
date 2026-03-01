import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { z } from "zod";
import { AnimatedBackground } from "../components/AnimatedBackground";
import { db } from "../services/db";
import {
  buildMultiplayerPlaylistSnapshot,
  createLobby,
  ensureMultiplayerAuth,
  getOptionalActiveMultiplayerServerProfile,
  getPreferredMultiplayerServerProfile,
  isLikelyConfiguredSupabaseServer,
  joinLobby,
  listMultiplayerServerProfiles,
  removeMultiplayerServerProfile,
  saveMultiplayerServerProfile,
  setActiveMultiplayerServerProfile,
  type MultiplayerServerProfile,
} from "../services/multiplayer";
import { playlists } from "../services/playlists";

const MultiplayerSearchSchema = z.object({
  inviteCode: z.string().optional(),
});

type OnboardingStatus = "provisioning" | "ready" | "error" | "unavailable";

export const Route = createFileRoute("/multiplayer")({
  validateSearch: (search) => MultiplayerSearchSchema.parse(search),
  loader: async () => {
    const [availablePlaylists, installedRounds, profiles, activeProfile] = await Promise.all([
      playlists.list(),
      db.round.findInstalled(),
      listMultiplayerServerProfiles(),
      getOptionalActiveMultiplayerServerProfile(),
    ]);
    const activePlaylist = availablePlaylists.length > 0 ? await playlists.getActive() : null;

    return {
      activePlaylist,
      availablePlaylists,
      installedRounds,
      profiles,
      activeProfile,
    };
  },
  component: MultiplayerRoute,
});

function MultiplayerRoute() {
  const navigate = useNavigate();
  const { activePlaylist, availablePlaylists, installedRounds, profiles, activeProfile } = Route.useLoaderData();
  const search = Route.useSearch();
  const bootstrapTokenRef = useRef(0);

  const [serverProfiles, setServerProfiles] = useState<MultiplayerServerProfile[]>(profiles);
  const [selectedServerId, setSelectedServerId] = useState(activeProfile?.id ?? profiles[0]?.id ?? "");
  const [displayName, setDisplayName] = useState<string>(() => localStorage.getItem("fland-multiplayer-username") || "Player");
  const [lobbyName, setLobbyName] = useState("My Lobby");
  const [selectedPlaylistId, setSelectedPlaylistId] = useState(activePlaylist?.id ?? availablePlaylists[0]?.id ?? "");
  const [allowLateJoin, setAllowLateJoin] = useState(true);
  const [inviteCode, setInviteCode] = useState(search.inviteCode ?? "");
  const [joinPending, setJoinPending] = useState(false);
  const [createPending, setCreatePending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newServerName, setNewServerName] = useState("");
  const [newServerUrl, setNewServerUrl] = useState("");
  const [newServerAnonKey, setNewServerAnonKey] = useState("");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [onboardingStatus, setOnboardingStatus] = useState<OnboardingStatus>("provisioning");
  const [onboardingMessage, setOnboardingMessage] = useState("Creating your multiplayer account on the selected server.");
  const [authBootstrapPending, setAuthBootstrapPending] = useState(false);

  useEffect(() => {
    localStorage.setItem("fland-multiplayer-username", displayName);
  }, [displayName]);

  const selectedServer = useMemo(
    () => serverProfiles.find((profile) => profile.id === selectedServerId) ?? activeProfile ?? null,
    [activeProfile, selectedServerId, serverProfiles],
  );
  const selectedPlaylist = useMemo(
    () => availablePlaylists.find((playlist: { id: string }) => playlist.id === selectedPlaylistId) ?? activePlaylist ?? null,
    [activePlaylist, availablePlaylists, selectedPlaylistId],
  );
  const serverConfigured = selectedServer ? isLikelyConfiguredSupabaseServer(selectedServer) : false;
  const hasServerProfiles = serverProfiles.length > 0;
  const hasPlayablePlaylist = availablePlaylists.length > 0 && selectedPlaylist !== null;
  const canPlay = onboardingStatus === "ready" && serverConfigured && !authBootstrapPending;

  const fieldLabelClass = "flex flex-col gap-1 text-xs font-semibold uppercase tracking-[0.14em] text-zinc-300";
  const fieldInputClass = "rounded-xl border border-white/15 bg-black/35 px-3 py-2.5 text-sm text-zinc-100 outline-none transition focus:border-cyan-300/60 focus:ring-2 focus:ring-cyan-400/25";
  const actionButtonClass = "rounded-xl border px-3 py-2 text-sm font-semibold tracking-wide transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100";

  const reloadServers = async () => {
    const [nextProfiles, nextActive] = await Promise.all([
      listMultiplayerServerProfiles(),
      getOptionalActiveMultiplayerServerProfile(),
    ]);
    setServerProfiles(nextProfiles);
    setSelectedServerId((current) => {
      if (current && nextProfiles.some((profile) => profile.id === current)) {
        return current;
      }
      return nextActive?.id ?? nextProfiles[0]?.id ?? "";
    });
    return {
      profiles: nextProfiles,
      activeProfile: nextActive,
    };
  };

  const bootstrapServer = async (profile: MultiplayerServerProfile | null, options?: { syncActive?: boolean }) => {
    const syncActive = options?.syncActive ?? false;
    const token = ++bootstrapTokenRef.current;

    if (!profile || !isLikelyConfiguredSupabaseServer(profile)) {
      setAuthBootstrapPending(false);
      setOnboardingStatus("unavailable");
      setOnboardingMessage("Online multiplayer is unavailable right now. Retry or use Advanced setup.");
      setAdvancedOpen(true);
      return;
    }

    setAuthBootstrapPending(true);
    setOnboardingStatus("provisioning");
    setOnboardingMessage("Creating your multiplayer account on the selected server.");

    try {
      if (syncActive) {
        await setActiveMultiplayerServerProfile(profile.id);
      }
      await ensureMultiplayerAuth(profile);
      if (bootstrapTokenRef.current !== token) return;
      setOnboardingStatus("ready");
      setOnboardingMessage("Your multiplayer account is ready. You can host a lobby or join with an invite code.");
      setError(null);
    } catch (bootstrapError) {
      if (bootstrapTokenRef.current !== token) return;
      setOnboardingStatus("error");
      setOnboardingMessage(bootstrapError instanceof Error
        ? bootstrapError.message
        : "Failed to create multiplayer account. Retry or use Advanced setup.");
      setAdvancedOpen(true);
    } finally {
      if (bootstrapTokenRef.current === token) {
        setAuthBootstrapPending(false);
      }
    }
  };

  useEffect(() => {
    void (async () => {
      const preferred = await getPreferredMultiplayerServerProfile();
      if (preferred) {
        setSelectedServerId(preferred.id);
      }
      await bootstrapServer(preferred, {
        syncActive: Boolean(preferred && preferred.id !== activeProfile?.id && isLikelyConfiguredSupabaseServer(preferred)),
      });
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleRetryBootstrap = () => {
    void bootstrapServer(selectedServer, {
      syncActive: Boolean(selectedServer && selectedServer.id !== activeProfile?.id && serverConfigured),
    });
  };

  const handleCreateLobby = async () => {
    if (!displayName.trim()) {
      setError("Display name is required.");
      return;
    }

    if (!selectedServer || !serverConfigured || onboardingStatus !== "ready") {
      setError("Online multiplayer is unavailable right now. Retry or use Advanced setup.");
      return;
    }
    if (!selectedPlaylist) {
      setError("Select a playlist before hosting a lobby.");
      return;
    }

    setCreatePending(true);
    setError(null);
    try {
      await setActiveMultiplayerServerProfile(selectedServer.id);
      const snapshot = buildMultiplayerPlaylistSnapshot(selectedPlaylist.config, installedRounds);
      const created = await createLobby({
        name: lobbyName.trim() || "My Lobby",
        playlistSnapshotJson: snapshot,
        displayName: displayName.trim(),
        allowLateJoin,
        serverLabel: selectedServer.name,
      }, selectedServer);

      await navigate({
        to: "/multiplayer-lobby",
        search: {
          lobbyId: created.lobbyId,
          inviteCode: created.inviteCode,
          playerId: created.playerId,
        },
      });
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Failed to create lobby.");
    } finally {
      setCreatePending(false);
    }
  };

  const handleJoinLobby = async () => {
    if (!displayName.trim()) {
      setError("Display name is required.");
      return;
    }

    if (!inviteCode.trim()) {
      setError("Invite code is required.");
      return;
    }

    if (!selectedServer || !serverConfigured || onboardingStatus !== "ready") {
      setError("Online multiplayer is unavailable right now. Retry or use Advanced setup.");
      return;
    }

    setJoinPending(true);
    setError(null);
    try {
      await setActiveMultiplayerServerProfile(selectedServer.id);
      const joined = await joinLobby({
        inviteCode: inviteCode.trim().toUpperCase(),
        displayName: displayName.trim(),
      }, selectedServer);

      await navigate({
        to: "/multiplayer-lobby",
        search: {
          lobbyId: joined.lobbyId,
          inviteCode: joined.inviteCode,
          playerId: joined.playerId,
        },
      });
    } catch (joinError) {
      setError(joinError instanceof Error ? joinError.message : "Failed to join lobby.");
    } finally {
      setJoinPending(false);
    }
  };

  const badgeClass = onboardingStatus === "ready"
    ? "border-emerald-300/50 bg-emerald-400/15 text-emerald-100"
    : onboardingStatus === "provisioning"
      ? "border-cyan-300/50 bg-cyan-400/15 text-cyan-100"
      : "border-amber-300/45 bg-amber-400/15 text-amber-100";

  const badgeLabel = onboardingStatus === "ready"
    ? "Ready"
    : onboardingStatus === "provisioning"
      ? "Creating Account"
      : onboardingStatus === "error"
        ? "Connection Failed"
        : "Unavailable";

  return (
    <div className="relative h-screen overflow-y-auto px-4 py-6 text-zinc-100 sm:px-6 sm:py-8">
      <AnimatedBackground />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(34,211,238,0.14),transparent_42%),radial-gradient(circle_at_82%_22%,rgba(129,140,248,0.18),transparent_34%),radial-gradient(circle_at_10%_100%,rgba(16,185,129,0.12),transparent_38%)]" />

      <div className="relative mx-auto flex w-full max-w-6xl flex-col gap-5">
        <header className="glass noise rounded-2xl p-4 sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="mb-2 inline-flex items-center rounded-full border border-cyan-300/40 bg-cyan-400/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-cyan-100">
                Matchmaking Terminal
              </p>
              <h1 className="font-[family-name:var(--font-jetbrains-mono)] text-3xl font-bold uppercase tracking-[0.08em] sm:text-4xl">
                Multiplayer
              </h1>
              <p className="mt-2 max-w-3xl text-sm text-zinc-300">
                Your multiplayer account is created automatically on the selected server. Use Advanced only if you run your own server.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => {
                  void navigate({ to: "/" });
                }}
                className={`${actionButtonClass} border-white/20 bg-black/30 hover:border-white/40`}
              >
                Back
              </button>
              <button
                type="button"
                onClick={() => {
                  void navigate({ to: "/multiplayer-bans" });
                }}
                className={`${actionButtonClass} border-orange-300/45 bg-orange-400/15 text-orange-100 hover:border-orange-300/70`}
              >
                Host Ban List
              </button>
            </div>
          </div>
        </header>

        {error && (
          <div className="glass rounded-xl border border-rose-400/55 bg-rose-500/12 px-4 py-3 text-sm text-rose-100">
            {error}
          </div>
        )}

        <section className="glass noise rounded-2xl p-4 sm:p-5" data-testid="multiplayer-onboarding-status">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-[11px] uppercase tracking-[0.18em] text-cyan-200">Selected Server</p>
              <h2 className="mt-1 font-[family-name:var(--font-jetbrains-mono)] text-2xl font-bold uppercase tracking-[0.08em]">
                {selectedServer?.name ?? "No Server Selected"}
              </h2>
              <p className="mt-2 max-w-3xl text-sm text-zinc-300">
                {onboardingMessage}
              </p>
              <p className="mt-2 text-xs text-zinc-400">
                Endpoint: <span className="break-all text-zinc-200">{selectedServer?.url || "No URL configured"}</span>
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className={`rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] ${badgeClass}`}>
                {badgeLabel}
              </span>
              {(onboardingStatus === "error" || onboardingStatus === "unavailable") && (
                <button
                  type="button"
                  onClick={handleRetryBootstrap}
                  className={`${actionButtonClass} border-cyan-300/40 bg-cyan-400/12 text-cyan-100 hover:border-cyan-300/70`}
                >
                  Retry
                </button>
              )}
            </div>
          </div>
        </section>

        <section className="glass noise rounded-2xl p-4 sm:p-5">
          <div className="grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
            <div className="rounded-2xl border border-white/10 bg-black/25 p-4">
              <h2 className="font-[family-name:var(--font-jetbrains-mono)] text-lg font-bold uppercase tracking-[0.06em]">
                Player Identity
              </h2>
              <label className={`${fieldLabelClass} mt-4`}>
                Display Name
                <input
                  className={fieldInputClass}
                  value={displayName}
                  onChange={(event) => setDisplayName(event.target.value)}
                  placeholder="Player"
                />
              </label>
              <div className="mt-4 rounded-xl border border-white/10 bg-black/35 p-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.15em] text-zinc-300">Preview</p>
                <p className="mt-2 text-sm text-zinc-400">You appear as</p>
                <p className="mt-1 font-[family-name:var(--font-jetbrains-mono)] text-xl font-bold uppercase tracking-[0.08em] text-cyan-100">
                  {displayName.trim() || "PLAYER"}
                </p>
              </div>
            </div>

            <div className="rounded-2xl border border-white/10 bg-black/25 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="font-[family-name:var(--font-jetbrains-mono)] text-lg font-bold uppercase tracking-[0.06em]">
                    Account Status
                  </h2>
                  <p className="mt-2 text-sm text-zinc-300">
                    {onboardingStatus === "ready"
                      ? "Anonymous multiplayer sign-in is complete for this server."
                      : onboardingStatus === "provisioning"
                        ? "The app is creating or resuming your multiplayer account in the background."
                        : "The default online flow is blocked. Open Advanced to use a self-hosted server."}
                  </p>
                </div>
                <div className="rounded-xl border border-white/10 bg-black/35 px-3 py-2 text-xs text-zinc-300">
                  {authBootstrapPending ? "Working..." : "Idle"}
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div className="glass noise flex flex-col justify-between rounded-2xl border-cyan-400/30 bg-cyan-950/10 p-5 sm:p-6 shadow-[0_0_20px_rgba(34,211,238,0.05)] transition-all hover:border-cyan-400/50">
            <div>
              <h3 className="font-[family-name:var(--font-jetbrains-mono)] text-xl font-black uppercase tracking-[0.08em] text-cyan-100 drop-shadow-[0_0_8px_rgba(34,211,238,0.5)]">
                Host Lobby
              </h3>
              <p className="mt-2 text-sm font-medium tracking-wide text-zinc-300">
                Create a new lobby on the selected server and share the generated invite code.
              </p>

              <label className={`${fieldLabelClass} mt-6`}>
                Lobby Name
                <input
                  className={`${fieldInputClass} py-3 text-base font-semibold`}
                  value={lobbyName}
                  onChange={(event) => setLobbyName(event.target.value)}
                />
              </label>

              <label className={`${fieldLabelClass} mt-4`}>
                Uploaded Playlist
                <select
                  className={`${fieldInputClass} py-3 font-semibold`}
                  value={selectedPlaylistId}
                  disabled={!hasPlayablePlaylist}
                  onChange={(event) => setSelectedPlaylistId(event.target.value)}
                >
                  {!hasPlayablePlaylist && (
                    <option value="">No playlists available</option>
                  )}
                  {availablePlaylists.map((playlist: { id: string; name: string }) => (
                    <option key={playlist.id} value={playlist.id}>
                      {playlist.name}
                      {playlist.id === activePlaylist?.id ? " (Active)" : ""}
                    </option>
                  ))}
                </select>
              </label>

              {!hasPlayablePlaylist && (
                <p className="mt-3 text-xs text-amber-200">
                  Create a playlist in the playlist workshop or map editor before hosting a lobby.
                </p>
              )}

              <label className="mt-4 flex cursor-pointer items-center gap-3 rounded-xl border border-white/10 bg-black/40 px-4 py-3 text-sm font-medium tracking-wide text-zinc-200 transition-colors hover:bg-black/60">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-cyan-500/50 bg-black/50 text-cyan-500 focus:ring-cyan-500/50 focus:ring-offset-0"
                  checked={allowLateJoin}
                  onChange={(event) => setAllowLateJoin(event.target.checked)}
                />
                Allow players to join after match start
              </label>
            </div>

            <button
              type="button"
              disabled={createPending || !hasPlayablePlaylist || !canPlay}
              className="mt-8 w-full rounded-xl border border-cyan-400/60 bg-gradient-to-r from-cyan-600/40 via-sky-600/40 to-indigo-600/40 px-4 py-4 text-base font-black uppercase tracking-[0.15em] text-cyan-50 drop-shadow-[0_0_10px_rgba(34,211,238,0.5)] transition-all hover:scale-[1.02] hover:border-cyan-300/80 hover:shadow-[0_0_30px_rgba(34,211,238,0.4)] hover:brightness-125 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:scale-100 disabled:hover:shadow-none active:scale-95"
              onClick={() => {
                void handleCreateLobby();
              }}
            >
              {createPending ? "Initializing..." : authBootstrapPending ? "Preparing Account..." : "Create Lobby"}
            </button>
          </div>

          <div className="glass noise flex flex-col justify-between rounded-2xl border-violet-400/40 bg-violet-950/20 p-5 sm:p-6 shadow-[0_0_30px_rgba(139,92,246,0.1)] transition-all hover:border-violet-400/60 hover:shadow-[0_0_40px_rgba(139,92,246,0.2)]">
            <div>
              <h3 className="font-[family-name:var(--font-jetbrains-mono)] text-xl font-black uppercase tracking-[0.08em] text-violet-100 drop-shadow-[0_0_8px_rgba(139,92,246,0.8)]">
                Join Lobby
              </h3>
              <p className="mt-2 text-sm font-medium tracking-wide text-zinc-300">
                Enter an invite code and join on the currently selected server.
              </p>

              <div className="mt-6 flex flex-col gap-2">
                <label htmlFor="multiplayer-invite-code" className="text-xs font-bold uppercase tracking-[0.2em] text-violet-300">
                  Invite Code
                </label>
                <input
                  id="multiplayer-invite-code"
                  className="rounded-xl border-2 border-violet-500/50 bg-black/50 px-5 py-4 font-[family-name:var(--font-jetbrains-mono)] text-3xl font-black tracking-[0.2em] text-violet-50 uppercase outline-none transition-all placeholder:text-violet-900/50 focus:border-violet-400 focus:bg-violet-950/40 focus:shadow-[0_0_25px_rgba(139,92,246,0.4)]"
                  value={inviteCode}
                  onChange={(event) => setInviteCode(event.target.value.toUpperCase())}
                  placeholder="CODE"
                />
              </div>
              <p className="mt-3 text-xs font-medium tracking-wide text-zinc-400">
                Codes are case-insensitive. Lowercase is automatically converted.
              </p>
            </div>

            <button
              type="button"
              disabled={joinPending || inviteCode.trim().length === 0 || !canPlay}
              className="mt-8 w-full rounded-xl border border-violet-400/60 bg-gradient-to-r from-violet-600/40 via-fuchsia-600/40 to-indigo-600/40 px-4 py-4 text-base font-black uppercase tracking-[0.15em] text-violet-50 drop-shadow-[0_0_10px_rgba(139,92,246,0.5)] transition-all hover:scale-[1.02] hover:border-violet-300/80 hover:shadow-[0_0_30px_rgba(139,92,246,0.5)] hover:brightness-125 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:scale-100 disabled:hover:shadow-none active:scale-95"
              onClick={() => {
                void handleJoinLobby();
              }}
            >
              {joinPending ? "Joining..." : authBootstrapPending ? "Preparing Account..." : "Join Lobby"}
            </button>
          </div>
        </section>

        <section className="glass noise rounded-2xl p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-[family-name:var(--font-jetbrains-mono)] text-lg font-bold uppercase tracking-[0.06em]">
                Advanced / Self-hosted
              </h2>
              <p className="mt-1 text-xs text-zinc-400">
                Use this only if you run your own server or need to override the default online backend.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setAdvancedOpen((current) => !current)}
              className={`${actionButtonClass} border-white/20 bg-black/30 hover:border-white/40`}
              aria-expanded={advancedOpen}
            >
              {advancedOpen ? "Hide Advanced" : "Show Advanced"}
            </button>
          </div>

          {advancedOpen && (
            <div className="mt-5 space-y-4">
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.2fr_1fr]">
                <div className="rounded-xl border border-white/10 bg-black/25 p-4">
                  <label className={fieldLabelClass}>
                    Active Server
                    <select
                      className={`${fieldInputClass} mt-1`}
                      value={selectedServerId}
                      disabled={!hasServerProfiles}
                      onChange={(event) => {
                        const nextServerId = event.target.value;
                        const nextServer = serverProfiles.find((profile) => profile.id === nextServerId) ?? null;
                        setSelectedServerId(nextServerId);
                        setError(null);
                        void bootstrapServer(nextServer, {
                          syncActive: Boolean(nextServer && isLikelyConfiguredSupabaseServer(nextServer)),
                        });
                      }}
                    >
                      {!hasServerProfiles && (
                        <option value="">No servers saved</option>
                      )}
                      {serverProfiles.map((profile) => (
                        <option key={profile.id} value={profile.id}>
                          {profile.name} {profile.isDefault ? "(Default)" : ""}
                        </option>
                      ))}
                    </select>
                  </label>

                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      className={`${actionButtonClass} border-cyan-300/40 bg-cyan-400/12 text-cyan-100 hover:border-cyan-300/70`}
                      onClick={() => {
                        if (!selectedServer) return;
                        setNewServerName(selectedServer.name);
                        setNewServerUrl(selectedServer.url);
                        setNewServerAnonKey(selectedServer.anonKey);
                      }}
                    >
                      Load Into Editor
                    </button>
                    {!selectedServer?.isDefault && (
                      <button
                        type="button"
                        className={`${actionButtonClass} border-rose-300/45 bg-rose-500/15 text-rose-100 hover:border-rose-300/70`}
                        onClick={() => {
                          void (async () => {
                            try {
                              if (!selectedServer) return;
                              await removeMultiplayerServerProfile(selectedServer.id);
                              const reloaded = await reloadServers();
                              const nextServer = reloaded.activeProfile ?? reloaded.profiles[0] ?? null;
                              await bootstrapServer(nextServer, {
                                syncActive: false,
                              });
                            } catch (removeError) {
                              setError(removeError instanceof Error ? removeError.message : "Failed to remove server profile.");
                            }
                          })();
                        }}
                      >
                        Remove Selected
                      </button>
                    )}
                  </div>
                </div>

                <div className="rounded-xl border border-white/10 bg-black/25 p-4">
                  <p className="text-xs uppercase tracking-[0.15em] text-zinc-300">Selected Endpoint</p>
                  <p className="mt-2 break-all rounded-lg border border-white/10 bg-black/35 px-3 py-2 text-xs text-zinc-200">
                    {selectedServer?.url || "No URL configured"}
                  </p>
                  <p className="mt-3 text-xs text-zinc-400">
                    Server name: <span className="text-zinc-200">{selectedServer?.name ?? "None selected"}</span>
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <label className={fieldLabelClass}>
                  Server Name
                  <input
                    className={fieldInputClass}
                    value={newServerName}
                    onChange={(event) => setNewServerName(event.target.value)}
                    placeholder="My Private Server"
                  />
                </label>
                <label className={fieldLabelClass}>
                  Supabase URL
                  <input
                    className={fieldInputClass}
                    value={newServerUrl}
                    onChange={(event) => setNewServerUrl(event.target.value)}
                    placeholder="https://project.supabase.co"
                  />
                </label>
                <label className={fieldLabelClass}>
                  Anon Key
                  <input
                    className={fieldInputClass}
                    value={newServerAnonKey}
                    onChange={(event) => setNewServerAnonKey(event.target.value)}
                    placeholder="ey..."
                  />
                </label>
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className={`${actionButtonClass} border-emerald-300/45 bg-emerald-500/15 text-emerald-100 hover:border-emerald-300/70`}
                  onClick={() => {
                    void (async () => {
                      try {
                        const saved = await saveMultiplayerServerProfile({
                          id: selectedServer?.id,
                          name: newServerName.trim() || "Custom Server",
                          url: newServerUrl.trim(),
                          anonKey: newServerAnonKey.trim(),
                        });
                        const reloaded = await reloadServers();
                        const nextServer = reloaded.profiles.find((profile) => profile.id === saved.id) ?? saved;
                        setSelectedServerId(saved.id);
                        await bootstrapServer(nextServer, {
                          syncActive: isLikelyConfiguredSupabaseServer(nextServer),
                        });
                        setError(null);
                      } catch (saveError) {
                        setError(saveError instanceof Error ? saveError.message : "Failed to save server profile.");
                      }
                    })();
                  }}
                >
                  {selectedServer ? "Update Selected" : "Save"}
                </button>
                <button
                  type="button"
                  className={`${actionButtonClass} border-sky-300/45 bg-sky-500/15 text-sky-100 hover:border-sky-300/70`}
                  onClick={() => {
                    void (async () => {
                      try {
                        const saved = await saveMultiplayerServerProfile({
                          name: newServerName.trim() || "Custom Server",
                          url: newServerUrl.trim(),
                          anonKey: newServerAnonKey.trim(),
                        });
                        await reloadServers();
                        setSelectedServerId(saved.id);
                        await bootstrapServer(saved, {
                          syncActive: isLikelyConfiguredSupabaseServer(saved),
                        });
                        setError(null);
                      } catch (saveError) {
                        setError(saveError instanceof Error ? saveError.message : "Failed to save server profile.");
                      }
                    })();
                  }}
                >
                  Save as New
                </button>
                <button
                  type="button"
                  className={`${actionButtonClass} border-white/20 bg-black/30 hover:border-white/40`}
                  onClick={() => {
                    setNewServerName("");
                    setNewServerUrl("");
                    setNewServerAnonKey("");
                    setError(null);
                  }}
                >
                  Clear Editor
                </button>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
