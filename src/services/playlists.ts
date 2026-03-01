import { trpc } from "./trpc";
import type { PlaylistConfig } from "../game/playlistSchema";

export type StoredPlaylist = Awaited<ReturnType<typeof trpc.playlist.list.query>>[number];
export type PlaylistImportAnalysisResult = Awaited<ReturnType<typeof trpc.playlist.analyzeImportFile.mutate>>;
export type PlaylistImportResult = Awaited<ReturnType<typeof trpc.playlist.importFromFile.mutate>>;

export const playlists = {
  list: () => trpc.playlist.list.query(),
  getById: (playlistId: string) => trpc.playlist.getById.query({ playlistId }),
  getActive: () => trpc.playlist.getActive.query(),
  setActive: (playlistId: string) => trpc.playlist.setActive.mutate({ playlistId }),
  create: (input: { name: string; description?: string | null; config?: PlaylistConfig }) =>
    trpc.playlist.create.mutate(input),
  update: (input: { playlistId: string; name?: string; description?: string | null; config?: PlaylistConfig }) =>
    trpc.playlist.update.mutate(input),
  duplicate: (playlistId: string) => trpc.playlist.duplicate.mutate({ playlistId }),
  remove: (playlistId: string) => trpc.playlist.delete.mutate({ playlistId }),
  analyzeImportFile: (filePath: string) => trpc.playlist.analyzeImportFile.mutate({ filePath }),
  importFromFile: (input: { filePath: string; manualMappingByRefKey?: Record<string, string | null | undefined> }) =>
    trpc.playlist.importFromFile.mutate(input),
  exportToFile: (playlistId: string, filePath: string) => trpc.playlist.exportToFile.mutate({ playlistId, filePath }),
  recordRoundPlay: (input: { playlistId: string; roundId: string; nodeId?: string | null; poolId?: string | null }) =>
    trpc.playlist.recordRoundPlay.mutate(input),
  getDistinctPlayedByPool: (playlistId: string) => trpc.playlist.getDistinctPlayedByPool.query({ playlistId }),
};
