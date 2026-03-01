import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  outputRoot: "",
}));

vi.mock("./storagePaths", () => ({
  HARDMODE_FUNSCRIPT_RELATIVE_PATH: "hardmode-funscripts",
  resolveDefaultStoragePath: () => mocks.outputRoot,
}));

import {
  convertFunscriptUriToManagedHardMode,
  convertLegacyFunscriptToHardMode,
  convertLocalFunscriptToManagedHardMode,
  getHardModeAttachmentRevert,
  recordHardModeAttachmentReverts,
} from "./funscript";
import { fromLocalMediaUri, toLocalMediaUri } from "./localMedia";

describe("convertLegacyFunscriptToHardMode", () => {
  it("turns every legacy dot into a down point and adds full up points between them", () => {
    const result = convertLegacyFunscriptToHardMode(
      JSON.stringify({
        actions: [
          { at: 100, pos: 100 },
          { at: 300, pos: 0 },
          { at: 500, pos: 75 },
        ],
      })
    );

    expect(result.document.actions).toEqual([
      { at: 100, pos: 0 },
      { at: 200, pos: 100 },
      { at: 300, pos: 0 },
      { at: 400, pos: 100 },
      { at: 500, pos: 0 },
    ]);
    expect(result.sourceActions).toBe(3);
    expect(result.outputActions).toBe(5);
  });

  it("rounds odd midpoints while keeping them strictly between source actions", () => {
    const result = convertLegacyFunscriptToHardMode(
      JSON.stringify({
        actions: [
          { at: 10, pos: 0 },
          { at: 15, pos: 100 },
        ],
      })
    );

    expect(result.document.actions).toEqual([
      { at: 10, pos: 0 },
      { at: 13, pos: 100 },
      { at: 15, pos: 0 },
    ]);
  });

  it("keeps long pauses at the bottom and resumes midpoint strokes in the next group", () => {
    const result = convertLegacyFunscriptToHardMode(
      JSON.stringify({
        actions: [
          { at: 0, pos: 0 },
          { at: 250, pos: 100 },
          { at: 500, pos: 0 },
          { at: 2_000, pos: 100 },
          { at: 2_250, pos: 0 },
        ],
      })
    );

    expect(result.document.actions).toEqual([
      { at: 0, pos: 0 },
      { at: 125, pos: 100 },
      { at: 250, pos: 0 },
      { at: 375, pos: 100 },
      { at: 500, pos: 0 },
      { at: 2_000, pos: 0 },
      { at: 2_125, pos: 100 },
      { at: 2_250, pos: 0 },
    ]);
  });

  it("treats a first gap over five seconds as a pause", () => {
    const result = convertLegacyFunscriptToHardMode(
      JSON.stringify({
        actions: [
          { at: 100, pos: 0 },
          { at: 5_101, pos: 100 },
          { at: 5_301, pos: 0 },
        ],
      })
    );

    expect(result.document.actions).toEqual([
      { at: 100, pos: 0 },
      { at: 5_101, pos: 0 },
      { at: 5_201, pos: 100 },
      { at: 5_301, pos: 0 },
    ]);
  });

  it("normalizes, sorts, clamps, rounds, and deduplicates source timestamps", () => {
    const result = convertLegacyFunscriptToHardMode(
      JSON.stringify({
        actions: [
          { at: "300", pos: 100 },
          { at: -20, pos: 0 },
          { at: 100.4, pos: 25 },
          { at: 100.49, pos: 75 },
          { at: "bad", pos: 50 },
          null,
        ],
      })
    );

    expect(result.sourceActions).toBe(3);
    expect(result.document.actions).toEqual([
      { at: 0, pos: 0 },
      { at: 50, pos: 100 },
      { at: 100, pos: 0 },
      { at: 200, pos: 100 },
      { at: 300, pos: 0 },
    ]);
  });

  it("skips a midpoint that cannot fit between adjacent integer timestamps", () => {
    const result = convertLegacyFunscriptToHardMode(
      JSON.stringify({
        actions: [
          { at: 10, pos: 0 },
          { at: 11, pos: 100 },
        ],
      })
    );

    expect(result.document.actions).toEqual([
      { at: 10, pos: 0 },
      { at: 11, pos: 0 },
    ]);
  });

  it("preserves metadata and emits explicit Handy-compatible settings", () => {
    const result = convertLegacyFunscriptToHardMode(
      JSON.stringify({
        version: "2.0",
        range: 90,
        inverted: true,
        metadata: { title: "Legacy hero" },
        custom: "kept",
        actions: [
          { at: 0, pos: 90 },
          { at: 200, pos: 0 },
        ],
      })
    );

    expect(result.document).toMatchObject({
      version: "2.0",
      range: 100,
      inverted: false,
      metadata: { title: "Legacy hero" },
      custom: "kept",
      fLandHardMode: { converter: "f-land", version: 1 },
    });
  });

  it("defaults invalid versions and rejects malformed or unusable scripts", () => {
    const valid = convertLegacyFunscriptToHardMode(
      JSON.stringify({
        version: 2,
        actions: [
          { at: 0, pos: 0 },
          { at: 200, pos: 100 },
        ],
      })
    );
    expect(valid.document.version).toBe("1.0");

    expect(() => convertLegacyFunscriptToHardMode("{")).toThrow("not valid funscript JSON");
    expect(() => convertLegacyFunscriptToHardMode(JSON.stringify({}))).toThrow("actions array");
    expect(() =>
      convertLegacyFunscriptToHardMode(JSON.stringify({ actions: [{ at: 100, pos: 0 }] }))
    ).toThrow("at least two distinct");
  });

  it("rejects scripts previously generated by F-Land", () => {
    expect(() =>
      convertLegacyFunscriptToHardMode(
        JSON.stringify({
          fLandHardMode: { converter: "f-land", version: 1 },
          actions: [
            { at: 0, pos: 0 },
            { at: 100, pos: 100 },
          ],
        })
      )
    ).toThrow("already converted");
  });
});

describe("convertLocalFunscriptToManagedHardMode", () => {
  let temporaryRoot = "";

  beforeEach(async () => {
    temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "f-land-hardmode-test-"));
    mocks.outputRoot = path.join(temporaryRoot, "managed");
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  });

  it("creates and reuses deterministic managed output without changing the source", async () => {
    const sourcePath = path.join(temporaryRoot, "Legacy Hero.funscript");
    const sourceContent = JSON.stringify({
      actions: [
        { at: 100, pos: 100 },
        { at: 300, pos: 0 },
      ],
    });
    await fs.writeFile(sourcePath, sourceContent, "utf8");

    const first = await convertLocalFunscriptToManagedHardMode(toLocalMediaUri(sourcePath));
    const second = await convertLocalFunscriptToManagedHardMode(toLocalMediaUri(sourcePath));
    const outputPath = fromLocalMediaUri(first.funscriptUri);

    expect(second).toEqual(first);
    expect(outputPath).toMatch(/Legacy-Hero-hard-mode-[a-f0-9]{12}\.funscript$/u);
    expect(await fs.readFile(sourcePath, "utf8")).toBe(sourceContent);
    expect(JSON.parse(await fs.readFile(outputPath!, "utf8"))).toMatchObject({
      range: 100,
      inverted: false,
      fLandHardMode: { converter: "f-land", version: 1 },
    });
    expect(
      (await fs.readdir(mocks.outputRoot)).filter((name) => name.endsWith(".funscript"))
    ).toHaveLength(1);
  });

  it("only accepts local .funscript files", async () => {
    await expect(
      convertLocalFunscriptToManagedHardMode("https://example.com/legacy.funscript")
    ).rejects.toThrow("local .funscript");
  });

  it("downloads and converts an attached remote funscript", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          actions: [
            { at: 100, pos: 100 },
            { at: 300, pos: 0 },
          ],
        }),
        { status: 200 }
      )
    );

    const result = await convertFunscriptUriToManagedHardMode(
      "https://media.example/scene/Legacy%20Remote.funscript"
    );
    const outputPath = fromLocalMediaUri(result.funscriptUri);

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(outputPath).toMatch(/Legacy-Remote-hard-mode-[a-f0-9]{12}\.funscript$/u);
    expect(JSON.parse(await fs.readFile(outputPath!, "utf8")).actions).toEqual([
      { at: 100, pos: 0 },
      { at: 200, pos: 100 },
      { at: 300, pos: 0 },
    ]);
  });

  it("records the exact previous attachment for each converted resource", async () => {
    await recordHardModeAttachmentReverts([
      {
        resourceId: "resource-a",
        hardModeFunscriptUri: "app://media/generated.funscript",
        previousFunscriptUri: "https://stash.example/a.funscript",
      },
      {
        resourceId: "resource-b",
        hardModeFunscriptUri: "app://media/generated.funscript",
        previousFunscriptUri: null,
      },
    ]);

    await expect(
      getHardModeAttachmentRevert("resource-a", "app://media/generated.funscript")
    ).resolves.toMatchObject({
      previousFunscriptUri: "https://stash.example/a.funscript",
    });
    await expect(
      getHardModeAttachmentRevert("resource-b", "app://media/generated.funscript")
    ).resolves.toMatchObject({ previousFunscriptUri: null });
    await expect(
      getHardModeAttachmentRevert("resource-a", "app://media/other.funscript")
    ).resolves.toBeNull();
  });
});
