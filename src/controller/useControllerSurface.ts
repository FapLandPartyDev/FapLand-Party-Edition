import { useEffect } from "react";
import { useControllerContext } from "./ControllerProvider";
import type { ControllerSurfaceOptions } from "./types";

export function useControllerSurface(options: ControllerSurfaceOptions): void {
  const { registerSurface } = useControllerContext();

  useEffect(
    () => registerSurface(options),
    [
      options.enabled,
      options.id,
      options.initialFocusId,
      options.onBack,
      options.onUnhandledAction,
      options.priority,
      options.scopeRef,
      registerSurface,
    ]
  );
}
