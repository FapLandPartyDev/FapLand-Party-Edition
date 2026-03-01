import { beforeEach, describe, expect, it, vi } from "vitest";

type MockSerialPort = Record<string, unknown> & {
  open: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  forget: ReturnType<typeof vi.fn>;
  writer: {
    write: ReturnType<typeof vi.fn>;
    releaseLock: ReturnType<typeof vi.fn>;
  };
  reader: {
    read: ReturnType<typeof vi.fn>;
    cancel: ReturnType<typeof vi.fn>;
    releaseLock: ReturnType<typeof vi.fn>;
  };
  isOpen: () => boolean;
};

const storedPorts: MockSerialPort[] = [];

function createMockSerialPort(
  options: { productId?: number; openFails?: boolean } = {}
): MockSerialPort {
  let open = false;
  let readerLocked = false;
  let writerLocked = false;
  let pendingReadResolve: ((result: ReadableStreamReadResult<Uint8Array>) => void) | null = null;

  const writer = {
    write: vi.fn(async () => {}),
    releaseLock: vi.fn(() => {
      writerLocked = false;
    }),
  };
  const reader = {
    read: vi.fn(
      () =>
        new Promise<ReadableStreamReadResult<Uint8Array>>((resolve) => {
          pendingReadResolve = resolve;
        })
    ),
    cancel: vi.fn(async () => {
      pendingReadResolve?.({ done: true, value: undefined });
      pendingReadResolve = null;
    }),
    releaseLock: vi.fn(() => {
      readerLocked = false;
    }),
  };
  const writable = {
    getWriter: vi.fn(() => {
      if (writerLocked) throw new Error("Writable stream is already locked.");
      writerLocked = true;
      return writer;
    }),
  };
  const readable = {
    getReader: vi.fn(() => {
      if (readerLocked) throw new Error("Readable stream is already locked.");
      readerLocked = true;
      return reader;
    }),
  };

  return {
    open: vi.fn(async () => {
      if (options.openFails) throw new Error("Port busy");
      if (open) {
        throw new Error(
          "Failed to execute 'open' on 'SerialPort': The port is already open."
        );
      }
      open = true;
    }),
    close: vi.fn(async () => {
      if (readerLocked || writerLocked) {
        throw new Error("Cannot close a serial port while streams are locked.");
      }
      open = false;
    }),
    forget: vi.fn(async () => {}),
    readable: readable as unknown as ReadableStream<Uint8Array>,
    writable: writable as unknown as WritableStream<Uint8Array>,
    getInfo: vi.fn(() => ({ usbVendorId: 0x2341, usbProductId: options.productId ?? 0x0043 })),
    writer,
    reader,
    isOpen: () => open,
  } as MockSerialPort;
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
    vi.useRealTimers();
    vi.resetModules();
    vi.clearAllMocks();
    storedPorts.length = 0;
    delete (globalThis as Record<string, unknown>).navigator;
    delete (globalThis as Record<string, unknown>).WebSocket;
    delete (globalThis.window as unknown as Record<string, unknown>).electronAPI;
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

  it("uses Electron metadata to display the selected Linux device path", async () => {
    const serial = mockNavigatorSerial({ granted: false });
    Object.defineProperty(globalThis.window, "electronAPI", {
      value: {
        serial: {
          getSelectedPortMetadata: vi.fn(async () => ({
            portName: "/dev/ttyUSB0",
            displayName: "TCodeESP32",
            vendorId: "9025",
            productId: "67",
          })),
        },
      },
      configurable: true,
    });
    const { tcodeTransportRenderer } = await import("./tcodeTransportRenderer");

    const ports = await tcodeTransportRenderer.listPorts({ requestPort: true });

    expect(ports).toEqual([{ path: "/dev/ttyUSB0", manufacturer: "TCodeESP32" }]);
    expect(serial.requestPort).toHaveBeenCalledTimes(1);
  });

  it("forgets existing grants before explicitly choosing another port", async () => {
    const serial = mockNavigatorSerial();
    const { tcodeTransportRenderer } = await import("./tcodeTransportRenderer");

    await tcodeTransportRenderer.listPorts({ requestPort: true });

    expect(serial.port.forget).toHaveBeenCalledTimes(1);
    expect(serial.requestPort).toHaveBeenCalledTimes(1);
  });

  it("returns empty array when Web Serial API is unavailable", async () => {
    const { tcodeTransportRenderer } = await import("./tcodeTransportRenderer");
    const ports = await tcodeTransportRenderer.listPorts();
    expect(ports).toEqual([]);
  });

  it("connects and sends over serial", async () => {
    const serial = mockNavigatorSerial();
    const { tcodeTransportRenderer } = await import("./tcodeTransportRenderer");
    await tcodeTransportRenderer.listPorts();
    const result = await tcodeTransportRenderer.connect({
      transport: "serial",
      serialPath: "USB 2341:0043",
      baudRate: 115200,
    });
    expect(result.success).toBe(true);
    expect(tcodeTransportRenderer.send("L05000\n")).toBe(true);
    expect(serial.port.writer.write).toHaveBeenCalledWith(new TextEncoder().encode("L05000\n"));
    await tcodeTransportRenderer.disconnect();
    expect(serial.port.isOpen()).toBe(false);
  });

  it("reconnects the same serial port after disconnecting", async () => {
    const serial = mockNavigatorSerial();
    const { tcodeTransportRenderer } = await import("./tcodeTransportRenderer");
    await tcodeTransportRenderer.listPorts();

    const first = await tcodeTransportRenderer.connect({
      transport: "serial",
      serialPath: "USB 2341:0043",
      baudRate: 115200,
    });
    expect(first.success).toBe(true);

    await tcodeTransportRenderer.disconnect();
    expect(serial.port.isOpen()).toBe(false);

    const second = await tcodeTransportRenderer.connect({
      transport: "serial",
      serialPath: "USB 2341:0043",
      baudRate: 115200,
    });
    expect(second.success).toBe(true);
    expect(serial.port.open).toHaveBeenCalledTimes(2);
    expect(second.error).toBeUndefined();

    await tcodeTransportRenderer.disconnect();
  });

  it("serializes concurrent serial connect attempts", async () => {
    const serial = mockNavigatorSerial();
    const { tcodeTransportRenderer } = await import("./tcodeTransportRenderer");
    await tcodeTransportRenderer.listPorts();

    const [first, second] = await Promise.all([
      tcodeTransportRenderer.connect({
        transport: "serial",
        serialPath: "USB 2341:0043",
        baudRate: 115200,
      }),
      tcodeTransportRenderer.connect({
        transport: "serial",
        serialPath: "USB 2341:0043",
        baudRate: 115200,
      }),
    ]);

    expect(first.success).toBe(true);
    expect(second.success).toBe(true);
    expect(first.error).toBeUndefined();
    expect(second.error).toBeUndefined();
    expect(serial.port.open).toHaveBeenCalledTimes(2);

    await tcodeTransportRenderer.disconnect();
  });

  it("returns an error instead of hanging when opening a serial port stalls", async () => {
    vi.useFakeTimers();
    const serial = mockNavigatorSerial();
    serial.port.open.mockImplementation(() => new Promise<void>(() => {}));
    const { tcodeTransportRenderer } = await import("./tcodeTransportRenderer");
    await tcodeTransportRenderer.listPorts();

    const connection = tcodeTransportRenderer.connect({
      transport: "serial",
      serialPath: "USB 2341:0043",
      baudRate: 115200,
    });
    await vi.advanceTimersByTimeAsync(5000);

    await expect(connection).resolves.toMatchObject({
      success: false,
      error: expect.stringContaining("Timed out opening USB 2341:0043"),
    });
  });

  it("returns an error instead of hanging when closing a serial port stalls", async () => {
    vi.useFakeTimers();
    const serial = mockNavigatorSerial();
    const { tcodeTransportRenderer } = await import("./tcodeTransportRenderer");
    await tcodeTransportRenderer.listPorts();
    await tcodeTransportRenderer.connect({
      transport: "serial",
      serialPath: "USB 2341:0043",
      baudRate: 115200,
    });
    serial.port.close.mockImplementation(() => new Promise<void>(() => {}));

    const disconnection = tcodeTransportRenderer.disconnect();
    const expectation = expect(disconnection).rejects.toThrow(
      "Timed out closing the TCode serial port"
    );
    await vi.advanceTimersByTimeAsync(5000);

    await expectation;
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
    expect(storedPorts[1]!.writer.write).toHaveBeenCalledWith(
      new TextEncoder().encode("L05000\n")
    );
    expect(storedPorts.every((port) => !port.isOpen())).toBe(true);
    await tcodeTransportRenderer.disconnect();
  });

  it("connects and sends over websocket", async () => {
    const wsInstances = mockWebSocket();
    const { tcodeTransportRenderer } = await import("./tcodeTransportRenderer");
    const promise = tcodeTransportRenderer.connect({
      transport: "websocket",
      websocketUrl: "ws://192.168.1.42/ws",
    });
    await vi.waitFor(() => {
      expect(wsInstances).toHaveLength(1);
    });
    const ws = wsInstances[0]!;
    ws.readyState = 1;
    ws.onopen?.();
    await expect(promise).resolves.toEqual({ success: true });
    expect(tcodeTransportRenderer.send("L05000\n")).toBe(true);
    expect(ws.sent).toEqual(["L05000\n"]);
    await tcodeTransportRenderer.disconnect();
  });
});
