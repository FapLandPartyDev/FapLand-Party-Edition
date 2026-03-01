import type { FunscriptAction } from "../../game/media/playback";

export type HapticsProviderId = "thehandy" | "intiface" | "tcode";
export type TCodeTransportKind = "serial" | "websocket";
export type TCodePrecision = 3 | 4;
export type TCodeAxis = "L0";

export type HapticsSyncState = "disconnected" | "connecting" | "missing-key" | "synced" | "error";

export type HapticsStrokeState = {
  min: number;
  max: number;
  minAbsolute: number | null;
  maxAbsolute: number | null;
};

export type HapticsConnectionResult = {
  success: boolean;
  provider: HapticsProviderId;
  deviceType?: string;
  firmwareVersion?: string;
  unsupportedFirmware?: boolean;
  deviceName?: string | null;
  deviceIndex?: number | null;
  message?: string;
};

export type HapticsConnectionConfig =
  | {
      provider: "thehandy";
      connectionKey: string;
      appApiKey: string;
      appApiKeyOverride: string;
      localIp: string;
    }
  | {
      provider: "intiface";
      websocketUrl: string;
      deviceName: string | null;
      deviceIndex: number | null;
      stroke: HapticsStrokeState;
      vibrationSensitivity: number;
    }
  | {
      provider: "tcode";
      transport: TCodeTransportKind;
      serialPath: string;
      baudRate: number;
      websocketHost: string;
      websocketUrl: string;
      precision: TCodePrecision;
      axis: TCodeAxis;
      stroke: HapticsStrokeState;
    };

export type HapticsSession = {
  provider: HapticsProviderId;
  expiresAtMs: number;
};

export type DeviceSlotConfig = {
  id: string;
  label: string;
  enabled: boolean;
  config: HapticsConnectionConfig;
  stroke: HapticsStrokeState;
  offsetMs: number;
};

export type DeviceSlotStatus = {
  connected: boolean;
  connecting: boolean;
  error: string | null;
  deviceName: string | null;
  synced: boolean;
  syncError: string | null;
};

export type HapticsRuntimeAdapter<TSession extends HapticsSession> = {
  provider: HapticsProviderId;
  verifyConnection(config: HapticsConnectionConfig): Promise<HapticsConnectionResult>;
  createSession(config: HapticsConnectionConfig): Promise<TSession>;
  preloadScript(
    config: HapticsConnectionConfig,
    session: TSession,
    sourceId: string,
    actions: FunscriptAction[],
    skipToMs?: number
  ): Promise<void>;
  sendSync(
    config: HapticsConnectionConfig,
    session: TSession,
    timeMs: number,
    playbackRate: number,
    sourceId: string,
    actions: FunscriptAction[]
  ): Promise<void>;
  pausePlayback(config: HapticsConnectionConfig, session: TSession | null): Promise<void>;
  resumePlayback(
    config: HapticsConnectionConfig,
    session: TSession,
    resumeAtMs: number,
    playbackRate?: number
  ): Promise<void>;
  stopPlayback(config: HapticsConnectionConfig, session: TSession | null): Promise<void>;
  disconnect?(config: HapticsConnectionConfig, session: TSession | null): Promise<void>;
  getStroke?(config: HapticsConnectionConfig): Promise<HapticsStrokeState>;
  updateStroke?(
    config: HapticsConnectionConfig,
    stroke: Pick<HapticsStrokeState, "min" | "max">
  ): Promise<HapticsStrokeState>;
};
