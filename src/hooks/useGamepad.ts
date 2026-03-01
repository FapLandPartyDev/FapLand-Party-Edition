import { useCallback } from "react";
import { useControllerSubscription, type ControllerAction } from "../controller";

export type GamepadAction = "UP" | "DOWN" | "LEFT" | "RIGHT" | "A" | "B";

function toLegacyAction(action: ControllerAction): GamepadAction | null {
  switch (action) {
    case "UP":
    case "DOWN":
    case "LEFT":
    case "RIGHT":
      return action;
    case "PRIMARY":
      return "A";
    case "SECONDARY":
    case "BACK":
      return "B";
    default:
      return null;
  }
}

export const useGamepad = (onInput: (action: GamepadAction) => void) => {
  useControllerSubscription(
    useCallback(
      (action: ControllerAction) => {
        const legacyAction = toLegacyAction(action);
        if (legacyAction) {
          onInput(legacyAction);
        }
      },
      [onInput]
    )
  );
};
