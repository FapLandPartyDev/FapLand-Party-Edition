import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import {
    THEHANDY_APP_API_KEY_OVERRIDE_STORE_KEY,
    THEHANDY_OFFSET_MS_STORE_KEY,
} from "../constants/theHandy";
import { verifyConnection } from "../services/handyApi";
import {
    normalizeHandyAppApiKeyOverride,
    normalizeHandyOffsetMs,
    resolveHandyAppApiKey,
} from "../services/theHandyConfig";
import { issueHandySession, stopHandyPlayback } from "../services/thehandy/runtime";
import { trpc } from "../services/trpc";

type HandyContextType = {
    connectionKey: string;
    appApiKey: string;
    appApiKeyOverride: string;
    isUsingDefaultAppApiKey: boolean;
    localIp: string;
    offsetMs: number;
    connected: boolean;
    manuallyStopped: boolean;
    synced: boolean;
    syncError: string | null;
    isConnecting: boolean;
    error: string | null;
    connect: (key: string, ip?: string, apiKeyOverride?: string) => Promise<void>;
    disconnect: () => Promise<void>;
    forceStop: () => Promise<void>;
    toggleManualStop: () => Promise<"stopped" | "resumed" | "unavailable">;
    setSyncStatus: (next: { synced: boolean; error?: string | null }) => void;
    adjustOffset: (deltaMs: number) => Promise<number>;
    resetOffset: () => Promise<void>;
};

const CONNECTION_KEY_STORE_KEY = "connectionKey";
const LOCAL_IP_STORE_KEY = "localIp";

const HandyContext = createContext<HandyContextType | undefined>(undefined);

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
    const [offsetMs, setOffsetMs] = useState(0);
    const [connected, setConnected] = useState(false);
    const [manuallyStopped, setManuallyStopped] = useState(false);
    const [synced, setSynced] = useState(false);
    const [syncError, setSyncError] = useState<string | null>(null);
    const [isConnecting, setIsConnecting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const appApiKey = resolveHandyAppApiKey(appApiKeyOverride);
    const isUsingDefaultAppApiKey = normalizeHandyAppApiKeyOverride(appApiKeyOverride).length === 0;

    useEffect(() => {
        loadFromStore().then(async ({ connectionKey: savedKey, appApiKeyOverride: savedOverride, localIp: savedIp, offsetMs: savedOffsetMs }) => {
            if (savedKey) setConnectionKey(savedKey);
            if (savedOverride) setAppApiKeyOverride(savedOverride);
            if (savedIp) setLocalIp(savedIp);
            setOffsetMs(savedOffsetMs);

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
        setOffsetMs(normalized);

        try {
            await trpc.store.set.mutate({ key: THEHANDY_OFFSET_MS_STORE_KEY, value: normalized });
        } catch (err) {
            console.error("Failed to save handy offset", err);
        }

        return normalized;
    }, []);

    const connect = useCallback(async (key: string, ip?: string, apiKeyOverride?: string) => {
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
            } else {
                setError(result.message ?? "Failed to connect to TheHandy");
                setConnected(false);
            }
        } catch (err) {
            const message = err instanceof Error ? err.message : "Failed to connect to TheHandy";
            setError(message);
            setConnected(false);
        } finally {
            setIsConnecting(false);
        }
    }, [appApiKeyOverride, localIp]);

    const disconnect = useCallback(async () => {
        setConnected(false);
        setManuallyStopped(false);
        setSynced(false);
        setError(null);
        setSyncError(null);
        await saveToStore(connectionKey, appApiKeyOverride, localIp);
    }, [appApiKeyOverride, connectionKey, localIp]);

    const forceStop = useCallback(async () => {
        const trimmedKey = connectionKey.trim();
        const trimmedApiKey = appApiKey.trim();

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

        setConnected(false);
        setManuallyStopped(false);
        setSynced(false);
        setError(null);
        setSyncError(null);
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
            setManuallyStopped(true);
            setSynced(false);
            setSyncError(null);
            return "stopped";
        } catch (err) {
            console.warn("Failed to toggle manual TheHandy stop", err);
            return "unavailable";
        }
    }, [appApiKey, connected, connectionKey, manuallyStopped]);

    const setSyncStatus = useCallback((next: { synced: boolean; error?: string | null }) => {
        setSynced(next.synced);
        setSyncError(next.error ?? null);
    }, []);

    const adjustOffset = useCallback(async (deltaMs: number): Promise<number> => {
        return persistOffset(offsetMs + deltaMs);
    }, [offsetMs, persistOffset]);

    const resetOffset = useCallback(async () => {
        await persistOffset(0);
    }, [persistOffset]);

    const value = useMemo(() => ({
        connectionKey,
        appApiKey,
        appApiKeyOverride,
        isUsingDefaultAppApiKey,
        localIp,
        offsetMs,
        connected,
        manuallyStopped,
        synced,
        syncError,
        isConnecting,
        error,
        connect,
        disconnect,
        forceStop,
        toggleManualStop,
        setSyncStatus,
        adjustOffset,
        resetOffset,
    }), [
        connectionKey,
        appApiKey,
        appApiKeyOverride,
        isUsingDefaultAppApiKey,
        localIp,
        offsetMs,
        connected,
        manuallyStopped,
        synced,
        syncError,
        isConnecting,
        error,
        connect,
        disconnect,
        forceStop,
        toggleManualStop,
        setSyncStatus,
        adjustOffset,
        resetOffset,
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
