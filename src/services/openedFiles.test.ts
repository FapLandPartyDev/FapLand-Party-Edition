import { describe, expect, it, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  db: {
    install: {
      importSidecarFile: vi.fn(),
    },
  },
  playlists: {
    importFromFile: vi.fn(),
    setActive: vi.fn(),
  },
}));

vi.mock("./db", () => ({
  db: mocks.db,
}));

vi.mock("./playlists", () => ({
  playlists: mocks.playlists,
}));

import { getOpenedFileKind, importOpenedFile } from "./openedFiles";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.db.install.importSidecarFile.mockResolvedValue({ status: { state: "done" } });
  mocks.playlists.importFromFile.mockResolvedValue({
    playlist: { id: "playlist-1", name: "Imported" },
    report: {
      exactMapping: {},
      suggestedMapping: {},
      issues: [],
      counts: {
        exact: 0,
        suggested: 0,
        missing: 0,
      },
      appliedMapping: {},
    },
  });
  mocks.playlists.setActive.mockResolvedValue(undefined);
});

describe("getOpenedFileKind", () => {
  it("classifies supported import file extensions", () => {
    expect(getOpenedFileKind("/tmp/example.round")).toBe("sidecar");
    expect(getOpenedFileKind("/tmp/example.hero")).toBe("sidecar");
    expect(getOpenedFileKind("/tmp/example.fplay")).toBe("playlist");
    expect(getOpenedFileKind("/tmp/example.mp4")).toBe("unsupported");
  });
});

describe("importOpenedFile", () => {
  it("routes sidecars through the install importer", async () => {
    const result = await importOpenedFile("/tmp/example.hero");

    expect(mocks.db.install.importSidecarFile).toHaveBeenCalledWith("/tmp/example.hero");
    expect(result.kind).toBe("sidecar");
  });

  it("routes playlists through the playlist importer and activates them", async () => {
    const result = await importOpenedFile("/tmp/example.fplay");

    expect(mocks.playlists.importFromFile).toHaveBeenCalledWith({ filePath: "/tmp/example.fplay" });
    expect(mocks.playlists.setActive).toHaveBeenCalledWith("playlist-1");
    expect(result.kind).toBe("playlist");
  });
});
