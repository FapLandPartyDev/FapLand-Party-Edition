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

vi.mock("electron", () => ({
  app: {
    getPath: () => "/tmp/test-userData",
    isPackaged: false,
  },
}));

vi.mock("node:fs", () => ({
  default: {
    existsSync: () => false,
    readFileSync: () => "{}",
    writeFileSync: () => undefined,
    mkdirSync: () => undefined,
  },
  existsSync: () => false,
  readFileSync: () => "{}",
  writeFileSync: () => undefined,
  mkdirSync: () => undefined,
}));

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

  it("replaces a synchronous fallback store when initStore derives the real key", async () => {
    const fallbackStore = new FakeStore();
    const derivedStore = new FakeStore();
    let callCount = 0;
    const factory = vi.fn((_key: string) => {
      callCount++;
      return asStore(callCount === 1 ? fallbackStore : derivedStore);
    });

    __setStoreFactoryForTests(factory);

    // First call creates the fallback store
    expect(getStore()).toBe(asStore(fallbackStore));

    // initStore creates the derived store
    await initStore();

    expect(getStore()).toBe(asStore(derivedStore));
    expect(factory).toHaveBeenCalledTimes(2);
  });

  it("migrates settings written with the temporary startup key", async () => {
    const fallbackStore = new FakeStore({ "app.locale": "de", "music.volume": 0.3 });
    const derivedStore = new FakeStore({}, false);
    let callCount = 0;

    __setStoreFactoryForTests((_key: string) => {
      callCount++;
      // First call from getStore() → fallback, second from initStore → derived
      return asStore(callCount <= 1 ? fallbackStore : derivedStore);
    });

    // Prime the fallback store
    getStore();

    await initStore();

    expect(getStore()).toBe(asStore(derivedStore));
    expect(derivedStore.data).toEqual({
      "app.locale": "de",
      "music.volume": 0.3,
    });
    expect(derivedStore.readable).toBe(true);
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

  it("migrates settings from a legacy hardware-derived key", async () => {
    const hardwareStore = new FakeStore({ "app.locale": "fr", "music.volume": 0.7 });
    const derivedStore = new FakeStore({}, false);
    const fallbackStore = new FakeStore({}, false);
    let callCount = 0;

    __setStoreFactoryForTests((_key: string) => {
      callCount++;
      // 1st: derived (unreadable), 2nd: fallback (unreadable), 3rd: hardware (readable)
      if (callCount === 1) return asStore(derivedStore);
      if (callCount === 2) return asStore(fallbackStore);
      return asStore(hardwareStore);
    });

    __setHardwareKeyDeriverForTests(async () => "hardware-derived-key");

    await initStore();

    expect(getStore()).toBe(asStore(derivedStore));
    expect(derivedStore.data).toEqual({
      "app.locale": "fr",
      "music.volume": 0.7,
    });
    expect(derivedStore.readable).toBe(true);
  });
});
