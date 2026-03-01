import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { z } from "zod";
import { InventoryDockButton } from "../components/game/InventoryDockButton";
import { BlockCommandPalette } from "../contexts/CommandPaletteGuardContext";
import { PerkIcon } from "../components/game/PerkIcon";
import { PerkInventoryPanel } from "../components/game/PerkInventoryPanel";
import { GameScene } from "../components/game/GameScene";
import {
  assertMultiplayerAllowed,
  useMultiplayerSfwRedirect,
} from "../hooks/useMultiplayerSfwGuard";
import { createInitialGameState } from "../game/engine";
import { getPerkById, filterPerkIdsByGameplayCapabilities } from "../game/data/perks";
import {
  PERK_RARITY_META,
  fallbackRarityFromCost,
  resolvePerkRarity,
} from "../game/data/perkRarity";
import { toGameConfigFromPlaylist } from "../game/playlistRuntime";
import type {
  ActivePerkEffect,
  GameCompletionReason,
  GameState,
  InventoryItem,
  PerkIconKey,
  PerkRarity,
  PlayerStats,
} from "../game/types";
import { db } from "../services/db";
import {
  extractPlaylistConfigFromSnapshot,
  banLobbyPlayer,
  finalizeMatchIfComplete,
  finishPlayer,
  getLobbySnapshot,
  getOwnLobbyPlayer,
  heartbeat,
  kickLobbyPlayer,
  listRecentAntiPerkEvents,
  markDisconnected,
  sendAntiPerk,
  setLobbyOpenState,
  subscribeLobbyRealtime,
  sweepForfeits,
  updateOwnProgress,
  isTerminalPlayerState,
  type MultiplayerAntiPerkEvent,
  type MultiplayerLobbySnapshot,
} from "../services/multiplayer";
import {
  getMultiplayerSessionNotifications,
  type MultiplayerSessionNotification,
} from "../services/multiplayer/sessionNotifications";
import { trpc } from "../services/trpc";
import {
  DEFAULT_ROUND_PROGRESS_BAR_ALWAYS_VISIBLE,
  ROUND_PROGRESS_BAR_ALWAYS_VISIBLE_KEY,
  normalizeRoundProgressBarAlwaysVisible,
} from "../constants/roundVideoOverlaySettings";
import { DEFAULT_INTERMEDIARY_LOADING_PROMPT } from "../constants/booruSettings";
import { useHandy } from "../contexts/HandyContext";
import { MultiplayerUpdateGuard } from "../components/multiplayer/MultiplayerUpdateGuard";
import {
  DEFAULT_MOANING_ENABLED,
  MOANING_ENABLED_KEY,
  MOANING_QUEUE_KEY,
  normalizeMoaningQueue,
} from "../constants/moaningSettings";
import { Trans, useLingui } from "@lingui/react/macro";

const MatchSearchSchema = z.object({
  lobbyId: z.string().min(1),
  playerId: z.string().min(1).optional(),
});

const INTERMEDIARY_LOADING_PROMPT_KEY = "game.intermediary.loadingPrompt";
const INTERMEDIARY_LOADING_DURATION_KEY = "game.intermediary.loadingDurationSec";
const INTERMEDIARY_RETURN_PAUSE_KEY = "game.intermediary.returnPauseSec";
const MULTIPLAYER_APPLY_DIRECTLY_KEY = "game.multiplayer.applyDirectly";
const DEFAULT_INTERMEDIARY_LOADING_DURATION_SEC = 5;
const DEFAULT_INTERMEDIARY_RETURN_PAUSE_SEC = 4;
const EMPTY_PROGRESS_BY_PLAYER_ID: MultiplayerLobbySnapshot["progressByPlayerId"] = {};

async function getMoaningAvailability(): Promise<boolean> {
  try {
    const [rawEnabled, rawQueue] = await Promise.all([
      trpc.store.get.query({ key: MOANING_ENABLED_KEY }),
      trpc.store.get.query({ key: MOANING_QUEUE_KEY }),
    ]);
    const enabled = typeof rawEnabled === "boolean" ? rawEnabled : DEFAULT_MOANING_ENABLED;
    return enabled && normalizeMoaningQueue(rawQueue).length > 0;
  } catch (error) {
    console.warn("Failed to read moaning availability from store", error);
    return false;
  }
}

function toFinalPlayerState(reason: GameCompletionReason | null): "finished" | "came" {
  if (reason === "self_reported_cum" || reason === "cum_instruction_failed") {
    return "came";
  }
  return "finished";
}

type ExternalInventoryAction = {
  actionId: string;
  type: "applySelf" | "consume";
  playerId: string;
  itemId: string;
  reason?: string;
};

function buildInventoryStacks(items: InventoryItem[]): Array<{
  perkId: string;
  name: string;
  iconKey: PerkIconKey;
  rarity: PerkRarity;
  count: number;
}> {
  if (items.length === 0) return [];

  const grouped = items.reduce<
    Map<
      string,
      { perkId: string; name: string; iconKey: PerkIconKey; rarity: PerkRarity; count: number }
    >
  >((acc, item) => {
    const key = item.perkId;
    const perk = getPerkById(item.perkId);
    const existing = acc.get(key);
    if (!existing) {
      acc.set(key, {
        perkId: item.perkId,
        name: perk?.name ?? item.name,
        iconKey: perk?.iconKey ?? "unknown",
        rarity: perk ? resolvePerkRarity(perk) : fallbackRarityFromCost(item.cost),
        count: 1,
      });
      return acc;
    }
    existing.count += 1;
    return acc;
  }, new Map());

  return Array.from(grouped.values()).sort(
    (a, b) => b.count - a.count || a.name.localeCompare(b.name)
  );
}

function toSafeStats(value: unknown, fallback: PlayerStats): PlayerStats {
  if (!value || typeof value !== "object") return fallback;
  const raw = value as Partial<PlayerStats>;
  const diceMin =
    typeof raw.diceMin === "number" && Number.isFinite(raw.diceMin)
      ? Math.max(1, Math.floor(raw.diceMin))
      : fallback.diceMin;
  const diceMaxRaw =
    typeof raw.diceMax === "number" && Number.isFinite(raw.diceMax)
      ? Math.max(1, Math.floor(raw.diceMax))
      : fallback.diceMax;
  const diceMax = Math.max(diceMin, diceMaxRaw);
  const roundPauseMs =
    typeof raw.roundPauseMs === "number" && Number.isFinite(raw.roundPauseMs)
      ? Math.max(250, Math.floor(raw.roundPauseMs))
      : fallback.roundPauseMs;
  const perkFrequency =
    typeof raw.perkFrequency === "number" && Number.isFinite(raw.perkFrequency)
      ? Math.max(-0.5, Math.min(0.5, raw.perkFrequency))
      : fallback.perkFrequency;
  const perkLuck =
    typeof raw.perkLuck === "number" && Number.isFinite(raw.perkLuck)
      ? Math.max(-1, Math.min(1, raw.perkLuck))
      : fallback.perkLuck;

  return { diceMin, diceMax, roundPauseMs, perkFrequency, perkLuck };
}

function toSafeActiveEffects(value: unknown): ActivePerkEffect[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is ActivePerkEffect => {
    if (!entry || typeof entry !== "object") return false;
    const raw = entry as Partial<ActivePerkEffect>;
    if (typeof raw.id !== "string" || raw.id.trim().length === 0) return false;
    if (raw.kind !== "perk" && raw.kind !== "antiPerk") return false;
    if (!Array.isArray(raw.effects)) return false;
    return true;
  });
}

function toSafeInventory(value: unknown): InventoryItem[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const raw = entry as Partial<InventoryItem>;
    if (typeof raw.itemId !== "string" || raw.itemId.trim().length === 0) return [];
    if (typeof raw.perkId !== "string" || raw.perkId.trim().length === 0) return [];
    if (raw.kind !== "perk" && raw.kind !== "antiPerk") return [];
    const name = typeof raw.name === "string" && raw.name.trim().length > 0 ? raw.name : raw.perkId;
    const cost =
      typeof raw.cost === "number" && Number.isFinite(raw.cost)
        ? Math.max(0, Math.floor(raw.cost))
        : 0;
    const acquiredTurn =
      typeof raw.acquiredTurn === "number" && Number.isFinite(raw.acquiredTurn)
        ? Math.max(1, Math.floor(raw.acquiredTurn))
        : 1;
    return [
      {
        itemId: raw.itemId,
        perkId: raw.perkId,
        kind: raw.kind,
        name,
        cost,
        acquiredTurn,
      },
    ];
  });
}

function deriveInitialMultiplayerState(input: {
  snapshot: MultiplayerLobbySnapshot;
  ownPlayerId: string;
  ownPlayerName: string;
  installedRounds: Awaited<ReturnType<typeof db.round.findInstalled>>;
}): GameState {
  const playlistConfig = extractPlaylistConfigFromSnapshot(
    input.snapshot.lobby.playlistSnapshotJson
  );
  const baseConfig = toGameConfigFromPlaylist(playlistConfig, input.installedRounds);
  const config = {
    ...baseConfig,
    perkSelection: {
      ...baseConfig.perkSelection,
      includeAntiPerksInChoices: true,
    },
  };

  const initialHighscore = input.snapshot.players.reduce((max, player) => {
    const progressScore = input.snapshot.progressByPlayerId[player.id]?.score ?? 0;
    const finalScore = player.finalScore ?? 0;
    return Math.max(max, progressScore, finalScore);
  }, 0);

  const base = createInitialGameState(config, { initialHighscore });
  const ownProgress = input.snapshot.progressByPlayerId[input.ownPlayerId];

  const fallbackPlayer = base.players[0];
  if (!fallbackPlayer) return base;

  const boardMaxIndex = Math.max(0, base.config.board.length - 1);
  const resolvedPosition = ownProgress
    ? Math.max(0, Math.min(boardMaxIndex, Math.floor(ownProgress.positionIndex)))
    : fallbackPlayer.position;

  const resolvedNodeId =
    ownProgress?.positionNodeId &&
    base.config.runtimeGraph.nodeIndexById[ownProgress.positionNodeId] !== undefined
      ? ownProgress.positionNodeId
      : (base.config.board[resolvedPosition]?.id ?? fallbackPlayer.currentNodeId);

  const nextPlayer = {
    ...fallbackPlayer,
    id: input.ownPlayerId,
    name: input.ownPlayerName,
    currentNodeId: resolvedNodeId,
    position: resolvedPosition,
    money: ownProgress ? Math.max(0, Math.floor(ownProgress.money)) : fallbackPlayer.money,
    score: ownProgress ? Math.max(0, Math.floor(ownProgress.score)) : fallbackPlayer.score,
    stats: toSafeStats(ownProgress?.statsJson, fallbackPlayer.stats),
    inventory: toSafeInventory(ownProgress?.inventoryJson),
    activePerkEffects: toSafeActiveEffects(ownProgress?.activeEffectsJson),
  };

  return {
    ...base,
    players: [nextPlayer],
    currentPlayerIndex: 0,
    lastRoll: ownProgress?.lastRoll ?? null,
    highscore: Math.max(base.highscore, nextPlayer.score),
  };
}

async function getIntermediarySettings() {
  try {
    const [rawPrompt, rawDuration, rawReturnPause, rawRoundProgressBarAlwaysVisible] =
      await Promise.all([
        trpc.store.get.query({ key: INTERMEDIARY_LOADING_PROMPT_KEY }),
        trpc.store.get.query({ key: INTERMEDIARY_LOADING_DURATION_KEY }),
        trpc.store.get.query({ key: INTERMEDIARY_RETURN_PAUSE_KEY }),
        trpc.store.get.query({ key: ROUND_PROGRESS_BAR_ALWAYS_VISIBLE_KEY }),
      ]);

    const prompt =
      typeof rawPrompt === "string" && rawPrompt.trim().length > 0
        ? rawPrompt.trim()
        : DEFAULT_INTERMEDIARY_LOADING_PROMPT;

    const parsedDuration = typeof rawDuration === "number" ? rawDuration : Number(rawDuration);
    const parsedReturnPause =
      typeof rawReturnPause === "number" ? rawReturnPause : Number(rawReturnPause);

    return {
      intermediaryLoadingPrompt: prompt,
      intermediaryLoadingDurationSec: Number.isFinite(parsedDuration)
        ? Math.max(1, Math.min(60, Math.floor(parsedDuration)))
        : DEFAULT_INTERMEDIARY_LOADING_DURATION_SEC,
      intermediaryReturnPauseSec: Number.isFinite(parsedReturnPause)
        ? Math.max(0, Math.min(60, Math.floor(parsedReturnPause)))
        : DEFAULT_INTERMEDIARY_RETURN_PAUSE_SEC,
      roundProgressBarAlwaysVisible: normalizeRoundProgressBarAlwaysVisible(
        rawRoundProgressBarAlwaysVisible
      ),
    };
  } catch {
    return {
      intermediaryLoadingPrompt: DEFAULT_INTERMEDIARY_LOADING_PROMPT,
      intermediaryLoadingDurationSec: DEFAULT_INTERMEDIARY_LOADING_DURATION_SEC,
      intermediaryReturnPauseSec: DEFAULT_INTERMEDIARY_RETURN_PAUSE_SEC,
      roundProgressBarAlwaysVisible: DEFAULT_ROUND_PROGRESS_BAR_ALWAYS_VISIBLE,
    };
  }
}

async function getApplyDirectlySetting(): Promise<boolean> {
  try {
    const raw = await trpc.store.get.query({ key: MULTIPLAYER_APPLY_DIRECTLY_KEY });
    if (typeof raw === "boolean") return raw;
    if (typeof raw === "number") return raw !== 0;
    if (typeof raw === "string") return raw.trim().toLowerCase() !== "false";
    return false;
  } catch {
    return false;
  }
}

export const Route = createFileRoute("/multiplayer-match")({
  validateSearch: (search) => MatchSearchSchema.parse(search),
  loader: async ({ location }) => {
    await assertMultiplayerAllowed();
    const search = MatchSearchSchema.parse(location.search);
    const [
      snapshot,
      ownPlayer,
      initialAntiPerkFeed,
      installedRounds,
      intermediarySettings,
      initialApplyDirectly,
      moaningAvailable,
    ] = await Promise.all([
      getLobbySnapshot(search.lobbyId),
      getOwnLobbyPlayer(search.lobbyId),
      listRecentAntiPerkEvents(search.lobbyId),
      db.round.findInstalled(),
      getIntermediarySettings(),
      getApplyDirectlySetting(),
      getMoaningAvailability(),
    ]);

    if (!snapshot || !ownPlayer) {
      throw new Error("Unable to load multiplayer match context.");
    }

    const initialState = deriveInitialMultiplayerState({
      snapshot,
      ownPlayerId: ownPlayer.id,
      ownPlayerName: ownPlayer.displayName,
      installedRounds,
    });

    return {
      search,
      initialSnapshot: snapshot,
      ownPlayer,
      initialState,
      initialAntiPerkFeed,
      installedRounds,
      initialApplyDirectly,
      moaningAvailable,
      ...intermediarySettings,
    };
  },
  component: MultiplayerMatchRoute,
});

function MultiplayerMatchRoute() {
  const navigate = useNavigate();
  const { t } = useLingui();
  const sfwModeEnabled = useMultiplayerSfwRedirect();
  const {
    search,
    initialSnapshot,
    ownPlayer,
    initialState,
    initialAntiPerkFeed,
    installedRounds,
    initialApplyDirectly,
    intermediaryLoadingPrompt,
    intermediaryLoadingDurationSec,
    intermediaryReturnPauseSec,
    roundProgressBarAlwaysVisible,
    moaningAvailable,
  } = Route.useLoaderData();

  if (sfwModeEnabled) {
    return null;
  }

  const { connected: handyConnected } = useHandy();

  const filteredInitialState = useMemo(() => {
    return {
      ...initialState,
      config: {
        ...initialState.config,
        perkPool: {
          enabledPerkIds: filterPerkIdsByGameplayCapabilities(
            initialState.config.perkPool.enabledPerkIds,
            { handyConnected, moaningAvailable }
          ),
          enabledAntiPerkIds: filterPerkIdsByGameplayCapabilities(
            initialState.config.perkPool.enabledAntiPerkIds,
            { handyConnected, moaningAvailable }
          ),
        },
      },
    };
  }, [initialState, handyConnected, moaningAvailable]);

  const [snapshot, setSnapshot] = useState<MultiplayerLobbySnapshot | null>(initialSnapshot);
  const [ownPlayerId, setOwnPlayerId] = useState(ownPlayer.id);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [antiPerkFeed, setAntiPerkFeed] = useState<MultiplayerAntiPerkEvent[]>(initialAntiPerkFeed);
  const [selectedTargetId, setSelectedTargetId] = useState("");
  const [selectedInventoryItemId, setSelectedInventoryItemId] = useState<string | null>(null);
  const [localState, setLocalState] = useState<GameState>(filteredInitialState);
  const [isNarrowViewport, setIsNarrowViewport] = useState(false);
  const [isOverlayOpen, setIsOverlayOpen] = useState(false);
  const [isLobbyControlOpen, setIsLobbyControlOpen] = useState(false);
  const [isVideoHudHotzoneActive, setIsVideoHudHotzoneActive] = useState(false);
  const [applyPerkDirectly, setApplyPerkDirectly] = useState(initialApplyDirectly);
  const [videoUiVisible, setVideoUiVisible] = useState(true);
  const [sessionNotificationQueue, setSessionNotificationQueue] = useState<
    MultiplayerSessionNotification[]
  >([]);
  const [activeSessionNotification, setActiveSessionNotification] =
    useState<MultiplayerSessionNotification | null>(null);
  const [incomingAntiPerkEvent, setIncomingAntiPerkEvent] = useState<{
    eventId: string;
    targetPlayerId: string;
    perkId: string;
    sourcePlayerName?: string;
  } | null>(null);
  const [pendingInventoryAction, setPendingInventoryAction] =
    useState<ExternalInventoryAction | null>(null);
  const [inventoryFxQueue, setInventoryFxQueue] = useState<
    Array<{ fxId: string; item: InventoryItem }>
  >([]);
  const [activeInventoryFx, setActiveInventoryFx] = useState<{
    fxId: string;
    item: InventoryItem;
  } | null>(null);
  const [inventoryBadgePulse, setInventoryBadgePulse] = useState(false);

  const sessionStartedAtMsRef = useRef(Date.now());
  const localStateRef = useRef(localState);
  localStateRef.current = localState;

  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;

  const syncTimerRef = useRef<number | null>(null);
  const syncInFlightRef = useRef(false);
  const syncQueuedRef = useRef(false);
  const snapshotRefreshInFlightRef = useRef(false);
  const snapshotRefreshQueuedRef = useRef(false);
  const finishSubmittedRef = useRef(false);
  const resultNavigationSubmittedRef = useRef(false);
  const prevInventoryIdsRef = useRef<Set<string>>(
    new Set(initialState.players[0]?.inventory.map((entry: InventoryItem) => entry.itemId) ?? [])
  );
  const previousPlayersRef = useRef(initialSnapshot.players);
  const sessionNotificationTimerRef = useRef<number | null>(null);

  const refreshSnapshot = useCallback(async () => {
    const [nextSnapshot, nextOwnPlayer] = await Promise.all([
      getLobbySnapshot(search.lobbyId),
      getOwnLobbyPlayer(search.lobbyId),
    ]);

    setSnapshot(nextSnapshot);
    if (nextOwnPlayer?.id) {
      setOwnPlayerId(nextOwnPlayer.id);
    }

    try {
      const recentEvents = await listRecentAntiPerkEvents(search.lobbyId);
      setAntiPerkFeed(recentEvents);
    } catch (recentEventsError) {
      setError(
        recentEventsError instanceof Error
          ? recentEventsError.message
          : t`Failed to refresh anti-perk feed.`
      );
    }
  }, [search.lobbyId]);

  const requestSnapshotRefresh = useCallback(async () => {
    if (snapshotRefreshInFlightRef.current) {
      snapshotRefreshQueuedRef.current = true;
      return;
    }

    snapshotRefreshInFlightRef.current = true;
    try {
      await refreshSnapshot();
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : t`Failed to refresh match.`);
    } finally {
      snapshotRefreshInFlightRef.current = false;
      if (snapshotRefreshQueuedRef.current) {
        snapshotRefreshQueuedRef.current = false;
        void requestSnapshotRefresh();
      }
    }
  }, [refreshSnapshot]);

  const flushSync = useCallback(async () => {
    if (syncInFlightRef.current) {
      syncQueuedRef.current = true;
      return;
    }

    const player = localStateRef.current.players[localStateRef.current.currentPlayerIndex];
    if (!player || !ownPlayerId) return;

    syncInFlightRef.current = true;

    try {
      await updateOwnProgress({
        lobbyId: search.lobbyId,
        playerId: ownPlayerId,
        positionNodeId: player.currentNodeId,
        positionIndex: player.position,
        money: player.money,
        score: player.score,
        statsJson: player.stats,
        inventoryJson: player.inventory,
        activeEffectsJson: player.activePerkEffects,
        lastRoll: localStateRef.current.lastRoll,
      });
    } catch (syncError) {
      setError(syncError instanceof Error ? syncError.message : t`Failed to sync local progress.`);
    } finally {
      syncInFlightRef.current = false;
      if (syncQueuedRef.current) {
        syncQueuedRef.current = false;
        void flushSync();
      }
    }
  }, [ownPlayerId, search.lobbyId]);

  const scheduleSync = useCallback(() => {
    if (syncTimerRef.current !== null) return;
    syncTimerRef.current = window.setTimeout(() => {
      syncTimerRef.current = null;
      void flushSync();
    }, 280);
  }, [flushSync]);

  const handleGameStateChange = useCallback(
    (nextState: GameState) => {
      setLocalState(nextState);
      scheduleSync();
    },
    [scheduleSync]
  );

  const handleExternalAntiPerkEventHandled = useCallback((eventId: string) => {
    setIncomingAntiPerkEvent((prev) => (prev?.eventId === eventId ? null : prev));
  }, []);

  const handleExternalInventoryActionHandled = useCallback((actionId: string) => {
    setPendingInventoryAction((prev) => (prev?.actionId === actionId ? null : prev));
  }, []);

  const handleApplyPerkDirectlyChange = useCallback((value: boolean) => {
    setApplyPerkDirectly(value);
    void trpc.store.set.mutate({ key: MULTIPLAYER_APPLY_DIRECTLY_KEY, value }).catch(() => {
      // noop
    });
  }, []);

  useEffect(() => {
    return () => {
      if (syncTimerRef.current !== null) {
        window.clearTimeout(syncTimerRef.current);
      }
      if (sessionNotificationTimerRef.current !== null) {
        window.clearTimeout(sessionNotificationTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!ownPlayerId) return;
    const interval = window.setInterval(() => {
      void flushSync();
    }, 1000);
    return () => {
      window.clearInterval(interval);
    };
  }, [flushSync, ownPlayerId]);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(max-width: 1279px)");
    const applyViewportState = () => {
      setIsNarrowViewport(mediaQuery.matches);
    };

    applyViewportState();
    mediaQuery.addEventListener("change", applyViewportState);
    return () => {
      mediaQuery.removeEventListener("change", applyViewportState);
    };
  }, []);

  useEffect(() => {
    let mounted = true;
    let unsubscribe: (() => Promise<void>) | null = null;

    void (async () => {
      try {
        unsubscribe = await subscribeLobbyRealtime(search.lobbyId, {
          onAnyChange: () => {
            if (!mounted) return;
            void requestSnapshotRefresh();
          },
          onPlayerProgressUpsert: (progress) => {
            if (!mounted) return;
            setSnapshot((prev) => {
              if (!prev || prev.lobby.id !== progress.lobbyId) return prev;
              return {
                ...prev,
                progressByPlayerId: {
                  ...prev.progressByPlayerId,
                  [progress.playerId]: progress,
                },
              };
            });
          },
          onAntiPerkEvent: (event) => {
            if (!mounted) return;
            setAntiPerkFeed((prev) => [event, ...prev].slice(0, 30));

            const currentSnapshot = snapshotRef.current;
            const sourceName = currentSnapshot?.players.find(
              (player) => player.id === event.senderPlayerId
            )?.displayName;
            if (event.targetPlayerId === ownPlayerId) {
              setIncomingAntiPerkEvent({
                eventId: event.id,
                targetPlayerId: ownPlayerId,
                perkId: event.perkId,
                sourcePlayerName: sourceName,
              });
            }
          },
        });
      } catch (subscribeError) {
        if (!mounted) return;
        setError(
          subscribeError instanceof Error
            ? subscribeError.message
            : t`Failed to subscribe to match updates.`
        );
      }
    })();

    return () => {
      mounted = false;
      if (unsubscribe) {
        void unsubscribe();
      }
    };
  }, [ownPlayerId, requestSnapshotRefresh, search.lobbyId]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      void requestSnapshotRefresh();
    }, 1200);

    return () => {
      window.clearInterval(interval);
    };
  }, [requestSnapshotRefresh]);

  useEffect(() => {
    if (!snapshot) return;
    const notifications = getMultiplayerSessionNotifications(
      previousPlayersRef.current,
      snapshot.players,
      ownPlayerId
    );
    previousPlayersRef.current = snapshot.players;
    if (notifications.length === 0) return;
    setSessionNotificationQueue((prev) => [...prev, ...notifications]);
  }, [ownPlayerId, snapshot]);

  useEffect(() => {
    if (activeSessionNotification || sessionNotificationQueue.length === 0) return;
    const [nextNotification, ...rest] = sessionNotificationQueue;
    if (!nextNotification) return;

    setSessionNotificationQueue(rest);
    setActiveSessionNotification(nextNotification);
    sessionNotificationTimerRef.current = window.setTimeout(() => {
      sessionNotificationTimerRef.current = null;
      setActiveSessionNotification(null);
    }, 2400);
  }, [activeSessionNotification, sessionNotificationQueue]);

  useEffect(() => {
    if (!ownPlayerId) return;

    const interval = window.setInterval(() => {
      void heartbeat(search.lobbyId, ownPlayerId)
        .then(() => sweepForfeits(search.lobbyId, 300))
        .then(() => finalizeMatchIfComplete(search.lobbyId))
        .catch((heartbeatError) => {
          setError(
            heartbeatError instanceof Error
              ? heartbeatError.message
              : t`Failed to update heartbeat.`
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
    const player = localState.players[localState.currentPlayerIndex];
    if (!player) return;
    if (localState.sessionPhase !== "completed") return;
    if (finishSubmittedRef.current) return;
    if (!ownPlayerId) return;

    finishSubmittedRef.current = true;
    const finalState = toFinalPlayerState(localState.completionReason);
    const finalPayload = {
      completionReason: localState.completionReason,
      finalScore: player.score,
      completedRounds: Math.max(0, Math.floor(localState.endlessRoundsCompleted)),
      playtimeSec: Math.max(0, Math.floor((Date.now() - sessionStartedAtMsRef.current) / 1000)),
      completedAtIso: new Date().toISOString(),
    };

    void finishPlayer(search.lobbyId, ownPlayerId, player.score, { finalState, finalPayload })
      .then(() => finalizeMatchIfComplete(search.lobbyId))
      .then(() => {
        if (resultNavigationSubmittedRef.current) return;
        resultNavigationSubmittedRef.current = true;
        return navigate({
          to: "/multiplayer-result",
          search: {
            lobbyId: search.lobbyId,
            playerId: ownPlayerId,
          },
          replace: true,
        });
      })
      .catch((finishError) => {
        finishSubmittedRef.current = false;
        resultNavigationSubmittedRef.current = false;
        setError(
          finishError instanceof Error ? finishError.message : t`Failed to finalize completed run.`
        );
      });
  }, [localState, navigate, ownPlayerId, search.lobbyId]);

  useEffect(() => {
    const player = localState.players[localState.currentPlayerIndex];
    if (!player) return;

    const nextIds = new Set(player.inventory.map((entry) => entry.itemId));
    const previousIds = prevInventoryIdsRef.current;
    const newlyAdded = player.inventory.filter((entry) => !previousIds.has(entry.itemId));

    if (newlyAdded.length > 0) {
      setInventoryFxQueue((prev) => [
        ...prev,
        ...newlyAdded.map((item) => ({ fxId: `fx-${item.itemId}`, item })),
      ]);

      if (applyPerkDirectly && selectedTargetId) {
        newlyAdded
          .filter((item) => item.kind === "antiPerk")
          .forEach((item) => {
            void (async () => {
              setPending(true);
              try {
                await sendAntiPerk({
                  lobbyId: search.lobbyId,
                  senderPlayerId: ownPlayerId,
                  targetPlayerId: selectedTargetId,
                  perkId: item.perkId,
                  cost: 0,
                  cooldownSeconds: 0,
                });
                setPendingInventoryAction({
                  actionId: `consume-direct-${item.itemId}-${Date.now()}`,
                  type: "consume",
                  playerId: player.id,
                  itemId: item.itemId,
                  reason: `Directly sent anti-perk ${item.name}.`,
                });
                await requestSnapshotRefresh();
              } catch (directError) {
                setError(
                  directError instanceof Error
                    ? directError.message
                    : t`Failed to directly send anti-perk.`
                );
              } finally {
                setPending(false);
              }
            })();
          });
      }
    }

    prevInventoryIdsRef.current = nextIds;
  }, [
    applyPerkDirectly,
    localState,
    ownPlayerId,
    requestSnapshotRefresh,
    search.lobbyId,
    selectedTargetId,
  ]);

  useEffect(() => {
    if (activeInventoryFx || inventoryFxQueue.length === 0) return;
    const [nextFx, ...rest] = inventoryFxQueue;
    if (!nextFx) return;
    setInventoryFxQueue(rest);
    setActiveInventoryFx(nextFx);
    setInventoryBadgePulse(true);

    const pulseTimer = window.setTimeout(() => {
      setInventoryBadgePulse(false);
    }, 420);

    const clearTimer = window.setTimeout(() => {
      setActiveInventoryFx(null);
    }, 920);

    return () => {
      window.clearTimeout(pulseTimer);
      window.clearTimeout(clearTimer);
    };
  }, [activeInventoryFx, inventoryFxQueue]);

  const players = useMemo(() => snapshot?.players ?? [], [snapshot?.players]);
  const progressByPlayerId = snapshot?.progressByPlayerId ?? EMPTY_PROGRESS_BY_PLAYER_ID;
  const ownLobbyPlayer = useMemo(
    () => players.find((player) => player.id === ownPlayerId) ?? null,
    [ownPlayerId, players]
  );
  const isHost = ownLobbyPlayer?.role === "host";

  useEffect(() => {
    if (!ownLobbyPlayer || ownLobbyPlayer.state !== "kicked") return;
    if (resultNavigationSubmittedRef.current) return;

    resultNavigationSubmittedRef.current = true;
    setError(t`You were removed from this game.`);
    void navigate({
      to: "/multiplayer-result",
      search: {
        lobbyId: search.lobbyId,
        playerId: ownPlayerId,
      },
      replace: true,
    });
  }, [navigate, ownLobbyPlayer, ownPlayerId, search.lobbyId]);

  const remotePlayers = useMemo(
    () =>
      players
        .filter((player) => player.id !== ownPlayerId && player.state !== "kicked")
        .map((player) => ({
          id: player.id,
          name: player.displayName,
          position: progressByPlayerId[player.id]?.positionIndex ?? 0,
        })),
    [ownPlayerId, players, progressByPlayerId]
  );

  const remoteHudPlayers = useMemo(() => {
    const board = localState.config.board;
    const maxIndex = Math.max(1, localState.config.singlePlayer.totalIndices);
    const scoreCap = Math.max(
      1,
      ...players.map((player) =>
        Math.max(0, Math.floor(progressByPlayerId[player.id]?.score ?? player.finalScore ?? 0))
      )
    );
    const moneyCap = Math.max(
      localState.config.economy.startingMoney * 2,
      ...players.map((player) =>
        Math.max(0, Math.floor(progressByPlayerId[player.id]?.money ?? 0))
      ),
      1
    );

    return players
      .filter((player) => player.id !== ownPlayerId && player.state !== "kicked")
      .map((player) => {
        const progress = progressByPlayerId[player.id];
        const positionIndex = Math.max(0, Math.floor(progress?.positionIndex ?? 0));
        const activeEffectsCount = toSafeActiveEffects(progress?.activeEffectsJson).length;
        const inventory = toSafeInventory(progress?.inventoryJson);
        const inventoryStacks = buildInventoryStacks(inventory);
        const score = Math.max(0, Math.floor(progress?.score ?? player.finalScore ?? 0));
        const money = Math.max(0, Math.floor(progress?.money ?? 0));
        const boardFieldName = board[positionIndex]?.name ?? t`Unknown`;

        return {
          id: player.id,
          name: player.displayName,
          state: player.state,
          positionIndex,
          boardFieldName,
          boardProgressPct: Math.max(0, Math.min(100, (positionIndex / maxIndex) * 100)),
          score,
          money,
          scoreRatio: Math.max(0, Math.min(1, score / scoreCap)),
          moneyRatio: Math.max(0, Math.min(1, money / moneyCap)),
          lastRoll: typeof progress?.lastRoll === "number" ? progress.lastRoll : null,
          inventoryCount: inventory.length,
          inventoryStacks,
          activeEffectsCount,
        };
      })
      .sort(
        (a, b) =>
          b.score - a.score || b.positionIndex - a.positionIndex || a.name.localeCompare(b.name)
      );
  }, [
    localState.config.board,
    localState.config.economy.startingMoney,
    localState.config.singlePlayer.totalIndices,
    ownPlayerId,
    players,
    progressByPlayerId,
  ]);

  const targetPlayers = useMemo(
    () =>
      players.filter((player) => player.id !== ownPlayerId && !isTerminalPlayerState(player.state)),
    [ownPlayerId, players]
  );
  const targetPlayerOptions = useMemo(
    () =>
      targetPlayers.map((player) => {
        const progress = progressByPlayerId[player.id];
        return {
          id: player.id,
          label: player.displayName,
          description: t`Pos ${progress?.positionIndex ?? 0} • $${progress?.money ?? 0} • Score ${progress?.score ?? player.finalScore ?? 0}`,
        };
      }),
    [progressByPlayerId, targetPlayers]
  );

  const localPlayer = useMemo(
    () => localState.players[localState.currentPlayerIndex],
    [localState.currentPlayerIndex, localState.players]
  );

  const selectedInventoryItem = useMemo(() => {
    if (!selectedInventoryItemId || !localPlayer) return null;
    return localPlayer.inventory.find((entry) => entry.itemId === selectedInventoryItemId) ?? null;
  }, [localPlayer, selectedInventoryItemId]);

  useEffect(() => {
    if (!selectedTargetId && targetPlayers[0]) {
      setSelectedTargetId(targetPlayers[0].id);
    }
  }, [selectedTargetId, targetPlayers]);

  useEffect(() => {
    if (!localPlayer) {
      setSelectedInventoryItemId(null);
      return;
    }
    if (
      selectedInventoryItemId &&
      localPlayer.inventory.some((entry) => entry.itemId === selectedInventoryItemId)
    ) {
      return;
    }
    setSelectedInventoryItemId(localPlayer.inventory[0]?.itemId ?? null);
  }, [localPlayer, selectedInventoryItemId]);

  const handleUseInventoryItem = async () => {
    if (!localPlayer || !selectedInventoryItem) {
      setError(t`Select an item first.`);
      return;
    }

    if (selectedInventoryItem.kind === "perk") {
      setPendingInventoryAction({
        actionId: `apply-${selectedInventoryItem.itemId}-${Date.now()}`,
        type: "applySelf",
        playerId: localPlayer.id,
        itemId: selectedInventoryItem.itemId,
      });
      return;
    }

    if (!selectedTargetId) {
      setError(t`Pick a target player.`);
      return;
    }

    setPending(true);
    setError(null);
    try {
      await sendAntiPerk({
        lobbyId: search.lobbyId,
        senderPlayerId: ownPlayerId,
        targetPlayerId: selectedTargetId,
        perkId: selectedInventoryItem.perkId,
        cost: 0,
        cooldownSeconds: 0,
      });

      setPendingInventoryAction({
        actionId: `consume-${selectedInventoryItem.itemId}-${Date.now()}`,
        type: "consume",
        playerId: localPlayer.id,
        itemId: selectedInventoryItem.itemId,
        reason: `Sent anti-perk ${selectedInventoryItem.name}.`,
      });
      await requestSnapshotRefresh();
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : t`Failed to send anti-perk.`);
    } finally {
      setPending(false);
    }
  };
  const handleDiscardInventoryItem = (item: InventoryItem) => {
    if (!localPlayer) return;
    setPendingInventoryAction({
      actionId: `discard-${item.itemId}-${Date.now()}`,
      type: "consume",
      playerId: localPlayer.id,
      itemId: item.itemId,
      reason: `Discarded item: ${item.name}.`,
    });
  };

  const inventoryCount = localPlayer?.inventory.length ?? 0;
  const activeInventoryPerk = activeInventoryFx
    ? getPerkById(activeInventoryFx.item.perkId)
    : undefined;
  const activeInventoryRarityMeta =
    PERK_RARITY_META[
      activeInventoryPerk
        ? resolvePerkRarity(activeInventoryPerk)
        : activeInventoryFx
          ? fallbackRarityFromCost(activeInventoryFx.item.cost)
          : "common"
    ];
  const inVideoView = Boolean(localState.activeRound);
  const controlsVisible = !inVideoView || videoUiVisible;
  const otherPlayersVisible =
    controlsVisible && !isOverlayOpen && (!inVideoView || isVideoHudHotzoneActive);
  const showVideoHotzoneHint =
    inVideoView &&
    controlsVisible &&
    !isOverlayOpen &&
    !isLobbyControlOpen &&
    !isVideoHudHotzoneActive;

  const hostControllablePlayers = useMemo(
    () => players.filter((player) => player.role !== "host" && player.state !== "kicked"),
    [players]
  );

  const handleKickPlayer = async (targetPlayerId: string) => {
    setPending(true);
    setError(null);
    try {
      await kickLobbyPlayer(search.lobbyId, targetPlayerId);
      await requestSnapshotRefresh();
    } catch (kickError) {
      setError(kickError instanceof Error ? kickError.message : t`Failed to kick player.`);
    } finally {
      setPending(false);
    }
  };

  const handleBanPlayer = async (targetPlayerId: string) => {
    setPending(true);
    setError(null);
    try {
      await banLobbyPlayer(search.lobbyId, targetPlayerId, "Host ban");
      await requestSnapshotRefresh();
    } catch (banError) {
      setError(banError instanceof Error ? banError.message : t`Failed to ban player.`);
    } finally {
      setPending(false);
    }
  };

  const handleToggleLobbyOpen = useCallback(async () => {
    const currentLobby = snapshotRef.current?.lobby;
    if (!currentLobby) return;

    setPending(true);
    setError(null);
    try {
      await setLobbyOpenState(search.lobbyId, !currentLobby.isOpen);
      setSnapshot((prev) =>
        prev
          ? {
              ...prev,
              lobby: {
                ...prev.lobby,
                isOpen: !prev.lobby.isOpen,
              },
            }
          : prev
      );
      await requestSnapshotRefresh();
    } catch (openError) {
      setError(
        openError instanceof Error ? openError.message : t`Failed to update lobby lock state.`
      );
    } finally {
      setPending(false);
    }
  }, [requestSnapshotRefresh, search.lobbyId]);

  useEffect(() => {
    if (!inVideoView) {
      setIsVideoHudHotzoneActive(false);
      return;
    }

    const handleMouseMove = (event: MouseEvent) => {
      setIsVideoHudHotzoneActive(event.clientX <= window.innerWidth * 0.25);
    };

    const handleMouseLeave = () => {
      setIsVideoHudHotzoneActive(false);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseleave", handleMouseLeave);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseleave", handleMouseLeave);
    };
  }, [inVideoView]);

  useEffect(() => {
    if (isHost) return;
    setIsLobbyControlOpen(false);
  }, [isHost]);

  return (
    <BlockCommandPalette>
      <MultiplayerUpdateGuard>
        <div className="relative min-h-screen bg-zinc-950 text-zinc-100">
          {error && (
            <div className="pointer-events-none fixed left-1/2 top-6 z-[120] -translate-x-1/2 rounded border border-rose-500/60 bg-rose-500/15 px-4 py-2 text-sm text-rose-100">
              {error}
            </div>
          )}

          {activeSessionNotification && (
            <div className="pointer-events-none fixed left-1/2 top-20 z-[121] -translate-x-1/2">
              <div className="rounded-xl border border-cyan-300/40 bg-zinc-950/92 px-4 py-2 text-sm font-semibold text-cyan-100 shadow-2xl backdrop-blur">
                {activeSessionNotification.message}
              </div>
            </div>
          )}

          {activeInventoryFx && (
            <div className="pointer-events-none fixed inset-0 z-[121]">
              <div
                className={`inventory-fly-item rounded-lg border bg-zinc-950/92 px-3 py-2 text-xs shadow-[0_0_24px_rgba(0,0,0,0.35)] ${activeInventoryRarityMeta.tailwind.inventorySelected}`}
              >
                <div className="flex items-center gap-2">
                  <PerkIcon
                    iconKey={activeInventoryPerk?.iconKey ?? "unknown"}
                    className="h-4 w-4"
                  />
                  <span>
                    <Trans>Stored: {activeInventoryFx.item.name}</Trans>
                  </span>
                  <span
                    className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] ${activeInventoryRarityMeta.tailwind.badge}`}
                  >
                    {activeInventoryRarityMeta.label}
                  </span>
                </div>
              </div>
            </div>
          )}

          <GameScene
            key={`${search.lobbyId}:${ownPlayerId}`}
            initialState={initialState}
            sessionStartedAtMs={sessionStartedAtMsRef.current}
            installedRounds={installedRounds}
            multiplayerRemotePlayers={remotePlayers}
            showMultiplayerPlayerNames
            optionsActions={
              isHost
                ? [
                    {
                      id: "toggle-lobby-lock",
                      label: snapshot?.lobby.isOpen ? t`Lock Lobby` : t`Unlock Lobby`,
                      onClick: () => {
                        void handleToggleLobbyOpen();
                      },
                      disabled: pending,
                    },
                  ]
                : []
            }
            externalAntiPerkEvent={incomingAntiPerkEvent}
            externalInventoryAction={pendingInventoryAction}
            onExternalAntiPerkEventHandled={handleExternalAntiPerkEventHandled}
            onExternalInventoryActionHandled={handleExternalInventoryActionHandled}
            onStateChange={handleGameStateChange}
            onGiveUp={() => {
              void (async () => {
                try {
                  const player = localState.players[localState.currentPlayerIndex];
                  const finalScore = Math.max(0, Math.floor(player?.score ?? 0));
                  const finalPayload = {
                    completionReason: "gave_up",
                    finalScore,
                    completedRounds: Math.max(0, Math.floor(localState.endlessRoundsCompleted)),
                    playtimeSec: Math.max(
                      0,
                      Math.floor((Date.now() - sessionStartedAtMsRef.current) / 1000)
                    ),
                    completedAtIso: new Date().toISOString(),
                  };

                  await finishPlayer(search.lobbyId, ownPlayerId, finalScore, {
                    finalState: "forfeited",
                    finalPayload,
                  });
                  await finalizeMatchIfComplete(search.lobbyId);
                } catch (giveUpError) {
                  setError(
                    giveUpError instanceof Error ? giveUpError.message : t`Failed to give up.`
                  );
                  return;
                }
                await navigate({
                  to: "/multiplayer-result",
                  search: {
                    lobbyId: search.lobbyId,
                    playerId: ownPlayerId,
                  },
                  replace: true,
                });
              })();
            }}
            applyPerkDirectly={applyPerkDirectly}
            onApplyPerkDirectlyChange={handleApplyPerkDirectlyChange}
            onRoundOverlayUiVisibilityChange={setVideoUiVisible}
            intermediaryLoadingPrompt={intermediaryLoadingPrompt}
            intermediaryLoadingDurationSec={intermediaryLoadingDurationSec}
            intermediaryReturnPauseSec={intermediaryReturnPauseSec}
            initialShowProgressBarAlways={roundProgressBarAlwaysVisible}
            hideInventoryButton
          />

          {showVideoHotzoneHint && (
            <div
              className="pointer-events-none fixed top-1/2 z-[113] -translate-y-1/2"
              style={{ left: "2px" }}
              aria-hidden="true"
            >
              <div className="video-left-hotzone-hint">
                {[0, 1, 2].map((index) => (
                  <span
                    key={`left-hotzone-arrow-${index}`}
                    className="video-left-hotzone-hint-arrow"
                    style={{ animationDelay: `${index * 150}ms` }}
                  >
                    ◀
                  </span>
                ))}
              </div>
            </div>
          )}

          {remoteHudPlayers.length > 0 && (
            <aside
              className={`fixed z-[114] overflow-hidden rounded-2xl border backdrop-blur-xl transition-all duration-300 ${
                inVideoView
                  ? "border-cyan-200/25 bg-[linear-gradient(150deg,rgba(5,20,44,0.5),rgba(4,10,26,0.34))] shadow-[0_14px_34px_rgba(2,8,22,0.35),0_0_18px_rgba(34,211,238,0.09)]"
                  : "border-cyan-300/35 bg-[linear-gradient(150deg,rgba(5,20,44,0.92),rgba(4,10,26,0.88))] shadow-[0_18px_48px_rgba(2,8,22,0.6),0_0_26px_rgba(34,211,238,0.15)]"
              } ${
                otherPlayersVisible
                  ? "translate-x-0 opacity-100"
                  : "pointer-events-none -translate-x-2 opacity-0"
              } ${isNarrowViewport ? "bottom-20 left-2 right-2 max-h-[40vh]" : "left-4 top-16 w-[340px] max-h-[calc(100vh-5.5rem)]"}`}
            >
              <div
                className={`flex items-center justify-between border-b px-4 py-2.5 ${
                  inVideoView
                    ? "border-cyan-200/15 bg-[linear-gradient(180deg,rgba(10,30,56,0.46),rgba(7,18,38,0.42))]"
                    : "border-cyan-300/20 bg-[linear-gradient(180deg,rgba(10,30,56,0.78),rgba(7,18,38,0.75))]"
                }`}
              >
                <div className="font-[family-name:var(--font-jetbrains-mono)] text-[11px] uppercase tracking-[0.22em] text-cyan-100">
                  <Trans>Other Players</Trans>
                </div>
                <div className="rounded-md border border-cyan-300/30 bg-cyan-400/10 px-2 py-0.5 text-[10px] font-semibold text-cyan-100">
                  {remoteHudPlayers.length}
                </div>
              </div>
              <div className="space-y-2.5 overflow-y-auto p-2.5">
                {remoteHudPlayers.map((remote) => (
                  <div
                    key={remote.id}
                    className={`rounded-xl border px-3 py-2.5 text-[11px] shadow-[inset_0_1px_0_rgba(160,210,255,0.16)] ${
                      inVideoView
                        ? "border-blue-200/20 bg-[linear-gradient(145deg,rgba(8,26,53,0.56),rgba(6,16,34,0.52))]"
                        : "border-blue-300/30 bg-[linear-gradient(145deg,rgba(8,26,53,0.9),rgba(6,16,34,0.9))]"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="truncate text-[27px] leading-none font-semibold text-zinc-100 [font-size:clamp(1rem,1.5vw,1.65rem)]">
                        {remote.name}
                      </div>
                      <div className="shrink-0 rounded-md border border-zinc-500/60 bg-zinc-800/65 px-2 py-0.5 font-[family-name:var(--font-jetbrains-mono)] text-[10px] uppercase tracking-[0.08em] text-zinc-200">
                        {remote.state}
                      </div>
                    </div>
                    <div className="mt-0.5 truncate font-[family-name:var(--font-jetbrains-mono)] text-[10px] uppercase tracking-[0.1em] text-zinc-400/95">
                      <Trans>
                        Field {remote.positionIndex + 1}: {remote.boardFieldName}
                      </Trans>
                    </div>

                    <div className="mt-2 rounded-lg border border-cyan-300/20 bg-[#081b37]/78 px-2 py-1.5">
                      <div className="mb-1 flex items-center justify-between font-[family-name:var(--font-jetbrains-mono)] text-[10px] uppercase tracking-[0.09em] text-cyan-100/90">
                        <span>
                          <Trans>Board Progress</Trans>
                        </span>
                        <span>{remote.boardProgressPct.toFixed(0)}%</span>
                      </div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-[#0b213e]">
                        <div
                          className="h-full rounded-full bg-[linear-gradient(90deg,#5eead4,#67e8f9)]"
                          style={{ width: `${remote.boardProgressPct}%` }}
                        />
                      </div>
                    </div>

                    <div className="mt-2 grid grid-cols-2 gap-2">
                      <div className="rounded-lg border border-sky-300/25 bg-[#091b37]/75 px-2 py-1.5">
                        <div className="font-[family-name:var(--font-jetbrains-mono)] text-[10px] uppercase tracking-[0.08em] text-sky-200">
                          <Trans>Score {remote.score}</Trans>
                        </div>
                        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-[#0b213e]">
                          <div
                            className="h-full rounded-full bg-[linear-gradient(90deg,#38bdf8,#7dd3fc)]"
                            style={{ width: `${remote.scoreRatio * 100}%` }}
                          />
                        </div>
                      </div>
                      <div className="rounded-lg border border-emerald-300/25 bg-[#081f31]/75 px-2 py-1.5">
                        <div className="font-[family-name:var(--font-jetbrains-mono)] text-[10px] uppercase tracking-[0.08em] text-emerald-200">
                          <Trans>$ {remote.money}</Trans>
                        </div>
                        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-[#06322b]">
                          <div
                            className="h-full rounded-full bg-[linear-gradient(90deg,#34d399,#6ee7b7)]"
                            style={{ width: `${remote.moneyRatio * 100}%` }}
                          />
                        </div>
                      </div>
                    </div>

                    <div className="mt-2 flex items-center justify-between font-[family-name:var(--font-jetbrains-mono)] text-[10px] uppercase tracking-[0.08em] text-zinc-300/95">
                      <span>
                        <Trans>Roll {remote.lastRoll ?? "-"}</Trans>
                      </span>
                      <span>
                        <Trans>Effects {remote.activeEffectsCount}</Trans>
                      </span>
                    </div>

                    <div className="mt-2 rounded-lg border border-cyan-300/20 bg-[#081a35]/78 px-2 py-1.5">
                      <div className="mb-1 font-[family-name:var(--font-jetbrains-mono)] text-[10px] uppercase tracking-[0.1em] text-cyan-100/90">
                        <Trans>Items {remote.inventoryCount}</Trans>
                      </div>
                      {remote.inventoryStacks.length === 0 ? (
                        <div className="text-zinc-400">
                          <Trans>None</Trans>
                        </div>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {remote.inventoryStacks.slice(0, 6).map((stack) => {
                            const rarityMeta = PERK_RARITY_META[stack.rarity];
                            return (
                              <div
                                key={`${remote.id}-${stack.perkId}`}
                                className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 ${rarityMeta.tailwind.chip}`}
                              >
                                <PerkIcon iconKey={stack.iconKey} className="h-3 w-3" />
                                <span className="max-w-[108px] truncate">{stack.name}</span>
                                <span
                                  className={`rounded border px-1 text-[9px] font-semibold uppercase tracking-[0.08em] ${rarityMeta.tailwind.badge}`}
                                >
                                  {rarityMeta.label}
                                </span>
                                {stack.count > 1 && (
                                  <span className="text-zinc-100/90">x{stack.count}</span>
                                )}
                              </div>
                            );
                          })}
                          {remote.inventoryStacks.length > 6 && (
                            <div className="inline-flex items-center rounded border border-zinc-600/70 bg-zinc-900/70 px-1.5 py-0.5 text-zinc-300">
                              +{remote.inventoryStacks.length - 6}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </aside>
          )}

          <InventoryDockButton
            count={inventoryCount}
            isOpen={isOverlayOpen}
            onClick={() => setIsOverlayOpen((prev) => !prev)}
            position={inVideoView ? "video-view" : "default"}
            pulse={inventoryBadgePulse}
            controlsVisible={controlsVisible}
          />

          {isHost && (
            <button
              type="button"
              aria-label={isLobbyControlOpen ? t`Close lobby control` : t`Open lobby control`}
              title={isLobbyControlOpen ? t`Close Lobby Control` : t`Open Lobby Control`}
              className={`fixed z-[115] flex h-12 min-w-12 items-center justify-center rounded-full border px-3 text-xs font-semibold uppercase tracking-[0.08em] backdrop-blur transition-all duration-200 ${
                inVideoView ? "bottom-24 right-20" : "bottom-4 left-20"
              } ${controlsVisible ? "opacity-100" : "pointer-events-none opacity-0"} ${
                isLobbyControlOpen
                  ? "border-amber-300/80 bg-amber-500/20 text-amber-100"
                  : "border-zinc-600 bg-zinc-950/95 text-zinc-100 hover:border-zinc-400"
              }`}
              onClick={() => setIsLobbyControlOpen((prev) => !prev)}
            >
              <Trans>Host</Trans>
            </button>
          )}

          {isOverlayOpen && (
            <aside
              className={`fixed z-[110] space-y-3 overflow-y-auto transition-opacity duration-200 ${
                controlsVisible ? "opacity-100" : "pointer-events-none opacity-0"
              } ${
                isNarrowViewport
                  ? `${inVideoView ? "bottom-40" : "bottom-20"} left-2 right-2 max-h-[58vh]`
                  : `${inVideoView ? "bottom-40" : "bottom-20"} left-4 w-[min(52rem,calc(100vw-2rem))] max-h-[calc(100vh-7rem)]`
              }`}
            >
              <PerkInventoryPanel
                title={t`Lobby Inventory`}
                subtitle={t`Use perks on yourself, fire anti-perks at opponents, or discard stored items.`}
                inventory={localPlayer?.inventory ?? []}
                activeEffects={localPlayer?.activePerkEffects ?? []}
                selectedItemId={selectedInventoryItemId}
                onSelectItem={setSelectedInventoryItemId}
                onUseSelectedItem={() => {
                  void handleUseInventoryItem();
                }}
                onDiscardSelectedItem={handleDiscardInventoryItem}
                useActionLabel={
                  selectedInventoryItem?.kind === "antiPerk" ? t`Send Anti-Perk` : t`Apply Perk`
                }
                useDisabled={
                  pending || (selectedInventoryItem?.kind === "antiPerk" && !selectedTargetId)
                }
                useDisabledReason={
                  selectedInventoryItem?.kind === "antiPerk" && !selectedTargetId
                    ? t`Pick a target player before sending this anti-perk.`
                    : null
                }
                targets={targetPlayerOptions}
                selectedTargetId={selectedTargetId}
                onSelectTarget={setSelectedTargetId}
                headerBadge={t`Lobby ${search.lobbyId.slice(0, 8)} • ${applyPerkDirectly ? t`Direct` : t`Store`}`}
                applyDirectly={applyPerkDirectly}
                onApplyDirectlyChange={(value) => {
                  setApplyPerkDirectly(value);
                  void trpc.store.set
                    .mutate({ key: MULTIPLAYER_APPLY_DIRECTLY_KEY, value })
                    .catch(() => {});
                }}
              />

              <div className="rounded-xl border border-zinc-700/80 bg-zinc-950/88 p-3 backdrop-blur">
                <div className="mb-2 text-[11px] uppercase tracking-[0.16em] text-zinc-300">
                  <Trans>Player Standings</Trans>
                </div>
                <div
                  className={`space-y-2 overflow-auto pr-1 text-xs ${isNarrowViewport ? "max-h-40" : "max-h-56"}`}
                >
                  {players.map((player) => {
                    const progress = snapshot?.progressByPlayerId[player.id];
                    return (
                      <div
                        key={player.id}
                        className="rounded border border-zinc-800 bg-zinc-900/65 p-2"
                      >
                        <div className="font-semibold text-zinc-100">{player.displayName}</div>
                        <div className="text-[10px] text-violet-200">
                          Lv. {player.profileLevel ?? 1} · {player.titleText ?? "Fresh Meat"}
                        </div>
                        <div className="mt-1 text-zinc-300">
                          <Trans>
                            {player.state} | Pos {progress?.positionIndex ?? 0} | ${" "}
                            {progress?.money ?? 0} | Score{" "}
                            {progress?.score ?? player.finalScore ?? 0}
                          </Trans>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="rounded-xl border border-zinc-700/80 bg-zinc-950/88 p-3 backdrop-blur">
                <div className="mb-2 text-[11px] uppercase tracking-[0.16em] text-zinc-300">
                  <Trans>Anti-Perk Feed</Trans>
                </div>
                <div
                  className={`space-y-2 overflow-auto pr-1 text-xs ${isNarrowViewport ? "max-h-28" : "max-h-44"}`}
                >
                  {antiPerkFeed.map((event) => {
                    const perk = getPerkById(event.perkId);
                    const rarityMeta = PERK_RARITY_META[perk ? resolvePerkRarity(perk) : "common"];
                    return (
                      <div
                        key={event.id}
                        className={`rounded border p-2 ${rarityMeta.tailwind.feed}`}
                      >
                        <div className="flex items-center gap-2 font-semibold text-zinc-100">
                          <PerkIcon iconKey={perk?.iconKey ?? "unknown"} className="h-4 w-4" />
                          <span>{perk?.name ?? event.perkId}</span>
                          <span
                            className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] ${rarityMeta.tailwind.badge}`}
                          >
                            {rarityMeta.label}
                          </span>
                        </div>
                        <div className="text-zinc-300">
                          {event.senderPlayerId.slice(0, 6)} {"->"}{" "}
                          {event.targetPlayerId.slice(0, 6)}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </aside>
          )}

          {isHost && isLobbyControlOpen && (
            <aside
              className={`fixed z-[112] overflow-y-auto rounded-xl border border-amber-400/40 bg-zinc-950/92 p-3 backdrop-blur ${
                controlsVisible ? "opacity-100" : "pointer-events-none opacity-0"
              } ${
                isNarrowViewport
                  ? `${inVideoView ? "bottom-40" : "bottom-20"} left-2 right-2 max-h-[40vh]`
                  : `${inVideoView ? "bottom-40" : "bottom-20"} left-[412px] w-[380px] max-h-[calc(100vh-7rem)]`
              }`}
            >
              <div className="mb-2 flex items-center justify-between text-[11px] uppercase tracking-[0.16em] text-amber-200">
                <span>
                  <Trans>Lobby Control</Trans>
                </span>
                <span>{hostControllablePlayers.length}</span>
              </div>
              <div className="space-y-2 text-xs">
                {hostControllablePlayers.length === 0 && (
                  <div className="rounded border border-zinc-800 bg-zinc-900/70 px-3 py-2 text-zinc-400">
                    <Trans>No players available for moderation.</Trans>
                  </div>
                )}
                {hostControllablePlayers.map((player) => {
                  const progress = snapshot?.progressByPlayerId[player.id];
                  return (
                    <div
                      key={`lobby-control-${player.id}`}
                      className="rounded border border-zinc-700 bg-zinc-900/75 px-3 py-2"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div>
                          <div className="font-semibold text-zinc-100">{player.displayName}</div>
                          <div className="text-[10px] text-violet-200">
                            Lv. {player.profileLevel ?? 1} · {player.titleText ?? "Fresh Meat"}
                          </div>
                          <div className="text-zinc-400">
                            <Trans>
                              {player.state} | Pos {progress?.positionIndex ?? 0} | Score{" "}
                              {progress?.score ?? player.finalScore ?? 0}
                            </Trans>
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            disabled={pending}
                            className="rounded border border-zinc-600 bg-zinc-950 px-2 py-1 text-zinc-100 hover:border-zinc-400 disabled:opacity-60"
                            onClick={() => {
                              void handleKickPlayer(player.id);
                            }}
                          >
                            <Trans>Kick</Trans>
                          </button>
                          <button
                            type="button"
                            disabled={pending}
                            className="rounded border border-rose-500/70 bg-rose-500/15 px-2 py-1 text-rose-100 hover:bg-rose-500/25 disabled:opacity-60"
                            onClick={() => {
                              void handleBanPlayer(player.id);
                            }}
                          >
                            <Trans>Ban</Trans>
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </aside>
          )}
        </div>
      </MultiplayerUpdateGuard>
    </BlockCommandPalette>
  );
}
