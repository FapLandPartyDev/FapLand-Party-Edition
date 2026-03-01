import { useEffect, useState } from "react";
import { trpc } from "../services/trpc";
import {
  DEFAULT_FPS_COUNTER_ENABLED,
  FPS_COUNTER_ENABLED_EVENT,
  FPS_COUNTER_ENABLED_KEY,
  normalizeFpsCounterEnabled,
} from "../constants/experimentalFeatures";

function readCachedFpsCounterEnabled(): boolean | null {
  if (typeof window === "undefined") return null;

  const cached = window.localStorage.getItem(FPS_COUNTER_ENABLED_KEY);
  if (cached === "true") return true;
  if (cached === "false") return false;
  return null;
}

export function useFpsCounterState(): { enabled: boolean; resolved: boolean } {
  const cachedEnabled = readCachedFpsCounterEnabled();
  const [state, setState] = useState<{ enabled: boolean; resolved: boolean }>(() => ({
    enabled: cachedEnabled ?? DEFAULT_FPS_COUNTER_ENABLED,
    resolved: cachedEnabled !== null,
  }));

  useEffect(() => {
    let cancelled = false;
    trpc.store.get
      .query({ key: FPS_COUNTER_ENABLED_KEY })
      .then((result) => {
        if (cancelled) return;

        const enabled = normalizeFpsCounterEnabled(result);
        window.localStorage.setItem(FPS_COUNTER_ENABLED_KEY, String(enabled));
        setState({ enabled, resolved: true });
      })
      .catch(() => {});

    const handler = (event: Event) => {
      const customEvent = event as CustomEvent<boolean>;
      window.localStorage.setItem(FPS_COUNTER_ENABLED_KEY, String(customEvent.detail));
      setState({ enabled: customEvent.detail, resolved: true });
    };

    window.addEventListener(FPS_COUNTER_ENABLED_EVENT, handler);
    return () => {
      cancelled = true;
      window.removeEventListener(FPS_COUNTER_ENABLED_EVENT, handler);
    };
  }, []);

  return state;
}

export function useFpsCounterEnabled(): boolean {
  return useFpsCounterState().enabled;
}
