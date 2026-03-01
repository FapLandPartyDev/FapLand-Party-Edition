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
    durationMs?: number | null;
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
        resources: [{ videoUri: "https://example.com/excluded.mp4", funscriptUri: null }],
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
    ) as { excludeFromRandom?: boolean };
    const included = JSON.parse(
      await fs.readFile(path.join(result.exportDir, "Included Round.round"), "utf8")
    ) as { excludeFromRandom?: boolean };

    expect(excluded.excludeFromRandom).toBe(true);
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
