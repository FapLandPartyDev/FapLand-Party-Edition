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

vi.mock("./webVideo", () => ({
  buildWebsiteVideoProxyUri: vi.fn((videoUri: string) => `app://external/web-url?target=${encodeURIComponent(videoUri)}`),
  getCachedWebsiteVideoLocalPath: vi.fn(async () => null),
  isWebsiteVideoResolvableUri: vi.fn((uri: string) => uri.startsWith("app://external/")),
  isStashProxyUri: vi.fn((uri: string) => uri.startsWith("app://external/stash?")),
  parseStashProxyUri: vi.fn((uri: string) => {
    try {
      const url = new URL(uri);
      return { targetUrl: url.searchParams.get("target") };
    } catch {
      return null;
    }
  }),
  warmWebsiteVideoCache: vi.fn(() => null),
}));

vi.mock("./integrations", () => ({
  resolveMediaUri: vi.fn((uri: string) => uri),
}));

import fs from "node:fs/promises";
import { runCommand } from "./phash/extract";
import {
  getCachedWebsiteVideoLocalPath,
  isStashProxyUri,
  isWebsiteVideoResolvableUri,
  warmWebsiteVideoCache,
} from "./webVideo";
import { resolveMediaUri } from "./integrations";
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
    vi.mocked(getCachedWebsiteVideoLocalPath).mockResolvedValue(null);
    vi.mocked(isWebsiteVideoResolvableUri).mockReturnValue(false);
    vi.mocked(isStashProxyUri).mockImplementation((uri: string) => uri.startsWith("app://external/stash?"));
    vi.mocked(warmWebsiteVideoCache).mockReturnValue(null);
    vi.mocked(resolveMediaUri).mockImplementation((uri: string) => uri);

    // Default stat mock: return a successful file stat by default
    vi.mocked(fs.stat).mockResolvedValue({
      isFile: () => true,
      size: 1000,
      mtimeMs: 2000,
    } as any);

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

  it("keeps website urls non-playable until the local cache exists", async () => {
    vi.mocked(isWebsiteVideoResolvableUri).mockReturnValue(true);
    const pending = Promise.resolve({
      originalUrl: "https://example.com/watch?v=1",
      extractor: "generic",
      title: "Example",
      durationMs: 1_000,
      finalFilePath: "/tmp/example.mp4",
      fileExtension: "mp4",
      ytDlpVersion: "2025.12.08",
      createdAt: "2026-01-01T00:00:00.000Z",
      lastAccessedAt: "2026-01-01T00:00:00.000Z",
    });
    vi.mocked(warmWebsiteVideoCache).mockReturnValue(pending);

    const uri = "app://external/web-url?target=https%3A%2F%2Fexample.com%2Fwatch%3Fv%3D1";
    const result = await resolvePlayableVideoUri(uri);
    expect(result).toEqual({
      videoUri: uri,
      transcoded: false,
      cacheHit: false,
    });
    // In this test, it calls getCachedWebsiteVideoLocalPath, which returns null, so it warms cache.
    expect(getCachedWebsiteVideoLocalPath).toHaveBeenCalledWith(uri);
    expect(warmWebsiteVideoCache).toHaveBeenCalledWith(uri);
  });

  it("returns raw website urls while caching warms in the background", async () => {
    vi.mocked(isWebsiteVideoResolvableUri).mockReturnValue(true);
    vi.mocked(warmWebsiteVideoCache).mockReturnValue(Promise.resolve({
      originalUrl: "https://www.pornhub.com/view_video.php?viewkey=1",
      extractor: "PornHub",
      title: "Example",
      durationMs: 1_000,
      finalFilePath: "/tmp/example.mp4",
      fileExtension: "mp4",
      ytDlpVersion: "2025.12.08",
      createdAt: "2026-01-01T00:00:00.000Z",
      lastAccessedAt: "2026-01-01T00:00:00.000Z",
    }));

    const result = await resolvePlayableVideoUri("https://www.pornhub.com/view_video.php?viewkey=1");
    expect(result).toEqual({
      videoUri: "app://external/web-url?target=https%3A%2F%2Fwww.pornhub.com%2Fview_video.php%3Fviewkey%3D1",
      transcoded: false,
      cacheHit: false,
    });
  });

  it("returns the cached local website video when one already exists", async () => {
    vi.mocked(isWebsiteVideoResolvableUri).mockImplementation((uri) => uri.startsWith("app://external/web-url?"));
    vi.mocked(getCachedWebsiteVideoLocalPath).mockResolvedValue("/tmp/cached-website.mp4");

    vi.mocked(runCommand).mockImplementation(async (_command, args) => {
      if (args.includes("-show_entries")) {
        return {
          stdout: Buffer.from(JSON.stringify({ streams: [{ codec_name: "h264", pix_fmt: "yuv420p" }] }), "utf8"),
          stderr: Buffer.alloc(0),
        };
      }
      return { stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) };
    });

    const result = await resolvePlayableVideoUri("app://external/web-url?target=https%3A%2F%2Fexample.com%2Fwatch%3Fv%3D1");
    expect(result).toEqual({
      videoUri: "app://media/%2Ftmp%2Fcached-website.mp4",
      transcoded: false,
      cacheHit: true,
    });
    expect(warmWebsiteVideoCache).not.toHaveBeenCalled();
  });

  it("resolves local uris and transcodes on cache miss", async () => {
    let outputExists = false;
    vi.mocked(fs.stat).mockImplementation(async (targetPath?: any) => {
      // Simulate cache miss for output path
      if (typeof targetPath === "string" && targetPath.includes("video-playback-cache") && !outputExists) {
        throw new Error("File not found");
      }
      return { isFile: () => true, size: 1000, mtimeMs: 2000 } as any;
    });
    vi.mocked(fs.mkdir).mockResolvedValue(undefined);
    vi.mocked(fs.rm).mockResolvedValue(undefined);
    vi.mocked(runCommand).mockImplementation(async (_command, args) => {
      if (args.includes("-show_entries")) {
        return {
          stdout: Buffer.from(JSON.stringify({ streams: [{ codec_name: "hevc", pix_fmt: "yuv420p" }] }), "utf8"),
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
    vi.mocked(fs.mkdir).mockResolvedValue(undefined);
    vi.mocked(fs.access).mockResolvedValue(undefined);

    vi.mocked(runCommand).mockImplementation(async (_command, args) => {
      if (args.includes("-show_entries")) {
        return {
          stdout: Buffer.from(JSON.stringify({ streams: [{ codec_name: "hevc", pix_fmt: "yuv420p" }] }), "utf8"),
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

  it("drops empty cached transcodes and rebuilds them", async () => {
    vi.mocked(fs.stat).mockImplementation(async (targetPath?: any) => {
      if (typeof targetPath === "string" && targetPath.endsWith(".hevc")) {
        return {
          isFile: () => true,
          size: 1000,
          mtimeMs: 2000,
        } as any;
      }
      // Simulate existing empty output file
      return {
        isFile: () => true,
        size: 0,
        mtimeMs: 2000,
      } as any;
    });
    vi.mocked(fs.mkdir).mockResolvedValue(undefined);
    vi.mocked(fs.access).mockResolvedValue(undefined);
    vi.mocked(fs.rm).mockResolvedValue(undefined);

    let ffmpegRuns = 0;
    vi.mocked(runCommand).mockImplementation(async (_command, args) => {
      if (args.includes("-show_entries")) {
        return {
          stdout: Buffer.from(JSON.stringify({ streams: [{ codec_name: "hevc", pix_fmt: "yuv420p" }] }), "utf8"),
          stderr: Buffer.alloc(0),
        };
      }

      ffmpegRuns += 1;
      return { stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) };
    });

    await expect(resolvePlayableVideoUri("app://media/%2Ftmp%2Fvideo.hevc")).rejects.toThrow(
      "Transcode did not produce an output file."
    );

    expect(ffmpegRuns).toBe(1);
    expect(fs.rm).toHaveBeenCalled();
  });

  it("deduplicates concurrent transcode requests for same source", async () => {
    let outputExists = false;
    vi.mocked(fs.stat).mockImplementation(async (targetPath?: any) => {
      if (typeof targetPath === "string" && targetPath.includes("video-playback-cache") && !outputExists) {
        throw new Error("File not found");
      }
      return { isFile: () => true, size: 1000, mtimeMs: 2000 } as any;
    });
    vi.mocked(fs.mkdir).mockResolvedValue(undefined);
    vi.mocked(fs.rm).mockResolvedValue(undefined);

    let resolveRun: (() => void) | undefined;
    const runPromise = new Promise<void>((resolve) => {
      resolveRun = resolve;
    });

    vi.mocked(runCommand).mockImplementation(async (_command, args) => {
      if (args.includes("-show_entries")) {
        return {
          stdout: Buffer.from(JSON.stringify({ streams: [{ codec_name: "hevc", pix_fmt: "yuv420p" }] }), "utf8"),
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
    const statsArray = [
      { isFile: () => true, size: 1000, mtimeMs: 2000 },
      { isFile: () => true, size: 1000, mtimeMs: 3000 },
    ];
    let outputExists = false;
    vi.mocked(fs.stat).mockImplementation(async (targetPath?: any) => {
      if (typeof targetPath === "string" && targetPath.includes("video.hevc")) {
        return statsArray.shift() as any;
      }
      if (typeof targetPath === "string" && targetPath.includes("video-playback-cache") && !outputExists) {
        throw new Error("File not found");
      }
      return { isFile: () => true, size: 1000, mtimeMs: 2000 } as any;
    });

    vi.mocked(fs.mkdir).mockResolvedValue(undefined);
    vi.mocked(fs.rm).mockResolvedValue(undefined);

    vi.mocked(runCommand).mockImplementation(async (_command, args) => {
      if (args.includes("-show_entries")) {
        return {
          stdout: Buffer.from(JSON.stringify({ streams: [{ codec_name: "hevc", pix_fmt: "yuv420p" }] }), "utf8"),
          stderr: Buffer.alloc(0),
        };
      }
      outputExists = true;
      return { stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) };
    });
    vi.mocked(fs.access).mockImplementation(async () => {
      if (!outputExists) throw new Error("missing");
    });

    await resolvePlayableVideoUri("app://media/%2Ftmp%2Fvideo.hevc");
    outputExists = false;
    await resolvePlayableVideoUri("app://media/%2Ftmp%2Fvideo.hevc");
    const ffmpegCalls = vi.mocked(runCommand).mock.calls.filter(([, args]) => !args.includes("-show_entries"));
    expect(ffmpegCalls).toHaveLength(2);
  });

  it("keeps codec-compatible local videos unchanged", async () => {
    vi.mocked(fs.mkdir).mockResolvedValue(undefined);
    vi.mocked(runCommand).mockImplementation(async (_command, args) => {
      if (args.includes("-show_entries")) {
        return {
          stdout: Buffer.from(JSON.stringify({ streams: [{ codec_name: "h264", pix_fmt: "yuv420p" }] }), "utf8"),
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

  it("transcodes H.264 with 10-bit pixel format (yuv420p10le) as Chromium cannot decode it", async () => {
    let outputExists = false;
    vi.mocked(fs.stat).mockImplementation(async (targetPath?: unknown) => {
      if (typeof targetPath === "string" && targetPath.includes("video-playback-cache") && !outputExists) {
        throw new Error("File not found");
      }
      return { isFile: () => true, size: 1000, mtimeMs: 2000 } as ReturnType<typeof fs.stat> extends Promise<infer T> ? T : never;
    });
    vi.mocked(fs.mkdir).mockResolvedValue(undefined);
    vi.mocked(fs.rm).mockResolvedValue(undefined);
    vi.mocked(runCommand).mockImplementation(async (_command, args) => {
      if (args.includes("-show_entries")) {
        return {
          // yt-dlp 10-bit H.264 — looks like h264 but Chromium can't play it
          stdout: Buffer.from(JSON.stringify({ streams: [{ codec_name: "h264", pix_fmt: "yuv420p10le" }] }), "utf8"),
          stderr: Buffer.alloc(0),
        };
      }
      outputExists = true;
      return { stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) };
    });
    vi.mocked(fs.access).mockImplementation(async () => {
      if (!outputExists) throw new Error("missing");
    });

    const result = await resolvePlayableVideoUri("app://media/%2Ftmp%2Fvideo-10bit.mp4");
    expect(result.transcoded).toBe(true);
    expect(result.cacheHit).toBe(false);
    expect(result.videoUri.startsWith("app://media/")).toBe(true);
    const ffmpegCalls = vi.mocked(runCommand).mock.calls.filter(([, args]) => !args.includes("-show_entries"));
    expect(ffmpegCalls).toHaveLength(1);
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

  it("resolves raw stash urls using the stash proxy", async () => {
    const rawStashUrl = "http://localhost:9999/scene/123/stream";
    const proxiedStashUri = "app://external/stash?sourceId=source-123&purpose=video&target=http%3A%2F%2Flocalhost%3A9999%2Fscene%2F123%2Fstream";

    vi.mocked(resolveMediaUri).mockReturnValue(proxiedStashUri);

    const result = await resolvePlayableVideoUri(rawStashUrl);
    expect(result).toEqual({
      videoUri: proxiedStashUri,
      transcoded: false,
      cacheHit: true,
    });
    expect(resolveMediaUri).toHaveBeenCalledWith(rawStashUrl, "video");
  });

  it("returns already-proxied stash uris with cacheHit: true", async () => {
    const proxiedStashUri = "app://external/stash?sourceId=source-123&purpose=video&target=http%3A%2F%2Flocalhost%3A9999%2Fscene%2F123%2Fstream";
    vi.mocked(isWebsiteVideoResolvableUri).mockReturnValue(true);
    vi.mocked(isStashProxyUri).mockReturnValue(true);

    const result = await resolvePlayableVideoUri(proxiedStashUri);
    expect(result).toEqual({
      videoUri: proxiedStashUri,
      transcoded: false,
      cacheHit: true,
    });
  });

  it("repairs a Stash proxy URI missing sourceId", async () => {
    const { isWebsiteVideoResolvableUri, isStashProxyUri, parseStashProxyUri } = await import("./webVideo");
    vi.mocked(isWebsiteVideoResolvableUri).mockReturnValue(true);
    vi.mocked(isStashProxyUri).mockReturnValue(true);
    vi.mocked(parseStashProxyUri).mockReturnValue({ targetUrl: "http://localhost:9999/scene/123/stream" });

    const partialUri = "app://external/stash?target=http%3A%2F%2Flocalhost%3A9999%2Fscene%2F123%2Fstream";
    const fullUri = "app://external/stash?sourceId=source-123&purpose=video&target=http%3A%2F%2Flocalhost%3A9999%2Fscene%2F123%2Fstream";

    vi.mocked(resolveMediaUri).mockReturnValue(fullUri);

    const result = await resolvePlayableVideoUri(partialUri);

    expect(result).toEqual({
      videoUri: fullUri,
      transcoded: false,
      cacheHit: true,
    });
    expect(resolveMediaUri).toHaveBeenCalledWith("http://localhost:9999/scene/123/stream", "video");
  });
});
