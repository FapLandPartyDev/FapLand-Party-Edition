import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { z } from "zod";
import { PerkIcon } from "../components/game/PerkIcon";
import { GameScene } from "../components/game/GameScene";
import { createInitialGameState } from "../game/engine";
import { getPerkById } from "../game/data/perks";
import { PERK_RARITY_META, fallbackRarityFromCost, resolvePerkRarity } from "../game/data/perkRarity";
import { toGameConfigFromPlaylist } from "../game/playlistRuntime";
import type { ActivePerkEffect, GameCompletionReason, GameState, InventoryItem, PerkIconKey, PerkRarity, PlayerStats } from "../game/types";
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
import { trpc } from "../services/trpc";

const MatchSearchSchema = z.object({
  lobbyId: z.string().min(1),
  playerId: z.string().min(1).optional(),
});

const INTERMEDIARY_LOADING_PROMPT_KEY = "game.intermediary.loadingPrompt";
const INTERMEDIARY_LOADING_DURATION_KEY = "game.intermediary.loadingDurationSec";
const INTERMEDIARY_RETURN_PAUSE_KEY = "game.intermediary.returnPauseSec";
const MULTIPLAYER_APPLY_DIRECTLY_KEY = "game.multiplayer.applyDirectly";
const DEFAULT_INTERMEDIARY_LOADING_PROMPT = "animated gif webm";
const DEFAULT_INTERMEDIARY_LOADING_DURATION_SEC = 10;
const DEFAULT_INTERMEDIARY_RETURN_PAUSE_SEC = 4;
const EMPTY_PROGRESS_BY_PLAYER_ID: MultiplayerLobbySnapshot["progressByPlayerId"] = {};

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

  const grouped = items.reduce<Map<string, { perkId: string; name: string; iconKey: PerkIconKey; rarity: PerkRarity; count: number }>>((acc, item) => {
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

  return Array.from(grouped.values())
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

function toSafeStats(value: unknown, fallback: PlayerStats): PlayerStats {
  if (!value || typeof value !== "object") return fallback;
  const raw = value as Partial<PlayerStats>;
  const diceMin = typeof raw.diceMin === "number" && Number.isFinite(raw.diceMin)
    ? Math.max(1, Math.floor(raw.diceMin))
    : fallback.diceMin;
  const diceMaxRaw = typeof raw.diceMax === "number" && Number.isFinite(raw.diceMax)
    ? Math.max(1, Math.floor(raw.diceMax))
    : fallback.diceMax;
  const diceMax = Math.max(diceMin, diceMaxRaw);
  const roundPauseMs = typeof raw.roundPauseMs === "number" && Number.isFinite(raw.roundPauseMs)
    ? Math.max(250, Math.floor(raw.roundPauseMs))
    : fallback.roundPauseMs;

  return { diceMin, diceMax, roundPauseMs };
}

function toSafeActiveEffects(value: unknown): ActivePerkEffect[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is ActivePerkEffect => {
    if (!entry || typeof entry !== "object") return false;
    const raw = entry as Partial<ActivePerkEffect>;
    if (typeof raw.id !== "string" || raw.id.trim().length === 0) return false;
    if (raw.kind !== "perk" && raw.kind !== "antiPerk") return false;
    if (!(Array.isArray(raw.effects))) return false;
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
    const cost = typeof raw.cost === "number" && Number.isFinite(raw.cost) ? Math.max(0, Math.floor(raw.cost)) : 0;
    const acquiredTurn = typeof raw.acquiredTurn === "number" && Number.isFinite(raw.acquiredTurn)
      ? Math.max(1, Math.floor(raw.acquiredTurn))
      : 1;
    return [{
      itemId: raw.itemId,
      perkId: raw.perkId,
      kind: raw.kind,
      name,
      cost,
      acquiredTurn,
    }];
  });
}

function deriveInitialMultiplayerState(input: {
  snapshot: MultiplayerLobbySnapshot;
  ownPlayerId: string;
  ownPlayerName: string;
  installedRounds: Awaited<ReturnType<typeof db.round.findInstalled>>;
}): GameState {
  const playlistConfig = extractPlaylistConfigFromSnapshot(input.snapshot.lobby.playlistSnapshotJson);
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
    ownProgress?.positionNodeId && base.config.runtimeGraph.nodeIndexById[ownProgress.positionNodeId] !== undefined
      ? ownProgress.positionNodeId
      : base.config.board[resolvedPosition]?.id ?? fallbackPlayer.currentNodeId;

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
    const [rawPrompt, rawDuration, rawReturnPause] = await Promise.all([
      trpc.store.get.query({ key: INTERMEDIARY_LOADING_PROMPT_KEY }),
      trpc.store.get.query({ key: INTERMEDIARY_LOADING_DURATION_KEY }),
      trpc.store.get.query({ key: INTERMEDIARY_RETURN_PAUSE_KEY }),
    ]);

    const prompt =
      typeof rawPrompt === "string" && rawPrompt.trim().length > 0
        ? rawPrompt.trim()
        : DEFAULT_INTERMEDIARY_LOADING_PROMPT;

    const parsedDuration = typeof rawDuration === "number" ? rawDuration : Number(rawDuration);
    const parsedReturnPause = typeof rawReturnPause === "number" ? rawReturnPause : Number(rawReturnPause);

    return {
      intermediaryLoadingPrompt: prompt,
      intermediaryLoadingDurationSec: Number.isFinite(parsedDuration)
        ? Math.max(1, Math.min(60, Math.floor(parsedDuration)))
        : DEFAULT_INTERMEDIARY_LOADING_DURATION_SEC,
      intermediaryReturnPauseSec: Number.isFinite(parsedReturnPause)
        ? Math.max(0, Math.min(60, Math.floor(parsedReturnPause)))
        : DEFAULT_INTERMEDIARY_RETURN_PAUSE_SEC,
    };
  } catch {
    return {
      intermediaryLoadingPrompt: DEFAULT_INTERMEDIARY_LOADING_PROMPT,
      intermediaryLoadingDurationSec: DEFAULT_INTERMEDIARY_LOADING_DURATION_SEC,
      intermediaryReturnPauseSec: DEFAULT_INTERMEDIARY_RETURN_PAUSE_SEC,
    };
  }
}

async function getApplyDirectlySetting(): Promise<boolean> {
  try {
    const raw = await trpc.store.get.query({ key: MULTIPLAYER_APPLY_DIRECTLY_KEY });
    if (typeof raw === "boolean") return raw;
    if (typeof raw === "number") return raw !== 0;
    if (typeof raw === "string") return raw.trim().toLowerCase() !== "false";
    return true;
  } catch {
    return true;
  }
}

export const Route = createFileRoute("/multiplayer-match")({
  validateSearch: (search) => MatchSearchSchema.parse(search),
  loader: async ({ location }) => {
    const search = MatchSearchSchema.parse(location.search);
    const [snapshot, ownPlayer, initialAntiPerkFeed, installedRounds, intermediarySettings, initialApplyDirectly] = await Promise.all([
      getLobbySnapshot(search.lobbyId),
      getOwnLobbyPlayer(search.lobbyId),
      listRecentAntiPerkEvents(search.lobbyId),
      db.round.findInstalled(),
      getIntermediarySettings(),
      getApplyDirectlySetting(),
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
      ...intermediarySettings,
    };
  },
  component: MultiplayerMatchRoute,
});

function MultiplayerMatchRoute() {
  const navigate = useNavigate();
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
  } = Route.useLoaderData();

  const [snapshot, setSnapshot] = useState<MultiplayerLobbySnapshot | null>(initialSnapshot);
  const [ownPlayerId, setOwnPlayerId] = useState(ownPlayer.id);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [antiPerkFeed, setAntiPerkFeed] = useState<MultiplayerAntiPerkEvent[]>(initialAntiPerkFeed);
  const [selectedTargetId, setSelectedTargetId] = useState("");
  const [selectedInventoryItemId, setSelectedInventoryItemId] = useState<string | null>(null);
  const [localState, setLocalState] = useState<GameState>(initialState);
  const [isNarrowViewport, setIsNarrowViewport] = useState(false);
  const [isOverlayOpen, setIsOverlayOpen] = useState(false);
  const [isLobbyControlOpen, setIsLobbyControlOpen] = useState(false);
  const [isVideoHudHotzoneActive, setIsVideoHudHotzoneActive] = useState(false);
  const [applyPerkDirectly, setApplyPerkDirectly] = useState(initialApplyDirectly);
  const [videoUiVisible, setVideoUiVisible] = useState(true);
  const [incomingAntiPerkEvent, setIncomingAntiPerkEvent] = useState<{
    eventId: string;
    targetPlayerId: string;
    perkId: string;
    sourcePlayerName?: string;
  } | null>(null);
  const [pendingInventoryAction, setPendingInventoryAction] = useState<ExternalInventoryAction | null>(null);
  const [inventoryFxQueue, setInventoryFxQueue] = useState<Array<{ fxId: string; item: InventoryItem }>>([]);
  const [activeInventoryFx, setActiveInventoryFx] = useState<{ fxId: string; item: InventoryItem } | null>(null);
  const [inventoryBadgePulse, setInventoryBadgePulse] = useState(false);

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
  const prevInventoryIdsRef = useRef<Set<string>>(new Set(initialState.players[0]?.inventory.map((entry: InventoryItem) => entry.itemId) ?? []));

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
      setError(recentEventsError instanceof Error ? recentEventsError.message : "Failed to refresh anti-perk feed.");
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
      setError(refreshError instanceof Error ? refreshError.message : "Failed to refresh match.");
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
      setError(syncError instanceof Error ? syncError.message : "Failed to sync local progress.");
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

  useEffect(() => {
    return () => {
      if (syncTimerRef.current !== null) {
        window.clearTimeout(syncTimerRef.current);
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
            const sourceName = currentSnapshot?.players.find((player) => player.id === event.senderPlayerId)?.displayName;
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
        setError(subscribeError instanceof Error ? subscribeError.message : "Failed to subscribe to match updates.");
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
    if (!ownPlayerId) return;

    const interval = window.setInterval(() => {
      void heartbeat(search.lobbyId, ownPlayerId)
        .then(() => sweepForfeits(search.lobbyId, 300))
        .then(() => finalizeMatchIfComplete(search.lobbyId))
        .catch((heartbeatError) => {
          setError(heartbeatError instanceof Error ? heartbeatError.message : "Failed to update heartbeat.");
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
        setError(finishError instanceof Error ? finishError.message : "Failed to finalize completed run.");
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
                setError(directError instanceof Error ? directError.message : "Failed to directly send anti-perk.");
              } finally {
                setPending(false);
              }
            })();
          });
      }
    }

    prevInventoryIdsRef.current = nextIds;
  }, [applyPerkDirectly, localState, ownPlayerId, requestSnapshotRefresh, search.lobbyId, selectedTargetId]);

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
    [ownPlayerId, players],
  );
  const isHost = ownLobbyPlayer?.role === "host";

  useEffect(() => {
    if (!ownLobbyPlayer || ownLobbyPlayer.state !== "kicked") return;
    if (resultNavigationSubmittedRef.current) return;

    resultNavigationSubmittedRef.current = true;
    setError("You were removed from this game.");
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
    () => players
      .filter((player) => player.id !== ownPlayerId && player.state !== "kicked")
      .map((player) => ({
        id: player.id,
        name: player.displayName,
        position: progressByPlayerId[player.id]?.positionIndex ?? 0,
      })),
    [ownPlayerId, players, progressByPlayerId],
  );

  const remoteHudPlayers = useMemo(() => {
    const board = localState.config.board;
    const maxIndex = Math.max(1, localState.config.singlePlayer.totalIndices);
    const scoreCap = Math.max(
      1,
      ...players.map((player) => Math.max(0, Math.floor(progressByPlayerId[player.id]?.score ?? player.finalScore ?? 0))),
    );
    const moneyCap = Math.max(
      localState.config.economy.startingMoney * 2,
      ...players.map((player) => Math.max(0, Math.floor(progressByPlayerId[player.id]?.money ?? 0))),
      1,
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
        const boardFieldName = board[positionIndex]?.name ?? "Unknown";

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
      .sort((a, b) => b.score - a.score || b.positionIndex - a.positionIndex || a.name.localeCompare(b.name));
  }, [localState.config.board, localState.config.economy.startingMoney, localState.config.singlePlayer.totalIndices, ownPlayerId, players, progressByPlayerId]);

  const targetPlayers = useMemo(
    () => players.filter((player) => player.id !== ownPlayerId && !isTerminalPlayerState(player.state)),
    [ownPlayerId, players],
  );

  const localPlayer = useMemo(
    () => localState.players[localState.currentPlayerIndex],
    [localState.currentPlayerIndex, localState.players],
  );

  const inventoryStacks = useMemo(() => {
    const inventory = localPlayer?.inventory ?? [];
    const byPerkId = new Map<string, { itemIds: string[]; item: InventoryItem }>();

    for (const item of inventory) {
      const found = byPerkId.get(item.perkId);
      if (!found) {
        byPerkId.set(item.perkId, { itemIds: [item.itemId], item });
        continue;
      }
      found.itemIds.push(item.itemId);
    }

    return Array.from(byPerkId.values())
      .map((entry) => {
        const perk = getPerkById(entry.item.perkId);
        const rarity = perk ? resolvePerkRarity(perk) : fallbackRarityFromCost(entry.item.cost);
        return {
          ...entry,
          itemIds: [...entry.itemIds],
          count: entry.itemIds.length,
          iconKey: perk?.iconKey ?? "unknown",
          displayName: perk?.name ?? entry.item.name,
          rarity,
        };
      })
      .sort((a, b) => b.count - a.count || a.displayName.localeCompare(b.displayName));
  }, [localPlayer?.inventory]);

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
    if (selectedInventoryItemId && localPlayer.inventory.some((entry) => entry.itemId === selectedInventoryItemId)) {
      return;
    }
    setSelectedInventoryItemId(localPlayer.inventory[0]?.itemId ?? null);
  }, [localPlayer, selectedInventoryItemId]);

  const handleUseInventoryItem = async () => {
    if (!localPlayer || !selectedInventoryItem) {
      setError("Select an item first.");
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
      setError("Pick a target player.");
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
      setError(sendError instanceof Error ? sendError.message : "Failed to send anti-perk.");
    } finally {
      setPending(false);
    }
  };

  const applyDirectlyLabel = applyPerkDirectly ? "Direct" : "Store";
  const inventoryCount = localPlayer?.inventory.length ?? 0;
  const selectedPerkDefinition = selectedInventoryItem ? getPerkById(selectedInventoryItem.perkId) : undefined;
  const selectedItemIconKey = selectedPerkDefinition?.iconKey ?? "unknown";
  const selectedItemRarity = selectedInventoryItem
    ? (selectedPerkDefinition ? resolvePerkRarity(selectedPerkDefinition) : fallbackRarityFromCost(selectedInventoryItem.cost))
    : "common";
  const selectedItemRarityMeta = PERK_RARITY_META[selectedItemRarity];
  const activeInventoryPerk = activeInventoryFx ? getPerkById(activeInventoryFx.item.perkId) : undefined;
  const activeInventoryRarityMeta = PERK_RARITY_META[
    activeInventoryPerk
      ? resolvePerkRarity(activeInventoryPerk)
      : activeInventoryFx
        ? fallbackRarityFromCost(activeInventoryFx.item.cost)
        : "common"
  ];
  const inVideoView = Boolean(localState.activeRound);
  const controlsVisible = !inVideoView || videoUiVisible;
  const otherPlayersVisible = controlsVisible && !isOverlayOpen && (!inVideoView || isVideoHudHotzoneActive);
  const showVideoHotzoneHint = inVideoView
    && controlsVisible
    && !isOverlayOpen
    && !isLobbyControlOpen
    && !isVideoHudHotzoneActive;

  const hostControllablePlayers = useMemo(
    () => players.filter((player) => player.role !== "host" && player.state !== "kicked"),
    [players],
  );

  const handleKickPlayer = async (targetPlayerId: string) => {
    setPending(true);
    setError(null);
    try {
      await kickLobbyPlayer(search.lobbyId, targetPlayerId);
      await requestSnapshotRefresh();
    } catch (kickError) {
      setError(kickError instanceof Error ? kickError.message : "Failed to kick player.");
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
      setError(banError instanceof Error ? banError.message : "Failed to ban player.");
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
      setSnapshot((prev) => (
        prev
          ? {
            ...prev,
            lobby: {
              ...prev.lobby,
              isOpen: !prev.lobby.isOpen,
            },
          }
          : prev
      ));
      await requestSnapshotRefresh();
    } catch (openError) {
      setError(openError instanceof Error ? openError.message : "Failed to update lobby lock state.");
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
    <div className="relative min-h-screen bg-zinc-950 text-zinc-100">
      {error && (
        <div className="pointer-events-none fixed left-1/2 top-6 z-[120] -translate-x-1/2 rounded border border-rose-500/60 bg-rose-500/15 px-4 py-2 text-sm text-rose-100">
          {error}
        </div>
      )}

      {activeInventoryFx && (
        <div className="pointer-events-none fixed inset-0 z-[121]">
          <div className={`inventory-fly-item rounded-lg border bg-zinc-950/92 px-3 py-2 text-xs shadow-[0_0_24px_rgba(0,0,0,0.35)] ${activeInventoryRarityMeta.tailwind.inventorySelected}`}>
            <div className="flex items-center gap-2">
              <PerkIcon iconKey={activeInventoryPerk?.iconKey ?? "unknown"} className="h-4 w-4" />
              <span>Stored: {activeInventoryFx.item.name}</span>
              <span className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] ${activeInventoryRarityMeta.tailwind.badge}`}>
                {activeInventoryRarityMeta.label}
              </span>
            </div>
          </div>
        </div>
      )}

      <GameScene
        key={`${search.lobbyId}:${ownPlayerId}`}
        initialState={initialState}
        installedRounds={installedRounds}
        multiplayerRemotePlayers={remotePlayers}
        showMultiplayerPlayerNames
        optionsActions={isHost ? [{
          id: "toggle-lobby-lock",
          label: snapshot?.lobby.isOpen ? "Lock Lobby" : "Unlock Lobby",
          onClick: () => {
            void handleToggleLobbyOpen();
          },
          disabled: pending,
        }] : []}
        externalAntiPerkEvent={incomingAntiPerkEvent}
        externalInventoryAction={pendingInventoryAction}
        onExternalAntiPerkEventHandled={(eventId) => {
          setIncomingAntiPerkEvent((prev) => (prev?.eventId === eventId ? null : prev));
        }}
        onExternalInventoryActionHandled={(actionId) => {
          setPendingInventoryAction((prev) => (prev?.actionId === actionId ? null : prev));
        }}
        onStateChange={(nextState) => {
          setLocalState(nextState);
          scheduleSync();
        }}
        onGiveUp={() => {
          void (async () => {
            try {
              const player = localState.players[localState.currentPlayerIndex];
              const finalScore = Math.max(0, Math.floor(player?.score ?? 0));
              const finalPayload = {
                completionReason: "gave_up",
                finalScore,
                completedAtIso: new Date().toISOString(),
              };

              await finishPlayer(search.lobbyId, ownPlayerId, finalScore, {
                finalState: "forfeited",
                finalPayload,
              });
              await finalizeMatchIfComplete(search.lobbyId);
            } catch (giveUpError) {
              setError(giveUpError instanceof Error ? giveUpError.message : "Failed to give up.");
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
        onApplyPerkDirectlyChange={(value) => {
          setApplyPerkDirectly(value);
          void trpc.store.set.mutate({ key: MULTIPLAYER_APPLY_DIRECTLY_KEY, value }).catch(() => {
            // noop
          });
        }}
        onRoundOverlayUiVisibilityChange={setVideoUiVisible}
        intermediaryLoadingPrompt={intermediaryLoadingPrompt}
        intermediaryLoadingDurationSec={intermediaryLoadingDurationSec}
        intermediaryReturnPauseSec={intermediaryReturnPauseSec}
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
            otherPlayersVisible ? "translate-x-0 opacity-100" : "pointer-events-none -translate-x-2 opacity-0"
          } ${isNarrowViewport ? "bottom-20 left-2 right-2 max-h-[40vh]" : "left-4 top-16 w-[340px] max-h-[calc(100vh-5.5rem)]"}`}
        >
          <div className={`flex items-center justify-between border-b px-4 py-2.5 ${
            inVideoView
              ? "border-cyan-200/15 bg-[linear-gradient(180deg,rgba(10,30,56,0.46),rgba(7,18,38,0.42))]"
              : "border-cyan-300/20 bg-[linear-gradient(180deg,rgba(10,30,56,0.78),rgba(7,18,38,0.75))]"
          }`}>
            <div className="font-[family-name:var(--font-jetbrains-mono)] text-[11px] uppercase tracking-[0.22em] text-cyan-100">
              Other Players
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
                  Field {remote.positionIndex + 1}: {remote.boardFieldName}
                </div>

                <div className="mt-2 rounded-lg border border-cyan-300/20 bg-[#081b37]/78 px-2 py-1.5">
                  <div className="mb-1 flex items-center justify-between font-[family-name:var(--font-jetbrains-mono)] text-[10px] uppercase tracking-[0.09em] text-cyan-100/90">
                    <span>Board Progress</span>
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
                    <div className="font-[family-name:var(--font-jetbrains-mono)] text-[10px] uppercase tracking-[0.08em] text-sky-200">Score {remote.score}</div>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-[#0b213e]">
                      <div className="h-full rounded-full bg-[linear-gradient(90deg,#38bdf8,#7dd3fc)]" style={{ width: `${remote.scoreRatio * 100}%` }} />
                    </div>
                  </div>
                  <div className="rounded-lg border border-emerald-300/25 bg-[#081f31]/75 px-2 py-1.5">
                    <div className="font-[family-name:var(--font-jetbrains-mono)] text-[10px] uppercase tracking-[0.08em] text-emerald-200">$ {remote.money}</div>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-[#06322b]">
                      <div className="h-full rounded-full bg-[linear-gradient(90deg,#34d399,#6ee7b7)]" style={{ width: `${remote.moneyRatio * 100}%` }} />
                    </div>
                  </div>
                </div>

                <div className="mt-2 flex items-center justify-between font-[family-name:var(--font-jetbrains-mono)] text-[10px] uppercase tracking-[0.08em] text-zinc-300/95">
                  <span>Roll {remote.lastRoll ?? "-"}</span>
                  <span>Effects {remote.activeEffectsCount}</span>
                </div>

                <div className="mt-2 rounded-lg border border-cyan-300/20 bg-[#081a35]/78 px-2 py-1.5">
                  <div className="mb-1 font-[family-name:var(--font-jetbrains-mono)] text-[10px] uppercase tracking-[0.1em] text-cyan-100/90">
                    Items {remote.inventoryCount}
                  </div>
                  {remote.inventoryStacks.length === 0 ? (
                    <div className="text-zinc-400">None</div>
                  ) : (
                    <div className="flex flex-wrap gap-1">
                      {remote.inventoryStacks.slice(0, 6).map((stack) => {
                        const rarityMeta = PERK_RARITY_META[stack.rarity];
                        return (
                          <div key={`${remote.id}-${stack.perkId}`} className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 ${rarityMeta.tailwind.chip}`}>
                            <PerkIcon iconKey={stack.iconKey} className="h-3 w-3" />
                            <span className="max-w-[108px] truncate">{stack.name}</span>
                            <span className={`rounded border px-1 text-[9px] font-semibold uppercase tracking-[0.08em] ${rarityMeta.tailwind.badge}`}>
                              {rarityMeta.label}
                            </span>
                            {stack.count > 1 && <span className="text-zinc-100/90">x{stack.count}</span>}
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

      <button
        type="button"
        aria-label={isOverlayOpen ? "Close inventory controls" : "Open inventory controls"}
        title={isOverlayOpen ? "Close Inventory" : "Open Inventory"}
        className={`fixed left-4 z-[115] flex h-12 w-12 items-center justify-center rounded-full border backdrop-blur transition-all duration-200 ${
          inVideoView ? "bottom-24" : "bottom-4"
        } ${
          controlsVisible ? "opacity-100" : "pointer-events-none opacity-0"
        } ${inventoryBadgePulse ? "inventory-dock-pulse" : ""} ${
          isOverlayOpen
            ? "border-cyan-400/70 bg-cyan-500/20 text-cyan-100"
            : "border-zinc-600 bg-zinc-950/95 text-zinc-100 hover:border-zinc-400"
        }`}
        onClick={() => setIsOverlayOpen((prev) => !prev)}
      >
        <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" aria-hidden="true">
          <path d="M4 7h16M7 12h10M10 17h4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
        <span className="absolute -right-1 -top-1 min-w-5 rounded-full border border-cyan-200/65 bg-cyan-500/30 px-1 text-[10px] font-bold text-cyan-50">
          {inventoryCount}
        </span>
      </button>
      {isHost && (
        <button
          type="button"
          aria-label={isLobbyControlOpen ? "Close lobby control" : "Open lobby control"}
          title={isLobbyControlOpen ? "Close Lobby Control" : "Open Lobby Control"}
          className={`fixed left-20 z-[115] flex h-12 min-w-12 items-center justify-center rounded-full border px-3 text-xs font-semibold uppercase tracking-[0.08em] backdrop-blur transition-all duration-200 ${
            inVideoView ? "bottom-24" : "bottom-4"
          } ${
            controlsVisible ? "opacity-100" : "pointer-events-none opacity-0"
          } ${
            isLobbyControlOpen
              ? "border-amber-300/80 bg-amber-500/20 text-amber-100"
              : "border-zinc-600 bg-zinc-950/95 text-zinc-100 hover:border-zinc-400"
          }`}
          onClick={() => setIsLobbyControlOpen((prev) => !prev)}
        >
          Host
        </button>
      )}

      {isOverlayOpen && (
        <aside className={`fixed z-[110] space-y-3 overflow-y-auto transition-opacity duration-200 ${
          controlsVisible ? "opacity-100" : "pointer-events-none opacity-0"
        } ${isNarrowViewport
            ? `${inVideoView ? "bottom-40" : "bottom-20"} left-2 right-2 max-h-[52vh]`
            : `${inVideoView ? "bottom-40" : "bottom-20"} left-4 w-[380px] max-h-[calc(100vh-7rem)]`}`}>
          <div className="rounded-xl border border-cyan-500/35 bg-zinc-950/90 p-3 backdrop-blur">
            <div className="mb-2 flex items-center justify-between text-[11px] uppercase tracking-[0.16em] text-cyan-200">
              <span>Item Inventory</span>
              <span>{applyDirectlyLabel}</span>
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs text-zinc-300">
              <div>Players: {players.length}</div>
              <div>Lobby: {search.lobbyId.slice(0, 8)}</div>
              <div>Phase: {localState.sessionPhase}</div>
              <div>Turn: {localState.turn}</div>
            </div>

            <div className="mt-3 space-y-2">
              {inventoryStacks.length === 0 && (
                <div className="rounded border border-zinc-800 bg-zinc-900/65 p-2 text-xs text-zinc-400">No stored items yet.</div>
              )}
              {inventoryStacks.map((stack) => {
                const selected = selectedInventoryItemId !== null && stack.itemIds.includes(selectedInventoryItemId);
                const rarityMeta = PERK_RARITY_META[stack.rarity];
                return (
                  <button
                    key={`${stack.item.perkId}-${stack.itemIds[0]}`}
                    type="button"
                    onClick={() => setSelectedInventoryItemId(stack.itemIds[0] ?? null)}
                    className={`inventory-card-tilt w-full rounded border px-3 py-2 text-left text-sm transition-colors ${selected ? rarityMeta.tailwind.inventorySelected : rarityMeta.tailwind.inventoryIdle}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <PerkIcon iconKey={stack.iconKey} className="h-4 w-4" />
                        <span className="font-semibold text-zinc-100">{stack.displayName}</span>
                        <span className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] ${rarityMeta.tailwind.badge}`}>
                          {rarityMeta.label}
                        </span>
                      </div>
                      <span className="rounded border border-zinc-600/70 bg-zinc-800/80 px-1.5 text-[11px] text-zinc-200">x{stack.count}</span>
                    </div>
                    <div className="mt-1 text-xs text-zinc-300">{stack.item.kind === "perk" ? "Applies to self" : "Targets another player"}</div>
                  </button>
                );
              })}
            </div>

            <div className="mt-3 rounded border border-zinc-700/80 bg-zinc-900/55 p-2">
              {selectedInventoryItem ? (
                <>
                  <div className="mb-2 flex items-center gap-2 text-sm text-zinc-100">
                    <PerkIcon iconKey={selectedItemIconKey} className="h-4 w-4" />
                    <span>{selectedPerkDefinition?.name ?? selectedInventoryItem.name}</span>
                    <span className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] ${selectedItemRarityMeta.tailwind.badge}`}>
                      {selectedItemRarityMeta.label}
                    </span>
                  </div>

                  {selectedInventoryItem.kind === "antiPerk" ? (
                    <div className="space-y-2">
                      <div className="text-[10px] uppercase tracking-[0.14em] text-zinc-400">Target Player</div>
                      <div className="grid grid-cols-1 gap-1">
                        {targetPlayers.map((target) => (
                          <button
                            key={target.id}
                            type="button"
                            onClick={() => setSelectedTargetId(target.id)}
                            className={`rounded border px-2 py-1 text-left text-xs ${selectedTargetId === target.id ? "border-cyan-300/80 bg-cyan-500/20 text-cyan-100" : "border-zinc-700 bg-zinc-900/75 text-zinc-200 hover:border-zinc-500"}`}
                          >
                            {target.displayName}
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="text-xs text-zinc-300">This perk will be applied to your current run.</div>
                  )}

                  <button
                    type="button"
                    disabled={pending || (selectedInventoryItem.kind === "antiPerk" && !selectedTargetId)}
                    className="mt-3 w-full rounded border border-cyan-500/65 bg-cyan-500/15 px-3 py-2 text-sm font-semibold text-cyan-100 disabled:opacity-55"
                    onClick={() => {
                      void handleUseInventoryItem();
                    }}
                  >
                    {selectedInventoryItem.kind === "antiPerk" ? "Send Anti-Perk" : "Apply Perk"}
                  </button>
                </>
              ) : (
                <div className="text-xs text-zinc-400">Select an item to use it.</div>
              )}
            </div>
          </div>

          <div className="rounded-xl border border-zinc-700/80 bg-zinc-950/88 p-3 backdrop-blur">
            <div className="mb-2 text-[11px] uppercase tracking-[0.16em] text-zinc-300">Player Standings</div>
            <div className={`space-y-2 overflow-auto pr-1 text-xs ${isNarrowViewport ? "max-h-40" : "max-h-56"}`}>
              {players.map((player) => {
                const progress = snapshot?.progressByPlayerId[player.id];
                return (
                  <div key={player.id} className="rounded border border-zinc-800 bg-zinc-900/65 p-2">
                    <div className="font-semibold text-zinc-100">{player.displayName}</div>
                    <div className="mt-1 text-zinc-300">
                      {player.state} | Pos {progress?.positionIndex ?? 0} | $ {progress?.money ?? 0} | Score {progress?.score ?? player.finalScore ?? 0}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="rounded-xl border border-zinc-700/80 bg-zinc-950/88 p-3 backdrop-blur">
            <div className="mb-2 text-[11px] uppercase tracking-[0.16em] text-zinc-300">Anti-Perk Feed</div>
            <div className={`space-y-2 overflow-auto pr-1 text-xs ${isNarrowViewport ? "max-h-28" : "max-h-44"}`}>
              {antiPerkFeed.map((event) => {
                const perk = getPerkById(event.perkId);
                const rarityMeta = PERK_RARITY_META[perk ? resolvePerkRarity(perk) : "common"];
                return (
                  <div key={event.id} className={`rounded border p-2 ${rarityMeta.tailwind.feed}`}>
                    <div className="flex items-center gap-2 font-semibold text-zinc-100">
                      <PerkIcon iconKey={perk?.iconKey ?? "unknown"} className="h-4 w-4" />
                      <span>{perk?.name ?? event.perkId}</span>
                      <span className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] ${rarityMeta.tailwind.badge}`}>
                        {rarityMeta.label}
                      </span>
                    </div>
                    <div className="text-zinc-300">{event.senderPlayerId.slice(0, 6)} {"->"} {event.targetPlayerId.slice(0, 6)}</div>
                  </div>
                );
              })}
            </div>
          </div>
        </aside>
      )}
      {isHost && isLobbyControlOpen && (
        <aside className={`fixed z-[112] overflow-y-auto rounded-xl border border-amber-400/40 bg-zinc-950/92 p-3 backdrop-blur ${
          controlsVisible ? "opacity-100" : "pointer-events-none opacity-0"
        } ${isNarrowViewport
            ? `${inVideoView ? "bottom-40" : "bottom-20"} left-2 right-2 max-h-[40vh]`
            : `${inVideoView ? "bottom-40" : "bottom-20"} left-[412px] w-[380px] max-h-[calc(100vh-7rem)]`}`}
        >
          <div className="mb-2 flex items-center justify-between text-[11px] uppercase tracking-[0.16em] text-amber-200">
            <span>Lobby Control</span>
            <span>{hostControllablePlayers.length}</span>
          </div>
          <div className="space-y-2 text-xs">
            {hostControllablePlayers.length === 0 && (
              <div className="rounded border border-zinc-800 bg-zinc-900/70 px-3 py-2 text-zinc-400">
                No players available for moderation.
              </div>
            )}
            {hostControllablePlayers.map((player) => {
              const progress = snapshot?.progressByPlayerId[player.id];
              return (
                <div key={`lobby-control-${player.id}`} className="rounded border border-zinc-700 bg-zinc-900/75 px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <div className="font-semibold text-zinc-100">{player.displayName}</div>
                      <div className="text-zinc-400">
                        {player.state} | Pos {progress?.positionIndex ?? 0} | Score {progress?.score ?? player.finalScore ?? 0}
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
                        Kick
                      </button>
                      <button
                        type="button"
                        disabled={pending}
                        className="rounded border border-rose-500/70 bg-rose-500/15 px-2 py-1 text-rose-100 hover:bg-rose-500/25 disabled:opacity-60"
                        onClick={() => {
                          void handleBanPlayer(player.id);
                        }}
                      >
                        Ban
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
  );
}
