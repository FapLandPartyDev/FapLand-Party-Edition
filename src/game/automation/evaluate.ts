import type {
  AutomationCondition,
  AutomationConditionGroup,
  AutomationRule,
} from "./schema";
import type { AutomationRuntimeEvent, GameState } from "../types";

function compareNumeric(
  left: number,
  comparator: "eq" | "ne" | "gt" | "gte" | "lt" | "lte",
  right: number
): boolean {
  switch (comparator) {
    case "eq":
      return left === right;
    case "ne":
      return left !== right;
    case "gt":
      return left > right;
    case "gte":
      return left >= right;
    case "lt":
      return left < right;
    case "lte":
      return left <= right;
    default:
      return false;
  }
}

function isRuleEnabled(state: GameState, rule: AutomationRule): boolean {
  const override = state.automationRuleOverrides[rule.id];
  return override?.enabled ?? rule.enabled;
}

function resolveRuleCooldownMs(state: GameState, rule: AutomationRule): number {
  return state.automationRuleOverrides[rule.id]?.cooldownMs ?? rule.cooldownMs ?? 0;
}

export function isRuleOnCooldown(state: GameState, rule: AutomationRule): boolean {
  const until = state.ruleCooldownsById[rule.id] ?? 0;
  return until > state.automationState.nowMs;
}

export function doesTriggerMatch(rule: AutomationRule, event: AutomationRuntimeEvent): boolean {
  if (rule.trigger.kind !== event.kind) return false;
  switch (rule.trigger.kind) {
    case "node.enter":
    case "node.leave":
      return !rule.trigger.nodeId || rule.trigger.nodeId === event.nodeId;
    case "node.stay":
      return (
        (!rule.trigger.nodeId || rule.trigger.nodeId === event.nodeId) &&
        (event.elapsedMs ?? 0) >= rule.trigger.elapsedMs &&
        (!rule.trigger.repeatMode || rule.trigger.repeatMode === (event.repeatMode ?? "once"))
      );
    case "player.stateChanged":
      return rule.trigger.stateKey === event.stateKey;
    case "player.controlUsed":
      return !rule.trigger.control || rule.trigger.control === event.control;
    case "round.lifecycle":
      return rule.trigger.phase === event.roundPhase;
    case "music.stateChanged":
      return rule.trigger.state === event.musicState;
    case "session.timer":
      return rule.trigger.timer === event.timer;
    case "board.pathChoiceStarted":
    case "board.pathChoiceResolved":
      return true;
    default:
      return false;
  }
}

function evaluateCondition(state: GameState, event: AutomationRuntimeEvent, condition: AutomationCondition): boolean {
  const currentPlayer = state.players[state.currentPlayerIndex];
  const currentNodeId = currentPlayer?.currentNodeId ?? null;
  const currentTrackId = state.runtimeMusicState.currentTrackId;

  switch (condition.kind) {
    case "currentNode":
      return condition.comparator === "is"
        ? currentNodeId === condition.nodeId
        : currentNodeId !== condition.nodeId;
    case "triggerNode":
      return condition.comparator === "is"
        ? event.nodeId === condition.nodeId
        : event.nodeId !== condition.nodeId;
    case "hasPerk":
      return Boolean(currentPlayer?.perks.includes(condition.perkId));
    case "hasAntiPerk":
      return Boolean(currentPlayer?.antiPerks.includes(condition.perkId));
    case "playerMoney":
      return compareNumeric(currentPlayer?.money ?? 0, condition.comparator, condition.value);
    case "playerScore":
      return compareNumeric(currentPlayer?.score ?? 0, condition.comparator, condition.value);
    case "shieldRounds":
      return compareNumeric(
        currentPlayer?.shieldRoundsRemaining ?? 0,
        condition.comparator,
        condition.value
      );
    case "restRemainingMs": {
      const value = state.restTimerRemainingMsOverride ?? 0;
      return compareNumeric(value, condition.comparator, condition.value);
    }
    case "restState":
      return condition.state === "paused" ? state.restTimerPaused : !state.restTimerPaused;
    case "roundState":
      if (condition.state === "active") return Boolean(state.activeRound);
      if (condition.state === "queued") return Boolean(state.queuedRound);
      return !state.activeRound && !state.queuedRound;
    case "musicState":
      if (condition.state === "playing") return state.runtimeMusicState.isPlaying;
      if (condition.state === "paused") {
        return !state.runtimeMusicState.isPlaying && Boolean(state.runtimeMusicState.currentTrackId);
      }
      return !state.runtimeMusicState.isPlaying && !state.runtimeMusicState.currentTrackId;
    case "currentTrack":
      return condition.comparator === "is"
        ? currentTrackId === condition.trackId
        : currentTrackId !== condition.trackId;
    case "background":
      return condition.comparator === "isSet"
        ? Boolean(state.runtimeMapOverrides.backgroundOverride)
        : !state.runtimeMapOverrides.backgroundOverride;
    case "ruleCooldown": {
      const targetRule = condition.ruleId
        ? state.config.automations?.find((rule) => rule.id === condition.ruleId)
        : undefined;
      const active = targetRule ? isRuleOnCooldown(state, targetRule) : false;
      return condition.state === "active" ? active : !active;
    }
    default:
      return false;
  }
}

export function evaluateConditionGroup(
  state: GameState,
  event: AutomationRuntimeEvent,
  group: AutomationConditionGroup | undefined
): boolean {
  if (!group) return true;
  const values = group.conditions.map((entry) =>
    "operator" in entry
      ? evaluateConditionGroup(state, event, entry)
      : evaluateCondition(state, event, entry)
  );
  return group.operator === "all" ? values.every(Boolean) : values.some(Boolean);
}

export function getMatchingAutomationRules(
  state: GameState,
  event: AutomationRuntimeEvent
): AutomationRule[] {
  const rules = state.config.automations ?? [];
  return rules.filter((rule) => {
    if (!isRuleEnabled(state, rule)) return false;
    if (rule.scope.kind === "node" && rule.scope.nodeId !== event.nodeId) return false;
    if (isRuleOnCooldown(state, rule)) return false;
    if (!doesTriggerMatch(rule, event)) return false;
    return evaluateConditionGroup(state, event, rule.conditions);
  });
}

export function getRuleCooldownMs(state: GameState, rule: AutomationRule): number {
  return resolveRuleCooldownMs(state, rule);
}
