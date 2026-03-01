// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
  inspectVideoFrames,
  inspectFunscript,
  autoDetectRounds,
  ZInspectFrames,
  ZInspectFunscript,
  ZAutoDetect,
} from "../services/converterInspection";
import { createControlServer } from "./protocol";
import { formatConverterResult } from "./converterResults";
import { router } from "../trpc/trpc";
import { buildDetectedSegments } from "../../src/features/converter/detection";
import { runCommand } from "../services/phash/extract";

const state = vi.hoisted(() => ({ ffmpeg: "", ffprobe: "", bitmap: Buffer.alloc(0) as Buffer }));
vi.mock("electron", () => ({
  app: { isPackaged: false, getPath: () => "", getAppPath: () => process.cwd() },
  nativeImage: {
    createFromBitmap: (buffer: Buffer) => {
      state.bitmap = buffer;
      return { toPNG: () => Buffer.from("plot-png") };
    },
  },
}));
vi.mock("../services/phash/binaries", () => ({
  resolvePhashBinaries: async () => ({ ffmpegPath: state.ffmpeg, ffprobePath: state.ffprobe }),
}));
vi.mock("../services/ffmpegEnv", () => ({ getFfmpegGpuEnv: () => undefined }));
vi.mock("../services/debugLogging", () => ({ debugLog: { debug: vi.fn(), error: vi.fn() } }));
vi.mock("../services/store", () => ({
  getStore: () => ({ get: () => undefined }),
  safeStoreGet: () => undefined,
}));
vi.mock("../services/webVideo", () => ({
  getCachedWebsiteVideoLocalPath: async () => null,
  isStashProxyUri: () => false,
}));
vi.mock("../services/integrations", () => ({ proxyExternalRequest: vi.fn() }));

let directory: string, video: string, script: string;
const actions = [0, 500, 1000, 1500, 6000, 6500, 7000, 7500].map((at, i) => ({
  at,
  pos: i % 2 ? 100 : 0,
}));
beforeAll(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), "fland-inspection-"));
  video = path.join(directory, "synthetic frames.mp4");
  script = path.join(directory, "timeline.funscript");
  state.ffmpeg = path.resolve("build/vendor/ffmpeg/win32-x64/ffmpeg.exe");
  state.ffprobe = path.resolve("build/vendor/ffmpeg/win32-x64/ffprobe.exe");
  if (process.platform !== "win32") {
    state.ffmpeg = "ffmpeg";
    state.ffprobe = "ffprobe";
  }
  if (process.platform === "win32") {
    try {
      await fs.access(state.ffmpeg);
      await fs.access(state.ffprobe);
    } catch {
      state.ffmpeg = "ffmpeg";
      state.ffprobe = "ffprobe";
    }
  }
  await runCommand(
    state.ffmpeg,
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-f",
      "lavfi",
      "-i",
      "testsrc2=size=320x180:rate=10:duration=2",
      "-c:v",
      "mpeg4",
      "-y",
      video,
    ],
    { timeoutMs: 10000 }
  );
  await fs.writeFile(
    script,
    JSON.stringify({
      version: "1.0",
      title: "Synthetic script",
      range: 100,
      inverted: false,
      actions,
    })
  );
}, 20000);
afterAll(async () => {
  if (directory) await fs.rm(directory, { recursive: true, force: true, maxRetries: 5 });
});

describe("converter inspection with real FFmpeg", () => {
  it("decodes images from an agent-selected range and returns video metadata", async () => {
    const result = await inspectVideoFrames({
      videoUri: video,
      startTimeMs: 0,
      endTimeMs: 2000,
      frameCount: 4,
      width: 160,
    });
    expect(result.durationMs).toBe(2000);
    expect(result.sourceWidth).toBe(320);
    expect(result.videoUri).toMatch(/^app:\/\/media\//);
    expect(result.frames.map((frame) => frame.timestampMs)).toEqual([250, 750, 1250, 1750]);
    for (const frame of result.frames)
      expect(Buffer.from(frame.data, "base64").subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));
  });
  it("accepts exact timestamps and file URIs, preserving the requested order", async () => {
    const result = await inspectVideoFrames({
      videoUri: pathToFileURL(video).href,
      timestampsMs: [1500, 100, 800],
    });
    expect(result.frames.map((frame) => frame.timestampMs)).toEqual([1500, 100, 800]);
    expect(result.frames[0].data).not.toBe(result.frames[1].data);
  });
  it("decodes selections near EOF using the final frame interval", async () => {
    const result = await inspectVideoFrames({ videoUri: video, timestampsMs: [1999] });
    expect(result.frames[0]).toMatchObject({ timestampMs: 1999, seekTimeMs: 1900 });
    expect(result.frames[0].data.length).toBeGreaterThan(0);
  });
  it("rejects invalid/out-of-bounds ranges and refuses uncached remote sources", async () => {
    expect(() =>
      ZInspectFrames.parse({ videoUri: video, startTimeMs: 200, endTimeMs: 100 })
    ).toThrow();
    expect(() =>
      ZInspectFrames.parse({ videoUri: video, timestampsMs: [0], endTimeMs: 100 })
    ).toThrow();
    expect(() =>
      ZInspectFrames.parse({ videoUri: video, endTimeMs: 100, frameCount: 100 })
    ).toThrow();
    await expect(inspectVideoFrames({ videoUri: video, endTimeMs: 3000 })).rejects.toThrow(
      "exceeds video duration"
    );
    await expect(inspectVideoFrames({ videoUri: video, timestampsMs: [2000] })).rejects.toThrow(
      "less than video duration"
    );
    await expect(
      inspectVideoFrames({ videoUri: "https://example.invalid/video", endTimeMs: 100 })
    ).rejects.toThrow("local file or cached");
  });
});
it("pages exact funscript actions without rebasing times and plots the full selection", async () => {
  const result = await inspectFunscript({
    funscriptUri: script,
    startTimeMs: 500,
    endTimeMs: 7000,
    limit: 2,
  });
  expect(result.actions).toEqual(actions.slice(1, 3));
  expect(result.metadata.title).toBe("Synthetic script");
  expect(result.funscriptUri).toMatch(/^app:\/\/media\//);
  expect(result.nextOffset).toBe(2);
  expect(result.selectedActionCount).toBe(6);
  expect(result.plot?.axes).toMatchObject({ startTimeMs: 500, endTimeMs: 7000 });
  expect(state.bitmap.length).toBe(960 * 240 * 4);
  expect(state.bitmap.includes(240)).toBe(true);
  const next = await inspectFunscript({
    funscriptUri: script,
    startTimeMs: 500,
    endTimeMs: 7000,
    limit: 10,
    offset: result.nextOffset!,
    includePlot: false,
  });
  expect(next.actions).toEqual(actions.slice(3, 7));
  expect(next.nextOffset).toBeNull();
  expect(next.plot).toBeUndefined();
});
it("normalizes range/inversion/anchors exactly like playback, while retaining raw inspection", async () => {
  const filePath = path.join(directory, "inverted.funscript");
  await fs.writeFile(
    filePath,
    JSON.stringify({
      range: 50,
      inverted: true,
      actions: [
        { at: 500, pos: 10 },
        { at: 1000, pos: 50 },
      ],
    })
  );
  const normalized = await inspectFunscript({ funscriptUri: filePath, includePlot: false });
  expect(normalized.actions).toEqual([
    { at: 0, pos: 80 },
    { at: 500, pos: 80 },
    { at: 1000, pos: 0 },
  ]);
  const raw = await inspectFunscript({
    funscriptUri: filePath,
    normalized: false,
    includePlot: false,
  });
  expect(raw.actions).toEqual([
    { at: 500, pos: 10 },
    { at: 1000, pos: 50 },
  ]);
});
it("uses the editor's detector and supports adaptive and target-count modes without modifying sources", async () => {
  const before = await fs.readFile(script, "utf8");
  const input = {
    funscriptUri: script,
    durationMs: 10000,
    pauseGapMs: 900,
    minRoundMs: 500,
    trimAllowanceMs: 0,
    autoTrimRounds: true,
  };
  const standard = await autoDetectRounds(input);
  expect(standard.status).toBe("success");
  if (!("segments" in standard)) throw new Error("Expected segments");
  expect(
    standard.segments.map(({ startTimeMs, endTimeMs, type }) => ({ startTimeMs, endTimeMs, type }))
  ).toEqual(buildDetectedSegments({ actions, ...input }));
  expect(standard.saved).toBe(false);
  expect(standard.segments.length).toBeGreaterThan(0);
  expect((await autoDetectRounds({ ...input, mode: "adaptive" })).status).toBe("success");
  const target = await autoDetectRounds({
    ...input,
    mode: "targetCount",
    targetCount: standard.segments.length,
  });
  expect(target.status).toBe("success");
  expect(() => ZAutoDetect.parse({ ...input, mode: "targetCount" })).toThrow();
  expect(await fs.readFile(script, "utf8")).toBe(before);
});
it("returns native MCP image content to a real client, rather than base64 text", async () => {
  const server = createControlServer({
    router: router({}),
    context: () => ({ source: "mcp" }),
    formatResult: formatConverterResult,
    tools: [
      {
        name: "fland_converter_inspectFrames",
        description: "Frames",
        schema: ZInspectFrames,
        readOnly: true,
        run: inspectVideoFrames,
      },
      {
        name: "fland_converter_inspectFunscript",
        description: "Script",
        schema: ZInspectFunscript,
        readOnly: true,
        run: inspectFunscript,
      },
    ],
  });
  const client = new Client({ name: "vision-test", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  try {
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    const result = await client.callTool({
      name: "fland_converter_inspectFrames",
      arguments: { videoUri: video, timestampsMs: [500] },
    });
    expect(result.isError).toBeUndefined();
    expect(result.content).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: "image", mimeType: "image/jpeg" })])
    );
    const scriptResult = await client.callTool({
      name: "fland_converter_inspectFunscript",
      arguments: { funscriptUri: script, limit: 2 },
    });
    expect(scriptResult.content).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: "image", mimeType: "image/png" })])
    );
  } finally {
    await client.close();
    await server.close();
  }
});
