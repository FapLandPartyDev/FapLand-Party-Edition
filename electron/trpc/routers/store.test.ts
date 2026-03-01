// @vitest-environment node

import type Store from "electron-store";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FFMPEG_GPU_PREFERENCE_KEY } from "../../../src/constants/debugSettings";
import { GRAPHICS_DISABLE_ZERO_COPY_ENABLED_KEY } from "../../../src/constants/graphicsSettings";
import {
  __resetStoreForTests,
  __setStoreFactoryForTests,
} from "../../services/store";
import { storeRouter } from "./store";

const mocks = vi.hoisted(() => ({
  persistGraphicsCompatibilityStartupSetting: vi.fn(),
}));

vi.mock("../../services/graphicsCompatibility", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../services/graphicsCompatibility")>();
  return {
    ...actual,
    persistGraphicsCompatibilityStartupSetting:
      mocks.persistGraphicsCompatibilityStartupSetting,
  };
});

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
    mocks.persistGraphicsCompatibilityStartupSetting.mockClear();
    mocks.persistGraphicsCompatibilityStartupSetting.mockReturnValue(false);
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

  it("mirrors GPU startup settings after writing the encrypted main store", async () => {
    const writableStore = new FakeStore();
    __setStoreFactoryForTests(() => asStore(writableStore));
    mocks.persistGraphicsCompatibilityStartupSetting.mockReturnValue(true);
    const caller = storeRouter.createCaller({ event: { sender: {} } } as never);

    await caller.set({ key: GRAPHICS_DISABLE_ZERO_COPY_ENABLED_KEY, value: "true" });
    await caller.set({ key: FFMPEG_GPU_PREFERENCE_KEY, value: "gpu:1" });

    expect(writableStore.data[GRAPHICS_DISABLE_ZERO_COPY_ENABLED_KEY]).toBe("true");
    expect(writableStore.data[FFMPEG_GPU_PREFERENCE_KEY]).toBe("gpu:1");
    expect(mocks.persistGraphicsCompatibilityStartupSetting).toHaveBeenCalledWith(
      GRAPHICS_DISABLE_ZERO_COPY_ENABLED_KEY,
      "true"
    );
    expect(mocks.persistGraphicsCompatibilityStartupSetting).toHaveBeenCalledWith(
      FFMPEG_GPU_PREFERENCE_KEY,
      "gpu:1"
    );
  });

  it("does not mirror unrelated settings into the graphics startup store", async () => {
    const writableStore = new FakeStore();
    __setStoreFactoryForTests(() => asStore(writableStore));
    const caller = storeRouter.createCaller({ event: { sender: {} } } as never);

    await caller.set({ key: "app.locale", value: "de" });

    expect(mocks.persistGraphicsCompatibilityStartupSetting).toHaveBeenCalledWith(
      "app.locale",
      "de"
    );
    expect(mocks.persistGraphicsCompatibilityStartupSetting).toHaveReturnedWith(false);
  });
});
