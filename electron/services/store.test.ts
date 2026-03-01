// @vitest-environment node

import type Store from "electron-store";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetStoreForTests,
  __setEncryptionKeyDeriverForTests,
  __setStoreFactoryForTests,
  getStore,
  initStore,
  safeStoreGet,
  safeStoreGetMany,
  safeStoreSet,
} from "./store";

class FakeStore {
  data: Record<string, unknown>;
  readable: boolean;

  constructor(data: Record<string, unknown> = {}, readable = true) {
    this.data = { ...data };
    this.readable = readable;
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
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    __resetStoreForTests();
    vi.restoreAllMocks();
  });

  it("replaces a synchronous fallback store when initStore derives the real key", async () => {
    const fallbackStore = new FakeStore();
    const derivedStore = new FakeStore();
    const factory = vi.fn((key: string) =>
      asStore(key === "derived-key" ? derivedStore : fallbackStore)
    );

    __setEncryptionKeyDeriverForTests(async () => "derived-key");
    __setStoreFactoryForTests(factory);

    expect(getStore()).toBe(asStore(fallbackStore));

    await initStore();

    expect(getStore()).toBe(asStore(derivedStore));
    expect(factory).toHaveBeenCalledTimes(2);
  });

  it("migrates settings written with the temporary startup key", async () => {
    const fallbackStore = new FakeStore({ "app.locale": "de", "music.volume": 0.3 });
    const derivedStore = new FakeStore({}, false);

    __setEncryptionKeyDeriverForTests(async () => "derived-key");
    __setStoreFactoryForTests((key: string) =>
      asStore(key === "derived-key" ? derivedStore : fallbackStore)
    );

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
});
