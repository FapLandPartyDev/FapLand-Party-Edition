import { verifyHandyV3Connection } from "./thehandy/runtime";

interface VerifyResponse {
    success: boolean;
    deviceType?: string;
    firmwareVersion?: string;
    message?: string;
}

export const verifyConnection = async (connectionKey: string, _localIp?: string, appApiKey?: string): Promise<VerifyResponse> => {
    if (!connectionKey.trim()) {
        return {
            success: false,
            message: "Connection key is required.",
        };
    }

    if (!appApiKey?.trim()) {
        return {
            success: false,
            message: "Application API key is required for TheHandy v3.",
        };
    }

    try {
        const result = await verifyHandyV3Connection({
            connectionKey: connectionKey.trim(),
            appApiKey: appApiKey.trim(),
        });
        if (!result.connected) {
            return {
                success: false,
                message: "Device is offline or connection key is invalid.",
            };
        }

        return {
            success: true,
            deviceType: "TheHandy v3",
        };
    } catch (error) {
        if (Array.isArray(error)) {
            return {
                success: false,
                message: "TheHandy request validation failed. Ensure Connection Key is filled in the Connection Key field, not Application ID/API Key.",
            };
        }
        return {
            success: false,
            message: error instanceof Error ? error.message : "Unknown TheHandy API error",
        };
    }
};
