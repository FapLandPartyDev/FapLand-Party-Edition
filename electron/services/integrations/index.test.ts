// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  listExternalSourcesMock,
  getExternalSourceByIdMock,
  fetchStashMediaWithAuthMock,
  stashCanHandleUriMock,
  stashResolvePlayableUriMock,
  createMediaResponseMock,
  resolvePlayableVideoUriMock,
  toLocalVideoPathMock,
  getCachedWebsiteVideoLocalPathMock,
  ensureWebsiteVideoCachedMock,
  createWebsiteVideoStreamResponseMock,
  resolveWebsiteVideoStreamMock,
  warmWebsiteVideoCacheMock,
} = vi.hoisted(() => ({
  listExternalSourcesMock: vi.fn(),
  getExternalSourceByIdMock: vi.fn(),
  fetchStashMediaWithAuthMock: vi.fn(),
  stashCanHandleUriMock: vi.fn(),
  stashResolvePlayableUriMock: vi.fn(),
  createMediaResponseMock: vi.fn(),
  resolvePlayableVideoUriMock: vi.fn(),
  toLocalVideoPathMock: vi.fn(),
  getCachedWebsiteVideoLocalPathMock: vi.fn(),
  ensureWebsiteVideoCachedMock: vi.fn(),
  createWebsiteVideoStreamResponseMock: vi.fn(),
  resolveWebsiteVideoStreamMock: vi.fn(),
  warmWebsiteVideoCacheMock: vi.fn(),
}));

vi.mock("../db", () => ({
  getDb: vi.fn(),
}));

vi.mock("../localMedia", () => ({
  toLocalMediaUri: vi.fn((filePath: string) => `app://media/${encodeURIComponent(filePath)}`),
}));

vi.mock("../roundPreview", () => ({
  generateRoundPreviewImageDataUri: vi.fn(async () => null),
}));

vi.mock("../protocol/mediaResponse", () => ({
  createMediaResponse: createMediaResponseMock,
}));

vi.mock("../playableVideo", () => ({
  resolvePlayableVideoUri: resolvePlayableVideoUriMock,
  toLocalVideoPath: toLocalVideoPathMock,
}));

vi.mock("../webVideo", () => ({
  buildWebsiteVideoProxyUri: vi.fn(
    (target: string) => `app://external/web-url?target=${encodeURIComponent(target)}`
  ),
  createWebsiteVideoStreamResponse: createWebsiteVideoStreamResponseMock,
  ensureWebsiteVideoCached: ensureWebsiteVideoCachedMock,
  getCachedWebsiteVideoLocalPath: getCachedWebsiteVideoLocalPathMock,
  isDirectRemoteMediaUri: vi.fn((uri: string) => uri.includes(".mp4")),
  isWebsiteVideoCandidateUri: vi.fn(
    (uri: string) => uri.includes("pornhub.com") || uri.includes("xvideos.com")
  ),
  resolveWebsiteVideoStream: resolveWebsiteVideoStreamMock,
  warmWebsiteVideoCache: warmWebsiteVideoCacheMock,
}));

vi.mock("./stashClient", () => ({
  fetchStashMediaWithAuth: fetchStashMediaWithAuthMock,
  searchStashTags: vi.fn(),
  testStashConnection: vi.fn(async () => ({ ok: true })),
  toNormalizedPhash: vi.fn(() => null),
}));

vi.mock("./providers/stashProvider", () => ({
  stashProvider: {
    kind: "stash",
    canHandleUri: stashCanHandleUriMock,
    resolvePlayableUri: stashResolvePlayableUriMock,
    syncSource: vi.fn(),
  },
}));

vi.mock("./store", () => ({
  createEmptyIntegrationSyncStatus: vi.fn(() => ({
    state: "idle",
    triggeredBy: "manual",
    startedAt: null,
    finishedAt: null,
    stats: {
      sourcesSeen: 0,
      sourcesSynced: 0,
      scenesSeen: 0,
      roundsCreated: 0,
      roundsUpdated: 0,
      roundsLinked: 0,
      resourcesAdded: 0,
      disabledRounds: 0,
      failed: 0,
    },
    lastMessage: null,
    lastErrors: [],
  })),
  createStashSource: vi.fn(),
  deleteExternalSource: vi.fn(),
  getDisabledRoundIds: vi.fn(() => []),
  getExternalSourceById: getExternalSourceByIdMock,
  getIntegrationSyncStatus: vi.fn(),
  listExternalSources: listExternalSourcesMock,
  normalizeBaseUrl: vi.fn((input: string) => input),
  setDisabledRoundIds: vi.fn(),
  setExternalSourceEnabled: vi.fn(),
  setIntegrationSyncStatus: vi.fn(),
  sourcePrefixForManagedRounds: vi.fn(),
  toStashInstallSourceKey: vi.fn(),
  updateStashSource: vi.fn(),
}));

import { proxyExternalRequest, resolveMediaUri } from "./index";

describe("integrations index", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("stream", { status: 200 }))
    );
    createMediaResponseMock.mockResolvedValue(new Response("local", { status: 200 }));
    resolvePlayableVideoUriMock.mockResolvedValue({
      videoUri: "app://media/%2Ftmp%2Fcached.mp4",
      transcoded: false,
      cacheHit: true,
    });
    toLocalVideoPathMock.mockReturnValue("/tmp/cached.mp4");
    warmWebsiteVideoCacheMock.mockReturnValue(
      Promise.resolve({
        originalUrl: "https://www.pornhub.com/view_video.php?viewkey=1",
        extractor: "PornHub",
        title: "Scene",
        durationMs: 1_000,
        finalFilePath: "/tmp/cached.mp4",
        fileExtension: "mp4",
        ytDlpVersion: "2025.12.08",
        createdAt: "2026-01-01T00:00:00.000Z",
        lastAccessedAt: "2026-01-01T00:00:00.000Z",
      })
    );
    resolveWebsiteVideoStreamMock.mockResolvedValue({
      streamUrl: "https://media.example.com/stream.mp4",
      headers: { Referer: "https://www.pornhub.com/" },
      extractor: "PornHub",
      title: "Scene",
      durationMs: 1_000,
      contentType: "video/mp4",
      playbackStrategy: "remote",
    });
    createWebsiteVideoStreamResponseMock.mockResolvedValue(
      new Response("yt-dlp-stream", { status: 200 })
    );
  });

  it("routes website video pages through the internal proxy uri", () => {
    listExternalSourcesMock.mockReturnValue([]);
    expect(resolveMediaUri("https://www.pornhub.com/view_video.php?viewkey=1", "video")).toBe(
      "app://external/web-url?target=https%3A%2F%2Fwww.pornhub.com%2Fview_video.php%3Fviewkey%3D1"
    );
  });

  it("keeps direct remote media urls unchanged", () => {
    listExternalSourcesMock.mockReturnValue([]);
    expect(resolveMediaUri("https://cdn.example.com/video.mp4", "video")).toBe(
      "https://cdn.example.com/video.mp4"
    );
  });

  it("still delegates stash urls to the stash provider", () => {
    listExternalSourcesMock.mockReturnValue([
      {
        id: "stash-1",
        kind: "stash",
        name: "Stash",
        enabled: true,
        baseUrl: "https://stash.example.com",
        authMode: "none",
        apiKey: null,
        username: null,
        password: null,
        tagSelections: [],
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ]);
    stashCanHandleUriMock.mockReturnValue(true);
    stashResolvePlayableUriMock.mockReturnValue("app://external/stash?target=1");

    expect(resolveMediaUri("https://stash.example.com/api/scene/1/stream", "video")).toBe(
      "app://external/stash?target=1"
    );
  });

  it("rejects unsupported proxy methods", async () => {
    const response = await proxyExternalRequest(
      new Request("app://external/web-url?target=https%3A%2F%2Fexample.com", {
        method: "POST",
      })
    );
    expect(response.status).toBe(405);
  });

  it("serves a cached website video through the local media path", async () => {
    getCachedWebsiteVideoLocalPathMock.mockResolvedValue("/tmp/cached.mp4");

    const response = await proxyExternalRequest(
      new Request(
        "app://external/web-url?target=https%3A%2F%2Fwww.pornhub.com%2Fview_video.php%3Fviewkey%3D1"
      )
    );

    expect(response.status).toBe(200);
    expect(resolvePlayableVideoUriMock).toHaveBeenCalled();
    expect(createMediaResponseMock).toHaveBeenCalledWith("/tmp/cached.mp4", expect.any(Request));
  });

  it("uses the live web stream while background caching is still in progress", async () => {
    getCachedWebsiteVideoLocalPathMock.mockResolvedValue(null);

    const response = await proxyExternalRequest(
      new Request(
        "app://external/web-url?target=https%3A%2F%2Fwww.pornhub.com%2Fview_video.php%3Fviewkey%3D1",
        { headers: { Range: "bytes=0-10" } }
      )
    );

    expect(response.status).toBe(200);
    expect(warmWebsiteVideoCacheMock).toHaveBeenCalled();
    expect(resolveWebsiteVideoStreamMock).toHaveBeenCalled();
    expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      "https://media.example.com/stream.mp4",
      expect.objectContaining({
        method: "GET",
        headers: expect.any(Headers),
      })
    );
  });

  it("proxies direct browser-playable streams even when the url has no video extension", async () => {
    getCachedWebsiteVideoLocalPathMock.mockResolvedValue(null);
    resolveWebsiteVideoStreamMock.mockResolvedValue({
      streamUrl: "https://media.example.com/play?token=abc",
      headers: { Referer: "https://www.pornhub.com/" },
      extractor: "PornHub",
      title: "Scene",
      durationMs: 1_000,
      contentType: "video/mp4",
      playbackStrategy: "remote",
    });

    const response = await proxyExternalRequest(
      new Request(
        "app://external/web-url?target=https%3A%2F%2Fwww.pornhub.com%2Fview_video.php%3Fviewkey%3D1",
        { headers: { Range: "bytes=0-10" } }
      )
    );

    expect(response.status).toBe(200);
    expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      "https://media.example.com/play?token=abc",
      expect.objectContaining({
        method: "GET",
        headers: expect.any(Headers),
      })
    );
    expect(createWebsiteVideoStreamResponseMock).not.toHaveBeenCalled();
  });
});
