import { useEffect, useMemo, useState } from "react";
import type { InstalledRoundCardAssets } from "../../services/db";
import {
  getInstalledRoundCardAssetsCached,
  peekInstalledRoundCardAssetsCached,
} from "../../services/installedRoundsCache";

const CARD_ASSET_FETCH_CHUNK_SIZE = 24;

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

    const loadMissingAssets = async () => {
      const chunks = chunkIds(missingRoundIds, CARD_ASSET_FETCH_CHUNK_SIZE);
      for (let index = 0; index < chunks.length; index += 1) {
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
        if (index < chunks.length - 1) {
          await new Promise((resolve) => window.setTimeout(resolve, 0));
        }
      }
    };

    void loadMissingAssets();

    return () => {
      cancelled = true;
    };
  }, [cachedCardAssetsByRoundId, includeDisabled, requestedRoundIds]);

  return cardAssetsByRoundId;
}
