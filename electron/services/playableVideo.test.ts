// @vitest-environment node

import { describe, expect, it, beforeEach, vi } from "vitest";

vi.mock("electron", () => ({
  app: {
    getPath: vi.fn(() => "/tmp/f-land-tests"),
  },
}));

vi.mock("node:fs/promises", () => {
  const api = {
    stat: vi.fn(),
    mkdir: vi.fn(),
    access: vi.fn(),
    rm: vi.fn(),
  };
  return { default: api, ...api };
});

vi.mock("./phash/binaries", () => ({
  resolvePhashBinaries: vi.fn(async () => ({
    ffmpegPath: "/mock/ffmpeg",
    ffprobePath: "/mock/ffprobe",
    source: "bundled",
    ffmpegVersion: "7.1.0",
    ffprobeVersion: "7.1.0",
  })),
}));

vi.mock("./phash/extract", () => ({
  runCommand: vi.fn(async () => ({
    stdout: Buffer.alloc(0),
    stderr: Buffer.alloc(0),
  })),
}));

import fs from "node:fs/promises";
import { runCommand } from "./phash/extract";
import {
  __resetPlayableVideoCachesForTests,
  buildTranscodeCacheKey,
  isLocalPlayableVideoUri,
  resolvePlayableVideoUri,
  toLocalVideoPath,
} from "./playableVideo";

describe("playableVideo", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetPlayableVideoCachesForTests();
  });

  it("keeps remote urls unchanged", async () => {
    const result = await resolvePlayableVideoUri("https://cdn.example.com/video.mp4");
    expect(result).toEqual({
      videoUri: "https://cdn.example.com/video.mp4",
      transcoded: false,
      cacheHit: false,
    });
    expect(runCommand).not.toHaveBeenCalled();
  });

  it("resolves local uris and transcodes on cache miss", async () => {
    vi.mocked(fs.stat).mockResolvedValue({
      isFile: () => true,
      size: 1000,
      mtimeMs: 2000,
    } as any);
    let outputExists = false;
    vi.mocked(fs.mkdir).mockResolvedValue(undefined);
    vi.mocked(fs.rm).mockResolvedValue(undefined);
    vi.mocked(runCommand).mockImplementation(async (_command, args) => {
      if (args.includes("-show_entries")) {
        return {
          stdout: Buffer.from(JSON.stringify({ streams: [{ codec_name: "hevc" }] }), "utf8"),
          stderr: Buffer.alloc(0),
        };
      }
      outputExists = true;
      return { stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) };
    });
    vi.mocked(fs.access).mockImplementation(async () => {
      if (!outputExists) throw new Error("missing");
    });

    const result = await resolvePlayableVideoUri("app://media/%2Ftmp%2Fvideo.hevc");
    expect(result.transcoded).toBe(true);
    expect(result.cacheHit).toBe(false);
    expect(result.videoUri.startsWith("app://media/")).toBe(true);
    expect(runCommand).toHaveBeenCalledTimes(2);
  });

  it("reuses cached output when it exists", async () => {
    vi.mocked(fs.stat).mockResolvedValue({
      isFile: () => true,
      size: 1000,
      mtimeMs: 2000,
    } as any);
    vi.mocked(fs.mkdir).mockResolvedValue(undefined);
    vi.mocked(fs.access).mockResolvedValue(undefined);

    vi.mocked(runCommand).mockImplementation(async (_command, args) => {
      if (args.includes("-show_entries")) {
        return {
          stdout: Buffer.from(JSON.stringify({ streams: [{ codec_name: "hevc" }] }), "utf8"),
          stderr: Buffer.alloc(0),
        };
      }
      return { stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) };
    });

    const result = await resolvePlayableVideoUri("app://media/%2Ftmp%2Fvideo.hevc");
    expect(result.transcoded).toBe(true);
    expect(result.cacheHit).toBe(true);
    expect(runCommand).toHaveBeenCalledTimes(1);
  });

  it("deduplicates concurrent transcode requests for same source", async () => {
    vi.mocked(fs.stat).mockResolvedValue({
      isFile: () => true,
      size: 1000,
      mtimeMs: 2000,
    } as any);
    vi.mocked(fs.mkdir).mockResolvedValue(undefined);
    vi.mocked(fs.rm).mockResolvedValue(undefined);

    let outputExists = false;
    let resolveRun: (() => void) | null = null;
    const runPromise = new Promise<void>((resolve) => {
      resolveRun = resolve;
    });

    vi.mocked(runCommand).mockImplementation(async (_command, args) => {
      if (args.includes("-show_entries")) {
        return {
          stdout: Buffer.from(JSON.stringify({ streams: [{ codec_name: "hevc" }] }), "utf8"),
          stderr: Buffer.alloc(0),
        };
      }
      await runPromise;
      outputExists = true;
      return { stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) };
    });
    vi.mocked(fs.access).mockImplementation(async () => {
      if (!outputExists) throw new Error("missing");
    });

    const first = resolvePlayableVideoUri("app://media/%2Ftmp%2Fvideo.hevc");
    const second = resolvePlayableVideoUri("app://media/%2Ftmp%2Fvideo.hevc");

    const ffmpegCallsBeforeRelease = () =>
      vi.mocked(runCommand).mock.calls.filter(([, args]) => !args.includes("-show_entries")).length;

    try {
      await vi.waitFor(() => {
        expect(ffmpegCallsBeforeRelease()).toBe(1);
      });
    } finally {
      resolveRun?.();
    }

    const [a, b] = await Promise.all([first, second]);
    expect(a.videoUri).toBe(b.videoUri);
    expect(ffmpegCallsBeforeRelease()).toBe(1);
  });

  it("retranscodes when source fingerprint changes", async () => {
    const stats = [
      { isFile: () => true, size: 1000, mtimeMs: 2000 },
      { isFile: () => true, size: 1000, mtimeMs: 3000 },
    ];
    vi.mocked(fs.stat).mockImplementation(async () => stats.shift() as any);
    vi.mocked(fs.mkdir).mockResolvedValue(undefined);
    vi.mocked(fs.rm).mockResolvedValue(undefined);

    let outputExists = false;
    vi.mocked(fs.access).mockImplementation(async () => {
      if (!outputExists) throw new Error("missing");
    });
    vi.mocked(runCommand).mockImplementation(async (_command, args) => {
      if (args.includes("-show_entries")) {
        return {
          stdout: Buffer.from(JSON.stringify({ streams: [{ codec_name: "hevc" }] }), "utf8"),
          stderr: Buffer.alloc(0),
        };
      }
      outputExists = true;
      return { stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) };
    });

    await resolvePlayableVideoUri("app://media/%2Ftmp%2Fvideo.hevc");
    outputExists = false;
    await resolvePlayableVideoUri("app://media/%2Ftmp%2Fvideo.hevc");
    const ffmpegCalls = vi.mocked(runCommand).mock.calls.filter(([, args]) => !args.includes("-show_entries"));
    expect(ffmpegCalls).toHaveLength(2);
  });

  it("keeps codec-compatible local videos unchanged", async () => {
    vi.mocked(fs.stat).mockResolvedValue({
      isFile: () => true,
      size: 1000,
      mtimeMs: 2000,
    } as any);
    vi.mocked(fs.mkdir).mockResolvedValue(undefined);
    vi.mocked(runCommand).mockImplementation(async (_command, args) => {
      if (args.includes("-show_entries")) {
        return {
          stdout: Buffer.from(JSON.stringify({ streams: [{ codec_name: "h264" }] }), "utf8"),
          stderr: Buffer.alloc(0),
        };
      }
      return { stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) };
    });

    const originalUri = "app://media/%2Ftmp%2Fvideo.mp4";
    const result = await resolvePlayableVideoUri(originalUri);
    expect(result).toEqual({
      videoUri: originalUri,
      transcoded: false,
      cacheHit: false,
    });
    const ffmpegCalls = vi.mocked(runCommand).mock.calls.filter(([, args]) => !args.includes("-show_entries"));
    expect(ffmpegCalls).toHaveLength(0);
  });

  it("exposes deterministic helpers", () => {
    const keyA = buildTranscodeCacheKey({
      normalizedPath: "/tmp/a.mp4",
      fileSizeBytes: 1,
      modifiedMs: 2,
      ffmpegVersion: "7.1.0",
    });
    const keyB = buildTranscodeCacheKey({
      normalizedPath: "/tmp/a.mp4",
      fileSizeBytes: 1,
      modifiedMs: 2,
      ffmpegVersion: "7.1.0",
    });
    const keyC = buildTranscodeCacheKey({
      normalizedPath: "/tmp/a.mp4",
      fileSizeBytes: 1,
      modifiedMs: 3,
      ffmpegVersion: "7.1.0",
    });

    expect(keyA).toBe(keyB);
    expect(keyC).not.toBe(keyA);
    expect(isLocalPlayableVideoUri("app://media/%2Ftmp%2Fvideo.mp4")).toBe(true);
    expect(isLocalPlayableVideoUri("https://example.com/video.mp4")).toBe(false);
    expect(toLocalVideoPath("app://media/%2Ftmp%2Fvideo.mp4")).toBe("/tmp/video.mp4");
  });
});
