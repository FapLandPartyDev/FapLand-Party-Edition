// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getConfiguredVideoHashBinaryPreference: vi.fn(() => "auto" as const),
  resolvePhashBinaries: vi.fn(),
  resetPhashBinariesCache: vi.fn(),
  getConfiguredYtDlpBinaryPreference: vi.fn(() => "auto" as const),
  resolveYtDlpBinary: vi.fn(),
  resetYtDlpBinaryCache: vi.fn(),
}));

vi.mock("../../services/phash/binaries", () => ({
  getConfiguredVideoHashBinaryPreference: mocks.getConfiguredVideoHashBinaryPreference,
  resolvePhashBinaries: mocks.resolvePhashBinaries,
  resetPhashBinariesCache: mocks.resetPhashBinariesCache,
}));

vi.mock("../../services/webVideo/binaries", () => ({
  getConfiguredYtDlpBinaryPreference: mocks.getConfiguredYtDlpBinaryPreference,
  resolveYtDlpBinary: mocks.resolveYtDlpBinary,
  resetYtDlpBinaryCache: mocks.resetYtDlpBinaryCache,
}));

import { binariesRouter } from "./binaries";
import type { Context } from "../trpc";

const testContext: Context = {
  event: {
    sender: {},
  } as Context["event"],
};

describe("binariesRouter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns resolved bundled versions for ffmpeg, ffprobe, and yt-dlp", async () => {
    mocks.resolvePhashBinaries.mockResolvedValue({
      ffmpegPath: "/bundle/ffmpeg",
      ffprobePath: "/bundle/ffprobe",
      source: "bundled",
      ffmpegVersion: "7.1.0",
      ffprobeVersion: "7.1.0",
    });
    mocks.resolveYtDlpBinary.mockResolvedValue({
      ytDlpPath: "/bundle/yt-dlp",
      source: "bundled",
      version: "2026.04.01",
    });

    const caller = binariesRouter.createCaller(testContext);
    const result = await caller.getResolvedVersions();

    expect(mocks.resetPhashBinariesCache).toHaveBeenCalledTimes(1);
    expect(mocks.resetYtDlpBinaryCache).toHaveBeenCalledTimes(1);
    expect(result.ffmpeg).toMatchObject({
      tool: "ffmpeg",
      preference: "auto",
      source: "bundled",
      path: "/bundle/ffmpeg",
      version: "7.1.0",
      error: null,
    });
    expect(result.ffprobe).toMatchObject({
      tool: "ffprobe",
      preference: "auto",
      source: "bundled",
      path: "/bundle/ffprobe",
      version: "7.1.0",
      error: null,
    });
    expect(result.ytDlp).toMatchObject({
      tool: "yt-dlp",
      preference: "auto",
      source: "bundled",
      path: "/bundle/yt-dlp",
      version: "2026.04.01",
      error: null,
    });
    expect(Date.parse(result.checkedAtIso)).not.toBeNaN();
  });

  it("returns partial ffmpeg failure without hiding yt-dlp", async () => {
    mocks.resolvePhashBinaries.mockRejectedValue(new Error("ffmpeg unavailable"));
    mocks.resolveYtDlpBinary.mockResolvedValue({
      ytDlpPath: "yt-dlp",
      source: "system",
      version: "2026.04.01",
    });

    const caller = binariesRouter.createCaller(testContext);
    const result = await caller.getResolvedVersions();

    expect(result.ffmpeg).toMatchObject({
      source: null,
      path: null,
      version: null,
      error: "ffmpeg unavailable",
    });
    expect(result.ffprobe).toMatchObject({
      source: null,
      path: null,
      version: null,
      error: "ffmpeg unavailable",
    });
    expect(result.ytDlp).toMatchObject({
      source: "system",
      path: "yt-dlp",
      version: "2026.04.01",
      error: null,
    });
  });

  it("returns partial yt-dlp failure without hiding ffmpeg", async () => {
    mocks.resolvePhashBinaries.mockResolvedValue({
      ffmpegPath: "ffmpeg",
      ffprobePath: "ffprobe",
      source: "system",
      ffmpegVersion: "7.2.0",
      ffprobeVersion: "7.2.0",
    });
    mocks.resolveYtDlpBinary.mockRejectedValue(new Error("yt-dlp unavailable"));

    const caller = binariesRouter.createCaller(testContext);
    const result = await caller.getResolvedVersions();

    expect(result.ffmpeg).toMatchObject({
      source: "system",
      path: "ffmpeg",
      version: "7.2.0",
      error: null,
    });
    expect(result.ffprobe).toMatchObject({
      source: "system",
      path: "ffprobe",
      version: "7.2.0",
      error: null,
    });
    expect(result.ytDlp).toMatchObject({
      source: null,
      path: null,
      version: null,
      error: "yt-dlp unavailable",
    });
  });
});
