import { verifyHandyV3Connection } from "./thehandy/runtime";

interface VerifyResponse {
  success: boolean;
  deviceType?: string;
  firmwareVersion?: string;
  unsupportedFirmware?: boolean;
  message?: string;
}

const MINIMUM_SUPPORTED_THEHANDY_FIRMWARE = 4;

export function parseFirmwareMajorVersion(firmwareVersion?: string | null): number | null {
  if (!firmwareVersion) {
    return null;
  }

  const match = firmwareVersion.trim().match(/^v?(\d+)/i);
  if (!match) {
    return null;
  }

  const majorVersion = Number.parseInt(match[1], 10);
  return Number.isFinite(majorVersion) ? majorVersion : null;
}

export const verifyConnection = async (
  connectionKey: string,
  _localIp?: string,
  appApiKey?: string
): Promise<VerifyResponse> => {
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

    const firmwareMajorVersion = parseFirmwareMajorVersion(result.firmwareVersion);
    if (
      firmwareMajorVersion !== null &&
      firmwareMajorVersion < MINIMUM_SUPPORTED_THEHANDY_FIRMWARE
    ) {
      return {
        success: false,
        firmwareVersion: result.firmwareVersion ?? undefined,
        unsupportedFirmware: true,
        message: `Only TheHandy firmware 4 or newer is supported.${result.firmwareVersion ? ` Device firmware: ${result.firmwareVersion}.` : ""}`,
      };
    }

    return {
      success: true,
      deviceType: "TheHandy v3",
      firmwareVersion: result.firmwareVersion ?? undefined,
    };
  } catch (error) {
    if (Array.isArray(error)) {
      return {
        success: false,
        message:
          "TheHandy request validation failed. Ensure Connection Key is filled in the Connection Key field, not Application ID/API Key.",
      };
    }
    return {
      success: false,
      message: error instanceof Error ? error.message : "Unknown TheHandy API error",
    };
  }
};
