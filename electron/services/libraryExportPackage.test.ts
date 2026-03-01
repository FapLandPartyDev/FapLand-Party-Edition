// @vitest-environment node

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toLocalMediaUri } from "./localMedia";

const {
  getDbMock,
  listExternalSourcesMock,
  fetchStashMediaWithAuthMock,
  normalizeBaseUrlMock,
  resolvePhashBinariesMock,
  detectAv1EncoderMock,
  probeLocalVideoMock,
  transcodeVideoToAv1Mock,
} = vi.hoisted(() => ({
  getDbMock: vi.fn(),
  listExternalSourcesMock: vi.fn(() => []),
  fetchStashMediaWithAuthMock: vi.fn(),
  normalizeBaseUrlMock: vi.fn((input: string) => input.replace(/\/+$/, "")),
  resolvePhashBinariesMock: vi.fn(),
  detectAv1EncoderMock: vi.fn(),
  probeLocalVideoMock: vi.fn(),
  transcodeVideoToAv1Mock: vi.fn(),
}));

vi.mock("./db", () => ({
  getDb: getDbMock,
}));

vi.mock("./integrations/store", () => ({
  listExternalSources: listExternalSourcesMock,
  normalizeBaseUrl: normalizeBaseUrlMock,
}));

vi.mock("./integrations/stashClient", () => ({
  fetchStashMediaWithAuth: fetchStashMediaWithAuthMock,
}));

vi.mock("./phash/binaries", () => ({
  resolvePhashBinaries: resolvePhashBinariesMock,
}));

vi.mock("./playlistExportCompression", async () => {
  const actual = await vi.importActual<typeof import("./playlistExportCompression")>(
    "./playlistExportCompression"
  );
  return {
    ...actual,
    detectAv1Encoder: detectAv1EncoderMock,
    probeLocalVideo: probeLocalVideoMock,
    transcodeVideoToAv1: transcodeVideoToAv1Mock,
  };
});

type TestRound = {
  id: string;
  name: string;
  author: string | null;
  description: string | null;
  bpm: number | null;
  difficulty: number | null;
  phash: string | null;
  startTime: number | null;
  endTime: number | null;
  type: "Normal" | "Interjection" | "Cum";
  excludeFromRandom?: boolean;
  installSourceKey: string | null;
  heroId: string | null;
  hero: {
    id: string;
    name: string;
    author: string | null;
    description: string | null;
    phash: string | null;
  } | null;
  resources: Array<{
    videoUri: string;
    funscriptUri: string | null;
    funscriptOffsetMs?: number | null;
    durationMs?: number | null;
  }>;
  acquisitionCandidates?: Array<{
    sourceId: string;
    sourcePath: string;
    source: {
      id: string;
      kind: "torrent" | "mega";
      name: string;
      canonicalLocatorHash: string;
      locatorJson: string;
      enabled: boolean;
      origin: "user" | "imported";
      lastCatalogedAt: Date | null;
      catalogError: string | null;
      createdAt: Date;
      updatedAt: Date;
    };
  }>;
};

function installDbMocks(rounds: TestRound[]) {
  getDbMock.mockReturnValue({
    query: {
      round: {
        findMany: vi.fn(async () => rounds),
      },
    },
  });
}

describe("libraryExportPackage", () => {
  let rootDir: string;
  let analyzeLibraryExportPackage: typeof import("./libraryExportPackage").analyzeLibraryExportPackage;
  let exportLibraryPackage: typeof import("./libraryExportPackage").exportLibraryPackage;
  let getLibraryExportPackageStatus: typeof import("./libraryExportPackage").getLibraryExportPackageStatus;
  let requestLibraryExportPackageAbort: typeof import("./libraryExportPackage").requestLibraryExportPackageAbort;

  beforeEach(async () => {
    rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "f-land-library-pack-"));
    vi.resetModules();
    vi.clearAllMocks();
    vi.stubGlobal("fetch", vi.fn());
    resolvePhashBinariesMock.mockResolvedValue({
      ffmpegPath: "/mock/ffmpeg",
      ffprobePath: "/mock/ffprobe",
      source: "bundled",
      ffmpegVersion: "7.0.2",
      ffprobeVersion: "7.0.2",
    });
    detectAv1EncoderMock.mockResolvedValue(null);
    probeLocalVideoMock.mockResolvedValue({
      codecName: "h264",
      width: 1920,
      height: 1080,
      durationMs: 120_000,
      fileSizeBytes: 120 * 1024 * 1024,
    });
    transcodeVideoToAv1Mock.mockResolvedValue(undefined);

    ({
      analyzeLibraryExportPackage,
      exportLibraryPackage,
      getLibraryExportPackageStatus,
      requestLibraryExportPackageAbort,
    } = await import("./libraryExportPackage"));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns zeroed analysis when media packaging is disabled", async () => {
    installDbMocks([
      {
        id: "round-1",
        name: "Round One",
        author: null,
        description: null,
        bpm: null,
        difficulty: null,
        phash: null,
        startTime: null,
        endTime: null,
        type: "Normal",
        installSourceKey: null,
        heroId: null,
        hero: null,
        resources: [
          {
            videoUri: "https://example.com/demo.mp4",
            funscriptUri: null,
          },
        ],
      },
    ]);

    const result = await analyzeLibraryExportPackage({
      includeMedia: false,
    });

    expect(result.videoTotals).toMatchObject({
      uniqueVideos: 0,
      localVideos: 0,
      remoteVideos: 0,
      alreadyAv1Videos: 0,
      estimatedReencodeVideos: 0,
    });
    expect(result.estimate).toMatchObject({
      sourceVideoBytes: 0,
      expectedVideoBytes: 0,
      estimatedCompressionSeconds: 0,
    });
  });

  it("defaults library export analysis to AV1 when an encoder is available", async () => {
    detectAv1EncoderMock.mockResolvedValue({
      name: "libsvtav1",
      kind: "software",
    });
    const videoPath = path.join(rootDir, "demo.mp4");
    await fs.writeFile(videoPath, "video-data");
    installDbMocks([
      {
        id: "round-1",
        name: "Round One",
        author: null,
        description: null,
        bpm: null,
        difficulty: null,
        phash: null,
        startTime: null,
        endTime: null,
        type: "Normal",
        installSourceKey: null,
        heroId: null,
        hero: null,
        resources: [
          {
            videoUri: toLocalMediaUri(videoPath),
            funscriptUri: null,
            durationMs: 120_000,
          },
        ],
      },
    ]);

    const result = await analyzeLibraryExportPackage({
      includeMedia: true,
    });

    expect(result.compression).toMatchObject({
      supported: true,
      defaultMode: "av1",
      encoderName: "libsvtav1",
      encoderKind: "software",
    });
    expect(result.videoTotals.estimatedReencodeVideos).toBe(1);
    expect(result.estimate.expectedVideoBytes).toBeGreaterThan(0);
  });

  it("exports random exclusion only for excluded standalone round sidecars", async () => {
    installDbMocks([
      {
        id: "round-1",
        name: "Excluded Round",
        author: null,
        description: null,
        bpm: null,
        difficulty: null,
        phash: null,
        startTime: null,
        endTime: null,
        type: "Normal",
        excludeFromRandom: true,
        installSourceKey: null,
        heroId: null,
        hero: null,
        resources: [
          {
            videoUri: "https://example.com/excluded.mp4",
            funscriptUri: null,
            funscriptOffsetMs: 125,
          },
        ],
      },
      {
        id: "round-2",
        name: "Included Round",
        author: null,
        description: null,
        bpm: null,
        difficulty: null,
        phash: null,
        startTime: null,
        endTime: null,
        type: "Normal",
        excludeFromRandom: false,
        installSourceKey: null,
        heroId: null,
        hero: null,
        resources: [{ videoUri: "https://example.com/included.mp4", funscriptUri: null }],
      },
    ]);

    const result = await exportLibraryPackage({
      directoryPath: rootDir,
      includeMedia: false,
    });

    const excluded = JSON.parse(
      await fs.readFile(path.join(result.exportDir, "Excluded Round.round"), "utf8")
    ) as {
      excludeFromRandom?: boolean;
      resources: Array<{ funscriptOffsetMs?: number }>;
    };
    const included = JSON.parse(
      await fs.readFile(path.join(result.exportDir, "Included Round.round"), "utf8")
    ) as { excludeFromRandom?: boolean };

    expect(excluded.excludeFromRandom).toBe(true);
    expect(excluded.resources[0]?.funscriptOffsetMs).toBe(125);
    expect(included.excludeFromRandom).toBeUndefined();
  });

  it("exports random exclusion per hero round entry", async () => {
    const hero = {
      id: "hero-1",
      name: "Hero One",
      author: null,
      description: null,
      phash: null,
    };
    installDbMocks([
      {
        id: "round-1",
        name: "Round A",
        author: null,
        description: null,
        bpm: null,
        difficulty: null,
        phash: null,
        startTime: null,
        endTime: null,
        type: "Normal",
        excludeFromRandom: true,
        installSourceKey: null,
        heroId: "hero-1",
        hero,
        resources: [{ videoUri: "https://example.com/a.mp4", funscriptUri: null }],
      },
      {
        id: "round-2",
        name: "Round B",
        author: null,
        description: null,
        bpm: null,
        difficulty: null,
        phash: null,
        startTime: null,
        endTime: null,
        type: "Normal",
        excludeFromRandom: false,
        installSourceKey: null,
        heroId: "hero-1",
        hero,
        resources: [{ videoUri: "https://example.com/b.mp4", funscriptUri: null }],
      },
    ]);

    const result = await exportLibraryPackage({
      directoryPath: rootDir,
      includeMedia: false,
    });

    const parsedHero = JSON.parse(
      await fs.readFile(path.join(result.exportDir, "Hero One.hero"), "utf8")
    ) as {
      excludeFromRandom?: boolean;
      rounds: Array<{ name: string; excludeFromRandom?: boolean }>;
    };

    expect(parsedHero.excludeFromRandom).toBeUndefined();
    expect(parsedHero.rounds.find((round) => round.name === "Round A")?.excludeFromRandom).toBe(
      true
    );
    expect(
      parsedHero.rounds.find((round) => round.name === "Round B")?.excludeFromRandom
    ).toBeUndefined();
  });

  it("replaces an original video link when acquisition provenance is exported", async () => {
    const now = new Date("2026-08-10T00:00:00.000Z");
    installDbMocks([
      {
        id: "round-1",
        name: "Linked Round",
        author: null,
        description: null,
        bpm: null,
        difficulty: null,
        phash: null,
        startTime: null,
        endTime: null,
        type: "Normal",
        installSourceKey: null,
        heroId: null,
        hero: null,
        resources: [{ videoUri: "https://example.com/original.mp4", funscriptUri: null }],
        acquisitionCandidates: [
          {
            sourceId: "source-1",
            sourcePath: "collection/Linked Round.mp4",
            source: {
              id: "source-1",
              kind: "torrent",
              name: "Public collection",
              canonicalLocatorHash: "hash",
              locatorJson: JSON.stringify({
                magnetUri: "magnet:?xt=urn:btih:0123456789012345678901234567890123456789",
                infoHash: "0123456789012345678901234567890123456789",
                displayName: "Public collection",
              }),
              enabled: true,
              origin: "user",
              lastCatalogedAt: now,
              catalogError: null,
              createdAt: now,
              updatedAt: now,
            },
          },
        ],
      },
    ]);

    const result = await exportLibraryPackage({
      directoryPath: rootDir,
      includeMedia: false,
      includeAcquisitionSources: true,
      replaceOriginalLinksWithAcquisition: true,
    });
    const parsed = JSON.parse(
      await fs.readFile(path.join(result.exportDir, "Linked Round.round"), "utf8")
    ) as { resources: unknown[]; acquisition?: { candidates: unknown[] } };

    expect(parsed.resources).toEqual([]);
    expect(parsed.acquisition?.candidates).toHaveLength(1);
  });

  it("copies Stash proxy media when media is included", async () => {
    const targetUrl = "https://stash.example.com/scene/123/stream";
    const proxyUri = `app://external/stash?sourceId=stash-1&purpose=video&target=${encodeURIComponent(targetUrl)}`;
    installDbMocks([
      {
        id: "round-1",
        name: "Stash Proxy Round",
        author: null,
        description: null,
        bpm: null,
        difficulty: null,
        phash: null,
        startTime: null,
        endTime: null,
        type: "Normal",
        installSourceKey: "stash:https://stash.example.com:scene:123",
        heroId: null,
        hero: null,
        resources: [{ videoUri: proxyUri, funscriptUri: null }],
      },
    ]);
    listExternalSourcesMock.mockReturnValue([
      {
        id: "stash-1",
        kind: "stash",
        name: "Main Stash",
        enabled: true,
        baseUrl: "https://stash.example.com",
        authMode: "none",
        apiKey: null,
        username: null,
        password: null,
        tagSelections: [],
        createdAt: "2026-03-18T00:00:00.000Z",
        updatedAt: "2026-03-18T00:00:00.000Z",
      },
    ]);
    fetchStashMediaWithAuthMock.mockImplementation(
      async () => new Response("stash-video", { status: 200 })
    );

    const result = await exportLibraryPackage({
      directoryPath: rootDir,
      includeMedia: true,
      compressionMode: "copy",
    });

    expect(fetchStashMediaWithAuthMock).toHaveBeenCalled();
    expect(fetchStashMediaWithAuthMock.mock.calls.some((call) => call[1] === targetUrl)).toBe(true);
    const fileNamesAfter = await fs.readdir(result.exportDir);
    expect(fileNamesAfter.filter((entry) => entry.endsWith(".mp4"))).toHaveLength(1);

    const parsedRound = JSON.parse(
      await fs.readFile(path.join(result.exportDir, "Stash Proxy Round.round"), "utf8")
    ) as { resources: Array<{ videoUri: string }> };
    expect(parsedRound.resources[0]?.videoUri).toBe("./Stash Proxy Round.mp4");
  });

  it("aborts an in-flight export and reports aborted status", async () => {
    const fetchMock = vi.fn((_: string, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          const error = new Error("Aborted");
          error.name = "AbortError";
          reject(error);
        });
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    installDbMocks([
      {
        id: "round-1",
        name: "Round One",
        author: null,
        description: null,
        bpm: null,
        difficulty: null,
        phash: null,
        startTime: null,
        endTime: null,
        type: "Normal",
        installSourceKey: null,
        heroId: null,
        hero: null,
        resources: [
          {
            videoUri: "https://example.com/demo.mp4",
            funscriptUri: null,
            durationMs: 120_000,
          },
        ],
      },
    ]);

    const exportPromise = exportLibraryPackage({
      directoryPath: rootDir,
      includeMedia: true,
      compressionMode: "copy",
    });

    await vi.waitFor(() => {
      expect(getLibraryExportPackageStatus().state).toBe("running");
    });

    const abortStatus = requestLibraryExportPackageAbort();
    expect(abortStatus.lastMessage).toContain("Abort requested");

    await expect(exportPromise).rejects.toThrow("Export aborted by user.");
    expect(getLibraryExportPackageStatus()).toMatchObject({
      state: "aborted",
      phase: "aborted",
    });
  });
});
