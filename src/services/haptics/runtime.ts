import type { FunscriptAction } from "../../game/media/playback";
import { intifaceAdapter, type IntifaceHapticsSession } from "./intifaceAdapter";
import { tcodeAdapter, type TCodeHapticsSession } from "./tcodeAdapter";
import { thehandyAdapter, type TheHandyHapticsSession } from "./thehandyAdapter";
import type {
  HapticsConnectionConfig,
  HapticsConnectionResult,
  HapticsRuntimeAdapter,
  HapticsSession,
  HapticsSyncOptions,
  HapticsStrokeState,
} from "./types";

export type ProviderHapticsSession =
  TheHandyHapticsSession | IntifaceHapticsSession | TCodeHapticsSession;

export type AnyHapticsSession = ProviderHapticsSession | HapticsGroupSession;

export type HapticsDeviceTarget = {
  id: string;
  config: HapticsConnectionConfig;
  offsetMs: number;
};

export type HapticsGroupConfig = {
  provider: "group";
  devices: HapticsDeviceTarget[];
};

export type HapticsTargetConfig = HapticsConnectionConfig | HapticsGroupConfig;

export type HapticsGroupSession = {
  provider: "group";
  expiresAtMs: number;
  sessions: Map<string, AnyHapticsSession>;
};

function assertMatchingProvider(config: HapticsConnectionConfig, session: HapticsSession): void {
  if (config.provider !== session.provider) {
    throw new Error("Haptics session provider does not match active provider.");
  }
}

function getAdapter(
  provider: HapticsConnectionConfig["provider"]
): HapticsRuntimeAdapter<ProviderHapticsSession> {
  if (provider === "thehandy") {
    return thehandyAdapter as HapticsRuntimeAdapter<ProviderHapticsSession>;
  }
  if (provider === "intiface") {
    return intifaceAdapter as HapticsRuntimeAdapter<ProviderHapticsSession>;
  }
  return tcodeAdapter as HapticsRuntimeAdapter<ProviderHapticsSession>;
}

export async function verifyHapticsConnection(
  config: HapticsConnectionConfig
): Promise<HapticsConnectionResult> {
  return getAdapter(config.provider).verifyConnection(config);
}

export async function createHapticsSession(
  config: HapticsTargetConfig
): Promise<AnyHapticsSession> {
  if (config.provider === "group") {
    const results = await Promise.allSettled(
      config.devices.map(async (device) => ({
        id: device.id,
        session: await createHapticsSession(device.config),
      }))
    );
    const sessions = new Map<string, AnyHapticsSession>();
    for (const result of results) {
      if (result.status === "fulfilled") sessions.set(result.value.id, result.value.session);
    }
    if (sessions.size === 0 && config.devices.length > 0) {
      throw new Error(settledErrors(results).join("; "));
    }
    return {
      provider: "group",
      expiresAtMs: Math.min(
        ...[...sessions.values()].map((session) => session.expiresAtMs),
        Date.now() + 60_000
      ),
      sessions,
    };
  }
  return getAdapter(config.provider).createSession(config);
}

function groupEntries(
  config: HapticsGroupConfig,
  session: HapticsGroupSession
): Array<{ target: HapticsDeviceTarget; session: AnyHapticsSession }> {
  return config.devices.flatMap((target) => {
    const childSession = session.sessions.get(target.id);
    return childSession ? [{ target, session: childSession }] : [];
  });
}

async function runGroup(
  tasks: Array<Promise<void>>,
  emptyMessage = "No connected haptics devices."
): Promise<void> {
  if (tasks.length === 0) throw new Error(emptyMessage);
  const results = await Promise.allSettled(tasks);
  if (results.some((result) => result.status === "fulfilled")) return;
  throw new Error(settledErrors(results).join("; "));
}

export async function preloadHapticsScript(
  config: HapticsTargetConfig,
  session: AnyHapticsSession,
  sourceId: string,
  actions: FunscriptAction[],
  skipToMs = 0
): Promise<void> {
  if (config.provider === "group" && session.provider === "group") {
    await runGroup(
      groupEntries(config, session).map(({ target, session: child }) =>
        preloadHapticsScript(target.config, child, sourceId, actions, skipToMs + target.offsetMs)
      )
    );
    return;
  }
  if (config.provider === "group" || session.provider === "group") {
    throw new Error("Haptics group configuration does not match its session.");
  }
  assertMatchingProvider(config, session);
  await getAdapter(session.provider).preloadScript(config, session, sourceId, actions, skipToMs);
}

export async function sendHapticsSync(
  config: HapticsTargetConfig,
  session: AnyHapticsSession,
  timeMs: number,
  playbackRate: number,
  sourceId: string,
  actions: FunscriptAction[],
  options?: HapticsSyncOptions
): Promise<void> {
  if (config.provider === "group" && session.provider === "group") {
    await runGroup(
      groupEntries(config, session).map(({ target, session: child }) =>
        sendHapticsSync(
          target.config,
          child,
          Math.max(0, timeMs + target.offsetMs),
          playbackRate,
          sourceId,
          actions,
          options
        )
      )
    );
    return;
  }
  if (config.provider === "group" || session.provider === "group") {
    throw new Error("Haptics group configuration does not match its session.");
  }
  assertMatchingProvider(config, session);
  const adapter = getAdapter(session.provider);
  if (options === undefined) {
    await adapter.sendSync(config, session, timeMs, playbackRate, sourceId, actions);
  } else {
    await adapter.sendSync(config, session, timeMs, playbackRate, sourceId, actions, options);
  }
}

export async function pauseHapticsPlayback(
  config: HapticsTargetConfig,
  session: AnyHapticsSession | null
): Promise<void> {
  if (!session) return;
  if (config.provider === "group" && session.provider === "group") {
    await runGroup(
      groupEntries(config, session).map(({ target, session: child }) =>
        pauseHapticsPlayback(target.config, child)
      )
    );
    return;
  }
  if (config.provider === "group" || session.provider === "group") return;
  assertMatchingProvider(config, session);
  await getAdapter(session.provider).pausePlayback(config, session);
}

export async function resumeHapticsPlayback(
  config: HapticsTargetConfig,
  session: AnyHapticsSession,
  resumeAtMs: number,
  playbackRate = 1
): Promise<void> {
  if (config.provider === "group" && session.provider === "group") {
    await runGroup(
      groupEntries(config, session).map(({ target, session: child }) =>
        resumeHapticsPlayback(
          target.config,
          child,
          Math.max(0, resumeAtMs + target.offsetMs),
          playbackRate
        )
      )
    );
    return;
  }
  if (config.provider === "group" || session.provider === "group") return;
  assertMatchingProvider(config, session);
  await getAdapter(session.provider).resumePlayback(config, session, resumeAtMs, playbackRate);
}

export async function stopHapticsPlayback(
  config: HapticsTargetConfig,
  session: AnyHapticsSession | null
): Promise<void> {
  if (!session) return;
  if (config.provider === "group" && session.provider === "group") {
    await runGroup(
      groupEntries(config, session).map(({ target, session: child }) =>
        stopHapticsPlayback(target.config, child)
      )
    );
    return;
  }
  if (config.provider === "group" || session.provider === "group") return;
  assertMatchingProvider(config, session);
  await getAdapter(session.provider).stopPlayback(config, session);
}

export async function disconnectHapticsSession(
  config: HapticsTargetConfig,
  session: AnyHapticsSession | null
): Promise<void> {
  if (!session) return;
  if (config.provider === "group" && session.provider === "group") {
    await runGroup(
      groupEntries(config, session).map(({ target, session: child }) =>
        disconnectHapticsSession(target.config, child)
      )
    );
    session.sessions.clear();
    return;
  }
  if (config.provider === "group" || session.provider === "group") return;
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

export type ActiveDevice = {
  config: HapticsConnectionConfig;
  session: AnyHapticsSession;
  offsetMs: number;
};

type FanOutResult = PromiseSettledResult<unknown>;

function settledErrors(results: readonly FanOutResult[]): string[] {
  return results
    .filter((result): result is PromiseRejectedResult => result.status === "rejected")
    .map((result) => {
      const reason = result.reason;
      return reason instanceof Error ? reason.message : String(reason);
    });
}

export async function preloadHapticsScriptAll(
  devices: readonly ActiveDevice[],
  sourceId: string,
  actions: FunscriptAction[],
  skipToMs = 0
): Promise<void> {
  const results = await Promise.allSettled(
    devices.map((device) =>
      preloadHapticsScript(device.config, device.session, sourceId, actions, skipToMs)
    )
  );
  const errors = settledErrors(results);
  if (errors.length > 0) throw new Error(errors.join("; "));
}

export async function sendHapticsSyncAll(
  devices: readonly ActiveDevice[],
  timeMs: number,
  playbackRate: number,
  sourceId: string,
  actions: FunscriptAction[],
  options?: HapticsSyncOptions
): Promise<void> {
  const results = await Promise.allSettled(
    devices.map((device) => {
      const adjustedTimeMs = Math.max(0, timeMs - device.offsetMs);
      return sendHapticsSync(
        device.config,
        device.session,
        adjustedTimeMs,
        playbackRate,
        sourceId,
        actions,
        options
      );
    })
  );
  const errors = settledErrors(results);
  if (errors.length > 0) throw new Error(errors.join("; "));
}

export async function pauseHapticsPlaybackAll(devices: readonly ActiveDevice[]): Promise<void> {
  const results = await Promise.allSettled(
    devices.map((device) => pauseHapticsPlayback(device.config, device.session))
  );
  const errors = settledErrors(results);
  if (errors.length > 0) throw new Error(errors.join("; "));
}

export async function resumeHapticsPlaybackAll(
  devices: readonly ActiveDevice[],
  resumeAtMs: number,
  playbackRate = 1
): Promise<void> {
  const results = await Promise.allSettled(
    devices.map((device) => {
      const adjustedResumeMs = Math.max(0, resumeAtMs - device.offsetMs);
      return resumeHapticsPlayback(device.config, device.session, adjustedResumeMs, playbackRate);
    })
  );
  const errors = settledErrors(results);
  if (errors.length > 0) throw new Error(errors.join("; "));
}

export async function stopHapticsPlaybackAll(devices: readonly ActiveDevice[]): Promise<void> {
  const results = await Promise.allSettled(
    devices.map((device) => stopHapticsPlayback(device.config, device.session))
  );
  const errors = settledErrors(results);
  if (errors.length > 0) throw new Error(errors.join("; "));
}

export async function disconnectHapticsAll(devices: readonly ActiveDevice[]): Promise<void> {
  const results = await Promise.allSettled(
    devices.map((device) => disconnectHapticsSession(device.config, device.session))
  );
  const errors = settledErrors(results);
  if (errors.length > 0) throw new Error(errors.join("; "));
}

export type {
  HapticsConnectionConfig,
  HapticsConnectionResult,
  HapticsStrokeState,
  HapticsSyncOptions,
};
