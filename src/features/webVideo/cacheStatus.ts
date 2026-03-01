import { collectPlaylistRefs, createPortableRoundRefResolver } from "../../game/playlistResolution";
import type { InstalledRound, InstalledRoundCatalogEntry } from "../../services/db";
import type { StoredPlaylist } from "../../services/playlists";

type WebsiteCacheAwareRound = {
  id: string;
  name: string;
  resources: Array<{
    websiteVideoCacheStatus?: "not_applicable" | "cached" | "pending";
  }>;
};

export type PlaylistWebsiteCacheSummary = {
  hasPending: boolean;
  pendingRoundCount: number;
  pendingRoundNames: string[];
};

export function getInstalledRoundWebsiteVideoCacheStatus(
  round: WebsiteCacheAwareRound | InstalledRound | InstalledRoundCatalogEntry
): "not_applicable" | "cached" | "pending" {
  let hasCachedResource = false;

  for (const resource of round.resources) {
    if (resource.websiteVideoCacheStatus === "pending") {
      return "pending";
    }
    if (resource.websiteVideoCacheStatus === "cached") {
      hasCachedResource = true;
    }
  }

  return hasCachedResource ? "cached" : "not_applicable";
}

export function buildPlaylistWebsiteCacheSummary(
  playlists: StoredPlaylist[],
  installedRounds: Array<InstalledRound | InstalledRoundCatalogEntry>
): Map<string, PlaylistWebsiteCacheSummary> {
  const roundResolver = createPortableRoundRefResolver(installedRounds);
  const summaryByPlaylistId = new Map<string, PlaylistWebsiteCacheSummary>();

  for (const playlist of playlists) {
    const pendingRoundNames: string[] = [];
    const seenRoundIds = new Set<string>();

    for (const entry of collectPlaylistRefs(playlist.config)) {
      const resolvedRound = roundResolver.resolve(entry.ref);
      if (!resolvedRound || seenRoundIds.has(resolvedRound.id)) {
        continue;
      }

      seenRoundIds.add(resolvedRound.id);

      if (getInstalledRoundWebsiteVideoCacheStatus(resolvedRound) === "pending") {
        pendingRoundNames.push(resolvedRound.name);
      }
    }

    summaryByPlaylistId.set(playlist.id, {
      hasPending: pendingRoundNames.length > 0,
      pendingRoundCount: pendingRoundNames.length,
      pendingRoundNames,
    });
  }

  return summaryByPlaylistId;
}
