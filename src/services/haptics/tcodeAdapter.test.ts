import { beforeEach, describe, expect, it, vi } from "vitest";
import { formatTCodeAxisCommand, tcodeAdapter, type TCodeHapticsSession } from "./tcodeAdapter";
import type { HapticsConnectionConfig } from "./types";

const transportMocks = vi.hoisted(() => ({
  connect: vi.fn(async () => ({ success: true })),
  send: vi.fn(() => true),
  disconnect: vi.fn(async () => undefined),
}));

vi.mock("./tcodeTransportRenderer", () => ({
  TCodeTransportRenderer: class {
    connect = transportMocks.connect;
    send = transportMocks.send;
    disconnect = transportMocks.disconnect;
  },
}));

const config: HapticsConnectionConfig = {
  provider: "tcode",
  transport: "websocket",
  serialPath: "",
  baudRate: 115200,
  websocketHost: "192.168.1.42",
  websocketUrl: "ws://192.168.1.42/ws",
  udpHost: "",
  precision: 4,
  axis: "L0",
  stroke: { min: 0.2, max: 0.8, minAbsolute: null, maxAbsolute: null },
};

const udpConfig: HapticsConnectionConfig = {
  ...config,
  transport: "udp",
  udpHost: "192.168.1.42",
};

describe("tcodeAdapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    transportMocks.connect.mockResolvedValue({ success: true });
    transportMocks.send.mockReturnValue(true);
    transportMocks.disconnect.mockResolvedValue(undefined);
  });

  it("formats v0.3 and v0.2 axis commands", () => {
    expect(formatTCodeAxisCommand("L0", 50, 4, 120)).toBe("L05000I120\n");
    expect(formatTCodeAxisCommand("L0", 50, 3, 120)).toBe("L0500I120\n");
  });

  it("connects and sends commands with stroke adjustment", async () => {
    const session = await tcodeAdapter.createSession(config);

    await tcodeAdapter.sendSync(config, session, 500, 1, "script", [
      { at: 0, pos: 0 },
      { at: 1000, pos: 100 },
    ]);

    expect(transportMocks.connect).toHaveBeenCalledWith({
      transport: "websocket",
      serialPath: "",
      baudRate: 115200,
      websocketUrl: "ws://192.168.1.42/ws",
      udpHost: "",
    });
    expect(transportMocks.send).toHaveBeenCalledWith("L07999I500\n");
  });

  it("passes the udp host through to the transport", async () => {
    await tcodeAdapter.createSession(udpConfig);

    expect(transportMocks.connect).toHaveBeenCalledWith({
      transport: "udp",
      serialPath: "",
      baudRate: 115200,
      websocketUrl: "ws://192.168.1.42/ws",
      udpHost: "192.168.1.42",
    });
  });

  it("reports the udp host as the device name", async () => {
    await expect(tcodeAdapter.verifyConnection(udpConfig)).resolves.toMatchObject({
      success: true,
      deviceName: "192.168.1.42",
    });
  });

  it("rejects udp connections without a host", async () => {
    await expect(tcodeAdapter.verifyConnection({ ...udpConfig, udpHost: "" })).resolves.toMatchObject({
      success: false,
      message: "Enter a TCode UDP device IP address before connecting.",
    });
  });

  it("does not resend the same target command", async () => {
    const session = await tcodeAdapter.createSession(config);
    const actions = [
      { at: 0, pos: 0 },
      { at: 1000, pos: 100 },
    ];

    await tcodeAdapter.sendSync(config, session, 500, 1, "script", actions);
    await tcodeAdapter.sendSync(config, session, 500, 1, "script", actions);

    expect(transportMocks.send).toHaveBeenCalledTimes(1);
  });

  it("resends after a seek", async () => {
    const session = await tcodeAdapter.createSession(config);
    const actions = [
      { at: 0, pos: 0 },
      { at: 1000, pos: 100 },
    ];

    await tcodeAdapter.sendSync(config, session, 500, 1, "script", actions);
    await tcodeAdapter.sendSync(config, session, 100, 1, "script", actions);

    expect(transportMocks.send).toHaveBeenCalledTimes(2);
  });

  it("sends stop and neutral fallback on stop", async () => {
    const session = (await tcodeAdapter.createSession(config)) as TCodeHapticsSession;

    await tcodeAdapter.stopPlayback(config, session);

    expect(transportMocks.send).toHaveBeenCalledWith("DSTOP\nL05000\n");
  });

  it("fails verification when the test command cannot be sent", async () => {
    transportMocks.send.mockReturnValue(false);

    await expect(tcodeAdapter.verifyConnection(config)).resolves.toMatchObject({
      success: false,
      message: "Connected to the TCode device but failed to send a command.",
    });
  });

  it("fails verification when the tested serial port cannot be closed", async () => {
    transportMocks.disconnect.mockRejectedValue(new Error("Timed out closing serial port."));

    await expect(tcodeAdapter.verifyConnection(config)).resolves.toMatchObject({
      success: false,
      message: "Timed out closing serial port.",
    });
  });
});
