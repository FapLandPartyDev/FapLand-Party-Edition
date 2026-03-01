import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  intifaceAdapter,
  buildIntifaceVersionError,
  parseIntifaceMajorVersion,
  resetIntifaceConnectionsForTests,
  setIntifaceButtplugModuleForTests,
  type IntifaceHapticsSession,
} from "./intifaceAdapter";
import type { HapticsConnectionConfig } from "./types";

const runOutput = vi.fn(async (_output: unknown) => {
  void _output;
  return undefined;
});
const stop = vi.fn(async () => undefined);
const disconnect = vi.fn(async () => undefined);
const startScanning = vi.fn(async () => undefined);
const stopScanning = vi.fn(async () => undefined);

function createModule(devices: unknown[], serverName = "Intiface Server") {
  const messageListeners: Array<(messages: unknown) => void> = [];
  return {
    OutputType: {
      Position: "Position",
      HwPositionWithDuration: "HwPositionWithDuration",
      Vibrate: "Vibrate",
    },
    DeviceOutput: {
      PositionWithDuration: {
        percent: (position: number, durationMs: number) => ({
          type: "position-with-duration",
          position,
          durationMs,
        }),
      },
      Position: {
        percent: (position: number) => ({
          type: "position",
          position,
        }),
      },
      Vibrate: {
        percent: (intensity: number) => ({
          type: "vibrate",
          intensity,
        }),
      },
    },
    ButtplugBrowserWebsocketClientConnector: vi.fn(function Connector(
      this: {
        addListener: (event: string, listener: (messages: unknown) => void) => void;
        removeListener: (event: string, listener: (messages: unknown) => void) => void;
      }
    ) {
      this.addListener = (event: string, listener: (messages: unknown) => void) => {
        if (event === "message") messageListeners.push(listener);
      };
      this.removeListener = (event: string, listener: (messages: unknown) => void) => {
        if (event === "message") {
          const idx = messageListeners.indexOf(listener);
          if (idx >= 0) messageListeners.splice(idx, 1);
        }
      };
    }),
    ButtplugClient: vi.fn(function Client(this: { devices: Map<number, unknown> }) {
      this.devices = new Map(devices.map((device, index) => [index, device]));
      Object.assign(this, {
        connect: vi.fn(async () => {
          for (const listener of messageListeners) {
            listener([{ ServerInfo: { ServerName: serverName, MaxPingTime: 0 } }]);
          }
        }),
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
  vibrationSensitivity: 1,
};

describe("intifaceAdapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetIntifaceConnectionsForTests();
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

  it("connects when a device only advertises hardware position-with-duration", async () => {
    setIntifaceButtplugModuleForTests(
      createModule([
        {
          name: "The Handy",
          hasOutput: (type: unknown) => type === "HwPositionWithDuration",
          runOutput,
          stop,
        },
      ]) as never
    );

    const result = await intifaceAdapter.verifyConnection(config);

    expect(result).toMatchObject({
      success: true,
      provider: "intiface",
      deviceName: "The Handy",
      deviceIndex: 0,
    });
  });

  it("fails clearly when no position- or vibration-capable devices exist", async () => {
    setIntifaceButtplugModuleForTests(
      createModule([
        {
          name: "Sensor Device",
          hasOutput: (type: unknown) => type === "Battery",
          runOutput,
          stop,
        },
      ]) as never
    );

    const result = await intifaceAdapter.verifyConnection(config);

    expect(result.success).toBe(false);
    expect(result.message).toContain("no position- or vibration-capable device");
  });

  it("connects to a vibration-only device", async () => {
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

    expect(result).toMatchObject({
      success: true,
      provider: "intiface",
      deviceName: "Vibe Device",
      deviceIndex: 0,
    });
  });

  it("prefers a position device over a vibration device when both are present", async () => {
    setIntifaceButtplugModuleForTests(
      createModule([
        {
          name: "Vibe Device",
          hasOutput: (type: unknown) => type === "Vibrate",
          runOutput,
          stop,
        },
        {
          name: "Linear Device",
          hasOutput: (type: unknown) => type === "Position",
          runOutput,
          stop,
        },
      ]) as never
    );

    const session = await intifaceAdapter.createSession(config);

    expect(session.deviceMode).toBe("position");
    expect(session.deviceName).toBe("Linear Device");
  });

  it("translates funscript stroke speed into vibration intensity", async () => {
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
    const session = await intifaceAdapter.createSession(config);

    await intifaceAdapter.sendSync(config, session, 500, 1, "script", [
      { at: 0, pos: 0 },
      { at: 1000, pos: 100 },
    ]);

    expect(runOutput).toHaveBeenCalledWith({
      type: "vibrate",
      intensity: 0.25,
    });
  });

  it("scales vibration intensity by sensitivity", async () => {
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
    const sensitiveConfig = { ...config, vibrationSensitivity: 2 };
    const session = await intifaceAdapter.createSession(sensitiveConfig);

    await intifaceAdapter.sendSync(sensitiveConfig, session, 500, 1, "script", [
      { at: 0, pos: 0 },
      { at: 1000, pos: 100 },
    ]);

    expect(runOutput).toHaveBeenCalledWith({
      type: "vibrate",
      intensity: 0.5,
    });
  });

  it("emits zero intensity during a held funscript segment", async () => {
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
    const session = await intifaceAdapter.createSession(config);

    await intifaceAdapter.sendSync(config, session, 500, 1, "script", [
      { at: 0, pos: 50 },
      { at: 1000, pos: 50 },
    ]);

    expect(runOutput).toHaveBeenCalledWith({
      type: "vibrate",
      intensity: 0,
    });
  });

  it("sends interpolated position with short duration", async () => {
    setIntifaceButtplugModuleForTests(
      createModule([
        {
          name: "Linear Device",
          hasOutput: (type: unknown) => type === "HwPositionWithDuration",
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
      type: "position-with-duration",
      position: 0.8,
      durationMs: 500,
    });
  });

  it("does not send duration commands to position-only Intiface devices", async () => {
    setIntifaceButtplugModuleForTests(
      createModule([
        {
          name: "Position Device",
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
      position: 0.8,
    });
  });

  it("does not resend when interpolated position is unchanged", async () => {
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
    const actions = [
      { at: 0, pos: 0 },
      { at: 1000, pos: 100 },
    ];

    await intifaceAdapter.sendSync(config, session, 500, 1, "script", actions);
    await intifaceAdapter.sendSync(config, session, 500, 1, "script", actions);

    expect(runOutput).toHaveBeenCalledTimes(1);
  });

  it("resends after a seek or playback rate change", async () => {
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
    const actions = [
      { at: 0, pos: 0 },
      { at: 1000, pos: 100 },
    ];

    await intifaceAdapter.sendSync(config, session, 500, 1, "script", actions);
    await intifaceAdapter.sendSync(config, session, 300, 1, "script", actions);
    await intifaceAdapter.sendSync(config, session, 360, 1.5, "script", actions);

    expect(runOutput).toHaveBeenCalledTimes(2);
    const lastArg = runOutput.mock.lastCall![0] as { type: string; position: number };
    expect(lastArg.type).toBe("position");
    expect(lastArg.position).toBeCloseTo(0.8, 3);
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

describe("Buttplug protocol compatibility", () => {
  it("serializes hardware position output values as protocol-v4 scalars", async () => {
    const { ButtplugClientDevice, DeviceOutput } = (await import("buttplug")) as unknown as {
      ButtplugClientDevice: {
        fromMsg: (
          info: {
            DeviceIndex: number;
            DeviceName: string;
            DeviceFeatures: Record<
              number,
              {
                FeatureIndex: number;
                FeatureDescriptor: string;
                Output: Record<string, { Value: number[]; Duration?: number[] }>;
                Input: Record<string, never>;
              }
            >;
          },
          send: (message: unknown) => Promise<unknown>
        ) => {
          runOutput: (command: unknown) => Promise<void>;
        };
      };
      DeviceOutput: {
        PositionWithDuration: {
          percent: (position: number, durationMs: number) => unknown;
        };
      };
    };
    let sentMessage: unknown;
    const device = ButtplugClientDevice.fromMsg(
      {
        DeviceIndex: 0,
        DeviceName: "The Handy",
        DeviceFeatures: {
          0: {
            FeatureIndex: 0,
            FeatureDescriptor: "Position",
            Output: {
              HwPositionWithDuration: {
                Value: [0, 100],
                Duration: [0, 5000],
              },
            },
            Input: {},
          },
        },
      },
      async (message) => {
        sentMessage = message;
        return { Ok: { Id: 1 } };
      }
    );

    await device.runOutput(DeviceOutput.PositionWithDuration.percent(0.5, 146));

    expect(sentMessage).toEqual({
      OutputCmd: {
        Id: 1,
        DeviceIndex: 0,
        FeatureIndex: 0,
        Command: {
          HwPositionWithDuration: {
            Value: 50,
            Duration: 146,
          },
        },
      },
    });
  });
});

describe("parseIntifaceMajorVersion", () => {
  it("parses a semver from the server name", () => {
    expect(parseIntifaceMajorVersion("Intiface Central 3.0.0")).toBe(3);
    expect(parseIntifaceMajorVersion("Intiface Central 2.5.1 x86_64")).toBe(2);
    expect(parseIntifaceMajorVersion("Intiface Central 10.2.3")).toBe(10);
  });

  it("returns null when no version is present", () => {
    expect(parseIntifaceMajorVersion("Intiface Server")).toBeNull();
    expect(parseIntifaceMajorVersion("")).toBeNull();
    expect(parseIntifaceMajorVersion(undefined)).toBeNull();
  });
});

describe("buildIntifaceVersionError", () => {
  it("includes the download URL and detected version", () => {
    const message = buildIntifaceVersionError(2);
    expect(message).toContain("3.0 or newer is required");
    expect(message).toContain("Only the latest version is supported");
    expect(message).toContain("(detected: 2.x)");
    expect(message).toContain("https://intiface.com/#intiface-central");
  });

  it("omits the detected version fragment when null", () => {
    const message = buildIntifaceVersionError(null);
    expect(message).not.toContain("(detected:");
    expect(message).toContain("https://intiface.com/#intiface-central");
  });
});

describe("intifaceAdapter version check", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetIntifaceConnectionsForTests();
    setIntifaceButtplugModuleForTests(null);
  });

  it("rejects connection when Intiface Central is below 3.0", async () => {
    setIntifaceButtplugModuleForTests(
      createModule(
        [
          {
            name: "Linear Device",
            hasOutput: (type: unknown) => type === "Position",
            runOutput,
            stop,
          },
        ],
        "Intiface Central 2.5.1"
      ) as never
    );

    const result = await intifaceAdapter.verifyConnection(config);

    expect(result.success).toBe(false);
    expect(result.message).toContain("3.0 or newer is required");
    expect(result.message).toContain("https://intiface.com/#intiface-central");
    expect(result.message).toContain("(detected: 2.x)");
  });

  it("allows connection when Intiface Central is 3.0 or newer", async () => {
    setIntifaceButtplugModuleForTests(
      createModule(
        [
          {
            name: "Linear Device",
            hasOutput: (type: unknown) => type === "Position",
            runOutput,
            stop,
          },
        ],
        "Intiface Central 3.1.0"
      ) as never
    );

    const result = await intifaceAdapter.verifyConnection(config);

    expect(result).toMatchObject({ success: true, provider: "intiface" });
  });

  it("allows connection when the server name has no detectable version", async () => {
    setIntifaceButtplugModuleForTests(
      createModule(
        [
          {
            name: "Linear Device",
            hasOutput: (type: unknown) => type === "Position",
            runOutput,
            stop,
          },
        ],
        "Intiface Server"
      ) as never
    );

    const result = await intifaceAdapter.verifyConnection(config);

    expect(result).toMatchObject({ success: true, provider: "intiface" });
  });
});
