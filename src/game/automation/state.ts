import type { AutomationRuntimeEvent, AutomationState, GameState } from "../types";

export const MAX_RECENT_AUTOMATION_EVENTS = 25;

export function createInitialAutomationState(): AutomationState {
  return {
    queuedEvents: [],
    scheduledSteps: [],
    nowMs: 0,
    executionCountThisTick: 0,
  };
}

export function appendAutomationEvent(
  state: GameState,
  event: Omit<AutomationRuntimeEvent, "id" | "timestampMs">
): GameState {
  const nextEvent: AutomationRuntimeEvent = {
    id: `automation-event-${state.turn}-${state.automationState.nowMs}-${state.automationState.queuedEvents.length}`,
    timestampMs: state.automationState.nowMs,
    ...event,
  };
  return {
    ...state,
    automationState: {
      ...state.automationState,
      queuedEvents: [...state.automationState.queuedEvents, nextEvent],
    },
    recentAutomationEvents: [...state.recentAutomationEvents, nextEvent].slice(
      -MAX_RECENT_AUTOMATION_EVENTS
    ),
  };
}

export function advanceAutomationClock(state: GameState, deltaMs: number): GameState {
  return {
    ...state,
    automationState: {
      ...state.automationState,
      nowMs: Math.max(0, state.automationState.nowMs + Math.max(0, Math.floor(deltaMs))),
      executionCountThisTick: 0,
    },
  };
}
