import { Trans, useLingui } from "@lingui/react/macro";
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

type MultiplayerTaskTab = "join" | "public" | "host" | "server";

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
  skipRoundsCheck: boolean,
  t: ReturnType<typeof useLingui>["t"]
): string | null {
  if (!lobby.isOpen) {
    return t`Lobby is locked.`;
  }
  if (lobby.status === "running" && !lobby.allowLateJoin) {
    return t`Late join is disabled for this lobby.`;
  }
  if (!skipRoundsCheck && installedRoundsCount < lobby.requiredRoundCount) {
    return t`This lobby requires at least ${lobby.requiredRoundCount} installed rounds. You have ${installedRoundsCount}.`;
  }
  return null;
}

export const Route = createFileRoute("/multiplayer")({
  validateSearch: (search) => MultiplayerSearchSchema.parse(search),
  loader: async () => {
    await assertMultiplayerAllowed();
    const [availablePlaylists, installedRoundCount, profiles, activeProfile, rawSkipRoundsCheck] =
      await Promise.all([
        playlists.list(),
        db.round.countInstalled(),
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
      installedRoundCount,
      profiles,
      activeProfile,
      skipRoundsCheck,
    };
  },
  component: MultiplayerRoute,
});

function PublicLobbyCardSkeleton() {
  return (
    <div className="grid gap-3 rounded-xl border border-white/8 bg-black/25 px-4 py-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-start">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <div className="h-4 w-32 animate-pulse rounded bg-white/10" />
          <div className="h-4 w-14 animate-pulse rounded-full bg-white/8" />
        </div>
        <div className="mt-1.5 h-3 w-52 animate-pulse rounded bg-white/8" />
      </div>
      <div className="h-9 w-32 animate-pulse rounded-xl bg-white/8 md:self-center" />
    </div>
  );
}

function MultiplayerRoute() {
  const { t } = useLingui();
  const navigate = useNavigate();
  const sfwModeEnabled = useMultiplayerSfwRedirect();

  const {
    activePlaylist,
    availablePlaylists,
    installedRoundCount,
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
    () => localStorage.getItem("fland-multiplayer-username") || t`Player`
  );
  const [lobbyName, setLobbyName] = useState(t`My Lobby`);
  const [selectedPlaylistId, setSelectedPlaylistId] = useState(
    activePlaylist?.id ?? availablePlaylists[0]?.id ?? ""
  );
  const [allowLateJoin, setAllowLateJoin] = useState(true);
  const [advertisePublicly, setAdvertisePublicly] = useState(false);
  const [inviteCode, setInviteCode] = useState(search.inviteCode ?? "");
  const [activeTaskTab, setActiveTaskTab] = useState<MultiplayerTaskTab>("public");
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
  const [authStatus, setAuthStatus] = useState<MultiplayerAuthStatus | null>(null);
  const [onboardingStatus, setOnboardingStatus] = useState<OnboardingStatus>("provisioning");
  const [onboardingMessage, setOnboardingMessage] = useState(
    t`Preparing multiplayer authentication on the selected server.`
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
  const hasEnoughRounds = installedRoundCount >= MULTIPLAYER_MINIMUM_ROUNDS;
  const selectedPlaylistRequiredRounds = selectedPlaylist
    ? getMultiplayerRequiredRounds(selectedPlaylist.config)
    : MULTIPLAYER_MINIMUM_ROUNDS;
  const roundsBlocked = !skipRoundsCheck && !hasEnoughRounds;
  const selectedPlaylistBlocked =
    !skipRoundsCheck && installedRoundCount < selectedPlaylistRequiredRounds;
  const canPlay =
    onboardingStatus === "ready" && serverConfigured && !authBootstrapPending && !roundsBlocked;
  const selectedServerEndpointLabel = selectedServer
    ? selectedServer.isBuiltIn
      ? t`Hidden for built-in server`
      : selectedServer.url || t`No URL configured`
    : t`No URL configured`;

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
          loadError instanceof Error ? loadError.message : t`Failed to load public lobbies.`
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
      setError(t`Built-in servers cannot be loaded into the editor.`);
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
        t`Online multiplayer is unavailable right now. Retry or use Advanced setup.`
      );
      setActiveTaskTab("server");
      return;
    }

    setAuthBootstrapPending(true);
    setOnboardingStatus("provisioning");
    setOnboardingMessage(t`Creating or resuming your multiplayer account on the selected server.`);

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
        setActiveTaskTab("server");
      }
      setError(null);
    } catch (bootstrapError) {
      if (bootstrapTokenRef.current !== token) return;
      setAuthStatus(null);
      setOnboardingStatus("error");
      setOnboardingMessage(
        bootstrapError instanceof Error
          ? bootstrapError.message
          : t`Failed to prepare multiplayer authentication. Retry or use Advanced setup.`
      );
      setActiveTaskTab("server");
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
      setError(
        linkError instanceof Error ? linkError.message : t`Failed to start Discord linking.`
      );
    } finally {
      setLinkPending(false);
    }
  };

  const handleAuthEmail = async () => {
    if (!email.trim() || !password.trim()) {
      setError(t`Email and password are required.`);
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
      setError(authErr instanceof Error ? authErr.message : t`Authentication failed.`);
    } finally {
      setAuthPending(false);
    }
  };

  const handleCreateLobby = async () => {
    if (!displayName.trim()) {
      setError(t`Display name is required.`);
      return;
    }

    if (!selectedServer || !serverConfigured || onboardingStatus !== "ready") {
      setError(t`Multiplayer is not ready on this server yet.`);
      return;
    }
    if (!selectedPlaylist) {
      setError(t`Select a playlist before hosting a lobby.`);
      return;
    }
    if (!skipRoundsCheck && installedRoundCount < selectedPlaylistRequiredRounds) {
      setError(
        t`This playlist requires at least ${selectedPlaylistRequiredRounds} installed rounds. You have ${installedRoundCount}.`
      );
      return;
    }

    setCreatePending(true);
    setError(null);
    try {
      await setActiveMultiplayerServerProfile(selectedServer.id);
      const installedRounds = await db.round.findInstalled();
      const snapshot = buildMultiplayerPlaylistSnapshot(selectedPlaylist.config, installedRounds, {
        name: selectedPlaylist.name,
      });
      const created = await createLobby(
        {
          name: lobbyName.trim() || t`My Lobby`,
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
      setError(createError instanceof Error ? createError.message : t`Failed to create lobby.`);
    } finally {
      setCreatePending(false);
    }
  };

  const handleJoinLobby = useCallback(
    async (previewInput?: MultiplayerPublicLobbySummary | MultiplayerLobbyJoinPreview) => {
      if (!displayName.trim()) {
        setError(t`Display name is required.`);
        return;
      }

      if (!previewInput && !inviteCode.trim()) {
        setError(t`Invite code is required.`);
        return;
      }

      if (!selectedServer || !serverConfigured || onboardingStatus !== "ready") {
        setError(t`Multiplayer is not ready on this server yet.`);
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
          throw new Error(t`Lobby not found.`);
        }
        const blockedReason = getLobbyJoinBlockedReason(
          preview,
          installedRoundCount,
          skipRoundsCheck,
          t
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
        setError(joinError instanceof Error ? joinError.message : t`Failed to join lobby.`);
      } finally {
        setJoinPending(false);
      }
    },
    [
      displayName,
      installedRoundCount,
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
      ? t`Ready`
      : onboardingStatus === "provisioning"
        ? t`Preparing`
        : onboardingStatus === "needs_discord"
          ? t`Link Discord`
          : onboardingStatus === "needs_email"
            ? t`Email Required`
            : onboardingStatus === "needs_login"
              ? t`Login Required`
              : onboardingStatus === "oauth_unavailable"
                ? t`OAuth Unavailable`
                : onboardingStatus === "error"
                  ? t`Connection Failed`
                  : t`Unavailable`;

  const authModeLabel = authStatus
    ? authStatus.hasDiscordIdentity
      ? t`Discord linked`
      : authStatus.isAnonymous
        ? t`Anonymous account`
        : t`Supabase account`
    : t`Unknown`;
  const readinessHeadline = canPlay
    ? t`Ready to join or host`
    : onboardingStatus === "provisioning"
      ? t`Preparing your multiplayer account`
      : onboardingStatus === "needs_discord"
        ? t`Discord linking required`
        : onboardingStatus === "needs_email"
          ? t`Discord account needs an email`
          : onboardingStatus === "needs_login"
            ? t`Login required`
            : t`Multiplayer setup needs attention`;
  const readinessDetail = canPlay
    ? t`Enter a code to join immediately or host a lobby with the current playlist.`
    : onboardingMessage;
  const createDisabledReason = !canPlay
    ? roundsBlocked
      ? t`You need at least ${MULTIPLAYER_MINIMUM_ROUNDS} installed rounds to host. You have ${installedRoundCount}.`
      : authBootstrapPending
        ? t`Finish account setup to host.`
        : t`Resolve multiplayer readiness first.`
    : !hasPlayablePlaylist
      ? t`Create or select a playlist before hosting.`
      : selectedPlaylistBlocked
        ? t`This playlist requires at least ${selectedPlaylistRequiredRounds} installed rounds. You have ${installedRoundCount}.`
        : null;
  const createWarning =
    hasPlayablePlaylist && skipRoundsCheck && installedRoundCount < selectedPlaylistRequiredRounds
      ? t`Experimental override active: ${selectedPlaylist?.name ?? "This playlist"} is tuned for at least ${selectedPlaylistRequiredRounds} installed rounds, and disabling the checks may result in a bad user experience.`
      : null;
  const joinDisabledReason = !canPlay
    ? roundsBlocked
      ? t`You need at least ${MULTIPLAYER_MINIMUM_ROUNDS} installed rounds to join. You have ${installedRoundCount}.`
      : authBootstrapPending
        ? t`Finish account setup to join.`
        : t`Resolve multiplayer readiness first.`
    : inviteCode.trim().length === 0
      ? t`Paste an invite code to join.`
      : null;
  const publicDisabledReason = !serverConfigured
    ? t`Select or configure a multiplayer server first.`
    : onboardingStatus !== "ready"
      ? t`Finish account setup before browsing public lobbies.`
      : null;
  const taskBlockedReason: Partial<Record<MultiplayerTaskTab, string>> = {
    join: !canPlay ? (joinDisabledReason ?? t`Resolve multiplayer readiness first.`) : undefined,
    public: publicDisabledReason ?? undefined,
    host: createDisabledReason ?? undefined,
  };
  const taskTabs: Array<{ id: MultiplayerTaskTab; label: string; blockedReason?: string }> = [
    { id: "public", label: t`Public Lobbies`, blockedReason: taskBlockedReason.public },
    { id: "join", label: t`Join Code`, blockedReason: taskBlockedReason.join },
    { id: "host", label: t`Host Lobby`, blockedReason: taskBlockedReason.host },
    { id: "server", label: t`Server` },
  ];
  const activeTaskBlockedReason = taskBlockedReason[activeTaskTab];

  const publicLobbyCards = useMemo(
    () =>
      publicLobbies.map((lobby) => {
        const joinBlockedReason = !canPlay
          ? (joinDisabledReason ?? t`Resolve multiplayer readiness first.`)
          : getLobbyJoinBlockedReason(lobby, installedRoundCount, skipRoundsCheck, t);
        const joinWarning =
          skipRoundsCheck && installedRoundCount < lobby.requiredRoundCount
            ? t`Experimental override active. This lobby expects ${lobby.requiredRoundCount} installed rounds, and joining below that may result in a bad user experience.`
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
                <Trans>
                  {lobby.playerCount} player{lobby.playerCount !== 1 ? "s" : ""}
                </Trans>
                {" · "}
                <Trans>{lobby.requiredRoundCount} rounds required</Trans>
                {lobby.status !== "waiting" &&
                  (lobby.allowLateJoin ? t` · Late join` : t` · No late join`)}
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
              {joinPending ? "..." : <Trans>Join Public Lobby</Trans>}
            </button>
          </div>
        );
      }),
    [
      canPlay,
      handleJoinLobby,
      installedRoundCount,
      joinDisabledReason,
      joinPending,
      publicLobbies,
      skipRoundsCheck,
    ]
  );

  if (sfwModeEnabled) {
    return null;
  }

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
                <Trans>Go Back</Trans>
              </button>
              <div>
                <p className="font-[family-name:var(--font-jetbrains-mono)] text-[0.62rem] uppercase tracking-[0.45em] text-purple-200/70">
                  <Trans>Matchmaking</Trans>
                </p>
                <h1 className="text-2xl font-black tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-violet-200 via-purple-100 to-indigo-200 drop-shadow-[0_0_20px_rgba(139,92,246,0.45)] sm:text-3xl">
                  <Trans>Multiplayer</Trans>
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
              <Trans>Host Ban List</Trans>
            </button>
          </div>

          {error && (
            <div
              className="rounded-2xl border border-rose-400/55 bg-rose-500/12 px-4 py-3 text-sm text-rose-100 backdrop-blur-xl"
              role="alert"
            >
              {error}
            </div>
          )}

          {roundsBlocked && (
            <div className="rounded-2xl border border-rose-300/40 bg-rose-500/15 px-5 py-4 backdrop-blur-xl">
              <h2 className="text-lg font-bold text-rose-50">
                <Trans>{MULTIPLAYER_MINIMUM_ROUNDS} Rounds Required</Trans>
              </h2>
              <p className="mt-1 text-sm text-rose-200/80">
                <Trans>
                  Multiplayer requires at least {MULTIPLAYER_MINIMUM_ROUNDS} installed rounds. You
                  have <span className="font-bold text-rose-100">{installedRoundCount}</span>.
                  Install more via the{" "}
                  <button
                    type="button"
                    onClick={() => void navigate({ to: "/rounds" })}
                    className="font-semibold text-rose-100 underline underline-offset-2 transition hover:text-rose-50"
                  >
                    Installed Rounds
                  </button>{" "}
                  page.
                </Trans>
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
                <Trans>Display Name</Trans>
              </label>
              <input
                id="multiplayer-display-name"
                className="w-48 rounded-xl border border-white/15 bg-black/35 px-3 py-2 text-sm text-zinc-100 outline-none transition focus:border-violet-300/60 focus:ring-2 focus:ring-violet-400/25"
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                placeholder={t`Player`}
              />
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-xs font-semibold uppercase tracking-[0.14em] text-zinc-400">
                <Trans>Status</Trans>
              </span>
              <span
                className={`rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] ${badgeClass}`}
              >
                {badgeLabel}
              </span>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-xs font-semibold uppercase tracking-[0.14em] text-zinc-400">
                <Trans>Auth</Trans>
              </span>
              <span className="text-sm text-zinc-200">{authModeLabel}</span>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-xs font-semibold uppercase tracking-[0.14em] text-zinc-400">
                <Trans>Server</Trans>
              </span>
              <span className="text-sm text-zinc-200">{selectedServer?.name ?? t`None`}</span>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-xs font-semibold uppercase tracking-[0.14em] text-zinc-400">
                <Trans>Rounds</Trans>
              </span>
              <span
                className={`text-sm ${hasEnoughRounds ? "text-emerald-200" : "text-amber-200"}`}
              >
                <Trans>{installedRoundCount} installed</Trans>
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
                  {linkPending ? t`Opening Discord...` : t`Link Discord`}
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
                  <Trans>Retry</Trans>
                </button>
              )}
              {(onboardingStatus === "needs_email" || onboardingStatus === "needs_discord") && (
                <button
                  type="button"
                  onClick={handleRetryBootstrap}
                  disabled={authBootstrapPending}
                  className={`${actionButtonClass} border-cyan-300/40 bg-cyan-400/12 text-cyan-100 hover:border-cyan-300/70`}
                >
                  <Trans>Recheck Account</Trans>
                </button>
              )}
              {onboardingStatus === "needs_login" && (
                <div className="flex flex-col gap-3 rounded-2xl border border-violet-400/30 bg-black/40 p-5 mt-4 w-full max-w-md">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-bold text-violet-100">
                      {authMode === "signin" ? t`Sign In` : t`Create Account`}
                    </p>
                    <button
                      type="button"
                      onClick={() => setAuthMode((m) => (m === "signin" ? "signup" : "signin"))}
                      className="text-xs text-violet-300 underline"
                    >
                      {authMode === "signin" ? t`Switch to Sign Up` : t`Switch to Sign In`}
                    </button>
                  </div>
                  <div className="flex flex-col gap-2">
                    <input
                      type="email"
                      placeholder={t`Email Address`}
                      className="rounded-xl border border-white/10 bg-black/50 px-4 py-2 text-sm text-zinc-100 outline-none transition focus:border-violet-400"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                    />
                    <input
                      type="password"
                      placeholder={t`Password`}
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
                      ? t`Authenticating...`
                      : authMode === "signin"
                        ? t`Sign In`
                        : t`Sign Up`}
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

          <div className="grid gap-2 rounded-2xl border border-white/10 bg-zinc-950/45 p-2 backdrop-blur-xl sm:grid-cols-4">
            {taskTabs.map((tab) => {
              const active = activeTaskTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onMouseEnter={playHoverSound}
                  onClick={() => {
                    playSelectSound();
                    setActiveTaskTab(tab.id);
                  }}
                  aria-pressed={active}
                  className={`rounded-xl border px-3 py-2 text-sm font-bold uppercase tracking-[0.12em] transition ${
                    active
                      ? "border-violet-300/60 bg-violet-500/25 text-violet-50"
                      : "border-white/10 bg-black/20 text-zinc-400 hover:border-white/25 hover:text-zinc-100"
                  }`}
                >
                  <span>{tab.label}</span>
                  {tab.blockedReason && (
                    <span
                      className="ml-2 rounded border border-amber-300/45 bg-amber-500/15 px-1.5 py-0.5 text-[9px] text-amber-100"
                      aria-hidden="true"
                    >
                      <Trans>Blocked</Trans>
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {activeTaskBlockedReason && (
            <div
              className="rounded-xl border border-amber-300/35 bg-amber-500/12 px-4 py-3 text-sm text-amber-100"
              role="status"
              aria-live="polite"
            >
              {activeTaskBlockedReason}
            </div>
          )}

          {activeTaskTab === "join" && (
            <section className="animate-entrance rounded-3xl border border-violet-400/25 bg-zinc-950/55 p-6 backdrop-blur-xl">
              <h2 className="text-xl font-extrabold tracking-tight text-violet-100">
                <Trans>Join Lobby</Trans>
              </h2>
              <p className="mt-1 text-sm text-zinc-400">
                <Trans>Paste the invite code from your host and enter the round.</Trans>
              </p>

              <div className="mt-5">
                <label
                  htmlFor="multiplayer-invite-code"
                  className="text-xs font-bold uppercase tracking-[0.2em] text-violet-300"
                >
                  <Trans>Invite Code</Trans>
                </label>
                <input
                  id="multiplayer-invite-code"
                  className="mt-2 w-full rounded-3xl border-2 border-violet-500/50 bg-black/50 px-5 py-4 font-[family-name:var(--font-jetbrains-mono)] text-3xl font-black tracking-[0.2em] text-violet-50 uppercase outline-none transition-all placeholder:text-violet-900/50 focus:border-violet-400 focus:bg-violet-950/40 focus:shadow-[0_0_25px_rgba(139,92,246,0.4)]"
                  value={inviteCode}
                  onChange={(event) => setInviteCode(event.target.value.toUpperCase())}
                  placeholder={t`CODE`}
                />
                <p className="mt-2 text-xs text-zinc-500">
                  <Trans>
                    Playing on{" "}
                    <span className="text-zinc-300">
                      {selectedServer?.name ?? t`No Server Selected`}
                    </span>
                    {" · "}Codes are case-insensitive.
                  </Trans>
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
                  ? t`Joining...`
                  : authBootstrapPending
                    ? t`Preparing Account...`
                    : t`Join Lobby`}
              </button>
              {joinDisabledReason && (
                <p className="mt-3 text-xs text-zinc-400">{joinDisabledReason}</p>
              )}
            </section>
          )}

          {activeTaskTab === "public" && (
            <section className="animate-entrance rounded-3xl border border-emerald-400/20 bg-zinc-950/55 p-6 backdrop-blur-xl">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-xl font-extrabold tracking-tight text-emerald-100">
                    <Trans>Public Lobbies</Trans>
                  </h2>
                  <p className="mt-1 text-sm text-zinc-400">
                    <Trans>Browse advertised lobbies and join with one click.</Trans>
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void refreshPublicLobbies(selectedServer)}
                  disabled={publicLobbiesLoading || !selectedServer || !serverConfigured}
                  className={`${actionButtonClass} border-emerald-300/45 bg-emerald-500/15 text-emerald-100 hover:border-emerald-300/70`}
                >
                  {publicLobbiesLoading ? t`Refreshing...` : t`Refresh`}
                </button>
              </div>

              {publicLobbiesError && (
                <div
                  className="mt-4 rounded-xl border border-rose-400/45 bg-rose-500/12 px-4 py-3 text-sm text-rose-100"
                  role="alert"
                >
                  {publicLobbiesError}
                </div>
              )}

              <div className="mt-4 max-h-[38rem] overflow-y-auto pr-2 custom-scrollbar">
                <div className="flex flex-col gap-2">
                  {onboardingStatus !== "ready" ||
                  (publicLobbiesLoading && publicLobbies.length === 0)
                    ? Array.from({ length: 4 }, (_, i) => <PublicLobbyCardSkeleton key={i} />)
                    : publicLobbyCards}
                </div>
              </div>

              {onboardingStatus === "ready" &&
                !publicLobbiesLoading &&
                publicLobbies.length === 0 &&
                !publicLobbiesError && (
                  <p className="mt-4 text-sm text-zinc-500">
                    <Trans>No public lobbies available on the selected server right now.</Trans>
                  </p>
                )}
            </section>
          )}

          {activeTaskTab === "host" && (
            <section className="animate-entrance rounded-3xl border border-cyan-400/20 bg-zinc-950/55 p-6 backdrop-blur-xl">
              <h2 className="text-xl font-extrabold tracking-tight text-cyan-100">
                <Trans>Host a Lobby</Trans>
              </h2>
              <p className="mt-1 text-sm text-zinc-400">
                <Trans>
                  Start a lobby with the current playlist, then share the invite code or advertise
                  publicly.
                </Trans>
              </p>

              <div className="mt-5 grid gap-4 sm:grid-cols-2">
                <div>
                  <label
                    htmlFor="multiplayer-lobby-name"
                    className="text-xs font-semibold uppercase tracking-[0.14em] text-zinc-400"
                  >
                    <Trans>Lobby Name</Trans>
                  </label>
                  <input
                    id="multiplayer-lobby-name"
                    className="mt-1.5 w-full rounded-xl border border-white/15 bg-black/35 px-3 py-2.5 text-sm font-semibold text-zinc-100 outline-none transition focus:border-violet-300/60 focus:ring-2 focus:ring-violet-400/25"
                    value={lobbyName}
                    onChange={(event) => setLobbyName(event.target.value)}
                  />
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-zinc-400">
                    <Trans>Playlist</Trans>
                  </p>
                  <GameDropdown
                    value={selectedPlaylistId}
                    disabled={!hasPlayablePlaylist}
                    options={[
                      ...(!hasPlayablePlaylist
                        ? [{ value: "" as string, label: t`No playlists available` }]
                        : []),
                      ...availablePlaylists.map((playlist: { id: string; name: string }) => ({
                        value: playlist.id,
                        label:
                          playlist.name + (playlist.id === activePlaylist?.id ? t` (Active)` : ""),
                      })),
                    ]}
                    onChange={(value) => setSelectedPlaylistId(value)}
                  />
                </div>
              </div>

              {hasPlayablePlaylist && selectedPlaylist && (
                <p className="mt-3 text-xs text-zinc-400">
                  <Trans>
                    {selectedPlaylist.name} requires {selectedPlaylistRequiredRounds} installed
                    rounds.
                  </Trans>
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
                  <Trans>Allow late join</Trans>
                </label>
                <label className="flex cursor-pointer items-center gap-2 text-sm text-zinc-300">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-cyan-500/50 bg-black/50 text-cyan-500 focus:ring-cyan-500/50 focus:ring-offset-0"
                    checked={advertisePublicly}
                    onChange={(event) => setAdvertisePublicly(event.target.checked)}
                  />
                  <Trans>Advertise on Public List</Trans>
                </label>
              </div>

              {!hasPlayablePlaylist && (
                <p className="mt-3 text-xs text-amber-200">
                  <Trans>
                    Create a playlist in the playlist workshop or map editor before hosting a lobby.
                  </Trans>
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
                  ? t`Initializing...`
                  : authBootstrapPending
                    ? t`Preparing Account...`
                    : t`Create Lobby`}
              </button>
              {createDisabledReason && (
                <p className="mt-3 text-xs text-zinc-400">{createDisabledReason}</p>
              )}
              {createWarning && <p className="mt-3 text-xs text-amber-200">{createWarning}</p>}
            </section>
          )}

          {activeTaskTab === "server" && (
            <section className="animate-entrance rounded-3xl border border-purple-400/15 bg-zinc-950/55 p-6 backdrop-blur-xl">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-extrabold tracking-tight text-violet-100">
                    <Trans>Server Management</Trans>
                  </h2>
                  <p className="mt-0.5 text-xs text-zinc-400">
                    <Trans>Server selection and self-hosted setup for multiplayer.</Trans>
                  </p>
                </div>
              </div>

              <div className="mt-5 space-y-4">
                <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.2fr_1fr]">
                  <div>
                    <span className="text-xs font-semibold uppercase tracking-[0.14em] text-zinc-400">
                      <Trans>Active Server</Trans>
                    </span>
                    <GameDropdown
                      value={selectedServerId}
                      disabled={!hasServerProfiles}
                      options={[
                        ...(!hasServerProfiles
                          ? [{ value: "" as string, label: t`No servers saved` }]
                          : []),
                        ...serverProfiles.map((profile) => ({
                          value: profile.id,
                          label: profile.name + (profile.isDefault ? t` (Default)` : ""),
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
                          <Trans>Load Into Editor</Trans>
                        </button>
                      )}
                      <button
                        type="button"
                        className={`${actionButtonClass} border-sky-300/45 bg-sky-500/15 text-sky-100 hover:border-sky-300/70`}
                        onClick={resetServerEditor}
                      >
                        <Trans>New Endpoint</Trans>
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
                                    : t`Failed to remove server profile.`
                                );
                              }
                            })();
                          }}
                        >
                          <Trans>Remove Selected</Trans>
                        </button>
                      )}
                    </div>
                  </div>

                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.14em] text-zinc-400">
                      <Trans>Selected Endpoint</Trans>
                    </p>
                    <p className="mt-1.5 break-all rounded-lg border border-white/10 bg-black/35 px-3 py-2 text-xs text-zinc-300">
                      {selectedServerEndpointLabel}
                    </p>
                    <p className="mt-2 text-xs text-zinc-400">
                      <Trans>
                        Server name:{" "}
                        <span className="text-zinc-200">
                          {selectedServer?.name ?? t`None selected`}
                        </span>
                      </Trans>
                    </p>
                    {selectedServer?.isBuiltIn && (
                      <p className="mt-1 text-xs text-zinc-500">
                        <Trans>Built-in server credentials stay hidden and cannot be edited.</Trans>
                      </p>
                    )}
                  </div>
                </div>

                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-zinc-400">
                  <Trans>Endpoint Editor</Trans>
                  {" · "}
                  <span className="font-normal text-zinc-500">
                    {editingServer
                      ? t`Editing ${editingServer.name}`
                      : t`Create a new custom endpoint`}
                  </span>
                </p>

                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <label className="flex flex-col gap-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-zinc-400">
                    <Trans>Server Name</Trans>
                    <input
                      className="w-full rounded-xl border border-white/15 bg-black/35 px-3 py-2.5 text-sm text-zinc-100 outline-none transition focus:border-violet-300/60 focus:ring-2 focus:ring-violet-400/25"
                      value={newServerName}
                      onChange={(event) => setNewServerName(event.target.value)}
                      placeholder={t`My Private Server`}
                    />
                  </label>
                  <label className="flex flex-col gap-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-zinc-400">
                    <Trans>Supabase URL</Trans>
                    <input
                      className="w-full rounded-xl border border-white/15 bg-black/35 px-3 py-2.5 text-sm text-zinc-100 outline-none transition focus:border-violet-300/60 focus:ring-2 focus:ring-violet-400/25"
                      value={newServerUrl}
                      onChange={(event) => setNewServerUrl(event.target.value)}
                      placeholder={t`https://project.supabase.co`}
                    />
                  </label>
                  <label className="flex flex-col gap-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-zinc-400">
                    <Trans>Anon Key</Trans>
                    <input
                      className="w-full rounded-xl border border-white/15 bg-black/35 px-3 py-2.5 text-sm text-zinc-100 outline-none transition focus:border-violet-300/60 focus:ring-2 focus:ring-violet-400/25"
                      value={newServerAnonKey}
                      onChange={(event) => setNewServerAnonKey(event.target.value)}
                      placeholder={t`ey...`}
                    />
                  </label>
                  <div className="flex flex-col gap-1.5">
                    <p className="text-xs font-semibold uppercase tracking-[0.14em] text-zinc-400">
                      <Trans>Auth Requirement</Trans>
                    </p>
                    <GameDropdown
                      value={editingAuthRequirement}
                      options={[
                        { value: "anonymous_only", label: t`Anonymous (Default)` },
                        { value: "discord_required", label: t`Discord Required` },
                        { value: "email_password_required", label: t`Email Required` },
                      ]}
                      onChange={(value) =>
                        setEditingAuthRequirement(value as MultiplayerAuthRequirement)
                      }
                    />
                  </div>
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
                            name: newServerName.trim() || t`Custom Server`,
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
                              : t`Failed to save server profile.`
                          );
                        }
                      })();
                    }}
                  >
                    {editingServer ? t`Update Endpoint` : t`Save Endpoint`}
                  </button>
                  <button
                    type="button"
                    className={`${actionButtonClass} border-sky-300/45 bg-sky-500/15 text-sky-100 hover:border-sky-300/70`}
                    onClick={() => {
                      void (async () => {
                        try {
                          const saved = await saveMultiplayerServerProfile({
                            name: newServerName.trim() || t`Custom Server`,
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
                              : t`Failed to save server profile.`
                          );
                        }
                      })();
                    }}
                  >
                    <Trans>Save as New</Trans>
                  </button>
                  <button
                    type="button"
                    className={`${actionButtonClass} border-white/20 bg-black/30 hover:border-white/40`}
                    onClick={resetServerEditor}
                  >
                    <Trans>Clear Editor</Trans>
                  </button>
                </div>
              </div>
            </section>
          )}
        </div>
      </div>
    </MultiplayerUpdateGuard>
  );
}
