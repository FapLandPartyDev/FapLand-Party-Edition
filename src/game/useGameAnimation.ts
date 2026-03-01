import { useCallback, useEffect, useRef, useState } from "react";
import {
  applyInventoryItemToSelf,
  adjustPlayerMoney,
  applyPerkByIdToPlayer,
  completeRound,
  consumeInventoryItem,
  consumeAntiPerkById,
  reportPlayerCum,
  resolvePathChoiceTimeout,
  rollTurn,
  selectPathEdge,
  skipPerkSelection,
  selectPerk,
  triggerQueuedRound,
  useRoundControl,
} from "./engine";
import {
  playDiceResultSound,
  playDiceRollStartSound,
  playPerkActionSound,
  playRoundStartSound,
  playTokenLandingSound,
  playTokenStepSound,
} from "../utils/audio";
import type { CompletedRoundSummary, GameState } from "./types";
import type { InstalledRound } from "../services/db";

export type AnimPhase =
  | { kind: "idle" }
  | { kind: "rollingDice"; elapsed: number; displayValue: number; finalValue: number }
  | {
    kind: "diceResultReveal";
    elapsed: number;
    value: number;
    playerIndex: number;
    path: number[];
  }
  | {
    kind: "movingToken";
    playerIndex: number;
    path: number[];
    stepIndex: number;
    stepElapsed: number;
  }
  | { kind: "landingEffect"; elapsed: number }
  | { kind: "roundCountdown"; elapsed: number; remaining: number }
  | { kind: "perkReveal"; elapsed: number };

export interface UseGameAnimationReturn {
  state: GameState;
  animPhase: AnimPhase;
  nextAutoRollInSec: number | null;
  pathChoiceRemainingMs: number | null;
  handleRoll: () => void;
  handleStartQueuedRound: () => void;
  handleCompleteRound: (summary?: CompletedRoundSummary) => void;
  handleReportCum: () => void;
  handleSelectPathEdge: (edgeId: string) => void;
  handleResolvePathChoiceTimeout: () => void;
  handleSelectPerk: (perkId: string, options?: { applyDirectly?: boolean }) => void;
  handleSkipPerk: () => void;
  handleApplyInventoryItemToSelf: (input: { playerId: string; itemId: string }) => void;
  handleConsumeInventoryItem: (input: { playerId: string; itemId: string; reason?: string }) => void;
  handleApplyExternalPerk: (input: { targetPlayerId: string; perkId: string; sourceLabel?: string }) => void;
  handleAdjustPlayerMoney: (input: { playerId: string; delta: number; reason?: string }) => void;
  handleUseRoundControl: (input: { playerId: string; control: "pause" | "skip" }) => void;
  handleConsumeAntiPerkById: (input: { playerId: string; perkId: string; reason?: string }) => void;
  tickAnim: (dt: number) => AnimPhase;
}

const DICE_ROLL_DURATION = 1.05;
const STEP_DURATION = 0.38;
export const LANDING_DURATION = 0.9;
export const PERK_REVEAL_DURATION = 0.65;
export const ROUND_COUNTDOWN_DURATION = 2.1;
export const DICE_RESULT_REVEAL_DURATION = 0.95;

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function resolveEffectiveRestPauseMs(state: GameState): number {
  const currentPlayer = state.players[state.currentPlayerIndex];
  if (!currentPlayer) return 20000;
  const currentField = state.config.board.find((field) => field.id === currentPlayer.currentNodeId);
  const checkpointRestMs = currentField?.kind === "safePoint" ? currentField.checkpointRestMs ?? 0 : 0;
  return Math.max(currentPlayer.stats.roundPauseMs ?? 20000, checkpointRestMs);
}

export function useGameAnimation(
  initialState: GameState,
  installedRounds: InstalledRound[],
): UseGameAnimationReturn {
  const [state, setState] = useState<GameState>(initialState);
  const stateRef = useRef(state);

  const [animPhase, setAnimPhase] = useState<AnimPhase>({ kind: "idle" });
  const animPhaseRef = useRef<AnimPhase>(animPhase);
  const [nextAutoRollInSec, setNextAutoRollInSec] = useState<number | null>(null);
  const [pathChoiceRemainingMs, setPathChoiceRemainingMs] = useState<number | null>(null);
  const turnTimerElapsedRef = useRef(0);
  const pathChoiceElapsedRef = useRef(0);
  const pendingChoiceRef = useRef<string | null>(null);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    animPhaseRef.current = animPhase;
  }, [animPhase]);

  useEffect(() => {
    const pending = state.pendingPathChoice;
    const key = pending ? `${pending.playerId}:${pending.fromNodeId}:${pending.remainingSteps}` : null;
    if (pendingChoiceRef.current !== key) {
      pendingChoiceRef.current = key;
      pathChoiceElapsedRef.current = 0;
    }
    if (!pending) {
      setPathChoiceRemainingMs(null);
    }
  }, [state.pendingPathChoice]);

  const toPathIndices = useCallback((nextState: GameState): number[] => {
    if (nextState.lastTraversalPathNodeIds.length <= 1) return [];
    return nextState.lastTraversalPathNodeIds
      .slice(1)
      .map((nodeId) => nextState.config.runtimeGraph.nodeIndexById[nodeId] ?? 0);
  }, []);

  const queueRollPhase = useCallback((diceMin = 1, diceMax = 6): AnimPhase => {
    const clampedMin = Math.max(1, Math.floor(diceMin));
    const clampedMax = Math.max(clampedMin, Math.floor(diceMax));
    const next: AnimPhase = {
      kind: "rollingDice",
      elapsed: 0,
      displayValue: clampedMin,
      finalValue: randomInt(clampedMin, clampedMax),
    };
    animPhaseRef.current = next;
    setAnimPhase(next);
    return next;
  }, []);

  const handleRoll = useCallback(() => {
    const s = stateRef.current;
    if (s.sessionPhase !== "normal") return;
    if (s.pendingPerkSelection || s.pendingPathChoice || s.queuedRound || s.activeRound) return;
    const currentPlayer = s.players[s.currentPlayerIndex];
    const hasBoardSequenceAntiPerk = Boolean(
      currentPlayer && ["milker", "jackhammer", "no-rest"].some((id) => currentPlayer.antiPerks.includes(id)),
    );
    if (hasBoardSequenceAntiPerk) return;
    if (animPhaseRef.current.kind !== "idle") return;
    turnTimerElapsedRef.current = 0;
    setNextAutoRollInSec(null);
    playDiceRollStartSound();
    queueRollPhase(
      s.players[s.currentPlayerIndex]?.stats.diceMin ?? 1,
      s.players[s.currentPlayerIndex]?.stats.diceMax ?? 6,
    );
  }, [queueRollPhase]);

  const handleStartQueuedRound = useCallback(() => {
    const s = stateRef.current;
    if (!s.queuedRound || s.pendingPerkSelection || s.pendingPathChoice || s.activeRound) return;
    if (animPhaseRef.current.kind !== "idle") return;

    playRoundStartSound();
    const next: AnimPhase = { kind: "roundCountdown", elapsed: 0, remaining: ROUND_COUNTDOWN_DURATION };
    animPhaseRef.current = next;
    setAnimPhase(next);
    turnTimerElapsedRef.current = 0;
    setNextAutoRollInSec(null);
  }, []);

  const handleCompleteRound = useCallback((summary?: CompletedRoundSummary) => {
    setState((prev: GameState) => completeRound(prev, summary, installedRounds));
    const next: AnimPhase = { kind: "idle" };
    animPhaseRef.current = next;
    setAnimPhase(next);
    turnTimerElapsedRef.current = 0;
    setNextAutoRollInSec(null);
  }, [installedRounds]);

  const handleReportCum = useCallback(() => {
    setState((prev: GameState) => reportPlayerCum(prev));
    const next: AnimPhase = { kind: "idle" };
    animPhaseRef.current = next;
    setAnimPhase(next);
    setNextAutoRollInSec(null);
    setPathChoiceRemainingMs(null);
    turnTimerElapsedRef.current = 0;
    pathChoiceElapsedRef.current = 0;
  }, []);

  const handleSelectPathEdge = useCallback((edgeId: string) => {
    const current = stateRef.current;
    const nextState = selectPathEdge(current, edgeId, installedRounds);
    stateRef.current = nextState;
    setState(nextState);
    setPathChoiceRemainingMs(null);
    pathChoiceElapsedRef.current = 0;

    const path = toPathIndices(nextState);
    if (path.length > 0) {
      playTokenStepSound();
      const next: AnimPhase = {
        kind: "movingToken",
        playerIndex: nextState.currentPlayerIndex,
        path,
        stepIndex: 0,
        stepElapsed: 0,
      };
      animPhaseRef.current = next;
      setAnimPhase(next);
      return;
    }

    const next: AnimPhase =
      nextState.queuedRound && !nextState.pendingPerkSelection && !nextState.activeRound
        ? { kind: "roundCountdown", elapsed: 0, remaining: ROUND_COUNTDOWN_DURATION }
        : { kind: "idle" };
    animPhaseRef.current = next;
    setAnimPhase(next);
  }, [installedRounds, toPathIndices]);

  const handleResolvePathChoiceTimeout = useCallback(() => {
    const current = stateRef.current;
    if (!current.pendingPathChoice) return;

    const nextState = resolvePathChoiceTimeout(current, installedRounds);
    stateRef.current = nextState;
    setState(nextState);
    setPathChoiceRemainingMs(null);
    pathChoiceElapsedRef.current = 0;

    const path = toPathIndices(nextState);
    if (path.length > 0) {
      playTokenStepSound();
      const next: AnimPhase = {
        kind: "movingToken",
        playerIndex: nextState.currentPlayerIndex,
        path,
        stepIndex: 0,
        stepElapsed: 0,
      };
      animPhaseRef.current = next;
      setAnimPhase(next);
      return;
    }

    const next: AnimPhase =
      nextState.queuedRound && !nextState.pendingPerkSelection && !nextState.activeRound
        ? { kind: "roundCountdown", elapsed: 0, remaining: ROUND_COUNTDOWN_DURATION }
        : { kind: "idle" };
    animPhaseRef.current = next;
    setAnimPhase(next);
  }, [installedRounds, toPathIndices]);

  const handleSelectPerk = useCallback((perkId: string, options?: { applyDirectly?: boolean }) => {
    const current = stateRef.current;
    const nextState = selectPerk(current, perkId, options);
    stateRef.current = nextState;
    setState(nextState);
    playPerkActionSound();

    const next: AnimPhase =
      nextState.queuedRound && !nextState.pendingPerkSelection && !nextState.activeRound
        ? { kind: "roundCountdown", elapsed: 0, remaining: ROUND_COUNTDOWN_DURATION }
        : { kind: "idle" };
    animPhaseRef.current = next;
    setAnimPhase(next);
    turnTimerElapsedRef.current = 0;
    setNextAutoRollInSec(null);
  }, []);

  const handleSkipPerk = useCallback(() => {
    const current = stateRef.current;
    if (!current.pendingPerkSelection) return;

    const nextState = skipPerkSelection(current);
    stateRef.current = nextState;
    setState(nextState);
    playPerkActionSound();

    const next: AnimPhase =
      nextState.queuedRound && !nextState.pendingPerkSelection && !nextState.activeRound
        ? { kind: "roundCountdown", elapsed: 0, remaining: ROUND_COUNTDOWN_DURATION }
        : { kind: "idle" };
    animPhaseRef.current = next;
    setAnimPhase(next);
    turnTimerElapsedRef.current = 0;
    setNextAutoRollInSec(null);
  }, []);

  const handleApplyExternalPerk = useCallback((input: {
    targetPlayerId: string;
    perkId: string;
    sourceLabel?: string;
  }) => {
    setState((prev) => {
      const next = applyPerkByIdToPlayer(prev, input);
      stateRef.current = next;
      return next;
    });
    playPerkActionSound();
  }, []);

  const handleApplyInventoryItemToSelf = useCallback((input: { playerId: string; itemId: string }) => {
    setState((prev) => {
      const next = applyInventoryItemToSelf(prev, input);
      stateRef.current = next;
      return next;
    });
    playPerkActionSound();
  }, []);

  const handleConsumeInventoryItem = useCallback((input: { playerId: string; itemId: string; reason?: string }) => {
    setState((prev) => {
      const next = consumeInventoryItem(prev, input);
      stateRef.current = next;
      return next;
    });
  }, []);

  const handleAdjustPlayerMoney = useCallback((input: {
    playerId: string;
    delta: number;
    reason?: string;
  }) => {
    setState((prev) => {
      const next = adjustPlayerMoney(prev, input);
      stateRef.current = next;
      return next;
    });
  }, []);

  const handleUseRoundControl = useCallback((input: { playerId: string; control: "pause" | "skip" }) => {
    setState((prev) => {
      const next = useRoundControl(prev, input);
      stateRef.current = next;
      return next;
    });
    playPerkActionSound();
  }, []);

  const handleConsumeAntiPerkById = useCallback((input: { playerId: string; perkId: string; reason?: string }) => {
    setState((prev) => {
      const next = consumeAntiPerkById(prev, input);
      stateRef.current = next;
      return next;
    });
  }, []);

  const tickAnim = useCallback((dt: number): AnimPhase => {
    const phase = animPhaseRef.current;
    const s = stateRef.current;
    const currentPlayer = s.players[s.currentPlayerIndex];
    const hasBoardSequenceAntiPerk = Boolean(
      !s.activeRound &&
      !s.pendingPathChoice &&
      !s.pendingPerkSelection &&
      currentPlayer &&
      ["milker", "jackhammer", "no-rest"].some((id) => currentPlayer.antiPerks.includes(id)),
    );

    const canCountdownRun =
      (phase.kind === "idle" || phase.kind === "perkReveal") &&
      !s.activeRound &&
      !s.pendingPathChoice &&
      !hasBoardSequenceAntiPerk &&
      s.sessionPhase !== "completed";

    if (canCountdownRun) {
      turnTimerElapsedRef.current += dt;
      const pauseSec = resolveEffectiveRestPauseMs(s) / 1000;
      const remaining = Math.max(0, pauseSec - turnTimerElapsedRef.current);
      setNextAutoRollInSec(remaining);

      if (turnTimerElapsedRef.current >= pauseSec) {
        turnTimerElapsedRef.current = 0;
        setNextAutoRollInSec(null);

        let nextState = s;
        if (s.pendingPerkSelection) {
          nextState = skipPerkSelection(s);
          stateRef.current = nextState;
          setState(nextState);
        }

        if (nextState.queuedRound && !nextState.pendingPerkSelection && !nextState.activeRound) {
          playRoundStartSound();
          const next: AnimPhase = { kind: "roundCountdown", elapsed: 0, remaining: ROUND_COUNTDOWN_DURATION };
          animPhaseRef.current = next;
          setAnimPhase(next);
          return next;
        }

        if (nextState.sessionPhase === "normal" && !nextState.activeRound && !nextState.pendingPerkSelection && !nextState.pendingPathChoice) {
          playDiceRollStartSound();
          return queueRollPhase(
            nextState.players[nextState.currentPlayerIndex]?.stats.diceMin ?? 1,
            nextState.players[nextState.currentPlayerIndex]?.stats.diceMax ?? 6,
          );
        }
      }
    } else {
      setNextAutoRollInSec(null);
    }

    if (s.pendingPathChoice) {
      const timeoutMs = s.config.runtimeGraph.pathChoiceTimeoutMs;
      pathChoiceElapsedRef.current += dt;
      const remainingMs = Math.max(0, timeoutMs - pathChoiceElapsedRef.current * 1000);
      setPathChoiceRemainingMs(remainingMs);
      if (remainingMs <= 0 && phase.kind === "idle") {
        handleResolvePathChoiceTimeout();
      }
    } else {
      setPathChoiceRemainingMs(null);
    }

    if (phase.kind === "rollingDice") {
      const newElapsed = phase.elapsed + dt;
      const diceMin = s.players[s.currentPlayerIndex]?.stats.diceMin ?? 1;
      const diceMax = s.players[s.currentPlayerIndex]?.stats.diceMax ?? 6;
      const range = Math.max(1, diceMax - diceMin + 1);
      const progress = Math.max(0, Math.min(1, newElapsed / DICE_ROLL_DURATION));
      const totalSteps = 24;
      const decel = 1 - Math.pow(1 - progress, 1.85);
      const stepIndex = Math.floor(decel * totalSteps);
      const newDisplay = stepIndex >= totalSteps - 1
        ? phase.finalValue
        : diceMin + (stepIndex % range);

      if (newElapsed >= DICE_ROLL_DURATION) {
        const nextState = rollTurn(s, installedRounds, phase.finalValue);
        const roll = nextState.lastRoll ?? phase.finalValue;
        const path = toPathIndices(nextState);

        stateRef.current = nextState;
        setState(nextState);
        playDiceResultSound();

        const next: AnimPhase = {
          kind: "diceResultReveal",
          elapsed: 0,
          value: roll,
          playerIndex: s.currentPlayerIndex,
          path,
        };
        animPhaseRef.current = next;
        setAnimPhase(next);
        return next;
      }

      const next: AnimPhase = {
        kind: "rollingDice",
        elapsed: newElapsed,
        displayValue: newDisplay,
        finalValue: phase.finalValue,
      };
      animPhaseRef.current = next;
      setAnimPhase(next);
      return next;
    }

    if (phase.kind === "diceResultReveal") {
      const newElapsed = phase.elapsed + dt;
      if (newElapsed >= DICE_RESULT_REVEAL_DURATION) {
        if (phase.path.length > 0) {
          playTokenStepSound();
          const next: AnimPhase = {
            kind: "movingToken",
            playerIndex: phase.playerIndex,
            path: phase.path,
            stepIndex: 0,
            stepElapsed: 0,
          };
          animPhaseRef.current = next;
          setAnimPhase(next);
          return next;
        }

        const next: AnimPhase = { kind: "idle" };
        animPhaseRef.current = next;
        setAnimPhase(next);
        return next;
      }
      const next: AnimPhase = { ...phase, elapsed: newElapsed };
      animPhaseRef.current = next;
      setAnimPhase(next);
      return next;
    }

    if (phase.kind === "movingToken") {
      const newStepElapsed = phase.stepElapsed + dt;

      if (newStepElapsed >= STEP_DURATION) {
        const nextStepIndex = phase.stepIndex + 1;

        if (nextStepIndex >= phase.path.length) {
          playTokenLandingSound();
          const nextS = stateRef.current;
          let next: AnimPhase;
          if (nextS.pendingPerkSelection) {
            next = { kind: "perkReveal", elapsed: 0 };
          } else if (nextS.pendingPathChoice) {
            next = { kind: "idle" };
          } else if (nextS.queuedRound) {
            next = { kind: "roundCountdown", elapsed: 0, remaining: ROUND_COUNTDOWN_DURATION };
          } else {
            next = { kind: "landingEffect", elapsed: 0 };
          }
          animPhaseRef.current = next;
          setAnimPhase(next);
          return next;
        }

        playTokenStepSound();

        const next: AnimPhase = {
          ...phase,
          stepIndex: nextStepIndex,
          stepElapsed: 0,
        };
        animPhaseRef.current = next;
        setAnimPhase(next);
        return next;
      }

      const next: AnimPhase = {
        ...phase,
        stepElapsed: newStepElapsed,
      };
      animPhaseRef.current = next;
      setAnimPhase(next);
      return next;
    }

    if (phase.kind === "landingEffect") {
      const newElapsed = phase.elapsed + dt;
      if (newElapsed >= LANDING_DURATION) {
        const next: AnimPhase = { kind: "idle" };
        animPhaseRef.current = next;
        setAnimPhase(next);
        return next;
      }
      const next: AnimPhase = { kind: "landingEffect", elapsed: newElapsed };
      animPhaseRef.current = next;
      setAnimPhase(next);
      return next;
    }

    if (phase.kind === "roundCountdown") {
      const newElapsed = phase.elapsed + dt;
      const remaining = Math.max(0, ROUND_COUNTDOWN_DURATION - newElapsed);
      if (newElapsed >= ROUND_COUNTDOWN_DURATION) {
        setState((prev: GameState) => {
          const nextState = triggerQueuedRound(prev);
          stateRef.current = nextState;
          return nextState;
        });
        const next: AnimPhase = { kind: "idle" };
        animPhaseRef.current = next;
        setAnimPhase(next);
        turnTimerElapsedRef.current = 0;
        setNextAutoRollInSec(null);
        return next;
      }

      const next: AnimPhase = { kind: "roundCountdown", elapsed: newElapsed, remaining };
      animPhaseRef.current = next;
      setAnimPhase(next);
      return next;
    }

    if (phase.kind === "perkReveal") {
      const newElapsed = phase.elapsed + dt;
      if (newElapsed >= PERK_REVEAL_DURATION) {
        return phase;
      }
      const next: AnimPhase = { kind: "perkReveal", elapsed: newElapsed };
      animPhaseRef.current = next;
      setAnimPhase(next);
      return next;
    }

    if (phase.kind === "idle") {
      if (!canCountdownRun) {
        turnTimerElapsedRef.current = 0;
      }
    }

    return phase;
  }, [handleResolvePathChoiceTimeout, installedRounds, queueRollPhase, toPathIndices]);

  return {
    state,
    animPhase,
    nextAutoRollInSec,
    pathChoiceRemainingMs,
    handleRoll,
    handleStartQueuedRound,
    handleCompleteRound,
    handleReportCum,
    handleSelectPathEdge,
    handleResolvePathChoiceTimeout,
    handleSelectPerk,
    handleSkipPerk,
    handleApplyInventoryItemToSelf,
    handleConsumeInventoryItem,
    handleApplyExternalPerk,
    handleAdjustPlayerMoney,
    handleUseRoundControl,
    handleConsumeAntiPerkById,
    tickAnim,
  };
}

export { STEP_DURATION, DICE_ROLL_DURATION };
