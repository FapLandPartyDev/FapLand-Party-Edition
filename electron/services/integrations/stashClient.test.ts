import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearStashSessionCache,
  executeStashGraphQL,
  fetchStashMediaWithAuth,
  sanitizeStashMediaUri,
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
    expect(sanitizeStashMediaUri("https://stash.example.com/scene/123/stream?apikey=abc&foo=bar")).toBe(
      "https://stash.example.com/scene/123/stream?foo=bar",
    );
  });

  it("resolves relative media URIs against the source base URL", () => {
    expect(sanitizeStashMediaUri("/media/script.funscript?apikey=abc", "https://stash.example.com/api")).toBe(
      "https://stash.example.com/media/script.funscript",
    );
    expect(sanitizeStashMediaUri("scene/123/stream?apikey=abc", "https://stash.example.com/api")).toBe(
      "https://stash.example.com/scene/123/stream",
    );
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

    const response = await fetchStashMediaWithAuth(baseSource, "https://stash.example.com/scene/123/stream", request);
    expect(response.status).toBe(200);

    expect(upstreamFetch).toHaveBeenCalledTimes(1);
    const [target, init] = upstreamFetch.mock.calls[0] as [string, { headers: Headers }];
    expect(target).toBe("https://stash.example.com/scene/123/stream?apikey=secret-key");
    expect(init.headers.get("ApiKey")).toBe("secret-key");
    expect(init.headers.get("Range")).toBe("bytes=0-100");
    expect(init.headers.get("Authorization")).toBeNull();
  });

  it("rejects unsafe proxy methods", async () => {
    await expect(fetchStashMediaWithAuth(
      baseSource,
      "https://stash.example.com/scene/123/stream",
      new Request("app://external/stash?sourceId=source-1", { method: "POST" }),
    )).rejects.toThrow("Unsupported proxy method.");
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
      .mockResolvedValueOnce(new Response("", {
        status: 200,
        headers: {
          "set-cookie": "session=old-cookie; Path=/; HttpOnly",
        },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { findTags: { count: 1 } } }), {
        status: 200,
        headers: {
          "content-type": "application/json",
        },
      }))
      .mockResolvedValueOnce(new Response("", {
        status: 200,
        headers: {
          "set-cookie": "session=new-cookie; Path=/; HttpOnly",
        },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { findTags: { count: 1 } } }), {
        status: 200,
        headers: {
          "content-type": "application/json",
        },
      }));
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
});
