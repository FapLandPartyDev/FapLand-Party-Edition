// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getGPUFeatureStatus: vi.fn(() => ({ gpu_compositing: "enabled" })),
  getGPUInfo: vi.fn(async (infoType: "basic" | "complete") => ({ infoType })),
  isHardwareAccelerationEnabled: vi.fn(() => true),
  readGraphicsCompatibilitySettings: vi.fn(() => ({ safeModeEnabled: false })),
}));

vi.mock("electron", () => ({
  app: {
    getGPUFeatureStatus: mocks.getGPUFeatureStatus,
    getGPUInfo: mocks.getGPUInfo,
    isHardwareAccelerationEnabled: mocks.isHardwareAccelerationEnabled,
  },
}));

vi.mock("./graphicsCompatibility", () => ({
  readGraphicsCompatibilitySettings: mocks.readGraphicsCompatibilitySettings,
}));

import { refreshGpuDiagnosticsSnapshot } from "./gpuDiagnostics";

describe("gpuDiagnostics", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses the lightweight GPU query for automatic diagnostics", async () => {
    const snapshot = await refreshGpuDiagnosticsSnapshot();

    expect(mocks.getGPUInfo).toHaveBeenCalledOnce();
    expect(mocks.getGPUInfo).toHaveBeenCalledWith("basic");
    expect(snapshot.infoType).toBe("basic");
    expect(snapshot.error).toBeNull();
  });

  it("only requests complete GPU details when explicitly requested", async () => {
    const snapshot = await refreshGpuDiagnosticsSnapshot("complete");

    expect(mocks.getGPUInfo).toHaveBeenCalledOnce();
    expect(mocks.getGPUInfo).toHaveBeenCalledWith("complete");
    expect(snapshot.infoType).toBe("complete");
  });
});
