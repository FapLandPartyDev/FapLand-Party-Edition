import { useEffect, useMemo, useState } from "react";
import type { InstalledRoundCardAssets } from "../../services/db";
import {
  getInstalledRoundCardAssetsCached,
  peekInstalledRoundCardAssetsCached,
} from "../../services/installedRoundsCache";

const CARD_ASSET_FETCH_CHUNK_SIZE = 4;
const CARD_ASSET_IDLE_TIMEOUT_MS = 500;

function chunkIds(ids: string[], chunkSize: number): string[][] {
  const chunks: string[][] = [];
  for (let index = 0; index < ids.length; index += chunkSize) {
    chunks.push(ids.slice(index, index + chunkSize));
  }
  return chunks;
}

export function useVisibleRoundAssets({
  visibleRoundIds,
  selectedRoundId,
  includeDisabled,
  isScrolling,
}: {
  visibleRoundIds: string[];
  selectedRoundId: string | null;
  includeDisabled: boolean;
  isScrolling: boolean;
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
    const loadableRoundIds =
      isScrolling && selectedRoundId
        ? requestedRoundIds.filter((roundId) => roundId === selectedRoundId)
        : isScrolling
          ? []
          : requestedRoundIds;
    if (loadableRoundIds.length === 0) {
      return;
    }

    const cachedRoundIds = new Set(cachedCardAssetsByRoundId.keys());
    const missingRoundIds = loadableRoundIds.filter((roundId) => !cachedRoundIds.has(roundId));
    if (missingRoundIds.length === 0) {
      return;
    }

    let cancelled = false;
    let idleCallbackId: number | null = null;
    let fallbackTimeoutId: number | null = null;

    const waitForIdle = () =>
      new Promise<void>((resolve) => {
        if (typeof window.requestIdleCallback === "function") {
          idleCallbackId = window.requestIdleCallback(
            () => {
              idleCallbackId = null;
              resolve();
            },
            { timeout: CARD_ASSET_IDLE_TIMEOUT_MS }
          );
          return;
        }
        fallbackTimeoutId = window.setTimeout(() => {
          fallbackTimeoutId = null;
          resolve();
        }, 32);
      });

    const loadMissingAssets = async () => {
      const chunks = chunkIds(missingRoundIds, CARD_ASSET_FETCH_CHUNK_SIZE);
      for (let index = 0; index < chunks.length; index += 1) {
        await waitForIdle();
        const chunk = chunks[index]!;
        if (cancelled) return;
        try {
          const entries = await getInstalledRoundCardAssetsCached(chunk, includeDisabled);
          if (cancelled) {
            return;
          }
          setFetchedCardAssetsState((previous) => {
            const next =
              previous.includeDisabled === includeDisabled
                ? new Map(previous.entries)
                : new Map<string, InstalledRoundCardAssets>();
            let changed = false;
            for (const entry of entries) {
              if (next.get(entry.roundId) === entry) continue;
              next.set(entry.roundId, entry);
              changed = true;
            }
            if (!changed) return previous;
            return {
              includeDisabled,
              entries: next,
            };
          });
        } catch (error) {
          console.error("Failed to load installed round card assets", error);
        }
      }
    };

    void loadMissingAssets();

    return () => {
      cancelled = true;
      if (idleCallbackId !== null && typeof window.cancelIdleCallback === "function") {
        window.cancelIdleCallback(idleCallbackId);
      }
      if (fallbackTimeoutId !== null) {
        window.clearTimeout(fallbackTimeoutId);
      }
    };
  }, [cachedCardAssetsByRoundId, includeDisabled, isScrolling, requestedRoundIds, selectedRoundId]);

  return cardAssetsByRoundId;
}
