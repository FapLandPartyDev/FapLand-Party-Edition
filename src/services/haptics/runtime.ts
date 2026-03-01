import type { FunscriptAction } from "../../game/media/playback";
import { intifaceAdapter, type IntifaceHapticsSession } from "./intifaceAdapter";
import { thehandyAdapter, type TheHandyHapticsSession } from "./thehandyAdapter";
import type {
  HapticsConnectionConfig,
  HapticsConnectionResult,
  HapticsSession,
  HapticsStrokeState,
} from "./types";

export type AnyHapticsSession = TheHandyHapticsSession | IntifaceHapticsSession;

function assertMatchingProvider(config: HapticsConnectionConfig, session: HapticsSession): void {
  if (config.provider !== session.provider) {
    throw new Error("Haptics session provider does not match active provider.");
  }
}

export async function verifyHapticsConnection(
  config: HapticsConnectionConfig
): Promise<HapticsConnectionResult> {
  return config.provider === "thehandy"
    ? thehandyAdapter.verifyConnection(config)
    : intifaceAdapter.verifyConnection(config);
}

export async function createHapticsSession(
  config: HapticsConnectionConfig
): Promise<AnyHapticsSession> {
  return config.provider === "thehandy"
    ? thehandyAdapter.createSession(config)
    : intifaceAdapter.createSession(config);
}

export async function preloadHapticsScript(
  config: HapticsConnectionConfig,
  session: AnyHapticsSession,
  sourceId: string,
  actions: FunscriptAction[],
  skipToMs = 0
): Promise<void> {
  assertMatchingProvider(config, session);
  if (session.provider === "thehandy") {
    await thehandyAdapter.preloadScript(config, session, sourceId, actions, skipToMs);
    return;
  }
  await intifaceAdapter.preloadScript(config, session, sourceId, actions, skipToMs);
}

export async function sendHapticsSync(
  config: HapticsConnectionConfig,
  session: AnyHapticsSession,
  timeMs: number,
  playbackRate: number,
  sourceId: string,
  actions: FunscriptAction[]
): Promise<void> {
  assertMatchingProvider(config, session);
  if (session.provider === "thehandy") {
    await thehandyAdapter.sendSync(config, session, timeMs, playbackRate, sourceId, actions);
    return;
  }
  await intifaceAdapter.sendSync(config, session, timeMs, playbackRate, sourceId, actions);
}

export async function pauseHapticsPlayback(
  config: HapticsConnectionConfig,
  session: AnyHapticsSession | null
): Promise<void> {
  if (!session) return;
  assertMatchingProvider(config, session);
  if (session.provider === "thehandy") {
    await thehandyAdapter.pausePlayback(config, session);
    return;
  }
  await intifaceAdapter.pausePlayback(config, session);
}

export async function resumeHapticsPlayback(
  config: HapticsConnectionConfig,
  session: AnyHapticsSession,
  resumeAtMs: number,
  playbackRate = 1
): Promise<void> {
  assertMatchingProvider(config, session);
  if (session.provider === "thehandy") {
    await thehandyAdapter.resumePlayback(config, session, resumeAtMs, playbackRate);
    return;
  }
  await intifaceAdapter.resumePlayback(config, session, resumeAtMs, playbackRate);
}

export async function stopHapticsPlayback(
  config: HapticsConnectionConfig,
  session: AnyHapticsSession | null
): Promise<void> {
  if (!session) return;
  assertMatchingProvider(config, session);
  if (session.provider === "thehandy") {
    await thehandyAdapter.stopPlayback(config, session);
    return;
  }
  await intifaceAdapter.stopPlayback(config, session);
}

export async function disconnectHapticsSession(
  config: HapticsConnectionConfig,
  session: AnyHapticsSession | null
): Promise<void> {
  if (!session) return;
  assertMatchingProvider(config, session);
  if (session.provider === "thehandy") {
    await thehandyAdapter.disconnect?.(config, session);
    return;
  }
  await intifaceAdapter.disconnect?.(config, session);
}

export async function getHapticsStroke(
  config: HapticsConnectionConfig
): Promise<HapticsStrokeState> {
  return config.provider === "thehandy"
    ? thehandyAdapter.getStroke!(config)
    : intifaceAdapter.getStroke!(config);
}

export async function updateHapticsStroke(
  config: HapticsConnectionConfig,
  stroke: Pick<HapticsStrokeState, "min" | "max">
): Promise<HapticsStrokeState> {
  return config.provider === "thehandy"
    ? thehandyAdapter.updateStroke!(config, stroke)
    : intifaceAdapter.updateStroke!(config, stroke);
}

export type { HapticsConnectionConfig, HapticsConnectionResult, HapticsStrokeState };
