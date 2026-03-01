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

import {
  compareVersions,
  resolveReleaseAssetUrl,
  shouldRefreshUpdateState,
  getReleaseConfig,
  type AppUpdateState,
} from "./updater";

describe("updater.getReleaseConfig", () => {
  it("parses valid repository strings", () => {
    vi.stubEnv("FLAND_UPDATE_REPOSITORY", "owner/repo");
    const result = getReleaseConfig();
    expect(result?.apiUrl).toBe("https://api.github.com/repos/owner/repo/releases/latest");
    vi.unstubAllEnvs();
  });

  it("handles trailing slashes by trimming them", () => {
    vi.stubEnv("FLAND_UPDATE_REPOSITORY", "owner/repo/");
    const result = getReleaseConfig();
    expect(result?.apiUrl).toBe("https://api.github.com/repos/owner/repo/releases/latest");
    vi.unstubAllEnvs();
  });

  it("returns null for malformed repository strings", () => {
    vi.stubEnv("FLAND_UPDATE_REPOSITORY", "invalid-format");
    expect(getReleaseConfig()).toBeNull();
    vi.unstubAllEnvs();
  });
});

describe("updater.compareVersions", () => {
  it("treats higher semantic versions as newer", () => {
    expect(compareVersions("0.2.0", "0.1.9")).toBe(1);
    expect(compareVersions("1.0.0", "1.0.0")).toBe(0);
    expect(compareVersions("1.0.0", "1.2.0")).toBe(-1);
  });

  it("ignores build metadata when comparing versions", () => {
    expect(compareVersions("0.1.0+deadbeef", "0.1.0+12345678")).toBe(0);
    expect(compareVersions("0.2.0", "0.1.9+deadbeef")).toBe(1);
  });
});

describe("updater.resolveReleaseAssetUrl", () => {
  it("selects the Windows installer asset when both installer and portable assets exist", () => {
    const assets = [
      {
        name: "Fap Land-Portable-0.2.0.zip",
        browser_download_url: "https://example.test/f-land-portable.zip",
      },
      {
        name: "Fap Land-Setup-0.2.0.exe",
        browser_download_url: "https://example.test/f-land-setup.exe",
      },
    ];

    expect(resolveReleaseAssetUrl(assets, "windows-installer")).toBe(
      "https://example.test/f-land-setup.exe"
    );
  });

  it("selects the Windows portable asset when both installer and portable assets exist", () => {
    const assets = [
      {
        name: "Fap Land-Setup-0.2.0.exe",
        browser_download_url: "https://example.test/f-land-setup.exe",
      },
      {
        name: "Fap Land-Portable-0.2.0.zip",
        browser_download_url: "https://example.test/f-land-portable.zip",
      },
    ];

    expect(resolveReleaseAssetUrl(assets, "windows-portable")).toBe(
      "https://example.test/f-land-portable.zip"
    );
  });

  it("keeps macOS and Linux asset selection unchanged", () => {
    expect(
      resolveReleaseAssetUrl(
        [{ name: "Fap-Land-0.2.0.dmg", browser_download_url: "https://example.test/f-land.dmg" }],
        "macos"
      )
    ).toBe("https://example.test/f-land.dmg");
    expect(
      resolveReleaseAssetUrl(
        [
          {
            name: "Fap-Land-0.2.0.AppImage",
            browser_download_url: "https://example.test/f-land.AppImage",
          },
        ],
        "linux-appimage"
      )
    ).toBe("https://example.test/f-land.AppImage");
  });

  it("returns null when no compatible asset exists", () => {
    expect(
      resolveReleaseAssetUrl(
        [{ name: "latest.yml", browser_download_url: "https://example.test/latest.yml" }],
        "windows-portable"
      )
    ).toBeNull();
  });

  it("does not select old Windows portable exe assets for portable updates", () => {
    expect(
      resolveReleaseAssetUrl(
        [
          {
            name: "Fap Land-Portable-0.2.0.exe",
            browser_download_url: "https://example.test/f-land-portable.exe",
          },
        ],
        "windows-portable"
      )
    ).toBeNull();
  });

  it("keeps Linux AppImage preference from selecting portable zip assets", () => {
    expect(
      resolveReleaseAssetUrl(
        [
          {
            name: "Fap Land-Portable-0.2.0.zip",
            browser_download_url: "https://example.test/f-land-portable.zip",
          },
          {
            name: "Fap-Land-0.2.0.AppImage",
            browser_download_url: "https://example.test/f-land.AppImage",
          },
        ],
        "linux-appimage"
      )
    ).toBe("https://example.test/f-land.AppImage");
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
    expect(
      shouldRefreshUpdateState({
        ...staleState,
        checkedAtIso: new Date().toISOString(),
      })
    ).toBe(false);
  });
});
