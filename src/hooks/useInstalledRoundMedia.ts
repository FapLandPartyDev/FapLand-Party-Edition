import { useCallback, useEffect, useRef, useState } from "react";
import type { InstalledRoundMediaResources } from "../services/db";
import { getRoundMediaResourcesCached } from "../services/installedRoundsCache";

export function useInstalledRoundMedia(roundId: string | null, includeDisabled = false) {
  const [mediaResources, setMediaResources] = useState<InstalledRoundMediaResources | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const activeRoundIdRef = useRef<string | null>(roundId);

  useEffect(() => {
    activeRoundIdRef.current = roundId;
    setMediaResources(null);
    setIsLoading(false);
  }, [roundId]);

  const loadMediaResources = useCallback(async () => {
    if (!roundId) {
      setMediaResources(null);
      return null;
    }
    if (mediaResources?.roundId === roundId) {
      return mediaResources;
    }

    setIsLoading(true);
    try {
      const next = await getRoundMediaResourcesCached(roundId, includeDisabled);
      if (activeRoundIdRef.current === roundId) {
        setMediaResources(next);
      }
      return next;
    } finally {
      if (activeRoundIdRef.current === roundId) {
        setIsLoading(false);
      }
    }
  }, [includeDisabled, mediaResources, roundId]);

  return {
    mediaResources,
    isLoading,
    loadMediaResources,
  };
}
