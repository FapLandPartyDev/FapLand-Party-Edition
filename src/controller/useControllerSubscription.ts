import { useEffect } from "react";
import { useControllerContext } from "./ControllerProvider";
import type { ControllerAction } from "./types";

export function useControllerSubscription(listener: (action: ControllerAction) => void): void {
  const { subscribe } = useControllerContext();

  useEffect(() => subscribe(listener), [listener, subscribe]);
}
