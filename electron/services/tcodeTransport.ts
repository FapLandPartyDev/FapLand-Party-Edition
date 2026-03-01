import { createRequire } from "node:module";

export type TCodeTransportKind = "serial" | "websocket";

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

type SerialPortConstructor = new (options: {
  path: string;
  baudRate: number;
  dataBits: 8;
  stopBits: 1;
  parity: "none";
  autoOpen: false;
}) => {
  isOpen: boolean;
  open: (callback: (error?: Error | null) => void) => void;
  close: (callback?: () => void) => void;
  write: (data: string) => void;
  on: (event: string, callback: (...args: unknown[]) => void) => void;
  removeAllListeners: () => void;
};

type SerialPortModule = {
  SerialPort: SerialPortConstructor & {
    list: () => Promise<Array<{ path: string; manufacturer?: string }>>;
  };
};

type WebSocketLike = {
  readyState: number;
  send: (data: string) => void;
  close: () => void;
  onopen: (() => void) | null;
  onclose: (() => void) | null;
  onerror: ((event: { message?: string }) => void) | null;
};

type WebSocketConstructor = new (url: string) => WebSocketLike;

let serialPortModuleOverride: SerialPortModule | null = null;
let webSocketOverride: WebSocketConstructor | null | undefined;
const requireFromElectronMain = createRequire(import.meta.url);

export function setTCodeTransportTestOverrides(input: {
  serialPortModule?: SerialPortModule | null;
  WebSocketImpl?: WebSocketConstructor | null;
}): void {
  if ("serialPortModule" in input) serialPortModuleOverride = input.serialPortModule ?? null;
  if ("WebSocketImpl" in input) webSocketOverride = input.WebSocketImpl;
}

async function loadSerialPort(): Promise<SerialPortModule> {
  if (serialPortModuleOverride) return serialPortModuleOverride;
  try {
    return requireFromElectronMain("serialport") as SerialPortModule;
  } catch (error) {
    throw new Error(
      `Serial TCode support requires the serialport package. Install dependencies and restart the app.${error instanceof Error ? ` ${error.message}` : ""}`
    );
  }
}

class TCodeTransportManager {
  private serialPort: InstanceType<SerialPortConstructor> | null = null;
  private ws: WebSocketLike | null = null;

  async listPorts(): Promise<TCodeSerialPortInfo[]> {
    const module = await loadSerialPort();
    const ports = await module.SerialPort.list();
    return ports.map((port) => ({
      path: port.path,
      manufacturer: port.manufacturer ?? null,
    }));
  }

  async connect(input: TCodeConnectInput): Promise<TCodeConnectResult> {
    await this.disconnect();
    if (input.transport === "serial") {
      return this.connectSerial(input);
    }
    return this.connectWebSocket(input);
  }

  send(command: string): boolean {
    if (this.serialPort?.isOpen) {
      try {
        this.serialPort.write(command);
        return true;
      } catch {
        return false;
      }
    }
    if (this.ws?.readyState === 1) {
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
    const serialPort = this.serialPort;
    this.serialPort = null;
    if (serialPort?.isOpen) {
      await new Promise<void>((resolve) => {
        try {
          serialPort.close(resolve);
        } catch {
          resolve();
        }
      });
    }

    const ws = this.ws;
    this.ws = null;
    if (ws) {
      try {
        ws.close();
      } catch {
        // ignore teardown failures
      }
    }
  }

  isConnected(): boolean {
    return Boolean(this.serialPort?.isOpen || this.ws?.readyState === 1);
  }

  private async connectSerial(input: TCodeConnectInput): Promise<TCodeConnectResult> {
    const path = input.serialPath?.trim() ?? "";
    if (!path) return { success: false, error: "Select a TCode serial port." };
    const baudRate = input.baudRate ?? 115200;
    try {
      const module = await loadSerialPort();
      const port = new module.SerialPort({
        path,
        baudRate,
        dataBits: 8,
        stopBits: 1,
        parity: "none",
        autoOpen: false,
      });
      return await new Promise((resolve) => {
        port.open((error) => {
          if (error) {
            resolve({ success: false, error: error.message });
            return;
          }
          port.on("close", () => {
            if (this.serialPort === port) this.serialPort = null;
          });
          this.serialPort = port;
          resolve({ success: true });
        });
      });
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to connect to TCode serial port.",
      };
    }
  }

  private async connectWebSocket(input: TCodeConnectInput): Promise<TCodeConnectResult> {
    const url = input.websocketUrl?.trim() ?? "";
    if (!/^wss?:\/\//i.test(url)) {
      return { success: false, error: "TCode WebSocket URL must start with ws:// or wss://." };
    }
    const WebSocketImpl =
      webSocketOverride === undefined
        ? ((globalThis as typeof globalThis & { WebSocket?: WebSocketConstructor }).WebSocket ??
          null)
        : webSocketOverride;
    if (!WebSocketImpl) {
      return { success: false, error: "WebSocket runtime is unavailable." };
    }

    try {
      const ws = new WebSocketImpl(url);
      return await new Promise((resolve) => {
        let resolved = false;
        const settle = (result: TCodeConnectResult) => {
          if (resolved) return;
          resolved = true;
          resolve(result);
        };
        ws.onopen = () => {
          this.ws = ws;
          settle({ success: true });
        };
        ws.onerror = (event) => {
          settle({
            success: false,
            error: event.message ?? "Failed to connect to TCode WebSocket.",
          });
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

const manager = new TCodeTransportManager();

export const tcodeTransport = {
  listPorts: () => manager.listPorts(),
  connect: (input: TCodeConnectInput) => manager.connect(input),
  send: (command: string) => manager.send(command),
  disconnect: () => manager.disconnect(),
  isConnected: () => manager.isConnected(),
};
