import dgram from "node:dgram";
import dns from "node:dns/promises";
import { debugLog } from "./debugLogging";

export type TCodeUdpConnectInput = {
  host: string;
  port: number;
};

export type TCodeUdpConnectResult = {
  success: boolean;
  error?: string;
};

const HOST_PATTERN = /^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?(?::[1-9][0-9]{0,4})?$/i;
const MAX_COMMAND_BYTES = 1024;

let activeSocket: dgram.Socket | null = null;

function closeActiveSocket(): void {
  const socket = activeSocket;
  activeSocket = null;
  if (!socket) return;
  try {
    socket.removeAllListeners();
    socket.close();
  } catch {
    // already closed
  }
}

export async function connectTCodeUdp(input: unknown): Promise<TCodeUdpConnectResult> {
  const candidate = input as Partial<TCodeUdpConnectInput> | null | undefined;
  const rawHost = typeof candidate?.host === "string" ? candidate.host.trim() : "";
  if (!rawHost || !HOST_PATTERN.test(rawHost)) {
    return { success: false, error: "Enter a valid TCode device IP address or hostname." };
  }

  let hostname = rawHost;
  let port = Number(candidate?.port);
  const portIndex = rawHost.lastIndexOf(":");
  if (portIndex >= 0) {
    hostname = rawHost.slice(0, portIndex);
    if (!Number.isInteger(port) || port <= 0 || port > 65535) {
      port = Number(rawHost.slice(portIndex + 1));
    }
  }
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    return { success: false, error: "Enter a valid TCode UDP port between 1 and 65535." };
  }

  let address: string;
  let family: number;
  try {
    const resolved = await dns.lookup(hostname, { verbatim: true });
    address = resolved.address;
    family = resolved.family;
  } catch {
    return {
      success: false,
      error: `Could not resolve the TCode device host "${hostname}".`,
    };
  }

  closeActiveSocket();
  const socket = dgram.createSocket(family === 6 ? "udp6" : "udp4");
  socket.on("error", (error: Error) => {
    debugLog.debug("tcode-udp", "UDP socket error", {
      host: hostname,
      port,
      message: error.message,
    });
  });
  socket.unref();

  try {
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => reject(error);
      socket.once("error", onError);
      socket.connect(port, address, () => {
        socket.removeListener("error", onError);
        resolve();
      });
    });
  } catch (error) {
    try {
      socket.close();
    } catch {
      // ignore close errors
    }
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to open the TCode UDP socket.",
    };
  }

  activeSocket = socket;
  debugLog.info("tcode-udp", "TCode UDP socket connected", { host: hostname, port, address });
  return { success: true };
}

export function sendTCodeUdp(command: unknown): void {
  if (activeSocket === null) return;
  if (typeof command !== "string" || command.length === 0) return;
  const payload = Buffer.from(command, "utf8");
  if (payload.byteLength > MAX_COMMAND_BYTES) return;
  activeSocket.send(payload, 0, payload.byteLength, (error) => {
    if (error) {
      debugLog.debug("tcode-udp", "Failed to send TCode UDP command", {
        message: error.message,
      });
    }
  });
}

export function disconnectTCodeUdp(): void {
  if (activeSocket === null) return;
  debugLog.info("tcode-udp", "TCode UDP socket closed");
  closeActiveSocket();
}

export function __resetTCodeUdpForTests(): void {
  closeActiveSocket();
}
