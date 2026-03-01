// @vitest-environment node

import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

let userDataPath = "/tmp/f-land-user-data";
const storeValues = new Map<string, unknown>();
const portableMocks = vi.hoisted(() => ({
  resolvePortableAwareStoragePath: vi.fn(),
}));

vi.mock("electron", () => ({
  app: {
    getPath: vi.fn(() => userDataPath),
  },
}));

vi.mock("./portable", () => ({
  normalizeUserDataSuffix: (raw: string | undefined) => raw ?? null,
  resolvePortableAwareStoragePath: portableMocks.resolvePortableAwareStoragePath,
}));

vi.mock("./store", () => ({
  getStore: () => ({
    get: (key: string) => storeValues.get(key),
  }),
}));

vi.mock("./webVideo/binaries", () => ({
  resolveYtDlpBinary: vi.fn(),
}));

vi.mock("./phash/binaries", () => ({
  resolvePhashBinaries: vi.fn(),
}));

vi.mock("./phash/extract", () => ({
  runCommand: vi.fn(),
}));

import { resolveMusicCacheRoot } from "./musicDownload";

describe("musicDownload.resolveMusicCacheRoot", () => {
  beforeEach(() => {
    storeValues.clear();
    portableMocks.resolvePortableAwareStoragePath.mockReset();
    portableMocks.resolvePortableAwareStoragePath.mockReturnValue(null);
  });

  it("uses userData for the default music cache root", () => {
    expect(resolveMusicCacheRoot()).toBe(path.join(userDataPath, "music-cache"));
  });

  it("uses the configured custom root when present", () => {
    storeValues.set("music.cacheRootPath", "/custom/music-cache");
    expect(resolveMusicCacheRoot()).toBe(path.resolve("/custom/music-cache"));
  });

  it("rebases a legacy portable default music cache root to the current zip folder", () => {
    portableMocks.resolvePortableAwareStoragePath.mockReturnValue(
      "D:\\Games\\Fap Land\\data\\music-cache"
    );
    storeValues.set("music.cacheRootPath", "C:\\Old\\Fap Land\\data\\music-cache");

    expect(resolveMusicCacheRoot()).toBe("D:\\Games\\Fap Land\\data\\music-cache");
    expect(portableMocks.resolvePortableAwareStoragePath).toHaveBeenCalledWith(
      "C:\\Old\\Fap Land\\data\\music-cache",
      "music-cache",
      null
    );
  });
});
