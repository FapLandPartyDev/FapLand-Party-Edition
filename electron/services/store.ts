import Store from "electron-store";
import crypto from "crypto";

const STORE_ENCRYPTION_SALT = "f-land-store-encryption-v1-pepper";

let store: Store | null = null;
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

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out after ${ms}ms`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

async function deriveHardwareEncryptionKey(): Promise<string> {
  try {
    const si = await import("systeminformation");
    const [cpu, baseboard, bios] = await withTimeout(
      Promise.all([si.cpu(), si.baseboard(), si.bios()]),
      3000
    );
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

export async function initStore(): Promise<void> {
  if (store) return;
  const key = await deriveEncryptionKey();
  store = createStore(key);
}

export function getStore(): Store {
  if (!store) {
    store = createStore(getSynchronousFallbackEncryptionKey());
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
  encryptionKeyPromise = null;
  storeFactory = createElectronStore;
  encryptionKeyDeriver = deriveHardwareEncryptionKey;
}

export function __setStoreFactoryForTests(factory: (encryptionKey: string) => Store): void {
  storeFactory = factory;
}

export function __setHardwareKeyDeriverForTests(deriver: () => Promise<string>): void {
  encryptionKeyDeriver = deriver;
  encryptionKeyPromise = null;
}
