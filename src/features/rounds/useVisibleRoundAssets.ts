import { useEffect, useMemo, useState } from "react";
import type { InstalledRoundCardAssets } from "../../services/db";
import {
  getInstalledRoundCardAssetsCached,
  peekInstalledRoundCardAssetsCached,
} from "../../services/installedRoundsCache";

export function useVisibleRoundAssets({
  visibleRoundIds,
  selectedRoundId,
  includeDisabled,
}: {
  visibleRoundIds: string[];
  selectedRoundId: string | null;
  includeDisabled: boolean;
}) {
  const [fetchedCardAssetsState, setFetchedCardAssetsState] = useState<{
    includeDisabled: boolean;
    entries: Map<string, InstalledRoundCardAssets>;
  }>({
    includeDisabled,
    entries: new Map(),
  });

  const requestedRoundIds = useMemo(() => {
    const ids = [...visibleRoundIds];
    if (selectedRoundId && !ids.includes(selectedRoundId)) {
      ids.unshift(selectedRoundId);
    }
    return [...new Set(ids.filter((id) => id.trim().length > 0))];
  }, [selectedRoundId, visibleRoundIds]);

  const cachedCardAssetsByRoundId = useMemo(() => {
    const entries = peekInstalledRoundCardAssetsCached(requestedRoundIds, includeDisabled);
    return new Map(entries.map((entry) => [entry.roundId, entry] as const));
  }, [includeDisabled, requestedRoundIds]);

  const cardAssetsByRoundId = useMemo(() => {
    const next = new Map(cachedCardAssetsByRoundId);
    const fetchedEntries =
      fetchedCardAssetsState.includeDisabled === includeDisabled
        ? fetchedCardAssetsState.entries
        : new Map<string, InstalledRoundCardAssets>();
    for (const [roundId, entry] of fetchedEntries) {
      next.set(roundId, entry);
    }
    return next;
  }, [
    cachedCardAssetsByRoundId,
    fetchedCardAssetsState.entries,
    fetchedCardAssetsState.includeDisabled,
    includeDisabled,
  ]);

  useEffect(() => {
    if (requestedRoundIds.length === 0) {
      return;
    }

    const cachedRoundIds = new Set(cachedCardAssetsByRoundId.keys());
    const missingRoundIds = requestedRoundIds.filter((roundId) => !cachedRoundIds.has(roundId));
    if (missingRoundIds.length === 0) {
      return;
    }

    let cancelled = false;
    let timeoutId: number | null = null;
    let idleCallbackId: number | null = null;

    const loadMissingAssets = () => {
      void getInstalledRoundCardAssetsCached(missingRoundIds, includeDisabled)
        .then((entries) => {
          if (cancelled) {
            return;
          }
          setFetchedCardAssetsState((previous) => {
            const next =
              previous.includeDisabled === includeDisabled
                ? new Map(previous.entries)
                : new Map<string, InstalledRoundCardAssets>();
            for (const entry of entries) {
              next.set(entry.roundId, entry);
            }
            return {
              includeDisabled,
              entries: next,
            };
          });
        })
        .catch((error) => {
          console.error("Failed to load installed round card assets", error);
        });
    };

    if (typeof window !== "undefined" && typeof window.requestIdleCallback === "function") {
      idleCallbackId = window.requestIdleCallback(loadMissingAssets, { timeout: 180 });
    } else {
      timeoutId = window.setTimeout(loadMissingAssets, 0);
    }

    return () => {
      cancelled = true;
      if (idleCallbackId !== null && typeof window.cancelIdleCallback === "function") {
        window.cancelIdleCallback(idleCallbackId);
      }
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [cachedCardAssetsByRoundId, includeDisabled, requestedRoundIds]);

  return cardAssetsByRoundId;
}
