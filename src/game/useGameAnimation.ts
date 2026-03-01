import { useCallback, useRef, useState } from "react";
import { runAutomationPass } from "./automation/execute";
import { advanceAutomationClock, appendAutomationEvent } from "./automation/state";
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
  shouldAutoStartQueuedRound,
  triggerQueuedRound,
  useRoundControl,
} from "./engine";
import {
  playDiceResultSound,
  playDiceRollStartSound,
  playGatePassSound,
  playPerkActionSound,
  playRoundStartSound,
  playTokenLandingSound,
  playTokenStepSound,
} from "../utils/audio";
import type { CompletedRoundSummary, GameConfig, GameState } from "./types";
import type { InstalledRound } from "../services/db";
import { resolveEffectiveRestPauseMs as getEffectiveRestPauseMs } from "./restPause";

export type AnimPhase =
  | { kind: "idle" }
  | { kind: "rollingDice"; elapsed: number; displayValue: number; finalValue: number }
  | {
      kind: "diceResultReveal";
      elapsed: number;
      value: number;
      playerIndex: number;
      path: number[];
      gateStepIndices: number[];
    }
  | {
      kind: "movingToken";
      playerIndex: number;
      path: number[];
      gateStepIndices: number[];
      stepIndex: number;
      stepElapsed: number;
    }
  | { kind: "landingEffect"; elapsed: number }
  | { kind: "roundCountdown"; elapsed: number; remaining: number; duration: number }
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
  handleConsumeInventoryItem: (input: {
    playerId: string;
    itemId: string;
    reason?: string;
  }) => void;
  handleApplyExternalPerk: (input: {
    targetPlayerId: string;
    perkId: string;
    sourceLabel?: string;
  }) => void;
  handleAdjustPlayerMoney: (input: { playerId: string; delta: number; reason?: string }) => void;
  handleUseRoundControl: (input: { playerId: string; control: "pause" | "skip" }) => void;
  handleConsumeAntiPerkById: (input: { playerId: string; perkId: string; reason?: string }) => void;
  tickAnim: (dt: number) => AnimPhase;
}

const DICE_ROLL_DURATION = 1.05;
const STEP_DURATION = 0.38;
export const LANDING_DURATION = 0.9;
export const PERK_REVEAL_DURATION = 0.65;
export const NORMAL_ROUND_COUNTDOWN_DURATION = 2.1;
export const CUM_ROUND_COUNTDOWN_DURATION = 4.0;
export const DICE_RESULT_REVEAL_DURATION = 0.95;

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function resolveEffectiveRestPauseMs(state: GameState): number {
  return getEffectiveRestPauseMs(state);
}

export function isTechnicalQueuedRound(
  config: GameConfig,
  queuedRound: GameState["queuedRound"]
): boolean {
  if (!queuedRound || queuedRound.phaseKind !== "normal") return false;
  const nodeIndex = config.runtimeGraph.nodeIndexById[queuedRound.nodeId];
  const field = typeof nodeIndex === "number" ? config.board[nodeIndex] : undefined;
  if (!field) return false;
  return Boolean(
    (field.kind === "round" || field.kind === "randomRound") &&
    field.hiddenFromMap &&
    field.autoAdvanceAfterCompletion
  );
}

export function resolveRoundCountdownDuration(
  config: GameConfig,
  queuedRound: GameState["queuedRound"]
): number {
  if (isTechnicalQueuedRound(config, queuedRound)) return 0;
  return queuedRound?.phaseKind === "cum"
    ? CUM_ROUND_COUNTDOWN_DURATION
    : NORMAL_ROUND_COUNTDOWN_DURATION;
}

function createRoundCountdownPhase(
  config: GameConfig,
  queuedRound: GameState["queuedRound"]
): AnimPhase {
  const duration = resolveRoundCountdownDuration(config, queuedRound);
  return {
    kind: "roundCountdown",
    elapsed: 0,
    remaining: duration,
    duration,
  };
}

export function useGameAnimation(
  initialState: GameState,
  installedRounds: InstalledRound[]
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
  const stayElapsedMsRef = useRef(0);
  const stayFireCountByRuleKeyRef = useRef<Record<string, number>>({});
  const stayNodeIdRef = useRef<string | null>(null);

  // Sync refs manually in transitions instead of effects to avoid stale reverts in high-frequency loops.

  const syncPathChoiceRef = useCallback((nextState: GameState) => {
    const pending = nextState.pendingPathChoice;
    const key = pending
      ? `${pending.playerId}:${pending.fromNodeId}:${pending.remainingSteps}`
      : null;
    if (pendingChoiceRef.current !== key) {
      pendingChoiceRef.current = key;
      pathChoiceElapsedRef.current = 0;
    }
  }, []);

  const commitState = useCallback(
    (nextState: GameState, options?: { syncPathChoice?: boolean }): GameState => {
      const processedState = runAutomationPass(nextState);
      stateRef.current = processedState;
      setState(processedState);
      if (options?.syncPathChoice !== false) {
        syncPathChoiceRef(processedState);
      }
      return processedState;
    },
    [syncPathChoiceRef]
  );

  const applyTransition = useCallback(
    (
      transition: (state: GameState) => GameState,
      options?: { syncPathChoice?: boolean }
    ): GameState => commitState(transition(stateRef.current), options),
    [commitState]
  );

  const toPathIndices = useCallback((nextState: GameState): number[] => {
    if (nextState.lastTraversalPathNodeIds.length <= 1) return [];
    return nextState.lastTraversalPathNodeIds
      .slice(1)
      .map((nodeId) => nextState.config.runtimeGraph.nodeIndexById[nodeId] ?? 0);
  }, []);

  const toGateStepIndices = useCallback((nextState: GameState): number[] => {
    const pathNodeIds = nextState.lastTraversalPathNodeIds;
    if (pathNodeIds.length <= 1) return [];

    return pathNodeIds.slice(0, -1).flatMap((fromNodeId, index) => {
      const toNodeId = pathNodeIds[index + 1];
      if (!toNodeId) return [];
      const edge = nextState.config.runtimeGraph.edges.find(
        (candidate) => candidate.fromNodeId === fromNodeId && candidate.toNodeId === toNodeId
      );
      return edge && edge.gateCost > 0 ? [index] : [];
    });
  }, []);

  const shouldSkipDiceAnimation = useCallback(
    (gameState: GameState) => gameState.config.disableDiceAnimation === true,
    []
  );

  const maybeStartQueuedRoundImmediately = useCallback(
    (gameState: GameState): GameState => {
      if (
        !shouldAutoStartQueuedRound(gameState) ||
        gameState.pendingPerkSelection ||
        gameState.activeRound ||
        !isTechnicalQueuedRound(gameState.config, gameState.queuedRound)
      ) {
        return gameState;
      }

      return commitState(triggerQueuedRound(gameState));
    },
    [commitState]
  );

  const resolvePostTraversalPhase = useCallback(
    (nextState: GameState): AnimPhase => {
      if (nextState.pendingPerkSelection) {
        return { kind: "perkReveal", elapsed: 0 };
      }
      if (nextState.pendingPathChoice) {
        return { kind: "idle" };
      }
      if (nextState.queuedRound) {
        const resolvedState = maybeStartQueuedRoundImmediately(nextState);
        if (!resolvedState.queuedRound) {
          return { kind: "idle" };
        }
        return createRoundCountdownPhase(resolvedState.config, resolvedState.queuedRound);
      }
      return { kind: "idle" };
    },
    [maybeStartQueuedRoundImmediately]
  );

  const commitAnimPhase = useCallback((nextPhase: AnimPhase): AnimPhase => {
    animPhaseRef.current = nextPhase;
    setAnimPhase(nextPhase);
    return nextPhase;
  }, []);

  const queueRollPhase = useCallback(
    (diceMin = 1, diceMax = 6): AnimPhase => {
      const clampedMin = Math.max(1, Math.floor(diceMin));
      const clampedMax = Math.max(clampedMin, Math.floor(diceMax));
      const next: AnimPhase = {
        kind: "rollingDice",
        elapsed: 0,
        displayValue: clampedMin,
        finalValue: randomInt(clampedMin, clampedMax),
      };
      return commitAnimPhase(next);
    },
    [commitAnimPhase]
  );

  const handleRoll = useCallback(() => {
    const s = stateRef.current;
    if (s.sessionPhase !== "normal") return;
    if (s.pendingPerkSelection || s.pendingPathChoice || s.activeRound) return;
    if (s.queuedRound && !s.queuedRound.skippable) return;
    const currentPlayer = s.players[s.currentPlayerIndex];
    const hasBoardSequenceAntiPerk = Boolean(
      currentPlayer && ["milker", "jackhammer"].some((id) => currentPlayer.antiPerks.includes(id))
    );
    if (hasBoardSequenceAntiPerk) return;
    if (animPhaseRef.current.kind !== "idle") return;
    turnTimerElapsedRef.current = 0;
    setNextAutoRollInSec(null);
    if (shouldSkipDiceAnimation(s)) {
      const nextState = rollTurn(s, installedRounds);
      commitState(nextState);
      playDiceResultSound();
      commitAnimPhase(resolvePostTraversalPhase(nextState));
      return;
    }
    playDiceRollStartSound();
    queueRollPhase(
      s.players[s.currentPlayerIndex]?.stats.diceMin ?? 1,
      s.players[s.currentPlayerIndex]?.stats.diceMax ?? 6
    );
  }, [
    commitAnimPhase,
    commitState,
    installedRounds,
    queueRollPhase,
    resolvePostTraversalPhase,
    shouldSkipDiceAnimation,
  ]);

  const handleStartQueuedRound = useCallback(() => {
    const s = stateRef.current;
    if (!s.queuedRound || s.pendingPerkSelection || s.pendingPathChoice || s.activeRound) return;
    if (animPhaseRef.current.kind !== "idle") return;

    if (isTechnicalQueuedRound(s.config, s.queuedRound)) {
      commitState(triggerQueuedRound(s));
      const next: AnimPhase = { kind: "idle" };
      animPhaseRef.current = next;
      setAnimPhase(next);
      turnTimerElapsedRef.current = 0;
      setNextAutoRollInSec(null);
      return;
    }

    playRoundStartSound();
    const next = createRoundCountdownPhase(s.config, s.queuedRound);
    animPhaseRef.current = next;
    setAnimPhase(next);
    turnTimerElapsedRef.current = 0;
    setNextAutoRollInSec(null);
  }, [commitState]);

  const handleCompleteRound = useCallback(
    (summary?: CompletedRoundSummary) => {
      const randoms = {
        perkTriggerRoll: Math.random(),
        antiPerkTriggerRoll: Math.random(),
        antiPerkIndex: Math.floor(Math.random() * 20),
      };

      applyTransition((prev) => completeRound(prev, summary, installedRounds, randoms));

      const nextPhase: AnimPhase = { kind: "idle" };
      animPhaseRef.current = nextPhase;
      setAnimPhase(nextPhase);
      turnTimerElapsedRef.current = 0;
      setNextAutoRollInSec(null);
    },
    [applyTransition, installedRounds]
  );

  const handleReportCum = useCallback(() => {
    applyTransition((prev) => reportPlayerCum(prev));

    const nextPhase: AnimPhase = { kind: "idle" };
    animPhaseRef.current = nextPhase;
    setAnimPhase(nextPhase);
    setNextAutoRollInSec(null);
    setPathChoiceRemainingMs(null);
    turnTimerElapsedRef.current = 0;
    pathChoiceElapsedRef.current = 0;
  }, [applyTransition]);

  const handleSelectPathEdge = useCallback(
    (edgeId: string) => {
      const randoms = {
        antiPerkTriggerRoll: Math.random(),
        antiPerkIndex: Math.floor(Math.random() * 20),
        perkChoicesRolls: [Math.random(), Math.random(), Math.random()],
      };

      const nextState = applyTransition((prev) =>
        selectPathEdge(prev, edgeId, installedRounds, randoms)
      );
      setPathChoiceRemainingMs(null);
      pathChoiceElapsedRef.current = 0;

      const path = toPathIndices(nextState);
      const gateStepIndices = toGateStepIndices(nextState);
      if (path.length > 0 && !shouldSkipDiceAnimation(nextState)) {
        playTokenStepSound();
        const nextAnim: AnimPhase = {
          kind: "movingToken",
          playerIndex: nextState.currentPlayerIndex,
          path,
          gateStepIndices,
          stepIndex: 0,
          stepElapsed: 0,
        };
        commitAnimPhase(nextAnim);
        return;
      }

      commitAnimPhase(resolvePostTraversalPhase(nextState));
    },
    [
      applyTransition,
      commitAnimPhase,
      installedRounds,
      resolvePostTraversalPhase,
      shouldSkipDiceAnimation,
      toGateStepIndices,
      toPathIndices,
    ]
  );

  const handleResolvePathChoiceTimeout = useCallback(() => {
    const randoms = {
      pathChoiceRoll: Math.random(),
      antiPerkTriggerRoll: Math.random(),
      antiPerkIndex: Math.floor(Math.random() * 20),
      perkChoicesRolls: [Math.random(), Math.random(), Math.random()],
    };

    const nextState = applyTransition((prev) =>
      resolvePathChoiceTimeout(prev, installedRounds, randoms)
    );
    setPathChoiceRemainingMs(null);
    pathChoiceElapsedRef.current = 0;

    const path = toPathIndices(nextState);
    const gateStepIndices = toGateStepIndices(nextState);
    if (path.length > 0 && !shouldSkipDiceAnimation(nextState)) {
      playTokenStepSound();
      const nextAnim: AnimPhase = {
        kind: "movingToken",
        playerIndex: nextState.currentPlayerIndex,
        path,
        gateStepIndices,
        stepIndex: 0,
        stepElapsed: 0,
      };
      commitAnimPhase(nextAnim);
      return;
    }

    commitAnimPhase(resolvePostTraversalPhase(nextState));
  }, [
    applyTransition,
    commitAnimPhase,
    installedRounds,
    resolvePostTraversalPhase,
    shouldSkipDiceAnimation,
    toGateStepIndices,
    toPathIndices,
  ]);

  const handleSelectPerk = useCallback(
    (perkId: string, options?: { applyDirectly?: boolean }) => {
      const nextState = applyTransition((prev) => selectPerk(prev, perkId, options));
      playPerkActionSound();

      commitAnimPhase(resolvePostTraversalPhase(nextState));
    },
    [applyTransition, commitAnimPhase, resolvePostTraversalPhase]
  );

  const handleSkipPerk = useCallback(() => {
    const nextState = applyTransition((prev) => skipPerkSelection(prev));
    playPerkActionSound();

    commitAnimPhase(resolvePostTraversalPhase(nextState));
  }, [applyTransition, commitAnimPhase, resolvePostTraversalPhase]);

  const handleApplyExternalPerk = useCallback(
    (input: { targetPlayerId: string; perkId: string; sourceLabel?: string }) => {
      applyTransition((prev) => applyPerkByIdToPlayer(prev, input));
      playPerkActionSound();
    },
    [applyTransition]
  );

  const handleApplyInventoryItemToSelf = useCallback(
    (input: { playerId: string; itemId: string }) => {
      applyTransition((prev) => applyInventoryItemToSelf(prev, input));
      playPerkActionSound();
    },
    [applyTransition]
  );

  const handleConsumeInventoryItem = useCallback(
    (input: { playerId: string; itemId: string; reason?: string }) => {
      applyTransition((prev) => consumeInventoryItem(prev, input));
    },
    [applyTransition]
  );

  const handleAdjustPlayerMoney = useCallback(
    (input: { playerId: string; delta: number; reason?: string }) => {
      applyTransition((prev) => adjustPlayerMoney(prev, input));
    },
    [applyTransition]
  );

  const handleUseRoundControl = useCallback(
    (input: { playerId: string; control: "pause" | "skip" }) => {
      applyTransition((prev) => useRoundControl(prev, input));
      playPerkActionSound();
    },
    [applyTransition]
  );

  const handleConsumeAntiPerkById = useCallback(
    (input: { playerId: string; perkId: string; reason?: string }) => {
      applyTransition((prev) => consumeAntiPerkById(prev, input));
    },
    [applyTransition]
  );

  const tickAnim = useCallback(
    (dt: number): AnimPhase => {
      const phase = animPhaseRef.current;
      let s = stateRef.current;
      if (dt > 0) {
        s = commitState(advanceAutomationClock(s, dt * 1000), { syncPathChoice: false });
      }
      const currentPlayer = s.players[s.currentPlayerIndex];
      if ((currentPlayer?.currentNodeId ?? null) !== stayNodeIdRef.current) {
        stayNodeIdRef.current = currentPlayer?.currentNodeId ?? null;
        stayElapsedMsRef.current = 0;
        stayFireCountByRuleKeyRef.current = {};
      }
      const hasBoardSequenceAntiPerk = Boolean(
        !s.activeRound &&
        !s.pendingPathChoice &&
        !s.pendingPerkSelection &&
        currentPlayer &&
        ["milker", "jackhammer"].some((id) => currentPlayer.antiPerks.includes(id))
      );

      const canCountdownRun =
        (phase.kind === "idle" || phase.kind === "perkReveal") &&
        !s.activeRound &&
        !s.pendingPathChoice &&
        !hasBoardSequenceAntiPerk &&
        s.sessionPhase !== "completed";

      if (canCountdownRun) {
        if (turnTimerElapsedRef.current === 0) {
          s = commitState(
            appendAutomationEvent(s, {
              kind: "session.timer",
              playerId: currentPlayer?.id,
              nodeId: currentPlayer?.currentNodeId,
              timer: "restPauseStarted",
            }),
            { syncPathChoice: false }
          );
        }
        if (s.restTimerPaused) {
          const pauseSec = resolveEffectiveRestPauseMs(s) / 1000;
          const remaining = Math.max(0, pauseSec - turnTimerElapsedRef.current);
          setNextAutoRollInSec(remaining);
        } else {
          turnTimerElapsedRef.current += dt;
          const pauseSec = resolveEffectiveRestPauseMs(s) / 1000;
          const remaining = Math.max(0, pauseSec - turnTimerElapsedRef.current);
          setNextAutoRollInSec(remaining);

          if (turnTimerElapsedRef.current >= pauseSec) {
            s = commitState(
              appendAutomationEvent(s, {
                kind: "session.timer",
                playerId: currentPlayer?.id,
                nodeId: currentPlayer?.currentNodeId,
                timer: "restPauseElapsed",
              }),
              { syncPathChoice: false }
            );
            turnTimerElapsedRef.current = 0;
            setNextAutoRollInSec(null);

            let nextState = s;
            if (s.pendingPerkSelection) {
              nextState = skipPerkSelection(s);
              commitState(nextState);
            }

            if (
              shouldAutoStartQueuedRound(nextState) &&
              !nextState.pendingPerkSelection &&
              !nextState.activeRound
            ) {
              const resolvedState = maybeStartQueuedRoundImmediately(nextState);
              if (!resolvedState.queuedRound) {
                return commitAnimPhase({ kind: "idle" });
              }
              playRoundStartSound();
              const next = createRoundCountdownPhase(
                resolvedState.config,
                resolvedState.queuedRound
              );
              return commitAnimPhase(next);
            }

            if (
              nextState.sessionPhase === "normal" &&
              !nextState.activeRound &&
              !nextState.pendingPerkSelection &&
              !nextState.pendingPathChoice
            ) {
              if (shouldSkipDiceAnimation(nextState)) {
                const rolledState = rollTurn(nextState, installedRounds);
                commitState(rolledState);
                playDiceResultSound();
                return commitAnimPhase(resolvePostTraversalPhase(rolledState));
              }
              playDiceRollStartSound();
              return queueRollPhase(
                nextState.players[nextState.currentPlayerIndex]?.stats.diceMin ?? 1,
                nextState.players[nextState.currentPlayerIndex]?.stats.diceMax ?? 6
              );
            }
          }
        }
      } else {
        setNextAutoRollInSec(null);
      }

      if (
        phase.kind === "idle" &&
        currentPlayer &&
        !s.activeRound &&
        !s.pendingPathChoice &&
        !s.pendingPerkSelection
      ) {
        stayElapsedMsRef.current += dt * 1000;
        const stayRules =
          s.config.automations?.filter(
            (
              rule
            ): rule is NonNullable<GameState["config"]["automations"]>[number] & {
              trigger: {
                kind: "node.stay";
                nodeId?: string;
                elapsedMs: number;
                repeatMode: "once" | "repeat";
              };
            } => rule.trigger.kind === "node.stay" && rule.enabled
          ) ?? [];
        for (const rule of stayRules) {
          if (rule.scope.kind === "node" && rule.scope.nodeId !== currentPlayer.currentNodeId)
            continue;
          if (rule.trigger.nodeId && rule.trigger.nodeId !== currentPlayer.currentNodeId) continue;
          const threshold = Math.max(1, rule.trigger.elapsedMs);
          const fireKey = `${rule.id}:${currentPlayer.currentNodeId}`;
          const previousCount = stayFireCountByRuleKeyRef.current[fireKey] ?? 0;
          const nextCount =
            rule.trigger.repeatMode === "repeat"
              ? Math.floor(stayElapsedMsRef.current / threshold)
              : stayElapsedMsRef.current >= threshold
                ? 1
                : 0;
          if (nextCount > previousCount) {
            stayFireCountByRuleKeyRef.current[fireKey] = nextCount;
            s = commitState(
              appendAutomationEvent(s, {
                kind: "node.stay",
                playerId: currentPlayer.id,
                nodeId: currentPlayer.currentNodeId,
                elapsedMs: Math.floor(stayElapsedMsRef.current),
                repeatMode: rule.trigger.repeatMode,
              }),
              { syncPathChoice: false }
            );
          }
        }
      } else {
        stayElapsedMsRef.current = 0;
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
        const newDisplay =
          stepIndex >= totalSteps - 1 ? phase.finalValue : diceMin + (stepIndex % range);

        if (newElapsed >= DICE_ROLL_DURATION) {
          const nextState = rollTurn(s, installedRounds, phase.finalValue);
          const roll = nextState.lastRoll ?? phase.finalValue;
          const path = toPathIndices(nextState);
          const gateStepIndices = toGateStepIndices(nextState);

          commitState(nextState);
          playDiceResultSound();

          if (shouldSkipDiceAnimation(nextState)) {
            return commitAnimPhase(resolvePostTraversalPhase(nextState));
          }

          const next: AnimPhase = {
            kind: "diceResultReveal",
            elapsed: 0,
            value: roll,
            playerIndex: s.currentPlayerIndex,
            path,
            gateStepIndices,
          };
          return commitAnimPhase(next);
        }

        const next: AnimPhase = {
          kind: "rollingDice",
          elapsed: newElapsed,
          displayValue: newDisplay,
          finalValue: phase.finalValue,
        };
        return commitAnimPhase(next);
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
              gateStepIndices: phase.gateStepIndices,
              stepIndex: 0,
              stepElapsed: 0,
            };
            return commitAnimPhase(next);
          }

          return commitAnimPhase({ kind: "idle" });
        }
        const next: AnimPhase = { ...phase, elapsed: newElapsed };
        return commitAnimPhase(next);
      }

      if (phase.kind === "movingToken") {
        const newStepElapsed = phase.stepElapsed + dt;

        if (newStepElapsed >= STEP_DURATION) {
          if (phase.gateStepIndices.includes(phase.stepIndex)) {
            playGatePassSound();
          }
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
              const resolvedState = maybeStartQueuedRoundImmediately(nextS);
              next = resolvedState.queuedRound
                ? createRoundCountdownPhase(resolvedState.config, resolvedState.queuedRound)
                : { kind: "idle" };
            } else {
              next = { kind: "landingEffect", elapsed: 0 };
            }
            return commitAnimPhase(next);
          }

          playTokenStepSound();

          const next: AnimPhase = {
            ...phase,
            stepIndex: nextStepIndex,
            stepElapsed: 0,
          };
          return commitAnimPhase(next);
        }

        const next: AnimPhase = {
          ...phase,
          stepElapsed: newStepElapsed,
        };
        return commitAnimPhase(next);
      }

      if (phase.kind === "landingEffect") {
        const newElapsed = phase.elapsed + dt;
        if (newElapsed >= LANDING_DURATION) {
          return commitAnimPhase({ kind: "idle" });
        }
        const next: AnimPhase = { kind: "landingEffect", elapsed: newElapsed };
        return commitAnimPhase(next);
      }

      if (phase.kind === "roundCountdown") {
        const newElapsed = phase.elapsed + dt;
        const remaining = Math.max(0, phase.duration - newElapsed);
        if (newElapsed >= phase.duration) {
          applyTransition((prev) => triggerQueuedRound(prev));
          const next: AnimPhase = { kind: "idle" };
          commitAnimPhase(next);
          turnTimerElapsedRef.current = 0;
          setNextAutoRollInSec(null);
          return next;
        }

        const next: AnimPhase = {
          kind: "roundCountdown",
          elapsed: newElapsed,
          remaining,
          duration: phase.duration,
        };
        return commitAnimPhase(next);
      }

      if (phase.kind === "perkReveal") {
        const currentS = stateRef.current;
        if (!currentS.pendingPerkSelection) {
          return commitAnimPhase({ kind: "idle" });
        }
        const newElapsed = phase.elapsed + dt;
        if (newElapsed >= PERK_REVEAL_DURATION) {
          return phase;
        }
        const next: AnimPhase = { kind: "perkReveal", elapsed: newElapsed };
        return commitAnimPhase(next);
      }

      if (phase.kind === "idle") {
        if (!canCountdownRun) {
          turnTimerElapsedRef.current = 0;
        }
      }

      return phase;
    },
    [
      applyTransition,
      commitState,
      handleResolvePathChoiceTimeout,
      installedRounds,
      resolvePostTraversalPhase,
      maybeStartQueuedRoundImmediately,
      queueRollPhase,
      shouldSkipDiceAnimation,
      toPathIndices,
      toGateStepIndices,
    ]
  );

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
