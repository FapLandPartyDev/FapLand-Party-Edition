import { useCallback, useEffect, useMemo, useState } from "react";
import type { InstalledRoundCardAssets } from "../../services/db";
import {
  getInstalledRoundCardAssetsCached,
  invalidateInstalledRoundCardAssets,
  loadInstalledRoundPreviewImage,
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
  const [refreshRevision, setRefreshRevision] = useState(0);
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
    // refreshRevision deliberately forces a new cache read after targeted invalidation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [includeDisabled, refreshRevision, requestedRoundIds]);

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
    const cachedMissingPreviews = loadableRoundIds
      .map((id) => cachedCardAssetsByRoundId.get(id))
      .filter((entry): entry is InstalledRoundCardAssets => !!entry && !entry.previewImage);
    if (missingRoundIds.length === 0 && cachedMissingPreviews.length === 0) {
      return;
    }

    let cancelled = false;
    let idleCallbackId: number | null = null;
    let fallbackTimeoutId: number | null = null;
    let resolveIdle: (() => void) | null = null;

    const waitForIdle = () =>
      new Promise<void>((resolve) => {
        resolveIdle = resolve;
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
      const previewCandidates = [...cachedMissingPreviews];
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
          previewCandidates.push(...entries.filter((entry) => !entry.previewImage));
          setFetchedCardAssetsState((previous) => {
            const next =
              previous.includeDisabled === includeDisabled
                ? new Map([...previous.entries].filter(([id]) => requestedRoundIds.includes(id)))
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

      // Deliver all lightweight card assets first, then repair missing local
      // thumbnails one at a time, yielding between cards and stopping on scroll.
      for (const entry of previewCandidates) {
        await waitForIdle();
        if (cancelled) return;
        try {
          const updated = await loadInstalledRoundPreviewImage(entry, includeDisabled);
          if (cancelled) return;
          if (updated === entry) continue;
          setFetchedCardAssetsState((previous) => {
            if (previous.includeDisabled !== includeDisabled) return previous;
            const next = new Map(
              [...previous.entries].filter(([id]) => requestedRoundIds.includes(id))
            );
            next.set(updated.roundId, updated);
            return { includeDisabled, entries: next };
          });
        } catch (error) {
          console.error("Failed to generate installed round preview", error);
        }
      }
    };

    void loadMissingAssets();

    return () => {
      cancelled = true;
      resolveIdle?.();
      if (idleCallbackId !== null && typeof window.cancelIdleCallback === "function") {
        window.cancelIdleCallback(idleCallbackId);
      }
      if (fallbackTimeoutId !== null) {
        window.clearTimeout(fallbackTimeoutId);
      }
    };
  }, [cachedCardAssetsByRoundId, includeDisabled, isScrolling, requestedRoundIds, selectedRoundId]);

  const refreshRoundAssets = useCallback((roundIds: string[]) => {
    const uniqueRoundIds = [...new Set(roundIds.filter((roundId) => roundId.trim().length > 0))];
    if (uniqueRoundIds.length === 0) return;

    for (const roundId of uniqueRoundIds) {
      invalidateInstalledRoundCardAssets(roundId);
    }
    setFetchedCardAssetsState((previous) => {
      const next = new Map(previous.entries);
      let changed = false;
      for (const roundId of uniqueRoundIds) {
        changed = next.delete(roundId) || changed;
      }
      return changed ? { ...previous, entries: next } : previous;
    });
    setRefreshRevision((previous) => previous + 1);
  }, []);

  return { cardAssetsByRoundId, refreshRoundAssets };
}
