import { trpc } from "./trpc";
import type { PlaylistConfig } from "../game/playlistSchema";
import type { MapEditorDraftSnapshot } from "../features/map-editor/mapEditorDraft";

export type StoredPlaylist = Awaited<ReturnType<typeof trpc.playlist.list.query>>[number];
export type PlaylistImportAnalysisResult = Awaited<
  ReturnType<typeof trpc.playlist.analyzeImportFile.mutate>
>;
export type PlaylistImportResult = Awaited<ReturnType<typeof trpc.playlist.importFromFile.mutate>>;
export type PlaylistExportPackageResult = Awaited<
  ReturnType<typeof trpc.playlist.exportPackage.mutate>
>;
export type PlaylistExportPackageStatus = Awaited<
  ReturnType<typeof trpc.playlist.getExportPackageStatus.query>
>;
export type PlaylistExportPackageAnalysis = Awaited<
  ReturnType<typeof trpc.playlist.analyzeExportPackage.query>
>;

export const playlists = {
  list: () => trpc.playlist.list.query(),
  getById: (playlistId: string) => trpc.playlist.getById.query({ playlistId }),
  getEditorDraft: (playlistId: string) => trpc.playlist.getEditorDraft.query({ playlistId }),
  saveEditorDraft: (playlistId: string, snapshot: MapEditorDraftSnapshot) =>
    trpc.playlist.saveEditorDraft.mutate({ playlistId, snapshot }),
  deleteEditorDraft: (playlistId: string) => trpc.playlist.deleteEditorDraft.mutate({ playlistId }),
  getActive: () => trpc.playlist.getActive.query(),
  setActive: (playlistId: string) => trpc.playlist.setActive.mutate({ playlistId }),
  create: (input: { name: string; description?: string | null; config?: PlaylistConfig }) =>
    trpc.playlist.create.mutate(input),
  update: (input: {
    playlistId: string;
    name?: string;
    description?: string | null;
    config?: PlaylistConfig;
  }) => trpc.playlist.update.mutate(input),
  duplicate: (playlistId: string) => trpc.playlist.duplicate.mutate({ playlistId }),
  remove: (playlistId: string) => trpc.playlist.delete.mutate({ playlistId }),
  analyzeImportFile: (filePath: string) => trpc.playlist.analyzeImportFile.mutate({ filePath }),
  importFromFile: (input: {
    filePath: string;
    manualMappingByRefKey?: Record<string, string | null>;
  }) => trpc.playlist.importFromFile.mutate(input),
  exportToFile: (playlistId: string, filePath: string) =>
    trpc.playlist.exportToFile.mutate({ playlistId, filePath }),
  analyzeExportPackage: (input: {
    playlistId: string;
    compressionMode?: "copy" | "av1";
    compressionStrength?: number;
    audioBitrateKbps?: 128 | 192 | 256;
    includeMedia?: boolean;
  }) => trpc.playlist.analyzeExportPackage.query(input),
  exportPackage: (input: {
    playlistId: string;
    directoryPath: string;
    compressionMode?: "copy" | "av1";
    compressionStrength?: number;
    audioBitrateKbps?: 128 | 192 | 256;
    includeMedia?: boolean;
    asFpack?: boolean;
  }) => trpc.playlist.exportPackage.mutate(input),
  getExportPackageStatus: () => trpc.playlist.getExportPackageStatus.query(),
  abortExportPackage: () => trpc.playlist.abortExportPackage.mutate(),
  recordRoundPlay: (input: {
    playlistId: string;
    roundId: string;
    nodeId?: string | null;
    poolId?: string | null;
  }) => trpc.playlist.recordRoundPlay.mutate(input),
  getDistinctPlayedByPool: (playlistId: string) =>
    trpc.playlist.getDistinctPlayedByPool.query({ playlistId }),
  ensureEndless: () => trpc.playlist.ensureEndless.mutate(),
};
