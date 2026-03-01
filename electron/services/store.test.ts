// @vitest-environment node

import type Store from "electron-store";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetStoreForTests,
  __setStoreFactoryForTests,
  __setHardwareKeyDeriverForTests,
  getStore,
  initStore,
  resolveSettingsStorePath,
  safeStoreGet,
  safeStoreGetMany,
  safeStoreSet,
} from "./store";

class FakeStore {
  data: Record<string, unknown>;
  readable: boolean;
  path: string;

  constructor(data: Record<string, unknown> = {}, readable = true, storePath = "/tmp/f-land.json") {
    this.data = { ...data };
    this.readable = readable;
    this.path = storePath;
  }

  get(key: string): unknown {
    if (!this.readable) throw new Error("Cannot read fake store");
    return this.data[key];
  }

  set(key: string, value: unknown): void {
    if (!this.readable) throw new Error("Cannot write fake store");
    this.data[key] = value;
  }

  get store(): Record<string, unknown> {
    if (!this.readable) throw new Error("Cannot read fake store");
    return { ...this.data };
  }

  set store(value: Record<string, unknown>) {
    this.data = { ...value };
    this.readable = true;
  }
}

function asStore(fake: FakeStore): Store {
  return fake as unknown as Store;
}

describe("store initialization", () => {
  beforeEach(() => {
    __resetStoreForTests();
    __setHardwareKeyDeriverForTests(async () => "fake-hardware-key");
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    __resetStoreForTests();
    vi.restoreAllMocks();
  });

  it("initializes the main store with the hardware-derived key", async () => {
    const derivedStore = new FakeStore();
    const factory = vi.fn(() => asStore(derivedStore));

    __setStoreFactoryForTests(factory);
    __setHardwareKeyDeriverForTests(async () => "hardware-derived-key");

    await initStore();

    expect(getStore()).toBe(asStore(derivedStore));
    expect(factory).toHaveBeenCalledWith("hardware-derived-key");
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it("keeps the old synchronous fallback behavior if getStore is used before initStore", async () => {
    const fallbackStore = new FakeStore();
    const factory = vi.fn(() => asStore(fallbackStore));

    __setStoreFactoryForTests(factory);

    expect(getStore()).toBe(asStore(fallbackStore));
    await initStore();

    expect(getStore()).toBe(asStore(fallbackStore));
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it("safe helpers fall back when reads or writes throw", () => {
    const unreadableStore = new FakeStore({}, false);

    __setStoreFactoryForTests(() => asStore(unreadableStore));

    expect(safeStoreGet("missing", "fallback")).toBe("fallback");
    expect(safeStoreGetMany(["one", "two"])).toEqual({ one: undefined, two: undefined });
    expect(safeStoreSet("one", true)).toBe(false);
  });

  it("safe helpers read and write normal settings", () => {
    const writableStore = new FakeStore({ one: 1 });

    __setStoreFactoryForTests(() => asStore(writableStore));

    expect(safeStoreGet("one")).toBe(1);
    expect(safeStoreSet("two", 2)).toBe(true);
    expect(safeStoreGetMany(["one", "two"])).toEqual({ one: 1, two: 2 });
  });

  it("resolves the active settings store path", () => {
    const writableStore = new FakeStore({}, true, "/settings/f-land.json");

    __setStoreFactoryForTests(() => asStore(writableStore));

    expect(resolveSettingsStorePath()).toBe("/settings/f-land.json");
  });

});
