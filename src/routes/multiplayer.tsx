import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as z from "zod";
import { AnimatedBackground } from "../components/AnimatedBackground";
import { GameDropdown } from "../components/ui/GameDropdown";
import { useControllerSurface } from "../controller";
import {
  MULTIPLAYER_MINIMUM_ROUNDS,
  MULTIPLAYER_SKIP_ROUNDS_CHECK_KEY,
} from "../constants/experimentalFeatures";
import {
  assertMultiplayerAllowed,
  useMultiplayerSfwRedirect,
} from "../hooks/useMultiplayerSfwGuard";
import { getMultiplayerRequiredRounds } from "../game/playlistStats";
import { db } from "../services/db";
import { trpc } from "../services/trpc";
import {
  buildMultiplayerPlaylistSnapshot,
  createLobby,
  getLobbyJoinPreview,
  getOptionalActiveMultiplayerServerProfile,
  getPreferredMultiplayerServerProfile,
  isLikelyConfiguredSupabaseServer,
  joinLobby,
  listPublicLobbies,
  listMultiplayerServerProfiles,
  removeMultiplayerServerProfile,
  resolveMultiplayerAuthStatus,
  saveMultiplayerServerProfile,
  setActiveMultiplayerServerProfile,
  signInWithMultiplayerEmail,
  signUpWithMultiplayerEmail,
  startDiscordMultiplayerLink,
  subscribeToMultiplayerAuthRefresh,
  type MultiplayerAuthRequirement,
  type MultiplayerAuthStatus,
  type MultiplayerLobbyJoinPreview,
  type MultiplayerPublicLobbySummary,
  type MultiplayerServerProfile,
} from "../services/multiplayer";
import { playlists } from "../services/playlists";
import { playHoverSound, playSelectSound } from "../utils/audio";
import { MultiplayerUpdateGuard } from "../components/multiplayer/MultiplayerUpdateGuard";

const MultiplayerSearchSchema = z.object({
  inviteCode: z.string().optional(),
});

type OnboardingStatus =
  | "provisioning"
  | "ready"
  | "needs_discord"
  | "needs_email"
  | "needs_login"
  | "oauth_unavailable"
  | "error"
  | "unavailable";

type LobbyJoinRequirement = Pick<
  MultiplayerPublicLobbySummary,
  "inviteCode" | "name" | "requiredRoundCount" | "isOpen" | "status" | "allowLateJoin"
> &
  Partial<Pick<MultiplayerLobbyJoinPreview, "playlistName">>;

function arePublicLobbySummariesEqual(
  previous: MultiplayerPublicLobbySummary[],
  next: MultiplayerPublicLobbySummary[]
): boolean {
  if (previous === next) return true;
  if (previous.length !== next.length) return false;
  return previous.every((lobby, index) => {
    const other = next[index];
    return (
      other !== undefined &&
      lobby.lobbyId === other.lobbyId &&
      lobby.inviteCode === other.inviteCode &&
      lobby.name === other.name &&
      lobby.playlistName === other.playlistName &&
      lobby.playerCount === other.playerCount &&
      lobby.status === other.status &&
      lobby.isOpen === other.isOpen &&
      lobby.allowLateJoin === other.allowLateJoin &&
      lobby.requiredRoundCount === other.requiredRoundCount &&
      lobby.createdAt === other.createdAt
    );
  });
}

function getLobbyJoinBlockedReason(
  lobby: LobbyJoinRequirement,
  installedRoundsCount: number,
  skipRoundsCheck: boolean
): string | null {
  if (!lobby.isOpen) {
    return "Lobby is locked.";
  }
  if (lobby.status === "running" && !lobby.allowLateJoin) {
    return "Late join is disabled for this lobby.";
  }
  if (!skipRoundsCheck && installedRoundsCount < lobby.requiredRoundCount) {
    return `This lobby requires at least ${lobby.requiredRoundCount} installed rounds. You have ${installedRoundsCount}.`;
  }
  return null;
}

export const Route = createFileRoute("/multiplayer")({
  validateSearch: (search) => MultiplayerSearchSchema.parse(search),
  loader: async () => {
    await assertMultiplayerAllowed();
    const [availablePlaylists, installedRounds, profiles, activeProfile, rawSkipRoundsCheck] =
      await Promise.all([
        playlists.list(),
        db.round.findInstalled(),
        listMultiplayerServerProfiles(),
        getOptionalActiveMultiplayerServerProfile(),
        trpc.store.get.query({ key: MULTIPLAYER_SKIP_ROUNDS_CHECK_KEY }),
      ]);
    const activePlaylist = availablePlaylists.length > 0 ? await playlists.getActive() : null;
    const skipRoundsCheck =
      rawSkipRoundsCheck === true || rawSkipRoundsCheck === "true"
        ? true
        : rawSkipRoundsCheck === false || rawSkipRoundsCheck === "false"
          ? false
          : false;

    return {
      activePlaylist,
      availablePlaylists,
      installedRounds,
      profiles,
      activeProfile,
      skipRoundsCheck,
    };
  },
  component: MultiplayerRoute,
});

function MultiplayerRoute() {
  const navigate = useNavigate();
  const sfwModeEnabled = useMultiplayerSfwRedirect();

  if (sfwModeEnabled) {
    return null;
  }

  const {
    activePlaylist,
    availablePlaylists,
    installedRounds,
    profiles,
    activeProfile,
    skipRoundsCheck,
  } = Route.useLoaderData();
  const search = Route.useSearch();
  const bootstrapTokenRef = useRef(0);
  const goBack = () => {
    void navigate({ to: "/" });
  };

  const handleControllerBack = () => {
    playSelectSound();
    goBack();
    return true;
  };

  useControllerSurface({
    id: "multiplayer-page",
    priority: 10,
    enabled:
      typeof window !== "undefined" &&
      localStorage.getItem("experimental.controllerSupportEnabled") === "true",
    onBack: handleControllerBack,
  });

  const [serverProfiles, setServerProfiles] = useState<MultiplayerServerProfile[]>(profiles);
  const [selectedServerId, setSelectedServerId] = useState(
    activeProfile?.id ?? profiles[0]?.id ?? ""
  );
  const [displayName, setDisplayName] = useState<string>(
    () => localStorage.getItem("fland-multiplayer-username") || "Player"
  );
  const [lobbyName, setLobbyName] = useState("My Lobby");
  const [selectedPlaylistId, setSelectedPlaylistId] = useState(
    activePlaylist?.id ?? availablePlaylists[0]?.id ?? ""
  );
  const [allowLateJoin, setAllowLateJoin] = useState(true);
  const [advertisePublicly, setAdvertisePublicly] = useState(false);
  const [inviteCode, setInviteCode] = useState(search.inviteCode ?? "");
  const [joinPending, setJoinPending] = useState(false);
  const [createPending, setCreatePending] = useState(false);
  const [linkPending, setLinkPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [publicLobbies, setPublicLobbies] = useState<MultiplayerPublicLobbySummary[]>([]);
  const [publicLobbiesLoading, setPublicLobbiesLoading] = useState(false);
  const [publicLobbiesError, setPublicLobbiesError] = useState<string | null>(null);
  const [newServerName, setNewServerName] = useState("");
  const [newServerUrl, setNewServerUrl] = useState("");
  const [newServerAnonKey, setNewServerAnonKey] = useState("");
  const [editingServerId, setEditingServerId] = useState<string | null>(null);
  const [editingAuthRequirement, setEditingAuthRequirement] =
    useState<MultiplayerAuthRequirement>("anonymous_only");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [authStatus, setAuthStatus] = useState<MultiplayerAuthStatus | null>(null);
  const [onboardingStatus, setOnboardingStatus] = useState<OnboardingStatus>("provisioning");
  const [onboardingMessage, setOnboardingMessage] = useState(
    "Preparing multiplayer authentication on the selected server."
  );
  const [authBootstrapPending, setAuthBootstrapPending] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authMode, setAuthMode] = useState<"signin" | "signup">("signin");
  const [authPending, setAuthPending] = useState(false);

  useEffect(() => {
    localStorage.setItem("fland-multiplayer-username", displayName);
  }, [displayName]);

  const selectedServer = useMemo(
    () =>
      serverProfiles.find((profile) => profile.id === selectedServerId) ?? activeProfile ?? null,
    [activeProfile, selectedServerId, serverProfiles]
  );
  const editingServer = useMemo(
    () => serverProfiles.find((profile) => profile.id === editingServerId) ?? null,
    [editingServerId, serverProfiles]
  );
  const selectedPlaylist = useMemo(
    () =>
      availablePlaylists.find((playlist: { id: string }) => playlist.id === selectedPlaylistId) ??
      activePlaylist ??
      null,
    [activePlaylist, availablePlaylists, selectedPlaylistId]
  );
  const serverConfigured = selectedServer
    ? isLikelyConfiguredSupabaseServer(selectedServer)
    : false;
  const hasServerProfiles = serverProfiles.length > 0;
  const hasPlayablePlaylist = availablePlaylists.length > 0 && selectedPlaylist !== null;
  const hasEnoughRounds = installedRounds.length >= MULTIPLAYER_MINIMUM_ROUNDS;
  const selectedPlaylistRequiredRounds = selectedPlaylist
    ? getMultiplayerRequiredRounds(selectedPlaylist.config)
    : MULTIPLAYER_MINIMUM_ROUNDS;
  const roundsBlocked = !skipRoundsCheck && !hasEnoughRounds;
  const selectedPlaylistBlocked =
    !skipRoundsCheck && installedRounds.length < selectedPlaylistRequiredRounds;
  const canPlay =
    onboardingStatus === "ready" && serverConfigured && !authBootstrapPending && !roundsBlocked;
  const selectedServerEndpointLabel = selectedServer
    ? selectedServer.isBuiltIn
      ? "Hidden for built-in server"
      : selectedServer.url || "No URL configured"
    : "No URL configured";

  const actionButtonClass =
    "rounded-xl border px-3 py-2 text-sm font-semibold tracking-wide transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100";

  const refreshPublicLobbies = useCallback(
    async (profile: MultiplayerServerProfile | null, silent = false) => {
      if (!profile || !isLikelyConfiguredSupabaseServer(profile) || onboardingStatus !== "ready") {
        setPublicLobbies((current) => (current.length === 0 ? current : []));
        setPublicLobbiesError(null);
        if (!silent) setPublicLobbiesLoading(false);
        return;
      }

      if (!silent) setPublicLobbiesLoading(true);
      try {
        const nextLobbies = await listPublicLobbies(profile);
        setPublicLobbies((current) =>
          arePublicLobbySummariesEqual(current, nextLobbies) ? current : nextLobbies
        );
        setPublicLobbiesError(null);
      } catch (loadError) {
        setPublicLobbiesError(
          loadError instanceof Error ? loadError.message : "Failed to load public lobbies."
        );
      } finally {
        if (!silent) setPublicLobbiesLoading(false);
      }
    },
    [onboardingStatus]
  );

  const reloadServers = async () => {
    const [nextProfiles, nextActive] = await Promise.all([
      listMultiplayerServerProfiles(),
      getOptionalActiveMultiplayerServerProfile(),
    ]);
    setServerProfiles(nextProfiles);
    setSelectedServerId((current: string) => {
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

  const resetServerEditor = () => {
    setEditingServerId(null);
    setNewServerName("");
    setNewServerUrl("");
    setNewServerAnonKey("");
    setEditingAuthRequirement("anonymous_only");
    setError(null);
  };

  const loadServerIntoEditor = (profile: MultiplayerServerProfile) => {
    if (profile.isBuiltIn) {
      setError("Built-in servers cannot be loaded into the editor.");
      return;
    }
    setEditingServerId(profile.id);
    setNewServerName(profile.name);
    setNewServerUrl(profile.url);
    setNewServerAnonKey(profile.anonKey);
    setEditingAuthRequirement(profile.authRequirement ?? "anonymous_only");
    setError(null);
  };

  const refreshAuth = async (
    profile: MultiplayerServerProfile | null,
    options?: { syncActive?: boolean }
  ) => {
    const syncActive = options?.syncActive ?? false;
    const token = ++bootstrapTokenRef.current;

    if (!profile || !isLikelyConfiguredSupabaseServer(profile)) {
      setAuthBootstrapPending(false);
      setAuthStatus(null);
      setOnboardingStatus("unavailable");
      setOnboardingMessage(
        "Online multiplayer is unavailable right now. Retry or use Advanced setup."
      );
      setAdvancedOpen(true);
      return;
    }

    setAuthBootstrapPending(true);
    setOnboardingStatus("provisioning");
    setOnboardingMessage("Creating or resuming your multiplayer account on the selected server.");

    try {
      if (syncActive) {
        await setActiveMultiplayerServerProfile(profile.id);
      }
      const resolvedStatus = await resolveMultiplayerAuthStatus(profile);
      if (bootstrapTokenRef.current !== token) return;
      setAuthStatus(resolvedStatus);
      setOnboardingStatus(resolvedStatus.status);
      setOnboardingMessage(resolvedStatus.message);
      if (resolvedStatus.status === "oauth_unavailable") {
        setAdvancedOpen(true);
      }
      setError(null);
    } catch (bootstrapError) {
      if (bootstrapTokenRef.current !== token) return;
      setAuthStatus(null);
      setOnboardingStatus("error");
      setOnboardingMessage(
        bootstrapError instanceof Error
          ? bootstrapError.message
          : "Failed to prepare multiplayer authentication. Retry or use Advanced setup."
      );
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
      await refreshAuth(preferred, {
        syncActive: Boolean(
          preferred &&
          preferred.id !== activeProfile?.id &&
          isLikelyConfiguredSupabaseServer(preferred)
        ),
      });
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    return subscribeToMultiplayerAuthRefresh(() => {
      void refreshAuth(selectedServer, {
        syncActive: false,
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedServerId, serverProfiles]);

  useEffect(() => {
    if (!selectedServer || !serverConfigured || onboardingStatus !== "ready") {
      setPublicLobbies([]);
      setPublicLobbiesError(null);
      setPublicLobbiesLoading(false);
      return;
    }

    void refreshPublicLobbies(selectedServer);
    const interval = window.setInterval(() => {
      void refreshPublicLobbies(selectedServer, true);
    }, 10000);

    return () => {
      window.clearInterval(interval);
    };
  }, [onboardingStatus, refreshPublicLobbies, selectedServer, serverConfigured]);

  const handleRetryBootstrap = () => {
    void refreshAuth(selectedServer, {
      syncActive: Boolean(
        selectedServer && selectedServer.id !== activeProfile?.id && serverConfigured
      ),
    });
  };

  const handleLinkDiscord = async () => {
    if (!selectedServer) return;
    setLinkPending(true);
    setError(null);
    try {
      await setActiveMultiplayerServerProfile(selectedServer.id);
      await startDiscordMultiplayerLink(selectedServer);
    } catch (linkError) {
      setError(linkError instanceof Error ? linkError.message : "Failed to start Discord linking.");
    } finally {
      setLinkPending(false);
    }
  };

  const handleAuthEmail = async () => {
    if (!email.trim() || !password.trim()) {
      setError("Email and password are required.");
      return;
    }

    setAuthPending(true);
    setError(null);
    try {
      if (authMode === "signin") {
        await signInWithMultiplayerEmail(email, password, selectedServer ?? undefined);
      } else {
        await signUpWithMultiplayerEmail(email, password, selectedServer ?? undefined);
      }
      setEmail("");
      setPassword("");
    } catch (authErr) {
      setError(authErr instanceof Error ? authErr.message : "Authentication failed.");
    } finally {
      setAuthPending(false);
    }
  };

  const handleCreateLobby = async () => {
    if (!displayName.trim()) {
      setError("Display name is required.");
      return;
    }

    if (!selectedServer || !serverConfigured || onboardingStatus !== "ready") {
      setError("Multiplayer is not ready on this server yet.");
      return;
    }
    if (!selectedPlaylist) {
      setError("Select a playlist before hosting a lobby.");
      return;
    }
    if (!skipRoundsCheck && installedRounds.length < selectedPlaylistRequiredRounds) {
      setError(
        `This playlist requires at least ${selectedPlaylistRequiredRounds} installed rounds. You have ${installedRounds.length}.`
      );
      return;
    }

    setCreatePending(true);
    setError(null);
    try {
      await setActiveMultiplayerServerProfile(selectedServer.id);
      const snapshot = buildMultiplayerPlaylistSnapshot(selectedPlaylist.config, installedRounds, {
        name: selectedPlaylist.name,
      });
      const created = await createLobby(
        {
          name: lobbyName.trim() || "My Lobby",
          playlistSnapshotJson: snapshot,
          displayName: displayName.trim(),
          allowLateJoin,
          isPublic: advertisePublicly,
          serverLabel: selectedServer.name,
        },
        selectedServer
      );

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

  const handleJoinLobby = useCallback(
    async (previewInput?: MultiplayerPublicLobbySummary | MultiplayerLobbyJoinPreview) => {
      if (!displayName.trim()) {
        setError("Display name is required.");
        return;
      }

      if (!previewInput && !inviteCode.trim()) {
        setError("Invite code is required.");
        return;
      }

      if (!selectedServer || !serverConfigured || onboardingStatus !== "ready") {
        setError("Multiplayer is not ready on this server yet.");
        return;
      }

      setJoinPending(true);
      setError(null);
      try {
        await setActiveMultiplayerServerProfile(selectedServer.id);
        const preview =
          previewInput ??
          (await getLobbyJoinPreview(inviteCode.trim().toUpperCase(), selectedServer));
        if (!preview) {
          throw new Error("Lobby not found.");
        }
        const blockedReason = getLobbyJoinBlockedReason(
          preview,
          installedRounds.length,
          skipRoundsCheck
        );
        if (blockedReason) {
          throw new Error(blockedReason);
        }
        const joined = await joinLobby(
          {
            inviteCode: preview.inviteCode,
            displayName: displayName.trim(),
          },
          selectedServer
        );

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
    },
    [
      displayName,
      installedRounds.length,
      inviteCode,
      navigate,
      onboardingStatus,
      selectedServer,
      serverConfigured,
      skipRoundsCheck,
    ]
  );

  const badgeClass =
    onboardingStatus === "ready"
      ? "border-emerald-300/50 bg-emerald-400/15 text-emerald-100"
      : onboardingStatus === "provisioning"
        ? "border-cyan-300/50 bg-cyan-400/15 text-cyan-100"
        : onboardingStatus === "needs_discord" ||
            onboardingStatus === "needs_email" ||
            onboardingStatus === "needs_login"
          ? "border-fuchsia-300/45 bg-fuchsia-400/15 text-fuchsia-100"
          : "border-amber-300/45 bg-amber-400/15 text-amber-100";

  const badgeLabel =
    onboardingStatus === "ready"
      ? "Ready"
      : onboardingStatus === "provisioning"
        ? "Preparing"
        : onboardingStatus === "needs_discord"
          ? "Link Discord"
          : onboardingStatus === "needs_email"
            ? "Email Required"
            : onboardingStatus === "needs_login"
              ? "Login Required"
              : onboardingStatus === "oauth_unavailable"
                ? "OAuth Unavailable"
                : onboardingStatus === "error"
                  ? "Connection Failed"
                  : "Unavailable";

  const authModeLabel = authStatus
    ? authStatus.hasDiscordIdentity
      ? "Discord linked"
      : authStatus.isAnonymous
        ? "Anonymous account"
        : "Supabase account"
    : "Unknown";
  const readinessHeadline = canPlay
    ? "Ready to join or host"
    : onboardingStatus === "provisioning"
      ? "Preparing your multiplayer account"
      : onboardingStatus === "needs_discord"
        ? "Discord linking required"
        : onboardingStatus === "needs_email"
          ? "Discord account needs an email"
          : onboardingStatus === "needs_login"
            ? "Login required"
            : "Multiplayer setup needs attention";
  const readinessDetail = canPlay
    ? "Enter a code to join immediately or host a lobby with the current playlist."
    : onboardingMessage;
  const createDisabledReason = !canPlay
    ? roundsBlocked
      ? `You need at least ${MULTIPLAYER_MINIMUM_ROUNDS} installed rounds to host. You have ${installedRounds.length}.`
      : authBootstrapPending
        ? "Finish account setup to host."
        : "Resolve multiplayer readiness first."
    : !hasPlayablePlaylist
      ? "Create or select a playlist before hosting."
      : selectedPlaylistBlocked
        ? `This playlist requires at least ${selectedPlaylistRequiredRounds} installed rounds. You have ${installedRounds.length}.`
        : null;
  const createWarning =
    hasPlayablePlaylist &&
    skipRoundsCheck &&
    installedRounds.length < selectedPlaylistRequiredRounds
      ? `Experimental override active: ${selectedPlaylist?.name ?? "This playlist"} is tuned for at least ${selectedPlaylistRequiredRounds} installed rounds, and disabling the checks may result in a bad user experience.`
      : null;
  const joinDisabledReason = !canPlay
    ? roundsBlocked
      ? `You need at least ${MULTIPLAYER_MINIMUM_ROUNDS} installed rounds to join. You have ${installedRounds.length}.`
      : authBootstrapPending
        ? "Finish account setup to join."
        : "Resolve multiplayer readiness first."
    : inviteCode.trim().length === 0
      ? "Paste an invite code to join."
      : null;

  const publicLobbyCards = useMemo(
    () =>
      publicLobbies.map((lobby) => {
        const joinBlockedReason = !canPlay
          ? (joinDisabledReason ?? "Resolve multiplayer readiness first.")
          : getLobbyJoinBlockedReason(lobby, installedRounds.length, skipRoundsCheck);
        const joinWarning =
          skipRoundsCheck && installedRounds.length < lobby.requiredRoundCount
            ? `Experimental override active. This lobby expects ${lobby.requiredRoundCount} installed rounds, and joining below that may result in a bad user experience.`
            : null;

        return (
          <div
            key={lobby.lobbyId}
            className="grid gap-3 rounded-xl border border-white/8 bg-black/25 px-4 py-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-start"
          >
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="truncate text-sm font-bold text-emerald-100">{lobby.name}</span>
                <span className="rounded-full border border-white/10 bg-black/35 px-2 py-0.5 text-[10px] uppercase tracking-[0.15em] text-zinc-400">
                  {lobby.status}
                </span>
              </div>
              <p className="mt-0.5 truncate text-xs text-zinc-400">
                {lobby.playlistName}
                {" · "}
                {lobby.playerCount} player{lobby.playerCount !== 1 ? "s" : ""}
                {" · "}
                {lobby.requiredRoundCount} rounds required
                {lobby.status !== "waiting" &&
                  (lobby.allowLateJoin ? " · Late join" : " · No late join")}
              </p>
              {joinBlockedReason && (
                <p className="mt-1 text-xs text-zinc-500">{joinBlockedReason}</p>
              )}
              {joinWarning && <p className="mt-1 text-xs text-amber-200/70">{joinWarning}</p>}
            </div>
            <button
              type="button"
              disabled={joinPending || Boolean(joinBlockedReason)}
              className="shrink-0 rounded-xl border border-emerald-400/50 bg-emerald-600/25 px-4 py-2 text-sm font-bold uppercase tracking-[0.1em] text-emerald-50 transition hover:border-emerald-300/70 hover:bg-emerald-600/40 disabled:cursor-not-allowed disabled:opacity-50 md:self-center"
              onClick={() => {
                void handleJoinLobby(lobby);
              }}
            >
              {joinPending ? "..." : "Join Public Lobby"}
            </button>
          </div>
        );
      }),
    [
      canPlay,
      handleJoinLobby,
      installedRounds.length,
      joinDisabledReason,
      joinPending,
      publicLobbies,
      skipRoundsCheck,
    ]
  );

  return (
    <MultiplayerUpdateGuard>
      <div className="relative h-screen overflow-x-hidden overflow-y-auto px-4 py-6 text-zinc-100 sm:px-6 sm:py-8">
        <AnimatedBackground />
        <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(34,211,238,0.14),transparent_42%),radial-gradient(circle_at_82%_22%,rgba(129,140,248,0.18),transparent_34%),radial-gradient(circle_at_10%_100%,rgba(16,185,129,0.12),transparent_38%)]" />

        <div className="relative mx-auto flex w-full max-w-4xl flex-col gap-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-4">
              <button
                type="button"
                data-controller-focus-id="multiplayer-go-back"
                onMouseEnter={playHoverSound}
                onClick={() => {
                  playSelectSound();
                  goBack();
                }}
                className="rounded-xl border border-violet-300/55 bg-violet-500/20 px-4 py-2 font-[family-name:var(--font-jetbrains-mono)] text-xs uppercase tracking-[0.2em] text-violet-100 transition-all duration-200 hover:border-violet-200/80 hover:bg-violet-500/35"
              >
                Go Back
              </button>
              <div>
                <p className="font-[family-name:var(--font-jetbrains-mono)] text-[0.62rem] uppercase tracking-[0.45em] text-purple-200/70">
                  Matchmaking
                </p>
                <h1 className="text-2xl font-black tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-violet-200 via-purple-100 to-indigo-200 drop-shadow-[0_0_20px_rgba(139,92,246,0.45)] sm:text-3xl">
                  Multiplayer
                </h1>
              </div>
            </div>
            <button
              type="button"
              data-controller-focus-id="multiplayer-ban-list"
              onClick={() => {
                void navigate({ to: "/multiplayer-bans" });
              }}
              className={`${actionButtonClass} border-orange-300/45 bg-orange-400/15 text-orange-100 hover:border-orange-300/70`}
            >
              Host Ban List
            </button>
          </div>

          {error && (
            <div className="rounded-2xl border border-rose-400/55 bg-rose-500/12 px-4 py-3 text-sm text-rose-100 backdrop-blur-xl">
              {error}
            </div>
          )}

          {roundsBlocked && (
            <div className="rounded-2xl border border-rose-300/40 bg-rose-500/15 px-5 py-4 backdrop-blur-xl">
              <h2 className="text-lg font-bold text-rose-50">
                {MULTIPLAYER_MINIMUM_ROUNDS} Rounds Required
              </h2>
              <p className="mt-1 text-sm text-rose-200/80">
                Multiplayer requires at least {MULTIPLAYER_MINIMUM_ROUNDS} installed rounds. You
                have <span className="font-bold text-rose-100">{installedRounds.length}</span>.
                Install more via the{" "}
                <button
                  type="button"
                  onClick={() => void navigate({ to: "/rounds" })}
                  className="font-semibold text-rose-100 underline underline-offset-2 transition hover:text-rose-50"
                >
                  Installed Rounds
                </button>{" "}
                page.
              </p>
            </div>
          )}

          <section
            className="flex flex-wrap items-start gap-x-5 gap-y-3 rounded-2xl border border-purple-400/20 bg-zinc-950/40 px-5 py-4 backdrop-blur-xl"
            data-testid="multiplayer-onboarding-status"
          >
            <div className="flex flex-col gap-1">
              <label
                htmlFor="multiplayer-display-name"
                className="text-xs font-semibold uppercase tracking-[0.14em] text-zinc-400"
              >
                Display Name
              </label>
              <input
                id="multiplayer-display-name"
                className="w-48 rounded-xl border border-white/15 bg-black/35 px-3 py-2 text-sm text-zinc-100 outline-none transition focus:border-violet-300/60 focus:ring-2 focus:ring-violet-400/25"
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                placeholder="Player"
              />
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-xs font-semibold uppercase tracking-[0.14em] text-zinc-400">
                Status
              </span>
              <span
                className={`rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] ${badgeClass}`}
              >
                {badgeLabel}
              </span>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-xs font-semibold uppercase tracking-[0.14em] text-zinc-400">
                Auth
              </span>
              <span className="text-sm text-zinc-200">{authModeLabel}</span>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-xs font-semibold uppercase tracking-[0.14em] text-zinc-400">
                Server
              </span>
              <span className="text-sm text-zinc-200">{selectedServer?.name ?? "None"}</span>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-xs font-semibold uppercase tracking-[0.14em] text-zinc-400">
                Rounds
              </span>
              <span
                className={`text-sm ${hasEnoughRounds ? "text-emerald-200" : "text-amber-200"}`}
              >
                {installedRounds.length} installed
              </span>
            </div>
            <div className="flex items-end gap-2 self-end">
              {onboardingStatus === "needs_discord" && (
                <button
                  type="button"
                  onClick={() => {
                    void handleLinkDiscord();
                  }}
                  disabled={linkPending || authBootstrapPending}
                  className={`${actionButtonClass} border-fuchsia-300/45 bg-fuchsia-500/15 text-fuchsia-100 hover:border-fuchsia-300/70`}
                >
                  {linkPending ? "Opening Discord..." : "Link Discord"}
                </button>
              )}
              {(onboardingStatus === "error" ||
                onboardingStatus === "unavailable" ||
                onboardingStatus === "oauth_unavailable") && (
                <button
                  type="button"
                  onClick={handleRetryBootstrap}
                  className={`${actionButtonClass} border-cyan-300/40 bg-cyan-400/12 text-cyan-100 hover:border-cyan-300/70`}
                >
                  Retry
                </button>
              )}
              {(onboardingStatus === "needs_email" || onboardingStatus === "needs_discord") && (
                <button
                  type="button"
                  onClick={handleRetryBootstrap}
                  disabled={authBootstrapPending}
                  className={`${actionButtonClass} border-cyan-300/40 bg-cyan-400/12 text-cyan-100 hover:border-cyan-300/70`}
                >
                  Recheck Account
                </button>
              )}
              {onboardingStatus === "needs_login" && (
                <div className="flex flex-col gap-3 rounded-2xl border border-violet-400/30 bg-black/40 p-5 mt-4 w-full max-w-md">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-bold text-violet-100">
                      {authMode === "signin" ? "Sign In" : "Create Account"}
                    </p>
                    <button
                      type="button"
                      onClick={() => setAuthMode((m) => (m === "signin" ? "signup" : "signin"))}
                      className="text-xs text-violet-300 underline"
                    >
                      {authMode === "signin" ? "Switch to Sign Up" : "Switch to Sign In"}
                    </button>
                  </div>
                  <div className="flex flex-col gap-2">
                    <input
                      type="email"
                      placeholder="Email Address"
                      className="rounded-xl border border-white/10 bg-black/50 px-4 py-2 text-sm text-zinc-100 outline-none transition focus:border-violet-400"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                    />
                    <input
                      type="password"
                      placeholder="Password"
                      className="rounded-xl border border-white/10 bg-black/50 px-4 py-2 text-sm text-zinc-100 outline-none transition focus:border-violet-400"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                    />
                  </div>
                  <button
                    type="button"
                    disabled={authPending}
                    onClick={handleAuthEmail}
                    className="w-full rounded-xl border border-violet-400/50 bg-violet-600/30 py-2 text-sm font-bold uppercase tracking-widest text-violet-50 transition hover:bg-violet-600/50 disabled:opacity-50"
                  >
                    {authPending
                      ? "Authenticating..."
                      : authMode === "signin"
                        ? "Sign In"
                        : "Sign Up"}
                  </button>
                </div>
              )}
            </div>
          </section>

          <p className="text-lg font-extrabold tracking-tight text-violet-100">
            {readinessHeadline}
          </p>
          {!canPlay && readinessDetail && (
            <p className="-mt-5 text-sm text-zinc-400">{readinessDetail}</p>
          )}

          <section className="animate-entrance rounded-3xl border border-violet-400/25 bg-zinc-950/55 p-6 backdrop-blur-xl">
            <h2 className="text-xl font-extrabold tracking-tight text-violet-100">Join Lobby</h2>
            <p className="mt-1 text-sm text-zinc-400">
              Paste the invite code from your host and enter the round.
            </p>

            <div className="mt-5">
              <label
                htmlFor="multiplayer-invite-code"
                className="text-xs font-bold uppercase tracking-[0.2em] text-violet-300"
              >
                Invite Code
              </label>
              <input
                id="multiplayer-invite-code"
                className="mt-2 w-full rounded-3xl border-2 border-violet-500/50 bg-black/50 px-5 py-4 font-[family-name:var(--font-jetbrains-mono)] text-3xl font-black tracking-[0.2em] text-violet-50 uppercase outline-none transition-all placeholder:text-violet-900/50 focus:border-violet-400 focus:bg-violet-950/40 focus:shadow-[0_0_25px_rgba(139,92,246,0.4)]"
                value={inviteCode}
                onChange={(event) => setInviteCode(event.target.value.toUpperCase())}
                placeholder="CODE"
              />
              <p className="mt-2 text-xs text-zinc-500">
                Playing on{" "}
                <span className="text-zinc-300">
                  {selectedServer?.name ?? "No Server Selected"}
                </span>
                {" · "}Codes are case-insensitive.
              </p>
            </div>

            <button
              type="button"
              disabled={joinPending || inviteCode.trim().length === 0 || !canPlay}
              className="mt-5 w-full rounded-2xl border border-violet-400/60 bg-gradient-to-r from-violet-600/40 via-fuchsia-600/40 to-indigo-600/40 px-4 py-4 text-base font-black uppercase tracking-[0.15em] text-violet-50 drop-shadow-[0_0_10px_rgba(139,92,246,0.5)] transition-all hover:scale-[1.01] hover:border-violet-300/80 hover:shadow-[0_0_30px_rgba(139,92,246,0.5)] hover:brightness-125 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:scale-100 disabled:hover:shadow-none active:scale-95"
              onClick={() => {
                void handleJoinLobby();
              }}
            >
              {joinPending
                ? "Joining..."
                : authBootstrapPending
                  ? "Preparing Account..."
                  : "Join Lobby"}
            </button>
            {joinDisabledReason && (
              <p className="mt-3 text-xs text-zinc-400">{joinDisabledReason}</p>
            )}
          </section>

          <section className="animate-entrance rounded-3xl border border-emerald-400/20 bg-zinc-950/55 p-6 backdrop-blur-xl">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-xl font-extrabold tracking-tight text-emerald-100">
                  Public Lobbies
                </h2>
                <p className="mt-1 text-sm text-zinc-400">
                  Browse advertised lobbies and join with one click.
                </p>
              </div>
              <button
                type="button"
                onClick={() => void refreshPublicLobbies(selectedServer)}
                disabled={publicLobbiesLoading || !selectedServer || !serverConfigured}
                className={`${actionButtonClass} border-emerald-300/45 bg-emerald-500/15 text-emerald-100 hover:border-emerald-300/70`}
              >
                {publicLobbiesLoading ? "Refreshing..." : "Refresh"}
              </button>
            </div>

            {publicLobbiesError && (
              <div className="mt-4 rounded-xl border border-rose-400/45 bg-rose-500/12 px-4 py-3 text-sm text-rose-100">
                {publicLobbiesError}
              </div>
            )}

            <div className="mt-4 max-h-[38rem] overflow-y-auto pr-2 custom-scrollbar">
              <div className="flex flex-col gap-2">{publicLobbyCards}</div>
            </div>

            {!publicLobbiesLoading && publicLobbies.length === 0 && !publicLobbiesError && (
              <p className="mt-4 text-sm text-zinc-500">
                No public lobbies available on the selected server right now.
              </p>
            )}
          </section>

          <section className="animate-entrance rounded-3xl border border-cyan-400/20 bg-zinc-950/55 p-6 backdrop-blur-xl">
            <h2 className="text-xl font-extrabold tracking-tight text-cyan-100">Host a Lobby</h2>
            <p className="mt-1 text-sm text-zinc-400">
              Start a lobby with the current playlist, then share the invite code or advertise
              publicly.
            </p>

            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <div>
                <label className="text-xs font-semibold uppercase tracking-[0.14em] text-zinc-400">
                  Lobby Name
                </label>
                <input
                  className="mt-1.5 w-full rounded-xl border border-white/15 bg-black/35 px-3 py-2.5 text-sm font-semibold text-zinc-100 outline-none transition focus:border-violet-300/60 focus:ring-2 focus:ring-violet-400/25"
                  value={lobbyName}
                  onChange={(event) => setLobbyName(event.target.value)}
                />
              </div>
              <div>
                <label className="text-xs font-semibold uppercase tracking-[0.14em] text-zinc-400">
                  Playlist
                </label>
                <GameDropdown
                  value={selectedPlaylistId}
                  disabled={!hasPlayablePlaylist}
                  options={[
                    ...(!hasPlayablePlaylist
                      ? [{ value: "" as string, label: "No playlists available" }]
                      : []),
                    ...availablePlaylists.map((playlist: { id: string; name: string }) => ({
                      value: playlist.id,
                      label:
                        playlist.name + (playlist.id === activePlaylist?.id ? " (Active)" : ""),
                    })),
                  ]}
                  onChange={(value) => setSelectedPlaylistId(value)}
                />
              </div>
            </div>

            {hasPlayablePlaylist && selectedPlaylist && (
              <p className="mt-3 text-xs text-zinc-400">
                {selectedPlaylist.name} requires {selectedPlaylistRequiredRounds} installed rounds.
              </p>
            )}

            <div className="mt-4 flex flex-wrap gap-4">
              <label className="flex cursor-pointer items-center gap-2 text-sm text-zinc-300">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-cyan-500/50 bg-black/50 text-cyan-500 focus:ring-cyan-500/50 focus:ring-offset-0"
                  checked={allowLateJoin}
                  onChange={(event) => setAllowLateJoin(event.target.checked)}
                />
                Allow late join
              </label>
              <label className="flex cursor-pointer items-center gap-2 text-sm text-zinc-300">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-cyan-500/50 bg-black/50 text-cyan-500 focus:ring-cyan-500/50 focus:ring-offset-0"
                  checked={advertisePublicly}
                  onChange={(event) => setAdvertisePublicly(event.target.checked)}
                />
                Advertise on Public List
              </label>
            </div>

            {!hasPlayablePlaylist && (
              <p className="mt-3 text-xs text-amber-200">
                Create a playlist in the playlist workshop or map editor before hosting a lobby.
              </p>
            )}

            <button
              type="button"
              disabled={
                createPending || !hasPlayablePlaylist || !canPlay || selectedPlaylistBlocked
              }
              className="mt-5 w-full rounded-2xl border border-cyan-400/60 bg-gradient-to-r from-cyan-600/40 via-sky-600/40 to-indigo-600/40 px-4 py-4 text-base font-black uppercase tracking-[0.15em] text-cyan-50 drop-shadow-[0_0_10px_rgba(34,211,238,0.5)] transition-all hover:scale-[1.01] hover:border-cyan-300/80 hover:shadow-[0_0_30px_rgba(34,211,238,0.4)] hover:brightness-125 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:scale-100 disabled:hover:shadow-none active:scale-95"
              onClick={() => {
                void handleCreateLobby();
              }}
            >
              {createPending
                ? "Initializing..."
                : authBootstrapPending
                  ? "Preparing Account..."
                  : "Create Lobby"}
            </button>
            {createDisabledReason && (
              <p className="mt-3 text-xs text-zinc-400">{createDisabledReason}</p>
            )}
            {createWarning && <p className="mt-3 text-xs text-amber-200">{createWarning}</p>}
          </section>

          <section className="animate-entrance rounded-3xl border border-purple-400/15 bg-zinc-950/55 p-6 backdrop-blur-xl">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-extrabold tracking-tight text-violet-100">Advanced</h2>
                <p className="mt-0.5 text-xs text-zinc-400">
                  Server management and self-hosted setup. Keep this closed unless needed.
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
                  <div>
                    <span className="text-xs font-semibold uppercase tracking-[0.14em] text-zinc-400">
                      Active Server
                    </span>
                    <GameDropdown
                      value={selectedServerId}
                      disabled={!hasServerProfiles}
                      options={[
                        ...(!hasServerProfiles
                          ? [{ value: "" as string, label: "No servers saved" }]
                          : []),
                        ...serverProfiles.map((profile) => ({
                          value: profile.id,
                          label: profile.name + (profile.isDefault ? " (Default)" : ""),
                        })),
                      ]}
                      onChange={(nextServerId) => {
                        const nextServer =
                          serverProfiles.find((profile) => profile.id === nextServerId) ?? null;
                        setSelectedServerId(nextServerId);
                        setError(null);
                        void refreshAuth(nextServer, {
                          syncActive: Boolean(
                            nextServer && isLikelyConfiguredSupabaseServer(nextServer)
                          ),
                        });
                      }}
                    />

                    <div className="mt-3 flex flex-wrap gap-2">
                      {!selectedServer?.isBuiltIn && (
                        <button
                          type="button"
                          className={`${actionButtonClass} border-cyan-300/40 bg-cyan-400/12 text-cyan-100 hover:border-cyan-300/70`}
                          onClick={() => {
                            if (!selectedServer) return;
                            loadServerIntoEditor(selectedServer);
                          }}
                        >
                          Load Into Editor
                        </button>
                      )}
                      <button
                        type="button"
                        className={`${actionButtonClass} border-sky-300/45 bg-sky-500/15 text-sky-100 hover:border-sky-300/70`}
                        onClick={resetServerEditor}
                      >
                        New Endpoint
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
                                const nextServer =
                                  reloaded.activeProfile ?? reloaded.profiles[0] ?? null;
                                await refreshAuth(nextServer, {
                                  syncActive: false,
                                });
                              } catch (removeError) {
                                setError(
                                  removeError instanceof Error
                                    ? removeError.message
                                    : "Failed to remove server profile."
                                );
                              }
                            })();
                          }}
                        >
                          Remove Selected
                        </button>
                      )}
                    </div>
                  </div>

                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.14em] text-zinc-400">
                      Selected Endpoint
                    </p>
                    <p className="mt-1.5 break-all rounded-lg border border-white/10 bg-black/35 px-3 py-2 text-xs text-zinc-300">
                      {selectedServerEndpointLabel}
                    </p>
                    <p className="mt-2 text-xs text-zinc-400">
                      Server name:{" "}
                      <span className="text-zinc-200">
                        {selectedServer?.name ?? "None selected"}
                      </span>
                    </p>
                    {selectedServer?.isBuiltIn && (
                      <p className="mt-1 text-xs text-zinc-500">
                        Built-in server credentials stay hidden and cannot be edited.
                      </p>
                    )}
                  </div>
                </div>

                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-zinc-400">
                  Endpoint Editor
                  {" · "}
                  <span className="font-normal text-zinc-500">
                    {editingServer
                      ? `Editing ${editingServer.name}`
                      : "Create a new custom endpoint"}
                  </span>
                </p>

                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <label className="flex flex-col gap-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-zinc-400">
                    Server Name
                    <input
                      className="w-full rounded-xl border border-white/15 bg-black/35 px-3 py-2.5 text-sm text-zinc-100 outline-none transition focus:border-violet-300/60 focus:ring-2 focus:ring-violet-400/25"
                      value={newServerName}
                      onChange={(event) => setNewServerName(event.target.value)}
                      placeholder="My Private Server"
                    />
                  </label>
                  <label className="flex flex-col gap-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-zinc-400">
                    Supabase URL
                    <input
                      className="w-full rounded-xl border border-white/15 bg-black/35 px-3 py-2.5 text-sm text-zinc-100 outline-none transition focus:border-violet-300/60 focus:ring-2 focus:ring-violet-400/25"
                      value={newServerUrl}
                      onChange={(event) => setNewServerUrl(event.target.value)}
                      placeholder="https://project.supabase.co"
                    />
                  </label>
                  <label className="flex flex-col gap-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-zinc-400">
                    Anon Key
                    <input
                      className="w-full rounded-xl border border-white/15 bg-black/35 px-3 py-2.5 text-sm text-zinc-100 outline-none transition focus:border-violet-300/60 focus:ring-2 focus:ring-violet-400/25"
                      value={newServerAnonKey}
                      onChange={(event) => setNewServerAnonKey(event.target.value)}
                      placeholder="ey..."
                    />
                  </label>
                  <label className="flex flex-col gap-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-zinc-400">
                    Auth Requirement
                    <GameDropdown
                      value={editingAuthRequirement}
                      options={[
                        { value: "anonymous_only", label: "Anonymous (Default)" },
                        { value: "discord_required", label: "Discord Required" },
                        { value: "email_password_required", label: "Email Required" },
                      ]}
                      onChange={(value) =>
                        setEditingAuthRequirement(value as MultiplayerAuthRequirement)
                      }
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
                            id: editingServer?.id,
                            name: newServerName.trim() || "Custom Server",
                            url: newServerUrl.trim(),
                            anonKey: newServerAnonKey.trim(),
                            authRequirement: editingAuthRequirement,
                          });
                          const reloaded = await reloadServers();
                          const nextServer =
                            reloaded.profiles.find((profile) => profile.id === saved.id) ?? saved;
                          setEditingServerId(saved.id);
                          setSelectedServerId(saved.id);
                          await refreshAuth(nextServer, {
                            syncActive: isLikelyConfiguredSupabaseServer(nextServer),
                          });
                          setError(null);
                        } catch (saveError) {
                          setError(
                            saveError instanceof Error
                              ? saveError.message
                              : "Failed to save server profile."
                          );
                        }
                      })();
                    }}
                  >
                    {editingServer ? "Update Endpoint" : "Save Endpoint"}
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
                            authRequirement: editingAuthRequirement,
                          });
                          await reloadServers();
                          setEditingServerId(saved.id);
                          setSelectedServerId(saved.id);
                          await refreshAuth(saved, {
                            syncActive: isLikelyConfiguredSupabaseServer(saved),
                          });
                          setError(null);
                        } catch (saveError) {
                          setError(
                            saveError instanceof Error
                              ? saveError.message
                              : "Failed to save server profile."
                          );
                        }
                      })();
                    }}
                  >
                    Save as New
                  </button>
                  <button
                    type="button"
                    className={`${actionButtonClass} border-white/20 bg-black/30 hover:border-white/40`}
                    onClick={resetServerEditor}
                  >
                    Clear Editor
                  </button>
                </div>
              </div>
            )}
          </section>
        </div>
      </div>
    </MultiplayerUpdateGuard>
  );
}
