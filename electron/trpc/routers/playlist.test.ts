// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  analyzePlaylistExportPackageMock,
  createPlaylistMock,
  deletePlaylistMock,
  deleteMapEditorDraftMock,
  duplicatePlaylistMock,
  ensureEndlessPlaylistMock,
  exportPlaylistPackageMock,
  exportPlaylistToFileMock,
  getActivePlaylistMock,
  getDistinctPlayedByPoolMock,
  getPlaylistByIdMock,
  getMapEditorDraftMock,
  getPlaylistPlayHistoryMock,
  importPlaylistFromFileMock,
  listPlaylistsMock,
  recordPlaylistTrackPlayMock,
  setActivePlaylistMock,
  saveMapEditorDraftMock,
  updatePlaylistMock,
} = vi.hoisted(() => ({
  analyzePlaylistExportPackageMock: vi.fn(),
  createPlaylistMock: vi.fn(),
  deletePlaylistMock: vi.fn(),
  deleteMapEditorDraftMock: vi.fn(),
  duplicatePlaylistMock: vi.fn(),
  ensureEndlessPlaylistMock: vi.fn(),
  exportPlaylistPackageMock: vi.fn(),
  exportPlaylistToFileMock: vi.fn(),
  getActivePlaylistMock: vi.fn(),
  getDistinctPlayedByPoolMock: vi.fn(),
  getPlaylistByIdMock: vi.fn(),
  getMapEditorDraftMock: vi.fn(),
  getPlaylistPlayHistoryMock: vi.fn(),
  importPlaylistFromFileMock: vi.fn(),
  listPlaylistsMock: vi.fn(),
  recordPlaylistTrackPlayMock: vi.fn(),
  setActivePlaylistMock: vi.fn(),
  saveMapEditorDraftMock: vi.fn(),
  updatePlaylistMock: vi.fn(),
}));

vi.mock("../../services/playlists", () => ({
  analyzePlaylistImportFile: vi.fn(),
  createPlaylist: createPlaylistMock,
  deletePlaylist: deletePlaylistMock,
  deleteMapEditorDraft: deleteMapEditorDraftMock,
  duplicatePlaylist: duplicatePlaylistMock,
  ensureEndlessPlaylist: ensureEndlessPlaylistMock,
  exportPlaylistToFile: exportPlaylistToFileMock,
  getActivePlaylist: getActivePlaylistMock,
  getDistinctPlayedByPool: getDistinctPlayedByPoolMock,
  getPlaylistById: getPlaylistByIdMock,
  getMapEditorDraft: getMapEditorDraftMock,
  getPlaylistPlayHistory: getPlaylistPlayHistoryMock,
  importPlaylistFromFile: importPlaylistFromFileMock,
  listPlaylists: listPlaylistsMock,
  recordPlaylistTrackPlay: recordPlaylistTrackPlayMock,
  setActivePlaylist: setActivePlaylistMock,
  saveMapEditorDraft: saveMapEditorDraftMock,
  updatePlaylist: updatePlaylistMock,
}));

vi.mock("../../services/playlistExportPackage", () => ({
  analyzePlaylistExportPackage: analyzePlaylistExportPackageMock,
  exportPlaylistPackage: exportPlaylistPackageMock,
  getPlaylistExportPackageStatus: vi.fn(),
  requestPlaylistExportPackageAbort: vi.fn(),
}));

import { playlistRouter } from "./playlist";

describe("playlistRouter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("passes includeMedia through to playlist package export calls", async () => {
    const caller = playlistRouter.createCaller({ event: { sender: {} } } as never);
    analyzePlaylistExportPackageMock.mockResolvedValue({ estimate: { expectedVideoBytes: 0 } });
    exportPlaylistPackageMock.mockResolvedValue({ exportDir: "/tmp/export" });

    await caller.analyzeExportPackage({
      playlistId: "playlist-1",
      compressionMode: "copy",
      includeMedia: false,
    });
    await caller.exportPackage({
      playlistId: "playlist-1",
      directoryPath: "/tmp",
      compressionMode: "copy",
      includeMedia: false,
      asFpack: true,
    });

    expect(analyzePlaylistExportPackageMock).toHaveBeenCalledWith({
      playlistId: "playlist-1",
      compressionMode: "copy",
      includeMedia: false,
    });
    expect(exportPlaylistPackageMock).toHaveBeenCalledWith({
      playlistId: "playlist-1",
      directoryPath: "/tmp",
      compressionMode: "copy",
      includeMedia: false,
      asFpack: true,
    });
  });

  it("reports the underlying database error when saving a draft fails", async () => {
    const caller = playlistRouter.createCaller({ event: { sender: {} } } as never);
    saveMapEditorDraftMock.mockRejectedValue(
      new Error("Failed query", { cause: new Error("database is locked") })
    );

    await expect(
      caller.saveEditorDraft({
        playlistId: "playlist-1",
        snapshot: {
          version: 1,
          name: "Draft",
          config: {
            mode: "graph",
            startNodeId: "start",
            nodes: [],
            edges: [],
            textAnnotations: [],
            randomRoundPools: [],
            cumRoundRefs: [],
            pathChoiceTimeoutMs: 12_000,
          },
          viewport: { x: 0, y: 0, zoom: 1 },
          showGrid: true,
          snapToGrid: true,
          sidebar: {
            activeTab: "tiles",
            activeCategory: "all",
            tileSearch: "",
            roundSearch: "",
            roundTypeFilter: "all",
            roundSort: "name",
            heroSearch: "",
            heroSort: "name",
          },
        },
      })
    ).rejects.toThrow("Failed to save map editor draft: database is locked");
  });
});
