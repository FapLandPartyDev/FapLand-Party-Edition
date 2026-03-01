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

export type TCodeListSerialPortsOptions = {
  requestPort?: boolean;
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
  forget?: () => Promise<void>;
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
const TCODE_SERIAL_OPERATION_TIMEOUT_MS = 5000;
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

function recordSerialEvent(payload: Record<string, unknown>): void {
  void globalThis.window?.electronAPI?.debug?.recordTCodeSerialEvent?.(payload).catch(() => undefined);
}

function isLinuxRenderer(): boolean {
  return /Linux/i.test(globalThis.navigator?.userAgent ?? "");
}

function serialErrorMessage(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message : fallback;
  if (!isLinuxRenderer()) return message;
  return `${message} Check that your user can access the device (often via the dialout or uucp group) and that no other application is using it.`;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeoutId = globalThis.setTimeout(() => reject(new Error(message)), timeoutMs);
    promise.then(
      (value) => {
        globalThis.clearTimeout(timeoutId);
        resolve(value);
      },
      (error) => {
        globalThis.clearTimeout(timeoutId);
        reject(error);
      }
    );
  });
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
    let disconnectError: Error | null = null;
    const reader = this.serialReader;
    if (reader) {
      try {
        await withTimeout(
          reader.cancel(),
          TCODE_SERIAL_OPERATION_TIMEOUT_MS,
          "Timed out stopping the TCode serial reader."
        );
      } catch {
        // Continue teardown even if the driver does not finish cancelling the reader.
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
      await withTimeout(
        this.readLoopPromise.catch(() => undefined),
        TCODE_SERIAL_OPERATION_TIMEOUT_MS,
        "Timed out waiting for the TCode serial reader to stop."
      ).catch(() => undefined);
      this.readLoopPromise = null;
    }
    if (this.activeSerialPort) {
      const port = this.activeSerialPort;
      try {
        await withTimeout(
          port.close(),
          TCODE_SERIAL_OPERATION_TIMEOUT_MS,
          "Timed out closing the TCode serial port."
        );
        this.activeSerialPort = null;
        recordSerialEvent({ stage: "close", success: true });
      } catch (error) {
        this.activeSerialPort = port;
        disconnectError = new Error(
          serialErrorMessage(error, "Failed to close the TCode serial port.")
        );
        recordSerialEvent({
          stage: "close",
          success: false,
          error: disconnectError.message,
        });
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
    if (disconnectError) throw disconnectError;
  }

  private async connectSerial(input: TCodeConnectInput): Promise<TCodeConnectResult> {
    if (!(globalThis.navigator as NavigatorWithSerial | undefined)?.serial) {
      return { success: false, error: "Web Serial API is not available in this environment." };
    }
    const path = input.serialPath?.trim() ?? "";
    const entry = sharedSerialPorts.get(path);
    if (!entry) return { success: false, error: "Select a TCode serial port." };
    const baudRate = input.baudRate ?? 115200;
    let openPromise: Promise<void> | null = null;
    recordSerialEvent({ stage: "open", portName: path, baudRate });
    try {
      openPromise = entry.port.open({ baudRate });
      await withTimeout(
        openPromise,
        TCODE_SERIAL_OPERATION_TIMEOUT_MS,
        `Timed out opening ${path}.`
      );
      this.activeSerialPort = entry.port;
      if (!entry.port.writable) {
        throw new Error("TCode serial port is not writable.");
      }
      this.serialWriter = entry.port.writable.getWriter();
      this.startReadLoop(entry.port);
      recordSerialEvent({ stage: "open", portName: path, baudRate, success: true });
      return { success: true };
    } catch (error) {
      // Web Serial cannot abort an in-progress open. If it resolves after our
      // timeout, close it so the device is not left locked in the background.
      if (openPromise) {
        void openPromise
          .then(async () => {
            if (this.activeSerialPort !== entry.port) {
              await withTimeout(
                entry.port.close(),
                TCODE_SERIAL_OPERATION_TIMEOUT_MS,
                "Timed out closing a late-opened TCode serial port."
              ).catch(() => undefined);
            }
          })
          .catch(() => undefined);
      }
      await this.disconnectNow().catch(() => undefined);
      const message = serialErrorMessage(error, "Failed to connect to TCode serial port.");
      recordSerialEvent({
        stage: "open",
        portName: path,
        baudRate,
        success: false,
        error: message,
      });
      return {
        success: false,
        error: message,
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

export async function listTCodeSerialPorts(
  options: TCodeListSerialPortsOptions = {}
): Promise<TCodeSerialPortInfo[]> {
  const serial = (globalThis.navigator as NavigatorWithSerial | undefined)?.serial;
  if (!serial) return [];
  let ports = await serial.getPorts();
  let selectedPort: WebSerialPort | null = null;
  try {
    if (options.requestPort) {
      await Promise.all(ports.map((port) => port.forget?.().catch(() => undefined)));
      selectedPort = await serial.requestPort();
      ports = [selectedPort];
    } else if (ports.length === 0) {
      selectedPort = await serial.requestPort();
      ports = [selectedPort];
    }
  } catch (error) {
    recordSerialEvent({
      stage: "selection",
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
    if (options.requestPort) ports = [];
    // User cancelled or no port selected
  }

  const selectedMetadata = await globalThis.window?.electronAPI?.serial
    ?.getSelectedPortMetadata()
    .catch(() => null);
  const result: TCodeSerialPortInfo[] = [];
  sharedSerialPorts.clear();
  for (const port of ports) {
    const useSelectedMetadata =
      selectedMetadata != null &&
      (port === selectedPort ||
        ports.length === 1 ||
        (ports.length > 1 &&
          Number(selectedMetadata.vendorId) === (port.getInfo().usbVendorId ?? NaN) &&
          Number(selectedMetadata.productId) === (port.getInfo().usbProductId ?? NaN)));
    const baseLabel = useSelectedMetadata
      ? selectedMetadata.portName
      : getPortLabel(port, result.length);
    let label = baseLabel;
    let duplicateIndex = 2;
    while (sharedSerialPorts.has(label)) {
      label = `${baseLabel} (${duplicateIndex})`;
      duplicateIndex += 1;
    }
    sharedSerialPorts.set(label, { port, label });
    result.push({
      path: label,
      manufacturer: useSelectedMetadata ? selectedMetadata.displayName : null,
    });
  }
  recordSerialEvent({
    stage: "enumeration",
    success: true,
    portCount: result.length,
    ports: result.map((port) => ({
      portName: port.path,
      displayName: port.manufacturer,
    })),
  });
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
  listPorts: (options?: TCodeListSerialPortsOptions) => listTCodeSerialPorts(options),
  autoDetectSerialPort: (input?: TCodeAutoDetectSerialInput) => autoDetectTCodeSerialPort(input),
  connect: (input: TCodeConnectInput) => defaultTransport.connect(input),
  send: (command: string) => defaultTransport.send(command),
  disconnect: () => defaultTransport.disconnect(),
  isConnected: () => defaultTransport.isConnected(),
};
