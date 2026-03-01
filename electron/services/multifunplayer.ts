import { WebSocket, WebSocketServer } from "ws";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fromLocalMediaUri } from "./localMedia";

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
  private port = 8080;
  private error: string | null = null;

  status() {
    return {
      running: this.server?.address() != null,
      port: this.port,
      runId: this.runId,
      clients: this.server?.clients.size ?? 0,
      error: this.error,
    };
  }

  async start(port: number) {
    if (this.server && this.port === port && this.status().running) return;
    await this.stop();
    this.port = port;
    this.error = null;
    const server = new WebSocketServer({ host: "127.0.0.1", port, path: "/ofs", maxPayload: 4096 });
    this.server = server;
    server.on("error", (error) => {
      this.error = error.message;
    });
    server.on("connection", (client) => {
      client.on("error", () => client.terminate());
      // F-Land owns playback. Incoming OFS commands are deliberately ignored.
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
    this.runId++;
    this.timer.unref();
  }

  async stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    const server = this.server;
    this.server = null;
    this.generation++;
    this.media = null;
    this.pendingKey = null;
    this.frame = null;
    this.scripts = [];
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

export const multifunplayerBridge = new MultiFunPlayerBridge();
