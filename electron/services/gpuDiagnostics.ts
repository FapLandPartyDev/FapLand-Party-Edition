import { app } from "electron";
import { readGraphicsCompatibilitySettings } from "./graphicsCompatibility";

export type GpuDiagnosticsSnapshot = {
  collectedAtIso: string;
  featureStatus: unknown;
  gpuInfo: unknown;
  hardwareAccelerationEnabled: boolean | null;
  graphicsCompatibility: ReturnType<typeof readGraphicsCompatibilitySettings>;
  versions: {
    electron: string | undefined;
    chrome: string | undefined;
  };
  error: string | null;
};

let latestGpuDiagnosticsSnapshot: GpuDiagnosticsSnapshot | null = null;

export function getGpuDiagnosticsSnapshot(): GpuDiagnosticsSnapshot | null {
  return latestGpuDiagnosticsSnapshot;
}

export async function refreshGpuDiagnosticsSnapshot(): Promise<GpuDiagnosticsSnapshot> {
  const base = {
    collectedAtIso: new Date().toISOString(),
    hardwareAccelerationEnabled:
      typeof app.isHardwareAccelerationEnabled === "function"
        ? app.isHardwareAccelerationEnabled()
        : null,
    graphicsCompatibility: readGraphicsCompatibilitySettings(),
    versions: {
      electron: process.versions.electron,
      chrome: process.versions.chrome,
    },
  };

  try {
    const [featureStatus, gpuInfo] = await Promise.all([
      Promise.resolve(
        typeof app.getGPUFeatureStatus === "function" ? app.getGPUFeatureStatus() : null
      ),
      typeof app.getGPUInfo === "function" ? app.getGPUInfo("complete") : Promise.resolve(null),
    ]);
    latestGpuDiagnosticsSnapshot = {
      ...base,
      featureStatus,
      gpuInfo,
      error: null,
    };
  } catch (error) {
    latestGpuDiagnosticsSnapshot = {
      ...base,
      featureStatus: null,
      gpuInfo: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }

  return latestGpuDiagnosticsSnapshot;
}
