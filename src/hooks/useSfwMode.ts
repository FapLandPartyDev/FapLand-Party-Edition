import { useEffect, useState } from "react";
import { trpc } from "../services/trpc";
import {
  DEFAULT_SFW_MODE_ENABLED,
  normalizeSfwModeEnabled,
  SFW_MODE_ENABLED_EVENT,
  SFW_MODE_ENABLED_KEY,
} from "../constants/experimentalFeatures";

function readCachedSfwMode(): boolean | null {
  if (typeof window === "undefined") return null;

  const cached = window.localStorage.getItem(SFW_MODE_ENABLED_KEY);
  if (cached === "true") return true;
  if (cached === "false") return false;
  return null;
}

export function useSfwModeState(): { enabled: boolean; resolved: boolean } {
  const cachedEnabled = readCachedSfwMode();
  const [state, setState] = useState<{ enabled: boolean; resolved: boolean }>(() => ({
    enabled: cachedEnabled ?? DEFAULT_SFW_MODE_ENABLED,
    resolved: cachedEnabled !== null,
  }));

  useEffect(() => {
    let cancelled = false;
    trpc.store.get
      .query({ key: SFW_MODE_ENABLED_KEY })
      .then((result) => {
        if (cancelled) return;

        const enabled = normalizeSfwModeEnabled(result);
        window.localStorage.setItem(SFW_MODE_ENABLED_KEY, String(enabled));
        setState({ enabled, resolved: true });
      })
      .catch(() => {});

    const handler = (event: Event) => {
      const customEvent = event as CustomEvent<boolean>;
      window.localStorage.setItem(SFW_MODE_ENABLED_KEY, String(customEvent.detail));
      setState({ enabled: customEvent.detail, resolved: true });
    };
    window.addEventListener(SFW_MODE_ENABLED_EVENT, handler);
    return () => {
      cancelled = true;
      window.removeEventListener(SFW_MODE_ENABLED_EVENT, handler);
    };
  }, []);

  return state;
}

export function useSfwMode(): boolean {
  return useSfwModeState().enabled;
}
