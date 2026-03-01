import type { FunscriptAction } from "../../game/media/playback";
import { normalizeHandyStrokeState } from "../theHandyConfig";
import type {
  HapticsConnectionConfig,
  HapticsConnectionResult,
  HapticsRuntimeAdapter,
  HapticsSession,
  HapticsStrokeState,
} from "./types";
import { TCodeTransportRenderer } from "./tcodeTransportRenderer";

export type TCodeHapticsSession = HapticsSession & {
  provider: "tcode";
  transport: TCodeTransportRenderer;
  loadedScriptId: string | null;
  actions: FunscriptAction[];
  sourceId: string | null;
  lastCommandAtMs: number;
  lastCommandedTimeMs: number | null;
  lastPlaybackRate: number | null;
  lastPosition: number | null;
  lastTargetActionAt: number | null;
};

const TCODE_SESSION_TTL_MS = 60 * 60_000;
const TCODE_MIN_MOVE_MS = 0;
const TCODE_MAX_MOVE_MS = 5000;

function requireTCodeConfig(
  config: HapticsConnectionConfig
): Extract<HapticsConnectionConfig, { provider: "tcode" }> {
  if (config.provider !== "tcode") {
    throw new Error("TCode adapter received non-TCode configuration.");
  }
  if (config.transport === "serial" && config.serialPath.trim().length === 0) {
    throw new Error("Select a TCode serial port before connecting.");
  }
  if (config.transport === "websocket" && config.websocketUrl.trim().length === 0) {
    throw new Error("Enter a TCode WebSocket device IP address before connecting.");
  }
  if (config.transport === "udp" && config.udpHost.trim().length === 0) {
    throw new Error("Enter a TCode UDP device IP address before connecting.");
  }
  return config;
}

function scriptId(sourceId: string, actions: FunscriptAction[]): string {
  const first = actions[0]?.at ?? 0;
  const last = actions[actions.length - 1]?.at ?? 0;
  return `${sourceId}:${actions.length}:${first}:${last}`;
}

function clampDurationMs(durationMs: number): number {
  if (!Number.isFinite(durationMs)) return TCODE_MIN_MOVE_MS;
  return Math.max(TCODE_MIN_MOVE_MS, Math.min(TCODE_MAX_MOVE_MS, Math.round(durationMs)));
}

function applyStroke(position: number, stroke: HapticsStrokeState): number {
  const normalized = normalizeHandyStrokeState(stroke);
  const clamped = Math.max(0, Math.min(100, position)) / 100;
  return (normalized.min + (normalized.max - normalized.min) * clamped) * 100;
}

function getNextAction(actions: FunscriptAction[], timeMs: number): FunscriptAction | null {
  let lo = 0;
  let hi = actions.length - 1;
  let best = -1;

  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const point = actions[mid];
    if (!point) break;

    if (point.at > timeMs) {
      best = mid;
      hi = mid - 1;
    } else {
      lo = mid + 1;
    }
  }

  return best >= 0 ? actions[best] : null;
}

function shouldSendPositionCommand(
  session: TCodeHapticsSession,
  timeMs: number,
  playbackRate: number,
  nextActionAt: number
): boolean {
  if (session.lastTargetActionAt === null || session.lastCommandedTimeMs === null) return true;
  if (session.lastTargetActionAt !== nextActionAt) return true;
  if (
    session.lastPlaybackRate !== null &&
    Math.abs(session.lastPlaybackRate - playbackRate) > 0.01
  ) {
    return true;
  }

  const elapsedMs = Date.now() - session.lastCommandAtMs;
  const expectedTimeMs = session.lastCommandedTimeMs + elapsedMs * playbackRate;
  return Math.abs(timeMs - expectedTimeMs) > 350;
}

export function formatTCodeAxisCommand(
  axis: string,
  position: number,
  precision: 3 | 4,
  durationMs?: number
): string {
  const max = precision === 3 ? 999 : 9999;
  const clamped = Math.max(0, Math.min(100, position));
  const value = Math.round((clamped / 100) * max);
  const valueText = String(value).padStart(precision, "0");
  const duration = durationMs !== undefined && durationMs > 0 ? `I${Math.round(durationMs)}` : "";
  return `${axis}${valueText}${duration}\n`;
}

function formatStopCommand(config: Extract<HapticsConnectionConfig, { provider: "tcode" }>) {
  return `DSTOP\n${formatTCodeAxisCommand(config.axis, 50, config.precision)}`;
}

function sendBestEffort(transport: TCodeTransportRenderer, command: string): void {
  try {
    transport.send(command);
  } catch {
    // Playback teardown should not fail because a stop command could not be sent.
  }
}

export const tcodeAdapter: HapticsRuntimeAdapter<TCodeHapticsSession> = {
  provider: "tcode",

  async verifyConnection(config): Promise<HapticsConnectionResult> {
    const bridge = new TCodeTransportRenderer();
    let verificationResult: HapticsConnectionResult;
    try {
      const tcodeConfig = requireTCodeConfig(config);
      const result = await bridge.connect({
        transport: tcodeConfig.transport,
        serialPath: tcodeConfig.serialPath,
        baudRate: tcodeConfig.baudRate,
        websocketUrl: tcodeConfig.websocketUrl,
        udpHost: tcodeConfig.udpHost,
      });
      if (!result.success) {
        verificationResult = {
          success: false,
          provider: "tcode",
          message: result.error ?? "Failed to connect to TCode device.",
        };
      } else {
        const sent = bridge.send(
          formatTCodeAxisCommand(tcodeConfig.axis, 50, tcodeConfig.precision)
        );
        verificationResult = sent
          ? {
              success: true,
              provider: "tcode",
              deviceType: "TCode",
              deviceName:
                tcodeConfig.transport === "serial"
                  ? tcodeConfig.serialPath
                  : tcodeConfig.transport === "udp"
                    ? tcodeConfig.udpHost
                    : tcodeConfig.websocketHost || tcodeConfig.websocketUrl,
            }
          : {
              success: false,
              provider: "tcode",
              message: "Connected to the TCode device but failed to send a command.",
            };
      }
    } catch (error) {
      verificationResult = {
        success: false,
        provider: "tcode",
        message: error instanceof Error ? error.message : "Failed to connect to TCode device.",
      };
    }

    try {
      await bridge.disconnect();
    } catch (error) {
      if (verificationResult.success) {
        return {
          success: false,
          provider: "tcode",
          message:
            error instanceof Error
              ? error.message
              : "Failed to close the TCode serial port after testing it.",
        };
      }
    }
    return verificationResult;
  },

  async createSession(config): Promise<TCodeHapticsSession> {
    const tcodeConfig = requireTCodeConfig(config);
    const transport = new TCodeTransportRenderer();
    const result = await transport.connect({
      transport: tcodeConfig.transport,
      serialPath: tcodeConfig.serialPath,
      baudRate: tcodeConfig.baudRate,
      websocketUrl: tcodeConfig.websocketUrl,
      udpHost: tcodeConfig.udpHost,
    });
    if (!result.success) {
      throw new Error(result.error ?? "Failed to connect to TCode device.");
    }
    return {
      provider: "tcode",
      expiresAtMs: Date.now() + TCODE_SESSION_TTL_MS,
      transport,
      loadedScriptId: null,
      actions: [],
      sourceId: null,
      lastCommandAtMs: 0,
      lastCommandedTimeMs: null,
      lastPlaybackRate: null,
      lastPosition: null,
      lastTargetActionAt: null,
    };
  },

  async preloadScript(_config, session, sourceId, actions): Promise<void> {
    session.loadedScriptId = scriptId(sourceId, actions);
    session.actions = [...actions].sort((left, right) => left.at - right.at);
    session.sourceId = sourceId;
    session.lastCommandedTimeMs = null;
    session.lastPlaybackRate = null;
    session.lastPosition = null;
    session.lastTargetActionAt = null;
  },

  async sendSync(config, session, timeMs, playbackRate, sourceId, actions): Promise<void> {
    const tcodeConfig = requireTCodeConfig(config);
    const id = scriptId(sourceId, actions);
    if (session.loadedScriptId !== id) {
      await tcodeAdapter.preloadScript(config, session, sourceId, actions);
    }

    const activeActions = session.actions.length > 0 ? session.actions : actions;
    const nextAction = getNextAction(activeActions, timeMs);
    if (!nextAction) return;

    const rate = Math.max(0.25, Math.min(3, playbackRate));
    if (!shouldSendPositionCommand(session, timeMs, rate, nextAction.at)) return;

    const position = applyStroke(nextAction.pos, tcodeConfig.stroke);
    const durationMs = clampDurationMs((nextAction.at - timeMs) / rate);
    const command = formatTCodeAxisCommand(
      tcodeConfig.axis,
      position,
      tcodeConfig.precision,
      durationMs
    );
    const sent = await session.transport.send(command);
    if (!sent) {
      throw new Error("Failed to send TCode command.");
    }
    session.lastCommandAtMs = Date.now();
    session.lastCommandedTimeMs = timeMs;
    session.lastPlaybackRate = rate;
    session.lastPosition = position;
    session.lastTargetActionAt = nextAction.at;
  },

  async pausePlayback(config, session): Promise<void> {
    if (!session) return;
    sendBestEffort(session.transport, formatStopCommand(requireTCodeConfig(config)));
  },

  async resumePlayback(config, session, resumeAtMs, playbackRate = 1): Promise<void> {
    if (!session.sourceId || session.actions.length === 0) return;
    await tcodeAdapter.sendSync(
      config,
      session,
      resumeAtMs,
      playbackRate,
      session.sourceId,
      session.actions
    );
  },

  async stopPlayback(config, session): Promise<void> {
    if (!session) return;
    session.loadedScriptId = null;
    session.actions = [];
    session.sourceId = null;
    session.lastCommandAtMs = 0;
    session.lastCommandedTimeMs = null;
    session.lastPlaybackRate = null;
    session.lastPosition = null;
    session.lastTargetActionAt = null;
    sendBestEffort(session.transport, formatStopCommand(requireTCodeConfig(config)));
  },

  async disconnect(config, session): Promise<void> {
    if (session) {
      sendBestEffort(session.transport, formatStopCommand(requireTCodeConfig(config)));
      await session.transport.disconnect().catch(() => undefined);
    }
  },

  async getStroke(config): Promise<HapticsStrokeState> {
    return normalizeHandyStrokeState(requireTCodeConfig(config).stroke);
  },

  async updateStroke(_config, stroke): Promise<HapticsStrokeState> {
    return normalizeHandyStrokeState(stroke);
  },
};
