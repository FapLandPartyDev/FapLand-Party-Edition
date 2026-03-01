import { getPerkById } from "../data/perks";
import { adjustPlayerMoney, applyPerkByIdToPlayer, consumeAntiPerkById } from "../engine";
import { showGlobalToast } from "../../components/ui/ToastHost";
import type { AutomationActionStep, AutomationRule } from "./schema";
import type { AutomationRuntimeEvent, GameState, PlayerState } from "../types";
import { getMatchingAutomationRules, getRuleCooldownMs } from "./evaluate";
import { applyGraphMutationAction } from "./graphMutations";

const MAX_AUTOMATION_EXECUTIONS_PER_PASS = 25;

function currentPlayer(state: GameState): PlayerState | null {
  return state.players[state.currentPlayerIndex] ?? null;
}

function setRuleCooldown(state: GameState, rule: AutomationRule): GameState {
  const cooldownMs = getRuleCooldownMs(state, rule);
  if (cooldownMs <= 0) return state;
  return {
    ...state,
    ruleCooldownsById: {
      ...state.ruleCooldownsById,
      [rule.id]: state.automationState.nowMs + cooldownMs,
    },
  };
}

function scheduleStep(
  state: GameState,
  ruleId: string,
  stepIndex: number,
  delayMs: number,
  event: AutomationRuntimeEvent
): GameState {
  return {
    ...state,
    automationState: {
      ...state.automationState,
      scheduledSteps: [
        ...state.automationState.scheduledSteps,
        {
          executionId: `${ruleId}:${event.id}:${stepIndex}`,
          ruleId,
          stepIndex,
          runAtMs: state.automationState.nowMs + Math.max(0, delayMs),
          event,
        },
      ],
    },
  };
}

function withCurrentPlayer(
  state: GameState,
  updater: (player: PlayerState) => PlayerState
): GameState {
  const player = currentPlayer(state);
  if (!player) return state;
  return {
    ...state,
    players: state.players.map((entry) => (entry.id === player.id ? updater(entry) : entry)),
  };
}

function applyImmediateAction(
  state: GameState,
  action: AutomationActionStep["action"]
): { state: GameState; error?: string } {
  switch (action.kind) {
    case "timer.pauseRest":
      return { state: { ...state, restTimerPaused: true } };
    case "timer.resumeRest":
      return { state: { ...state, restTimerPaused: false } };
    case "timer.setRestRemainingMs":
      return {
        state: {
          ...state,
          restTimerRemainingMsOverride: Math.max(0, action.remainingMs),
        },
      };
    case "player.grantPauseCharge":
      return {
        state: withCurrentPlayer(state, (player) => ({
          ...player,
          roundControl: {
            ...player.roundControl,
            pauseCharges: Math.max(0, (player.roundControl?.pauseCharges ?? 0) + action.amount),
            skipCharges: Math.max(0, player.roundControl?.skipCharges ?? 0),
          },
        })),
      };
    case "player.grantSkipCharge":
      return {
        state: withCurrentPlayer(state, (player) => ({
          ...player,
          roundControl: {
            ...player.roundControl,
            pauseCharges: Math.max(0, player.roundControl?.pauseCharges ?? 0),
            skipCharges: Math.max(0, (player.roundControl?.skipCharges ?? 0) + action.amount),
          },
        })),
      };
    case "player.adjustMoney": {
      const player = currentPlayer(state);
      if (!player) return { state };
      return {
        state: adjustPlayerMoney(state, {
          playerId: player.id,
          delta: action.amount,
          reason: "Automation adjusted money.",
        }),
      };
    }
    case "player.adjustScore":
      return {
        state: withCurrentPlayer(state, (player) => ({
          ...player,
          score: Math.max(0, player.score + action.amount),
        })),
      };
    case "player.applyPerk": {
      const player = currentPlayer(state);
      if (!player) return { state };
      return {
        state: applyPerkByIdToPlayer(state, {
          targetPlayerId: player.id,
          perkId: action.perkId,
          sourceLabel: "Automation",
        }),
      };
    }
    case "player.removePerk":
      return {
        state: withCurrentPlayer(state, (player) => ({
          ...player,
          perks: player.perks.filter((perkId) => perkId !== action.perkId),
        })),
      };
    case "player.applyAntiPerk": {
      const player = currentPlayer(state);
      const perk = getPerkById(action.perkId);
      if (!player || !perk) return { state, error: `Unknown anti-perk ${action.perkId}.` };
      return {
        state: applyPerkByIdToPlayer(state, {
          targetPlayerId: player.id,
          perkId: action.perkId,
          sourceLabel: "Automation",
        }),
      };
    }
    case "player.removeAntiPerk": {
      const player = currentPlayer(state);
      if (!player) return { state };
      return {
        state: consumeAntiPerkById(state, {
          playerId: player.id,
          perkId: action.perkId,
          reason: "Removed by automation.",
        }),
      };
    }
    case "music.playTrack":
      return {
        state: {
          ...state,
          runtimeMusicState: {
            ...state.runtimeMusicState,
            currentTrackId: action.trackId,
            currentTrackName:
              state.config.playlistMusic?.tracks.find((track) => track.id === action.trackId)
                ?.name ?? action.trackId,
            isPlaying: true,
          },
        },
      };
    case "music.pause":
      return {
        state: {
          ...state,
          runtimeMusicState: { ...state.runtimeMusicState, isPlaying: false },
        },
      };
    case "music.resume":
      return {
        state: {
          ...state,
          runtimeMusicState: {
            ...state.runtimeMusicState,
            isPlaying: Boolean(state.runtimeMusicState.currentTrackId),
          },
        },
      };
    case "music.stop":
      return {
        state: {
          ...state,
          runtimeMusicState: {
            ...state.runtimeMusicState,
            currentTrackId: null,
            currentTrackName: null,
            isPlaying: false,
          },
        },
      };
    case "music.nextTrack": {
      const tracks = state.config.playlistMusic?.tracks ?? [];
      if (tracks.length === 0) return { state };
      const currentIndex = tracks.findIndex(
        (track) => track.id === state.runtimeMusicState.currentTrackId
      );
      const nextTrack = tracks[(currentIndex + 1 + tracks.length) % tracks.length] ?? tracks[0]!;
      return {
        state: {
          ...state,
          runtimeMusicState: {
            ...state.runtimeMusicState,
            currentTrackId: nextTrack.id,
            currentTrackName: nextTrack.name,
            isPlaying: true,
          },
        },
      };
    }
    case "music.setPlaylistLoop":
      return {
        state: {
          ...state,
          runtimeMusicState: { ...state.runtimeMusicState, loop: action.loop },
        },
      };
    case "background.setPreset":
      return {
        state: {
          ...state,
          runtimeMapOverrides: { backgroundOverride: action.preset },
        },
      };
    case "background.clearOverride":
      return {
        state: {
          ...state,
          runtimeMapOverrides: { backgroundOverride: null },
        },
      };
    case "ui.showToast":
      showGlobalToast(action.message, action.variant ?? "info");
      return { state };
    case "graph.addNode":
    case "graph.removeNode":
    case "graph.patchNode":
    case "graph.addEdge":
    case "graph.removeEdge":
    case "graph.patchEdge":
    case "graph.setStartNode":
      return applyGraphMutationAction(state, action);
    case "rule.enable":
      return {
        state: {
          ...state,
          automationRuleOverrides: {
            ...state.automationRuleOverrides,
            [action.ruleId]: {
              ...state.automationRuleOverrides[action.ruleId],
              enabled: true,
            },
          },
        },
      };
    case "rule.disable":
      return {
        state: {
          ...state,
          automationRuleOverrides: {
            ...state.automationRuleOverrides,
            [action.ruleId]: {
              ...state.automationRuleOverrides[action.ruleId],
              enabled: false,
            },
          },
        },
      };
    case "rule.setCooldownMs":
      return {
        state: {
          ...state,
          automationRuleOverrides: {
            ...state.automationRuleOverrides,
            [action.ruleId]: {
              ...state.automationRuleOverrides[action.ruleId],
              cooldownMs: action.cooldownMs,
            },
          },
        },
      };
  }

  return { state, error: "Unsupported automation action." };
}

function runRuleSteps(
  state: GameState,
  rule: AutomationRule,
  event: AutomationRuntimeEvent,
  startIndex = 0
): GameState {
  let nextState = setRuleCooldown(state, rule);
  for (let index = startIndex; index < rule.actions.length; index += 1) {
    const step = rule.actions[index]!;
    if ((step.delayMs ?? 0) > 0) {
      nextState = scheduleStep(nextState, rule.id, index, step.delayMs ?? 0, event);
      return nextState;
    }
    const result = applyImmediateAction(nextState, step.action);
    nextState = result.state;
    if (result.error) {
      nextState = {
        ...nextState,
        log: [`Automation ${rule.name}: ${result.error}`, ...nextState.log].slice(0, 40),
      };
      if (!step.continueOnError) {
        return nextState;
      }
    }
  }
  return nextState;
}

function continueScheduledRule(
  state: GameState,
  scheduled: GameState["automationState"]["scheduledSteps"][number]
): GameState {
  const rule = state.config.automations?.find((entry) => entry.id === scheduled.ruleId);
  if (!rule) return state;
  return runRuleSteps(state, rule, scheduled.event, scheduled.stepIndex);
}

export function runAutomationPass(state: GameState): GameState {
  let nextState = state;
  let executed = 0;

  while (executed < MAX_AUTOMATION_EXECUTIONS_PER_PASS) {
    const dueStep = nextState.automationState.scheduledSteps.find(
      (step) => step.runAtMs <= nextState.automationState.nowMs
    );
    if (dueStep) {
      nextState = {
        ...nextState,
        automationState: {
          ...nextState.automationState,
          scheduledSteps: nextState.automationState.scheduledSteps.filter(
            (step) => step.executionId !== dueStep.executionId
          ),
        },
      };
      nextState = continueScheduledRule(nextState, dueStep);
      executed += 1;
      continue;
    }

    const [event, ...rest] = nextState.automationState.queuedEvents;
    if (!event) break;
    nextState = {
      ...nextState,
      automationState: {
        ...nextState.automationState,
        queuedEvents: rest,
      },
    };
    const matches = getMatchingAutomationRules(nextState, event);
    for (const rule of matches) {
      nextState = runRuleSteps(nextState, rule, event);
      if (rule.stopAfterMatch) break;
    }
    executed += 1;
  }

  return {
    ...nextState,
    automationState: {
      ...nextState.automationState,
      executionCountThisTick: executed,
    },
  };
}
