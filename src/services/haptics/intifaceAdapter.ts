import type { FunscriptAction } from "../../game/media/playback";
import { normalizeHandyStrokeState } from "../theHandyConfig";
import type {
  HapticsConnectionConfig,
  HapticsConnectionResult,
  HapticsRuntimeAdapter,
  HapticsSession,
  HapticsStrokeState,
} from "./types";

type ButtplugModule = {
  ButtplugClient: new (name: string) => IntifaceClient;
  ButtplugBrowserWebsocketClientConnector: new (address: string) => unknown;
  DeviceOutput?: {
    PositionWithDuration?: {
      percent: (position: number, durationMs: number) => unknown;
    };
    Position?: {
      percent: (position: number) => unknown;
    };
    Vibrate?: {
      speed: (intensity: number) => unknown;
    };
  };
  OutputType?: {
    Position?: unknown;
    Linear?: unknown;
    HwPositionWithDuration?: unknown;
    Vibrate?: unknown;
  };
};

type IntifaceClient = {
  connected?: boolean;
  devices?: Map<number, IntifaceDevice> | IntifaceDevice[] | Record<string, IntifaceDevice>;
  connect: (connector: unknown) => Promise<void>;
  disconnect: () => Promise<void>;
  startScanning?: () => Promise<void>;
  stopScanning?: () => Promise<void>;
  addListener?: (event: string, listener: (...args: unknown[]) => void) => void;
};

type IntifaceDevice = {
  index?: number;
  deviceIndex?: number;
  name?: string;
  hasOutput?: (outputType: unknown) => boolean;
  runOutput?: (output: unknown) => Promise<void>;
  stop?: () => Promise<void>;
  positionWithDuration?: (position: number, durationMs: number) => Promise<void>;
  linear?: (position: number, durationMs: number) => Promise<void>;
  vibrate?: (intensity: number) => Promise<void>;
  features?: unknown;
};

export type IntifaceDeviceMode = "position" | "vibrate";

export type IntifaceHapticsSession = HapticsSession & {
  provider: "intiface";
  client: IntifaceClient;
  device: IntifaceDevice;
  deviceMode: IntifaceDeviceMode;
  deviceName: string | null;
  deviceIndex: number | null;
  loadedScriptId: string | null;
  actions: FunscriptAction[];
  sourceId: string | null;
  lastCommandAtMs: number;
  lastCommandedTimeMs: number | null;
  lastPlaybackRate: number | null;
  lastPosition: number | null;
  lastIntensity: number | null;
  lastTargetActionAt: number | null;
};

const INTIFACE_CLIENT_NAME = "Fap Land";
const INTIFACE_SESSION_TTL_MS = 60 * 60_000;
const INTIFACE_SCAN_MS = 2500;
const INTIFACE_MIN_MOVE_MS = 0;
const INTIFACE_MAX_MOVE_MS = 5000;
const DEFAULT_INTIFACE_URL = "ws://127.0.0.1:12345";
// Funscript positions span 0..100. A full 0->100 stroke in ~250ms (~400 pos/s)
// is around the top of what real scripts do, so that maps to 100% intensity.
const INTIFACE_MAX_VIBE_SPEED_POS_PER_SEC = 400;
const INTIFACE_VIBE_RESEND_DELTA = 0.02;

let moduleOverride: ButtplugModule | null = null;

export function setIntifaceButtplugModuleForTests(module: ButtplugModule | null): void {
  moduleOverride = module;
}

function requireIntifaceConfig(
  config: HapticsConnectionConfig
): Extract<HapticsConnectionConfig, { provider: "intiface" }> {
  if (config.provider !== "intiface") {
    throw new Error("Intiface adapter received non-Intiface configuration.");
  }
  return config;
}

async function loadButtplug(): Promise<ButtplugModule> {
  if (moduleOverride) return moduleOverride;
  try {
    return (await import("buttplug")) as ButtplugModule;
  } catch (error) {
    throw new Error(
      `Buttplug JS dependency is unavailable. Install dependencies and restart the app.${error instanceof Error ? ` ${error.message}` : ""}`
    );
  }
}

function getWebsocketUrl(config: HapticsConnectionConfig): string {
  const intifaceConfig = requireIntifaceConfig(config);
  const normalized = intifaceConfig.websocketUrl.trim();
  return normalized.length > 0 ? normalized : DEFAULT_INTIFACE_URL;
}

function getDeviceIndex(device: IntifaceDevice, fallback: number): number {
  const raw = device.index ?? device.deviceIndex;
  return typeof raw === "number" && Number.isFinite(raw) ? raw : fallback;
}

function getClientDevices(
  client: IntifaceClient
): Array<{ index: number; device: IntifaceDevice }> {
  const devices = client.devices;
  if (!devices) return [];
  if (devices instanceof Map) {
    return [...devices.entries()].map(([index, device]) => ({
      index,
      device,
    }));
  }
  if (Array.isArray(devices)) {
    return devices.map((device, index) => ({
      index: getDeviceIndex(device, index),
      device,
    }));
  }
  return Object.entries(devices).map(([key, device], fallback) => {
    const parsed = Number(key);
    return {
      index: Number.isFinite(parsed) ? parsed : getDeviceIndex(device, fallback),
      device,
    };
  });
}

function outputValues(module: ButtplugModule): unknown[] {
  return [
    module.OutputType?.HwPositionWithDuration,
    module.OutputType?.Position,
    "HwPositionWithDuration",
    "Position",
  ].filter((value) => value !== undefined);
}

function vibrationOutputValues(module: ButtplugModule): unknown[] {
  return [module.OutputType?.Vibrate, "Vibrate"].filter((value) => value !== undefined);
}

function deviceSupportsOutput(
  device: IntifaceDevice,
  outputType: unknown
): boolean {
  if (outputType === undefined || typeof device.hasOutput !== "function") return false;
  try {
    return device.hasOutput(outputType) === true;
  } catch {
    return false;
  }
}

function isPositionCapable(module: ButtplugModule, device: IntifaceDevice): boolean {
  if (typeof device.positionWithDuration === "function" || typeof device.linear === "function") {
    return true;
  }
  if (typeof device.hasOutput !== "function") return false;
  return outputValues(module).some((outputType) => deviceSupportsOutput(device, outputType));
}

function isVibrationCapable(module: ButtplugModule, device: IntifaceDevice): boolean {
  if (typeof device.vibrate === "function") return true;
  if (typeof device.hasOutput !== "function") return false;
  return vibrationOutputValues(module).some((outputType) =>
    deviceSupportsOutput(device, outputType)
  );
}

function selectDevice(
  module: ButtplugModule,
  client: IntifaceClient,
  preferredIndex: number | null
): { index: number; device: IntifaceDevice; mode: IntifaceDeviceMode } | null {
  const devices = getClientDevices(client);
  if (devices.length === 0) return null;

  const positionDevices = devices.filter(({ device }) => isPositionCapable(module, device));
  const vibeDevices = devices.filter(({ device }) => isVibrationCapable(module, device));

  if (preferredIndex !== null) {
    const preferredPosition = positionDevices.find(({ index }) => index === preferredIndex);
    if (preferredPosition) {
      return { ...preferredPosition, mode: "position" };
    }
    const preferredVibe = vibeDevices.find(({ index }) => index === preferredIndex);
    if (preferredVibe) {
      return { ...preferredVibe, mode: "vibrate" };
    }
  }

  if (positionDevices.length > 0) {
    return { ...positionDevices[0]!, mode: "position" };
  }
  if (vibeDevices.length > 0) {
    return { ...vibeDevices[0]!, mode: "vibrate" };
  }
  return null;
}

async function connectClient(config: HapticsConnectionConfig): Promise<{
  module: ButtplugModule;
  client: IntifaceClient;
  selected: { index: number; device: IntifaceDevice; mode: IntifaceDeviceMode } | null;
}> {
  const intifaceConfig = requireIntifaceConfig(config);
  const module = await loadButtplug();
  const client = new module.ButtplugClient(INTIFACE_CLIENT_NAME);
  const connector = new module.ButtplugBrowserWebsocketClientConnector(getWebsocketUrl(config));
  await client.connect(connector);

  let selected = selectDevice(module, client, intifaceConfig.deviceIndex);
  if (!selected && typeof client.startScanning === "function") {
    await client.startScanning();
    await new Promise((resolve) => globalThis.setTimeout(resolve, INTIFACE_SCAN_MS));
    await client.stopScanning?.().catch(() => undefined);
    selected = selectDevice(module, client, intifaceConfig.deviceIndex);
  }

  return { module, client, selected };
}

function scriptId(sourceId: string, actions: FunscriptAction[]): string {
  const first = actions[0]?.at ?? 0;
  const last = actions[actions.length - 1]?.at ?? 0;
  return `${sourceId}:${actions.length}:${first}:${last}`;
}

function clampDurationMs(durationMs: number): number {
  if (!Number.isFinite(durationMs)) return INTIFACE_MIN_MOVE_MS;
  return Math.max(INTIFACE_MIN_MOVE_MS, Math.min(INTIFACE_MAX_MOVE_MS, Math.round(durationMs)));
}

function applyStroke(position: number, stroke: HapticsStrokeState): number {
  const normalized = normalizeHandyStrokeState(stroke);
  const clamped = Math.max(0, Math.min(100, position)) / 100;
  return normalized.min + (normalized.max - normalized.min) * clamped;
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
  session: IntifaceHapticsSession,
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
  if (Math.abs(timeMs - expectedTimeMs) > 350) return true;

  return false;
}

function shouldSendVibrationCommand(
  session: IntifaceHapticsSession,
  intensity: number,
  playbackRate: number
): boolean {
  if (session.lastIntensity === null || session.lastCommandedTimeMs === null) return true;

  if (
    session.lastPlaybackRate !== null &&
    Math.abs(session.lastPlaybackRate - playbackRate) > 0.01
  ) {
    return true;
  }

  if (Math.abs(intensity - session.lastIntensity) > INTIFACE_VIBE_RESEND_DELTA) return true;

  // Resend periodically so a held non-zero value does not get dropped by the
  // device while the segment is still active.
  const elapsedMs = Date.now() - session.lastCommandAtMs;
  if (elapsedMs > 500 && intensity > 0) return true;

  return false;
}

async function runPositionCommand(
  module: ButtplugModule,
  device: IntifaceDevice,
  position: number,
  durationMs: number
): Promise<void> {
  const clampedPosition = Math.max(0, Math.min(1, position));
  const clampedDuration = clampDurationMs(durationMs);
  const supportsPositionWithDuration =
    deviceSupportsOutput(device, module.OutputType?.HwPositionWithDuration) ||
    deviceSupportsOutput(device, "HwPositionWithDuration");
  const supportsPosition =
    deviceSupportsOutput(device, module.OutputType?.Position) ||
    deviceSupportsOutput(device, "Position");

  if (
    supportsPositionWithDuration &&
    module.DeviceOutput?.PositionWithDuration?.percent &&
    typeof device.runOutput === "function"
  ) {
    await device.runOutput(
      module.DeviceOutput.PositionWithDuration.percent(clampedPosition, clampedDuration)
    );
    return;
  }
  if (
    supportsPosition &&
    module.DeviceOutput?.Position?.percent &&
    typeof device.runOutput === "function"
  ) {
    await device.runOutput(module.DeviceOutput.Position.percent(clampedPosition));
    return;
  }
  if (typeof device.positionWithDuration === "function") {
    await device.positionWithDuration(clampedPosition, clampedDuration);
    return;
  }
  if (typeof device.linear === "function") {
    await device.linear(clampedPosition, clampedDuration);
    return;
  }
  throw new Error("Selected Intiface device does not support position commands.");
}

async function runVibrationCommand(
  module: ButtplugModule,
  device: IntifaceDevice,
  intensity: number
): Promise<void> {
  const clampedIntensity = Math.max(0, Math.min(1, intensity));
  const supportsVibrate =
    deviceSupportsOutput(device, module.OutputType?.Vibrate) ||
    deviceSupportsOutput(device, "Vibrate");

  if (
    supportsVibrate &&
    module.DeviceOutput?.Vibrate?.speed &&
    typeof device.runOutput === "function"
  ) {
    await device.runOutput(module.DeviceOutput.Vibrate.speed(clampedIntensity));
    return;
  }
  if (typeof device.vibrate === "function") {
    await device.vibrate(clampedIntensity);
    return;
  }
  throw new Error("Selected Intiface device does not support vibration commands.");
}

function getActionSegment(
  actions: FunscriptAction[],
  timeMs: number
): { prev: FunscriptAction; next: FunscriptAction } | null {
  if (actions.length < 2) return null;
  let lo = 0;
  let hi = actions.length - 1;
  let prevIndex = -1;

  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const point = actions[mid];
    if (!point) break;
    if (point.at <= timeMs) {
      prevIndex = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }

  if (prevIndex < 0 || prevIndex >= actions.length - 1) return null;
  const prev = actions[prevIndex];
  const next = actions[prevIndex + 1];
  if (!prev || !next) return null;
  return { prev, next };
}

function computeVibrationIntensity(
  actions: FunscriptAction[],
  timeMs: number,
  sensitivity: number
): number {
  const segment = getActionSegment(actions, timeMs);
  if (!segment) return 0;
  const { prev, next } = segment;
  const deltaMs = next.at - prev.at;
  if (deltaMs <= 0) return 0;
  const deltaPos = Math.abs(next.pos - prev.pos);
  const speedPerSec = (deltaPos / deltaMs) * 1000;
  const effectiveMax =
    INTIFACE_MAX_VIBE_SPEED_POS_PER_SEC / Math.max(0.01, sensitivity || 1);
  return Math.max(0, Math.min(1, speedPerSec / effectiveMax));
}

export const intifaceAdapter: HapticsRuntimeAdapter<IntifaceHapticsSession> = {
  provider: "intiface",

  async verifyConnection(config): Promise<HapticsConnectionResult> {
    const intifaceConfig = requireIntifaceConfig(config);
    let client: IntifaceClient | null = null;
    try {
      const result = await connectClient(config);
      client = result.client;
      if (!result.selected) {
        return {
          success: false,
          provider: "intiface",
          message:
            "Intiface connected, but no position- or vibration-capable device was found.",
        };
      }
      return {
        success: true,
        provider: "intiface",
        deviceType: "Intiface",
        deviceName: result.selected.device.name ?? intifaceConfig.deviceName ?? null,
        deviceIndex: result.selected.index,
      };
    } catch (error) {
      return {
        success: false,
        provider: "intiface",
        message: error instanceof Error ? error.message : "Failed to connect to Intiface.",
      };
    } finally {
      if (client) {
        await client.disconnect().catch(() => undefined);
      }
    }
  },

  async createSession(config): Promise<IntifaceHapticsSession> {
    const intifaceConfig = requireIntifaceConfig(config);
    const result = await connectClient(config);
    if (!result.selected) {
      await result.client.disconnect().catch(() => undefined);
      throw new Error(
        "Intiface connected, but no position- or vibration-capable device was found."
      );
    }

    return {
      provider: "intiface",
      expiresAtMs: Date.now() + INTIFACE_SESSION_TTL_MS,
      client: result.client,
      device: result.selected.device,
      deviceMode: result.selected.mode,
      deviceName: result.selected.device.name ?? intifaceConfig.deviceName ?? null,
      deviceIndex: result.selected.index,
      loadedScriptId: null,
      actions: [],
      sourceId: null,
      lastCommandAtMs: 0,
      lastCommandedTimeMs: null,
      lastPlaybackRate: null,
      lastPosition: null,
      lastIntensity: null,
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
    session.lastIntensity = null;
    session.lastTargetActionAt = null;
  },

  async sendSync(config, session, timeMs, playbackRate, sourceId, actions): Promise<void> {
    const module = await loadButtplug();
    const intifaceConfig = requireIntifaceConfig(config);
    const id = scriptId(sourceId, actions);
    if (session.loadedScriptId !== id) {
      await intifaceAdapter.preloadScript(config, session, sourceId, actions);
    }
    const activeActions = session.actions.length > 0 ? session.actions : actions;
    const rate = Math.max(0.25, Math.min(3, playbackRate));

    if (session.deviceMode === "vibrate") {
      const intensity = computeVibrationIntensity(
        activeActions,
        timeMs,
        intifaceConfig.vibrationSensitivity
      );
      if (!shouldSendVibrationCommand(session, intensity, rate)) return;
      await runVibrationCommand(module, session.device, intensity);
      session.lastCommandAtMs = Date.now();
      session.lastCommandedTimeMs = timeMs;
      session.lastPlaybackRate = rate;
      session.lastIntensity = intensity;
      session.lastTargetActionAt = null;
      return;
    }

    const nextAction = getNextAction(activeActions, timeMs);
    if (!nextAction) return;
    if (!shouldSendPositionCommand(session, timeMs, rate, nextAction.at)) return;

    const position = applyStroke(nextAction.pos, intifaceConfig.stroke);
    const durationMs = (nextAction.at - timeMs) / rate;

    await runPositionCommand(module, session.device, position, durationMs);
    session.lastCommandAtMs = Date.now();
    session.lastCommandedTimeMs = timeMs;
    session.lastPlaybackRate = rate;
    session.lastPosition = position;
    session.lastIntensity = null;
    session.lastTargetActionAt = nextAction.at;
  },

  async pausePlayback(_config, session): Promise<void> {
    await session?.device.stop?.().catch(() => undefined);
  },

  async resumePlayback(config, session, resumeAtMs, playbackRate = 1): Promise<void> {
    if (!session.sourceId || session.actions.length === 0) return;
    await intifaceAdapter.sendSync(
      config,
      session,
      resumeAtMs,
      playbackRate,
      session.sourceId,
      session.actions
    );
  },

  async stopPlayback(_config, session): Promise<void> {
    if (!session) return;
    session.loadedScriptId = null;
    session.actions = [];
    session.sourceId = null;
    session.lastCommandAtMs = 0;
    session.lastCommandedTimeMs = null;
    session.lastPlaybackRate = null;
    session.lastPosition = null;
    session.lastIntensity = null;
    session.lastTargetActionAt = null;
    await session.device.stop?.().catch(() => undefined);
  },

  async disconnect(_config, session): Promise<void> {
    if (!session) return;
    await session.device.stop?.().catch(() => undefined);
    await session.client.disconnect().catch(() => undefined);
  },

  async getStroke(config): Promise<HapticsStrokeState> {
    return normalizeHandyStrokeState(requireIntifaceConfig(config).stroke);
  },

  async updateStroke(_config, stroke): Promise<HapticsStrokeState> {
    return normalizeHandyStrokeState(stroke);
  },
};

export { DEFAULT_INTIFACE_URL };
