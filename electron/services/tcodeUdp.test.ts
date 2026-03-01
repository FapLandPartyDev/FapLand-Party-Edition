// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const dnsMock = vi.hoisted(() => ({ lookup: vi.fn() }));
const debugMock = vi.hoisted(() => ({ debug: vi.fn(), info: vi.fn(), error: vi.fn() }));

type MockSocket = {
  unref: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  once: ReturnType<typeof vi.fn>;
  removeListener: ReturnType<typeof vi.fn>;
  removeAllListeners: ReturnType<typeof vi.fn>;
  connect: ReturnType<typeof vi.fn>;
  send: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
};

const dgramMock = vi.hoisted(() => {
  const sockets: MockSocket[] = [];
  const state = { failNextConnect: false };
  const createSocket = vi.fn((): MockSocket => {
    let errorCallback: ((error: Error) => void) | null = null;
    const socket: MockSocket = {
      unref: vi.fn(),
      on: vi.fn(),
      once: vi.fn((event: string, cb: (error: Error) => void) => {
        if (event === "error") errorCallback = cb;
      }),
      removeListener: vi.fn(),
      removeAllListeners: vi.fn(),
      connect: vi.fn((_port: number, _address: string, callback: () => void) => {
        if (state.failNextConnect) errorCallback?.(new Error("connect ECONNREFUSED"));
        else callback();
      }),
      send: vi.fn(
        (_payload: Buffer, _offset: number, _length: number, callback?: (error: Error | null) => void) => {
          callback?.(null);
        }
      ),
      close: vi.fn(),
    };
    sockets.push(socket);
    return socket;
  });
  return { sockets, state, createSocket };
});

vi.mock("node:dns/promises", () => ({ default: dnsMock }));
vi.mock("node:dgram", () => ({ default: { createSocket: dgramMock.createSocket } }));
vi.mock("./debugLogging", () => ({ debugLog: debugMock }));

const {
  connectTCodeUdp,
  disconnectTCodeUdp,
  sendTCodeUdp,
  __resetTCodeUdpForTests,
} = await import("./tcodeUdp");

describe("tcodeUdp", () => {
  beforeEach(() => {
    dgramMock.sockets.length = 0;
    dgramMock.state.failNextConnect = false;
    dgramMock.createSocket.mockClear();
    dnsMock.lookup.mockReset();
    __resetTCodeUdpForTests();
  });

  it("resolves the host and connects a udp4 socket", async () => {
    dnsMock.lookup.mockResolvedValue({ address: "192.168.4.1", family: 4 });

    const result = await connectTCodeUdp({ host: "192.168.4.1", port: 8000 });

    expect(result).toEqual({ success: true });
    expect(dgramMock.createSocket).toHaveBeenCalledWith("udp4");
    expect(dnsMock.lookup).toHaveBeenCalledWith("192.168.4.1", { verbatim: true });
    expect(dgramMock.sockets[0]!.connect).toHaveBeenCalledWith(
      8000,
      "192.168.4.1",
      expect.any(Function)
    );
    expect(dgramMock.sockets[0]!.unref).toHaveBeenCalled();
  });

  it("uses udp6 for ipv6 resolutions", async () => {
    dnsMock.lookup.mockResolvedValue({ address: "fd00::1", family: 6 });

    await connectTCodeUdp({ host: "tcode.local", port: 8000 });

    expect(dgramMock.createSocket).toHaveBeenCalledWith("udp6");
  });

  it("strips an embedded port before resolving and keeps the explicit port", async () => {
    dnsMock.lookup.mockResolvedValue({ address: "192.168.4.1", family: 4 });

    await connectTCodeUdp({ host: "192.168.4.1:8081", port: 8081 });

    expect(dnsMock.lookup).toHaveBeenCalledWith("192.168.4.1", { verbatim: true });
    expect(dgramMock.sockets[0]!.connect).toHaveBeenCalledWith(
      8081,
      "192.168.4.1",
      expect.any(Function)
    );
  });

  it("derives the port from the host when no explicit port is given", async () => {
    dnsMock.lookup.mockResolvedValue({ address: "192.168.4.1", family: 4 });

    await connectTCodeUdp({ host: "192.168.4.1:8081", port: Number.NaN });

    expect(dgramMock.sockets[0]!.connect).toHaveBeenCalledWith(
      8081,
      "192.168.4.1",
      expect.any(Function)
    );
  });

  it("rejects invalid hosts and ports", async () => {
    await expect(connectTCodeUdp({ host: "", port: 8000 })).resolves.toMatchObject({
      success: false,
    });
    await expect(connectTCodeUdp({ host: "not a host!", port: 8000 })).resolves.toMatchObject({
      success: false,
    });
    await expect(connectTCodeUdp({ host: "192.168.4.1", port: 0 })).resolves.toMatchObject({
      success: false,
      error: expect.stringContaining("port"),
    });
    expect(dnsMock.lookup).not.toHaveBeenCalled();
  });

  it("fails when the host cannot be resolved", async () => {
    dnsMock.lookup.mockRejectedValue(new Error("ENOTFOUND"));

    await expect(connectTCodeUdp({ host: "tcode.missing", port: 8000 })).resolves.toMatchObject({
      success: false,
      error: expect.stringContaining("Could not resolve"),
    });
    expect(dgramMock.createSocket).not.toHaveBeenCalled();
  });

  it("fails when connecting the socket errors", async () => {
    dnsMock.lookup.mockResolvedValue({ address: "192.168.4.1", family: 4 });
    dgramMock.state.failNextConnect = true;

    await expect(connectTCodeUdp({ host: "192.168.4.1", port: 8000 })).resolves.toMatchObject({
      success: false,
      error: "connect ECONNREFUSED",
    });
    expect(dgramMock.sockets[0]!.close).toHaveBeenCalled();
  });

  it("sends utf8 datagrams while connected and ignores sends otherwise", async () => {
    dnsMock.lookup.mockResolvedValue({ address: "192.168.4.1", family: 4 });
    await connectTCodeUdp({ host: "192.168.4.1", port: 8000 });

    sendTCodeUdp("L05000\n");
    expect(dgramMock.sockets[0]!.send).toHaveBeenCalledWith(
      Buffer.from("L05000\n", "utf8"),
      0,
      7,
      expect.any(Function)
    );

    disconnectTCodeUdp();
    expect(dgramMock.sockets[0]!.close).toHaveBeenCalled();
    dgramMock.sockets[0]!.send.mockClear();
    sendTCodeUdp("L05000\n");
    expect(dgramMock.sockets[0]!.send).not.toHaveBeenCalled();
  });

  it("closes the previous socket when reconnecting", async () => {
    dnsMock.lookup.mockResolvedValue({ address: "192.168.4.1", family: 4 });
    await connectTCodeUdp({ host: "192.168.4.1", port: 8000 });
    await connectTCodeUdp({ host: "192.168.4.1", port: 8001 });

    expect(dgramMock.sockets).toHaveLength(2);
    expect(dgramMock.sockets[0]!.close).toHaveBeenCalled();
    expect(dgramMock.sockets[0]!.removeAllListeners).toHaveBeenCalled();
  });
});
