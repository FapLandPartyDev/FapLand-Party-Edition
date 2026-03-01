// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearApprovedDialogPathsForTests } from "./dialogPathApproval";

const {
  readFileMock,
  writeFileMock,
  mkdirMock,
  getDbMock,
  getStoreMock,
} = vi.hoisted(() => ({
  readFileMock: vi.fn(),
  writeFileMock: vi.fn(),
  mkdirMock: vi.fn(),
  getDbMock: vi.fn(),
  getStoreMock: vi.fn(),
}));

vi.mock("node:fs/promises", () => ({
  default: {
    readFile: readFileMock,
    writeFile: writeFileMock,
    mkdir: mkdirMock,
  },
}));

vi.mock("./db", () => ({
  getDb: getDbMock,
}));

vi.mock("./store", () => ({
  getStore: getStoreMock,
}));

import { analyzePlaylistImportFile, exportPlaylistToFile, importPlaylistFromFile } from "./playlists";

describe("playlist file path approval", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearApprovedDialogPathsForTests();
    getStoreMock.mockReturnValue({
      get: vi.fn(),
      set: vi.fn(),
    });
    getDbMock.mockReturnValue({
      query: {
        round: {
          findMany: vi.fn(async () => []),
        },
        playlist: {
          findFirst: vi.fn(async () => null),
        },
      },
    });
  });

  afterEach(() => {
    clearApprovedDialogPathsForTests();
  });

  it("rejects analyzing playlists from unapproved paths", async () => {
    await expect(analyzePlaylistImportFile("/tmp/unapproved.fplay")).rejects.toThrow(
      "Path must be selected through the system dialog.",
    );
    expect(readFileMock).not.toHaveBeenCalled();
  });

  it("rejects importing playlists from unapproved paths", async () => {
    await expect(importPlaylistFromFile({ filePath: "/tmp/unapproved.fplay" })).rejects.toThrow(
      "Path must be selected through the system dialog.",
    );
    expect(readFileMock).not.toHaveBeenCalled();
  });

  it("rejects exporting playlists to unapproved paths", async () => {
    await expect(exportPlaylistToFile({ playlistId: "playlist-1", filePath: "/tmp/unapproved.fplay" })).rejects.toThrow(
      "Path must be selected through the system dialog.",
    );
    expect(writeFileMock).not.toHaveBeenCalled();
    expect(mkdirMock).not.toHaveBeenCalled();
  });
});
