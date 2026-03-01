import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef } from "react";
import {
  CONTROLLER_SUPPORT_ENABLED_EVENT,
  CONTROLLER_SUPPORT_ENABLED_KEY,
  normalizeControllerSupportEnabled,
} from "../constants/experimentalFeatures";
import { trpc } from "../services/trpc";
import {
  findInitialFocusable,
  focusElement,
  getSurfaceRoot,
  handleDomAction,
} from "./controllerDom";
import type { ControllerAction, ControllerSurfaceOptions } from "./types";

type RegisteredSurface = ControllerSurfaceOptions & {
  order: number;
};

const DEFAULT_SURFACE: RegisteredSurface = {
  id: "document-default-surface",
  order: Number.MIN_SAFE_INTEGER,
  priority: -1000,
};

type ControllerContextValue = {
  registerSurface: (surface: ControllerSurfaceOptions) => () => void;
  subscribe: (listener: (action: ControllerAction) => void) => () => void;
};

const defaultContextValue: ControllerContextValue = {
  registerSurface: () => () => {},
  subscribe: () => () => {},
};

const ControllerContext = createContext<ControllerContextValue>(defaultContextValue);

const BUTTON_REPEAT_DELAY_MS = 380;
const BUTTON_REPEAT_INTERVAL_MS = 120;

const ACTION_BUTTONS: Record<ControllerAction, number> = {
  PRIMARY: 0,
  SECONDARY: 1,
  ACTION_X: 2,
  ACTION_Y: 3,
  LB: 4,
  RB: 5,
  BACK: 8,
  START: 9,
  UP: 12,
  DOWN: 13,
  LEFT: 14,
  RIGHT: 15,
};

function getPressedActions(gamepad: Gamepad | null): Set<ControllerAction> {
  const actions = new Set<ControllerAction>();
  if (!gamepad) return actions;

  for (const [action, index] of Object.entries(ACTION_BUTTONS) as Array<
    [ControllerAction, number]
  >) {
    if (gamepad.buttons[index]?.pressed) {
      actions.add(action);
    }
  }

  const axisX = gamepad.axes[0] ?? 0;
  const axisY = gamepad.axes[1] ?? 0;
  if (axisX <= -0.5) actions.add("LEFT");
  if (axisX >= 0.5) actions.add("RIGHT");
  if (axisY <= -0.5) actions.add("UP");
  if (axisY >= 0.5) actions.add("DOWN");

  return actions;
}

function isRepeatableAction(action: ControllerAction): boolean {
  return (
    action === "UP" ||
    action === "DOWN" ||
    action === "LEFT" ||
    action === "RIGHT" ||
    action === "LB" ||
    action === "RB"
  );
}

function sortSurfaces(left: RegisteredSurface, right: RegisteredSurface): number {
  const priorityDiff = (right.priority ?? 0) - (left.priority ?? 0);
  if (priorityDiff !== 0) return priorityDiff;
  return right.order - left.order;
}

export function ControllerProvider({ children }: { children: React.ReactNode }) {
  const surfacesRef = useRef<RegisteredSurface[]>([]);
  const subscribersRef = useRef(new Set<(action: ControllerAction) => void>());
  const controllerSupportEnabledRef = useRef(false);
  const controllerSupportHydratedRef = useRef(false);
  const orderRef = useRef(0);
  const rafRef = useRef<number | null>(null);
  const startPollingRef = useRef<() => void>(() => undefined);
  const heldStateRef = useRef<
    Record<ControllerAction, { pressedAt: number; repeatedAt: number } | null>
  >({
    UP: null,
    DOWN: null,
    LEFT: null,
    RIGHT: null,
    PRIMARY: null,
    SECONDARY: null,
    ACTION_X: null,
    ACTION_Y: null,
    LB: null,
    RB: null,
    START: null,
    BACK: null,
  });
  const lastFocusedBySurfaceRef = useRef(new Map<string, HTMLElement>());

  const getActiveSurface = useCallback((): RegisteredSurface | null => {
    const surfaces = surfacesRef.current.filter((surface) => surface.enabled !== false);
    if (surfaces.length === 0) return DEFAULT_SURFACE;
    return [...surfaces].sort(sortSurfaces)[0] ?? DEFAULT_SURFACE;
  }, []);

  const ensureSurfaceFocus = useCallback((surface: RegisteredSurface | null): boolean => {
    if (!surface) return false;
    const root = getSurfaceRoot(surface);
    const activeElement =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (activeElement && root.contains(activeElement)) {
      return true;
    }

    const previous = lastFocusedBySurfaceRef.current.get(surface.id);
    if (previous && root.contains(previous)) {
      return focusElement(previous);
    }

    return focusElement(findInitialFocusable(root, surface.initialFocusId));
  }, []);

  const dispatchAction = useCallback(
    (action: ControllerAction) => {
      if (typeof document !== "undefined") {
        document.body.dataset.controllerActive = "true";
      }

      for (const listener of subscribersRef.current) {
        listener(action);
      }

      const surface = getActiveSurface();
      if (!surface) return;

      if (action === "START") {
        return;
      }

      ensureSurfaceFocus(surface);

      const handledBeforeDom = surface.onBeforeDomAction?.(action);
      if (handledBeforeDom) return;

      const handled = handleDomAction(surface, action);
      if (handled) return;

      if ((action === "SECONDARY" || action === "BACK") && surface.onBack) {
        const result = surface.onBack();
        if (result !== false) {
          return;
        }
      }

      surface.onUnhandledAction?.(action);
    },
    [ensureSurfaceFocus, getActiveSurface]
  );

  useEffect(() => {
    const handleFocusIn = (event: FocusEvent) => {
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (!target) return;
      for (const surface of surfacesRef.current) {
        const root = getSurfaceRoot(surface);
        if (root.contains(target)) {
          lastFocusedBySurfaceRef.current.set(surface.id, target);
        }
      }
    };

    document.addEventListener("focusin", handleFocusIn);
    return () => {
      document.removeEventListener("focusin", handleFocusIn);
    };
  }, []);

  useEffect(() => {
    let mounted = true;

    const loadControllerSupport = async () => {
      try {
        const stored = await trpc.store.get.query({ key: CONTROLLER_SUPPORT_ENABLED_KEY });
        if (mounted && !controllerSupportHydratedRef.current) {
          controllerSupportEnabledRef.current = normalizeControllerSupportEnabled(stored);
          startPollingRef.current();
        }
      } catch (error) {
        console.error("Failed to load controller support setting", error);
      }
    };

    const handleControllerSupportChanged = (event: Event) => {
      const nextValue =
        event instanceof CustomEvent ? normalizeControllerSupportEnabled(event.detail) : false;
      controllerSupportHydratedRef.current = true;
      controllerSupportEnabledRef.current = nextValue;
      startPollingRef.current();
    };

    void loadControllerSupport();
    window.addEventListener(CONTROLLER_SUPPORT_ENABLED_EVENT, handleControllerSupportChanged);

    return () => {
      mounted = false;
      window.removeEventListener(CONTROLLER_SUPPORT_ENABLED_EVENT, handleControllerSupportChanged);
    };
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;

      const eventTarget = event.target instanceof HTMLElement ? event.target : null;
      if (eventTarget?.closest('[data-controller-skip="true"]')) {
        return;
      }

      const activeElement = document.activeElement;
      const editableFocused =
        activeElement instanceof HTMLElement &&
        (activeElement.isContentEditable ||
          activeElement.tagName === "INPUT" ||
          activeElement.tagName === "TEXTAREA");

      let action: ControllerAction | null = null;

      switch (event.key) {
        case "ArrowUp":
          action = "UP";
          break;
        case "ArrowDown":
          action = "DOWN";
          break;
        case "ArrowLeft":
          action = "LEFT";
          break;
        case "ArrowRight":
          action = "RIGHT";
          break;
        case "Enter":
        case " ":
        case "Spacebar":
          action = "PRIMARY";
          break;
        case "Escape":
        case "Backspace":
          action = "SECONDARY";
          break;
        case "q":
        case "Q":
          action = "LB";
          break;
        case "e":
        case "E":
          action = "RB";
          break;
        case "x":
        case "X":
          action = "ACTION_X";
          break;
        case "c":
        case "C":
          action = "ACTION_Y";
          break;
        default:
          break;
      }

      if (!action) return;
      if (event.repeat) return;
      if (editableFocused && event.key === "Backspace") return;
      if (editableFocused && action !== "SECONDARY") return;

      event.preventDefault();
      dispatchAction(action);
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [dispatchAction]);

  useEffect(() => {
    let disposed = false;
    const clearHeldState = () => {
      for (const action of Object.keys(heldStateRef.current) as ControllerAction[]) {
        heldStateRef.current[action] = null;
      }
    };

    const tick = (timestamp: number) => {
      if (disposed || !controllerSupportEnabledRef.current || document.hidden) {
        rafRef.current = null;
        clearHeldState();
        return;
      }

      const gamepad = navigator.getGamepads?.().find((entry) => entry !== null) ?? null;
      if (!gamepad) {
        rafRef.current = null;
        clearHeldState();
        return;
      }
      const pressedActions = getPressedActions(gamepad);

      for (const action of Object.keys(heldStateRef.current) as ControllerAction[]) {
        const pressed = pressedActions.has(action);
        const heldState = heldStateRef.current[action];

        if (!pressed) {
          heldStateRef.current[action] = null;
          continue;
        }

        if (!heldState) {
          heldStateRef.current[action] = { pressedAt: timestamp, repeatedAt: timestamp };
          dispatchAction(action);
          continue;
        }

        if (!isRepeatableAction(action)) continue;
        if (timestamp - heldState.pressedAt < BUTTON_REPEAT_DELAY_MS) continue;
        if (timestamp - heldState.repeatedAt < BUTTON_REPEAT_INTERVAL_MS) continue;

        heldState.repeatedAt = timestamp;
        dispatchAction(action);
      }

      rafRef.current = window.requestAnimationFrame(tick);
    };

    const startPolling = () => {
      if (
        disposed ||
        rafRef.current !== null ||
        !controllerSupportEnabledRef.current ||
        document.hidden ||
        !navigator.getGamepads?.().some((entry) => entry !== null)
      ) {
        return;
      }
      rafRef.current = window.requestAnimationFrame(tick);
    };
    const stopPolling = () => {
      if (rafRef.current !== null) window.cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      clearHeldState();
    };
    const handleVisibilityChange = () => {
      if (document.hidden) stopPolling();
      else startPolling();
    };

    startPollingRef.current = startPolling;
    window.addEventListener("gamepadconnected", startPolling);
    window.addEventListener("gamepaddisconnected", startPolling);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    startPolling();

    return () => {
      disposed = true;
      startPollingRef.current = () => undefined;
      window.removeEventListener("gamepadconnected", startPolling);
      window.removeEventListener("gamepaddisconnected", startPolling);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      stopPolling();
    };
  }, [dispatchAction]);

  const registerSurface = useCallback((surface: ControllerSurfaceOptions) => {
    const registered: RegisteredSurface = {
      ...surface,
      order: ++orderRef.current,
    };

    surfacesRef.current = [
      ...surfacesRef.current.filter((entry) => entry.id !== surface.id),
      registered,
    ];

    return () => {
      surfacesRef.current = surfacesRef.current.filter((entry) => entry.id !== surface.id);
      lastFocusedBySurfaceRef.current.delete(surface.id);
    };
  }, []);

  const subscribe = useCallback((listener: (action: ControllerAction) => void) => {
    subscribersRef.current.add(listener);
    return () => {
      subscribersRef.current.delete(listener);
    };
  }, []);

  const value = useMemo<ControllerContextValue>(
    () => ({
      registerSurface,
      subscribe,
    }),
    [registerSurface, subscribe]
  );

  return <ControllerContext.Provider value={value}>{children}</ControllerContext.Provider>;
}

export function useControllerContext(): ControllerContextValue {
  return useContext(ControllerContext);
}
