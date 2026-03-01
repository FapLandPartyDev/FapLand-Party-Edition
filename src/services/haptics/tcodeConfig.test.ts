import { describe, expect, it } from "vitest";
import { normalizeTCodeWebSocketInput } from "./tcodeConfig";

describe("normalizeTCodeWebSocketInput", () => {
  it("converts a manual IP address to the default TCodeESP32 websocket URL", () => {
    expect(normalizeTCodeWebSocketInput("192.168.1.42")).toEqual({
      host: "192.168.1.42",
      url: "ws://192.168.1.42/ws",
    });
  });

  it("normalizes a full websocket URL and preserves its host", () => {
    expect(normalizeTCodeWebSocketInput("ws://192.168.1.42/ws")).toEqual({
      host: "192.168.1.42",
      url: "ws://192.168.1.42/ws",
    });
  });

  it("allows hostnames", () => {
    expect(normalizeTCodeWebSocketInput("tcode-device.local")).toEqual({
      host: "tcode-device.local",
      url: "ws://tcode-device.local/ws",
    });
  });

  it("rejects invalid host values", () => {
    expect(() => normalizeTCodeWebSocketInput("http://192.168.1.42/ws")).toThrow(
      "valid TCode device"
    );
  });
});
