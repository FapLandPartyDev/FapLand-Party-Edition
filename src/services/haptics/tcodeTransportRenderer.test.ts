import { beforeEach, describe, expect, it, vi } from "vitest";

const mockWriter = { write: vi.fn(), releaseLock: vi.fn() };
const mockReader = {
  read: vi.fn(() => new Promise<ReadableStreamReadResult<Uint8Array>>(() => undefined)),
  releaseLock: vi.fn(),
};
const mockWritable = { getWriter: vi.fn(() => mockWriter) };
const mockReadable = { getReader: vi.fn(() => mockReader) };

const storedPorts: Array<Record<string, unknown>> = [];

function createMockSerialPort(
  options: { productId?: number; openFails?: boolean } = {}
): Record<string, unknown> {
  return {
    open: vi.fn(async () => {
      if (options.openFails) throw new Error("Port busy");
    }),
    close: vi.fn(async () => {}),
    readable: mockReadable as unknown as ReadableStream<Uint8Array>,
    writable: mockWritable as unknown as WritableStream<Uint8Array>,
    getInfo: vi.fn(() => ({ usbVendorId: 0x2341, usbProductId: options.productId ?? 0x0043 })),
  } as Record<string, unknown>;
}

function mockNavigatorSerial(options: { granted?: boolean } = {}) {
  const port = createMockSerialPort();
  if (options.granted !== false) storedPorts.push(port);
  const requestPort = vi.fn(async () => port);
  const getPorts = vi.fn(async () => storedPorts);
  Object.defineProperty(globalThis, "navigator", {
    value: {
      serial: {
        requestPort,
        getPorts,
      },
    },
    writable: true,
    configurable: true,
  });
  return { port, requestPort, getPorts };
}

function mockWebSocket() {
  const instances: MockWS[] = [];
  class MockWS {
    static OPEN = 1;
    readyState = 0;
    sent: string[] = [];
    onopen: (() => void) | null = null;
    onclose: (() => void) | null = null;
    onerror: (() => void) | null = null;
    constructor(readonly url: string) {
      instances.push(this);
    }
    send(data: string) {
      this.sent.push(data);
    }
    close() {
      this.readyState = 3;
    }
  }
  vi.stubGlobal("WebSocket", MockWS);
  return instances;
}

describe("tcodeTransportRenderer", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    storedPorts.length = 0;
    delete (globalThis as Record<string, unknown>).navigator;
    delete (globalThis as Record<string, unknown>).WebSocket;
  });

  it("lists serial ports via Web Serial API", async () => {
    const serial = mockNavigatorSerial();
    const { tcodeTransportRenderer } = await import("./tcodeTransportRenderer");
    const ports = await tcodeTransportRenderer.listPorts();
    expect(ports).toHaveLength(1);
    expect(ports[0]).toEqual({ path: "USB 2341:0043", manufacturer: null });
    expect(serial.requestPort).not.toHaveBeenCalled();
  });

  it("adds the selected serial port when no ports were already granted", async () => {
    const serial = mockNavigatorSerial({ granted: false });
    const { tcodeTransportRenderer } = await import("./tcodeTransportRenderer");
    const ports = await tcodeTransportRenderer.listPorts();
    expect(ports).toEqual([{ path: "USB 2341:0043", manufacturer: null }]);
    expect(serial.requestPort).toHaveBeenCalledTimes(1);
  });

  it("returns empty array when Web Serial API is unavailable", async () => {
    const { tcodeTransportRenderer } = await import("./tcodeTransportRenderer");
    const ports = await tcodeTransportRenderer.listPorts();
    expect(ports).toEqual([]);
  });

  it("connects and sends over serial", async () => {
    mockNavigatorSerial();
    const { tcodeTransportRenderer } = await import("./tcodeTransportRenderer");
    await tcodeTransportRenderer.listPorts();
    const result = await tcodeTransportRenderer.connect({
      transport: "serial",
      serialPath: "USB 2341:0043",
      baudRate: 115200,
    });
    expect(result.success).toBe(true);
    expect(tcodeTransportRenderer.send("L05000\n")).toBe(true);
    expect(mockWriter.write).toHaveBeenCalledWith(new TextEncoder().encode("L05000\n"));
    await tcodeTransportRenderer.disconnect();
  });

  it("auto-detects the first usable serial port", async () => {
    storedPorts.push(
      createMockSerialPort({ productId: 0x0001, openFails: true }),
      createMockSerialPort({ productId: 0x0002 })
    );
    Object.defineProperty(globalThis, "navigator", {
      value: {
        serial: {
          requestPort: vi.fn(),
          getPorts: vi.fn(async () => storedPorts),
        },
      },
      writable: true,
      configurable: true,
    });
    const { tcodeTransportRenderer } = await import("./tcodeTransportRenderer");
    const result = await tcodeTransportRenderer.autoDetectSerialPort({ baudRate: 115200 });
    expect(result.port?.path).toBe("USB 2341:0002");
    expect(mockWriter.write).toHaveBeenCalledWith(new TextEncoder().encode("L05000\n"));
    await tcodeTransportRenderer.disconnect();
  });

  it("connects and sends over websocket", async () => {
    const wsInstances = mockWebSocket();
    const { tcodeTransportRenderer } = await import("./tcodeTransportRenderer");
    const promise = tcodeTransportRenderer.connect({
      transport: "websocket",
      websocketUrl: "ws://192.168.1.42/ws",
    });
    await Promise.resolve();
    const ws = wsInstances[0]!;
    ws.readyState = 1;
    ws.onopen?.();
    await expect(promise).resolves.toEqual({ success: true });
    expect(tcodeTransportRenderer.send("L05000\n")).toBe(true);
    expect(ws.sent).toEqual(["L05000\n"]);
    await tcodeTransportRenderer.disconnect();
  });
});
