import Store from "electron-store";
import crypto from "crypto";
import { app } from "electron";
import path from "node:path";
import fsSync from "node:fs";

const STORE_ENCRYPTION_SALT = "f-land-store-encryption-v1-pepper";
type StoreMode = "uninitialized" | "syncFallback" | "derived";

let store: Store | null = null;
let storeMode: StoreMode = "uninitialized";
let storeFactory: (encryptionKey: string) => Store = createElectronStore;
let hardwareKeyDeriver: () => Promise<string> = deriveHardwareEncryptionKey;

function hashStoreKey(seed: string): string {
  return crypto
    .createHash("sha256")
    .update(seed + STORE_ENCRYPTION_SALT)
    .digest("hex");
}

function getSynchronousFallbackEncryptionKey(): string {
  return hashStoreKey("synchronous-fallback-key");
}

async function deriveHardwareEncryptionKey(): Promise<string> {
  try {
    const si = await import("systeminformation");
    const [cpu, baseboard, bios] = await Promise.all([
      si.cpu(),
      si.baseboard(),
      si.bios(),
    ]);
    const seed = [
      `${cpu.brand}|${cpu.model}|${cpu.cores}`,
      `${baseboard.manufacturer}|${baseboard.model}|${baseboard.serial}`,
      `${bios.vendor}|${bios.version}|${bios.releaseDate}`,
    ].join("::");
    return hashStoreKey(seed);
  } catch {
    return hashStoreKey("fallback-key");
  }
}

/**
 * Resolves a stable, machine-local encryption key that persists across restarts.
 *
 * The previous hardware-based approach used `systeminformation` to derive a key
 * from CPU, baseboard, and BIOS identifiers. On Windows, WMI queries can return
 * inconsistent results (e.g. empty baseboard serial) between reboots or user
 * sessions, causing the key to change and making all previously-written settings
 * unreadable.
 *
 * This implementation generates a random key on first launch and caches it in a
 * plain JSON file next to the main store. This is equally secure (the key was
 * always stored on-disk implicitly via the store file itself) and fully stable.
 */
function resolveCachedEncryptionKey(): string {
  let keyFilePath: string;
  try {
    keyFilePath = path.join(app.getPath("userData"), "store-key.json");
  } catch {
    keyFilePath = path.join(process.cwd(), "store-key.json");
  }

  try {
    if (fsSync.existsSync(keyFilePath)) {
      const content = JSON.parse(fsSync.readFileSync(keyFilePath, "utf-8"));
      if (typeof content?.key === "string" && content.key.length > 0) {
        return content.key;
      }
    }
  } catch (error) {
    console.warn("Failed to read cached store encryption key, generating new one.", error);
  }

  const newKey = hashStoreKey(crypto.randomBytes(64).toString("hex"));
  try {
    const dir = path.dirname(keyFilePath);
    if (!fsSync.existsSync(dir)) {
      fsSync.mkdirSync(dir, { recursive: true });
    }
    fsSync.writeFileSync(keyFilePath, JSON.stringify({ key: newKey }), "utf-8");
  } catch (error) {
    console.warn("Failed to persist store encryption key.", error);
  }

  return newKey;
}

function createElectronStore(encryptionKey: string): Store {
  try {
    return new Store({ encryptionKey });
  } catch {
    return new Store({ cwd: process.cwd(), name: "f-land", encryptionKey });
  }
}

function createStore(encryptionKey: string): Store {
  return storeFactory(encryptionKey);
}

function readStoreSnapshot(candidate: Store): Record<string, unknown> {
  return candidate.store as Record<string, unknown>;
}

function canReadStore(candidate: Store): boolean {
  try {
    void readStoreSnapshot(candidate);
    return true;
  } catch {
    return false;
  }
}

function migrateFallbackStoreIfNeeded(derivedStore: Store, fallbackStore: Store): boolean {
  try {
    const fallbackSnapshot = readStoreSnapshot(fallbackStore);
    derivedStore.store = fallbackSnapshot;
    console.warn("Migrated settings written with the temporary startup key.");
    return true;
  } catch (error) {
    console.warn("Failed to migrate settings from the temporary startup key.", error);
    return false;
  }
}

export async function initStore(): Promise<void> {
  if (store && storeMode === "derived") return;

  const key = resolveCachedEncryptionKey();
  const derivedStore = createStore(key);

  if (!canReadStore(derivedStore)) {
    let migrated = false;

    const fallbackStore =
      store && storeMode === "syncFallback"
        ? store
        : createStore(getSynchronousFallbackEncryptionKey());

    if (canReadStore(fallbackStore)) {
      migrated = migrateFallbackStoreIfNeeded(derivedStore, fallbackStore);
    }

    if (!migrated) {
      try {
        const hardwareKey = await hardwareKeyDeriver();
        const hardwareStore = createStore(hardwareKey);
        if (canReadStore(hardwareStore)) {
          migrated = migrateFallbackStoreIfNeeded(derivedStore, hardwareStore);
          if (migrated) {
            console.warn("Migrated settings from legacy hardware-derived encryption key.");
          }
        }
      } catch (error) {
        console.warn("Hardware key migration attempt failed.", error);
      }
    }

    if (!migrated) {
      console.warn(
        "Neither the derived, fallback, nor hardware store could be read. Starting with fresh settings."
      );
    }
  }

  store = derivedStore;
  storeMode = "derived";
}

export function getStore(): Store {
  if (!store) {
    store = createStore(getSynchronousFallbackEncryptionKey());
    storeMode = "syncFallback";
  }
  return store;
}

export function resolveSettingsStorePath(): string {
  return getStore().path;
}

export function safeStoreGet(key: string, fallback?: unknown): unknown {
  try {
    const value = getStore().get(key);
    return value === undefined ? fallback : value;
  } catch (error) {
    console.warn(`Failed to read setting "${key}".`, error);
    return fallback;
  }
}

export function safeStoreGetMany(keys: readonly string[]): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const key of keys) {
    result[key] = safeStoreGet(key);
  }
  return result;
}

export function safeStoreSet(key: string, value: unknown): boolean {
  try {
    getStore().set(key, value);
    return true;
  } catch (error) {
    console.warn(`Failed to write setting "${key}".`, error);
    return false;
  }
}

export function __resetStoreForTests(): void {
  store = null;
  storeMode = "uninitialized";
  storeFactory = createElectronStore;
  hardwareKeyDeriver = deriveHardwareEncryptionKey;
}

export function __setStoreFactoryForTests(factory: (encryptionKey: string) => Store): void {
  storeFactory = factory;
}

export function __setHardwareKeyDeriverForTests(deriver: () => Promise<string>): void {
  hardwareKeyDeriver = deriver;
}
