import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { generateVideoPhash } from "../phash";
import { resolvePhashBinaries } from "./binaries";
import { runCommand } from "./extract";
import { extractSpriteBmp } from "./extract";
import { decodeBmpFrame } from "./bmp";
import { generateSpritePhashHex } from "./phash";

vi.mock("../phashWorkerClient", () => ({
  computePhashInWorker: async (
    ffmpegPath: string,
    videoPath: string,
    range: unknown,
    options?: unknown
  ) => {
    const spriteBmp = await extractSpriteBmp(
      ffmpegPath,
      videoPath,
      range as Parameters<typeof extractSpriteBmp>[2],
      options as Parameters<typeof extractSpriteBmp>[3]
    );
    const sprite = decodeBmpFrame(spriteBmp);
    return generateSpritePhashHex(sprite);
  },
}));

async function createFixtureVideo(ffmpegPath: string, outputPath: string): Promise<void> {
  await runCommand(ffmpegPath, [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-f",
    "lavfi",
    "-i",
    "testsrc=size=320x240:rate=30:d=2",
    "-f",
    "lavfi",
    "-i",
    "testsrc2=size=320x240:rate=30:d=2",
    "-f",
    "lavfi",
    "-i",
    "smptebars=size=320x240:rate=30:d=2",
    "-filter_complex",
    "[0:v][1:v][2:v]concat=n=3:v=1:a=0,format=yuv420p",
    "-movflags",
    "+faststart",
    outputPath,
  ]);
}

describe("generateVideoPhash integration", () => {
  let tempDir = "";
  let videoPath = "";

  beforeAll(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "videophash-test-"));
    videoPath = path.join(tempDir, "fixture.mp4");

    const binaries = await resolvePhashBinaries();
    await createFixtureVideo(binaries.ffmpegPath, videoPath);
  }, 90_000);

  afterAll(async () => {
    if (!tempDir) return;
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("is deterministic for the same range", async () => {
    const a = await generateVideoPhash(videoPath, 0, 1900);
    const b = await generateVideoPhash(videoPath, 0, 1900);

    expect(a).toBeTruthy();
    expect(a).toBe(b);
  }, 90_000);

  it("creates different hashes for materially different sections", async () => {
    const full = await generateVideoPhash(videoPath);
    const sectionA = await generateVideoPhash(videoPath, 0, 1900);
    const sectionB = await generateVideoPhash(videoPath, 2100, 3900);
    const sectionC = await generateVideoPhash(videoPath, 4100, 5900);

    for (const value of [full, sectionA, sectionB, sectionC]) {
      expect(value).toMatch(/^[0-9a-f]+$/);
      expect(value.length).toBeGreaterThan(0);
    }

    expect(new Set([full, sectionA, sectionB, sectionC]).size).toBeGreaterThan(1);
  }, 90_000);
});
