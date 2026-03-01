import type { AutomationRuntimeEvent, GameState } from "../types";
import { appendAutomationEvent } from "./state";

export function enqueueAutomationTestEvent(
  state: GameState,
  event: Omit<AutomationRuntimeEvent, "id" | "timestampMs">
): GameState {
  return appendAutomationEvent(state, event);
}
