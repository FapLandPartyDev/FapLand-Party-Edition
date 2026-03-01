import { trpc } from "../trpc";
import { normalizeHandyStrokeState } from "../theHandyConfig";
import { getScriptActionsUri } from "./scriptEnhancement";
import type { FunscriptAction } from "../../game/media/playback";
import type { HapticsConnectionConfig, HapticsRuntimeAdapter, HapticsSession } from "./types";

export type MultiFunPlayerSession = HapticsSession & {
  provider: "multifunplayer";
  key: string;
  source?: string;
  actions?: FunscriptAction[];
  range?: string;
  time: number;
  speed: number;
  duration: number;
  controlRevision: number;
  bridgeRunId: number | null;
  checkedAt: number;
  offsetMs: number;
};

function configFor(config: HapticsConnectionConfig) {
  if (config.provider !== "multifunplayer")
    throw new Error("Expected MultiFunPlayer configuration.");
  return config;
}

async function frame(session: MultiFunPlayerSession, playing: boolean) {
  await trpc.multifunplayer.update.mutate({
    key: session.key,
    time: session.time / 1000,
    duration: session.duration / 1000,
    speed: session.speed,
    playing,
    offsetMs: session.offsetMs,
  });
}

export const multifunplayerAdapter: HapticsRuntimeAdapter<MultiFunPlayerSession> = {
  provider: "multifunplayer",
  async verifyConnection() {
    const status = await trpc.multifunplayer.status.query();
    return {
      provider: "multifunplayer",
      success: status.running && status.clients > 0,
      deviceName: "MultiFunPlayer",
      message:
        status.error ??
        (!status.running
          ? "Enable the MultiFunPlayer bridge first."
          : status.clients === 0
            ? "Connect MultiFunPlayer's OFS player to the bridge first."
            : undefined),
    };
  },
  async createSession(config) {
    configFor(config);
    const result = await multifunplayerAdapter.verifyConnection(config);
    if (!result.success) throw new Error(result.message);
    return {
      provider: "multifunplayer",
      key: crypto.randomUUID(),
      expiresAtMs: Infinity,
      time: 0,
      speed: 1,
      duration: 0,
      controlRevision: 0,
      bridgeRunId: null,
      checkedAt: 0,
      offsetMs: 0,
    };
  },
  async preloadScript(config, session, source, actions) {
    const settings = configFor(config);
    if (session.bridgeRunId === null || Date.now() - session.checkedAt >= 1000) {
      const status = await trpc.multifunplayer.status.query();
      if (!status.running || status.clients === 0) {
        throw new Error(
          status.error ?? "MultiFunPlayer is disconnected. Reconnect the OFS player."
        );
      }
      if (session.bridgeRunId !== status.runId) session.source = undefined;
      session.bridgeRunId = status.runId;
      session.checkedAt = Date.now();
    }
    const stroke = normalizeHandyStrokeState(settings.stroke);
    const range = `${stroke.min}:${stroke.max}`;
    if (session.source === source && session.actions === actions && session.range === range) return;
    await trpc.multifunplayer.setMedia.mutate({
      key: session.key,
      videoUri: settings.videoUri ?? source,
      scriptUri: getScriptActionsUri(actions) ?? settings.scriptUri ?? null,
      actions: actions.map(({ at, pos }) => ({
        at,
        pos: Number((100 * stroke.min + pos * (stroke.max - stroke.min)).toFixed(6)),
      })),
    });
    session.source = source;
    session.actions = actions;
    session.range = range;
    session.duration = actions.at(-1)?.at ?? 0;
  },
  async sendSync(config, session, time, speed, source, actions, options) {
    const revision = session.controlRevision;
    await multifunplayerAdapter.preloadScript(config, session, source, actions);
    session.offsetMs = options?.scriptOffsetMs ?? 0;
    session.time = options?.mediaTimeMs ?? Math.max(0, time - session.offsetMs);
    session.speed = speed;
    await frame(session, revision === session.controlRevision && options?.playing !== false);
  },
  async pausePlayback(_config, session) {
    if (session) {
      session.controlRevision++;
      await frame(session, false);
    }
  },
  async stopPlayback(_config, session) {
    if (session) {
      session.controlRevision++;
      await frame(session, false);
    }
  },
  async resumePlayback(_config, session, time, speed = 1) {
    session.time = Math.max(0, time - session.offsetMs);
    session.speed = speed;
    await frame(session, true);
  },
  async disconnect(_config, session) {
    if (!session) return;
    session.controlRevision++;
    await frame(session, false);
    await trpc.multifunplayer.clear.mutate({ key: session.key });
  },
  async getStroke(config) {
    return normalizeHandyStrokeState(configFor(config).stroke);
  },
  async updateStroke(_config, stroke) {
    return normalizeHandyStrokeState(stroke);
  },
};
