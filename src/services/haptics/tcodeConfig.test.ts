import { describe, expect, it } from "vitest";
import { normalizeTCodeTransport, normalizeTCodeUdpInput, normalizeTCodeWebSocketInput } from "./tcodeConfig";

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

describe("normalizeTCodeTransport", () => {
  it("keeps serial and udp transports", () => {
    expect(normalizeTCodeTransport("serial")).toBe("serial");
    expect(normalizeTCodeTransport("udp")).toBe("udp");
  });

  it("falls back to the default transport", () => {
    expect(normalizeTCodeTransport("websocket")).toBe("websocket");
    expect(normalizeTCodeTransport("carrier-pigeon")).toBe("websocket");
    expect(normalizeTCodeTransport(undefined)).toBe("websocket");
  });
});

describe("normalizeTCodeUdpInput", () => {
  it("defaults to the built-in TCode device endpoint", () => {
    expect(normalizeTCodeUdpInput("")).toEqual({
      host: "192.168.4.1",
      port: 8000,
      endpoint: "192.168.4.1:8000",
    });
  });

  it("applies the default port to a bare host", () => {
    expect(normalizeTCodeUdpInput("192.168.1.42")).toEqual({
      host: "192.168.1.42",
      port: 8000,
      endpoint: "192.168.1.42:8000",
    });
  });

  it("preserves an explicit port", () => {
    expect(normalizeTCodeUdpInput("192.168.1.42:8081")).toEqual({
      host: "192.168.1.42:8081",
      port: 8081,
      endpoint: "192.168.1.42:8081",
    });
  });

  it("strips a udp:// scheme", () => {
    expect(normalizeTCodeUdpInput("udp://tcode.local:8000/")).toEqual({
      host: "tcode.local:8000",
      port: 8000,
      endpoint: "tcode.local:8000",
    });
  });

  it("rejects invalid host values", () => {
    expect(() => normalizeTCodeUdpInput("http://192.168.1.42")).toThrow(
      "Enter a valid TCode device IP address or hostname."
    );
    expect(() => normalizeTCodeUdpInput("192.168.1.42:notaport")).toThrow(
      "Enter a valid TCode device IP address or hostname."
    );
  });
});
