// @vitest-environment node

import crypto from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const storeValues = new Map<string, unknown>();

vi.mock("./store", () => ({
  getStore: () => ({
    get: (key: string) => storeValues.get(key),
    set: (key: string, value: unknown) => storeValues.set(key, value),
  }),
}));

const systeminformationMocks = vi.hoisted(() => ({
  cpu: vi.fn(async () => ({
    brand: "ACME",
    model: "Fast",
    cores: 8,
  })),
  baseboard: vi.fn(async () => ({
    manufacturer: "BoardCo",
    model: "X1",
    serial: "SN123",
  })),
  bios: vi.fn(async () => ({
    vendor: "BIOSCo",
    version: "1.0",
    releaseDate: "2020-01-01",
  })),
  networkInterfaces: vi.fn(async () => [
    { virtual: false, mac: "AA:BB:CC:DD:EE:FF" },
  ]),
}));

vi.mock("systeminformation", () => ({ default: systeminformationMocks }));

import { getMachineId } from "./machineId";

describe("getMachineId", () => {
  beforeEach(() => {
    storeValues.clear();
    vi.clearAllMocks();
    systeminformationMocks.cpu.mockImplementation(async () => ({
      brand: "ACME",
      model: "Fast",
      cores: 8,
    }));
    systeminformationMocks.baseboard.mockImplementation(async () => ({
      manufacturer: "BoardCo",
      model: "X1",
      serial: "SN123",
    }));
    systeminformationMocks.bios.mockImplementation(async () => ({
      vendor: "BIOSCo",
      version: "1.0",
      releaseDate: "2020-01-01",
    }));
    systeminformationMocks.networkInterfaces.mockImplementation(async () => [
      { virtual: false, mac: "AA:BB:CC:DD:EE:FF" },
    ]);
  });

  afterEach(() => {
    storeValues.clear();
  });

  it("returns the cached machine id without probing hardware", async () => {
    storeValues.set("machine-id", "cached-id");

    const id = await getMachineId();

    expect(id).toBe("cached-id");
    expect(systeminformationMocks.cpu).not.toHaveBeenCalled();
  });

  it("produces a stable id from hardware data", async () => {
    const first = await getMachineId();
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(storeValues.get("machine-id")).toBe(first);

    storeValues.delete("machine-id");
    const second = await getMachineId();
    expect(second).toBe(first);
  });

  it("still returns a stable id when some hardware probes fail", async () => {
    systeminformationMocks.networkInterfaces.mockRejectedValue(new Error("net failed"));

    const first = await getMachineId();
    expect(first).toMatch(/^[0-9a-f]{64}$/);

    storeValues.delete("machine-id");
    systeminformationMocks.networkInterfaces.mockRejectedValue(new Error("net failed"));
    const second = await getMachineId();
    expect(second).toBe(first);
  });

  it("falls back to a random uuid when all hardware probes fail", async () => {
    systeminformationMocks.cpu.mockRejectedValue(new Error("cpu failed"));
    systeminformationMocks.baseboard.mockRejectedValue(new Error("board failed"));
    systeminformationMocks.bios.mockRejectedValue(new Error("bios failed"));
    systeminformationMocks.networkInterfaces.mockRejectedValue(new Error("net failed"));

    const id = await getMachineId();

    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(crypto.randomUUID()).not.toBe(id);
    expect(storeValues.get("machine-id")).toBe(id);
  });
});
