import { useCallback, useEffect, useRef } from "react";
import type {
  GameplayMode,
  GameplaySessionStatus,
  RoundPlaybackTelemetryEvent,
} from "../game/gameplayTelemetry";
import { shouldCountGameplayActivity } from "../game/gameplayTelemetry";
import { db } from "../services/db";

type SessionConfig = {
  enabled: boolean;
  mode: GameplayMode;
  sourceId: string;
  playlistId: string | null;
  playlistName: string;
  startedAtMs: number;
  cheatModeActive?: boolean;
  assistedActive?: boolean;
  assistedSaveMode?: "checkpoint" | "everywhere" | null;
};

type FinishInput = {
  status: Exclude<GameplaySessionStatus, "in_progress">;
  completionReason?: string | null;
  score?: number | null;
  completedRounds?: number;
  singlePlayerRunId?: string | null;
};

const FLUSH_INTERVAL_MS = 5_000;

export function useGameplayTelemetrySession(config: SessionConfig) {
  const {
    enabled,
    mode,
    sourceId,
    playlistId,
    playlistName,
    startedAtMs,
    cheatModeActive,
    assistedActive,
    assistedSaveMode,
  } = config;
  const sessionId = `gameplay:${sourceId}`;
  const activePlayMsRef = useRef(0);
  const activeStartedAtRef = useRef<number | null>(null);
  const finishedRef = useRef(false);

  const collectActiveTime = useCallback(() => {
    const activeStartedAt = activeStartedAtRef.current;
    if (activeStartedAt === null) return activePlayMsRef.current;
    activePlayMsRef.current += Math.max(0, performance.now() - activeStartedAt);
    activeStartedAtRef.current = performance.now();
    return Math.floor(activePlayMsRef.current);
  }, []);

  const flush = useCallback(() => {
    if (!enabled || finishedRef.current) return Promise.resolve(null);
    return db.gameplayStats.updateActivity({
      id: sessionId,
      activePlayMs: collectActiveTime(),
      lastActiveAtIso: new Date().toISOString(),
    });
  }, [collectActiveTime, enabled, sessionId]);

  useEffect(() => {
    if (!enabled) return;
    finishedRef.current = false;
    activePlayMsRef.current = 0;
    let cancelled = false;
    void db.gameplayStats
      .beginSession({
        id: sessionId,
        mode,
        sourceId,
        playlistId,
        playlistName,
        startedAtIso: new Date(startedAtMs).toISOString(),
        cheatModeActive,
        assistedActive,
        assistedSaveMode,
      })
      .then((row) => {
        if (cancelled || !row) return;
        activePlayMsRef.current = Math.max(activePlayMsRef.current, row.activePlayMs);
      })
      .catch((error) => console.warn("Failed to begin gameplay telemetry session", error));

    const updateActiveState = () => {
      const active = shouldCountGameplayActivity(document.visibilityState, document.hasFocus());
      if (active && activeStartedAtRef.current === null) {
        activeStartedAtRef.current = performance.now();
      } else if (!active && activeStartedAtRef.current !== null) {
        collectActiveTime();
        activeStartedAtRef.current = null;
        void flush();
      }
    };
    updateActiveState();
    const interval = window.setInterval(() => void flush(), FLUSH_INTERVAL_MS);
    document.addEventListener("visibilitychange", updateActiveState);
    window.addEventListener("focus", updateActiveState);
    window.addEventListener("blur", updateActiveState);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", updateActiveState);
      window.removeEventListener("focus", updateActiveState);
      window.removeEventListener("blur", updateActiveState);
      if (activeStartedAtRef.current !== null) collectActiveTime();
      activeStartedAtRef.current = null;
      void flush();
    };
  }, [
    assistedActive,
    assistedSaveMode,
    cheatModeActive,
    collectActiveTime,
    enabled,
    flush,
    mode,
    playlistId,
    playlistName,
    sessionId,
    sourceId,
    startedAtMs,
  ]);

  const recordRound = useCallback(
    (event: RoundPlaybackTelemetryEvent) => {
      if (!enabled || finishedRef.current) return;
      void db.gameplayStats
        .upsertRoundPlay({
          ...event,
          sessionId,
          mode,
          playlistId,
          playlistName,
        })
        .catch((error) => console.warn("Failed to persist round telemetry", error));
    },
    [enabled, mode, playlistId, playlistName, sessionId]
  );

  const finish = useCallback(
    async (input: FinishInput) => {
      if (!enabled || finishedRef.current) return null;
      finishedRef.current = true;
      if (activeStartedAtRef.current !== null) collectActiveTime();
      activeStartedAtRef.current = null;
      return db.gameplayStats.finishSession({
        id: sessionId,
        activePlayMs: Math.floor(activePlayMsRef.current),
        status: input.status,
        completionReason: input.completionReason,
        score: input.score,
        completedRounds: input.completedRounds,
        singlePlayerRunId: input.singlePlayerRunId,
        endedAtIso: new Date().toISOString(),
      });
    },
    [collectActiveTime, enabled, sessionId]
  );

  return { sessionId, recordRound, finish, flush };
}
