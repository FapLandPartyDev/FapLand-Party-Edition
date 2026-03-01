// @vitest-environment node

import type Store from "electron-store";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetStoreForTests,
  __setStoreFactoryForTests,
} from "../../services/store";
import { storeRouter } from "./store";

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
}

function asStore(fake: FakeStore): Store {
  return fake as unknown as Store;
}

describe("storeRouter", () => {
  beforeEach(() => {
    __resetStoreForTests();
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    __resetStoreForTests();
    vi.restoreAllMocks();
  });

  it("returns undefined for unreadable legacy settings instead of throwing", async () => {
    __setStoreFactoryForTests(() => asStore(new FakeStore({}, false)));
    const caller = storeRouter.createCaller({ event: { sender: {} } } as never);

    await expect(caller.get({ key: "legacy.setting" })).resolves.toBeUndefined();
    await expect(caller.getMany({ keys: ["one", "two"] })).resolves.toEqual({
      one: undefined,
      two: undefined,
    });
  });

  it("writes through the safe store path", async () => {
    const writableStore = new FakeStore();
    __setStoreFactoryForTests(() => asStore(writableStore));
    const caller = storeRouter.createCaller({ event: { sender: {} } } as never);

    await caller.set({ key: "app.locale", value: "de" });

    expect(writableStore.data["app.locale"]).toBe("de");
  });
});
