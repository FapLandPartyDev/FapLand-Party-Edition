import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import {
    THEHANDY_APP_API_KEY_OVERRIDE_STORE_KEY,
    THEHANDY_OFFSET_MS_STORE_KEY,
} from "../constants/theHandy";
import { verifyConnection } from "../services/handyApi";
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
    getHandyStroke,
    issueHandySession,
    stopHandyPlayback,
    updateHandyStroke,
} from "../services/thehandy/runtime";
import { trpc } from "../services/trpc";

type HandyContextType = {
    connectionKey: string;
    appApiKey: string;
    appApiKeyOverride: string;
    isUsingDefaultAppApiKey: boolean;
    localIp: string;
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
    isConnecting: boolean;
    error: string | null;
    connect: (key: string, ip?: string, apiKeyOverride?: string) => Promise<boolean>;
    reconnect: () => Promise<boolean>;
    disconnect: () => Promise<void>;
    forceStop: () => Promise<void>;
    toggleManualStop: () => Promise<"stopped" | "resumed" | "unavailable">;
    setSyncStatus: (next: { synced: boolean; error?: string | null }) => void;
    adjustOffset: (deltaMs: number) => Promise<number>;
    resetOffset: () => Promise<void>;
    setResourceOffsetOverride: (offsetMs: number | null) => void;
    refreshStroke: () => Promise<void>;
    setStrokePercent: (percent: number) => Promise<void>;
    setStrokeBounds: (minPercent: number, maxPercent: number) => Promise<void>;
    resetStroke: () => Promise<void>;
};

const CONNECTION_KEY_STORE_KEY = "connectionKey";
const LOCAL_IP_STORE_KEY = "localIp";

const HandyContext = createContext<HandyContextType | undefined>(undefined);
const DEFAULT_STROKE_STATE = normalizeHandyStrokeState({ min: 0, max: 1 });

async function loadFromStore(): Promise<{ connectionKey: string; appApiKeyOverride: string; localIp: string; offsetMs: number }> {
    try {
        const [connectionKey, appApiKeyOverride, localIp, offsetMs] = await Promise.all([
            trpc.store.get.query({ key: CONNECTION_KEY_STORE_KEY }),
            trpc.store.get.query({ key: THEHANDY_APP_API_KEY_OVERRIDE_STORE_KEY }),
            trpc.store.get.query({ key: LOCAL_IP_STORE_KEY }),
            trpc.store.get.query({ key: THEHANDY_OFFSET_MS_STORE_KEY }),
        ]);
        return {
            connectionKey: (connectionKey as string | undefined) ?? "",
            appApiKeyOverride: normalizeHandyAppApiKeyOverride(appApiKeyOverride as string | undefined),
            localIp: (localIp as string | undefined) ?? "",
            offsetMs: normalizeHandyOffsetMs(offsetMs),
        };
    } catch (err) {
        console.warn("Could not load handy store", err);
        return { connectionKey: "", appApiKeyOverride: "", localIp: "", offsetMs: 0 };
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

export const HandyProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [connectionKey, setConnectionKey] = useState("");
    const [appApiKeyOverride, setAppApiKeyOverride] = useState("");
    const [localIp, setLocalIp] = useState("");
    const [globalOffsetMs, setGlobalOffsetMs] = useState(0);
    const [resourceOffsetOverrideMs, setResourceOffsetOverrideMs] = useState<number | null>(null);
    const [strokeState, setStrokeState] = useState<HandyStrokeState>(DEFAULT_STROKE_STATE);
    const [strokeLoading, setStrokeLoading] = useState(false);
    const [strokeError, setStrokeError] = useState<string | null>(null);
    const [connected, setConnected] = useState(false);
    const [manuallyStopped, setManuallyStopped] = useState(false);
    const [synced, setSynced] = useState(false);
    const [syncError, setSyncError] = useState<string | null>(null);
    const [isConnecting, setIsConnecting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const appApiKey = resolveHandyAppApiKey(appApiKeyOverride);
    const isUsingDefaultAppApiKey = normalizeHandyAppApiKeyOverride(appApiKeyOverride).length === 0;
    const strokePercent = getHandyStrokePercent(strokeState);
    const offsetMs = resourceOffsetOverrideMs ?? globalOffsetMs;

    const refreshStroke = useCallback(async (
        authOverride?: { connectionKey?: string; appApiKey?: string }
    ): Promise<void> => {
        const effectiveConnectionKey = authOverride?.connectionKey ?? connectionKey;
        const effectiveAppApiKey = authOverride?.appApiKey ?? appApiKey;
        const trimmedKey = effectiveConnectionKey.trim();
        const trimmedApiKey = effectiveAppApiKey.trim();

        if (!trimmedKey || !trimmedApiKey) {
            setStrokeError("Stroke settings unavailable.");
            return;
        }

        setStrokeLoading(true);
        setStrokeError(null);
        try {
            const nextStroke = await getHandyStroke({
                connectionKey: trimmedKey,
                appApiKey: trimmedApiKey,
            });
            setStrokeState(nextStroke);
        } catch (err) {
            setStrokeError(err instanceof Error ? err.message : "Failed to load TheHandy stroke settings.");
        } finally {
            setStrokeLoading(false);
        }
    }, [appApiKey, connectionKey]);

    useEffect(() => {
        loadFromStore().then(async ({ connectionKey: savedKey, appApiKeyOverride: savedOverride, localIp: savedIp, offsetMs: savedOffsetMs }) => {
            if (savedKey) setConnectionKey(savedKey);
            if (savedOverride) setAppApiKeyOverride(savedOverride);
            if (savedIp) setLocalIp(savedIp);
            setGlobalOffsetMs(savedOffsetMs);

            if (!savedKey) return;

            const effectiveAppApiKey = resolveHandyAppApiKey(savedOverride);
            if (!effectiveAppApiKey) {
                setConnected(false);
                return;
            }

            setIsConnecting(true);
            setError(null);
            setSyncError(null);
            setSynced(false);
            setManuallyStopped(false);

            try {
                const result = await verifyConnection(savedKey, savedIp, effectiveAppApiKey);
                if (result.success) {
                    setConnected(true);
                    await refreshStroke({
                        connectionKey: savedKey,
                        appApiKey: effectiveAppApiKey,
                    });
                } else {
                    setConnected(false);
                    setError(result.message ?? "Failed to connect to TheHandy");
                }
            } catch (err) {
                const message = err instanceof Error ? err.message : "Failed to connect to TheHandy";
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

    const connect = useCallback(async (key: string, ip?: string, apiKeyOverride?: string): Promise<boolean> => {
        setIsConnecting(true);
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

        try {
            const result = await verifyConnection(nextKey, nextIp, nextApiKey);
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
    }, [appApiKeyOverride, localIp]);

    const reconnect = useCallback(async (): Promise<boolean> => {
        return connect(connectionKey, localIp, appApiKeyOverride);
    }, [appApiKeyOverride, connect, connectionKey, localIp]);

    const disconnect = useCallback(async () => {
        setConnected(false);
        setManuallyStopped(false);
        setSynced(false);
        setError(null);
        setSyncError(null);
        setStrokeState(DEFAULT_STROKE_STATE);
        setStrokeLoading(false);
        setStrokeError(null);
        await saveToStore(connectionKey, appApiKeyOverride, localIp);
    }, [appApiKeyOverride, connectionKey, localIp]);

    const forceStop = useCallback(async () => {
        const trimmedKey = connectionKey.trim();
        const trimmedApiKey = appApiKey.trim();

        setManuallyStopped(true);
        setSynced(false);
        setError(null);
        setSyncError(null);

        try {
            if (trimmedKey && trimmedApiKey) {
                const session = await issueHandySession({
                    connectionKey: trimmedKey,
                    appApiKey: trimmedApiKey,
                });
                await stopHandyPlayback(
                    {
                        connectionKey: trimmedKey,
                        appApiKey: trimmedApiKey,
                    },
                    session,
                );
            }
        } catch (err) {
            console.warn("Failed to force-stop TheHandy playback", err);
        }

        setConnected((current) => current);
        await saveToStore(connectionKey, appApiKeyOverride, localIp);
    }, [appApiKey, appApiKeyOverride, connectionKey, localIp]);

    const toggleManualStop = useCallback(async (): Promise<"stopped" | "resumed" | "unavailable"> => {
        if (manuallyStopped) {
            setManuallyStopped(false);
            setSynced(false);
            setSyncError(null);
            return "resumed";
        }

        const trimmedKey = connectionKey.trim();
        const trimmedApiKey = appApiKey.trim();
        if (!connected || !trimmedKey || !trimmedApiKey) {
            return "unavailable";
        }

        setManuallyStopped(true);
        setSynced(false);
        setError(null);
        setSyncError(null);

        try {
            const session = await issueHandySession({
                connectionKey: trimmedKey,
                appApiKey: trimmedApiKey,
            });
            await stopHandyPlayback(
                {
                    connectionKey: trimmedKey,
                    appApiKey: trimmedApiKey,
                },
                session,
            );
            return "stopped";
        } catch (err) {
            console.warn("Failed to toggle manual TheHandy stop", err);
            return "stopped";
        }
    }, [appApiKey, connected, connectionKey, manuallyStopped]);

    const setSyncStatus = useCallback((next: { synced: boolean; error?: string | null }) => {
        setSynced(next.synced);
        setSyncError(next.error ?? null);
    }, []);

    const adjustOffset = useCallback(async (deltaMs: number): Promise<number> => {
        const nextOffsetMs = offsetMs + deltaMs;
        if (resourceOffsetOverrideMs !== null) {
            const normalized = normalizeHandyOffsetMs(nextOffsetMs);
            setResourceOffsetOverrideMs(normalized);
            return normalized;
        }
        return persistOffset(nextOffsetMs);
    }, [offsetMs, persistOffset, resourceOffsetOverrideMs]);

    const resetOffset = useCallback(async () => {
        if (resourceOffsetOverrideMs !== null) {
            setResourceOffsetOverrideMs(0);
            return;
        }
        await persistOffset(0);
    }, [persistOffset, resourceOffsetOverrideMs]);

    const setResourceOffsetOverride = useCallback((nextOffsetMs: number | null) => {
        setResourceOffsetOverrideMs(nextOffsetMs == null ? null : normalizeHandyOffsetMs(nextOffsetMs));
    }, []);

    const setStrokeBounds = useCallback(async (minPercent: number, maxPercent: number): Promise<void> => {
        const trimmedKey = connectionKey.trim();
        const trimmedApiKey = appApiKey.trim();
        if (!trimmedKey || !trimmedApiKey) {
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
            const nextStroke = await updateHandyStroke(
                {
                    connectionKey: trimmedKey,
                    appApiKey: trimmedApiKey,
                },
                optimisticStrokeState,
            );
            setStrokeState(nextStroke);
        } catch (err) {
            setStrokeState(previousStrokeState);
            setStrokeError(err instanceof Error ? err.message : "Failed to update TheHandy stroke settings.");
        } finally {
            setStrokeLoading(false);
        }
    }, [appApiKey, connectionKey, strokeState]);

    const setStrokePercent = useCallback(async (percent: number): Promise<void> => {
        const targetSpan = Math.max(0, Math.min(100, Math.round(percent)));
        const pad = Math.round((100 - targetSpan) / 2);
        await setStrokeBounds(pad, 100 - pad);
    }, [setStrokeBounds]);

    const resetStroke = useCallback(async () => {
        await setStrokeBounds(0, 100);
    }, [setStrokeBounds]);

    const value = useMemo(() => ({
        connectionKey,
        appApiKey,
        appApiKeyOverride,
        isUsingDefaultAppApiKey,
        localIp,
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
        isConnecting,
        error,
        connect,
        reconnect,
        disconnect,
        forceStop,
        toggleManualStop,
        setSyncStatus,
        adjustOffset,
        resetOffset,
        setResourceOffsetOverride,
        refreshStroke,
        setStrokePercent,
        setStrokeBounds,
        resetStroke,
    }), [
        connectionKey,
        appApiKey,
        appApiKeyOverride,
        isUsingDefaultAppApiKey,
        localIp,
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
        isConnecting,
        error,
        connect,
        reconnect,
        disconnect,
        forceStop,
        toggleManualStop,
        setSyncStatus,
        adjustOffset,
        resetOffset,
        setResourceOffsetOverride,
        refreshStroke,
        setStrokePercent,
        setStrokeBounds,
        resetStroke,
    ]);

    return (
        <HandyContext.Provider value={value}>
            {children}
        </HandyContext.Provider>
    );
};

export const useHandy = () => {
    const context = useContext(HandyContext);
    if (context === undefined) {
        throw new Error("useHandy must be used within a HandyProvider");
    }
    return context;
};
