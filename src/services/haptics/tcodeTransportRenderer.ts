import type { TCodeTransportKind } from "./types";

export type TCodeConnectInput = {
  transport: TCodeTransportKind;
  serialPath?: string;
  baudRate?: number;
  websocketUrl?: string;
};

export type TCodeConnectResult = {
  success: boolean;
  error?: string;
};

export type TCodeSerialPortInfo = {
  path: string;
  manufacturer: string | null;
};

export type TCodeAutoDetectSerialInput = {
  baudRate?: number;
};

export type TCodeAutoDetectSerialResult = {
  port: TCodeSerialPortInfo | null;
  error?: string;
};

type WebSerialPortInfo = {
  usbVendorId?: number;
  usbProductId?: number;
};

type WebSerialPort = {
  readable: ReadableStream<Uint8Array> | null;
  writable: WritableStream<Uint8Array> | null;
  getInfo: () => WebSerialPortInfo;
  open: (options: { baudRate: number }) => Promise<void>;
  close: () => Promise<void>;
};

type WebSerial = {
  getPorts: () => Promise<WebSerialPort[]>;
  requestPort: () => Promise<WebSerialPort>;
};

type NavigatorWithSerial = Navigator & {
  serial?: WebSerial;
};

type PortEntry = {
  port: WebSerialPort;
  label: string;
};

const TCODE_WEBSOCKET_CONNECT_TIMEOUT_MS = 5000;
const TCODE_SERIAL_AUTO_DETECT_COMMAND = "L05000\n";

// Shared because port discovery is system-wide; connection state is per-instance.
const sharedSerialPorts = new Map<string, PortEntry>();

function getPortLabel(port: WebSerialPort, index: number): string {
  const info = port.getInfo();
  if (info.usbVendorId != null && info.usbProductId != null) {
    return `USB ${info.usbVendorId.toString(16).padStart(4, "0")}:${info.usbProductId.toString(16).padStart(4, "0")}`;
  }
  return `Serial ${index + 1}`;
}

export class TCodeTransportRenderer {
  private activeSerialPort: WebSerialPort | null = null;
  private serialReader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private serialWriter: WritableStreamDefaultWriter<Uint8Array> | null = null;
  private readLoopPromise: Promise<void> | null = null;
  private operationQueue: Promise<void> = Promise.resolve();
  private readLoopActive = false;
  private ws: WebSocket | null = null;

  async connect(input: TCodeConnectInput): Promise<TCodeConnectResult> {
    return this.enqueue(async () => {
      try {
        await this.disconnectNow();
      } catch (error) {
        return {
          success: false,
          error:
            error instanceof Error ? error.message : "Failed to disconnect TCode transport.",
        };
      }
      if (input.transport === "serial") return this.connectSerial(input);
      return this.connectWebSocket(input);
    });
  }

  send(command: string): boolean {
    if (this.serialWriter) {
      try {
        this.serialWriter.write(new TextEncoder().encode(command));
        return true;
      } catch {
        return false;
      }
    }
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(command);
        return true;
      } catch {
        return false;
      }
    }
    return false;
  }

  async disconnect(): Promise<void> {
    await this.enqueue(() => this.disconnectNow());
  }

  isConnected(): boolean {
    return this.readLoopActive || this.ws?.readyState === WebSocket.OPEN;
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.operationQueue.catch(() => undefined).then(operation);
    this.operationQueue = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }

  private async disconnectNow(): Promise<void> {
    this.readLoopActive = false;
    const reader = this.serialReader;
    if (reader) {
      try {
        await reader.cancel();
      } catch {
        // already cancelled or disconnected
      }
    }
    if (this.serialWriter) {
      try {
        this.serialWriter.releaseLock();
      } catch {
        // already released
      }
      this.serialWriter = null;
    }
    if (this.readLoopPromise) {
      await this.readLoopPromise.catch(() => undefined);
      this.readLoopPromise = null;
    }
    if (this.activeSerialPort) {
      const port = this.activeSerialPort;
      try {
        await port.close();
        this.activeSerialPort = null;
      } catch {
        this.activeSerialPort = port;
        throw new Error("Failed to close TCode serial port.");
      }
    }
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        // ignore close errors
      }
      this.ws = null;
    }
  }

  private async connectSerial(input: TCodeConnectInput): Promise<TCodeConnectResult> {
    if (!(globalThis.navigator as NavigatorWithSerial | undefined)?.serial) {
      return { success: false, error: "Web Serial API is not available in this environment." };
    }
    const path = input.serialPath?.trim() ?? "";
    const entry = sharedSerialPorts.get(path);
    if (!entry) return { success: false, error: "Select a TCode serial port." };
    const baudRate = input.baudRate ?? 115200;
    try {
      await entry.port.open({ baudRate });
      this.activeSerialPort = entry.port;
      if (!entry.port.writable) {
        throw new Error("TCode serial port is not writable.");
      }
      this.serialWriter = entry.port.writable.getWriter();
      this.startReadLoop(entry.port);
      return { success: true };
    } catch (error) {
      await this.disconnectNow().catch(() => undefined);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to connect to TCode serial port.",
      };
    }
  }

  private startReadLoop(port: WebSerialPort): void {
    this.readLoopActive = true;
    this.readLoopPromise = (async () => {
      if (!port.readable) {
        this.readLoopActive = false;
        return;
      }
      const reader = port.readable.getReader();
      this.serialReader = reader;
      try {
        while (this.readLoopActive) {
          const { done } = await reader.read();
          if (done) break;
        }
      } catch {
        // port disconnected or read error
      } finally {
        try {
          reader.releaseLock();
        } catch {
          // already released
        }
        if (this.serialReader === reader) {
          this.serialReader = null;
        }
        this.readLoopActive = false;
      }
    })();
  }

  private async connectWebSocket(input: TCodeConnectInput): Promise<TCodeConnectResult> {
    const url = input.websocketUrl?.trim() ?? "";
    if (!/^wss?:\/\//i.test(url)) {
      return { success: false, error: "TCode WebSocket URL must start with ws:// or wss://." };
    }
    try {
      const ws = new WebSocket(url);
      return await new Promise<TCodeConnectResult>((resolve) => {
        let settled = false;
        const timeoutId = globalThis.setTimeout(() => {
          try {
            ws.close();
          } catch {
            // ignore close errors
          }
          settle({ success: false, error: "TCode WebSocket connection timed out." });
        }, TCODE_WEBSOCKET_CONNECT_TIMEOUT_MS);
        const settle = (result: TCodeConnectResult) => {
          if (settled) return;
          settled = true;
          globalThis.clearTimeout(timeoutId);
          resolve(result);
        };
        ws.onopen = () => {
          this.ws = ws;
          settle({ success: true });
        };
        ws.onerror = () => {
          settle({ success: false, error: "Failed to connect to TCode WebSocket." });
        };
        ws.onclose = () => {
          if (this.ws === ws) this.ws = null;
          settle({ success: false, error: "TCode WebSocket closed before connecting." });
        };
      });
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to connect to TCode WebSocket.",
      };
    }
  }
}

export async function listTCodeSerialPorts(): Promise<TCodeSerialPortInfo[]> {
  const serial = (globalThis.navigator as NavigatorWithSerial | undefined)?.serial;
  if (!serial) return [];
  const ports = await serial.getPorts();
  try {
    if (ports.length === 0) {
      const selectedPort = await serial.requestPort();
      if (!ports.includes(selectedPort)) ports.push(selectedPort);
    }
  } catch {
    // User cancelled or no port selected
  }
  const result: TCodeSerialPortInfo[] = [];
  for (const port of ports) {
    const label = getPortLabel(port, result.length);
    sharedSerialPorts.set(label, { port, label });
    result.push({ path: label, manufacturer: null });
  }
  return result;
}

export async function autoDetectTCodeSerialPort(
  input: TCodeAutoDetectSerialInput = {}
): Promise<TCodeAutoDetectSerialResult> {
  const ports = await listTCodeSerialPorts();
  if (ports.length === 0) {
    return { port: null, error: "No TCode serial ports are available." };
  }

  const baudRate = input.baudRate ?? 115200;
  for (const port of ports) {
    const probe = new TCodeTransportRenderer();
    const result = await probe.connect({
      transport: "serial",
      serialPath: port.path,
      baudRate,
    });
    if (!result.success) continue;

    const sent = probe.send(TCODE_SERIAL_AUTO_DETECT_COMMAND);
    await probe.disconnect();
    if (sent) return { port };
  }

  return { port: null, error: "Could not find a usable TCode serial port." };
}

const defaultTransport = new TCodeTransportRenderer();

export const tcodeTransportRenderer = {
  listPorts: () => listTCodeSerialPorts(),
  autoDetectSerialPort: (input?: TCodeAutoDetectSerialInput) => autoDetectTCodeSerialPort(input),
  connect: (input: TCodeConnectInput) => defaultTransport.connect(input),
  send: (command: string) => defaultTransport.send(command),
  disconnect: () => defaultTransport.disconnect(),
  isConnected: () => defaultTransport.isConnected(),
};
