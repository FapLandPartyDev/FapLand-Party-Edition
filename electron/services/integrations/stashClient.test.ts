import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearStashSessionCache,
  executeStashGraphQL,
  fetchStashMediaWithAuth,
  sanitizeStashMediaUri,
  selectBrowserCompatibleStreamUrl,
  toNormalizedPhash,
} from "./stashClient";
import type { ExternalSource } from "./types";

const baseSource: ExternalSource = {
  id: "source-1",
  kind: "stash",
  name: "Test Stash",
  enabled: true,
  baseUrl: "https://stash.example.com",
  authMode: "apiKey",
  apiKey: "secret-key",
  username: null,
  password: null,
  tagSelections: [],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  clearStashSessionCache();
});

describe("stash client helpers", () => {
  it("strips apikey from stash media URIs", () => {
    expect(
      sanitizeStashMediaUri("https://stash.example.com/scene/123/stream?apikey=abc&foo=bar")
    ).toBe("https://stash.example.com/scene/123/stream?foo=bar");
  });

  it("resolves relative media URIs against the source base URL", () => {
    expect(
      sanitizeStashMediaUri("/media/script.funscript?apikey=abc", "https://stash.example.com/api")
    ).toBe("https://stash.example.com/media/script.funscript");
    expect(
      sanitizeStashMediaUri("scene/123/stream?apikey=abc", "https://stash.example.com/api")
    ).toBe("https://stash.example.com/scene/123/stream");
  });

  it("normalizes phash values", () => {
    expect(toNormalizedPhash("  ABCDEF  ")).toBe("abcdef");
    expect(toNormalizedPhash("")).toBeNull();
  });

  it("adds apikey query param for proxied API-key media requests", async () => {
    const upstreamFetch = vi.fn().mockResolvedValue(new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", upstreamFetch);

    const request = new Request("app://external/stash?sourceId=source-1", {
      method: "GET",
      headers: {
        Range: "bytes=0-100",
        Authorization: "Bearer should-not-forward",
      },
    });

    const response = await fetchStashMediaWithAuth(
      baseSource,
      "https://stash.example.com/scene/123/stream",
      request
    );
    expect(response.status).toBe(200);

    expect(upstreamFetch).toHaveBeenCalledTimes(1);
    const [target, init] = upstreamFetch.mock.calls[0] as [string, { headers: Headers }];
    expect(target).toBe("https://stash.example.com/scene/123/stream?apikey=secret-key");
    expect(init.headers.get("ApiKey")).toBe("secret-key");
    expect(init.headers.get("Range")).toBe("bytes=0-100");
    expect(init.headers.get("Authorization")).toBeNull();
  });

  it("rejects unsafe proxy methods", async () => {
    await expect(
      fetchStashMediaWithAuth(
        baseSource,
        "https://stash.example.com/scene/123/stream",
        new Request("app://external/stash?sourceId=source-1", { method: "POST" })
      )
    ).rejects.toThrow("Unsupported proxy method.");
  });

  it("does not reuse login cookies after the source base URL changes", async () => {
    const oldSource: ExternalSource = {
      ...baseSource,
      authMode: "login",
      apiKey: null,
      username: "alice",
      password: "secret",
      baseUrl: "https://stash-old.example.com",
    };
    const newSource: ExternalSource = {
      ...oldSource,
      baseUrl: "https://stash-new.example.com",
    };

    const upstreamFetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response("", {
          status: 200,
          headers: {
            "set-cookie": "session=old-cookie; Path=/; HttpOnly",
          },
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { findTags: { count: 1 } } }), {
          status: 200,
          headers: {
            "content-type": "application/json",
          },
        })
      )
      .mockResolvedValueOnce(
        new Response("", {
          status: 200,
          headers: {
            "set-cookie": "session=new-cookie; Path=/; HttpOnly",
          },
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { findTags: { count: 1 } } }), {
          status: 200,
          headers: {
            "content-type": "application/json",
          },
        })
      );
    vi.stubGlobal("fetch", upstreamFetch);

    await executeStashGraphQL(oldSource, "query Test { findTags { count } }");
    await executeStashGraphQL(newSource, "query Test { findTags { count } }");

    expect(upstreamFetch).toHaveBeenCalledTimes(4);
    expect(upstreamFetch.mock.calls[0]?.[0]).toBe("https://stash-old.example.com/login");
    expect(upstreamFetch.mock.calls[2]?.[0]).toBe("https://stash-new.example.com/login");

    const oldGraphQlHeaders = upstreamFetch.mock.calls[1]?.[1]?.headers as Record<string, string>;
    const newGraphQlHeaders = upstreamFetch.mock.calls[3]?.[1]?.headers as Record<string, string>;
    expect(oldGraphQlHeaders.Cookie).toBe("session=old-cookie");
    expect(newGraphQlHeaders.Cookie).toBe("session=new-cookie");
  });

  it("sends no auth headers for no-auth GraphQL requests", async () => {
    const upstreamFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: { findTags: { count: 1 } } }), {
        status: 200,
        headers: {
          "content-type": "application/json",
        },
      })
    );
    vi.stubGlobal("fetch", upstreamFetch);

    await executeStashGraphQL(
      {
        ...baseSource,
        authMode: "none",
        apiKey: null,
      },
      "query Test { findTags { count } }"
    );

    expect(upstreamFetch).toHaveBeenCalledTimes(1);
    const [, init] = upstreamFetch.mock.calls[0] as [string, { headers: Record<string, string> }];
    expect(init.headers.ApiKey).toBeUndefined();
    expect(init.headers.Cookie).toBeUndefined();
  });

  it("does not add auth material for no-auth media proxy requests", async () => {
    const upstreamFetch = vi.fn().mockResolvedValue(new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", upstreamFetch);

    const request = new Request("app://external/stash?sourceId=source-1", {
      method: "GET",
      headers: {
        Range: "bytes=0-100",
      },
    });

    await fetchStashMediaWithAuth(
      {
        ...baseSource,
        authMode: "none",
        apiKey: null,
      },
      "https://stash.example.com/scene/123/stream",
      request
    );

    const [target, init] = upstreamFetch.mock.calls[0] as [string, { headers: Headers }];
    expect(target).toBe("https://stash.example.com/scene/123/stream");
    expect(init.headers.get("ApiKey")).toBeNull();
    expect(init.headers.get("Cookie")).toBeNull();
    expect(init.headers.get("Range")).toBe("bytes=0-100");
  });

  describe("selectBrowserCompatibleStreamUrl", () => {
    it("selects the first MP4 stream from sceneStreams", () => {
      const streams = [
        {
          url: "https://stash.example.com/api/scene/1/stream",
          mime_type: "video/webm",
          label: "WEBM",
        },
        {
          url: "https://stash.example.com/api/scene/1/stream.mp4",
          mime_type: "video/mp4",
          label: "MP4",
        },
        {
          url: "https://stash.example.com/api/scene/1/stream_hls",
          mime_type: "application/x-mpegURL",
          label: "HLS",
        },
      ];
      expect(selectBrowserCompatibleStreamUrl(streams, "https://fallback.example.com/stream")).toBe(
        "https://stash.example.com/api/scene/1/stream.mp4"
      );
    });

    it("selects a stream with MP4 in mime type regardless of casing", () => {
      const streams = [
        { url: "https://stash.example.com/api/scene/1/mp4", mime_type: "Video/MP4", label: null },
      ];
      expect(selectBrowserCompatibleStreamUrl(streams, "https://fallback.example.com/stream")).toBe(
        "https://stash.example.com/api/scene/1/mp4"
      );
    });

    it("falls back to paths.stream when no MP4 stream is available", () => {
      const streams = [
        {
          url: "https://stash.example.com/api/scene/1/stream",
          mime_type: "video/webm",
          label: "WEBM",
        },
      ];
      expect(
        selectBrowserCompatibleStreamUrl(streams, "https://stash.example.com/api/scene/1/stream")
      ).toBe("https://stash.example.com/api/scene/1/stream");
    });

    it("falls back to paths.stream when sceneStreams is empty", () => {
      expect(
        selectBrowserCompatibleStreamUrl([], "https://stash.example.com/api/scene/1/stream")
      ).toBe("https://stash.example.com/api/scene/1/stream");
    });

    it("falls back to paths.stream when sceneStreams is null", () => {
      expect(
        selectBrowserCompatibleStreamUrl(null, "https://stash.example.com/api/scene/1/stream")
      ).toBe("https://stash.example.com/api/scene/1/stream");
    });

    it("returns null when both sceneStreams and fallback are null", () => {
      expect(selectBrowserCompatibleStreamUrl(null, null)).toBeNull();
    });

    it("returns null when sceneStreams has no MP4 and fallback is null", () => {
      const streams = [
        { url: "https://stash.example.com/stream", mime_type: "video/webm", label: null },
      ];
      expect(selectBrowserCompatibleStreamUrl(streams, null)).toBeNull();
    });

    it("skips streams with null mime_type", () => {
      const streams = [
        {
          url: "https://stash.example.com/api/scene/1/stream",
          mime_type: null,
          label: "Direct stream",
        },
        { url: "https://stash.example.com/api/scene/1/mp4", mime_type: "video/mp4", label: "MP4" },
      ];
      expect(selectBrowserCompatibleStreamUrl(streams, "https://fallback.example.com/stream")).toBe(
        "https://stash.example.com/api/scene/1/mp4"
      );
    });
  });
});
