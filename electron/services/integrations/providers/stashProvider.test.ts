import { describe, expect, it, vi } from "vitest";
import { stashProvider } from "./stashProvider";
import type { ExternalSource, ExternalSyncContext } from "../types";
import { fetchScenesForTag } from "../stashClient";

vi.mock("../stashClient", async () => {
  const actual = await vi.importActual<typeof import("../stashClient")>("../stashClient");
  return {
    ...actual,
    fetchScenesForTag: vi.fn(),
  };
});

const baseSource: ExternalSource = {
  id: "stash-1",
  kind: "stash",
  name: "Stash",
  enabled: true,
  baseUrl: "https://stash.example.com/api",
  authMode: "apiKey",
  apiKey: "key",
  username: null,
  password: null,
  tagSelections: [
    { id: "tag-1", name: "Tag 1", roundTypeFallback: "Normal" },
    { id: "tag-2", name: "Tag 2", roundTypeFallback: "Cum" },
  ],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

describe("stash provider", () => {
  it("matches URLs under the source base and resolves proxy URLs", () => {
    expect(stashProvider.canHandleUri("https://stash.example.com/api/scene/1/stream", baseSource)).toBe(true);
    expect(stashProvider.canHandleUri("https://stash.example.com/other/scene/1/stream", baseSource)).toBe(false);
    expect(stashProvider.canHandleUri("https://example.com/api/scene/1/stream", baseSource)).toBe(false);

    const resolved = stashProvider.resolvePlayableUri("https://stash.example.com/api/scene/1/stream", baseSource, "video");
    expect(resolved.startsWith("app://external/stash?")).toBe(true);
    expect(decodeURIComponent(resolved)).toContain("sourceId=stash-1");
    expect(decodeURIComponent(resolved)).toContain("purpose=video");
  });

  it("dedupes scene IDs across tag selections and skips scenes with missing stream URLs", async () => {
    const mockedFetchScenesForTag = vi.mocked(fetchScenesForTag);
    mockedFetchScenesForTag.mockImplementation(async (_source, selection) => {
      if (selection.id === "tag-1") {
        return [
          {
            id: "scene-1",
            title: "Scene 1",
            details: "Details",
            date: null,
            studio: null,
            performers: [],
            tags: [],
            paths: { stream: "https://stash.example.com/api/scene-1/stream?apikey=abc", funscript: null },
            files: [{ duration: null, fingerprint: "ABC" }],
          },
          {
            id: "scene-missing",
            title: "Scene Missing",
            details: null,
            date: null,
            studio: null,
            performers: [],
            tags: [],
            paths: { stream: null, funscript: null },
            files: [],
          },
        ] as any;
      }

      return [
        {
          id: "scene-1",
          title: "Scene 1 duplicate",
          details: null,
          date: null,
          studio: null,
          performers: [],
          tags: [],
          paths: { stream: "https://stash.example.com/api/scene-1/stream?apikey=abc", funscript: null },
          files: [],
        },
      ] as any;
    });

    const ingestScene = vi.fn<ExternalSyncContext["ingestScene"]>().mockResolvedValue({
      created: 1,
      updated: 0,
      linked: 0,
      resourcesAdded: 1,
      managedRoundId: "round-1",
    });
    const onSceneSeen = vi.fn();

    await stashProvider.syncSource(baseSource, { ingestScene, onSceneSeen });

    expect(mockedFetchScenesForTag).toHaveBeenCalledTimes(2);
    expect(onSceneSeen).toHaveBeenCalledTimes(2);
    expect(ingestScene).toHaveBeenCalledTimes(1);

    const [payload] = ingestScene.mock.calls[0]!;
    expect(payload.sceneId).toBe("scene-1");
    expect(payload.videoUri).toBe("https://stash.example.com/api/scene-1/stream");
    expect(payload.phash).toBe("abc");
  });

  it("uses secondary file title when scene title is missing", async () => {
    const mockedFetchScenesForTag = vi.mocked(fetchScenesForTag);
    mockedFetchScenesForTag.mockResolvedValue([
      {
        id: "scene-file-name",
        title: null,
        details: null,
        date: null,
        studio: null,
        performers: [],
        tags: [],
        paths: {
          stream: "https://stash.example.com/api/scene/123/stream?apikey=abc",
          funscript: null,
        },
        files: [{ duration: null, fingerprint: null, basename: "My%20Great.Video-01.mp4" }],
      },
    ] as any);

    const ingestScene = vi.fn<ExternalSyncContext["ingestScene"]>().mockResolvedValue({
      created: 1,
      updated: 0,
      linked: 0,
      resourcesAdded: 1,
      managedRoundId: "round-file-name",
    });
    const onSceneSeen = vi.fn();

    await stashProvider.syncSource(
      {
        ...baseSource,
        tagSelections: [{ id: "tag-1", name: "Tag 1", roundTypeFallback: "Normal" }],
      },
      { ingestScene, onSceneSeen },
    );

    expect(ingestScene).toHaveBeenCalledTimes(1);
    const [payload] = ingestScene.mock.calls[0]!;
    expect(payload.name).toBe("My Great Video 01");
  });

  it("normalizes relative stream and funscript paths", async () => {
    const mockedFetchScenesForTag = vi.mocked(fetchScenesForTag);
    mockedFetchScenesForTag.mockResolvedValue([
      {
        id: "scene-relative-paths",
        title: "Relative Paths",
        details: null,
        date: null,
        studio: null,
        performers: [],
        tags: [],
        paths: {
          stream: "/api/scene/123/stream?apikey=abc",
          funscript: "api/scene/123/funscript?apikey=abc",
        },
        files: [{ duration: null, fingerprint: null, basename: null }],
      },
    ] as any);

    const ingestScene = vi.fn<ExternalSyncContext["ingestScene"]>().mockResolvedValue({
      created: 1,
      updated: 0,
      linked: 0,
      resourcesAdded: 1,
      managedRoundId: "round-relative-paths",
    });
    const onSceneSeen = vi.fn();

    await stashProvider.syncSource(
      {
        ...baseSource,
        tagSelections: [{ id: "tag-1", name: "Tag 1", roundTypeFallback: "Normal" }],
      },
      { ingestScene, onSceneSeen },
    );

    expect(ingestScene).toHaveBeenCalledTimes(1);
    const [payload] = ingestScene.mock.calls[0]!;
    expect(payload.videoUri).toBe("https://stash.example.com/api/scene/123/stream");
    expect(payload.funscriptUri).toBe("https://stash.example.com/api/scene/123/funscript");
  });
});
