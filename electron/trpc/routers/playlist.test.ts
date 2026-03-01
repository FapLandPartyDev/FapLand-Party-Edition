// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  analyzePlaylistExportPackageMock,
  createPlaylistMock,
  deletePlaylistMock,
  duplicatePlaylistMock,
  ensureEndlessPlaylistMock,
  exportPlaylistPackageMock,
  exportPlaylistToFileMock,
  getActivePlaylistMock,
  getDistinctPlayedByPoolMock,
  getPlaylistByIdMock,
  getPlaylistPlayHistoryMock,
  importPlaylistFromFileMock,
  listPlaylistsMock,
  recordPlaylistTrackPlayMock,
  setActivePlaylistMock,
  updatePlaylistMock,
} = vi.hoisted(() => ({
  analyzePlaylistExportPackageMock: vi.fn(),
  createPlaylistMock: vi.fn(),
  deletePlaylistMock: vi.fn(),
  duplicatePlaylistMock: vi.fn(),
  ensureEndlessPlaylistMock: vi.fn(),
  exportPlaylistPackageMock: vi.fn(),
  exportPlaylistToFileMock: vi.fn(),
  getActivePlaylistMock: vi.fn(),
  getDistinctPlayedByPoolMock: vi.fn(),
  getPlaylistByIdMock: vi.fn(),
  getPlaylistPlayHistoryMock: vi.fn(),
  importPlaylistFromFileMock: vi.fn(),
  listPlaylistsMock: vi.fn(),
  recordPlaylistTrackPlayMock: vi.fn(),
  setActivePlaylistMock: vi.fn(),
  updatePlaylistMock: vi.fn(),
}));

vi.mock("../../services/playlists", () => ({
  analyzePlaylistImportFile: vi.fn(),
  createPlaylist: createPlaylistMock,
  deletePlaylist: deletePlaylistMock,
  duplicatePlaylist: duplicatePlaylistMock,
  ensureEndlessPlaylist: ensureEndlessPlaylistMock,
  exportPlaylistToFile: exportPlaylistToFileMock,
  getActivePlaylist: getActivePlaylistMock,
  getDistinctPlayedByPool: getDistinctPlayedByPoolMock,
  getPlaylistById: getPlaylistByIdMock,
  getPlaylistPlayHistory: getPlaylistPlayHistoryMock,
  importPlaylistFromFile: importPlaylistFromFileMock,
  listPlaylists: listPlaylistsMock,
  recordPlaylistTrackPlay: recordPlaylistTrackPlayMock,
  setActivePlaylist: setActivePlaylistMock,
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
});
