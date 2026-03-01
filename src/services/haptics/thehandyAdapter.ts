import type { FunscriptAction } from "../../game/media/playback";
import { verifyConnection } from "../handyApi";
import type { HandyStrokeState } from "../theHandyConfig";
import {
  getHandyStroke,
  issueHandySession,
  pauseHandyPlayback,
  preloadHspScript,
  resumeHandyPlayback,
  sendHspSync,
  stopHandyPlayback,
  updateHandyStroke,
  type HandyAuthBundle,
  type HandySession,
} from "../thehandy/runtime";
import type {
  HapticsConnectionConfig,
  HapticsConnectionResult,
  HapticsRuntimeAdapter,
  HapticsSession,
  HapticsStrokeState,
} from "./types";

type TheHandyHapticsConfig = Extract<HapticsConnectionConfig, { provider: "thehandy" }>;

const deviceOperationTails = new Map<string, Promise<void>>();

function getDeviceOperationKey(config: HapticsConnectionConfig): string {
  const handyConfig = requireTheHandyConfig(config);
  return `${handyConfig.connectionKey.trim()}:${handyConfig.appApiKey.trim()}`;
}

async function runDeviceOperation<T>(
  config: HapticsConnectionConfig,
  operation: () => Promise<T>
): Promise<T> {
  const key = getDeviceOperationKey(config);
  const previous = deviceOperationTails.get(key) ?? Promise.resolve();
  const result = previous.catch(() => undefined).then(operation);
  const tail = result.then(
    () => undefined,
    () => undefined
  );
  deviceOperationTails.set(key, tail);
  try {
    return await result;
  } finally {
    if (deviceOperationTails.get(key) === tail) deviceOperationTails.delete(key);
  }
}

export type TheHandyHapticsSession = HandySession & HapticsSession & { provider: "thehandy" };

function requireTheHandyConfig(config: HapticsConnectionConfig): TheHandyHapticsConfig {
  if (config.provider !== "thehandy") {
    throw new Error("TheHandy adapter received non-TheHandy configuration.");
  }
  return config;
}

function toAuth(config: HapticsConnectionConfig): HandyAuthBundle {
  const handyConfig = requireTheHandyConfig(config);
  return {
    connectionKey: handyConfig.connectionKey,
    appApiKey: handyConfig.appApiKey,
  };
}

export const thehandyAdapter: HapticsRuntimeAdapter<TheHandyHapticsSession> = {
  provider: "thehandy",

  async verifyConnection(config): Promise<HapticsConnectionResult> {
    const handyConfig = requireTheHandyConfig(config);
    const result = await verifyConnection(
      handyConfig.connectionKey,
      handyConfig.localIp,
      handyConfig.appApiKey
    );
    return {
      ...result,
      provider: "thehandy",
    };
  },

  async createSession(config): Promise<TheHandyHapticsSession> {
    const session = await issueHandySession(toAuth(config));
    return {
      ...session,
      provider: "thehandy",
    };
  },

  async preloadScript(config, session, sourceId, actions, skipToMs = 0): Promise<void> {
    await runDeviceOperation(config, () =>
      preloadHspScript(toAuth(config), session, sourceId, actions, skipToMs)
    );
  },

  async sendSync(config, session, timeMs, playbackRate, sourceId, actions, options): Promise<void> {
    await runDeviceOperation(config, () =>
      sendHspSync(toAuth(config), session, timeMs, playbackRate, sourceId, actions, options)
    );
  },

  async pausePlayback(config, session): Promise<void> {
    await runDeviceOperation(config, () => pauseHandyPlayback(toAuth(config), session));
  },

  async resumePlayback(config, session, resumeAtMs, playbackRate = 1): Promise<void> {
    await runDeviceOperation(config, () =>
      resumeHandyPlayback(toAuth(config), session, resumeAtMs, playbackRate)
    );
  },

  async stopPlayback(config, session): Promise<void> {
    await runDeviceOperation(config, () => stopHandyPlayback(toAuth(config), session));
  },

  async disconnect(config, session): Promise<void> {
    await runDeviceOperation(config, () => stopHandyPlayback(toAuth(config), session));
  },

  async getStroke(config): Promise<HapticsStrokeState> {
    return getHandyStroke(toAuth(config));
  },

  async updateStroke(config, stroke): Promise<HapticsStrokeState> {
    return updateHandyStroke(toAuth(config), stroke as Pick<HandyStrokeState, "min" | "max">);
  },
};

export type { FunscriptAction };
