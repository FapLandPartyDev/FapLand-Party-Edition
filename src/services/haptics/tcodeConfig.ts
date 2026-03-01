import {
  DEFAULT_TCODE_AXIS,
  DEFAULT_TCODE_BAUD_RATE,
  DEFAULT_TCODE_PRECISION,
  DEFAULT_TCODE_TRANSPORT,
  DEFAULT_TCODE_UDP_HOST,
  DEFAULT_TCODE_UDP_PORT,
  DEFAULT_TCODE_WEBSOCKET_HOST,
  DEFAULT_TCODE_WEBSOCKET_PATH,
  DEFAULT_TCODE_WEBSOCKET_URL,
} from "../../constants/haptics";
import type { TCodeAxis, TCodePrecision, TCodeTransportKind } from "./types";

export type NormalizedTCodeWebSocket = {
  host: string;
  url: string;
};

export type NormalizedTCodeUdp = {
  host: string;
  port: number;
  endpoint: string;
};

const HOST_PATTERN = /^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?(?::[1-9][0-9]{0,4})?$/i;

export function normalizeTCodeTransport(value: unknown): TCodeTransportKind {
  return value === "serial" || value === "udp" ? value : DEFAULT_TCODE_TRANSPORT;
}

export function normalizeTCodeBaudRate(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(parsed) || parsed < 1200 || parsed > 1_000_000) {
    return DEFAULT_TCODE_BAUD_RATE;
  }
  return parsed;
}

export function normalizeTCodePrecision(value: unknown): TCodePrecision {
  return value === 3 || value === "3" ? 3 : DEFAULT_TCODE_PRECISION;
}

export function normalizeTCodeAxis(value: unknown): TCodeAxis {
  return value === "L0" ? "L0" : DEFAULT_TCODE_AXIS;
}

export function normalizeTCodeWebSocketInput(value: unknown): NormalizedTCodeWebSocket {
  const raw = typeof value === "string" ? value.trim() : "";
  if (raw.length === 0) {
    return { host: DEFAULT_TCODE_WEBSOCKET_HOST, url: DEFAULT_TCODE_WEBSOCKET_URL };
  }

  if (/^wss?:\/\//i.test(raw)) {
    let parsed: URL;
    try {
      parsed = new URL(raw);
    } catch {
      throw new Error("Enter a valid TCode WebSocket URL or device IP address.");
    }
    if (parsed.protocol !== "ws:" && parsed.protocol !== "wss:") {
      throw new Error("TCode WebSocket URL must start with ws:// or wss://.");
    }
    if (!isValidTCodeHost(parsed.host)) {
      throw new Error("Enter a valid TCode device IP address or hostname.");
    }
    const path =
      parsed.pathname && parsed.pathname !== "/" ? parsed.pathname : DEFAULT_TCODE_WEBSOCKET_PATH;
    return {
      host: parsed.host,
      url: `${parsed.protocol}//${parsed.host}${path}`,
    };
  }

  const host = raw.replace(/^\/+|\/+$/g, "");
  if (!isValidTCodeHost(host)) {
    throw new Error("Enter a valid TCode device IP address or hostname.");
  }
  return {
    host,
    url: `ws://${host}${DEFAULT_TCODE_WEBSOCKET_PATH}`,
  };
}

export function isValidTCodeHost(host: string): boolean {
  const trimmed = host.trim();
  if (!HOST_PATTERN.test(trimmed)) return false;
  const portIndex = trimmed.lastIndexOf(":");
  if (portIndex >= 0) {
    const port = Number(trimmed.slice(portIndex + 1));
    if (!Number.isInteger(port) || port <= 0 || port > 65535) return false;
  }
  return true;
}

export function normalizeTCodeUdpInput(value: unknown): NormalizedTCodeUdp {
  const raw = typeof value === "string" ? value.trim() : "";
  if (raw.length === 0) {
    return {
      host: DEFAULT_TCODE_UDP_HOST,
      port: DEFAULT_TCODE_UDP_PORT,
      endpoint: `${DEFAULT_TCODE_UDP_HOST}:${DEFAULT_TCODE_UDP_PORT}`,
    };
  }

  const withoutScheme = raw.replace(/^udp:\/\//i, "");
  const hostPart = withoutScheme.replace(/\/+$/, "");
  if (!isValidTCodeHost(hostPart)) {
    throw new Error("Enter a valid TCode device IP address or hostname.");
  }

  const portIndex = hostPart.lastIndexOf(":");
  if (portIndex >= 0) {
    const port = Number(hostPart.slice(portIndex + 1));
    return {
      host: hostPart,
      port,
      endpoint: hostPart,
    };
  }
  return {
    host: hostPart,
    port: DEFAULT_TCODE_UDP_PORT,
    endpoint: `${hostPart}:${DEFAULT_TCODE_UDP_PORT}`,
  };
}
