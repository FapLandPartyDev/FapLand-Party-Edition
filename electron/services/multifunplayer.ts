import { WebSocket, WebSocketServer, type RawData } from "ws";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { fromLocalMediaUri } from "./localMedia";
import { FunlinkAnnouncer } from "./funlink";

// RustyFunPlayer opens FapLand's native extension with rfp_hello. Builds from
// before its rename from MultiFunPlayer send mfp_hello. Other players,
// including the Windows MultiFunPlayer, never send it and keep the plain OFS
// stream below.
export const MFP_NATIVE_PROTOCOL = 1;

const axisId = z.string().regex(/^[A-Z][0-9]$/);
const unit = z.number().finite().min(0).max(1);
const nativeHelloSchema = z.object({
  protocol: z.number().int().min(1),
  application: z.string().max(200),
  version: z.string().max(100).nullish(),
});
const nativeStateSchema = z.object({
  outputs: z
    .array(
      z.object({
        id: z.string().max(100),
        kind: z.string().max(100),
        detail: z.string().max(500).nullish(),
        status: z.enum(["connected", "connecting", "disconnecting", "disconnected", "failed"]),
        error: z.string().max(1000).nullish(),
        rate: z.number().int().nullish(),
        axes: z
          .array(z.object({ axis: axisId, enabled: z.boolean(), minimum: unit, maximum: unit }))
          .max(64),
      })
    )
    .max(64),
  axes: z
    .array(
      z.object({
        axis: axisId,
        name: z.string().max(200),
        script: z.string().max(1000).nullish(),
        motionProvider: z.string().max(200).nullish(),
        link: axisId.nullish(),
        syncing: z.boolean(),
      })
    )
    .max(64),
  playback: z.object({
    media: z.string().max(1000).nullish(),
    playing: z.boolean(),
    position: z.number().finite().nullish(),
    duration: z.number().finite().nullish(),
    speed: z.number().finite(),
  }),
});

export type MfpNativeState = z.infer<typeof nativeStateSchema>;
export type MfpNativeOutput = MfpNativeState["outputs"][number];
export type MfpNativeAxis = MfpNativeState["axes"][number];
export type MfpNativePeer = {
  application: string;
  version: string | null;
  protocol: number;
  state: MfpNativeState | null;
  updatedAt: number | null;
  /** MultiFunPlayer's media position minus F-Land's, while both play the same round. */
  driftMs: number | null;
};

export type MfpFrame = {
  key: string;
  time: number;
  duration: number;
  speed: number;
  playing: boolean;
  offsetMs?: number;
};
export type MfpMedia = {
  key: string;
  videoUri: string;
  scriptUri: string | null;
  actions: { at: number; pos: number }[];
};
type Script = { name: string; funscript: Record<string, unknown> };

// OFS cannot set MFP's native offset. Shift every axis instead of changing its
// clock: MFP smooths small time_change corrections rather than seeking to them.
function offsetScript(script: Script, offsetMs: number): Script {
  if (!offsetMs) return script;
  const actions = script.funscript.actions as { at: number; pos: number }[];
  const firstFuture = actions.findIndex((action) => action.at > offsetMs);
  const shifted = actions
    .filter((action) => action.at >= offsetMs)
    .map((action) => ({ ...action, at: action.at - offsetMs }));
  if (actions.length && shifted[0]?.at !== 0) {
    // Preserve the interpolated position at zero when advancing into a stroke,
    // and hold the first/last position outside the script's time range.
    const next = firstFuture < 0 ? actions.at(-1)! : actions[firstFuture]!;
    const previous = firstFuture > 0 ? actions[firstFuture - 1]! : next;
    const fraction =
      next.at === previous.at ? 0 : (offsetMs - previous.at) / (next.at - previous.at);
    shifted.unshift({ at: 0, pos: previous.pos + (next.pos - previous.pos) * fraction });
  }
  return { ...script, funscript: { ...script.funscript, actions: shifted } };
}

// OFS events are consumed directly by MultiFunPlayer's OfsMediaSource.
function event(name: string, data: object) {
  return JSON.stringify({ type: "event", name, data });
}

export async function loadAxisScripts(uri: string | null): Promise<Script[]> {
  const file = uri ? fromLocalMediaUri(uri) : null;
  if (!file) return [];
  const directory = path.dirname(file);
  const base = path
    .basename(file)
    .replace(
      /(?:\.(?:roll|pitch|twist|surge|sway|suck|vib|l[0-2]|r[0-2]|a[0-2]))?\.funscript$/i,
      ""
    );
  const names = await readdir(directory).catch(() => [] as string[]);
  const matches = names.filter((name) => {
    if (!name.toLowerCase().startsWith(`${base.toLowerCase()}.`)) return false;
    // F-Land supplies the calibrated primary stroke timeline. A raw L0 sibling
    // must not overwrite it and bypass the in-app stroke bounds.
    if (name.slice(base.length + 1).toLowerCase() === "l0.funscript") return false;
    return /^(roll|pitch|twist|surge|sway|suck|vib|l[0-2]|r[0-2]|a[0-2])\.funscript$/i.test(
      name.slice(base.length + 1)
    );
  });
  return (
    await Promise.all(
      matches.map(async (name) => {
        try {
          const source = await readFile(path.join(directory, name), "utf8");
          const funscript = JSON.parse(source.replace(/^\uFEFF/, "")) as Record<string, unknown>;
          if (!Array.isArray(funscript.actions)) return null;
          return { name, funscript };
        } catch {
          return null;
        }
      })
    )
  ).filter((script): script is Script => script !== null);
}

export class MultiFunPlayerBridge {
  private server: WebSocketServer | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private media: MfpMedia | null = null;
  private scripts: Script[] = [];
  private frame: MfpFrame | null = null;
  private updatedAt = 0;
  private generation = 0;
  private pendingKey: string | null = null;
  private runId = 0;
  private connectionId = 0;
  private port = 8080;
  private error: string | null = null;
  private native = new Map<WebSocket, MfpNativePeer>();
  /** Announced to native players in fapland_hello. */
  version: string | null = null;
  /** Lets MultiFunPlayer offer to connect; unset until the install ID is known. */
  funlink: { id: string; icon?: string } | null = null;
  private announcer = new FunlinkAnnouncer();

  status() {
    return {
      running: this.server?.address() != null,
      port: this.port,
      runId: this.runId,
      connectionId: this.connectionId,
      clients: this.server?.clients.size ?? 0,
      error: this.error,
      native: this.nativePeer(),
      hubs: this.announcer.hubs(),
    };
  }

  /** The most recently reporting native player. Others keep their own state. */
  private nativePeer(): MfpNativePeer | null {
    let latest: MfpNativePeer | null = null;
    for (const peer of this.native.values()) {
      if (!latest || (peer.updatedAt ?? 0) > (latest.updatedAt ?? 0)) latest = peer;
    }
    return latest;
  }

  /** Moves both travel bounds of one output axis in every native player. */
  setRange(output: string, axis: string, minimum: number, maximum: number) {
    let sent = false;
    for (const [client, peer] of this.native) {
      const target = peer.state?.outputs
        .find((candidate) => candidate.id === output)
        ?.axes.find((candidate) => candidate.axis === axis);
      if (!target) continue;
      // Reflect the request until the player reports the applied range.
      target.minimum = minimum;
      target.maximum = maximum;
      this.send(client, event("fapland_set_range", { output, axis, minimum, maximum }));
      sent = true;
    }
    return sent;
  }

  private receive(client: WebSocket, data: RawData, isBinary: boolean) {
    if (isBinary) return;
    let message: { type?: unknown; name?: unknown; data?: unknown };
    try {
      message = JSON.parse(data.toString());
    } catch {
      return;
    }
    // F-Land owns playback. OFS playback commands are deliberately ignored.
    if (message?.type !== "command") return;
    if (message.name === "rfp_hello" || message.name === "mfp_hello") {
      const hello = nativeHelloSchema.safeParse(message.data);
      if (!hello.success) return;
      this.native.set(client, {
        application: hello.data.application,
        version: hello.data.version ?? null,
        protocol: Math.min(hello.data.protocol, MFP_NATIVE_PROTOCOL),
        state: null,
        updatedAt: null,
        driftMs: null,
      });
      this.send(
        client,
        event("fapland_hello", {
          protocol: MFP_NATIVE_PROTOCOL,
          application: "FapLand",
          version: this.version,
        })
      );
    } else if (message.name === "rfp_state" || message.name === "mfp_state") {
      const peer = this.native.get(client);
      const state = nativeStateSchema.safeParse(message.data);
      if (!peer || !state.success) return;
      peer.state = state.data;
      peer.updatedAt = Date.now();
      peer.driftMs = this.drift(state.data);
    }
  }

  private drift(state: MfpNativeState): number | null {
    const frame = this.frame;
    const position = state.playback.position;
    if (!frame?.playing || !state.playback.playing || position == null) return null;
    if (Date.now() - this.updatedAt > 1000) return null;
    const expected = frame.time + ((Date.now() - this.updatedAt) / 1000) * frame.speed;
    return Math.round((position - expected) * 1000);
  }

  async start(port: number) {
    if (this.server && this.port === port && this.status().running) return;
    await this.stop();
    this.port = port;
    this.error = null;
    // Native state reports list every output and axis of the player.
    const server = new WebSocketServer({
      host: "127.0.0.1",
      port,
      path: "/ofs",
      maxPayload: 256 * 1024,
    });
    this.server = server;
    server.on("error", (error) => {
      this.error = error.message;
    });
    server.on("connection", (client) => {
      // A real OFS connection carries the user's intent; listening alone does not.
      if (server.clients.size === 1) this.connectionId++;
      client.on("error", () => client.terminate());
      client.on("close", () => this.native.delete(client));
      client.on("message", (data, isBinary) => this.receive(client, data, isBinary));
      this.sendMedia(client);
      this.sendFrame(client);
    });
    try {
      await new Promise<void>((resolve, reject) => {
        server.once("listening", resolve);
        server.once("error", reject);
      });
    } catch (error) {
      await this.stop();
      throw error;
    }
    this.timer = setInterval(() => {
      if (this.frame?.playing && Date.now() - this.updatedAt > 1000) {
        this.frame = { ...this.frame, playing: false };
        this.broadcastFrame();
      }
    }, 250);
    // Port 0 lets the system choose; report the port actually in use.
    const address = server.address();
    if (address && typeof address !== "string") this.port = address.port;
    this.runId++;
    this.timer.unref();
    this.announce();
  }

  private announce() {
    const address = this.server?.address();
    if (!this.funlink || !address || typeof address === "string") return;
    void this.announcer.start({
      id: this.funlink.id,
      name: "FapLand (Funlink test)",
      ...(this.version ? { version: this.version } : {}),
      ...(this.funlink.icon ? { icon: this.funlink.icon } : {}),
      services: [
        {
          protocol: "ofs-ws",
          endpoint: `ws://127.0.0.1:${address.port}/ofs`,
          features: ["fapland-native"],
        },
      ],
    });
  }

  async stop() {
    await this.announcer.stop();
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    const server = this.server;
    this.server = null;
    this.generation++;
    this.media = null;
    this.pendingKey = null;
    this.frame = null;
    this.scripts = [];
    this.native.clear();
    if (!server) return;
    for (const client of server.clients) client.terminate();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  async setMedia(media: MfpMedia) {
    if (!this.status().running) return;
    const generation = ++this.generation;
    this.pendingKey = media.key;
    this.media = null;
    this.frame = null;
    this.scripts = [];
    this.broadcast(event("project_change", {}));
    const axes = await loadAxisScripts(media.scriptUri);
    if (generation !== this.generation) return;
    this.pendingKey = null;
    this.media = media;
    // The primary timeline already includes F-Land's normalization and inversion.
    this.scripts = [
      ...(media.actions.length
        ? [
            {
              name: "F-Land.funscript",
              funscript: { version: "1.0", inverted: false, range: 100, actions: media.actions },
            },
          ]
        : []),
      ...axes,
    ];
    for (const client of this.server?.clients ?? []) this.sendMedia(client);
  }

  update(frame: MfpFrame) {
    if (frame.key !== this.media?.key) return;
    const offsetChanged = (frame.offsetMs ?? 0) !== (this.frame?.offsetMs ?? 0);
    this.frame = frame;
    this.updatedAt = Date.now();
    if (offsetChanged) {
      for (const client of this.server?.clients ?? []) this.sendScripts(client);
    }
    this.broadcastFrame();
  }

  clear(key: string) {
    if (key !== this.media?.key && key !== this.pendingKey) return;
    this.generation++;
    this.media = null;
    this.pendingKey = null;
    this.frame = null;
    this.scripts = [];
    this.broadcast(event("project_change", {}));
  }

  private send(client: WebSocket, message: string) {
    if (client.readyState !== WebSocket.OPEN) return;
    if (client.bufferedAmount > 64 * 1024 * 1024) {
      client.terminate();
      return;
    }
    client.send(message);
  }

  private broadcast(message: string) {
    for (const client of this.server?.clients ?? []) this.send(client, message);
  }

  private sendMedia(client: WebSocket) {
    this.send(client, event("project_change", {}));
    if (!this.media) return;
    this.send(
      client,
      event("media_change", { path: fromLocalMediaUri(this.media.videoUri) ?? this.media.videoUri })
    );
    this.sendScripts(client);
  }

  private sendScripts(client: WebSocket) {
    for (const script of this.scripts) {
      this.send(client, event("funscript_change", offsetScript(script, this.frame?.offsetMs ?? 0)));
    }
  }

  private sendFrame(client: WebSocket) {
    if (!this.frame) return;
    const frame = this.frame;
    this.send(client, event("duration_change", { duration: frame.duration }));
    this.send(client, event("playbackspeed_change", { speed: frame.speed }));
    this.send(client, event("time_change", { time: frame.time }));
    this.send(
      client,
      event("play_change", { playing: frame.playing && Date.now() - this.updatedAt <= 1000 })
    );
  }

  private broadcastFrame() {
    for (const client of this.server?.clients ?? []) this.sendFrame(client);
  }
}

/**
 * Starts the bridge from the saved settings. Without a saved choice it runs,
 * so MultiFunPlayer can offer to connect, and takes any free port when the
 * default one is busy. A bridge the user turned off stays off.
 */
export async function startSavedBridge(
  bridge: MultiFunPlayerBridge,
  enabled: unknown,
  savedPort: unknown
) {
  if (enabled === false) return;
  const port = Number(savedPort ?? 8080);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) return;
  try {
    await bridge.start(port);
  } catch (error) {
    if (enabled === true) throw error;
    await bridge.start(0);
  }
}

export const multifunplayerBridge = new MultiFunPlayerBridge();
