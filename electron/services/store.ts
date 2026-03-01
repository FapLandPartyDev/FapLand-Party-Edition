import Store from "electron-store";
import crypto from "crypto";
import si from "systeminformation";

const STORE_ENCRYPTION_SALT = "f-land-store-encryption-v1-pepper";
type StoreMode = "uninitialized" | "syncFallback" | "derived";

let store: Store | null = null;
let storeMode: StoreMode = "uninitialized";
let encryptionKeyPromise: Promise<string> | null = null;
let storeFactory: (encryptionKey: string) => Store = createElectronStore;
let encryptionKeyDeriver: () => Promise<string> = deriveHardwareEncryptionKey;

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
    const [cpu, baseboard, bios] = await Promise.all([si.cpu(), si.baseboard(), si.bios()]);
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

async function deriveEncryptionKey(): Promise<string> {
  if (!encryptionKeyPromise) {
    encryptionKeyPromise = encryptionKeyDeriver();
  }
  return encryptionKeyPromise;
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

  const key = await deriveEncryptionKey();
  const derivedStore = createStore(key);

  if (!canReadStore(derivedStore)) {
    const fallbackStore =
      store && storeMode === "syncFallback"
        ? store
        : createStore(getSynchronousFallbackEncryptionKey());

    if (canReadStore(fallbackStore)) {
      migrateFallbackStoreIfNeeded(derivedStore, fallbackStore);
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
  encryptionKeyPromise = null;
  storeFactory = createElectronStore;
  encryptionKeyDeriver = deriveHardwareEncryptionKey;
}

export function __setStoreFactoryForTests(factory: (encryptionKey: string) => Store): void {
  storeFactory = factory;
}

export function __setEncryptionKeyDeriverForTests(deriver: () => Promise<string>): void {
  encryptionKeyDeriver = deriver;
  encryptionKeyPromise = null;
}
