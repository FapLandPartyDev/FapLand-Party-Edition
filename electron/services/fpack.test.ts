// @vitest-environment node

import path from "node:path";
import fs from "node:fs/promises";
import { beforeEach, describe, expect, it, vi } from "vitest";

let userDataPath = "/tmp/f-land-user-data";
const storeValues = new Map<string, unknown>();
const portableMocks = vi.hoisted(() => ({
  resolvePortableAwareStoragePath: vi.fn(),
}));

vi.mock("electron", () => ({
  app: {
    getPath: vi.fn((name: string) => {
      if (name === "temp") return "/tmp";
      return userDataPath;
    }),
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

import {
  clearFpackExtractionCache,
  createFpackFromDirectory,
  ensureFpackExtracted,
  getFpackExtractionRoot,
  inspectFpack,
} from "./fpack";

describe("fpack.getFpackExtractionRoot", () => {
  beforeEach(() => {
    storeValues.clear();
    portableMocks.resolvePortableAwareStoragePath.mockReset();
    portableMocks.resolvePortableAwareStoragePath.mockReturnValue(null);
  });

  it("uses userData for the default extraction root", async () => {
    await expect(getFpackExtractionRoot()).resolves.toBe(path.join(userDataPath, "fpacks"));
  });

  it("uses the configured extraction root when present", async () => {
    storeValues.set("fpack.extractionPath", "/custom/fpacks");
    await expect(getFpackExtractionRoot()).resolves.toBe(path.resolve("/custom/fpacks"));
  });

  it("rebases a legacy portable default extraction root to the current zip folder", async () => {
    portableMocks.resolvePortableAwareStoragePath.mockReturnValue(
      "D:\\Games\\Fap Land\\data\\fpacks"
    );
    storeValues.set("fpack.extractionPath", "C:\\Old\\Fap Land\\data\\fpacks");

    await expect(getFpackExtractionRoot()).resolves.toBe("D:\\Games\\Fap Land\\data\\fpacks");
    expect(portableMocks.resolvePortableAwareStoragePath).toHaveBeenCalledWith(
      "C:\\Old\\Fap Land\\data\\fpacks",
      "fpacks",
      null
    );
  });

  it("clears the resolved extraction root", async () => {
    const tempRoot = await fs.mkdtemp(path.join("/tmp", "fpack-clear-test-"));
    userDataPath = tempRoot;
    storeValues.clear();
    portableMocks.resolvePortableAwareStoragePath.mockReset();
    portableMocks.resolvePortableAwareStoragePath.mockReturnValue(null);

    const extractionRoot = path.join(tempRoot, "fpacks");
    await fs.mkdir(path.join(extractionRoot, "pack-1"), { recursive: true });
    await fs.writeFile(path.join(extractionRoot, "pack-1", "demo.mp4"), "video", "utf8");

    await clearFpackExtractionCache();

    await expect(fs.access(extractionRoot)).rejects.toThrow();
  });

  it("clears a provided extraction root", async () => {
    const tempRoot = await fs.mkdtemp(path.join("/tmp", "fpack-clear-custom-test-"));
    const extractionRoot = path.join(tempRoot, "custom-fpacks");
    await fs.mkdir(path.join(extractionRoot, "pack-1"), { recursive: true });
    await fs.writeFile(path.join(extractionRoot, "pack-1", "demo.mp4"), "video", "utf8");

    await clearFpackExtractionCache(extractionRoot);

    await expect(fs.access(extractionRoot)).rejects.toThrow();
  });
});

describe("fpack archive workflows", () => {
  it("inspects sidecar entries without extraction and reuses cached extraction", async () => {
    const tempRoot = await fs.mkdtemp(path.join("/tmp", "fpack-test-"));
    userDataPath = tempRoot;
    storeValues.clear();
    portableMocks.resolvePortableAwareStoragePath.mockReset();
    portableMocks.resolvePortableAwareStoragePath.mockReturnValue(null);

    const sourceDir = path.join(tempRoot, "source");
    await fs.mkdir(sourceDir, { recursive: true });
    await fs.mkdir(path.join(sourceDir, "media"), { recursive: true });
    await fs.writeFile(
      path.join(sourceDir, "demo.round"),
      JSON.stringify({
        name: "Demo Round",
        resources: [{ videoUri: "./media/demo.mp4", funscriptUri: "./media/demo.funscript" }],
      }),
      "utf8"
    );
    await fs.writeFile(path.join(sourceDir, "media", "demo.mp4"), "video", "utf8");
    await fs.writeFile(path.join(sourceDir, "media", "demo.funscript"), "script", "utf8");

    const fpackPath = path.join(tempRoot, "demo.fpack");
    await createFpackFromDirectory(sourceDir, fpackPath);

    const inspection = await inspectFpack(fpackPath);
    expect(inspection.sidecarCount).toBe(1);
    expect(inspection.sidecars[0]?.archiveEntryPath).toBe("demo.round");
    expect(inspection.sidecars[0]?.resources[0]?.videoUri).toBe("media/demo.mp4");

    const extracted = await ensureFpackExtracted(fpackPath);
    expect(extracted.reused).toBe(false);
    expect(extracted.manifest.sidecarEntries[0]?.archiveEntryPath).toBe("demo.round");

    const reused = await ensureFpackExtracted(fpackPath);
    expect(reused.reused).toBe(true);
    expect(reused.dir).toBe(extracted.dir);
  });
});
