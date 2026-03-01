import { useEffect } from "react";

type IdleScreenRoute = "home" | "settings" | "playlist-workshop";

export function useIdleScreenPerformance(
  route: IdleScreenRoute,
  options?: { reduceEffects?: boolean }
) {
  useEffect(() => {
    const body = document.body;
    const reduceEffects = options?.reduceEffects ?? true;

    const updateState = () => {
      if (reduceEffects) {
        body.classList.add("perf-reduced-effects");
      } else {
        body.classList.remove("perf-reduced-effects");
      }
    };

    const clearState = () => {
      body.classList.remove("perf-reduced-effects");
    };

    updateState();

    return () => {
      clearState();
    };
  }, [options?.reduceEffects, route]);
}
