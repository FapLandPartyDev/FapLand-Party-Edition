import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  intifaceAdapter,
  setIntifaceButtplugModuleForTests,
  type IntifaceHapticsSession,
} from "./intifaceAdapter";
import type { HapticsConnectionConfig } from "./types";

const runOutput = vi.fn(async () => undefined);
const stop = vi.fn(async () => undefined);
const disconnect = vi.fn(async () => undefined);
const startScanning = vi.fn(async () => undefined);
const stopScanning = vi.fn(async () => undefined);

function createModule(devices: unknown[]) {
  return {
    OutputType: { Position: "Position", Vibrate: "Vibrate" },
    DeviceOutput: {
      PositionWithDuration: {
        percent: (position: number, durationMs: number) => ({
          type: "position",
          position,
          durationMs,
        }),
      },
    },
    ButtplugBrowserWebsocketClientConnector: vi.fn(function Connector(this: unknown, address: string) {
      Object.assign(this as object, { address });
    }),
    ButtplugClient: vi.fn(function Client(this: { devices: Map<number, unknown> }) {
      this.devices = new Map(devices.map((device, index) => [index, device]));
      Object.assign(this, {
        connect: vi.fn(async () => undefined),
        disconnect,
        startScanning,
        stopScanning,
      });
    }),
  };
}

const config: HapticsConnectionConfig = {
  provider: "intiface",
  websocketUrl: "ws://127.0.0.1:12345",
  deviceName: null,
  deviceIndex: null,
  stroke: { min: 0.2, max: 0.8, minAbsolute: null, maxAbsolute: null },
};

describe("intifaceAdapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setIntifaceButtplugModuleForTests(null);
  });

  it("connects when a position-capable device exists", async () => {
    setIntifaceButtplugModuleForTests(
      createModule([
        {
          name: "Linear Device",
          hasOutput: (type: unknown) => type === "Position",
          runOutput,
          stop,
        },
      ]) as never
    );

    const result = await intifaceAdapter.verifyConnection(config);

    expect(result).toMatchObject({
      success: true,
      provider: "intiface",
      deviceName: "Linear Device",
      deviceIndex: 0,
    });
    expect(disconnect).toHaveBeenCalledTimes(1);
  });

  it("fails clearly when only non-position devices exist", async () => {
    setIntifaceButtplugModuleForTests(
      createModule([
        {
          name: "Vibe Device",
          hasOutput: (type: unknown) => type === "Vibrate",
          runOutput,
          stop,
        },
      ]) as never
    );

    const result = await intifaceAdapter.verifyConnection(config);

    expect(result.success).toBe(false);
    expect(result.message).toContain("no linear/position-capable device");
  });

  it("sends position-with-duration commands and applies stroke range", async () => {
    setIntifaceButtplugModuleForTests(
      createModule([
        {
          name: "Linear Device",
          hasOutput: (type: unknown) => type === "Position",
          runOutput,
          stop,
        },
      ]) as never
    );
    const session = await intifaceAdapter.createSession(config);

    await intifaceAdapter.sendSync(config, session, 500, 1, "script", [
      { at: 0, pos: 0 },
      { at: 1000, pos: 100 },
    ]);

    expect(runOutput).toHaveBeenCalledWith({
      type: "position",
      position: 0.5,
      durationMs: 500,
    });
  });

  it("stops devices on pause, stop, and disconnect", async () => {
    setIntifaceButtplugModuleForTests(
      createModule([
        {
          name: "Linear Device",
          hasOutput: (type: unknown) => type === "Position",
          runOutput,
          stop,
        },
      ]) as never
    );
    const session = (await intifaceAdapter.createSession(config)) as IntifaceHapticsSession;

    await intifaceAdapter.pausePlayback(config, session);
    await intifaceAdapter.stopPlayback(config, session);
    await intifaceAdapter.disconnect!(config, session);

    expect(stop).toHaveBeenCalledTimes(3);
    expect(disconnect).toHaveBeenCalledTimes(1);
  });
});
