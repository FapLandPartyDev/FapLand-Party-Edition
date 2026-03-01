// @vitest-environment node
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createServer } from "node:net";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { McpRuntime } from "./runtime";

const state = vi.hoisted(() => ({
  profile: "",
  settings: new Map<string, unknown>(),
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  send: vi.fn(),
}));
vi.mock("electron", () => ({
  app: {
    isPackaged: false,
    getPath: () => state.profile,
    getAppPath: () => state.profile,
    getVersion: () => "1.0.0",
    getName: () => "MCP test",
    on: vi.fn(),
  },
  shell: { openPath: vi.fn(), openExternal: vi.fn() },
  BrowserWindow: { getAllWindows: () => [] },
  session: {
    defaultSession: {
      cookies: { get: vi.fn(async () => [{ name: "_forum_session", value: "test-session" }]) },
    },
  },
  utilityProcess: {},
  ipcMain: {
    handle: (name: string, handler: (...args: unknown[]) => unknown) =>
      state.handlers.set(name, handler),
    on: vi.fn(),
  },
}));
vi.mock("../services/store", () => ({
  getStore: () => ({
    get: (key: string) => state.settings.get(key),
    set: (key: string, value: unknown) => state.settings.set(key, value),
    get store() {
      return Object.fromEntries(state.settings);
    },
  }),
  safeStoreGet: (key: string, fallback?: unknown) => state.settings.get(key) ?? fallback,
  safeStoreGetMany: (keys: string[]) =>
    Object.fromEntries(keys.map((key) => [key, state.settings.get(key)])),
  safeStoreSet: (key: string, value: unknown) => {
    state.settings.set(key, value);
    return true;
  },
  initStore: vi.fn(async () => {}),
  resolveSettingsStorePath: () => path.join(state.profile, "config.json"),
}));
// Media extraction is independent of the control server and requires FFmpeg.
// Keep the actual installer, converter, routers, database and playlist services.
vi.mock("../services/roundPreview", () => ({
  generateRoundPreviewImageDataUri: vi.fn(async () => null),
}));
vi.mock("../services/phash", () => ({ generateVideoPhash: vi.fn(async () => null) }));
vi.mock("../services/videoDuration", async (original) => ({
  ...(await original<typeof import("../services/videoDuration")>()),
  resolveVideoDurationMsForUri: vi.fn(async () => 10000),
}));

let runtime: McpRuntime;
let client: Client;
let database: Awaited<typeof import("../services/db")>;
let previousDatabaseUrl: string | undefined;
beforeAll(async () => {
  state.profile = fs.mkdtempSync(path.join(os.tmpdir(), "fland-mcp-app-"));
  fs.cpSync(path.resolve("drizzle"), path.join(state.profile, "drizzle"), { recursive: true });
  previousDatabaseUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = `file:${path.join(state.profile, "library.db").replaceAll("\\", "/")}`;
  database = await import("../services/db");
  await database.ensureAppDatabaseReady();
  const { installMcp } = await import("./integration");
  const fakeWindow = {
    isDestroyed: () => false,
    webContents: { isDestroyed: () => false, send: state.send },
  };
  runtime = installMcp(() => fakeWindow as never);
  const socket = createServer();
  await new Promise<void>((resolve) => socket.listen(0, "127.0.0.1", resolve));
  const port = (socket.address() as { port: number }).port;
  await new Promise<void>((resolve) => socket.close(() => resolve()));
  const status = await runtime.configure({ enabled: true, port });
  expect(status.error).toBeNull();
  client = new Client({ name: "full-app-test", version: "1" });
  await client.connect(new StreamableHTTPClientTransport(new URL(status.url)));
}, 30000);
afterAll(async () => {
  await client?.close();
  await runtime?.stop();
  database?.getDb().$client.close();
  if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = previousDatabaseUrl;
  if (state.profile)
    await fs.promises.rm(state.profile, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 100,
    });
}, 30000);
async function call(name: string, args: Record<string, unknown> = {}) {
  const result = await client.callTool({ name, arguments: args });
  const text = (result.content as Array<{ text: string }>)[0].text;
  if (result.isError) throw new Error(text);
  return JSON.parse(text);
}

it("exposes every real backend action and retrieves full schemas through tools", async () => {
  const { appRouter } = await import("../trpc/router");
  const { tools } = await client.listTools();
  for (const name of Object.keys(appRouter._def.procedures)) {
    expect(
      tools.some((tool) => tool.name === `fland_${name.replaceAll(".", "_")}`),
      name
    ).toBe(true);
  }
  const schema = await call("fland_read_resource", { uri: "fland://schemas/playlist" });
  expect(schema.properties.boardConfig).toBeDefined();
  expect(tools.length).toBeGreaterThan(200);
});
it("installs, renames, trims and deletes a round through MCP against an isolated real database", async () => {
  const filePath = path.join(state.profile, "Example.mp4");
  fs.writeFileSync(filePath, "test media placeholder");
  await call("fland_db_importLegacyVideoFileAsRound", { filePath });
  const installed = await database.getDb().query.round.findMany();
  expect(installed).toHaveLength(1);
  const id = installed[0].id;
  await call("fland_round_edit", {
    id,
    name: "Renamed",
    startTime: 1000,
    endTime: 5000,
    tags: ["test"],
  });
  await call("fland_round_edit", { id, name: "Renamed again" });
  const updated = (await database.getDb().query.round.findMany())[0];
  expect(updated).toMatchObject({
    name: "Renamed again",
    startTime: 1000,
    endTime: 5000,
    tagsJson: '["test"]',
  });
  await call("fland_db_deleteRound", { id });
  expect(await database.getDb().query.round.findMany()).toHaveLength(0);
});
it("downloads with the integrated EroScripts session and replaces media durably without losing round settings", async () => {
  const script = JSON.stringify({
    actions: [
      { at: 0, pos: 50 },
      { at: 1000, pos: 100 },
    ],
  });
  const requests: RequestInit[] = [];
  const realFetch = globalThis.fetch;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url, options: RequestInit) => {
      if (!_url.toString().startsWith("https://discuss.eroscripts.com/"))
        return realFetch(_url, options);
      requests.push(options);
      return new Response(script);
    })
  );
  try {
    const job = await call("fland_eroscripts_startDownload", {
      kind: "funscript",
      topicId: 123,
      postId: 456,
      url: "https://discuss.eroscripts.com/uploads/integration.funscript",
      filename: "integration.funscript",
    });
    let completed: Awaited<ReturnType<typeof call>>;
    await vi.waitFor(async () => {
      completed = await call("fland_eroscripts_getDownload", { jobId: job.id });
      expect(completed.status).toBe("completed");
    });
    expect(requests[0].headers).toMatchObject({ Cookie: "_forum_session=test-session" });
    const downloaded = completed!.result;
    expect(fs.readFileSync(downloaded.filePath, "utf8")).toBe(script);
    vi.unstubAllGlobals();
    const sourceVideo = path.join(state.profile, "replace-original.mp4");
    fs.writeFileSync(sourceVideo, "original video");
    await call("fland_db_importLegacyVideoFileAsRound", { filePath: sourceVideo });
    const installed = (await database.getDb().query.round.findMany())[0];
    await call("fland_round_edit", {
      id: installed.id,
      name: "Keep this name",
      tags: ["preserved"],
      startTime: 1000,
      endTime: 5000,
      funscriptOffsetMs: 123,
      invertFunscript: true,
    });
    const attached = await call("fland_db_replaceRoundMedia", {
      roundId: installed.id,
      funscriptUri: downloaded.funscriptUri,
    });
    expect(attached.resource).toMatchObject({ funscriptOffsetMs: 123, invertFunscript: true });
    await call("fland_eroscripts_clearCache");
    const { fromLocalMediaUri } = await import("../services/localMedia");
    expect(fs.readFileSync(fromLocalMediaUri(attached.resource.funscriptUri)!, "utf8")).toBe(
      script
    );
    const replacementVideo = path.join(state.profile, "replacement.mp4");
    fs.writeFileSync(replacementVideo, "replacement video");
    const replaced = await call("fland_db_replaceRoundMedia", {
      roundId: installed.id,
      videoUri: replacementVideo,
    });
    expect(replaced.resource.funscriptUri).toBe(attached.resource.funscriptUri);
    expect(replaced.resource.videoUri).not.toBe(replaced.previous.videoUri);
    expect(fs.readFileSync(fromLocalMediaUri(replaced.resource.videoUri)!, "utf8")).toBe(
      "replacement video"
    );
    expect(fs.readFileSync(sourceVideo, "utf8")).toBe("original video");
    const after = (await database.getDb().query.round.findMany())[0];
    expect(after).toMatchObject({
      id: installed.id,
      name: "Keep this name",
      tagsJson: '["preserved"]',
      startTime: 1000,
      endTime: 5000,
    });
    const invalidScript = path.join(state.profile, "invalid.funscript");
    fs.writeFileSync(invalidScript, "not a script");
    await expect(
      call("fland_db_replaceRoundMedia", {
        roundId: installed.id,
        videoUri: replacementVideo,
        funscriptUri: invalidScript,
      })
    ).rejects.toThrow();
    expect((await database.getDb().query.resource.findMany())[0]).toMatchObject({
      videoUri: replaced.resource.videoUri,
      funscriptUri: attached.resource.funscriptUri,
    });
    await expect(
      call("fland_db_replaceRoundMedia", {
        roundId: installed.id,
        resourceId: "another-round-resource",
        funscriptUri: null,
      })
    ).rejects.toThrow("no matching resource");
    const { resolveVideoDurationMsForUri } = await import("../services/videoDuration");
    vi.mocked(resolveVideoDurationMsForUri).mockResolvedValueOnce(2000);
    await expect(
      call("fland_db_replaceRoundMedia", { roundId: installed.id, videoUri: replacementVideo })
    ).rejects.toThrow("shorter");
    expect((await database.getDb().query.resource.findMany())[0].videoUri).toBe(
      replaced.resource.videoUri
    );
    const reset = await call("fland_db_replaceRoundMedia", {
      roundId: installed.id,
      videoUri: replacementVideo,
      resetTrim: true,
    });
    expect(reset).toMatchObject({ startTime: null, endTime: null });
    const detached = await call("fland_db_replaceRoundMedia", {
      roundId: installed.id,
      funscriptUri: null,
    });
    expect(detached.resource.funscriptUri).toBeNull();
    expect(detached.resource.invertFunscript).toBe(true);
    await call("fland_db_deleteRound", { id: installed.id });
  } finally {
    vi.unstubAllGlobals();
  }
}, 15000);

it("creates, reorders, exports/imports and deletes playlists without path authorization", async () => {
  const playlist = await call("fland_playlist_create", { name: "MCP playlist" });
  await call("fland_playlist_update", {
    playlistId: playlist.id,
    config: {
      ...playlist.config,
      boardConfig: {
        ...playlist.config.boardConfig,
        normalRoundOrder: [{ name: "A" }, { name: "B" }],
      },
    },
  });
  await call("fland_playlist_reorder", { playlistId: playlist.id, order: [1, 0] });
  const reordered = await call("fland_playlist_getById", { playlistId: playlist.id });
  expect(
    reordered.config.boardConfig.normalRoundOrder.map((ref: { name: string }) => ref.name)
  ).toEqual(["B", "A"]);
  const filePath = path.join(state.profile, "playlist.fplay");
  await call("fland_playlist_exportToFile", { playlistId: playlist.id, filePath });
  expect(fs.existsSync(filePath)).toBe(true);
  const imported = await call("fland_playlist_importFromFile", { filePath });
  expect(imported).toBeDefined();
  await call("fland_playlist_delete", { playlistId: playlist.id });
});
it("persists settings and notifies the running renderer", async () => {
  await call("fland_store_set", { key: "audio.sfxVolume", value: 0.2 });
  expect(await call("fland_store_get", { key: "audio.sfxVolume" })).toBe(0.2);
  expect(state.send).toHaveBeenCalledWith("mcp:changed", {
    procedure: "store.set",
    setting: { key: "audio.sfxVolume", value: 0.2 },
  });
  const settings = await call("fland_settings_catalog", { prefix: "audio." });
  expect(settings).toEqual(
    expect.arrayContaining([expect.objectContaining({ key: "audio.sfxVolume", value: 0.2 })])
  );
});

it("creates and persists a playable advanced branching map", async () => {
  const map = await call("fland_map_create", {
    name: "Advanced map",
    board: {
      mode: "graph",
      startNodeId: "start",
      nodes: [
        { id: "start", name: "Start", kind: "start" },
        { id: "rest", name: "Rest", kind: "safePoint" },
        { id: "end", name: "End", kind: "end" },
      ],
      edges: [
        { id: "a", fromNodeId: "start", toNodeId: "rest" },
        { id: "b", fromNodeId: "rest", toNodeId: "end" },
        { id: "shortcut", fromNodeId: "start", toNodeId: "end" },
      ],
    },
  });
  const saved = await call("fland_playlist_getById", { playlistId: map.id });
  expect(saved.config.boardConfig.mode).toBe("graph");
  expect(saved.config.boardConfig.edges).toHaveLength(3);
  await call("fland_playlist_delete", { playlistId: map.id });
});

it("reads funscripts and proposes detected cuts through the real MCP router without saving", async () => {
  const filePath = path.join(state.profile, "inspect.funscript");
  const actions = [0, 500, 1000, 1500, 6000, 6500, 7000, 7500].map((at, index) => ({
    at,
    pos: index % 2 ? 100 : 0,
  }));
  await fs.promises.writeFile(filePath, JSON.stringify({ version: "1.0", actions }));
  const before = await database.getDb().query.round.findMany();
  const inspection = await call("fland_converter_inspectFunscript", {
    funscriptUri: filePath,
    includePlot: false,
    limit: 3,
  });
  expect(inspection.actions).toEqual(actions.slice(0, 3));
  expect(inspection.nextOffset).toBe(3);
  const result = await call("fland_converter_autoDetect", {
    funscriptUri: filePath,
    durationMs: 10000,
    minRoundMs: 500,
  });
  expect(result.saved).toBe(false);
  expect(result.status).toBe("success");
  expect(result.segments.length).toBeGreaterThan(0);
  expect(await database.getDb().query.round.findMany()).toHaveLength(before.length);
});

it("cuts a video into named rounds and persists internal cut ranges", async () => {
  const filePath = path.join(state.profile, "cuts.mp4");
  fs.writeFileSync(filePath, "test media placeholder");
  const result = await call("fland_converter_saveSegments", {
    hero: { name: "Cut collection" },
    source: { videoUri: pathToFileURL(filePath).href },
    segments: [
      {
        startTimeMs: 0,
        endTimeMs: 1000,
        type: "Normal",
        customName: "First",
        cutRanges: [{ startTimeMs: 100, endTimeMs: 200 }],
      },
      { startTimeMs: 1000, endTimeMs: 2000, type: "Normal", customName: "Second" },
    ],
  });
  expect(result.stats.created).toBe(2);
  const rounds = await database.getDb().query.round.findMany();
  expect(rounds.map((round) => round.name)).toEqual(expect.arrayContaining(["First", "Second"]));
  expect(JSON.parse(rounds.find((round) => round.name === "First")!.cutRangesJson!)).toEqual([
    { startTimeMs: 100, endTimeMs: 200 },
  ]);
});
