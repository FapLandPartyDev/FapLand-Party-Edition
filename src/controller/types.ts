import type React from "react";

export type ControllerAction =
  | "UP"
  | "DOWN"
  | "LEFT"
  | "RIGHT"
  | "PRIMARY"
  | "SECONDARY"
  | "ACTION_X"
  | "ACTION_Y"
  | "LB"
  | "RB"
  | "START"
  | "BACK";

export type ControllerSurfaceOptions = {
  id: string;
  scopeRef?: React.RefObject<HTMLElement | null>;
  priority?: number;
  enabled?: boolean;
  initialFocusId?: string;
  onBeforeDomAction?: (action: ControllerAction) => boolean | void;
  onBack?: () => boolean | void;
  onUnhandledAction?: (action: ControllerAction) => boolean | void;
};
