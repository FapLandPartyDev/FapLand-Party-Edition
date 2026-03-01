// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const systeminformationMocks = vi.hoisted(() => ({
  cpu: vi.fn(async () => ({
    manufacturer: "ACME",
    brand: "Fast CPU",
    physicalCores: 4,
    cores: 8,
    speed: 3.2,
    model: "",
  })),
  mem: vi.fn(async () => ({ total: 16, free: 8, available: 10 })),
  osInfo: vi.fn(async () => ({
    distro: "Linux",
    release: "1",
    build: "dev",
    kernel: "test",
  })),
  graphics: vi.fn(async () => ({
    controllers: [
      { vendor: "GPUCo", model: "GFX 1000", vram: 4096, driverVersion: "1.0" },
    ],
    displays: [],
  })),
}));

vi.mock("systeminformation", () => ({ default: systeminformationMocks }));

import {
  __resetSystemInfoCacheForTests,
  getCpuInfo,
  getGraphicsInfo,
  getMemInfo,
  getOsInfo,
  listAvailableGpus,
} from "./systemInfoCache";

describe("systemInfoCache", () => {
  beforeEach(() => {
    __resetSystemInfoCacheForTests();
    vi.clearAllMocks();
  });

  afterEach(() => {
    __resetSystemInfoCacheForTests();
  });

  it("shares a single si.graphics() call between getGraphicsInfo and listAvailableGpus", async () => {
    const [info, gpus] = await Promise.all([getGraphicsInfo(), listAvailableGpus()]);

    expect(systeminformationMocks.graphics).toHaveBeenCalledTimes(1);
    expect(info?.controllers).toHaveLength(1);
    expect(gpus).toEqual([{ index: 0, name: "GPUCo GFX 1000" }]);
  });

  it("caches graphics info across subsequent calls", async () => {
    await getGraphicsInfo();
    await getGraphicsInfo();
    await listAvailableGpus();

    expect(systeminformationMocks.graphics).toHaveBeenCalledTimes(1);
  });

  it("returns null and swallows errors when si.graphics rejects", async () => {
    systeminformationMocks.graphics.mockImplementation(async () => {
      throw new Error("WMI down");
    });

    const result = await getGraphicsInfo();
    expect(result).toBeNull();

    const gpus = await listAvailableGpus();
    expect(gpus).toEqual([]);

    systeminformationMocks.graphics.mockImplementation(async () => ({
      controllers: [
        { vendor: "GPUCo", model: "GFX 1000", vram: 4096, driverVersion: "1.0" },
      ],
      displays: [],
    }));
  });

  it("returns null when individual si.* calls reject", async () => {
    systeminformationMocks.cpu.mockRejectedValueOnce(new Error("cpu failed"));
    systeminformationMocks.mem.mockRejectedValueOnce(new Error("mem failed"));
    systeminformationMocks.osInfo.mockRejectedValueOnce(new Error("os failed"));

    const [cpu, mem, os] = await Promise.all([getCpuInfo(), getMemInfo(), getOsInfo()]);
    expect(cpu).toBeNull();
    expect(mem).toBeNull();
    expect(os).toBeNull();
  });
});
