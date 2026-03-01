// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  app: {
    getVersion: () => "0.1.0",
  },
  shell: {
    openExternal: vi.fn(),
  },
}));

import { compareVersions, resolveReleaseAssetUrl, shouldRefreshUpdateState, type AppUpdateState } from "./updater";

describe("updater.compareVersions", () => {
  it("treats higher semantic versions as newer", () => {
    expect(compareVersions("0.2.0", "0.1.9")).toBe(1);
    expect(compareVersions("1.0.0", "1.0.0")).toBe(0);
    expect(compareVersions("1.0.0", "1.2.0")).toBe(-1);
  });
});

describe("updater.resolveReleaseAssetUrl", () => {
  it("selects the current platform asset when available", () => {
    const assets = [
      { name: "Fap-Land-0.2.0.dmg", browser_download_url: "https://example.test/f-land.dmg" },
      { name: "Fap-Land-0.2.0.AppImage", browser_download_url: "https://example.test/f-land.AppImage" },
      { name: "Fap-Land-Setup-0.2.0.exe", browser_download_url: "https://example.test/f-land.exe" },
    ];

    const result = resolveReleaseAssetUrl(assets);

    if (process.platform === "win32") {
      expect(result).toBe("https://example.test/f-land.exe");
      return;
    }

    if (process.platform === "darwin") {
      expect(result).toBe("https://example.test/f-land.dmg");
      return;
    }

    expect(result).toBe("https://example.test/f-land.AppImage");
  });

  it("returns null when no compatible asset exists", () => {
    expect(resolveReleaseAssetUrl([
      { name: "latest.yml", browser_download_url: "https://example.test/latest.yml" },
    ])).toBeNull();
  });
});

describe("updater.shouldRefreshUpdateState", () => {
  it("refreshes idle or stale states", () => {
    const staleState: AppUpdateState = {
      status: "up_to_date",
      currentVersion: "0.1.0",
      latestVersion: "0.1.0",
      checkedAtIso: "2020-01-01T00:00:00.000Z",
      releasePageUrl: "https://example.test/releases/latest",
      downloadUrl: null,
      releaseNotes: null,
      publishedAtIso: null,
      canAutoUpdate: false,
      errorMessage: null,
    };

    expect(shouldRefreshUpdateState(staleState)).toBe(true);
    expect(shouldRefreshUpdateState({
      ...staleState,
      checkedAtIso: new Date().toISOString(),
    })).toBe(false);
  });
});
