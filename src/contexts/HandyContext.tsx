import React, { createContext, useContext, useState, useEffect, useCallback } from "react";
import { verifyConnection } from "../services/handyApi";
import { trpc } from "../services/trpc";

interface HandyContextType {
    connectionKey: string;
    appApiKey: string;
    localIp: string;
    connected: boolean;
    synced: boolean;
    syncError: string | null;
    isConnecting: boolean;
    error: string | null;
    connect: (key: string, ip?: string, apiKey?: string) => Promise<void>;
    disconnect: () => Promise<void>;
    setSyncStatus: (next: { synced: boolean; error?: string | null }) => void;
}

const HandyContext = createContext<HandyContextType | undefined>(undefined);

async function loadFromStore(): Promise<{ connectionKey: string; appApiKey: string; localIp: string }> {
    try {
        const [connectionKey, appApiKey, localIp] = await Promise.all([
            trpc.store.get.query({ key: "connectionKey" }),
            trpc.store.get.query({ key: "appApiKey" }),
            trpc.store.get.query({ key: "localIp" }),
        ]);
        return {
            connectionKey: (connectionKey as string | undefined) ?? "",
            appApiKey: (appApiKey as string | undefined) ?? "",
            localIp: (localIp as string | undefined) ?? "",
        };
    } catch (err) {
        console.warn("Could not load handy store", err);
        return { connectionKey: "", appApiKey: "", localIp: "" };
    }
}

async function saveToStore(key: string, apiKey: string, ip: string): Promise<void> {
    try {
        await Promise.all([
            trpc.store.set.mutate({ key: "connectionKey", value: key }),
            trpc.store.set.mutate({ key: "appApiKey", value: apiKey }),
            trpc.store.set.mutate({ key: "localIp", value: ip }),
        ]);
    } catch (err) {
        console.error("Failed to save to store", err);
    }
}

export const HandyProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [connectionKey, setConnectionKey] = useState("");
    const [appApiKey, setAppApiKey] = useState("");
    const [localIp, setLocalIp] = useState("");
    const [connected, setConnected] = useState(false);
    const [synced, setSynced] = useState(false);
    const [syncError, setSyncError] = useState<string | null>(null);
    const [isConnecting, setIsConnecting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        loadFromStore().then(async ({ connectionKey: savedKey, appApiKey: savedApiKey, localIp: savedIp }) => {
            if (savedKey) setConnectionKey(savedKey);
            if (savedApiKey) setAppApiKey(savedApiKey);
            if (savedIp) setLocalIp(savedIp);

            if (!savedKey) return;

            setIsConnecting(true);
            setError(null);
            setSyncError(null);
            setSynced(false);

            if (!savedApiKey) {
                setConnected(false);
                setIsConnecting(false);
                return;
            }

            try {
                const result = await verifyConnection(savedKey, savedIp, savedApiKey);
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

    const connect = useCallback(async (key: string, ip?: string, apiKey?: string) => {
        setIsConnecting(true);
        setError(null);
        setSyncError(null);
        setSynced(false);

        const nextApiKey = apiKey ?? appApiKey;
        const nextIp = ip ?? localIp;
        const nextKey = key;

        // Persist credentials immediately so failed connect attempts
        // don't force re-entry on next launch.
        setConnectionKey(nextKey);
        setAppApiKey(nextApiKey);
        setLocalIp(nextIp);
        await saveToStore(nextKey, nextApiKey, nextIp);

        try {
            const result = await verifyConnection(nextKey, nextIp, nextApiKey);
            if (result.success) {
                setConnected(true);
                await saveToStore(nextKey, nextApiKey, nextIp);
            } else {
                setError(result.message ?? "Failed to connect to TheHandy");
                setConnected(false);
            }
        } catch (err) {
            const message = err instanceof Error ? err.message : "Failed to connect to TheHandy";
            setError(message);
            setConnected(false);
        }
        setIsConnecting(false);
    }, [appApiKey, localIp]);

    const disconnect = useCallback(async () => {
        setConnected(false);
        setSynced(false);
        setError(null);
        setSyncError(null);
        // Keep credentials persisted so reconnect is one click.
        await saveToStore(connectionKey, appApiKey, localIp);
    }, [appApiKey, connectionKey, localIp]);



    const setSyncStatus = useCallback((next: { synced: boolean; error?: string | null }) => {
        setSynced(next.synced);
        setSyncError(next.error ?? null);
    }, []);

    return (
        <HandyContext.Provider
            value={{
                connectionKey,
                appApiKey,
                localIp,
                connected,
                synced,
                syncError,
                isConnecting,
                error,
                connect,
                disconnect,
                setSyncStatus,
            }}
        >
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
