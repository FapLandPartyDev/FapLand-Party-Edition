import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  THEHANDY_APP_API_KEY_OVERRIDE_STORE_KEY,
  THEHANDY_OFFSET_MS_STORE_KEY,
} from "../constants/theHandy";
import {
  HAPTICS_TEST_ACTIONS,
  HAPTICS_TEST_PERIOD_MS,
  HAPTICS_TEST_SOURCE_ID,
  HAPTICS_TEST_TICK_MS,
} from "../constants/hapticsTest";
import {
  DEFAULT_INTIFACE_VIBRATION_SENSITIVITY,
  DEFAULT_INTIFACE_WEBSOCKET_URL,
  DEFAULT_TCODE_AXIS,
  DEFAULT_TCODE_BAUD_RATE,
  DEFAULT_TCODE_PRECISION,
  DEFAULT_TCODE_TRANSPORT,
  DEFAULT_TCODE_WEBSOCKET_HOST,
  DEFAULT_TCODE_WEBSOCKET_URL,
  HAPTICS_PROVIDER_STORE_KEY,
  INTIFACE_DEVICE_INDEX_STORE_KEY,
  INTIFACE_DEVICE_NAME_STORE_KEY,
  INTIFACE_VIBRATION_SENSITIVITY_MAX,
  INTIFACE_VIBRATION_SENSITIVITY_MIN,
  INTIFACE_VIBRATION_SENSITIVITY_STORE_KEY,
  INTIFACE_WEBSOCKET_URL_STORE_KEY,
  TCODE_AXIS_STORE_KEY,
  TCODE_BAUD_RATE_STORE_KEY,
  TCODE_PRECISION_STORE_KEY,
  TCODE_SERIAL_PATH_STORE_KEY,
  TCODE_TRANSPORT_STORE_KEY,
  TCODE_WEBSOCKET_HOST_STORE_KEY,
  TCODE_WEBSOCKET_URL_STORE_KEY,
  HAPTICS_DEVICE_SLOTS_STORE_KEY,
} from "../constants/haptics";
import {
  normalizeHandyAppApiKeyOverride,
  getHandyStrokeFromBounds,
  normalizeHandyStrokeState,
  getHandyStrokePercent,
  normalizeHandyOffsetMs,
  resolveHandyAppApiKey,
  type HandyStrokeState,
} from "../services/theHandyConfig";
import {
  createHapticsSession,
  disconnectHapticsSession,
  getHapticsStroke,
  sendHapticsSync,
  stopHapticsPlayback,
  updateHapticsStroke,
  verifyHapticsConnection,
  type AnyHapticsSession,
  type HapticsConnectionConfig,
  type HapticsDeviceTarget,
  type HapticsTargetConfig,
} from "../services/haptics/runtime";
import {
  normalizeTCodeAxis,
  normalizeTCodeBaudRate,
  normalizeTCodePrecision,
  normalizeTCodeTransport,
  normalizeTCodeWebSocketInput,
} from "../services/haptics/tcodeConfig";
import type {
  HapticsProviderId,
  DeviceSlotConfig,
  TCodeAxis,
  TCodePrecision,
  TCodeTransportKind,
} from "../services/haptics/types";
import { trpc } from "../services/trpc";

type HapticsContextType = {
  deviceSlots: DeviceSlotConfig[];
  activeDeviceTargets: HapticsDeviceTarget[];
  selectedDeviceId: string | null;
  selectDevice: (id: string) => void;
  removeDevice: (id: string) => Promise<void>;
  provider: HapticsProviderId;
  setProvider: (provider: HapticsProviderId) => Promise<void>;
  connectionKey: string;
  appApiKey: string;
  appApiKeyOverride: string;
  isUsingDefaultAppApiKey: boolean;
  localIp: string;
  intifaceWebsocketUrl: string;
  intifaceDeviceName: string | null;
  intifaceDeviceIndex: number | null;
  intifaceVibrationSensitivity: number;
  setIntifaceVibrationSensitivity: (value: number) => void;
  tcodeTransport: TCodeTransportKind;
  tcodeSerialPath: string;
  tcodeBaudRate: number;
  tcodeWebsocketHost: string;
  tcodeWebsocketUrl: string;
  tcodePrecision: TCodePrecision;
  tcodeAxis: TCodeAxis;
  tcodeSerialPorts: Array<{ path: string; manufacturer: string | null }>;
  tcodeSerialPortsLoading: boolean;
  offsetMs: number;
  strokeMin: number;
  strokeMax: number;
  strokePercent: number;
  strokeLoading: boolean;
  strokeError: string | null;
  connected: boolean;
  manuallyStopped: boolean;
  synced: boolean;
  syncError: string | null;
  testDeviceStarting: boolean;
  testDeviceRunning: boolean;
  testDeviceStartedAtMs: number | null;
  testDeviceError: string | null;
  isConnecting: boolean;
  error: string | null;
  connect: (key: string, ip?: string, apiKeyOverride?: string) => Promise<boolean>;
  connectIntiface: (websocketUrl?: string, deviceIndex?: number | null) => Promise<boolean>;
  connectTCode: (
    input?: Partial<{
      transport: TCodeTransportKind;
      serialPath: string;
      baudRate: number;
      websocketInput: string;
      precision: TCodePrecision;
      axis: TCodeAxis;
    }>
  ) => Promise<boolean>;
  refreshTCodeSerialPorts: () => Promise<void>;
  autoDetectTCodeSerialPort: (baudRate?: number) => Promise<string | null>;
  abortConnect: () => void;
  reconnect: () => Promise<boolean>;
  disconnect: () => Promise<void>;
  forceStop: () => Promise<void>;
  toggleManualStop: () => Promise<"stopped" | "resumed" | "unavailable">;
  setSyncStatus: (next: { synced: boolean; error?: string | null }) => void;
  adjustOffset: (deltaMs: number) => Promise<number>;
  resetOffset: () => Promise<void>;
  setResourceOffsetOverride: (offsetMs: number | null) => void;
  startTestDevice: () => Promise<void>;
  stopTestDevice: () => Promise<void>;
  refreshStroke: () => Promise<void>;
  setStrokePercent: (percent: number) => Promise<void>;
  setStrokeBounds: (minPercent: number, maxPercent: number) => Promise<void>;
  resetStroke: () => Promise<void>;
};

const CONNECTION_KEY_STORE_KEY = "connectionKey";
const LOCAL_IP_STORE_KEY = "localIp";

const HapticsContext = createContext<HapticsContextType | undefined>(undefined);
const DEFAULT_STROKE_STATE = normalizeHandyStrokeState({ min: 0, max: 1 });

function normalizeDeviceSlots(value: unknown): DeviceSlotConfig[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry): DeviceSlotConfig[] => {
    if (!entry || typeof entry !== "object") return [];
    const candidate = entry as Partial<DeviceSlotConfig>;
    const config = candidate.config as HapticsConnectionConfig | undefined;
    if (
      typeof candidate.id !== "string" ||
      !config ||
      !["thehandy", "intiface", "tcode"].includes(config.provider)
    ) {
      return [];
    }
    return [
      {
        id: candidate.id,
        label:
          typeof candidate.label === "string" && candidate.label.trim()
            ? candidate.label.trim()
            : config.provider === "thehandy"
              ? "TheHandy"
              : config.provider === "intiface"
                ? "Intiface device"
                : "TCode device",
        enabled: candidate.enabled !== false,
        config,
        stroke: normalizeHandyStrokeState(candidate.stroke),
        offsetMs: normalizeHandyOffsetMs(candidate.offsetMs),
      },
    ];
  });
}

async function saveDeviceSlotsToStore(slots: DeviceSlotConfig[]): Promise<void> {
  await trpc.store.set.mutate({ key: HAPTICS_DEVICE_SLOTS_STORE_KEY, value: slots });
}

function normalizeProvider(value: unknown): HapticsProviderId {
  if (value === "intiface" || value === "tcode") return value;
  return "thehandy";
}

function normalizeIntifaceDeviceIndex(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? Math.floor(parsed) : null;
}

function normalizeIntifaceVibrationSensitivity(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_INTIFACE_VIBRATION_SENSITIVITY;
  return Math.max(
    INTIFACE_VIBRATION_SENSITIVITY_MIN,
    Math.min(INTIFACE_VIBRATION_SENSITIVITY_MAX, parsed)
  );
}

function normalizeNullableString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

async function loadFromStore(): Promise<{
  provider: HapticsProviderId;
  connectionKey: string;
  appApiKeyOverride: string;
  localIp: string;
  intifaceWebsocketUrl: string;
  intifaceDeviceName: string | null;
  intifaceDeviceIndex: number | null;
  intifaceVibrationSensitivity: number;
  tcodeTransport: TCodeTransportKind;
  tcodeSerialPath: string;
  tcodeBaudRate: number;
  tcodeWebsocketHost: string;
  tcodeWebsocketUrl: string;
  tcodePrecision: TCodePrecision;
  tcodeAxis: TCodeAxis;
  offsetMs: number;
  deviceSlots: DeviceSlotConfig[];
}> {
  try {
    const [
      provider,
      connectionKey,
      appApiKeyOverride,
      localIp,
      intifaceWebsocketUrl,
      intifaceDeviceName,
      intifaceDeviceIndex,
      intifaceVibrationSensitivity,
      tcodeTransport,
      tcodeSerialPath,
      tcodeBaudRate,
      tcodeWebsocketHost,
      tcodeWebsocketUrl,
      tcodePrecision,
      tcodeAxis,
      offsetMs,
      rawDeviceSlots,
    ] = await Promise.all([
      trpc.store.get.query({ key: HAPTICS_PROVIDER_STORE_KEY }),
      trpc.store.get.query({ key: CONNECTION_KEY_STORE_KEY }),
      trpc.store.get.query({ key: THEHANDY_APP_API_KEY_OVERRIDE_STORE_KEY }),
      trpc.store.get.query({ key: LOCAL_IP_STORE_KEY }),
      trpc.store.get.query({ key: INTIFACE_WEBSOCKET_URL_STORE_KEY }),
      trpc.store.get.query({ key: INTIFACE_DEVICE_NAME_STORE_KEY }),
      trpc.store.get.query({ key: INTIFACE_DEVICE_INDEX_STORE_KEY }),
      trpc.store.get.query({ key: INTIFACE_VIBRATION_SENSITIVITY_STORE_KEY }),
      trpc.store.get.query({ key: TCODE_TRANSPORT_STORE_KEY }),
      trpc.store.get.query({ key: TCODE_SERIAL_PATH_STORE_KEY }),
      trpc.store.get.query({ key: TCODE_BAUD_RATE_STORE_KEY }),
      trpc.store.get.query({ key: TCODE_WEBSOCKET_HOST_STORE_KEY }),
      trpc.store.get.query({ key: TCODE_WEBSOCKET_URL_STORE_KEY }),
      trpc.store.get.query({ key: TCODE_PRECISION_STORE_KEY }),
      trpc.store.get.query({ key: TCODE_AXIS_STORE_KEY }),
      trpc.store.get.query({ key: THEHANDY_OFFSET_MS_STORE_KEY }),
      trpc.store.get.query({ key: HAPTICS_DEVICE_SLOTS_STORE_KEY }),
    ]);
    const savedTCodeWebSocket = normalizeTCodeWebSocketInput(
      typeof tcodeWebsocketHost === "string" && tcodeWebsocketHost.trim().length > 0
        ? tcodeWebsocketHost
        : tcodeWebsocketUrl
    );
    return {
      provider: normalizeProvider(provider),
      connectionKey: (connectionKey as string | undefined) ?? "",
      appApiKeyOverride: normalizeHandyAppApiKeyOverride(appApiKeyOverride as string | undefined),
      localIp: (localIp as string | undefined) ?? "",
      intifaceWebsocketUrl:
        typeof intifaceWebsocketUrl === "string" && intifaceWebsocketUrl.trim().length > 0
          ? intifaceWebsocketUrl.trim()
          : DEFAULT_INTIFACE_WEBSOCKET_URL,
      intifaceDeviceName: normalizeNullableString(intifaceDeviceName),
      intifaceDeviceIndex: normalizeIntifaceDeviceIndex(intifaceDeviceIndex),
      intifaceVibrationSensitivity: normalizeIntifaceVibrationSensitivity(
        intifaceVibrationSensitivity
      ),
      tcodeTransport: normalizeTCodeTransport(tcodeTransport),
      tcodeSerialPath: typeof tcodeSerialPath === "string" ? tcodeSerialPath.trim() : "",
      tcodeBaudRate: normalizeTCodeBaudRate(tcodeBaudRate),
      tcodeWebsocketHost: savedTCodeWebSocket.host,
      tcodeWebsocketUrl: savedTCodeWebSocket.url,
      tcodePrecision: normalizeTCodePrecision(tcodePrecision),
      tcodeAxis: normalizeTCodeAxis(tcodeAxis),
      offsetMs: normalizeHandyOffsetMs(offsetMs),
      deviceSlots: normalizeDeviceSlots(rawDeviceSlots),
    };
  } catch (err) {
    console.warn("Could not load handy store", err);
    return {
      provider: "thehandy",
      connectionKey: "",
      appApiKeyOverride: "",
      localIp: "",
      intifaceWebsocketUrl: DEFAULT_INTIFACE_WEBSOCKET_URL,
      intifaceDeviceName: null,
      intifaceDeviceIndex: null,
      intifaceVibrationSensitivity: DEFAULT_INTIFACE_VIBRATION_SENSITIVITY,
      tcodeTransport: DEFAULT_TCODE_TRANSPORT,
      tcodeSerialPath: "",
      tcodeBaudRate: DEFAULT_TCODE_BAUD_RATE,
      tcodeWebsocketHost: DEFAULT_TCODE_WEBSOCKET_HOST,
      tcodeWebsocketUrl: DEFAULT_TCODE_WEBSOCKET_URL,
      tcodePrecision: DEFAULT_TCODE_PRECISION,
      tcodeAxis: DEFAULT_TCODE_AXIS,
      offsetMs: 0,
      deviceSlots: [],
    };
  }
}

async function saveToStore(key: string, apiKeyOverride: string, ip: string): Promise<void> {
  try {
    await Promise.all([
      trpc.store.set.mutate({ key: CONNECTION_KEY_STORE_KEY, value: key }),
      trpc.store.set.mutate({
        key: THEHANDY_APP_API_KEY_OVERRIDE_STORE_KEY,
        value: normalizeHandyAppApiKeyOverride(apiKeyOverride),
      }),
      trpc.store.set.mutate({ key: LOCAL_IP_STORE_KEY, value: ip }),
    ]);
  } catch (err) {
    console.error("Failed to save to store", err);
  }
}

async function saveProviderToStore(provider: HapticsProviderId): Promise<void> {
  try {
    await trpc.store.set.mutate({ key: HAPTICS_PROVIDER_STORE_KEY, value: provider });
  } catch (err) {
    console.error("Failed to save haptics provider", err);
  }
}

async function saveIntifaceToStore(
  websocketUrl: string,
  deviceName: string | null,
  deviceIndex: number | null,
  vibrationSensitivity: number
): Promise<void> {
  try {
    await Promise.all([
      trpc.store.set.mutate({ key: INTIFACE_WEBSOCKET_URL_STORE_KEY, value: websocketUrl }),
      trpc.store.set.mutate({ key: INTIFACE_DEVICE_NAME_STORE_KEY, value: deviceName }),
      trpc.store.set.mutate({ key: INTIFACE_DEVICE_INDEX_STORE_KEY, value: deviceIndex }),
      trpc.store.set.mutate({
        key: INTIFACE_VIBRATION_SENSITIVITY_STORE_KEY,
        value: normalizeIntifaceVibrationSensitivity(vibrationSensitivity),
      }),
    ]);
  } catch (err) {
    console.error("Failed to save Intiface settings", err);
  }
}

async function saveTCodeToStore(input: {
  transport: TCodeTransportKind;
  serialPath: string;
  baudRate: number;
  websocketHost: string;
  websocketUrl: string;
  precision: TCodePrecision;
  axis: TCodeAxis;
}): Promise<void> {
  try {
    await Promise.all([
      trpc.store.set.mutate({ key: TCODE_TRANSPORT_STORE_KEY, value: input.transport }),
      trpc.store.set.mutate({ key: TCODE_SERIAL_PATH_STORE_KEY, value: input.serialPath }),
      trpc.store.set.mutate({ key: TCODE_BAUD_RATE_STORE_KEY, value: input.baudRate }),
      trpc.store.set.mutate({ key: TCODE_WEBSOCKET_HOST_STORE_KEY, value: input.websocketHost }),
      trpc.store.set.mutate({ key: TCODE_WEBSOCKET_URL_STORE_KEY, value: input.websocketUrl }),
      trpc.store.set.mutate({ key: TCODE_PRECISION_STORE_KEY, value: input.precision }),
      trpc.store.set.mutate({ key: TCODE_AXIS_STORE_KEY, value: input.axis }),
    ]);
  } catch (err) {
    console.error("Failed to save TCode settings", err);
  }
}

export const HapticsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [deviceSlots, setDeviceSlots] = useState<DeviceSlotConfig[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);
  const [provider, setProviderState] = useState<HapticsProviderId>("thehandy");
  const [connectionKey, setConnectionKey] = useState("");
  const [appApiKeyOverride, setAppApiKeyOverride] = useState("");
  const [localIp, setLocalIp] = useState("");
  const [intifaceWebsocketUrl, setIntifaceWebsocketUrl] = useState(DEFAULT_INTIFACE_WEBSOCKET_URL);
  const [intifaceDeviceName, setIntifaceDeviceName] = useState<string | null>(null);
  const [intifaceDeviceIndex, setIntifaceDeviceIndex] = useState<number | null>(null);
  const [intifaceVibrationSensitivity, setIntifaceVibrationSensitivity] = useState(
    DEFAULT_INTIFACE_VIBRATION_SENSITIVITY
  );
  const [tcodeTransport, setTCodeTransport] = useState<TCodeTransportKind>(DEFAULT_TCODE_TRANSPORT);
  const [tcodeSerialPath, setTCodeSerialPath] = useState("");
  const [tcodeBaudRate, setTCodeBaudRate] = useState(DEFAULT_TCODE_BAUD_RATE);
  const [tcodeWebsocketHost, setTCodeWebsocketHost] = useState(DEFAULT_TCODE_WEBSOCKET_HOST);
  const [tcodeWebsocketUrl, setTCodeWebsocketUrl] = useState(DEFAULT_TCODE_WEBSOCKET_URL);
  const [tcodePrecision, setTCodePrecision] = useState<TCodePrecision>(DEFAULT_TCODE_PRECISION);
  const [tcodeAxis, setTCodeAxis] = useState<TCodeAxis>(DEFAULT_TCODE_AXIS);
  const [tcodeSerialPorts, setTCodeSerialPorts] = useState<
    Array<{ path: string; manufacturer: string | null }>
  >([]);
  const [tcodeSerialPortsLoading, setTCodeSerialPortsLoading] = useState(false);
  const [globalOffsetMs, setGlobalOffsetMs] = useState(0);
  const [resourceOffsetOverrideMs, setResourceOffsetOverrideMs] = useState<number | null>(null);
  const [strokeState, setStrokeState] = useState<HandyStrokeState>(DEFAULT_STROKE_STATE);
  const [activeSession, setActiveSession] = useState<AnyHapticsSession | null>(null);
  const [strokeLoading, setStrokeLoading] = useState(false);
  const [strokeError, setStrokeError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [manuallyStopped, setManuallyStopped] = useState(false);
  const [synced, setSynced] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [testDeviceStarting, setTestDeviceStarting] = useState(false);
  const [testDeviceRunning, setTestDeviceRunning] = useState(false);
  const [testDeviceStartedAtMs, setTestDeviceStartedAtMs] = useState<number | null>(null);
  const [testDeviceError, setTestDeviceError] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const userMutatedStateRef = useRef(false);
  const testDeviceTimerRef = useRef<ReturnType<typeof globalThis.setInterval> | null>(null);
  const testDeviceSessionRef = useRef<AnyHapticsSession | null>(null);
  const testDeviceTickBusyRef = useRef(false);
  const connectionAttemptIdRef = useRef(0);
  const offsetMsRef = useRef(0);

  const appApiKey = resolveHandyAppApiKey(appApiKeyOverride);
  const isUsingDefaultAppApiKey = normalizeHandyAppApiKeyOverride(appApiKeyOverride).length === 0;
  const strokePercent = getHandyStrokePercent(strokeState);
  const offsetMs = resourceOffsetOverrideMs ?? globalOffsetMs;
  const activeDeviceTargets = useMemo<HapticsDeviceTarget[]>(
    () =>
      deviceSlots
        .filter((slot) => slot.enabled)
        .map((slot) => ({
          id: slot.id,
          config:
            slot.config.provider === "intiface" || slot.config.provider === "tcode"
              ? { ...slot.config, stroke: slot.stroke }
              : slot.config,
          // Round playback already applies the selected/global offset. Child targets
          // only carry their calibration delta so the value is not applied twice.
          offsetMs: slot.offsetMs - globalOffsetMs,
        })),
    [deviceSlots, globalOffsetMs]
  );

  const rememberDevice = useCallback(
    async (
      config: HapticsConnectionConfig,
      input?: { label?: string; stroke?: HandyStrokeState }
    ): Promise<void> => {
      const identity = (candidate: HapticsConnectionConfig): string => {
        if (candidate.provider === "thehandy") return `thehandy:${candidate.connectionKey.trim()}`;
        if (candidate.provider === "intiface") {
          return `intiface:${candidate.websocketUrl.trim()}:${candidate.deviceIndex ?? "auto"}`;
        }
        return candidate.transport === "serial"
          ? `tcode:serial:${candidate.serialPath.trim()}`
          : `tcode:websocket:${candidate.websocketUrl.trim()}`;
      };
      const key = identity(config);
      const nextStroke = normalizeHandyStrokeState(input?.stroke ?? strokeState);
      const existing = deviceSlots.find((slot) => identity(slot.config) === key);
      const slot: DeviceSlotConfig = {
        id: existing?.id ?? globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`,
        label:
          input?.label ??
          (config.provider === "thehandy"
            ? "TheHandy"
            : config.provider === "intiface"
              ? (config.deviceName ?? "Intiface device")
              : "TCode device"),
        enabled: true,
        config,
        stroke: nextStroke,
        offsetMs: existing?.offsetMs ?? globalOffsetMs,
      };
      const saved = existing
        ? deviceSlots.map((candidate) => (candidate.id === existing.id ? slot : candidate))
        : [...deviceSlots, slot];
      setDeviceSlots(saved);
      setSelectedDeviceId(slot.id);
      await saveDeviceSlotsToStore(saved).catch((err) => {
        console.error("Failed to save haptics devices", err);
      });
    },
    [deviceSlots, globalOffsetMs, strokeState]
  );

  const removeDevice = useCallback(
    async (id: string): Promise<void> => {
      const saved = deviceSlots.filter((slot) => slot.id !== id);
      setDeviceSlots(saved);
      if (selectedDeviceId === id) setSelectedDeviceId(saved[0]?.id ?? null);
      setConnected(saved.some((slot) => slot.enabled));
      await saveDeviceSlotsToStore(saved).catch((err) => {
        console.error("Failed to save haptics devices", err);
      });
    },
    [deviceSlots, selectedDeviceId]
  );

  const selectDevice = useCallback(
    (id: string): void => {
      const slot = deviceSlots.find((candidate) => candidate.id === id);
      if (!slot) return;
      setSelectedDeviceId(id);
      setProviderState(slot.config.provider);
      setStrokeState(slot.stroke);
      setGlobalOffsetMs(slot.offsetMs);
      if (slot.config.provider === "thehandy") {
        setConnectionKey(slot.config.connectionKey);
        setAppApiKeyOverride(slot.config.appApiKeyOverride);
        setLocalIp(slot.config.localIp);
      } else if (slot.config.provider === "intiface") {
        setIntifaceWebsocketUrl(slot.config.websocketUrl);
        setIntifaceDeviceName(slot.config.deviceName);
        setIntifaceDeviceIndex(slot.config.deviceIndex);
        setIntifaceVibrationSensitivity(slot.config.vibrationSensitivity);
      } else {
        setTCodeTransport(slot.config.transport);
        setTCodeSerialPath(slot.config.serialPath);
        setTCodeBaudRate(slot.config.baudRate);
        setTCodeWebsocketHost(slot.config.websocketHost);
        setTCodeWebsocketUrl(slot.config.websocketUrl);
        setTCodePrecision(slot.config.precision);
        setTCodeAxis(slot.config.axis);
      }
    },
    [deviceSlots]
  );

  useEffect(() => {
    offsetMsRef.current = offsetMs;
  }, [offsetMs]);

  const getConnectionConfig = useCallback(
    (
      override?: Partial<{
        provider: HapticsProviderId;
        connectionKey: string;
        appApiKey: string;
        appApiKeyOverride: string;
        localIp: string;
        intifaceWebsocketUrl: string;
        intifaceDeviceName: string | null;
        intifaceDeviceIndex: number | null;
        intifaceVibrationSensitivity: number;
        tcodeTransport: TCodeTransportKind;
        tcodeSerialPath: string;
        tcodeBaudRate: number;
        tcodeWebsocketHost: string;
        tcodeWebsocketUrl: string;
        tcodePrecision: TCodePrecision;
        tcodeAxis: TCodeAxis;
        strokeState: HandyStrokeState;
      }>
    ): HapticsConnectionConfig => {
      const effectiveProvider = override?.provider ?? provider;
      if (effectiveProvider === "intiface") {
        return {
          provider: "intiface",
          websocketUrl: override?.intifaceWebsocketUrl ?? intifaceWebsocketUrl,
          deviceName: override?.intifaceDeviceName ?? intifaceDeviceName,
          deviceIndex: override?.intifaceDeviceIndex ?? intifaceDeviceIndex,
          stroke: override?.strokeState ?? strokeState,
          vibrationSensitivity:
            override?.intifaceVibrationSensitivity ?? intifaceVibrationSensitivity,
        };
      }
      if (effectiveProvider === "tcode") {
        return {
          provider: "tcode",
          transport: override?.tcodeTransport ?? tcodeTransport,
          serialPath: override?.tcodeSerialPath ?? tcodeSerialPath,
          baudRate: override?.tcodeBaudRate ?? tcodeBaudRate,
          websocketHost: override?.tcodeWebsocketHost ?? tcodeWebsocketHost,
          websocketUrl: override?.tcodeWebsocketUrl ?? tcodeWebsocketUrl,
          precision: override?.tcodePrecision ?? tcodePrecision,
          axis: override?.tcodeAxis ?? tcodeAxis,
          stroke: override?.strokeState ?? strokeState,
        };
      }
      return {
        provider: "thehandy",
        connectionKey: override?.connectionKey ?? connectionKey,
        appApiKey: override?.appApiKey ?? appApiKey,
        appApiKeyOverride: override?.appApiKeyOverride ?? appApiKeyOverride,
        localIp: override?.localIp ?? localIp,
      };
    },
    [
      appApiKey,
      appApiKeyOverride,
      connectionKey,
      intifaceDeviceIndex,
      intifaceDeviceName,
      intifaceVibrationSensitivity,
      intifaceWebsocketUrl,
      localIp,
      provider,
      strokeState,
      tcodeAxis,
      tcodeBaudRate,
      tcodePrecision,
      tcodeSerialPath,
      tcodeTransport,
      tcodeWebsocketHost,
      tcodeWebsocketUrl,
    ]
  );

  const getActiveConnectionConfig = useCallback((): HapticsTargetConfig => {
    if (activeDeviceTargets.length === 1) return activeDeviceTargets[0]!.config;
    if (activeDeviceTargets.length > 1) {
      return { provider: "group", devices: activeDeviceTargets };
    }
    return getConnectionConfig();
  }, [activeDeviceTargets, getConnectionConfig]);

  const refreshStroke = useCallback(
    async (authOverride?: { connectionKey?: string; appApiKey?: string }): Promise<void> => {
      const effectiveConnectionKey = authOverride?.connectionKey ?? connectionKey;
      const effectiveAppApiKey = authOverride?.appApiKey ?? appApiKey;
      const trimmedKey = effectiveConnectionKey.trim();
      const trimmedApiKey = effectiveAppApiKey.trim();

      if (provider === "thehandy" && (!trimmedKey || !trimmedApiKey)) {
        setStrokeError("Stroke settings unavailable.");
        return;
      }

      setStrokeLoading(true);
      setStrokeError(null);
      try {
        const nextStroke = await getHapticsStroke(
          provider === "thehandy"
            ? getConnectionConfig({ connectionKey: trimmedKey, appApiKey: trimmedApiKey })
            : getConnectionConfig()
        );
        setStrokeState(nextStroke);
      } catch (err) {
        setStrokeError(
          err instanceof Error ? err.message : "Failed to load haptics stroke settings."
        );
      } finally {
        setStrokeLoading(false);
      }
    },
    [appApiKey, connectionKey, getConnectionConfig, provider]
  );

  useEffect(() => {
    loadFromStore().then(
      async ({
        provider: savedProvider,
        connectionKey: savedKey,
        appApiKeyOverride: savedOverride,
        localIp: savedIp,
        intifaceWebsocketUrl: savedIntifaceUrl,
        intifaceDeviceName: savedIntifaceDeviceName,
        intifaceDeviceIndex: savedIntifaceDeviceIndex,
        intifaceVibrationSensitivity: savedIntifaceVibrationSensitivity,
        tcodeTransport: savedTCodeTransport,
        tcodeSerialPath: savedTCodeSerialPath,
        tcodeBaudRate: savedTCodeBaudRate,
        tcodeWebsocketHost: savedTCodeWebsocketHost,
        tcodeWebsocketUrl: savedTCodeWebsocketUrl,
        tcodePrecision: savedTCodePrecision,
        tcodeAxis: savedTCodeAxis,
        offsetMs: savedOffsetMs,
        deviceSlots: savedDeviceSlots,
      }) => {
        if (userMutatedStateRef.current) return;
        setProviderState(savedProvider);
        if (savedKey) setConnectionKey(savedKey);
        if (savedOverride) setAppApiKeyOverride(savedOverride);
        if (savedIp) setLocalIp(savedIp);
        setIntifaceWebsocketUrl(savedIntifaceUrl);
        setIntifaceDeviceName(savedIntifaceDeviceName);
        setIntifaceDeviceIndex(savedIntifaceDeviceIndex);
        setIntifaceVibrationSensitivity(savedIntifaceVibrationSensitivity);
        setTCodeTransport(savedTCodeTransport);
        setTCodeSerialPath(savedTCodeSerialPath);
        setTCodeBaudRate(savedTCodeBaudRate);
        setTCodeWebsocketHost(savedTCodeWebsocketHost);
        setTCodeWebsocketUrl(savedTCodeWebsocketUrl);
        setTCodePrecision(savedTCodePrecision);
        setTCodeAxis(savedTCodeAxis);
        setGlobalOffsetMs(savedOffsetMs);

        if (savedDeviceSlots.length > 0) {
          setDeviceSlots(savedDeviceSlots);
          setSelectedDeviceId(savedDeviceSlots[0]!.id);
          const enabledSlots = savedDeviceSlots.filter((slot) => slot.enabled);
          if (enabledSlots.length === 0) {
            setConnected(false);
            return;
          }
          setIsConnecting(true);
          const results = await Promise.allSettled(
            enabledSlots.map((slot) => verifyHapticsConnection(slot.config))
          );
          const successful = results.filter(
            (
              result
            ): result is PromiseFulfilledResult<
              Awaited<ReturnType<typeof verifyHapticsConnection>>
            > => result.status === "fulfilled" && result.value.success
          );
          setConnected(successful.length > 0);
          const failures = results.flatMap((result) => {
            if (result.status === "rejected") {
              return [
                result.reason instanceof Error ? result.reason.message : String(result.reason),
              ];
            }
            return result.value.success ? [] : [result.value.message ?? "Failed to connect device"];
          });
          setError(failures.length > 0 ? failures.join("; ") : null);
          setIsConnecting(false);
          return;
        }

        const effectiveAppApiKey = resolveHandyAppApiKey(savedOverride);
        if (savedProvider === "thehandy" && (!savedKey || !effectiveAppApiKey)) {
          setConnected(false);
          return;
        }
        if (savedProvider === "tcode") {
          if (savedTCodeTransport === "serial" && !savedTCodeSerialPath) {
            setConnected(false);
            return;
          }
          if (savedTCodeTransport === "websocket" && !savedTCodeWebsocketUrl) {
            setConnected(false);
            return;
          }
        }

        setIsConnecting(true);
        setError(null);
        setSyncError(null);
        setSynced(false);
        setManuallyStopped(false);

        try {
          const config: HapticsConnectionConfig =
            savedProvider === "intiface"
              ? {
                  provider: "intiface",
                  websocketUrl: savedIntifaceUrl,
                  deviceName: savedIntifaceDeviceName,
                  deviceIndex: savedIntifaceDeviceIndex,
                  stroke: DEFAULT_STROKE_STATE,
                  vibrationSensitivity: savedIntifaceVibrationSensitivity,
                }
              : savedProvider === "tcode"
                ? {
                    provider: "tcode",
                    transport: savedTCodeTransport,
                    serialPath: savedTCodeSerialPath,
                    baudRate: savedTCodeBaudRate,
                    websocketHost: savedTCodeWebsocketHost,
                    websocketUrl: savedTCodeWebsocketUrl,
                    precision: savedTCodePrecision,
                    axis: savedTCodeAxis,
                    stroke: DEFAULT_STROKE_STATE,
                  }
                : {
                    provider: "thehandy",
                    connectionKey: savedKey,
                    appApiKey: effectiveAppApiKey,
                    appApiKeyOverride: savedOverride,
                    localIp: savedIp,
                  };
          const result = await verifyHapticsConnection(config);
          if (result.success) {
            setConnected(true);
            const migratedSlot: DeviceSlotConfig = {
              id: globalThis.crypto?.randomUUID?.() ?? `legacy-${Date.now()}`,
              label:
                result.deviceName ??
                (savedProvider === "thehandy"
                  ? "TheHandy"
                  : savedProvider === "intiface"
                    ? "Intiface device"
                    : "TCode device"),
              enabled: true,
              config,
              stroke: DEFAULT_STROKE_STATE,
              offsetMs: savedOffsetMs,
            };
            setDeviceSlots([migratedSlot]);
            setSelectedDeviceId(migratedSlot.id);
            await saveDeviceSlotsToStore([migratedSlot]).catch((migrationError) => {
              console.error("Failed to migrate legacy haptics device", migrationError);
            });
            if (savedProvider === "intiface") {
              setIntifaceDeviceName(result.deviceName ?? savedIntifaceDeviceName);
              setIntifaceDeviceIndex(result.deviceIndex ?? savedIntifaceDeviceIndex);
              setStrokeState(DEFAULT_STROKE_STATE);
            } else if (savedProvider === "tcode") {
              setStrokeState(DEFAULT_STROKE_STATE);
            } else {
              await refreshStroke({
                connectionKey: savedKey,
                appApiKey: effectiveAppApiKey,
              });
            }
          } else {
            setConnected(false);
            setError(result.message ?? "Failed to connect haptics device");
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : "Failed to connect haptics device";
          setConnected(false);
          setError(message);
        } finally {
          setIsConnecting(false);
        }
      }
    );
  }, []);

  const persistOffset = useCallback(
    async (nextOffsetMs: number): Promise<number> => {
      const normalized = normalizeHandyOffsetMs(nextOffsetMs);
      setGlobalOffsetMs(normalized);
      const saved = selectedDeviceId
        ? deviceSlots.map((slot) =>
            slot.id === selectedDeviceId ? { ...slot, offsetMs: normalized } : slot
          )
        : deviceSlots;
      if (selectedDeviceId) setDeviceSlots(saved);

      try {
        await Promise.all([
          trpc.store.set.mutate({ key: THEHANDY_OFFSET_MS_STORE_KEY, value: normalized }),
          selectedDeviceId ? saveDeviceSlotsToStore(saved) : Promise.resolve(),
        ]);
      } catch (err) {
        console.error("Failed to save haptics offset", err);
      }

      return normalized;
    },
    [deviceSlots, selectedDeviceId]
  );

  const setProvider = useCallback(async (nextProvider: HapticsProviderId): Promise<void> => {
    userMutatedStateRef.current = true;
    connectionAttemptIdRef.current += 1;

    setIsConnecting(false);
    setProviderState(nextProvider);
    setError(null);
    await saveProviderToStore(nextProvider);
  }, []);

  const connect = useCallback(
    async (key: string, ip?: string, apiKeyOverride?: string): Promise<boolean> => {
      userMutatedStateRef.current = true;
      const attemptId = (connectionAttemptIdRef.current += 1);
      setIsConnecting(true);
      setProviderState("thehandy");
      setError(null);
      setSyncError(null);
      setSynced(false);
      setManuallyStopped(false);

      const nextOverride = normalizeHandyAppApiKeyOverride(apiKeyOverride ?? appApiKeyOverride);
      const nextApiKey = resolveHandyAppApiKey(nextOverride);
      const nextIp = ip ?? localIp;
      const nextKey = key;

      setConnectionKey(nextKey);
      setAppApiKeyOverride(nextOverride);
      setLocalIp(nextIp);
      await saveToStore(nextKey, nextOverride, nextIp);
      await saveProviderToStore("thehandy");

      try {
        const result = await verifyHapticsConnection({
          provider: "thehandy",
          connectionKey: nextKey,
          appApiKey: nextApiKey,
          appApiKeyOverride: nextOverride,
          localIp: nextIp,
        });
        if (attemptId !== connectionAttemptIdRef.current) return false;
        if (result.success) {
          setConnected(true);
          await rememberDevice({
            provider: "thehandy",
            connectionKey: nextKey,
            appApiKey: nextApiKey,
            appApiKeyOverride: nextOverride,
            localIp: nextIp,
          });
          await saveToStore(nextKey, nextOverride, nextIp);
          await refreshStroke({
            connectionKey: nextKey,
            appApiKey: nextApiKey,
          });
          return true;
        } else {
          setError(result.message ?? "Failed to connect to TheHandy");
          setConnected(false);
          return false;
        }
      } catch (err) {
        if (attemptId !== connectionAttemptIdRef.current) return false;
        const message = err instanceof Error ? err.message : "Failed to connect to TheHandy";
        setError(message);
        setConnected(false);
        return false;
      } finally {
        if (attemptId === connectionAttemptIdRef.current) {
          setIsConnecting(false);
        }
      }
    },
    [appApiKeyOverride, localIp, refreshStroke, rememberDevice]
  );

  const connectIntiface = useCallback(
    async (websocketUrl?: string, deviceIndexOverride?: number | null): Promise<boolean> => {
      userMutatedStateRef.current = true;
      const attemptId = (connectionAttemptIdRef.current += 1);
      const nextUrl =
        (websocketUrl ?? intifaceWebsocketUrl).trim() || DEFAULT_INTIFACE_WEBSOCKET_URL;
      const requestedDeviceIndex =
        deviceIndexOverride === undefined ? intifaceDeviceIndex : deviceIndexOverride;
      setIsConnecting(true);
      setProviderState("intiface");
      setError(null);
      setSyncError(null);
      setSynced(false);
      setManuallyStopped(false);
      setIntifaceWebsocketUrl(nextUrl);
      await saveProviderToStore("intiface");
      await saveIntifaceToStore(
        nextUrl,
        intifaceDeviceName,
        requestedDeviceIndex,
        intifaceVibrationSensitivity
      );

      try {
        const result = await verifyHapticsConnection({
          provider: "intiface",
          websocketUrl: nextUrl,
          deviceName: intifaceDeviceName,
          deviceIndex: requestedDeviceIndex,
          stroke: strokeState,
          vibrationSensitivity: intifaceVibrationSensitivity,
        });
        if (attemptId !== connectionAttemptIdRef.current) return false;
        if (result.success) {
          const nextDeviceName = result.deviceName ?? intifaceDeviceName;
          const nextDeviceIndex = result.deviceIndex ?? requestedDeviceIndex;
          setConnected(true);
          setIntifaceDeviceName(nextDeviceName);
          setIntifaceDeviceIndex(nextDeviceIndex);
          await rememberDevice(
            {
              provider: "intiface",
              websocketUrl: nextUrl,
              deviceName: nextDeviceName,
              deviceIndex: nextDeviceIndex,
              stroke: strokeState,
              vibrationSensitivity: intifaceVibrationSensitivity,
            },
            { label: nextDeviceName ?? "Intiface device" }
          );
          await saveIntifaceToStore(
            nextUrl,
            nextDeviceName,
            nextDeviceIndex,
            intifaceVibrationSensitivity
          );
          return true;
        }
        setError(result.message ?? "Failed to connect to Intiface.");
        setConnected(false);
        return false;
      } catch (err) {
        if (attemptId !== connectionAttemptIdRef.current) return false;
        const message = err instanceof Error ? err.message : "Failed to connect to Intiface.";
        setError(message);
        setConnected(false);
        return false;
      } finally {
        if (attemptId === connectionAttemptIdRef.current) {
          setIsConnecting(false);
        }
      }
    },
    [
      intifaceDeviceIndex,
      intifaceDeviceName,
      intifaceVibrationSensitivity,
      intifaceWebsocketUrl,
      rememberDevice,
      strokeState,
    ]
  );

  const refreshTCodeSerialPorts = useCallback(async (): Promise<void> => {
    setTCodeSerialPortsLoading(true);
    try {
      const { tcodeTransportRenderer } = await import("../services/haptics/tcodeTransportRenderer");
      const ports = await tcodeTransportRenderer.listPorts();
      setTCodeSerialPorts(ports ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to list TCode serial ports.");
    } finally {
      setTCodeSerialPortsLoading(false);
    }
  }, []);

  const autoDetectTCodeSerialPort = useCallback(
    async (baudRate?: number): Promise<string | null> => {
      setTCodeSerialPortsLoading(true);
      setError(null);
      try {
        const { tcodeTransportRenderer } =
          await import("../services/haptics/tcodeTransportRenderer");
        const result = await tcodeTransportRenderer.autoDetectSerialPort({
          baudRate: normalizeTCodeBaudRate(baudRate ?? tcodeBaudRate),
        });
        const ports = await tcodeTransportRenderer.listPorts();
        setTCodeSerialPorts(ports ?? []);
        if (!result.port) {
          setError(result.error ?? "Could not find a usable TCode serial port.");
          return null;
        }
        setTCodeTransport("serial");
        setTCodeSerialPath(result.port.path);
        return result.port.path;
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to auto-detect TCode serial port.");
        return null;
      } finally {
        setTCodeSerialPortsLoading(false);
      }
    },
    [tcodeBaudRate]
  );

  const connectTCode = useCallback(
    async (
      input?: Partial<{
        transport: TCodeTransportKind;
        serialPath: string;
        baudRate: number;
        websocketInput: string;
        precision: TCodePrecision;
        axis: TCodeAxis;
      }>
    ): Promise<boolean> => {
      userMutatedStateRef.current = true;
      const attemptId = (connectionAttemptIdRef.current += 1);
      const nextTransport = input?.transport ?? tcodeTransport;
      const nextSerialPath = (input?.serialPath ?? tcodeSerialPath).trim();
      const nextBaudRate = normalizeTCodeBaudRate(input?.baudRate ?? tcodeBaudRate);
      const nextPrecision = normalizeTCodePrecision(input?.precision ?? tcodePrecision);
      const nextAxis = normalizeTCodeAxis(input?.axis ?? tcodeAxis);
      let nextWebSocket: { host: string; url: string };
      try {
        nextWebSocket = normalizeTCodeWebSocketInput(
          input?.websocketInput ?? tcodeWebsocketHost ?? tcodeWebsocketUrl
        );
      } catch (err) {
        setError(err instanceof Error ? err.message : "Invalid TCode WebSocket address.");
        setConnected(false);
        return false;
      }

      setIsConnecting(true);
      setProviderState("tcode");
      setError(null);
      setSyncError(null);
      setSynced(false);
      setManuallyStopped(false);
      setTCodeTransport(nextTransport);
      setTCodeSerialPath(nextSerialPath);
      setTCodeBaudRate(nextBaudRate);
      setTCodeWebsocketHost(nextWebSocket.host);
      setTCodeWebsocketUrl(nextWebSocket.url);
      setTCodePrecision(nextPrecision);
      setTCodeAxis(nextAxis);
      await saveProviderToStore("tcode");
      await saveTCodeToStore({
        transport: nextTransport,
        serialPath: nextSerialPath,
        baudRate: nextBaudRate,
        websocketHost: nextWebSocket.host,
        websocketUrl: nextWebSocket.url,
        precision: nextPrecision,
        axis: nextAxis,
      });

      try {
        const result = await verifyHapticsConnection({
          provider: "tcode",
          transport: nextTransport,
          serialPath: nextSerialPath,
          baudRate: nextBaudRate,
          websocketHost: nextWebSocket.host,
          websocketUrl: nextWebSocket.url,
          precision: nextPrecision,
          axis: nextAxis,
          stroke: strokeState,
        });
        if (attemptId !== connectionAttemptIdRef.current) return false;
        if (result.success) {
          setConnected(true);
          setStrokeState(DEFAULT_STROKE_STATE);
          await rememberDevice({
            provider: "tcode",
            transport: nextTransport,
            serialPath: nextSerialPath,
            baudRate: nextBaudRate,
            websocketHost: nextWebSocket.host,
            websocketUrl: nextWebSocket.url,
            precision: nextPrecision,
            axis: nextAxis,
            stroke: strokeState,
          });
          return true;
        }
        setError(result.message ?? "Failed to connect to TCode device.");
        setConnected(false);
        return false;
      } catch (err) {
        if (attemptId !== connectionAttemptIdRef.current) return false;
        const message = err instanceof Error ? err.message : "Failed to connect to TCode device.";
        setError(message);
        setConnected(false);
        return false;
      } finally {
        if (attemptId === connectionAttemptIdRef.current) {
          setIsConnecting(false);
        }
      }
    },
    [
      strokeState,
      rememberDevice,
      tcodeAxis,
      tcodeBaudRate,
      tcodePrecision,
      tcodeSerialPath,
      tcodeTransport,
      tcodeWebsocketHost,
      tcodeWebsocketUrl,
    ]
  );

  const abortConnect = useCallback(() => {
    connectionAttemptIdRef.current += 1;
    setIsConnecting(false);
    setConnected(false);
    setError(null);
  }, []);

  const reconnect = useCallback(async (): Promise<boolean> => {
    if (provider === "intiface") {
      return connectIntiface(intifaceWebsocketUrl);
    }
    if (provider === "tcode") {
      return connectTCode();
    }
    return connect(connectionKey, localIp, appApiKeyOverride);
  }, [
    appApiKeyOverride,
    connect,
    connectIntiface,
    connectTCode,
    connectionKey,
    intifaceWebsocketUrl,
    localIp,
    provider,
  ]);

  const stopTestDevice = useCallback(async (): Promise<void> => {
    if (testDeviceTimerRef.current) {
      globalThis.clearInterval(testDeviceTimerRef.current);
      testDeviceTimerRef.current = null;
    }
    testDeviceTickBusyRef.current = false;
    const session = testDeviceSessionRef.current ?? activeSession;
    testDeviceSessionRef.current = null;
    setTestDeviceStarting(false);
    setTestDeviceRunning(false);
    setTestDeviceStartedAtMs(null);
    if (session) {
      await stopHapticsPlayback(getActiveConnectionConfig(), session).catch((err) => {
        console.warn("Failed to stop haptics test device", err);
      });
    }
  }, [activeSession, getActiveConnectionConfig]);

  const startTestDevice = useCallback(async (): Promise<void> => {
    if (!connected) {
      setTestDeviceError("Connect a haptics device before starting the test.");
      return;
    }

    await stopTestDevice();

    let config: HapticsTargetConfig;
    let session: AnyHapticsSession;
    try {
      config = getActiveConnectionConfig();
      session = activeSession ?? (await createHapticsSession(config));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to start haptics test.";
      setTestDeviceError(message);
      setSyncError(message);
      setSynced(false);
      return;
    }

    setActiveSession(session);
    testDeviceSessionRef.current = session;
    setManuallyStopped(false);
    setTestDeviceError(null);
    setSyncError(null);
    setSynced(false);
    setTestDeviceStarting(true);

    let animationStartedAtMs: number | null = null;
    let activeLoopIndex = -1;

    const tick = async (): Promise<boolean> => {
      if (testDeviceTickBusyRef.current) return true;
      testDeviceTickBusyRef.current = true;
      try {
        const nowMs = globalThis.performance?.now?.() ?? Date.now();
        const elapsedMs =
          animationStartedAtMs === null
            ? offsetMsRef.current
            : nowMs - animationStartedAtMs + offsetMsRef.current;
        const loopIndex = Math.floor(Math.max(0, elapsedMs) / HAPTICS_TEST_PERIOD_MS);
        const timeMs =
          ((elapsedMs % HAPTICS_TEST_PERIOD_MS) + HAPTICS_TEST_PERIOD_MS) % HAPTICS_TEST_PERIOD_MS;
        if (
          (config.provider === "thehandy" ||
            (config.provider === "group" &&
              config.devices.some((device) => device.config.provider === "thehandy"))) &&
          loopIndex !== activeLoopIndex
        ) {
          activeLoopIndex = loopIndex;
          await stopHapticsPlayback(config, session);
        }
        await sendHapticsSync(
          config,
          session,
          timeMs,
          1,
          `${HAPTICS_TEST_SOURCE_ID}-${loopIndex}`,
          HAPTICS_TEST_ACTIONS
        );
        if (animationStartedAtMs === null) {
          const syncedAtMs = globalThis.performance?.now?.() ?? Date.now();
          animationStartedAtMs = syncedAtMs + offsetMsRef.current - timeMs;
          setTestDeviceStartedAtMs(animationStartedAtMs);
          setTestDeviceRunning(true);
          setTestDeviceStarting(false);
        }
        setSynced(true);
        return true;
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to run haptics test.";
        setTestDeviceError(message);
        setSyncError(message);
        setSynced(false);
        setTestDeviceStarting(false);
        await stopTestDevice();
        return false;
      } finally {
        testDeviceTickBusyRef.current = false;
      }
    };

    if (await tick()) {
      testDeviceTimerRef.current = globalThis.setInterval(() => {
        void tick();
      }, HAPTICS_TEST_TICK_MS);
    }
  }, [activeSession, connected, getActiveConnectionConfig, stopTestDevice]);

  const disconnect = useCallback(async () => {
    userMutatedStateRef.current = true;
    connectionAttemptIdRef.current += 1;
    await stopTestDevice();
    const session = activeSession;
    setConnected(false);
    setManuallyStopped(false);
    setSynced(false);
    setError(null);
    setSyncError(null);
    setStrokeState(DEFAULT_STROKE_STATE);
    setStrokeLoading(false);
    setStrokeError(null);
    setActiveSession(null);
    if (session) {
      await disconnectHapticsSession(getActiveConnectionConfig(), session).catch(() => undefined);
    }
    await saveToStore(connectionKey, appApiKeyOverride, localIp);
    await saveIntifaceToStore(
      intifaceWebsocketUrl,
      intifaceDeviceName,
      intifaceDeviceIndex,
      intifaceVibrationSensitivity
    );
    await saveTCodeToStore({
      transport: tcodeTransport,
      serialPath: tcodeSerialPath,
      baudRate: tcodeBaudRate,
      websocketHost: tcodeWebsocketHost,
      websocketUrl: tcodeWebsocketUrl,
      precision: tcodePrecision,
      axis: tcodeAxis,
    });
  }, [
    activeSession,
    appApiKeyOverride,
    connectionKey,
    getActiveConnectionConfig,
    intifaceDeviceIndex,
    intifaceDeviceName,
    intifaceVibrationSensitivity,
    intifaceWebsocketUrl,
    localIp,
    stopTestDevice,
    tcodeAxis,
    tcodeBaudRate,
    tcodePrecision,
    tcodeSerialPath,
    tcodeTransport,
    tcodeWebsocketHost,
    tcodeWebsocketUrl,
  ]);

  const forceStop = useCallback(async () => {
    await stopTestDevice();
    setManuallyStopped(true);
    setSynced(false);
    setError(null);
    setSyncError(null);

    try {
      const config = getActiveConnectionConfig();
      if (connected) {
        const session = activeSession ?? (await createHapticsSession(config));
        setActiveSession(session);
        await stopHapticsPlayback(config, session);
      }
    } catch (err) {
      console.warn("Failed to force-stop haptics playback", err);
    }

    setConnected((current) => current);
    await saveToStore(connectionKey, appApiKeyOverride, localIp);
  }, [
    activeSession,
    appApiKeyOverride,
    connected,
    connectionKey,
    getActiveConnectionConfig,
    localIp,
    stopTestDevice,
  ]);

  const toggleManualStop = useCallback(async (): Promise<"stopped" | "resumed" | "unavailable"> => {
    if (manuallyStopped) {
      setManuallyStopped(false);
      setSynced(false);
      setSyncError(null);
      return "resumed";
    }

    if (!connected || (provider === "thehandy" && (!connectionKey.trim() || !appApiKey.trim()))) {
      return "unavailable";
    }

    setManuallyStopped(true);
    setSynced(false);
    setError(null);
    setSyncError(null);

    try {
      const config = getActiveConnectionConfig();
      const session = activeSession ?? (await createHapticsSession(config));
      setActiveSession(session);
      await stopHapticsPlayback(config, session);
      return "stopped";
    } catch (err) {
      console.warn("Failed to toggle manual haptics stop", err);
      return "stopped";
    }
  }, [
    activeSession,
    appApiKey,
    connected,
    connectionKey,
    getActiveConnectionConfig,
    manuallyStopped,
    provider,
  ]);

  const setSyncStatus = useCallback((next: { synced: boolean; error?: string | null }) => {
    setSynced(next.synced);
    setSyncError(next.error ?? null);
  }, []);

  const adjustOffset = useCallback(
    async (deltaMs: number): Promise<number> => {
      userMutatedStateRef.current = true;
      const nextOffsetMs = offsetMs + deltaMs;
      if (resourceOffsetOverrideMs !== null) {
        const normalized = normalizeHandyOffsetMs(nextOffsetMs);
        setResourceOffsetOverrideMs(normalized);
        return normalized;
      }
      return persistOffset(nextOffsetMs);
    },
    [offsetMs, persistOffset, resourceOffsetOverrideMs]
  );

  const resetOffset = useCallback(async () => {
    userMutatedStateRef.current = true;
    if (resourceOffsetOverrideMs !== null) {
      setResourceOffsetOverrideMs(0);
      return;
    }
    await persistOffset(0);
  }, [persistOffset, resourceOffsetOverrideMs]);

  const setResourceOffsetOverride = useCallback((nextOffsetMs: number | null) => {
    userMutatedStateRef.current = true;
    setResourceOffsetOverrideMs(nextOffsetMs == null ? null : normalizeHandyOffsetMs(nextOffsetMs));
  }, []);

  const setStrokeBounds = useCallback(
    async (minPercent: number, maxPercent: number): Promise<void> => {
      const trimmedKey = connectionKey.trim();
      const trimmedApiKey = appApiKey.trim();
      if (provider === "thehandy" && (!trimmedKey || !trimmedApiKey)) {
        setStrokeError("Stroke settings unavailable.");
        return;
      }

      const previousStrokeState = strokeState;
      const optimisticStrokeState = normalizeHandyStrokeState({
        ...strokeState,
        ...getHandyStrokeFromBounds(minPercent, maxPercent),
      });

      setStrokeState(optimisticStrokeState);
      setStrokeLoading(true);
      setStrokeError(null);

      try {
        const nextStroke = await updateHapticsStroke(
          provider === "thehandy"
            ? getConnectionConfig({ connectionKey: trimmedKey, appApiKey: trimmedApiKey })
            : getConnectionConfig({ strokeState: optimisticStrokeState }),
          optimisticStrokeState
        );
        setStrokeState(nextStroke);
        if (selectedDeviceId) {
          const saved = deviceSlots.map((slot) => {
            if (slot.id !== selectedDeviceId) return slot;
            const config =
              slot.config.provider === "intiface" || slot.config.provider === "tcode"
                ? { ...slot.config, stroke: nextStroke }
                : slot.config;
            return { ...slot, config, stroke: nextStroke };
          });
          setDeviceSlots(saved);
          await saveDeviceSlotsToStore(saved);
        }
      } catch (err) {
        setStrokeState(previousStrokeState);
        setStrokeError(
          err instanceof Error ? err.message : "Failed to update haptics stroke settings."
        );
      } finally {
        setStrokeLoading(false);
      }
    },
    [
      appApiKey,
      connectionKey,
      deviceSlots,
      getConnectionConfig,
      provider,
      selectedDeviceId,
      strokeState,
    ]
  );

  const setStrokePercent = useCallback(
    async (percent: number): Promise<void> => {
      const targetSpan = Math.max(0, Math.min(100, Math.round(percent)));
      const pad = Math.round((100 - targetSpan) / 2);
      await setStrokeBounds(pad, 100 - pad);
    },
    [setStrokeBounds]
  );

  const resetStroke = useCallback(async () => {
    await setStrokeBounds(0, 100);
  }, [setStrokeBounds]);

  useEffect(
    () => () => {
      if (testDeviceTimerRef.current) {
        globalThis.clearInterval(testDeviceTimerRef.current);
        testDeviceTimerRef.current = null;
      }
    },
    []
  );

  const value = useMemo(
    () => ({
      deviceSlots,
      activeDeviceTargets,
      selectedDeviceId,
      selectDevice,
      removeDevice,
      provider,
      setProvider,
      connectionKey,
      appApiKey,
      appApiKeyOverride,
      isUsingDefaultAppApiKey,
      localIp,
      intifaceWebsocketUrl,
      intifaceDeviceName,
      intifaceDeviceIndex,
      intifaceVibrationSensitivity,
      setIntifaceVibrationSensitivity,
      tcodeTransport,
      tcodeSerialPath,
      tcodeBaudRate,
      tcodeWebsocketHost,
      tcodeWebsocketUrl,
      tcodePrecision,
      tcodeAxis,
      tcodeSerialPorts,
      tcodeSerialPortsLoading,
      offsetMs,
      strokeMin: strokeState.min,
      strokeMax: strokeState.max,
      strokePercent,
      strokeLoading,
      strokeError,
      connected,
      manuallyStopped,
      synced,
      syncError,
      testDeviceStarting,
      testDeviceRunning,
      testDeviceStartedAtMs,
      testDeviceError,
      isConnecting,
      error,
      connect,
      connectIntiface,
      connectTCode,
      refreshTCodeSerialPorts,
      autoDetectTCodeSerialPort,
      abortConnect,
      reconnect,
      disconnect,
      forceStop,
      toggleManualStop,
      setSyncStatus,
      adjustOffset,
      resetOffset,
      setResourceOffsetOverride,
      startTestDevice,
      stopTestDevice,
      refreshStroke,
      setStrokePercent,
      setStrokeBounds,
      resetStroke,
    }),
    [
      deviceSlots,
      activeDeviceTargets,
      selectedDeviceId,
      selectDevice,
      removeDevice,
      provider,
      setProvider,
      connectionKey,
      appApiKey,
      appApiKeyOverride,
      isUsingDefaultAppApiKey,
      localIp,
      intifaceWebsocketUrl,
      intifaceDeviceName,
      intifaceDeviceIndex,
      intifaceVibrationSensitivity,
      setIntifaceVibrationSensitivity,
      tcodeTransport,
      tcodeSerialPath,
      tcodeBaudRate,
      tcodeWebsocketHost,
      tcodeWebsocketUrl,
      tcodePrecision,
      tcodeAxis,
      tcodeSerialPorts,
      tcodeSerialPortsLoading,
      offsetMs,
      resourceOffsetOverrideMs,
      strokeState,
      strokePercent,
      strokeLoading,
      strokeError,
      connected,
      manuallyStopped,
      synced,
      syncError,
      testDeviceStarting,
      testDeviceRunning,
      testDeviceStartedAtMs,
      testDeviceError,
      isConnecting,
      error,
      connect,
      connectIntiface,
      connectTCode,
      refreshTCodeSerialPorts,
      autoDetectTCodeSerialPort,
      abortConnect,
      reconnect,
      disconnect,
      forceStop,
      toggleManualStop,
      setSyncStatus,
      adjustOffset,
      resetOffset,
      setResourceOffsetOverride,
      startTestDevice,
      stopTestDevice,
      refreshStroke,
      setStrokePercent,
      setStrokeBounds,
      resetStroke,
    ]
  );

  return <HapticsContext.Provider value={value}>{children}</HapticsContext.Provider>;
};

export const useHaptics = () => {
  const context = useContext(HapticsContext);
  if (context === undefined) {
    throw new Error("useHaptics must be used within a HapticsProvider");
  }
  return context;
};

export const HandyProvider = HapticsProvider;
export const useHandy = useHaptics;
