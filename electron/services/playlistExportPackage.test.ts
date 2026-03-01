// @vitest-environment node

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { approveDialogPath, clearApprovedDialogPathsForTests } from "./dialogPathApproval";
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
    phash?: string | null;
    durationMs?: number | null;
  }>;
};

function buildLinearConfig(
  roundRefs: Array<{ idHint?: string; name: string; type?: "Normal" | "Cum" }>
) {
  return {
    playlistVersion: 1,
    boardConfig: {
      mode: "linear" as const,
      totalIndices: 10,
      safePointIndices: [],
      safePointRestMsByIndex: {},
      normalRoundRefsByIndex: {},
      normalRoundOrder: roundRefs
        .filter((entry) => entry.type !== "Cum")
        .map((entry) => ({
          idHint: entry.idHint,
          name: entry.name,
          type: "Normal" as const,
        })),
      cumRoundRefs: roundRefs
        .filter((entry) => entry.type === "Cum")
        .map((entry) => ({
          idHint: entry.idHint,
          name: entry.name,
          type: "Cum" as const,
        })),
    },
    perkSelection: {
      optionsPerPick: 3,
      triggerChancePerCompletedRound: 0.35,
    },
    perkPool: {
      enabledPerkIds: [],
      enabledAntiPerkIds: [],
    },
    probabilityScaling: {
      initialIntermediaryProbability: 0,
      initialAntiPerkProbability: 0,
      intermediaryIncreasePerRound: 0.02,
      antiPerkIncreasePerRound: 0.015,
      maxIntermediaryProbability: 1,
      maxAntiPerkProbability: 0.75,
    },
    economy: {
      startingMoney: 120,
      moneyPerCompletedRound: 50,
      startingScore: 0,
      scorePerCompletedRound: 100,
      scorePerIntermediary: 30,
      scorePerActiveAntiPerk: 25,
      scorePerCumRoundSuccess: 420,
    },
  };
}

function buildPlaylistRow(config: ReturnType<typeof buildLinearConfig>) {
  return {
    id: "playlist-1",
    name: "My: Playlist?",
    description: "Portable export",
    configJson: JSON.stringify(config),
  };
}

function installDbMocks(rounds: TestRound[], config: ReturnType<typeof buildLinearConfig>) {
  getDbMock.mockReturnValue({
    query: {
      playlist: {
        findFirst: vi.fn(async () => buildPlaylistRow(config)),
      },
      round: {
        findMany: vi.fn(async () => rounds),
      },
    },
  });
}

describe("exportPlaylistPackage", () => {
  let rootDir: string;
  let fetchMock: ReturnType<typeof vi.fn>;
  let exportPlaylistPackage: typeof import("./playlistExportPackage").exportPlaylistPackage;
  let analyzePlaylistExportPackage: typeof import("./playlistExportPackage").analyzePlaylistExportPackage;
  let getPlaylistExportPackageStatus: typeof import("./playlistExportPackage").getPlaylistExportPackageStatus;
  let requestPlaylistExportPackageAbort: typeof import("./playlistExportPackage").requestPlaylistExportPackageAbort;

  beforeEach(async () => {
    rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "f-land-playlist-pack-"));
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    getDbMock.mockReset();
    listExternalSourcesMock.mockReset();
    listExternalSourcesMock.mockReturnValue([]);
    fetchStashMediaWithAuthMock.mockReset();
    resolvePhashBinariesMock.mockReset();
    resolvePhashBinariesMock.mockResolvedValue({
      ffmpegPath: "/mock/ffmpeg",
      ffprobePath: "/mock/ffprobe",
      source: "bundled",
      ffmpegVersion: "7.0.2",
      ffprobeVersion: "7.0.2",
    });
    detectAv1EncoderMock.mockReset();
    detectAv1EncoderMock.mockResolvedValue({
      name: "libaom-av1",
      kind: "software",
    });
    probeLocalVideoMock.mockReset();
    probeLocalVideoMock.mockImplementation(async (_ffprobePath: string, sourcePath: string) => {
      const stats = await fs.stat(sourcePath);
      const base = {
        width: 1920,
        height: 1080,
        durationMs: 120_000,
        fileSizeBytes: stats.size,
      };
      if (sourcePath.endsWith(".av1.mp4")) {
        return {
          ...base,
          codecName: "av1",
        };
      }
      return {
        ...base,
        codecName: "h264",
      };
    });
    transcodeVideoToAv1Mock.mockReset();
    transcodeVideoToAv1Mock.mockImplementation(
      async ({ sourcePath, outputPath }: { sourcePath: string; outputPath: string }) => {
        const input = await fs.readFile(sourcePath);
        await fs.writeFile(outputPath, Buffer.concat([Buffer.from("av1:"), input]));
      }
    );
    clearApprovedDialogPathsForTests();
    ({
      exportPlaylistPackage,
      analyzePlaylistExportPackage,
      getPlaylistExportPackageStatus,
      requestPlaylistExportPackageAbort,
    } = await import("./playlistExportPackage"));
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    clearApprovedDialogPathsForTests();
    await fs.rm(rootDir, { recursive: true, force: true });
  });

  it("analyzes AV1 export candidates and reports software fallback warning", async () => {
    const videoPath = path.join(rootDir, "local-video.mp4");
    await fs.writeFile(videoPath, "video-data");

    const rounds: TestRound[] = [
      {
        id: "round-1",
        name: "Round One",
        author: "Tester",
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
    ];
    installDbMocks(rounds, buildLinearConfig([{ idHint: "round-1", name: "Round One" }]));

    const result = await analyzePlaylistExportPackage({
      playlistId: "playlist-1",
      compressionMode: "av1",
      compressionStrength: 80,
    });

    expect(result.videoTotals).toMatchObject({
      uniqueVideos: 1,
      localVideos: 1,
      remoteVideos: 0,
      alreadyAv1Videos: 0,
      estimatedReencodeVideos: 1,
    });
    expect(result.compression).toMatchObject({
      supported: true,
      defaultMode: "av1",
      encoderName: "libaom-av1",
      encoderKind: "software",
      strength: 80,
    });
    expect(result.compression.warning).toContain("multiple hours");
    expect(result.estimate.expectedVideoBytes).toBeGreaterThan(0);
  });

  it("exports a local round package with copied media and relative sidecars", async () => {
    const videoPath = path.join(rootDir, "local-video.mp4");
    const funscriptPath = path.join(rootDir, "local-video.funscript");
    await fs.writeFile(videoPath, "video-data");
    await fs.writeFile(funscriptPath, '{"actions":[{"at":0,"pos":50}]}');

    const rounds: TestRound[] = [
      {
        id: "round-1",
        name: "Round One",
        author: "Tester",
        description: "Standalone",
        bpm: 120,
        difficulty: 2,
        phash: "round-hash",
        startTime: null,
        endTime: null,
        type: "Normal",
        installSourceKey: null,
        heroId: null,
        hero: null,
        resources: [
          {
            videoUri: toLocalMediaUri(videoPath),
            funscriptUri: toLocalMediaUri(funscriptPath),
          },
        ],
      },
    ];
    installDbMocks(rounds, buildLinearConfig([{ idHint: "round-1", name: "Round One" }]));

    approveDialogPath("playlistExportDirectory", rootDir);
    const result = await exportPlaylistPackage({
      playlistId: "playlist-1",
      directoryPath: rootDir,
    });

    expect(result.videoFiles).toBe(1);
    expect(result.funscriptFiles).toBe(1);
    expect(result.sidecarFiles).toBe(1);
    expect(result.referencedRounds).toBe(1);

    const fileNames = await fs.readdir(result.exportDir);
    expect(fileNames.some((entry) => entry.endsWith(".fplay"))).toBe(true);
    expect(fileNames.includes("media")).toBe(false);
    expect(fileNames.includes("README.md")).toBe(true);

    expect(fileNames.some((entry) => entry.endsWith(".round"))).toBe(true);

    const readmeContent = await fs.readFile(path.join(result.exportDir, "README.md"), "utf8");
    expect(readmeContent).toContain("# Welcome to Fap Land Party Edition!");
    expect(readmeContent).toContain(
      "https://github.com/FapLandPartyDev/FapLand-Party-Edition/releases"
    );
    expect(readmeContent).toContain('Click **"Install rounds"**.');
    expect(readmeContent).toContain("## Exported Videos");
    expect(readmeContent).toContain("- Round One");

    const roundFile = fileNames.find((entry) => entry.endsWith(".round"));
    expect(roundFile).toBeTruthy();
    const parsedRound = JSON.parse(
      await fs.readFile(path.join(result.exportDir, roundFile!), "utf8")
    ) as {
      resources: Array<{ videoUri: string; funscriptUri?: string }>;
    };
    expect(parsedRound.resources[0]?.videoUri.startsWith("./")).toBe(true);
    expect(parsedRound.resources[0]?.videoUri.includes("/media/")).toBe(false);
    expect(parsedRound.resources[0]?.funscriptUri?.startsWith("./")).toBe(true);
    expect(parsedRound.resources[0]?.funscriptUri?.includes("/media/")).toBe(false);

    const copiedVideo = path.join(
      result.exportDir,
      parsedRound.resources[0]!.videoUri.replace("./", "")
    );
    const copiedScript = path.join(
      result.exportDir,
      parsedRound.resources[0]!.funscriptUri!.replace("./", "")
    );
    expect(await fs.readFile(copiedVideo, "utf8")).toBe("video-data");
    expect(await fs.readFile(copiedScript, "utf8")).toContain('"actions"');
  });

  it("exports random exclusion only for excluded standalone round sidecars", async () => {
    const rounds: TestRound[] = [
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
    ];
    installDbMocks(
      rounds,
      buildLinearConfig([
        { idHint: "round-1", name: "Excluded Round" },
        { idHint: "round-2", name: "Included Round" },
      ])
    );

    approveDialogPath("playlistExportDirectory", rootDir);
    const result = await exportPlaylistPackage({
      playlistId: "playlist-1",
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

  it("reencodes non-AV1 videos when AV1 export is enabled and includes compression metadata in the README", async () => {
    detectAv1EncoderMock.mockResolvedValue({
      name: "av1_nvenc",
      kind: "hardware",
    });

    const videoPath = path.join(rootDir, "local-video.mp4");
    await fs.writeFile(videoPath, "video-data");

    const rounds: TestRound[] = [
      {
        id: "round-1",
        name: "Round One",
        author: "Tester",
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
    ];
    installDbMocks(rounds, buildLinearConfig([{ idHint: "round-1", name: "Round One" }]));

    approveDialogPath("playlistExportDirectory", rootDir);
    const result = await exportPlaylistPackage({
      playlistId: "playlist-1",
      directoryPath: rootDir,
      compressionMode: "av1",
      compressionStrength: 80,
    });

    expect(transcodeVideoToAv1Mock).toHaveBeenCalledTimes(1);
    expect(transcodeVideoToAv1Mock).toHaveBeenCalledWith(
      expect.objectContaining({
        sourcePath: expect.stringContaining(`${path.sep}.work${path.sep}`),
        strength: 80,
        encoder: {
          name: "av1_nvenc",
          kind: "hardware",
        },
      })
    );
    expect(result.compression).toMatchObject({
      enabled: true,
      encoderName: "av1_nvenc",
      encoderKind: "hardware",
      strength: 80,
      reencodedVideos: 1,
      alreadyAv1Copied: 0,
    });

    const fileNames = await fs.readdir(result.exportDir);
    expect(fileNames.filter((entry) => entry.endsWith(".mp4"))).toHaveLength(1);
    const readmeContent = await fs.readFile(path.join(result.exportDir, "README.md"), "utf8");
    expect(readmeContent).toContain("## Video Compression");
    expect(readmeContent).toContain("Compression strength: 80%");
    expect(readmeContent).toContain("Encoder: av1_nvenc");
  });

  it("tracks live transcode progress and remaining time while AV1 export is running", async () => {
    detectAv1EncoderMock.mockResolvedValue({
      name: "av1_nvenc",
      kind: "hardware",
    });

    const transcodeRelease = Promise.withResolvers<void>();
    const videoPath = path.join(rootDir, "local-video.mp4");
    await fs.writeFile(videoPath, "video-data");

    transcodeVideoToAv1Mock.mockImplementationOnce(
      async ({
        sourcePath,
        outputPath,
        onProgress,
      }: {
        sourcePath: string;
        outputPath: string;
        onProgress?: (progress: { encodedDurationMs: number }) => void;
      }) => {
        onProgress?.({ encodedDurationMs: 30_000 });
        await transcodeRelease.promise;
        const input = await fs.readFile(sourcePath);
        await fs.writeFile(outputPath, Buffer.concat([Buffer.from("av1:"), input]));
      }
    );

    const rounds: TestRound[] = [
      {
        id: "round-1",
        name: "Round One",
        author: "Tester",
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
    ];
    installDbMocks(rounds, buildLinearConfig([{ idHint: "round-1", name: "Round One" }]));

    approveDialogPath("playlistExportDirectory", rootDir);
    const exportPromise = exportPlaylistPackage({
      playlistId: "playlist-1",
      directoryPath: rootDir,
      compressionMode: "av1",
      compressionStrength: 80,
    });

    try {
      await vi.waitFor(() => {
        expect(getPlaylistExportPackageStatus()).toMatchObject({
          state: "running",
          phase: "compressing",
          compression: {
            liveProgress: {
              completedDurationMs: 30_000,
              totalDurationMs: 120_000,
              percent: 0.25,
            },
          },
        });
        expect(
          getPlaylistExportPackageStatus().compression?.liveProgress.etaSecondsRemaining
        ).toBeGreaterThan(0);
      });
    } finally {
      transcodeRelease.resolve();
    }

    await expect(exportPromise).resolves.toMatchObject({
      compression: {
        reencodedVideos: 1,
      },
    });
  });

  it("stages local videos before AV1 encode so the original file can disappear during export", async () => {
    detectAv1EncoderMock.mockResolvedValue({
      name: "av1_nvenc",
      kind: "hardware",
    });

    const videoPath = path.join(rootDir, "local-video.mp4");
    await fs.writeFile(videoPath, "video-data");

    transcodeVideoToAv1Mock.mockImplementationOnce(
      async ({ sourcePath, outputPath }: { sourcePath: string; outputPath: string }) => {
        expect(sourcePath).not.toBe(videoPath);
        expect(sourcePath).toContain(`${path.sep}.work${path.sep}`);
        await fs.rm(videoPath, { force: true });
        const input = await fs.readFile(sourcePath);
        await fs.writeFile(outputPath, Buffer.concat([Buffer.from("av1:"), input]));
      }
    );

    const rounds: TestRound[] = [
      {
        id: "round-1",
        name: "Round One",
        author: "Tester",
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
    ];
    installDbMocks(rounds, buildLinearConfig([{ idHint: "round-1", name: "Round One" }]));

    approveDialogPath("playlistExportDirectory", rootDir);
    const result = await exportPlaylistPackage({
      playlistId: "playlist-1",
      directoryPath: rootDir,
      compressionMode: "av1",
      compressionStrength: 80,
    });

    expect(result.compression.reencodedVideos).toBe(1);
    const fileNames = await fs.readdir(result.exportDir);
    expect(fileNames.filter((entry) => entry.endsWith(".mp4"))).toHaveLength(1);
  });

  it("groups hero-backed rounds sharing one video into a single .hero and deduplicates media", async () => {
    const videoPath = path.join(rootDir, "hero-video.mp4");
    await fs.writeFile(videoPath, "hero-video");

    const sharedHero = {
      id: "hero-1",
      name: "Hero One",
      author: "Curator",
      description: "Shared hero",
      phash: "hero-hash",
    };
    const rounds: TestRound[] = [
      {
        id: "round-1",
        name: "Round A",
        author: "Curator",
        description: null,
        bpm: null,
        difficulty: 3,
        phash: "round-a",
        startTime: 0,
        endTime: 5000,
        type: "Normal",
        installSourceKey: null,
        heroId: "hero-1",
        hero: sharedHero,
        resources: [{ videoUri: toLocalMediaUri(videoPath), funscriptUri: null }],
      },
      {
        id: "round-2",
        name: "Round B",
        author: "Curator",
        description: null,
        bpm: null,
        difficulty: 4,
        phash: "round-b",
        startTime: 5000,
        endTime: 10000,
        type: "Cum",
        installSourceKey: null,
        heroId: "hero-1",
        hero: sharedHero,
        resources: [{ videoUri: toLocalMediaUri(videoPath), funscriptUri: null }],
      },
    ];
    installDbMocks(
      rounds,
      buildLinearConfig([
        { idHint: "round-1", name: "Round A" },
        { idHint: "round-2", name: "Round B", type: "Cum" },
      ])
    );

    approveDialogPath("playlistExportDirectory", rootDir);
    const result = await exportPlaylistPackage({
      playlistId: "playlist-1",
      directoryPath: rootDir,
    });

    const fileNames = await fs.readdir(result.exportDir);
    expect(fileNames.filter((entry) => entry.endsWith(".hero"))).toHaveLength(1);
    expect(fileNames.filter((entry) => entry.endsWith(".round"))).toHaveLength(0);
    expect(fileNames.filter((entry) => entry.endsWith(".mp4"))).toHaveLength(1);

    const heroFile = fileNames.find((entry) => entry.endsWith(".hero"));
    const parsedHero = JSON.parse(
      await fs.readFile(path.join(result.exportDir, heroFile!), "utf8")
    ) as {
      rounds: Array<{ resources: Array<{ videoUri: string }> }>;
    };
    expect(parsedHero.rounds).toHaveLength(2);
    expect(parsedHero.rounds[0]?.resources[0]?.videoUri).toBe("./Hero One.mp4");
    expect(parsedHero.rounds[1]?.resources[0]?.videoUri).toBe("./Hero One.mp4");
  });

  it("exports random exclusion per hero round entry", async () => {
    const sharedHero = {
      id: "hero-1",
      name: "Hero One",
      author: "Curator",
      description: "Shared hero",
      phash: "hero-hash",
    };
    const rounds: TestRound[] = [
      {
        id: "round-1",
        name: "Round A",
        author: "Curator",
        description: null,
        bpm: null,
        difficulty: 3,
        phash: "round-a",
        startTime: 0,
        endTime: 5000,
        type: "Normal",
        excludeFromRandom: true,
        installSourceKey: null,
        heroId: "hero-1",
        hero: sharedHero,
        resources: [{ videoUri: "https://example.com/a.mp4", funscriptUri: null }],
      },
      {
        id: "round-2",
        name: "Round B",
        author: "Curator",
        description: null,
        bpm: null,
        difficulty: 4,
        phash: "round-b",
        startTime: 5000,
        endTime: 10000,
        type: "Cum",
        excludeFromRandom: false,
        installSourceKey: null,
        heroId: "hero-1",
        hero: sharedHero,
        resources: [{ videoUri: "https://example.com/b.mp4", funscriptUri: null }],
      },
    ];
    installDbMocks(
      rounds,
      buildLinearConfig([
        { idHint: "round-1", name: "Round A" },
        { idHint: "round-2", name: "Round B", type: "Cum" },
      ])
    );

    approveDialogPath("playlistExportDirectory", rootDir);
    const result = await exportPlaylistPackage({
      playlistId: "playlist-1",
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

  it("keeps separate .round sidecars when non-hero rounds share a video", async () => {
    const videoPath = path.join(rootDir, "shared-video.mp4");
    await fs.writeFile(videoPath, "shared-video");

    const rounds: TestRound[] = [
      {
        id: "round-1",
        name: "Round A",
        author: null,
        description: null,
        bpm: null,
        difficulty: null,
        phash: "round-a",
        startTime: null,
        endTime: null,
        type: "Normal",
        installSourceKey: null,
        heroId: null,
        hero: null,
        resources: [{ videoUri: toLocalMediaUri(videoPath), funscriptUri: null }],
      },
      {
        id: "round-2",
        name: "Round B",
        author: null,
        description: null,
        bpm: null,
        difficulty: null,
        phash: "round-b",
        startTime: null,
        endTime: null,
        type: "Normal",
        installSourceKey: null,
        heroId: null,
        hero: null,
        resources: [{ videoUri: toLocalMediaUri(videoPath), funscriptUri: null }],
      },
    ];
    installDbMocks(
      rounds,
      buildLinearConfig([
        { idHint: "round-1", name: "Round A" },
        { idHint: "round-2", name: "Round B" },
      ])
    );

    approveDialogPath("playlistExportDirectory", rootDir);
    const result = await exportPlaylistPackage({
      playlistId: "playlist-1",
      directoryPath: rootDir,
    });

    const fileNamesAfter = await fs.readdir(result.exportDir);
    expect(fileNamesAfter.filter((entry) => entry.endsWith(".round"))).toHaveLength(2);
    expect(fileNamesAfter.filter((entry) => entry.endsWith(".mp4"))).toHaveLength(1);
  });

  it("downloads stash-backed resources with authenticated fetch", async () => {
    const rounds: TestRound[] = [
      {
        id: "round-1",
        name: "Stash Round",
        author: null,
        description: null,
        bpm: null,
        difficulty: null,
        phash: "stash-round",
        startTime: null,
        endTime: null,
        type: "Normal",
        installSourceKey: "stash:https://stash.example.com:scene:123",
        heroId: null,
        hero: null,
        resources: [
          {
            videoUri: "https://stash.example.com/scene/123/stream",
            funscriptUri: null,
          },
        ],
      },
    ];
    installDbMocks(rounds, buildLinearConfig([{ idHint: "round-1", name: "Stash Round" }]));
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
    fetchStashMediaWithAuthMock.mockResolvedValue(new Response("stash-video", { status: 200 }));

    approveDialogPath("playlistExportDirectory", rootDir);
    const result = await exportPlaylistPackage({
      playlistId: "playlist-1",
      directoryPath: rootDir,
    });

    expect(fetchStashMediaWithAuthMock).toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    const fileNamesAfter = await fs.readdir(result.exportDir);
    expect(fileNamesAfter.some((entry) => entry.endsWith(".round"))).toBe(true);
  });

  it("downloads generic remote resources with plain fetch", async () => {
    const rounds: TestRound[] = [
      {
        id: "round-1",
        name: "Remote Round",
        author: null,
        description: null,
        bpm: null,
        difficulty: null,
        phash: "remote-round",
        startTime: null,
        endTime: null,
        type: "Normal",
        installSourceKey: null,
        heroId: null,
        hero: null,
        resources: [
          {
            videoUri: "https://cdn.example.com/remote.mp4",
            funscriptUri: null,
          },
        ],
      },
    ];
    installDbMocks(rounds, buildLinearConfig([{ idHint: "round-1", name: "Remote Round" }]));
    fetchMock.mockResolvedValue(new Response("remote-video", { status: 200 }));

    approveDialogPath("playlistExportDirectory", rootDir);
    const result = await exportPlaylistPackage({
      playlistId: "playlist-1",
      directoryPath: rootDir,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://cdn.example.com/remote.mp4",
      expect.objectContaining({
        signal: expect.any(AbortSignal),
      })
    );
    const fileNamesAfter = await fs.readdir(result.exportDir);
    expect(fileNamesAfter.some((entry) => entry.endsWith(".round"))).toBe(true);
  });

  it("reports progress and allows aborting an in-flight export", async () => {
    const fetchStarted = Promise.withResolvers<void>();
    const rounds: TestRound[] = [
      {
        id: "round-1",
        name: "Remote Round",
        author: null,
        description: null,
        bpm: null,
        difficulty: null,
        phash: "remote-round",
        startTime: null,
        endTime: null,
        type: "Normal",
        installSourceKey: null,
        heroId: null,
        hero: null,
        resources: [
          {
            videoUri: "https://cdn.example.com/remote.mp4",
            funscriptUri: null,
          },
        ],
      },
    ];
    installDbMocks(rounds, buildLinearConfig([{ idHint: "round-1", name: "Remote Round" }]));
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (init?.method === "HEAD") {
        return Promise.resolve(
          new Response(null, { status: 200, headers: { "content-length": "10" } })
        );
      }
      if (init?.headers instanceof Headers && init.headers.get("Range") === "bytes=0-0") {
        return Promise.resolve(
          new Response("", { status: 206, headers: { "content-range": "bytes 0-0/10" } })
        );
      }
      return new Promise<Response>((_resolve, reject) => {
        fetchStarted.resolve();
        const signal = init?.signal;
        if (signal?.aborted) {
          reject(new DOMException("Aborted", "AbortError"));
          return;
        }
        signal?.addEventListener(
          "abort",
          () => {
            reject(new DOMException("Aborted", "AbortError"));
          },
          { once: true }
        );
      });
    });

    approveDialogPath("playlistExportDirectory", rootDir);
    const exportPromise = exportPlaylistPackage({
      playlistId: "playlist-1",
      directoryPath: rootDir,
    });

    await fetchStarted.promise;
    await vi.waitFor(() => {
      expect(getPlaylistExportPackageStatus()).toMatchObject({
        state: "running",
        progress: {
          total: 3,
        },
        stats: {
          videoFiles: 0,
        },
      });
    });

    const statusAfterAbortRequest = requestPlaylistExportPackageAbort();
    expect(statusAfterAbortRequest.state).toBe("running");
    expect(statusAfterAbortRequest.lastMessage).toContain("Abort requested");

    await expect(exportPromise).rejects.toThrow("Export aborted by user.");
    expect(getPlaylistExportPackageStatus()).toMatchObject({
      state: "aborted",
      lastMessage: "Export aborted by user.",
    });
  });

  it("rejects unapproved export directories", async () => {
    installDbMocks([], buildLinearConfig([]));

    await expect(
      exportPlaylistPackage({
        playlistId: "playlist-1",
        directoryPath: rootDir,
      })
    ).rejects.toThrow("Path must be selected through the system dialog.");
  });

  it("fails when the target folder already exists", async () => {
    const rounds: TestRound[] = [
      {
        id: "round-1",
        name: "Round One",
        author: null,
        description: null,
        bpm: null,
        difficulty: null,
        phash: "round-one",
        startTime: null,
        endTime: null,
        type: "Normal",
        installSourceKey: null,
        heroId: null,
        hero: null,
        resources: [
          {
            videoUri: "https://cdn.example.com/round-one.mp4",
            funscriptUri: null,
          },
        ],
      },
    ];
    installDbMocks(rounds, buildLinearConfig([{ idHint: "round-1", name: "Round One" }]));
    fetchMock.mockResolvedValue(new Response("video", { status: 200 }));

    const { sanitizeFileSystemName } = await import("./playlistExportPackage");
    const existingDir = path.join(rootDir, sanitizeFileSystemName("My: Playlist?", "playlist"));
    await fs.mkdir(existingDir, { recursive: true });
    approveDialogPath("playlistExportDirectory", rootDir);

    await expect(
      exportPlaylistPackage({
        playlistId: "playlist-1",
        directoryPath: rootDir,
      })
    ).rejects.toThrow(`Export target already exists: ${existingDir}`);
  });

  it("fails when the playlist contains unresolved round refs", async () => {
    installDbMocks([], buildLinearConfig([{ idHint: "missing-round", name: "Missing Round" }]));
    approveDialogPath("playlistExportDirectory", rootDir);

    await expect(
      exportPlaylistPackage({
        playlistId: "playlist-1",
        directoryPath: rootDir,
      })
    ).rejects.toThrow("Playlist export failed because some round refs are unresolved");
  });
});

describe("sanitizeFileSystemName", () => {
  it("removes Windows-invalid characters and reserved device names", async () => {
    const { sanitizeFileSystemName } = await import("./playlistExportPackage");
    expect(sanitizeFileSystemName('CON<>:"/\\\\|?* .', "playlist")).toBe("CON_");
    expect(sanitizeFileSystemName("  valid name  ", "playlist")).toBe("valid name");
  });
});
