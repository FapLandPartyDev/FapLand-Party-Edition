// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  getWebsiteVideoScanStatusMock,
  startWebsiteVideoScanMock,
  startWebsiteVideoScanManualMock,
  requestWebsiteVideoScanAbortMock,
} = vi.hoisted(() => ({
  getWebsiteVideoScanStatusMock: vi.fn(),
  startWebsiteVideoScanMock: vi.fn(),
  startWebsiteVideoScanManualMock: vi.fn(),
  requestWebsiteVideoScanAbortMock: vi.fn(),
}));

vi.mock("../../services/db", () => ({
  getDb: vi.fn(() => ({
    query: {},
  })),
}));

vi.mock("../../services/installExport", () => ({
  exportInstalledDatabase: vi.fn(),
}));

vi.mock("../../services/store", () => ({
  getStore: vi.fn(() => ({
    clear: vi.fn(),
  })),
}));

vi.mock("../../services/webVideoScanService", () => ({
  getWebsiteVideoScanStatus: getWebsiteVideoScanStatusMock,
  startWebsiteVideoScan: startWebsiteVideoScanMock,
  startWebsiteVideoScanManual: startWebsiteVideoScanManualMock,
  requestWebsiteVideoScanAbort: requestWebsiteVideoScanAbortMock,
}));

import { dbRouter } from "./db";

describe("dbRouter website video scan endpoints", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns website video scan status", async () => {
    getWebsiteVideoScanStatusMock.mockReturnValue({ state: "idle" });
    const caller = dbRouter.createCaller({} as never);

    const result = await caller.getWebsiteVideoScanStatus();

    expect(result).toEqual({ state: "idle" });
    expect(getWebsiteVideoScanStatusMock).toHaveBeenCalled();
  });

  it("starts a website video scan", async () => {
    startWebsiteVideoScanMock.mockResolvedValue({ state: "running" });
    const caller = dbRouter.createCaller({} as never);

    const result = await caller.startWebsiteVideoScan();

    expect(result).toEqual({ state: "running" });
    expect(startWebsiteVideoScanMock).toHaveBeenCalled();
  });

  it("starts a manual website video scan", async () => {
    startWebsiteVideoScanManualMock.mockResolvedValue({ state: "running" });
    const caller = dbRouter.createCaller({} as never);

    const result = await caller.startWebsiteVideoScanManual();

    expect(result).toEqual({ state: "running" });
    expect(startWebsiteVideoScanManualMock).toHaveBeenCalled();
  });

  it("aborts the website video scan", async () => {
    requestWebsiteVideoScanAbortMock.mockReturnValue({ state: "aborted" });
    const caller = dbRouter.createCaller({} as never);

    const result = await caller.abortWebsiteVideoScan();

    expect(result).toEqual({ state: "aborted" });
    expect(requestWebsiteVideoScanAbortMock).toHaveBeenCalled();
  });
});
