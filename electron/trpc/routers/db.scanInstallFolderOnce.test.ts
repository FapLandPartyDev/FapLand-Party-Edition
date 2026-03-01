// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const { requestInstallScanAbortMock, scanInstallFolderOnceWithLegacySupportMock, inspectInstallFolderMock, importLegacyFolderWithPlanMock } = vi.hoisted(() => ({
  requestInstallScanAbortMock: vi.fn(),
  scanInstallFolderOnceWithLegacySupportMock: vi.fn(),
  inspectInstallFolderMock: vi.fn(),
  importLegacyFolderWithPlanMock: vi.fn(),
}));

vi.mock("../../services/db", () => ({
  getPrismaClient: vi.fn(() => ({})),
}));

vi.mock("../../services/integrations", () => ({
  getDisabledRoundIdSet: vi.fn(() => new Set<string>()),
  resolveResourceUris: vi.fn((input: { videoUri: string; funscriptUri: string | null }) => input),
}));

vi.mock("../../services/installer", () => ({
  addAutoScanFolder: vi.fn(),
  getAutoScanFolders: vi.fn(() => []),
  getInstallScanStatus: vi.fn(() => ({
    state: "idle",
    triggeredBy: "manual",
    startedAt: null,
    finishedAt: null,
    stats: { scannedFolders: 0, sidecarsSeen: 0, installed: 0, updated: 0, skipped: 0, failed: 0 },
    lastMessage: null,
    lastErrors: [],
  })),
  importLegacyFolderWithPlan: importLegacyFolderWithPlanMock,
  inspectInstallFolder: inspectInstallFolderMock,
  removeAutoScanFolder: vi.fn(() => []),
  requestInstallScanAbort: requestInstallScanAbortMock,
  scanInstallSources: vi.fn(),
  scanInstallFolderOnceWithLegacySupport: scanInstallFolderOnceWithLegacySupportMock,
}));

import { dbRouter } from "./db";

describe("dbRouter scanInstallFolderOnce", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns legacy folder inspection payload", async () => {
    inspectInstallFolderMock.mockResolvedValue({
      kind: "legacy",
      folderPath: "/tmp/legacy-pack",
      playlistNameHint: "Legacy Pack",
      legacySlots: [
        { id: "slot-0", sourcePath: "/tmp/legacy-pack/1.mp4", sourceLabel: "1", originalOrder: 0, defaultCheckpoint: false },
        { id: "slot-1", sourcePath: "/tmp/legacy-pack/10.mp4", sourceLabel: "10", originalOrder: 1, defaultCheckpoint: true },
      ],
    });

    const caller = dbRouter.createCaller({} as never);
    const result = await caller.inspectInstallFolder({ folderPath: "/tmp/legacy-pack" });

    expect(inspectInstallFolderMock).toHaveBeenCalledWith("/tmp/legacy-pack");
    expect(result.kind).toBe("legacy");
    expect(result.legacySlots[1]?.sourceLabel).toBe("10");
  });

  it("imports reviewed legacy folder selections", async () => {
    importLegacyFolderWithPlanMock.mockResolvedValue({
      status: {
        state: "done",
        triggeredBy: "manual",
        startedAt: "2026-03-05T00:00:00.000Z",
        finishedAt: "2026-03-05T00:00:01.000Z",
        stats: { scannedFolders: 1, sidecarsSeen: 0, installed: 2, updated: 0, skipped: 0, failed: 0 },
        lastMessage: "ok",
        lastErrors: [],
      },
      legacyImport: {
        roundIds: ["r1", "r2"],
        playlistNameHint: "Legacy Pack",
        orderedSlots: [
          { kind: "round", ref: { name: "1" } },
          { kind: "checkpoint", label: "2 checkpoint", restDurationMs: null },
          { kind: "round", ref: { name: "10" } },
        ],
      },
    });

    const caller = dbRouter.createCaller({} as never);
    const result = await caller.importLegacyFolderWithPlan({
      folderPath: "/tmp/legacy-pack",
      reviewedSlots: [
        { id: "slot-0", sourcePath: "/tmp/legacy-pack/1.mp4", originalOrder: 0, selectedAsCheckpoint: false, excludedFromImport: false },
        { id: "slot-1", sourcePath: "/tmp/legacy-pack/2 checkpoint.mp4", originalOrder: 1, selectedAsCheckpoint: true, excludedFromImport: false },
        { id: "slot-2", sourcePath: "/tmp/legacy-pack/10.mp4", originalOrder: 2, selectedAsCheckpoint: false, excludedFromImport: true },
      ],
    });

    expect(importLegacyFolderWithPlanMock).toHaveBeenCalledWith("/tmp/legacy-pack", expect.any(Array));
    expect(result.legacyImport?.orderedSlots).toHaveLength(3);
  });

  it("returns structured legacy import payload from installer", async () => {
    scanInstallFolderOnceWithLegacySupportMock.mockResolvedValue({
      status: {
        state: "done",
        triggeredBy: "manual",
        startedAt: "2026-03-05T00:00:00.000Z",
        finishedAt: "2026-03-05T00:00:01.000Z",
        stats: { scannedFolders: 1, sidecarsSeen: 0, installed: 3, updated: 0, skipped: 0, failed: 0 },
        lastMessage: "ok",
        lastErrors: [],
      },
      legacyImport: {
        roundIds: ["r1", "r2", "r3"],
        playlistNameHint: "Legacy Pack",
        orderedSlots: [
          { kind: "round", ref: { name: "1" } },
          { kind: "round", ref: { name: "2" } },
          { kind: "round", ref: { name: "10" } },
        ],
      },
    });

    const caller = dbRouter.createCaller({} as never);
    const result = await caller.scanInstallFolderOnce({ folderPath: "/tmp/legacy-pack" });

    expect(scanInstallFolderOnceWithLegacySupportMock).toHaveBeenCalledWith("/tmp/legacy-pack", { omitCheckpointRounds: true });
    expect(result.legacyImport?.roundIds).toEqual(["r1", "r2", "r3"]);
    expect(result.status.stats.installed).toBe(3);
  });

  it("maps installer errors to BAD_REQUEST", async () => {
    scanInstallFolderOnceWithLegacySupportMock.mockRejectedValue(new Error("No supported video files found in selected folder."));
    const caller = dbRouter.createCaller({} as never);

    await expect(caller.scanInstallFolderOnce({ folderPath: "/tmp/empty" })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "No supported video files found in selected folder.",
    });
  });

  it("exposes abortInstallScan status updates", async () => {
    requestInstallScanAbortMock.mockReturnValue({
      state: "running",
      triggeredBy: "manual",
      startedAt: "2026-03-06T00:00:00.000Z",
      finishedAt: null,
      stats: { scannedFolders: 1, sidecarsSeen: 4, installed: 1, updated: 0, skipped: 0, failed: 0 },
      lastMessage: "Abort requested. Waiting for the current import step to finish...",
      lastErrors: [],
    });

    const caller = dbRouter.createCaller({} as never);
    const result = await caller.abortInstallScan();

    expect(requestInstallScanAbortMock).toHaveBeenCalledTimes(1);
    expect(result.lastMessage).toContain("Abort requested");
  });
});
