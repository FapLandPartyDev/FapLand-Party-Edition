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

import { resolveExistingLocalMediaPath, toLocalMediaUri, fromLocalMediaUri } from "./localMedia";

let tempDir: string;
let previousEnv: NodeJS.ProcessEnv;
let originalPlatform: PropertyDescriptor | undefined;

describe("localMedia", () => {
  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "f-land-local-media-"));
    previousEnv = { ...process.env };
    originalPlatform = Object.getOwnPropertyDescriptor(process, "platform");
    Object.defineProperty(process, "platform", { value: "win32" });
    process.env.PORTABLE_EXECUTABLE_DIR = tempDir;
    delete process.env.FLAND_USER_DATA_SUFFIX;
  });

  afterEach(async () => {
    process.env = previousEnv;
    if (originalPlatform) {
      Object.defineProperty(process, "platform", originalPlatform);
    }
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("resolves a double-encoded local media path when the decoded file exists", async () => {
    const filePath = path.join(tempDir, "Fugtrup Zelda x Bokoblin.mp4");
    await fs.writeFile(filePath, "video");

    const doubleEncodedUri = toLocalMediaUri(filePath).replaceAll("%20", "%2520");
    const parsedPath = fromLocalMediaUri(doubleEncodedUri);

    expect(parsedPath).toContain("%20");
    expect(resolveExistingLocalMediaPath(parsedPath ?? "")).toBe(filePath);
  });

  it("preserves literal percent-encoded filenames when that exact file exists", async () => {
    const filePath = path.join(tempDir, "literal%20space.mp4");
    await fs.writeFile(filePath, "video");

    expect(resolveExistingLocalMediaPath(filePath)).toBe(filePath);
  });

  it("keeps external app media uris unchanged in portable mode", async () => {
    const externalDir = await fs.mkdtemp(path.join(os.tmpdir(), "f-land-local-media-external-"));
    const filePath = path.join(externalDir, "scene.mp4");
    await fs.writeFile(filePath, "video");

    expect(fromLocalMediaUri(toLocalMediaUri(filePath))).toBe(filePath);

    await fs.rm(externalDir, { recursive: true, force: true });
  });

  it("keeps external file uris unchanged in portable mode", async () => {
    const externalDir = await fs.mkdtemp(path.join(os.tmpdir(), "f-land-local-media-file-"));
    const filePath = path.join(externalDir, "scene.mp4");
    await fs.writeFile(filePath, "video");

    expect(fromLocalMediaUri(new URL(`file://${filePath}`).toString())).toBe(filePath);

    await fs.rm(externalDir, { recursive: true, force: true });
  });

  it("rebases stale moved portable absolute media paths when the new target exists", async () => {
    const currentPortableFile = path.join(tempDir, "data", "media", "portable.mp4");
    await fs.mkdir(path.dirname(currentPortableFile), { recursive: true });
    await fs.writeFile(currentPortableFile, "video");

    const stalePortableUri = `app://media/${encodeURIComponent(
      "C:\\Old\\Fap Land\\data\\media\\portable.mp4"
    )}`;

    expect(fromLocalMediaUri(stalePortableUri)).toBe(currentPortableFile);
  });
});
