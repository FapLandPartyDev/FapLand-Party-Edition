import { describe, expect, it, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  db: {
    install: {
      inspectSidecarFile: vi.fn(),
      importSidecarFile: vi.fn(),
      importVideoFileAsRound: vi.fn(),
      scanFolderOnce: vi.fn(),
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
  confirmInstallSidecar: vi.fn(),
  offerUpdateForIncompatibleContent: vi.fn(),
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

vi.mock("../components/InstallConfirmationModalHost", () => ({
  confirmInstallSidecar: mocks.confirmInstallSidecar,
}));

vi.mock("./contentFormatUpdate", () => ({
  offerUpdateForIncompatibleContent: mocks.offerUpdateForIncompatibleContent,
}));

import { getOpenedFileKind, importOpenedFile, summarizeImportResult } from "./openedFiles";

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
    contentName: "Example Hero",
    entries: [],
    unknownEntries: [],
  });
  mocks.confirmInstallSidecar.mockResolvedValue({ action: "install" });
  mocks.db.install.importSidecarFile.mockResolvedValue({
    status: {
      state: "done",
      stats: {
        installed: 1,
        playlistsImported: 0,
        updated: 0,
        failed: 0,
      },
    },
  });
  mocks.db.install.importVideoFileAsRound.mockResolvedValue({
    status: {
      state: "done",
      stats: {
        installed: 1,
        playlistsImported: 0,
        updated: 0,
        failed: 0,
      },
    },
  });
  mocks.db.install.scanFolderOnce.mockResolvedValue({
    status: {
      state: "done",
      stats: {
        installed: 2,
        playlistsImported: 0,
        updated: 0,
        failed: 0,
      },
    },
  });
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
  mocks.offerUpdateForIncompatibleContent.mockResolvedValue(false);
});

describe("getOpenedFileKind", () => {
  it("classifies supported import file extensions", () => {
    expect(getOpenedFileKind("/tmp/example.round")).toBe("sidecar");
    expect(getOpenedFileKind("/tmp/example.hero")).toBe("sidecar");
    expect(getOpenedFileKind("/tmp/example.fpack")).toBe("sidecar");
    expect(getOpenedFileKind("/tmp/example.fplay")).toBe("playlist");
    expect(getOpenedFileKind("/tmp/example.mp4")).toBe("video");
    expect(getOpenedFileKind("/tmp/videos")).toBe("folder");
    expect(getOpenedFileKind("/tmp/videos.2026/")).toBe("folder");
    expect(getOpenedFileKind("/tmp/readme.txt")).toBe("unsupported");
  });
});

describe("importOpenedFile", () => {
  it("checks for an app update when a hero format cannot be read", async () => {
    const formatError = new Error("Unrecognized hero format");
    mocks.db.install.inspectSidecarFile.mockRejectedValue(formatError);

    await expect(importOpenedFile("/tmp/future.hero")).rejects.toBe(formatError);

    expect(mocks.offerUpdateForIncompatibleContent).toHaveBeenCalledWith("/tmp/future.hero");
  });

  it("checks for an app update when a playlist format cannot be read", async () => {
    const formatError = new Error("Unrecognized playlist format");
    mocks.playlists.importFromFile.mockRejectedValue(formatError);

    await expect(importOpenedFile("/tmp/future.fplay")).rejects.toBe(formatError);

    expect(mocks.offerUpdateForIncompatibleContent).toHaveBeenCalledWith("/tmp/future.fplay");
  });

  it("routes sidecars through the install importer", async () => {
    const result = await importOpenedFile("/tmp/example.hero");

    expect(mocks.db.install.inspectSidecarFile).toHaveBeenCalledWith("/tmp/example.hero");
    expect(mocks.confirmInstallSidecar).toHaveBeenCalled();
    expect(mocks.reviewInstallSidecarTrust).not.toHaveBeenCalled();
    expect(mocks.db.install.importSidecarFile).toHaveBeenCalledWith("/tmp/example.hero", []);
    expect(result.kind).toBe("sidecar");
    expect(result.kind === "sidecar" ? result.feedback.message : "").toContain("Installed");
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
      contentName: "Example Hero",
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
      contentName: "Example Hero",
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

    expect(mocks.db.install.inspectSidecarFile).not.toHaveBeenCalled();
    expect(mocks.confirmInstallSidecar).toHaveBeenCalledWith({
      filePath: "/tmp/example.fplay",
      contentName: "example",
      entries: [],
      unknownEntries: [],
    });
    expect(mocks.playlists.importFromFile).toHaveBeenCalledWith({ filePath: "/tmp/example.fplay" });
    expect(mocks.playlists.setActive).toHaveBeenCalledWith("playlist-1");
    expect(result.kind).toBe("playlist");
  });

  it("imports dropped video files as rounds", async () => {
    const result = await importOpenedFile("/tmp/example.mp4");

    expect(mocks.db.install.importVideoFileAsRound).toHaveBeenCalledWith("/tmp/example.mp4");
    expect(result.kind).toBe("video");
    expect(result.kind === "video" ? result.feedback.message : "").toContain("Installed");
  });

  it("imports dropped folders with the folder scanner", async () => {
    const result = await importOpenedFile("/tmp/videos");

    expect(mocks.db.install.scanFolderOnce).toHaveBeenCalledWith("/tmp/videos");
    expect(result.kind).toBe("folder");
    expect(result.kind === "folder" ? result.feedback.message : "").toContain("Installed");
  });
});

describe("summarizeImportResult", () => {
  it("returns update feedback when only existing content changed", () => {
    const feedback = summarizeImportResult("/tmp/demo.fpack", {
      status: {
        state: "done",
        stats: {
          installed: 0,
          playlistsImported: 0,
          updated: 2,
          failed: 0,
        },
      },
    } as never);

    expect(feedback.variant).toBe("info");
    expect(feedback.message).toContain("Updated existing content");
  });
});
