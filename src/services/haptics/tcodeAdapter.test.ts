import { beforeEach, describe, expect, it, vi } from "vitest";
import { formatTCodeAxisCommand, tcodeAdapter, type TCodeHapticsSession } from "./tcodeAdapter";
import type { HapticsConnectionConfig } from "./types";

const connect = vi.fn(async () => ({ success: true }));
const send = vi.fn(async () => true);
const disconnect = vi.fn(async () => undefined);

const config: HapticsConnectionConfig = {
  provider: "tcode",
  transport: "websocket",
  serialPath: "",
  baudRate: 115200,
  websocketHost: "192.168.1.42",
  websocketUrl: "ws://192.168.1.42/ws",
  precision: 4,
  axis: "L0",
  stroke: { min: 0.2, max: 0.8, minAbsolute: null, maxAbsolute: null },
};

function installBridge() {
  Object.defineProperty(window, "electronAPI", {
    configurable: true,
    value: {
      tcode: {
        connect,
        send,
        disconnect,
      },
    },
  });
}

describe("tcodeAdapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    installBridge();
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

    expect(connect).toHaveBeenCalledWith({
      transport: "websocket",
      serialPath: "",
      baudRate: 115200,
      websocketUrl: "ws://192.168.1.42/ws",
    });
    expect(send).toHaveBeenCalledWith("L07999I500\n");
  });

  it("does not resend the same target command", async () => {
    const session = await tcodeAdapter.createSession(config);
    const actions = [
      { at: 0, pos: 0 },
      { at: 1000, pos: 100 },
    ];

    await tcodeAdapter.sendSync(config, session, 500, 1, "script", actions);
    await tcodeAdapter.sendSync(config, session, 500, 1, "script", actions);

    expect(send).toHaveBeenCalledTimes(1);
  });

  it("resends after a seek", async () => {
    const session = await tcodeAdapter.createSession(config);
    const actions = [
      { at: 0, pos: 0 },
      { at: 1000, pos: 100 },
    ];

    await tcodeAdapter.sendSync(config, session, 500, 1, "script", actions);
    await tcodeAdapter.sendSync(config, session, 100, 1, "script", actions);

    expect(send).toHaveBeenCalledTimes(2);
  });

  it("sends stop and neutral fallback on stop", async () => {
    const session = (await tcodeAdapter.createSession(config)) as TCodeHapticsSession;

    await tcodeAdapter.stopPlayback(config, session);

    expect(send).toHaveBeenCalledWith("DSTOP\nL05000\n");
  });
});
