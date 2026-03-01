// @vitest-environment node

import path from "node:path";
import { describe, expect, it, vi } from "vitest";

let userDataPath = "/tmp/f-land-user-data";
const storeValues = new Map<string, unknown>();

vi.mock("electron", () => ({
  app: {
    getPath: vi.fn(() => userDataPath),
  },
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
  it("uses userData for the default music cache root", () => {
    storeValues.clear();
    expect(resolveMusicCacheRoot()).toBe(path.join(userDataPath, "music-cache"));
  });

  it("uses the configured custom root when present", () => {
    storeValues.set("music.cacheRootPath", "/custom/music-cache");
    expect(resolveMusicCacheRoot()).toBe(path.resolve("/custom/music-cache"));
  });
});
