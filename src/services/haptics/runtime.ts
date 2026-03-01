import type { FunscriptAction } from "../../game/media/playback";
import { intifaceAdapter, type IntifaceHapticsSession } from "./intifaceAdapter";
import { tcodeAdapter, type TCodeHapticsSession } from "./tcodeAdapter";
import { thehandyAdapter, type TheHandyHapticsSession } from "./thehandyAdapter";
import type {
  HapticsConnectionConfig,
  HapticsConnectionResult,
  HapticsRuntimeAdapter,
  HapticsSession,
  HapticsStrokeState,
} from "./types";

export type AnyHapticsSession =
  | TheHandyHapticsSession
  | IntifaceHapticsSession
  | TCodeHapticsSession;

function assertMatchingProvider(config: HapticsConnectionConfig, session: HapticsSession): void {
  if (config.provider !== session.provider) {
    throw new Error("Haptics session provider does not match active provider.");
  }
}

function getAdapter(
  provider: HapticsConnectionConfig["provider"]
): HapticsRuntimeAdapter<AnyHapticsSession> {
  if (provider === "thehandy") {
    return thehandyAdapter as HapticsRuntimeAdapter<AnyHapticsSession>;
  }
  if (provider === "intiface") {
    return intifaceAdapter as HapticsRuntimeAdapter<AnyHapticsSession>;
  }
  return tcodeAdapter as HapticsRuntimeAdapter<AnyHapticsSession>;
}

export async function verifyHapticsConnection(
  config: HapticsConnectionConfig
): Promise<HapticsConnectionResult> {
  return getAdapter(config.provider).verifyConnection(config);
}

export async function createHapticsSession(
  config: HapticsConnectionConfig
): Promise<AnyHapticsSession> {
  return getAdapter(config.provider).createSession(config);
}

export async function preloadHapticsScript(
  config: HapticsConnectionConfig,
  session: AnyHapticsSession,
  sourceId: string,
  actions: FunscriptAction[],
  skipToMs = 0
): Promise<void> {
  assertMatchingProvider(config, session);
  await getAdapter(session.provider).preloadScript(config, session, sourceId, actions, skipToMs);
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
  await getAdapter(session.provider).sendSync(
    config,
    session,
    timeMs,
    playbackRate,
    sourceId,
    actions
  );
}

export async function pauseHapticsPlayback(
  config: HapticsConnectionConfig,
  session: AnyHapticsSession | null
): Promise<void> {
  if (!session) return;
  assertMatchingProvider(config, session);
  await getAdapter(session.provider).pausePlayback(config, session);
}

export async function resumeHapticsPlayback(
  config: HapticsConnectionConfig,
  session: AnyHapticsSession,
  resumeAtMs: number,
  playbackRate = 1
): Promise<void> {
  assertMatchingProvider(config, session);
  await getAdapter(session.provider).resumePlayback(config, session, resumeAtMs, playbackRate);
}

export async function stopHapticsPlayback(
  config: HapticsConnectionConfig,
  session: AnyHapticsSession | null
): Promise<void> {
  if (!session) return;
  assertMatchingProvider(config, session);
  await getAdapter(session.provider).stopPlayback(config, session);
}

export async function disconnectHapticsSession(
  config: HapticsConnectionConfig,
  session: AnyHapticsSession | null
): Promise<void> {
  if (!session) return;
  assertMatchingProvider(config, session);
  await getAdapter(session.provider).disconnect?.(config, session);
}

export async function getHapticsStroke(
  config: HapticsConnectionConfig
): Promise<HapticsStrokeState> {
  return getAdapter(config.provider).getStroke!(config);
}

export async function updateHapticsStroke(
  config: HapticsConnectionConfig,
  stroke: Pick<HapticsStrokeState, "min" | "max">
): Promise<HapticsStrokeState> {
  return getAdapter(config.provider).updateStroke!(config, stroke);
}

export type { HapticsConnectionConfig, HapticsConnectionResult, HapticsStrokeState };
