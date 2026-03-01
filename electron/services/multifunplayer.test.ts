// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";
import { once } from "node:events";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { pathToFileURL } from "node:url";
import { loadAxisScripts, MultiFunPlayerBridge } from "./multifunplayer";

const bridges: MultiFunPlayerBridge[] = [];
const clients: WebSocket[] = [];
const directories: string[] = [];
afterEach(async () => {
  for (const client of clients.splice(0)) client.terminate();
  await Promise.all(bridges.splice(0).map((bridge) => bridge.stop()));
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))
  );
  vi.restoreAllMocks();
});

async function connect(bridge: MultiFunPlayerBridge) {
  const server = (bridge as unknown as { server: { address(): { port: number } } }).server;
  const client = new WebSocket(`ws://127.0.0.1:${server.address().port}/ofs`);
  clients.push(client);
  const messages: { type: string; name: string; data: Record<string, unknown> }[] = [];
  client.on("message", (data) => messages.push(JSON.parse(data.toString())));
  await once(client, "open");
  return { client, messages };
}

async function start() {
  const bridge = new MultiFunPlayerBridge();
  bridges.push(bridge);
  await bridge.start(0);
  return bridge;
}

describe("MultiFunPlayer OFS bridge", () => {
  it("updates every axis live without resetting media, and retains the offset on reconnect", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "fland-mfp-"));
    directories.push(directory);
    const actions = [
      { at: 0, pos: 0 },
      { at: 1000, pos: 100 },
    ];
    await writeFile(path.join(directory, "clip.roll.funscript"), JSON.stringify({ actions }));
    const bridge = await start();
    const { messages } = await connect(bridge);
    await bridge.setMedia({
      key: "round",
      videoUri: "clip.mp4",
      scriptUri: pathToFileURL(path.join(directory, "clip.funscript")).href,
      actions,
    });
    bridge.update({ key: "round", time: 0.5, duration: 10, speed: 1.5, playing: true });
    await vi.waitFor(() => expect(messages.at(-1)?.name).toBe("play_change"));
    messages.length = 0;

    for (const offsetMs of [100, -100, 0]) {
      bridge.update({ key: "round", time: 0.5, duration: 10, speed: 1.5, playing: true, offsetMs });
      await vi.waitFor(() => expect(messages.at(-1)?.name).toBe("play_change"));
      const scripts = messages.filter((message) => message.name === "funscript_change");
      expect(scripts).toHaveLength(2);
      const expected =
        offsetMs > 0
          ? [
              { at: 0, pos: 10 },
              { at: 900, pos: 100 },
            ]
          : offsetMs < 0
            ? [
                { at: 0, pos: 0 },
                { at: 100, pos: 0 },
                { at: 1100, pos: 100 },
              ]
            : actions;
      for (const script of scripts)
        expect(script.data.funscript).toMatchObject({ actions: expected });
      expect(
        messages.some((message) => ["project_change", "media_change"].includes(message.name))
      ).toBe(false);
      expect(messages.find((message) => message.name === "time_change")?.data.time).toBe(0.5);
      messages.length = 0;
    }
    bridge.update({
      key: "round",
      time: 0.5,
      duration: 10,
      speed: 1,
      playing: false,
      offsetMs: 2000,
    });
    const reconnected = await connect(bridge);
    await vi.waitFor(() => expect(reconnected.messages.at(-1)?.name).toBe("play_change"));
    for (const script of reconnected.messages.filter(
      (message) => message.name === "funscript_change"
    )) {
      expect(script.data.funscript).toMatchObject({ actions: [{ at: 0, pos: 100 }] });
    }
    expect(reconnected.messages.at(-1)?.data.playing).toBe(false);
  });

  it("discovers only matching axis scripts and skips invalid files", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "fland-mfp-"));
    directories.push(directory);
    const document = JSON.stringify({ actions: [{ at: 0, pos: 50 }] });
    await Promise.all(
      [
        "clip.funscript",
        "clip.roll.funscript",
        "clip.L0.funscript",
        "clip.TWIST.funscript",
        "other.pitch.funscript",
        "clip.notes.funscript",
      ].map((name) => writeFile(path.join(directory, name), document))
    );
    await writeFile(path.join(directory, "clip.sway.funscript"), "broken");
    const scripts = await loadAxisScripts(
      pathToFileURL(path.join(directory, "clip.funscript")).href
    );
    expect(scripts.map((script) => script.name).sort()).toEqual([
      "clip.TWIST.funscript",
      "clip.roll.funscript",
    ]);
    expect(await loadAxisScripts("https://example.com/clip.funscript")).toEqual([]);
  });

  it("sends scripts, time, speed and pause, and replays state on reconnect", async () => {
    const bridge = await start();
    const first = await connect(bridge);
    const actions = [
      { at: 0, pos: 10 },
      { at: 1000, pos: 90 },
    ];
    await bridge.setMedia({ key: "round1", videoUri: "video.mp4", scriptUri: null, actions });
    bridge.update({ key: "round1", time: 4.2, duration: 20, speed: 1.5, playing: true });
    await vi.waitFor(() =>
      expect(
        first.messages.some(
          (message) => message.name === "play_change" && message.data.playing === true
        )
      ).toBe(true)
    );
    expect(
      first.messages.find((message) => message.name === "funscript_change")?.data.funscript
    ).toMatchObject({ actions });
    expect(first.messages.find((message) => message.name === "time_change")?.data).toEqual({
      time: 4.2,
    });
    expect(first.messages.find((message) => message.name === "playbackspeed_change")?.data).toEqual(
      { speed: 1.5 }
    );
    const second = await connect(bridge);
    await vi.waitFor(() =>
      expect(second.messages.some((message) => message.name === "funscript_change")).toBe(true)
    );
    bridge.update({ key: "round1", time: 8, duration: 20, speed: 1, playing: false });
    await vi.waitFor(() => expect(second.messages.at(-1)?.data).toEqual({ playing: false }));
    bridge.clear("round1");
    await vi.waitFor(() => expect(first.messages.at(-1)?.name).toBe("project_change"));
  });

  it("ignores stale round updates and clears scripts when a scriptless round starts", async () => {
    const bridge = await start();
    const { messages } = await connect(bridge);
    await bridge.setMedia({
      key: "old",
      videoUri: "old.mp4",
      scriptUri: null,
      actions: [{ at: 0, pos: 50 }],
    });
    await bridge.setMedia({ key: "new", videoUri: "new.mp4", scriptUri: null, actions: [] });
    bridge.clear("old");
    bridge.update({ key: "old", time: 9, duration: 20, speed: 1, playing: true });
    bridge.update({ key: "new", time: 2, duration: 20, speed: 1, playing: false });
    await vi.waitFor(() => expect(messages.at(-1)?.name).toBe("play_change"));
    expect(
      messages
        .filter((message) => message.name === "time_change")
        .map((message) => message.data.time)
    ).toEqual([2]);
    const reset = messages.map((message) => message.name).lastIndexOf("project_change");
    expect(messages.slice(reset).some((message) => message.name === "funscript_change")).toBe(
      false
    );
  });

  it("pauses if renderer updates stop", async () => {
    const bridge = await start();
    const { messages } = await connect(bridge);
    await bridge.setMedia({ key: "round", videoUri: "video.mp4", scriptUri: null, actions: [] });
    bridge.update({ key: "round", time: 1, duration: 10, speed: 1, playing: true });
    await vi.waitFor(() => expect(messages.at(-1)?.data.playing).toBe(true));
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now + 2000);
    await vi.waitFor(() => expect(messages.at(-1)?.data.playing).toBe(false));
  });
});
