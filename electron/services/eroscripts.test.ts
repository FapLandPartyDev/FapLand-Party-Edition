// @vitest-environment node

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let userDataPath = "";
const storeValues = new Map<string, unknown>();
const eroscriptsCookies: Array<{
  name: string;
  value: string;
  domain: string;
  path: string;
  secure: boolean;
  expirationDate?: number;
}> = [];

vi.mock("electron", () => ({
  app: {
    getPath: vi.fn(() => userDataPath),
  },
  BrowserWindow: vi.fn(() => ({
    focus: vi.fn(),
    isDestroyed: vi.fn(() => false),
    loadURL: vi.fn(async () => undefined),
    on: vi.fn(),
    setMenuBarVisibility: vi.fn(),
  })),
  session: {
    defaultSession: {
      cookies: {
        get: vi.fn(async () => eroscriptsCookies),
        remove: vi.fn(async () => undefined),
      },
    },
  },
}));

vi.mock("./store", () => ({
  getStore: () => ({
    get: (key: string) => storeValues.get(key),
    set: (key: string, value: unknown) => storeValues.set(key, value),
  }),
}));

vi.mock("./integrations/store", () => ({
  listExternalSources: vi.fn(() => []),
  normalizeBaseUrl: (value: string) => value,
}));

vi.mock("./portable", () => ({
  normalizeUserDataSuffix: (raw: string | undefined) => raw ?? null,
  resolvePortableAwareStoragePath: vi.fn(() => null),
}));

vi.mock("./webVideo/binaries", () => ({
  resolveYtDlpBinary: vi.fn(async () => ({
    ytDlpPath: "/mock/yt-dlp",
    source: "bundled",
    version: "2026.03.17",
  })),
}));

vi.mock("./phash/extract", () => ({
  runCommand: vi.fn(),
}));

import { runCommand } from "./phash/extract";
import {
  __resetEroScriptsForTests,
  downloadEroScriptsFunscript,
  downloadEroScriptsVideo,
  getEroScriptsLoginStatus,
  listEroScriptsTopicMedia,
  resolveEroScriptsCacheRoot,
  searchEroScripts,
} from "./eroscripts";

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

describe("eroscripts service", () => {
  beforeEach(async () => {
    userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), "f-land-eroscripts-"));
    storeValues.clear();
    eroscriptsCookies.length = 0;
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    __resetEroScriptsForTests();
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await fs.rm(userDataPath, { recursive: true, force: true });
  });

  it("maps Discourse search results", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({
          topics: [{ id: 123, title: "Example Topic", slug: "example-topic" }],
          posts: [
            {
              id: 456,
              topic_id: 123,
              username: "creator",
              blurb: "<em>Example</em> result",
              created_at: "2026-04-01T00:00:00.000Z",
            },
          ],
        })
      )
    );

    const results = await searchEroScripts({ query: "example", limit: 5 });

    expect(results).toEqual([
      {
        topicId: 123,
        postId: 456,
        title: "Example Topic",
        url: "https://discuss.eroscripts.com/t/example-topic/123",
        author: "creator",
        createdAt: "2026-04-01T00:00:00.000Z",
        excerpt: "Example result",
      },
    ]);
    expect(vi.mocked(fetch).mock.calls[0]?.[0]?.toString()).toContain("%23scripts%3Afree-scripts");
  });

  it("supports default newest searches and tag filters", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ topics: [], posts: [] }))
    );

    await searchEroScripts({ tags: ["VR", "#POV"], limit: 5 });
    await searchEroScripts({ limit: 5 });

    const taggedUrl = new URL(vi.mocked(fetch).mock.calls[0]?.[0]?.toString() ?? "");
    const defaultUrl = new URL(vi.mocked(fetch).mock.calls[1]?.[0]?.toString() ?? "");
    expect(taggedUrl.searchParams.get("q")).toBe(
      "#scripts:free-scripts tags:vr tags:pov order:latest"
    );
    expect(defaultUrl.searchParams.get("q")).toBe("#scripts:free-scripts order:latest");
  });

  it("uses Electron session cookies for logged-in requests", async () => {
    eroscriptsCookies.push({
      name: "_forum_session",
      value: "session-cookie",
      domain: "discuss.eroscripts.com",
      path: "/",
      secure: true,
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url, init) => {
        expect((init?.headers as Record<string, string>).Cookie).toBe(
          "_forum_session=session-cookie"
        );
        if (url.toString().includes("/session/current.json")) {
          return jsonResponse({ current_user: { username: "creator" } });
        }
        return jsonResponse({
          topics: [{ id: 123, title: "Example Topic", slug: "example-topic" }],
          posts: [{ id: 456, topic_id: 123, username: "creator" }],
        });
      })
    );

    const status = await getEroScriptsLoginStatus();
    const results = await searchEroScripts({ query: "example" });

    expect(status).toMatchObject({
      loggedIn: true,
      username: "creator",
      cookieCount: 1,
      error: null,
    });
    expect(results[0]?.topicId).toBe(123);
  });

  it("returns a timeout error when the EroScripts login check aborts", async () => {
    eroscriptsCookies.push({
      name: "_forum_session",
      value: "session-cookie",
      domain: "discuss.eroscripts.com",
      path: "/",
      secure: true,
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        const error = new Error("The operation was aborted due to timeout");
        error.name = "TimeoutError";
        throw error;
      })
    );

    const status = await getEroScriptsLoginStatus();

    expect(status).toMatchObject({
      loggedIn: false,
      username: null,
      cookieCount: 1,
      error: "EroScripts login check timed out.",
    });
  });

  it("extracts only supported funscripts and trusted downloader video links", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({
          post_stream: {
            posts: [
              {
                id: 10,
                topic_id: 99,
                uploads: [
                  {
                    url: "/uploads/short-url/example.funscript",
                    original_filename: "example.funscript",
                  },
                  {
                    url: "/uploads/short-url/archive.zip",
                    original_filename: "archive.zip",
                  },
                ],
                cooked:
                  '<a href="https://www.pornhub.com/view_video.php?viewkey=abc">Video</a><a href="https://unsupported.example.org/video.mp4">Blocked</a>',
                link_counts: [],
              },
            ],
          },
        })
      )
    );

    const media = await listEroScriptsTopicMedia(99);

    expect(media.funscripts).toHaveLength(1);
    expect(media.funscripts[0]?.supported).toBe(true);
    expect(media.videos).toEqual([
      {
        kind: "video",
        topicId: 99,
        postId: 10,
        label: "Video",
        url: "https://www.pornhub.com/view_video.php?viewkey=abc",
        supported: true,
        unsupportedReason: null,
      },
    ]);
  });

  it("downloads and reuses cached funscripts", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ actions: [{ at: 0, pos: 50 }] })))
    );

    const first = await downloadEroScriptsFunscript({
      topicId: 1,
      postId: 2,
      url: "https://discuss.eroscripts.com/uploads/example.funscript",
      filename: "example.funscript",
    });
    const second = await downloadEroScriptsFunscript({
      topicId: 1,
      postId: 2,
      url: "https://discuss.eroscripts.com/uploads/example.funscript",
      filename: "example.funscript",
    });

    expect(first.cached).toBe(false);
    expect(second.cached).toBe(true);
    expect(second.filePath).toBe(first.filePath);
    expect(second.funscriptUri).toMatch(/^app:\/\/media\//u);
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
  });

  it("downloads videos into the EroScripts cache", async () => {
    vi.mocked(runCommand).mockImplementation(async (_command, args) => {
      if (args.includes("--dump-single-json")) {
        return {
          stdout: Buffer.from(JSON.stringify({ title: "Remote Video" }), "utf8"),
          stderr: Buffer.alloc(0),
        };
      }

      const outputIndex = args.indexOf("--output");
      const outputTemplate = String(args[outputIndex + 1]);
      await fs.mkdir(path.dirname(outputTemplate), { recursive: true });
      await fs.writeFile(outputTemplate.replace("%(ext)s", "mp4"), "video", "utf8");
      return { stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) };
    });

    const result = await downloadEroScriptsVideo({
      topicId: 1,
      postId: 2,
      url: "https://www.pornhub.com/view_video.php?viewkey=abc",
    });

    expect(result.cached).toBe(false);
    expect(result.title).toBe("Remote Video");
    expect(result.videoUri).toMatch(/^app:\/\/media\//u);
    expect(result.filePath.startsWith(resolveEroScriptsCacheRoot())).toBe(true);
  });
});
