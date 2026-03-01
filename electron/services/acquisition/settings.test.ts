import { beforeEach, describe, expect, it, vi } from "vitest";

const values = new Map<string, unknown>();
vi.mock("../store", () => ({
  safeStoreGet: (key: string, fallback?: unknown) => (values.has(key) ? values.get(key) : fallback),
  safeStoreSet: (key: string, value: unknown) => {
    values.set(key, value);
    return true;
  },
}));
vi.mock("../storagePaths", () => ({
  ACQUISITION_DOWNLOAD_RELATIVE_PATH: "acquisition-downloads",
  resolveConfiguredStoragePath: (configured: unknown, fallback: string) =>
    configured ?? `/data/${fallback}`,
}));

import {
  getAcquisitionSettings,
  resolveAcquisitionDownloadRoot,
  updateAcquisitionSettings,
} from "./settings";

describe("acquisition settings", () => {
  beforeEach(() => values.clear());

  it("keeps torrent networking disabled by default", () => {
    expect(getAcquisitionSettings()).toMatchObject({
      torrentEnabled: false,
      maxActiveDownloads: 2,
      seedRatio: 1,
      seedTimeMs: 86_400_000,
    });
  });

  it("persists nullable limits without magic zero values", () => {
    const next = updateAcquisitionSettings({
      torrentEnabled: true,
      seedRatio: null,
      seedTimeMs: null,
    });
    expect(next).toMatchObject({ torrentEnabled: true, seedRatio: null, seedTimeMs: null });
  });

  it("uses the managed download root by default", () => {
    expect(resolveAcquisitionDownloadRoot()).toBe("/data/acquisition-downloads");
  });
});
