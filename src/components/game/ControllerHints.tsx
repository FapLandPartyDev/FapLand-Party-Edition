import { useEffect, useEffectEvent, useState } from "react";
import { useControllerSurface } from "../../controller";
import type { ControllerAction } from "../../controller/types";
import { playHoverSound } from "../../utils/audio";

type ControllerHintsProps = {
  contextId: string;
  hints: Array<{ label: string; action: ControllerAction }>;
  onHintSelect?: (hint: ControllerAction) => void;
  bottomClassName?: string;
  enabled?: boolean;
};

function getButtonLabel(action: ControllerAction): string {
  switch (action) {
    case "PRIMARY":
      return "A";
    case "SECONDARY":
      return "B";
    case "ACTION_X":
      return "X";
    case "ACTION_Y":
      return "Y";
    case "LB":
      return "LB";
    case "RB":
      return "RB";
    case "BACK":
      return "Back";
    case "START":
      return "Start";
    default:
      return action;
  }
}

function ControllerHints({
  contextId,
  hints,
  onHintSelect,
  bottomClassName = "bottom-4",
  enabled = true,
}: ControllerHintsProps) {
  const [hasController, setHasController] = useState(false);
  const updateHasController = useEffectEvent(() => {
    const gamepads = navigator.getGamepads?.();
    if (!gamepads) {
      setHasController(false);
      return;
    }
    setHasController(gamepads.some((gp) => gp !== null));
  });

  useEffect(() => {
    if (!enabled) {
      setHasController(false);
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;

    updateHasController();

    window.addEventListener("gamepadconnected", updateHasController);
    window.addEventListener("gamepaddisconnected", updateHasController);
    const intervalId = window.setInterval(updateHasController, 500);

    return () => {
      window.removeEventListener("gamepadconnected", updateHasController);
      window.removeEventListener("gamepaddisconnected", updateHasController);
      window.clearInterval(intervalId);
    };
  }, [enabled]);

  useControllerSurface({
    id: `controller-hints-${contextId}`,
    priority: 55,
    enabled: enabled && hasController,
  });

  if (!enabled || !hasController) return null;

  return (
    <div
      className={`pointer-events-none fixed right-4 z-[40] flex flex-col gap-1 ${bottomClassName}`}
    >
      {hints.map((hint) => (
        <button
          key={hint.label}
          type="button"
          data-controller-focus-id={`controller-hint-${contextId}-${hint.action}`}
          onClick={() => onHintSelect?.(hint.action)}
          onMouseEnter={() => playHoverSound()}
          onFocus={() => playHoverSound()}
          className="pointer-events-auto flex items-center gap-2 rounded-lg border border-white/20 bg-black/60 px-3 py-1.5 font-[family-name:var(--font-jetbrains-mono)] text-[10px] uppercase tracking-wider text-white transition-all hover:border-white/40 hover:bg-black/80"
        >
          <span className="flex h-5 w-5 items-center justify-center rounded bg-white/20 text-[9px] font-bold">
            {getButtonLabel(hint.action)}
          </span>
          <span className="text-white/80">{hint.label}</span>
        </button>
      ))}
    </div>
  );
}

export default ControllerHints;
