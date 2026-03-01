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

export type TheHandyHapticsSession = HandySession & HapticsSession & { provider: "thehandy" };

function requireTheHandyConfig(
  config: HapticsConnectionConfig
): Extract<HapticsConnectionConfig, { provider: "thehandy" }> {
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
    await preloadHspScript(toAuth(config), session, sourceId, actions, skipToMs);
  },

  async sendSync(config, session, timeMs, playbackRate, sourceId, actions): Promise<void> {
    await sendHspSync(toAuth(config), session, timeMs, playbackRate, sourceId, actions);
  },

  async pausePlayback(config, session): Promise<void> {
    await pauseHandyPlayback(toAuth(config), session);
  },

  async resumePlayback(config, session, resumeAtMs, playbackRate = 1): Promise<void> {
    await resumeHandyPlayback(toAuth(config), session, resumeAtMs, playbackRate);
  },

  async stopPlayback(config, session): Promise<void> {
    await stopHandyPlayback(toAuth(config), session);
  },

  async disconnect(config, session): Promise<void> {
    await stopHandyPlayback(toAuth(config), session);
  },

  async getStroke(config): Promise<HapticsStrokeState> {
    return getHandyStroke(toAuth(config));
  },

  async updateStroke(config, stroke): Promise<HapticsStrokeState> {
    return updateHandyStroke(toAuth(config), stroke as Pick<HandyStrokeState, "min" | "max">);
  },
};

export type { FunscriptAction };
