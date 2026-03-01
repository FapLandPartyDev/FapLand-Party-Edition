// @vitest-environment node

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Store from "electron-store";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetStoreForTests,
  __setHardwareKeyDeriverForTests,
  __setStoreFactoryForTests,
  __setStorePathsForTests,
  getStore,
  initStore,
  resolveSettingsStorePath,
  safeStoreGet,
  safeStoreGetMany,
  safeStoreSet,
} from "./store";

const STORE_ENCRYPTION_SALT = "f-land-store-encryption-v1-pepper";

function hashStoreKey(seed: string): string {
  return crypto
    .createHash("sha256")
    .update(seed + STORE_ENCRYPTION_SALT)
    .digest("hex");
}

function synchronousFallbackKey(): string {
  return hashStoreKey("synchronous-fallback-key");
}

function hardwareFallbackKey(): string {
  return hashStoreKey("fallback-key");
}

describe("store initialization", () => {
  let tempRoot: string;
  let settingsPath: string;
  let keyFilePath: string;

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "f-land-store-"));
    settingsPath = path.join(tempRoot, "config.json");
    keyFilePath = path.join(tempRoot, "store-key.json");
    __resetStoreForTests();
    __setStorePathsForTests(settingsPath, keyFilePath);
    __setHardwareKeyDeriverForTests(async () => "hardware-derived-key");
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    __resetStoreForTests();
    vi.restoreAllMocks();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  function writeEncryptedSettings(
    encryptionKey: string,
    data: Record<string, unknown> = {
      volume: 0.5,
      nested: { enabled: true, values: [1, "two", false] },
    }
  ): Buffer {
    const encryptedStore = new Store({
      cwd: tempRoot,
      name: "config",
      encryptionKey,
      clearInvalidConfig: false,
    });
    encryptedStore.store = data;
    return fs.readFileSync(settingsPath);
  }

  async function expectMigration(
    encryptionKey: string,
    setup?: () => void
  ): Promise<Record<string, unknown>> {
    const expected = {
      volume: 0.5,
      nested: { enabled: true, values: [1, "two", false] },
    };
    writeEncryptedSettings(encryptionKey, expected);
    setup?.();

    await initStore();

    expect(getStore().store).toEqual(expected);
    expect(JSON.parse(fs.readFileSync(settingsPath, "utf8"))).toEqual(expected);
    return expected;
  }

  it("initializes new users with an empty plaintext store", async () => {
    await initStore();

    expect(getStore().store).toEqual({});
    getStore().set("app.locale", "de");
    expect(JSON.parse(fs.readFileSync(settingsPath, "utf8"))).toEqual({
      app: { locale: "de" },
    });
  });

  it("loads existing plaintext settings without migration", async () => {
    fs.writeFileSync(settingsPath, '{"volume":0.75,"app.locale":"de"}', "utf8");
    const factory = vi.fn((options: Parameters<typeof __setStoreFactoryForTests>[0] extends (
      options: infer T
    ) => Store
      ? T
      : never) => {
      expect(options.mode).toBe("plaintext");
      return new Store({ cwd: tempRoot, name: "config", clearInvalidConfig: false });
    });
    __setStoreFactoryForTests(factory);

    await initStore();

    expect(getStore().store).toEqual({ volume: 0.75, "app.locale": "de" });
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it("migrates settings encrypted with the cached key", async () => {
    fs.writeFileSync(keyFilePath, JSON.stringify({ key: "cached-key" }), "utf8");
    await expectMigration("cached-key");
    expect(fs.existsSync(keyFilePath)).toBe(false);
  });

  it("does not invoke the hardware key deriver when a cheaper key decrypts", async () => {
    const hardwareDeriver = vi.fn(async () => "hardware-derived-key");
    __setHardwareKeyDeriverForTests(hardwareDeriver);
    fs.writeFileSync(keyFilePath, JSON.stringify({ key: "cached-key" }), "utf8");
    await expectMigration("cached-key");
    expect(hardwareDeriver).not.toHaveBeenCalled();
  });

  it("does not invoke the hardware key deriver when the synchronous fallback decrypts", async () => {
    const hardwareDeriver = vi.fn(async () => "hardware-derived-key");
    __setHardwareKeyDeriverForTests(hardwareDeriver);
    await expectMigration(synchronousFallbackKey());
    expect(hardwareDeriver).not.toHaveBeenCalled();
  });

  it("migrates settings encrypted with the hardware-derived key", async () => {
    await expectMigration("hardware-derived-key");
  });

  it("migrates settings encrypted with the synchronous fallback key", async () => {
    await expectMigration(synchronousFallbackKey());
  });

  it("migrates settings encrypted with the hardware fallback key", async () => {
    __setHardwareKeyDeriverForTests(async () => {
      throw new Error("hardware lookup failed");
    });
    await expectMigration(hardwareFallbackKey());
  });

  it("deduplicates identical legacy key candidates", async () => {
    const fallbackKey = hardwareFallbackKey();
    writeEncryptedSettings("unreadable-key");
    fs.writeFileSync(keyFilePath, JSON.stringify({ key: fallbackKey }), "utf8");
    __setHardwareKeyDeriverForTests(async () => fallbackKey);
    const attempts: string[] = [];

    __setStoreFactoryForTests((options) => {
      if (options.mode === "legacy-encrypted") {
        attempts.push(options.encryptionKey ?? "");
      }
      return new Store({
        cwd: tempRoot,
        name: "config",
        clearInvalidConfig: false,
        encryptionKey:
          options.mode === "legacy-encrypted" ? options.encryptionKey : undefined,
        deserialize:
          options.mode === "plaintext-migration"
            ? (() => {
                let firstRead = true;
                return (value: string) => {
                  if (firstRead) {
                    firstRead = false;
                    return {};
                  }
                  return JSON.parse(value) as Record<string, unknown>;
                };
              })()
            : undefined,
      });
    });

    await expect(initStore()).rejects.toThrow("could not be decrypted");
    expect(attempts.filter((key) => key === fallbackKey)).toHaveLength(1);
  });

  it("uses plaintext directly on the second startup", async () => {
    await expectMigration("hardware-derived-key");
    __resetStoreForTests();
    __setStorePathsForTests(settingsPath, keyFilePath);
    const hardwareDeriver = vi.fn(async () => "hardware-derived-key");
    __setHardwareKeyDeriverForTests(hardwareDeriver);

    await initStore();

    expect(getStore().get("volume")).toBe(0.5);
    expect(hardwareDeriver).not.toHaveBeenCalled();
  });

  it("removes an obsolete key file after confirming existing plaintext", async () => {
    fs.writeFileSync(settingsPath, '{"volume":0.5}', "utf8");
    fs.writeFileSync(keyFilePath, '{"key":"obsolete"}', "utf8");

    await initStore();

    expect(fs.existsSync(keyFilePath)).toBe(false);
  });

  it("does not fail startup when obsolete key cleanup fails", async () => {
    fs.writeFileSync(settingsPath, '{"volume":0.5}', "utf8");
    fs.writeFileSync(keyFilePath, '{"key":"obsolete"}', "utf8");
    const rmSync = vi.spyOn(fs, "rmSync").mockImplementation((target) => {
      if (target === keyFilePath) throw new Error("permission denied");
      return undefined as never;
    });

    await expect(initStore()).resolves.toBeUndefined();

    expect(getStore().get("volume")).toBe(0.5);
    expect(rmSync).toHaveBeenCalledWith(keyFilePath, { force: true });
  });

  it("rejects undecryptable settings without changing the original bytes", async () => {
    const original = Buffer.from("not-json-or-ciphertext");
    fs.writeFileSync(settingsPath, original);

    await expect(initStore()).rejects.toThrow("could not be decrypted");

    expect(fs.readFileSync(settingsPath)).toEqual(original);
  });

  it("restores the original bytes when the plaintext rewrite fails", async () => {
    const original = writeEncryptedSettings("hardware-derived-key");
    fs.writeFileSync(
      keyFilePath,
      JSON.stringify({ key: "hardware-derived-key" }),
      "utf8"
    );
    __setStoreFactoryForTests((options) => {
      if (options.mode === "plaintext-migration") {
        throw new Error("rewrite failed");
      }
      return new Store({
        cwd: tempRoot,
        name: "config",
        encryptionKey: options.encryptionKey,
        clearInvalidConfig: false,
      });
    });

    await expect(initStore()).rejects.toThrow("rewrite failed");

    expect(fs.readFileSync(settingsPath)).toEqual(original);
    expect(fs.existsSync(keyFilePath)).toBe(true);
  });

  it("migrates after getStore is called before initStore", async () => {
    const expected = { existingKey: "legacy-value" };
    writeEncryptedSettings("hardware-derived-key", expected);

    expect(getStore().store).toEqual({});
    await initStore();

    expect(getStore().store).toEqual(expected);
    expect(JSON.parse(fs.readFileSync(settingsPath, "utf8"))).toEqual(expected);
  });

  it("safe helpers fall back when reads or writes throw", () => {
    const unreadableStore = {
      get: () => {
        throw new Error("read failed");
      },
      set: () => {
        throw new Error("write failed");
      },
      path: settingsPath,
    } as unknown as Store;
    __setStoreFactoryForTests(() => unreadableStore);

    expect(safeStoreGet("missing", "fallback")).toBe("fallback");
    expect(safeStoreGetMany(["one", "two"])).toEqual({
      one: undefined,
      two: undefined,
    });
    expect(safeStoreSet("one", true)).toBe(false);
  });

  it("safe helpers read and write plaintext settings", async () => {
    await initStore();

    expect(safeStoreSet("one", 1)).toBe(true);
    expect(safeStoreGet("one")).toBe(1);
    expect(safeStoreGetMany(["one", "two"])).toEqual({
      one: 1,
      two: undefined,
    });
  });

  it("resolves the active settings store path", async () => {
    expect(resolveSettingsStorePath()).toBe(settingsPath);
    await initStore();
    expect(resolveSettingsStorePath()).toBe(settingsPath);
  });
});
