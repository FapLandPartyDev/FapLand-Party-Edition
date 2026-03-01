import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useMemo, useRef } from "react";
import { GameScene } from "../components/game/GameScene";
import { clearMapEditorTestSession, getMapEditorTestPlaylistId, setMapEditorTestSession } from "../features/map-editor/testSession";
import { createInitialGameState } from "../game/engine";
import type { GameConfig, GameState } from "../game/types";
import { toGameConfigFromPlaylist } from "../game/playlistRuntime";
import { db, type InstalledRound } from "../services/db";
import { playlists } from "../services/playlists";
import { trpc } from "../services/trpc";

const INTERMEDIARY_LOADING_PROMPT_KEY = "game.intermediary.loadingPrompt";
const INTERMEDIARY_LOADING_DURATION_KEY = "game.intermediary.loadingDurationSec";
const INTERMEDIARY_RETURN_PAUSE_KEY = "game.intermediary.returnPauseSec";
const DEFAULT_INTERMEDIARY_LOADING_PROMPT = "animated gif webm";
const DEFAULT_INTERMEDIARY_LOADING_DURATION_SEC = 10;
const DEFAULT_INTERMEDIARY_RETURN_PAUSE_SEC = 4;
const ECONOMY_STORE_KEYS = {
  startingMoney: "game.economy.startingMoney",
  moneyPerCompletedRound: "game.economy.moneyPerCompletedRound",
  startingScore: "game.economy.startingScore",
  scorePerCompletedRound: "game.economy.scorePerCompletedRound",
  scorePerIntermediary: "game.economy.scorePerIntermediary",
  scorePerActiveAntiPerk: "game.economy.scorePerActiveAntiPerk",
} as const;

const getInitialHighscore = async (): Promise<number> => {
  try {
    const highscore = await db.gameProfile.getLocalHighscore();
    return Math.max(0, Math.floor(highscore));
  } catch (error) {
    console.warn("Failed to read highscore from DB", error);
    return 0;
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
      }),
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

export const Route = createFileRoute("/game")({
  loader: async () => {
    const [installedRounds, initialHighscore, economyOverrides, intermediaryLoadingPrompt, intermediaryLoadingDurationSec, intermediaryReturnPauseSec, activePlaylist] = await Promise.all([
      getInstalledRounds(),
      getInitialHighscore(),
      getEconomyOverrides(),
      getIntermediaryLoadingPrompt(),
      getIntermediaryLoadingDurationSec(),
      getIntermediaryReturnPauseSec(),
      playlists.getActive(),
    ]);
    const playedByPool = await playlists.getDistinctPlayedByPool(activePlaylist.id);
    return {
      installedRounds,
      initialHighscore,
      economyOverrides,
      intermediaryLoadingPrompt,
      intermediaryLoadingDurationSec,
      intermediaryReturnPauseSec,
      activePlaylist,
      playedByPool,
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
    activePlaylist,
    playedByPool,
  } = Route.useLoaderData();
  const navigate = useNavigate();
  const hasNavigatedToResultRef = useRef(false);
  const mapEditorTestPlaylistIdRef = useRef<string | null>(getMapEditorTestPlaylistId());
  const isMapEditorTestRun = mapEditorTestPlaylistIdRef.current !== null;

  const config = useMemo(() => {
    const baseConfig = toGameConfigFromPlaylist(activePlaylist.config, installedRounds);
    return {
      ...baseConfig,
      economy: {
        ...baseConfig.economy,
        ...economyOverrides,
      },
    };
  }, [activePlaylist.config, economyOverrides, installedRounds]);
  const initialState = useMemo(
    () => createInitialGameState(config, { initialHighscore, playedRoundIdsByPool: playedByPool }),
    [config, initialHighscore, playedByPool],
  );

  const handleHighscoreChange = useCallback((highscore: number) => {
    void db.gameProfile
      .setLocalHighscore(Math.max(0, Math.floor(highscore)))
      .catch((error) => {
        console.warn("Failed to persist highscore to DB", error);
      });
  }, []);

  const handleBack = useMemo(
    () => () => {
      if (mapEditorTestPlaylistIdRef.current) {
        setMapEditorTestSession(mapEditorTestPlaylistIdRef.current);
        void navigate({ to: "/map-editor" });
        return;
      }
      void navigate({ to: "/" });
    },
    [navigate],
  );

  const handleRoundPlayed = useCallback((payload: { roundId: string; nodeId: string; poolId: string | null }) => {
    void playlists.recordRoundPlay({
      playlistId: activePlaylist.id,
      roundId: payload.roundId,
      nodeId: payload.nodeId,
      poolId: payload.poolId,
    }).catch((error) => {
      console.warn("Failed to record played round", error);
    });
  }, [activePlaylist.id]);

  const handleStateChange = useCallback((nextState: GameState) => {
    if (hasNavigatedToResultRef.current) return;
    if (nextState.sessionPhase !== "completed") return;
    const player = nextState.players[nextState.currentPlayerIndex];
    if (!player) return;
    hasNavigatedToResultRef.current = true;
    const score = Math.max(0, Math.floor(player.score));
    const highscoreBefore = Math.max(0, Math.floor(initialHighscore));
    const highscoreAfter = Math.max(0, Math.floor(nextState.highscore));

    void db.singlePlayerHistory.recordRun({
      finishedAtIso: new Date().toISOString(),
      score,
      highscoreBefore,
      highscoreAfter,
      wasNewHighscore: score > highscoreBefore,
      completionReason: nextState.completionReason ?? "finished",
      playlistId: activePlaylist.id,
      playlistName: activePlaylist.name,
      playlistFormatVersion: activePlaylist.formatVersion,
      endingPosition: Math.max(0, Math.floor(player.position)),
      turn: Math.max(0, Math.floor(nextState.turn)),
    }).catch((error) => {
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
        reason: nextState.completionReason ?? "finished",
      },
      replace: true,
    });
  }, [activePlaylist.formatVersion, activePlaylist.id, activePlaylist.name, initialHighscore, isMapEditorTestRun, navigate]);

  return (
    <GameScene
      initialState={initialState}
      installedRounds={installedRounds}
      onGiveUp={handleBack}
      giveUpLabel={isMapEditorTestRun ? "Back to Editor" : "Give Up"}
      allowDebugRoundControls={isMapEditorTestRun}
      onHighscoreChange={handleHighscoreChange}
      onRoundPlayed={handleRoundPlayed}
      onStateChange={handleStateChange}
      intermediaryLoadingPrompt={intermediaryLoadingPrompt}
      intermediaryLoadingDurationSec={intermediaryLoadingDurationSec}
      intermediaryReturnPauseSec={intermediaryReturnPauseSec}
    />
  );
}
