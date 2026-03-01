import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
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
    DEFAULT_INTIFACE_WEBSOCKET_URL,
    HAPTICS_PROVIDER_STORE_KEY,
    INTIFACE_DEVICE_INDEX_STORE_KEY,
    INTIFACE_DEVICE_NAME_STORE_KEY,
    INTIFACE_WEBSOCKET_URL_STORE_KEY,
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
} from "../services/haptics/runtime";
import type { HapticsProviderId } from "../services/haptics/types";
import { trpc } from "../services/trpc";

type HapticsContextType = {
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
    connectIntiface: (websocketUrl?: string) => Promise<boolean>;
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

function normalizeProvider(value: unknown): HapticsProviderId {
    return value === "intiface" ? "intiface" : "thehandy";
}

function normalizeIntifaceDeviceIndex(value: unknown): number | null {
    if (value === null || value === undefined || value === "") return null;
    const parsed = typeof value === "number" ? value : Number(value);
    return Number.isFinite(parsed) ? Math.floor(parsed) : null;
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
    offsetMs: number;
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
            offsetMs,
        ] = await Promise.all([
            trpc.store.get.query({ key: HAPTICS_PROVIDER_STORE_KEY }),
            trpc.store.get.query({ key: CONNECTION_KEY_STORE_KEY }),
            trpc.store.get.query({ key: THEHANDY_APP_API_KEY_OVERRIDE_STORE_KEY }),
            trpc.store.get.query({ key: LOCAL_IP_STORE_KEY }),
            trpc.store.get.query({ key: INTIFACE_WEBSOCKET_URL_STORE_KEY }),
            trpc.store.get.query({ key: INTIFACE_DEVICE_NAME_STORE_KEY }),
            trpc.store.get.query({ key: INTIFACE_DEVICE_INDEX_STORE_KEY }),
            trpc.store.get.query({ key: THEHANDY_OFFSET_MS_STORE_KEY }),
        ]);
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
            offsetMs: normalizeHandyOffsetMs(offsetMs),
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
            offsetMs: 0,
        };
    }
}

async function saveToStore(key: string, apiKeyOverride: string, ip: string): Promise<void> {
    try {
        await Promise.all([
            trpc.store.set.mutate({ key: CONNECTION_KEY_STORE_KEY, value: key }),
            trpc.store.set.mutate({ key: THEHANDY_APP_API_KEY_OVERRIDE_STORE_KEY, value: normalizeHandyAppApiKeyOverride(apiKeyOverride) }),
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

async function saveIntifaceToStore(websocketUrl: string, deviceName: string | null, deviceIndex: number | null): Promise<void> {
    try {
        await Promise.all([
            trpc.store.set.mutate({ key: INTIFACE_WEBSOCKET_URL_STORE_KEY, value: websocketUrl }),
            trpc.store.set.mutate({ key: INTIFACE_DEVICE_NAME_STORE_KEY, value: deviceName }),
            trpc.store.set.mutate({ key: INTIFACE_DEVICE_INDEX_STORE_KEY, value: deviceIndex }),
        ]);
    } catch (err) {
        console.error("Failed to save Intiface settings", err);
    }
}

export const HapticsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [provider, setProviderState] = useState<HapticsProviderId>("thehandy");
    const [connectionKey, setConnectionKey] = useState("");
    const [appApiKeyOverride, setAppApiKeyOverride] = useState("");
    const [localIp, setLocalIp] = useState("");
    const [intifaceWebsocketUrl, setIntifaceWebsocketUrl] = useState(DEFAULT_INTIFACE_WEBSOCKET_URL);
    const [intifaceDeviceName, setIntifaceDeviceName] = useState<string | null>(null);
    const [intifaceDeviceIndex, setIntifaceDeviceIndex] = useState<number | null>(null);
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
    const offsetMsRef = useRef(0);

    const appApiKey = resolveHandyAppApiKey(appApiKeyOverride);
    const isUsingDefaultAppApiKey = normalizeHandyAppApiKeyOverride(appApiKeyOverride).length === 0;
    const strokePercent = getHandyStrokePercent(strokeState);
    const offsetMs = resourceOffsetOverrideMs ?? globalOffsetMs;

    useEffect(() => {
        offsetMsRef.current = offsetMs;
    }, [offsetMs]);

    const getConnectionConfig = useCallback((override?: Partial<{
        provider: HapticsProviderId;
        connectionKey: string;
        appApiKey: string;
        appApiKeyOverride: string;
        localIp: string;
        intifaceWebsocketUrl: string;
        intifaceDeviceName: string | null;
        intifaceDeviceIndex: number | null;
        strokeState: HandyStrokeState;
    }>): HapticsConnectionConfig => {
        const effectiveProvider = override?.provider ?? provider;
        if (effectiveProvider === "intiface") {
            return {
                provider: "intiface",
                websocketUrl: override?.intifaceWebsocketUrl ?? intifaceWebsocketUrl,
                deviceName: override?.intifaceDeviceName ?? intifaceDeviceName,
                deviceIndex: override?.intifaceDeviceIndex ?? intifaceDeviceIndex,
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
    }, [
        appApiKey,
        appApiKeyOverride,
        connectionKey,
        intifaceDeviceIndex,
        intifaceDeviceName,
        intifaceWebsocketUrl,
        localIp,
        provider,
        strokeState,
    ]);

    const refreshStroke = useCallback(async (
        authOverride?: { connectionKey?: string; appApiKey?: string }
    ): Promise<void> => {
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
            setStrokeError(err instanceof Error ? err.message : "Failed to load haptics stroke settings.");
        } finally {
            setStrokeLoading(false);
        }
    }, [appApiKey, connectionKey, getConnectionConfig, provider]);

    useEffect(() => {
        loadFromStore().then(async ({
            provider: savedProvider,
            connectionKey: savedKey,
            appApiKeyOverride: savedOverride,
            localIp: savedIp,
            intifaceWebsocketUrl: savedIntifaceUrl,
            intifaceDeviceName: savedIntifaceDeviceName,
            intifaceDeviceIndex: savedIntifaceDeviceIndex,
            offsetMs: savedOffsetMs,
        }) => {
            if (userMutatedStateRef.current) return;
            setProviderState(savedProvider);
            if (savedKey) setConnectionKey(savedKey);
            if (savedOverride) setAppApiKeyOverride(savedOverride);
            if (savedIp) setLocalIp(savedIp);
            setIntifaceWebsocketUrl(savedIntifaceUrl);
            setIntifaceDeviceName(savedIntifaceDeviceName);
            setIntifaceDeviceIndex(savedIntifaceDeviceIndex);
            setGlobalOffsetMs(savedOffsetMs);

            const effectiveAppApiKey = resolveHandyAppApiKey(savedOverride);
            if (savedProvider === "thehandy" && (!savedKey || !effectiveAppApiKey)) {
                setConnected(false);
                return;
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
                    if (savedProvider === "intiface") {
                        setIntifaceDeviceName(result.deviceName ?? savedIntifaceDeviceName);
                        setIntifaceDeviceIndex(result.deviceIndex ?? savedIntifaceDeviceIndex);
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
        });
    }, []);

    const persistOffset = useCallback(async (nextOffsetMs: number): Promise<number> => {
        const normalized = normalizeHandyOffsetMs(nextOffsetMs);
        setGlobalOffsetMs(normalized);

        try {
            await trpc.store.set.mutate({ key: THEHANDY_OFFSET_MS_STORE_KEY, value: normalized });
        } catch (err) {
            console.error("Failed to save handy offset", err);
        }

        return normalized;
    }, []);

    const setProvider = useCallback(async (nextProvider: HapticsProviderId): Promise<void> => {
        userMutatedStateRef.current = true;
        setProviderState(nextProvider);
        setConnected(false);
        setManuallyStopped(false);
        setSynced(false);
        setError(null);
        setSyncError(null);
        setActiveSession(null);
        await saveProviderToStore(nextProvider);
    }, []);

    const connect = useCallback(async (key: string, ip?: string, apiKeyOverride?: string): Promise<boolean> => {
        userMutatedStateRef.current = true;
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
            if (result.success) {
                setConnected(true);
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
            const message = err instanceof Error ? err.message : "Failed to connect to TheHandy";
            setError(message);
            setConnected(false);
            return false;
        } finally {
            setIsConnecting(false);
        }
    }, [appApiKeyOverride, localIp, refreshStroke]);

    const connectIntiface = useCallback(async (websocketUrl?: string): Promise<boolean> => {
        userMutatedStateRef.current = true;
        const nextUrl = (websocketUrl ?? intifaceWebsocketUrl).trim() || DEFAULT_INTIFACE_WEBSOCKET_URL;
        setIsConnecting(true);
        setProviderState("intiface");
        setError(null);
        setSyncError(null);
        setSynced(false);
        setManuallyStopped(false);
        setIntifaceWebsocketUrl(nextUrl);
        await saveProviderToStore("intiface");
        await saveIntifaceToStore(nextUrl, intifaceDeviceName, intifaceDeviceIndex);

        try {
            const result = await verifyHapticsConnection({
                provider: "intiface",
                websocketUrl: nextUrl,
                deviceName: intifaceDeviceName,
                deviceIndex: intifaceDeviceIndex,
                stroke: strokeState,
            });
            if (result.success) {
                const nextDeviceName = result.deviceName ?? intifaceDeviceName;
                const nextDeviceIndex = result.deviceIndex ?? intifaceDeviceIndex;
                setConnected(true);
                setIntifaceDeviceName(nextDeviceName);
                setIntifaceDeviceIndex(nextDeviceIndex);
                await saveIntifaceToStore(nextUrl, nextDeviceName, nextDeviceIndex);
                return true;
            }
            setError(result.message ?? "Failed to connect to Intiface.");
            setConnected(false);
            return false;
        } catch (err) {
            const message = err instanceof Error ? err.message : "Failed to connect to Intiface.";
            setError(message);
            setConnected(false);
            return false;
        } finally {
            setIsConnecting(false);
        }
    }, [
        intifaceDeviceIndex,
        intifaceDeviceName,
        intifaceWebsocketUrl,
        strokeState,
    ]);

    const reconnect = useCallback(async (): Promise<boolean> => {
        if (provider === "intiface") {
            return connectIntiface(intifaceWebsocketUrl);
        }
        return connect(connectionKey, localIp, appApiKeyOverride);
    }, [appApiKeyOverride, connect, connectIntiface, connectionKey, intifaceWebsocketUrl, localIp, provider]);

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
            await stopHapticsPlayback(getConnectionConfig(), session).catch((err) => {
                console.warn("Failed to stop haptics test device", err);
            });
        }
    }, [activeSession, getConnectionConfig]);

    const startTestDevice = useCallback(async (): Promise<void> => {
        if (!connected) {
            setTestDeviceError("Connect a haptics device before starting the test.");
            return;
        }

        await stopTestDevice();

        let config: HapticsConnectionConfig;
        let session: AnyHapticsSession;
        try {
            config = getConnectionConfig();
            session = activeSession ?? await createHapticsSession(config);
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
                    ((elapsedMs % HAPTICS_TEST_PERIOD_MS) + HAPTICS_TEST_PERIOD_MS) %
                    HAPTICS_TEST_PERIOD_MS;
                if (config.provider === "thehandy" && loopIndex !== activeLoopIndex) {
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
    }, [activeSession, connected, getConnectionConfig, stopTestDevice]);

    const disconnect = useCallback(async () => {
        userMutatedStateRef.current = true;
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
            await disconnectHapticsSession(getConnectionConfig(), session).catch(() => undefined);
        }
        await saveToStore(connectionKey, appApiKeyOverride, localIp);
        await saveIntifaceToStore(intifaceWebsocketUrl, intifaceDeviceName, intifaceDeviceIndex);
    }, [
        activeSession,
        appApiKeyOverride,
        connectionKey,
        getConnectionConfig,
        intifaceDeviceIndex,
        intifaceDeviceName,
        intifaceWebsocketUrl,
        localIp,
        stopTestDevice,
    ]);

    const forceStop = useCallback(async () => {
        await stopTestDevice();
        setManuallyStopped(true);
        setSynced(false);
        setError(null);
        setSyncError(null);

        try {
            const config = getConnectionConfig();
            if (connected) {
                const session = activeSession ?? await createHapticsSession(config);
                setActiveSession(session);
                await stopHapticsPlayback(config, session);
            }
        } catch (err) {
            console.warn("Failed to force-stop haptics playback", err);
        }

        setConnected((current) => current);
        await saveToStore(connectionKey, appApiKeyOverride, localIp);
    }, [activeSession, appApiKeyOverride, connected, connectionKey, getConnectionConfig, localIp, stopTestDevice]);

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
            const config = getConnectionConfig();
            const session = activeSession ?? await createHapticsSession(config);
            setActiveSession(session);
            await stopHapticsPlayback(config, session);
            return "stopped";
        } catch (err) {
            console.warn("Failed to toggle manual haptics stop", err);
            return "stopped";
        }
    }, [activeSession, appApiKey, connected, connectionKey, getConnectionConfig, manuallyStopped, provider]);

    const setSyncStatus = useCallback((next: { synced: boolean; error?: string | null }) => {
        setSynced(next.synced);
        setSyncError(next.error ?? null);
    }, []);

    const adjustOffset = useCallback(async (deltaMs: number): Promise<number> => {
        userMutatedStateRef.current = true;
        const nextOffsetMs = offsetMs + deltaMs;
        if (resourceOffsetOverrideMs !== null) {
            const normalized = normalizeHandyOffsetMs(nextOffsetMs);
            setResourceOffsetOverrideMs(normalized);
            return normalized;
        }
        return persistOffset(nextOffsetMs);
    }, [offsetMs, persistOffset, resourceOffsetOverrideMs]);

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

    const setStrokeBounds = useCallback(async (minPercent: number, maxPercent: number): Promise<void> => {
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
                optimisticStrokeState,
            );
            setStrokeState(nextStroke);
        } catch (err) {
            setStrokeState(previousStrokeState);
            setStrokeError(err instanceof Error ? err.message : "Failed to update haptics stroke settings.");
        } finally {
            setStrokeLoading(false);
        }
    }, [appApiKey, connectionKey, getConnectionConfig, provider, strokeState]);

    const setStrokePercent = useCallback(async (percent: number): Promise<void> => {
        const targetSpan = Math.max(0, Math.min(100, Math.round(percent)));
        const pad = Math.round((100 - targetSpan) / 2);
        await setStrokeBounds(pad, 100 - pad);
    }, [setStrokeBounds]);

    const resetStroke = useCallback(async () => {
        await setStrokeBounds(0, 100);
    }, [setStrokeBounds]);

    useEffect(() => () => {
        if (testDeviceTimerRef.current) {
            globalThis.clearInterval(testDeviceTimerRef.current);
            testDeviceTimerRef.current = null;
        }
    }, []);

    const value = useMemo(() => ({
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
    }), [
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
    ]);

    return (
        <HapticsContext.Provider value={value}>
            {children}
        </HapticsContext.Provider>
    );
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
