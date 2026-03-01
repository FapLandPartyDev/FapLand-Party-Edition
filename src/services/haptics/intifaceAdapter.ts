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
  };
  OutputType?: {
    Position?: unknown;
    Linear?: unknown;
    HwPositionWithDuration?: unknown;
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
  features?: unknown;
};

export type IntifaceHapticsSession = HapticsSession & {
  provider: "intiface";
  client: IntifaceClient;
  device: IntifaceDevice;
  deviceName: string | null;
  deviceIndex: number | null;
  loadedScriptId: string | null;
  actions: FunscriptAction[];
  sourceId: string | null;
  lastCommandAtMs: number;
  lastCommandedTimeMs: number | null;
  lastPlaybackRate: number | null;
  lastPosition: number | null;
  lastTargetActionAt: number | null;
};

const INTIFACE_CLIENT_NAME = "Fap Land";
const INTIFACE_SESSION_TTL_MS = 60 * 60_000;
const INTIFACE_SCAN_MS = 2500;
const INTIFACE_MIN_MOVE_MS = 0;
const INTIFACE_MAX_MOVE_MS = 5000;
const DEFAULT_INTIFACE_URL = "ws://127.0.0.1:12345";

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

function isPositionCapable(module: ButtplugModule, device: IntifaceDevice): boolean {
  if (typeof device.positionWithDuration === "function" || typeof device.linear === "function") {
    return true;
  }
  if (typeof device.hasOutput !== "function") return false;
  return outputValues(module).some((outputType) => {
    try {
      return device.hasOutput?.(outputType) === true;
    } catch {
      return false;
    }
  });
}

function selectPositionDevice(
  module: ButtplugModule,
  client: IntifaceClient,
  preferredIndex: number | null
): { index: number; device: IntifaceDevice } | null {
  const devices = getClientDevices(client);
  const capable = devices.filter(({ device }) => isPositionCapable(module, device));
  if (capable.length === 0) return null;
  if (preferredIndex !== null) {
    const preferred = capable.find(({ index }) => index === preferredIndex);
    if (preferred) return preferred;
  }
  return capable[0] ?? null;
}

async function connectClient(config: HapticsConnectionConfig): Promise<{
  module: ButtplugModule;
  client: IntifaceClient;
  selected: { index: number; device: IntifaceDevice } | null;
}> {
  const intifaceConfig = requireIntifaceConfig(config);
  const module = await loadButtplug();
  const client = new module.ButtplugClient(INTIFACE_CLIENT_NAME);
  const connector = new module.ButtplugBrowserWebsocketClientConnector(getWebsocketUrl(config));
  await client.connect(connector);

  let selected = selectPositionDevice(module, client, intifaceConfig.deviceIndex);
  if (!selected && typeof client.startScanning === "function") {
    await client.startScanning();
    await new Promise((resolve) => globalThis.setTimeout(resolve, INTIFACE_SCAN_MS));
    await client.stopScanning?.().catch(() => undefined);
    selected = selectPositionDevice(module, client, intifaceConfig.deviceIndex);
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

async function runPositionCommand(
  module: ButtplugModule,
  device: IntifaceDevice,
  position: number,
  durationMs: number
): Promise<void> {
  const clampedPosition = Math.max(0, Math.min(1, position));
  const clampedDuration = clampDurationMs(durationMs);
  const supportsOutput = (outputType: unknown): boolean => {
    if (outputType === undefined || typeof device.hasOutput !== "function") return false;
    try {
      return device.hasOutput(outputType) === true;
    } catch {
      return false;
    }
  };
  const supportsPositionWithDuration =
    supportsOutput(module.OutputType?.HwPositionWithDuration) ||
    supportsOutput("HwPositionWithDuration");
  const supportsPosition =
    supportsOutput(module.OutputType?.Position) || supportsOutput("Position");

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
            "Intiface connected, but no linear/position-capable device was found. Vibrator-only devices are not supported for funscript playback.",
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
        "Intiface connected, but no linear/position-capable device was found. Vibrator-only devices are not supported for funscript playback."
      );
    }

    return {
      provider: "intiface",
      expiresAtMs: Date.now() + INTIFACE_SESSION_TTL_MS,
      client: result.client,
      device: result.selected.device,
      deviceName: result.selected.device.name ?? intifaceConfig.deviceName ?? null,
      deviceIndex: result.selected.index,
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
    const module = await loadButtplug();
    const id = scriptId(sourceId, actions);
    if (session.loadedScriptId !== id) {
      await intifaceAdapter.preloadScript(config, session, sourceId, actions);
    }
    const activeActions = session.actions.length > 0 ? session.actions : actions;

    const nextAction = getNextAction(activeActions, timeMs);
    if (!nextAction) return;

    const rate = Math.max(0.25, Math.min(3, playbackRate));
    if (!shouldSendPositionCommand(session, timeMs, rate, nextAction.at)) return;

    const position = applyStroke(nextAction.pos, requireIntifaceConfig(config).stroke);
    const durationMs = (nextAction.at - timeMs) / rate;

    await runPositionCommand(module, session.device, position, durationMs);
    session.lastCommandAtMs = Date.now();
    session.lastCommandedTimeMs = timeMs;
    session.lastPlaybackRate = rate;
    session.lastPosition = position;
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
