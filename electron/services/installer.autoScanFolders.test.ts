// @vitest-environment node

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  app: {
    isPackaged: true,
  },
}));

const storeState = new Map<string, unknown>();

vi.mock("./store", () => ({
  getStore: vi.fn(() => ({
    get: (key: string) => storeState.get(key),
    set: (key: string, value: unknown) => {
      storeState.set(key, value);
    },
  })),
}));

vi.mock("./dialogPathApproval", () => ({
  assertApprovedDialogPath: vi.fn((_: string, input: string) => input),
  approveDialogPath: vi.fn(),
}));

vi.mock("./fpack", () => ({
  ensureFpackExtracted: vi.fn(),
  inspectFpack: vi.fn(),
}));

vi.mock("./db", () => ({
  getDb: vi.fn(),
}));

vi.mock("./phash", () => ({
  generateVideoPhash: vi.fn(),
  generateVideoPhashForNormalizedRange: vi.fn(),
  getNormalizedVideoHashRange: vi.fn(),
  toVideoHashRangeCacheKey: vi.fn(),
}));

vi.mock("./integrations", () => ({
  syncExternalSources: vi.fn(),
}));

vi.mock("./playlists", () => ({
  importPlaylistFromFile: vi.fn(),
}));

vi.mock("./roundPreview", () => ({
  generateRoundPreviewImageDataUri: vi.fn(),
}));

vi.mock("./videoDuration", () => ({
  resolveVideoDurationMsForLocalPath: vi.fn(),
}));

vi.mock("./funscript", () => ({
  calculateFunscriptDifficultyFromUri: vi.fn(),
}));

vi.mock("./security", () => ({
  classifyTrustedUrl: vi.fn(),
  collectUnknownRemoteSitesFromResources: vi.fn(() => []),
}));

vi.mock("./webVideo", () => ({
  parseWebsiteVideoProxyUri: vi.fn(),
}));

vi.mock("./webVideoScanService", () => ({
  startWebsiteVideoScan: vi.fn(),
}));

import { addAutoScanFolder, getAutoScanFolders, removeAutoScanFolder } from "./installer";

describe("installer auto-scan folders", () => {
  let tempDir: string;
  let previousEnv: NodeJS.ProcessEnv;
  let originalPlatform: PropertyDescriptor | undefined;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "f-land-installer-folders-"));
    previousEnv = { ...process.env };
    originalPlatform = Object.getOwnPropertyDescriptor(process, "platform");
    Object.defineProperty(process, "platform", { value: "win32" });
    process.env.PORTABLE_EXECUTABLE_DIR = tempDir;
    delete process.env.FLAND_USER_DATA_SUFFIX;
    storeState.clear();
  });

  afterEach(async () => {
    process.env = previousEnv;
    if (originalPlatform) {
      Object.defineProperty(process, "platform", originalPlatform);
    }
    storeState.clear();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("preserves saved auto-scan folders outside portable data and removes them by original path", async () => {
    const externalDir = await fs.mkdtemp(path.join(os.tmpdir(), "f-land-external-videos-"));

    await expect(addAutoScanFolder(externalDir)).resolves.toEqual([externalDir]);
    expect(getAutoScanFolders()).toEqual([externalDir]);
    expect(removeAutoScanFolder(externalDir)).toEqual([]);

    await fs.rm(externalDir, { recursive: true, force: true });
  });

  it("rebases saved auto-scan folders inside portable data after the portable root moves", async () => {
    const rebasedFolder = path.join(tempDir, "data", "videos");
    await fs.mkdir(rebasedFolder, { recursive: true });

    storeState.set("install.autoScanFolders", ["C:\\Old\\Fap Land\\data\\videos"]);

    expect(getAutoScanFolders()).toEqual([rebasedFolder]);
  });

  it("does not rewrite existing external folders that happen to include a data segment", async () => {
    const externalRoot = await fs.mkdtemp(path.join(os.tmpdir(), "f-land-external-data-root-"));
    const externalDir = path.join(externalRoot, "data", "videos");
    await fs.mkdir(externalDir, { recursive: true });

    storeState.set("install.autoScanFolders", [externalDir]);

    expect(getAutoScanFolders()).toEqual([externalDir]);

    await fs.rm(externalRoot, { recursive: true, force: true });
  });
});
