import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { z } from "zod";
import { GameScene } from "../components/game/GameScene";
import { BlockCommandPalette } from "../contexts/CommandPaletteGuardContext";
import {
  clearMapEditorTestSession,
  getMapEditorTestPlaylistId,
  setMapEditorTestSession,
} from "../features/map-editor/testSession";
import { createInitialGameState } from "../game/engine";
import { filterPerkIdsByHandyConnection } from "../game/data/perks";
import { toGameConfigFromPlaylist } from "../game/playlistRuntime";
import { ZSinglePlayerRunSaveSnapshot, type SinglePlayerRunSaveSnapshot } from "../game/saveSchema";
import type { GameConfig, GameState } from "../game/types";
import { shouldClearSinglePlayerSaveOnCompletion } from "./gameSavePolicy";
import { isAssistedSaveMode } from "../game/saveMode";
import {
  ANTI_PERK_BEATBAR_ENABLED_KEY,
  DEFAULT_ANTI_PERK_BEATBAR_ENABLED,
  DEFAULT_ROUND_PROGRESS_BAR_ALWAYS_VISIBLE,
  ROUND_PROGRESS_BAR_ALWAYS_VISIBLE_KEY,
  normalizeAntiPerkBeatbarEnabled,
  normalizeRoundProgressBarAlwaysVisible,
} from "../constants/roundVideoOverlaySettings";
import { db, type InstalledRound } from "../services/db";
import { playlists } from "../services/playlists";
import { trpc } from "../services/trpc";
import { isGameDevelopmentMode } from "../utils/devFeatures";
import {
  CHEAT_MODE_ENABLED_KEY,
  DEFAULT_CHEAT_MODE_ENABLED,
  normalizeCheatModeEnabled,
} from "../constants/experimentalFeatures";
import { DEFAULT_INTERMEDIARY_LOADING_PROMPT } from "../constants/booruSettings";
import { useHandy } from "../contexts/HandyContext";

const INTERMEDIARY_LOADING_PROMPT_KEY = "game.intermediary.loadingPrompt";
const INTERMEDIARY_LOADING_DURATION_KEY = "game.intermediary.loadingDurationSec";
const INTERMEDIARY_RETURN_PAUSE_KEY = "game.intermediary.returnPauseSec";
const APPLY_PERK_DIRECTLY_KEY = "game.singleplayer.applyPerkDirectly";
const DEFAULT_INTERMEDIARY_LOADING_DURATION_SEC = 5;
const DEFAULT_INTERMEDIARY_RETURN_PAUSE_SEC = 4;
const DEFAULT_APPLY_PERK_DIRECTLY = true;
const ECONOMY_STORE_KEYS = {
  moneyPerCompletedRound: "game.economy.moneyPerCompletedRound",
  startingScore: "game.economy.startingScore",
  scorePerCompletedRound: "game.economy.scorePerCompletedRound",
  scorePerIntermediary: "game.economy.scorePerIntermediary",
  scorePerActiveAntiPerk: "game.economy.scorePerActiveAntiPerk",
} as const;

const GameSearchSchema = z.object({
  playlistId: z.string().min(1).optional(),
  launchNonce: z.coerce.number().int().nonnegative().optional(),
  resume: z.coerce.boolean().optional(),
});

const getInitialHighscore = async (): Promise<{
  highscore: number;
  highscoreCheatMode: boolean;
  highscoreAssisted: boolean;
  highscoreAssistedSaveMode: "checkpoint" | "everywhere" | null;
}> => {
  try {
    const result = await db.gameProfile.getLocalHighscore();
    return {
      highscore: Math.max(0, Math.floor(result.highscore)),
      highscoreCheatMode: result.highscoreCheatMode ?? false,
      highscoreAssisted: result.highscoreAssisted ?? false,
      highscoreAssistedSaveMode: result.highscoreAssistedSaveMode ?? null,
    };
  } catch (error) {
    console.warn("Failed to read highscore from DB", error);
    return {
      highscore: 0,
      highscoreCheatMode: false,
      highscoreAssisted: false,
      highscoreAssistedSaveMode: null,
    };
  }
};

const toSafeNumber = (value: unknown): number | undefined => {
  const num = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(num)) return undefined;
  return Math.max(0, Math.floor(num));
};

const getEconomyOverrides = async (): Promise<Partial<GameConfig["economy"]>> => {
  try {
    const entries = await Promise.all(
      Object.entries(ECONOMY_STORE_KEYS).map(async ([name, key]) => {
        const value = await trpc.store.get.query({ key });
        return [name, toSafeNumber(value)] as const;
      })
    );

    return entries.reduce<Partial<GameConfig["economy"]>>((acc, [name, value]) => {
      if (typeof value === "number") {
        acc[name as keyof GameConfig["economy"]] = value;
      }
      return acc;
    }, {});
  } catch (error) {
    console.warn("Failed to read economy overrides from store", error);
    return {};
  }
};

const getInstalledRounds = async (): Promise<InstalledRound[]> => {
  try {
    return await db.round.findInstalled();
  } catch (error) {
    console.error("Failed to fetch installed rounds for game board", error);
    return [];
  }
};

const getIntermediaryLoadingPrompt = async (): Promise<string> => {
  try {
    const stored = await trpc.store.get.query({ key: INTERMEDIARY_LOADING_PROMPT_KEY });
    if (typeof stored !== "string") return DEFAULT_INTERMEDIARY_LOADING_PROMPT;
    const trimmed = stored.trim();
    return trimmed.length > 0 ? trimmed : DEFAULT_INTERMEDIARY_LOADING_PROMPT;
  } catch (error) {
    console.warn("Failed to read intermediary loading prompt from store", error);
    return DEFAULT_INTERMEDIARY_LOADING_PROMPT;
  }
};

const getIntermediaryLoadingDurationSec = async (): Promise<number> => {
  try {
    const stored = await trpc.store.get.query({ key: INTERMEDIARY_LOADING_DURATION_KEY });
    const parsed = typeof stored === "number" ? stored : Number(stored);
    if (!Number.isFinite(parsed)) return DEFAULT_INTERMEDIARY_LOADING_DURATION_SEC;
    return Math.max(1, Math.min(60, Math.floor(parsed)));
  } catch (error) {
    console.warn("Failed to read intermediary loading duration from store", error);
    return DEFAULT_INTERMEDIARY_LOADING_DURATION_SEC;
  }
};

const getIntermediaryReturnPauseSec = async (): Promise<number> => {
  try {
    const stored = await trpc.store.get.query({ key: INTERMEDIARY_RETURN_PAUSE_KEY });
    const parsed = typeof stored === "number" ? stored : Number(stored);
    if (!Number.isFinite(parsed)) return DEFAULT_INTERMEDIARY_RETURN_PAUSE_SEC;
    return Math.max(0, Math.min(60, Math.floor(parsed)));
  } catch (error) {
    console.warn("Failed to read intermediary return pause from store", error);
    return DEFAULT_INTERMEDIARY_RETURN_PAUSE_SEC;
  }
};

const getRoundProgressBarAlwaysVisible = async (): Promise<boolean> => {
  try {
    const stored = await trpc.store.get.query({ key: ROUND_PROGRESS_BAR_ALWAYS_VISIBLE_KEY });
    return normalizeRoundProgressBarAlwaysVisible(stored);
  } catch (error) {
    console.warn("Failed to read round progress bar visibility from store", error);
    return DEFAULT_ROUND_PROGRESS_BAR_ALWAYS_VISIBLE;
  }
};

const getAntiPerkBeatbarEnabled = async (): Promise<boolean> => {
  try {
    const stored = await trpc.store.get.query({ key: ANTI_PERK_BEATBAR_ENABLED_KEY });
    return normalizeAntiPerkBeatbarEnabled(stored);
  } catch (error) {
    console.warn("Failed to read anti-perk beatbar visibility from store", error);
    return DEFAULT_ANTI_PERK_BEATBAR_ENABLED;
  }
};

const getCheatModeEnabled = async (): Promise<boolean> => {
  try {
    const stored = await trpc.store.get.query({ key: CHEAT_MODE_ENABLED_KEY });
    return normalizeCheatModeEnabled(stored);
  } catch (error) {
    console.warn("Failed to read cheat mode from store", error);
    return DEFAULT_CHEAT_MODE_ENABLED;
  }
};

const getApplyPerkDirectly = async (): Promise<boolean> => {
  try {
    const stored = await trpc.store.get.query({ key: APPLY_PERK_DIRECTLY_KEY });
    if (stored === true || stored === "true") return true;
    if (stored === false || stored === "false") return false;
    return DEFAULT_APPLY_PERK_DIRECTLY;
  } catch (error) {
    console.warn("Failed to read apply perk directly from store", error);
    return DEFAULT_APPLY_PERK_DIRECTLY;
  }
};

function getCheckpointNodeId(state: GameState): string | null {
  const player = state.players[state.currentPlayerIndex];
  if (!player) return null;
  const field = state.config.board.find((entry) => entry.id === player.currentNodeId);
  return field?.kind === "safePoint" ? field.id : null;
}

function shouldAutosaveOnStateChange(
  previousState: GameState | null,
  nextState: GameState,
  saveMode: "none" | "checkpoint" | "everywhere"
): string | null {
  if (saveMode === "none") return null;
  if (nextState.sessionPhase === "completed") return null;
  const checkpointNodeId = getCheckpointNodeId(nextState);
  if (!checkpointNodeId) return null;
  if (!previousState) return null;

  const previousCheckpointNodeId = getCheckpointNodeId(previousState);
  const playerChangedNode =
    previousState.players[previousState.currentPlayerIndex]?.currentNodeId !==
    nextState.players[nextState.currentPlayerIndex]?.currentNodeId;
  const turnChanged = previousState.turn !== nextState.turn;
  const playerIndexChanged = previousState.currentPlayerIndex !== nextState.currentPlayerIndex;

  if (
    previousCheckpointNodeId === checkpointNodeId &&
    !playerChangedNode &&
    !turnChanged &&
    !playerIndexChanged
  ) {
    return null;
  }

  return checkpointNodeId;
}

export const Route = createFileRoute("/game")({
  validateSearch: (search) => GameSearchSchema.parse(search),
  loaderDeps: ({ search }) => ({
    playlistId: search.playlistId ?? null,
    launchNonce: search.launchNonce ?? null,
    resume: search.resume ?? false,
  }),
  loader: async ({ deps }) => {
    const [
      installedRounds,
      initialHighscoreResult,
      economyOverrides,
      intermediaryLoadingPrompt,
      intermediaryLoadingDurationSec,
      intermediaryReturnPauseSec,
      roundProgressBarAlwaysVisible,
      antiPerkBeatbarEnabled,
      cheatModeEnabled,
      initialApplyPerkDirectly,
      activePlaylist,
    ] = await Promise.all([
      getInstalledRounds(),
      getInitialHighscore(),
      getEconomyOverrides(),
      getIntermediaryLoadingPrompt(),
      getIntermediaryLoadingDurationSec(),
      getIntermediaryReturnPauseSec(),
      getRoundProgressBarAlwaysVisible(),
      getAntiPerkBeatbarEnabled(),
      getCheatModeEnabled(),
      getApplyPerkDirectly(),
      deps.playlistId ? playlists.getById(deps.playlistId) : playlists.getActive(),
    ]);

    if (!activePlaylist) {
      throw new Error("No playlist available.");
    }

    const playedByPool = await playlists.getDistinctPlayedByPool(activePlaylist.id);
    let savedSnapshot: SinglePlayerRunSaveSnapshot | null = null;
    let resumeRedirectNotice: string | null = null;

    if (deps.resume && deps.playlistId) {
      const savedRun = await db.singlePlayerSaves.getByPlaylist(deps.playlistId).catch(() => null);
      if (!savedRun) {
        resumeRedirectNotice = "Saved run could not be resumed and was cleared.";
      } else {
        try {
          const parsedSnapshot = ZSinglePlayerRunSaveSnapshot.parse(
            typeof savedRun.snapshotJson === "string"
              ? JSON.parse(savedRun.snapshotJson)
              : savedRun.snapshotJson
          );
          if (parsedSnapshot.playlistId !== activePlaylist.id) {
            throw new Error("Saved run playlist mismatch.");
          }
          savedSnapshot = parsedSnapshot;
        } catch (error) {
          console.warn("Failed to validate saved single-player run", error);
          await db.singlePlayerSaves.deleteByPlaylist(deps.playlistId).catch(() => undefined);
          resumeRedirectNotice = "Saved run could not be resumed and was cleared.";
        }
      }
    }

    return {
      installedRounds,
      initialHighscore: initialHighscoreResult.highscore,
      initialHighscoreCheatMode: initialHighscoreResult.highscoreCheatMode,
      initialHighscoreAssisted: initialHighscoreResult.highscoreAssisted,
      initialHighscoreAssistedSaveMode: initialHighscoreResult.highscoreAssistedSaveMode,
      economyOverrides,
      intermediaryLoadingPrompt,
      intermediaryLoadingDurationSec,
      intermediaryReturnPauseSec,
      roundProgressBarAlwaysVisible,
      antiPerkBeatbarEnabled,
      cheatModeEnabled,
      initialApplyPerkDirectly,
      activePlaylist,
      playedByPool,
      savedSnapshot,
      resumeRequested: deps.resume,
      resumeRedirectNotice,
    };
  },
  component: GameRoute,
});

function GameRoute() {
  const {
    installedRounds,
    initialHighscore,
    economyOverrides,
    intermediaryLoadingPrompt,
    intermediaryLoadingDurationSec,
    intermediaryReturnPauseSec,
    roundProgressBarAlwaysVisible,
    antiPerkBeatbarEnabled,
    cheatModeEnabled,
    initialApplyPerkDirectly,
    activePlaylist,
    playedByPool,
    savedSnapshot,
    resumeRequested,
    resumeRedirectNotice,
  } = Route.useLoaderData();
  const navigate = useNavigate();
  const hasNavigatedToResultRef = useRef(false);
  const sessionStartedAtMsRef = useRef(savedSnapshot?.sessionStartedAtMs ?? Date.now());
  const mapEditorTestPlaylistIdRef = useRef<string | null>(getMapEditorTestPlaylistId());
  const isMapEditorTestRun = mapEditorTestPlaylistIdRef.current !== null;
  const [applyPerkDirectly, setApplyPerkDirectly] = useState(initialApplyPerkDirectly);
  const [saveNotification, setSaveNotification] = useState<{ nonce: number; message: string } | null>(null);
  const { connected: handyConnected } = useHandy();

  const currentPlaylistSaveMode = activePlaylist.config.saveMode;
  const scoringSaveMode = savedSnapshot?.saveMode ?? (currentPlaylistSaveMode === "none" ? null : currentPlaylistSaveMode);
  const effectiveCheatMode = cheatModeEnabled;
  const effectiveAssisted = Boolean(scoringSaveMode) && isAssistedSaveMode(scoringSaveMode);
  const effectiveAssistedSaveMode = scoringSaveMode;
  const canPersistSinglePlayerSave = !isMapEditorTestRun && currentPlaylistSaveMode !== "none";

  const config = useMemo(() => {
    const baseConfig = toGameConfigFromPlaylist(activePlaylist.config, installedRounds);
    return {
      ...baseConfig,
      economy: {
        ...baseConfig.economy,
        ...economyOverrides,
      },
      perkPool: {
        enabledPerkIds: filterPerkIdsByHandyConnection(
          baseConfig.perkPool.enabledPerkIds,
          handyConnected
        ),
        enabledAntiPerkIds: filterPerkIdsByHandyConnection(
          baseConfig.perkPool.enabledAntiPerkIds,
          handyConnected
        ),
      },
    };
  }, [activePlaylist.config, economyOverrides, handyConnected, installedRounds]);

  const initialState = useMemo(
    () =>
      savedSnapshot?.gameState ??
      createInitialGameState(config, { initialHighscore, playedRoundIdsByPool: playedByPool }),
    [config, initialHighscore, playedByPool, savedSnapshot]
  );

  const [latestState, setLatestState] = useState<GameState>(initialState);
  const latestStateRef = useRef<GameState>(initialState);
  const previousStateRef = useRef<GameState | null>(initialState);
  const lastAutosaveKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!resumeRequested || !resumeRedirectNotice) return;
    void navigate({
      to: "/single-player-setup",
      search: { notice: resumeRedirectNotice },
      replace: true,
    });
  }, [navigate, resumeRedirectNotice, resumeRequested]);

  const clearRunSnapshot = useCallback(async () => {
    if (isMapEditorTestRun) return;
    await db.singlePlayerSaves.deleteByPlaylist(activePlaylist.id);
  }, [activePlaylist.id, isMapEditorTestRun]);

  const persistRunSnapshot = useCallback(
    async (state: GameState) => {
      if (!canPersistSinglePlayerSave || !effectiveAssistedSaveMode) return false;
      const snapshot = ZSinglePlayerRunSaveSnapshot.parse({
        version: 1,
        playlistId: activePlaylist.id,
        playlistFormatVersion: activePlaylist.formatVersion ?? null,
        playlistConfig: activePlaylist.config,
        saveMode: currentPlaylistSaveMode,
        gameState: state,
        sessionStartedAtMs: sessionStartedAtMsRef.current,
        savedAtMs: Date.now(),
      });
      await db.singlePlayerSaves.upsert({
        playlistId: activePlaylist.id,
        playlistName: activePlaylist.name,
        playlistFormatVersion: activePlaylist.formatVersion,
        saveMode: currentPlaylistSaveMode,
        snapshot,
      });
      return true;
    },
    [
      activePlaylist.config,
      activePlaylist.formatVersion,
      activePlaylist.id,
      activePlaylist.name,
      canPersistSinglePlayerSave,
      currentPlaylistSaveMode,
    ]
  );

  const showSaveNotification = useCallback((message: string) => {
    setSaveNotification({ nonce: Date.now(), message });
  }, []);

  const handleHighscoreChange = useCallback(
    (highscore: number) => {
      void db.gameProfile
        .setLocalHighscore(Math.max(0, Math.floor(highscore)), {
          cheatMode: effectiveCheatMode,
          assisted: effectiveAssisted,
          assistedSaveMode: effectiveAssistedSaveMode,
        })
        .catch((error) => {
          console.warn("Failed to persist highscore to DB", error);
        });
    },
    [effectiveAssisted, effectiveAssistedSaveMode, effectiveCheatMode]
  );

  const handleBack = useMemo(
    () => () => {
      if (mapEditorTestPlaylistIdRef.current) {
        setMapEditorTestSession(mapEditorTestPlaylistIdRef.current);
        void navigate({ to: "/map-editor" });
        return;
      }
      void navigate({ to: "/" });
    },
    [clearRunSnapshot, navigate]
  );

  const handleRoundPlayed = useCallback(
    (payload: { roundId: string; nodeId: string; poolId: string | null }) => {
      void playlists
        .recordRoundPlay({
          playlistId: activePlaylist.id,
          roundId: payload.roundId,
          nodeId: payload.nodeId,
          poolId: payload.poolId,
        })
        .catch((error) => {
          console.warn("Failed to record played round", error);
        });
    },
    [activePlaylist.id]
  );

  const handleStateChange = useCallback(
    (nextState: GameState) => {
      const previousState = previousStateRef.current;
      previousStateRef.current = nextState;
      latestStateRef.current = nextState;
      setLatestState(nextState);

      const checkpointNodeId = shouldAutosaveOnStateChange(
        previousState,
        nextState,
        currentPlaylistSaveMode
      );
      if (checkpointNodeId) {
        const autosaveKey = `${nextState.turn}:${nextState.currentPlayerIndex}:${checkpointNodeId}`;
        if (lastAutosaveKeyRef.current !== autosaveKey) {
          lastAutosaveKeyRef.current = autosaveKey;
          void persistRunSnapshot(nextState)
            .then((saved) => {
              if (saved) showSaveNotification("Checkpoint reached. Game saved.");
            })
            .catch((error) => {
              console.warn("Failed to autosave single-player run", error);
            });
        }
      }

      if (hasNavigatedToResultRef.current) return;
      if (nextState.sessionPhase !== "completed") return;

      const player = nextState.players[nextState.currentPlayerIndex];
      if (!player) return;
      hasNavigatedToResultRef.current = true;

      const score = Math.max(0, Math.floor(player.score));
      const survivedDurationSec = Math.max(
        0,
        Math.floor((Date.now() - sessionStartedAtMsRef.current) / 1000)
      );
      const highscoreBefore = Math.max(0, Math.floor(initialHighscore));
      const highscoreAfter = Math.max(0, Math.floor(nextState.highscore));

      if (shouldClearSinglePlayerSaveOnCompletion(nextState.completionReason ?? null)) {
        void clearRunSnapshot().catch((error) => {
          console.warn("Failed to clear single-player save after completion", error);
        });
      }

      void db.singlePlayerHistory
        .recordRun({
          finishedAtIso: new Date().toISOString(),
          score,
          survivedDurationSec,
          highscoreBefore,
          highscoreAfter,
          wasNewHighscore: score > highscoreBefore,
          completionReason: nextState.completionReason ?? "finished",
          playlistId: activePlaylist.id,
          playlistName: activePlaylist.name,
          playlistFormatVersion: activePlaylist.formatVersion,
          endingPosition: Math.max(0, Math.floor(player.position)),
          turn: Math.max(0, Math.floor(nextState.turn)),
          cheatModeActive: effectiveCheatMode,
          assistedActive: effectiveAssisted,
          assistedSaveMode: effectiveAssistedSaveMode,
        })
        .catch((error) => {
          console.warn("Failed to persist single-player run history", error);
        });

      if (isMapEditorTestRun) {
        clearMapEditorTestSession();
      }

      void navigate({
        to: "/single-result",
        search: {
          score,
          highscore: highscoreAfter,
          survivedDurationSec,
          reason: nextState.completionReason ?? "finished",
          cheatMode: effectiveCheatMode,
          assisted: effectiveAssisted,
          assistedSaveMode: effectiveAssistedSaveMode ?? undefined,
        },
        replace: true,
      });
    },
    [
      activePlaylist.config.saveMode,
      activePlaylist.formatVersion,
      activePlaylist.id,
      activePlaylist.name,
      clearRunSnapshot,
      effectiveAssisted,
      effectiveAssistedSaveMode,
      effectiveCheatMode,
      initialHighscore,
      isMapEditorTestRun,
      navigate,
      currentPlaylistSaveMode,
      persistRunSnapshot,
      showSaveNotification,
    ]
  );

  const handleApplyPerkDirectlyChange = useCallback((value: boolean) => {
    setApplyPerkDirectly(value);
    void trpc.store.set.mutate({ key: APPLY_PERK_DIRECTLY_KEY, value }).catch((error) => {
      console.warn("Failed to persist apply perk directly preference", error);
    });
  }, []);

  const optionsActions = useMemo(() => {
    if (!canPersistSinglePlayerSave || currentPlaylistSaveMode !== "everywhere") return [];
    return [
      {
        id: "save-game",
        label: "Save Game",
        disabled: Boolean(latestState.activeRound),
        tone: "default" as const,
        onClick: () => {
          void persistRunSnapshot(latestStateRef.current)
            .then((saved) => {
              if (saved) showSaveNotification("Game saved.");
            })
            .catch((error) => {
              console.warn("Failed to manually save single-player run", error);
            });
        },
      },
    ];
  }, [
    canPersistSinglePlayerSave,
    currentPlaylistSaveMode,
    latestState.activeRound,
    persistRunSnapshot,
    showSaveNotification,
  ]);

  if (resumeRequested && resumeRedirectNotice) {
    return null;
  }

  return (
    <BlockCommandPalette>
      <GameScene
        initialState={initialState}
        sessionStartedAtMs={sessionStartedAtMsRef.current}
        installedRounds={installedRounds}
        onGiveUp={handleBack}
        giveUpLabel={isMapEditorTestRun ? "Back to Editor" : "Give Up"}
        optionsActions={optionsActions}
        allowDebugRoundControls={isMapEditorTestRun || cheatModeEnabled}
        showDevPerkMenu={isGameDevelopmentMode() || cheatModeEnabled}
        onHighscoreChange={handleHighscoreChange}
        onRoundPlayed={handleRoundPlayed}
        onStateChange={handleStateChange}
        externalNotification={saveNotification}
        intermediaryLoadingPrompt={intermediaryLoadingPrompt}
        intermediaryLoadingDurationSec={intermediaryLoadingDurationSec}
        intermediaryReturnPauseSec={intermediaryReturnPauseSec}
        initialShowProgressBarAlways={roundProgressBarAlwaysVisible}
        initialShowAntiPerkBeatbar={antiPerkBeatbarEnabled}
        applyPerkDirectly={applyPerkDirectly}
        onApplyPerkDirectlyChange={handleApplyPerkDirectlyChange}
      />
    </BlockCommandPalette>
  );
}
