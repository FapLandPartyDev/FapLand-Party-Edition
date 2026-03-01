import { beforeEach, describe, expect, it, vi } from "vitest";
import { setTCodeTransportTestOverrides, tcodeTransport } from "./tcodeTransport";

const write = vi.fn();
const close = vi.fn((callback?: () => void) => callback?.());

class MockWebSocket {
  static instances: MockWebSocket[] = [];
  readyState = 0;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: ((event: { message?: string }) => void) | null = null;

  constructor(readonly url: string) {
    MockWebSocket.instances.push(this);
  }

  send(data: string) {
    this.sent.push(data);
  }

  close() {
    this.readyState = 3;
  }
}

describe("tcodeTransport", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    MockWebSocket.instances = [];
    setTCodeTransportTestOverrides({
      WebSocketImpl: MockWebSocket,
      serialPortModule: {
        SerialPort: Object.assign(
          vi.fn(function SerialPort(this: { isOpen: boolean }, _options: unknown) {
            this.isOpen = false;
            Object.assign(this, {
              open: vi.fn((callback: () => void) => {
                this.isOpen = true;
                callback();
              }),
              close,
              write,
              on: vi.fn(),
              removeAllListeners: vi.fn(),
            });
          }),
          {
            list: vi.fn(async () => [{ path: "/dev/ttyUSB0", manufacturer: "Maker" }]),
          }
        ) as never,
      },
    });
    await tcodeTransport.disconnect();
  });

  it("lists serial ports", async () => {
    await expect(tcodeTransport.listPorts()).resolves.toEqual([
      { path: "/dev/ttyUSB0", manufacturer: "Maker" },
    ]);
  });

  it("connects and sends over serial", async () => {
    await expect(
      tcodeTransport.connect({ transport: "serial", serialPath: "/dev/ttyUSB0", baudRate: 115200 })
    ).resolves.toEqual({ success: true });

    expect(tcodeTransport.send("L05000\n")).toBe(true);
    expect(write).toHaveBeenCalledWith("L05000\n");
  });

  it("connects and sends over websocket", async () => {
    const promise = tcodeTransport.connect({
      transport: "websocket",
      websocketUrl: "ws://192.168.1.42/ws",
    });
    await Promise.resolve();
    const ws = MockWebSocket.instances[0]!;
    ws.readyState = 1;
    ws.onopen?.();

    await expect(promise).resolves.toEqual({ success: true });
    expect(tcodeTransport.send("L05000\n")).toBe(true);
    expect(ws.sent).toEqual(["L05000\n"]);
  });
});
