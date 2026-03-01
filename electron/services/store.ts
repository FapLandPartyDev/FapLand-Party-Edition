import Store from "electron-store";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { app } from "electron";

const STORE_ENCRYPTION_SALT = "f-land-store-encryption-v1-pepper";
const DEFAULT_STORE_FILE_NAME = "config.json";
const FALLBACK_STORE_FILE_NAME = "f-land.json";
const STORE_KEY_FILE_NAME = "store-key.json";
const HARDWARE_FINGERPRINT_TIMEOUT_MS = 30_000;

type StoreMode =
  | "plaintext"
  | "plaintext-migration"
  | "preinit-placeholder"
  | "legacy-encrypted";

type StoreFactoryOptions = {
  mode: StoreMode;
  encryptionKey?: string;
};

let store: Store | null = null;
let storeInitialized = false;
let preInitializationOriginalBytes: Buffer | null = null;
let storeFactory: (options: StoreFactoryOptions) => Store = createElectronStore;
let hardwareKeyDeriver: () => Promise<string> = deriveHardwareEncryptionKey;
let settingsPathResolver: () => string = resolveSettingsPathFromEnvironment;
let keyFilePathResolver: () => string = resolveKeyFilePathFromEnvironment;

function hashStoreKey(seed: string): string {
  return crypto
    .createHash("sha256")
    .update(seed + STORE_ENCRYPTION_SALT)
    .digest("hex");
}

function getSynchronousFallbackEncryptionKey(): string {
  return hashStoreKey("synchronous-fallback-key");
}

function getHardwareFallbackEncryptionKey(): string {
  return hashStoreKey("fallback-key");
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
      HARDWARE_FINGERPRINT_TIMEOUT_MS
    );
    const seed = [
      `${cpu.brand}|${cpu.model}|${cpu.cores}`,
      `${baseboard.manufacturer}|${baseboard.model}|${baseboard.serial}`,
      `${bios.vendor}|${bios.version}|${bios.releaseDate}`,
    ].join("::");
    return hashStoreKey(seed);
  } catch (error) {
    console.warn(
      "Failed to derive the hardware settings fingerprint for legacy migration; using the hardware fallback key.",
      error
    );
    return getHardwareFallbackEncryptionKey();
  }
}

function resolveSettingsPathFromEnvironment(): string {
  try {
    return path.join(app.getPath("userData"), DEFAULT_STORE_FILE_NAME);
  } catch {
    return path.join(process.cwd(), FALLBACK_STORE_FILE_NAME);
  }
}

function resolveKeyFilePathFromEnvironment(): string {
  return path.join(path.dirname(settingsPathResolver()), STORE_KEY_FILE_NAME);
}

function getStoreLocation(): { cwd: string; name: string } {
  const settingsPath = settingsPathResolver();
  return {
    cwd: path.dirname(settingsPath),
    name: path.basename(settingsPath, path.extname(settingsPath)),
  };
}

function createElectronStore(options: StoreFactoryOptions): Store {
  const location = getStoreLocation();

  if (options.mode === "legacy-encrypted") {
    return new Store({
      ...location,
      encryptionKey: options.encryptionKey,
      clearInvalidConfig: false,
    });
  }

  if (options.mode === "plaintext-migration") {
    let allowLegacyBytes = true;
    const migrationStore = new Store({
      ...location,
      clearInvalidConfig: false,
      deserialize: (value) => {
        if (allowLegacyBytes) return {};
        return JSON.parse(value) as Record<string, unknown>;
      },
    });
    allowLegacyBytes = false;
    return migrationStore;
  }

  if (options.mode === "preinit-placeholder") {
    return new Store({
      ...location,
      clearInvalidConfig: false,
      deserialize: () => ({}),
    });
  }

  return new Store({
    ...location,
    clearInvalidConfig: false,
  });
}

function createStore(options: StoreFactoryOptions): Store {
  return storeFactory(options);
}

function readCachedEncryptionKey(): string | null {
  try {
    const content = JSON.parse(fs.readFileSync(keyFilePathResolver(), "utf8")) as {
      key?: unknown;
    };
    return typeof content.key === "string" && content.key.length > 0 ? content.key : null;
  } catch {
    return null;
  }
}

function isSettingsSnapshot(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readPlaintextSnapshot(settingsPath: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(settingsPath, "utf8")) as unknown;
    if (!isSettingsSnapshot(parsed)) {
      throw new Error("Settings JSON must contain an object.");
    }
    return parsed;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    return null;
  }
}

function readStoreSnapshot(candidate: Store): Record<string, unknown> {
  const snapshot = candidate.store as unknown;
  if (!isSettingsSnapshot(snapshot)) {
    throw new Error("Settings store did not contain an object.");
  }
  return snapshot;
}

async function readLegacySnapshot(): Promise<Record<string, unknown> | null> {
  const tried = new Set<string>();

  const tryKey = (encryptionKey: string | null): Record<string, unknown> | null => {
    if (!encryptionKey || tried.has(encryptionKey)) return null;
    tried.add(encryptionKey);
    try {
      const legacyStore = createStore({
        mode: "legacy-encrypted",
        encryptionKey,
      });
      return readStoreSnapshot(legacyStore);
    } catch {
      // Try the next historical key without changing the original file.
      return null;
    }
  };

  let snapshot = tryKey(readCachedEncryptionKey());
  if (snapshot) return snapshot;

  snapshot = tryKey(getSynchronousFallbackEncryptionKey());
  if (snapshot) return snapshot;

  try {
    snapshot = tryKey(await hardwareKeyDeriver());
    if (snapshot) return snapshot;
  } catch (error) {
    console.warn("Failed to derive the legacy hardware settings key.", error);
  }

  return tryKey(getHardwareFallbackEncryptionKey());
}

function snapshotsMatch(
  expected: Record<string, unknown>,
  actual: Record<string, unknown>
): boolean {
  return JSON.stringify(actual) === JSON.stringify(expected);
}

function restoreOriginalSettings(settingsPath: string, originalBytes: Buffer): void {
  const restorePath = `${settingsPath}.${process.pid}.${Date.now()}.restore`;
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  fs.writeFileSync(restorePath, originalBytes);
  fs.renameSync(restorePath, settingsPath);
}

function migrateSnapshotToPlaintext(
  settingsPath: string,
  originalBytes: Buffer,
  snapshot: Record<string, unknown>
): Store {
  try {
    const plaintextStore = createStore({ mode: "plaintext-migration" });
    plaintextStore.store = snapshot;
    const verifiedSnapshot = readStoreSnapshot(plaintextStore);
    if (!snapshotsMatch(snapshot, verifiedSnapshot)) {
      throw new Error("Plaintext settings verification failed.");
    }
    return plaintextStore;
  } catch (error) {
    restoreOriginalSettings(settingsPath, originalBytes);
    throw error;
  }
}

function removeLegacyKeyFile(): void {
  try {
    fs.rmSync(keyFilePathResolver(), { force: true });
  } catch (error) {
    console.warn("Failed to remove the obsolete settings key file.", error);
  }
}

export async function initStore(): Promise<void> {
  if (storeInitialized) return;

  const settingsPath = settingsPathResolver();
  if (preInitializationOriginalBytes) {
    restoreOriginalSettings(settingsPath, preInitializationOriginalBytes);
    preInitializationOriginalBytes = null;
    store = null;
  }
  const plaintextSnapshot = readPlaintextSnapshot(settingsPath);

  if (plaintextSnapshot) {
    const plaintextStore = createStore({ mode: "plaintext" });
    const verifiedSnapshot = readStoreSnapshot(plaintextStore);
    if (!snapshotsMatch(plaintextSnapshot, verifiedSnapshot)) {
      throw new Error("Plaintext settings verification failed.");
    }
    store = plaintextStore;
    storeInitialized = true;
    removeLegacyKeyFile();
    return;
  }

  const originalBytes = fs.readFileSync(settingsPath);
  const legacySnapshot = await readLegacySnapshot();
  if (!legacySnapshot) {
    throw new Error(
      "The settings file is not valid plaintext JSON and could not be decrypted with any known legacy key. The original file was left unchanged."
    );
  }

  store = migrateSnapshotToPlaintext(settingsPath, originalBytes, legacySnapshot);
  storeInitialized = true;
  removeLegacyKeyFile();
  console.warn("Migrated legacy encrypted settings to plaintext.");
}

export function getStore(): Store {
  if (!store) {
    try {
      store = createStore({ mode: "plaintext" });
    } catch (error) {
      if (storeInitialized) throw error;
      preInitializationOriginalBytes = fs.readFileSync(settingsPathResolver());
      store = createStore({ mode: "preinit-placeholder" });
    }
  }
  return store;
}

export function resolveSettingsStorePath(): string {
  return store?.path ?? settingsPathResolver();
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
  storeInitialized = false;
  preInitializationOriginalBytes = null;
  storeFactory = createElectronStore;
  hardwareKeyDeriver = deriveHardwareEncryptionKey;
  settingsPathResolver = resolveSettingsPathFromEnvironment;
  keyFilePathResolver = resolveKeyFilePathFromEnvironment;
}

export function __setStoreFactoryForTests(
  factory: (options: StoreFactoryOptions) => Store
): void {
  storeFactory = factory;
}

export function __setHardwareKeyDeriverForTests(deriver: () => Promise<string>): void {
  hardwareKeyDeriver = deriver;
}

export function __setStorePathsForTests(settingsPath: string, keyFilePath?: string): void {
  settingsPathResolver = () => settingsPath;
  keyFilePathResolver = () =>
    keyFilePath ?? path.join(path.dirname(settingsPath), STORE_KEY_FILE_NAME);
}
