import { describe, expect, it, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  db: {
    install: {
      inspectSidecarFile: vi.fn(),
      importSidecarFile: vi.fn(),
    },
  },
  playlists: {
    importFromFile: vi.fn(),
    setActive: vi.fn(),
  },
  security: {
    listTrustedSites: vi.fn(),
    addTrustedSite: vi.fn(),
  },
  reviewInstallSidecarTrust: vi.fn(),
}));

vi.mock("./db", () => ({
  db: mocks.db,
}));

vi.mock("./playlists", () => ({
  playlists: mocks.playlists,
}));

vi.mock("./security", () => ({
  security: mocks.security,
}));

vi.mock("../components/InstallSidecarTrustModalHost", () => ({
  reviewInstallSidecarTrust: mocks.reviewInstallSidecarTrust,
}));

import { getOpenedFileKind, importOpenedFile } from "./openedFiles";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.security.listTrustedSites.mockResolvedValue({
    securityMode: "block",
    builtInStashHosts: [],
    builtInYtDlpDomains: [],
    userTrustedBaseDomains: [],
  });
  mocks.db.install.inspectSidecarFile.mockResolvedValue({
    filePath: "/tmp/example.hero",
    entries: [],
    unknownEntries: [],
  });
  mocks.db.install.importSidecarFile.mockResolvedValue({ status: { state: "done" } });
  mocks.reviewInstallSidecarTrust.mockResolvedValue({
    action: "import",
    trustedBaseDomains: [],
  });
  mocks.security.addTrustedSite.mockResolvedValue(undefined);
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
    expect(getOpenedFileKind("/tmp/example.fpack")).toBe("sidecar");
    expect(getOpenedFileKind("/tmp/example.fplay")).toBe("playlist");
    expect(getOpenedFileKind("/tmp/example.mp4")).toBe("unsupported");
  });
});

describe("importOpenedFile", () => {
  it("routes sidecars through the install importer", async () => {
    const result = await importOpenedFile("/tmp/example.hero");

    expect(mocks.db.install.inspectSidecarFile).toHaveBeenCalledWith("/tmp/example.hero");
    expect(mocks.reviewInstallSidecarTrust).not.toHaveBeenCalled();
    expect(mocks.db.install.importSidecarFile).toHaveBeenCalledWith("/tmp/example.hero", []);
    expect(result.kind).toBe("sidecar");
  });

  it("persists newly trusted domains before importing sidecars in prompt mode", async () => {
    mocks.security.listTrustedSites.mockResolvedValue({
      securityMode: "prompt",
      builtInStashHosts: [],
      builtInYtDlpDomains: [],
      userTrustedBaseDomains: [],
    });
    mocks.db.install.inspectSidecarFile.mockResolvedValue({
      filePath: "/tmp/example.hero",
      entries: [
        {
          baseDomain: "example.com",
          host: "cdn.example.com",
          source: null,
          decision: "blocked",
          sampleUrls: ["https://cdn.example.com/video.mp4"],
          videoUrlCount: 1,
          funscriptUrlCount: 0,
        },
      ],
      unknownEntries: [
        {
          baseDomain: "example.com",
          host: "cdn.example.com",
          source: null,
          decision: "blocked",
          sampleUrls: ["https://cdn.example.com/video.mp4"],
          videoUrlCount: 1,
          funscriptUrlCount: 0,
        },
      ],
    });
    mocks.reviewInstallSidecarTrust.mockResolvedValue({
      action: "import",
      trustedBaseDomains: ["example.com"],
    });

    await importOpenedFile("/tmp/example.hero");

    expect(mocks.reviewInstallSidecarTrust).toHaveBeenCalled();
    expect(mocks.security.addTrustedSite).toHaveBeenCalledWith("example.com");
    expect(mocks.db.install.importSidecarFile).toHaveBeenCalledWith("/tmp/example.hero", [
      "example.com",
    ]);
  });

  it("returns cancelled when the trust review is aborted", async () => {
    mocks.security.listTrustedSites.mockResolvedValue({
      securityMode: "prompt",
      builtInStashHosts: [],
      builtInYtDlpDomains: [],
      userTrustedBaseDomains: [],
    });
    mocks.db.install.inspectSidecarFile.mockResolvedValue({
      filePath: "/tmp/example.hero",
      entries: [
        {
          baseDomain: "example.com",
          host: "cdn.example.com",
          source: null,
          decision: "blocked",
          sampleUrls: ["https://cdn.example.com/video.mp4"],
          videoUrlCount: 1,
          funscriptUrlCount: 0,
        },
      ],
      unknownEntries: [
        {
          baseDomain: "example.com",
          host: "cdn.example.com",
          source: null,
          decision: "blocked",
          sampleUrls: ["https://cdn.example.com/video.mp4"],
          videoUrlCount: 1,
          funscriptUrlCount: 0,
        },
      ],
    });
    mocks.reviewInstallSidecarTrust.mockResolvedValue({ action: "cancel" });

    const result = await importOpenedFile("/tmp/example.hero");

    expect(mocks.db.install.importSidecarFile).not.toHaveBeenCalled();
    expect(result.kind).toBe("cancelled");
  });

  it("routes playlists through the playlist importer and activates them", async () => {
    const result = await importOpenedFile("/tmp/example.fplay");

    expect(mocks.playlists.importFromFile).toHaveBeenCalledWith({ filePath: "/tmp/example.fplay" });
    expect(mocks.playlists.setActive).toHaveBeenCalledWith("playlist-1");
    expect(result.kind).toBe("playlist");
  });
});
