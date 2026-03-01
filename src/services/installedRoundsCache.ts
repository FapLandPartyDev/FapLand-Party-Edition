import { trpc } from "./trpc";

export type CachedInstalledRoundCatalog = Awaited<
  ReturnType<typeof trpc.db.getInstalledRoundCatalog.query>
>;
export type CachedInstalledRoundMediaResources = Awaited<
  ReturnType<typeof trpc.db.getRoundMediaResources.query>
>;

const catalogRequests = new Map<string, Promise<CachedInstalledRoundCatalog>>();
const mediaRequests = new Map<string, Promise<CachedInstalledRoundMediaResources>>();

function getCatalogKey(includeDisabled: boolean, includeTemplates: boolean): string {
  return `${includeDisabled ? "1" : "0"}:${includeTemplates ? "1" : "0"}`;
}

function getMediaKey(roundId: string, includeDisabled: boolean): string {
  return `${roundId}:${includeDisabled ? "1" : "0"}`;
}

export function getInstalledRoundCatalogCached(
  includeDisabled = false,
  includeTemplates = false
): Promise<CachedInstalledRoundCatalog> {
  const key = getCatalogKey(includeDisabled, includeTemplates);
  const existing = catalogRequests.get(key);
  if (existing) {
    return existing;
  }

  const request = trpc.db.getInstalledRoundCatalog.query({
    includeDisabled,
    includeTemplates,
  }).catch((error) => {
    catalogRequests.delete(key);
    throw error;
  });
  catalogRequests.set(key, request);
  return request;
}

export function getRoundMediaResourcesCached(
  roundId: string,
  includeDisabled = false
): Promise<CachedInstalledRoundMediaResources> {
  const key = getMediaKey(roundId, includeDisabled);
  const existing = mediaRequests.get(key);
  if (existing) {
    return existing;
  }

  const request = trpc.db.getRoundMediaResources.query({
    roundId,
    includeDisabled,
  }).catch((error) => {
    mediaRequests.delete(key);
    throw error;
  });
  mediaRequests.set(key, request);
  return request;
}

export function invalidateInstalledRoundCaches(): void {
  catalogRequests.clear();
  mediaRequests.clear();
}

export function invalidateInstalledRoundMedia(roundId?: string): void {
  if (!roundId) {
    mediaRequests.clear();
    return;
  }

  for (const key of mediaRequests.keys()) {
    if (key.startsWith(`${roundId}:`)) {
      mediaRequests.delete(key);
    }
  }
}
