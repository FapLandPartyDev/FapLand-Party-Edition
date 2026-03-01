import Store from "electron-store";
import crypto from "crypto";
import si from "systeminformation";

const STORE_ENCRYPTION_SALT = "f-land-store-encryption-v1-pepper";
let store: Store | null = null;
let encryptionKeyPromise: Promise<string> | null = null;

async function deriveEncryptionKey(): Promise<string> {
  if (encryptionKeyPromise) return encryptionKeyPromise;

  encryptionKeyPromise = (async () => {
    try {
      const [cpu, baseboard, bios] = await Promise.all([si.cpu(), si.baseboard(), si.bios()]);
      const seed = [
        `${cpu.brand}|${cpu.model}|${cpu.cores}`,
        `${baseboard.manufacturer}|${baseboard.model}|${baseboard.serial}`,
        `${bios.vendor}|${bios.version}|${bios.releaseDate}`,
      ].join("::");
      return crypto
        .createHash("sha256")
        .update(seed + STORE_ENCRYPTION_SALT)
        .digest("hex");
    } catch {
      return crypto
        .createHash("sha256")
        .update("fallback-key" + STORE_ENCRYPTION_SALT)
        .digest("hex");
    }
  })();

  return encryptionKeyPromise;
}

function createStore(encryptionKey: string): Store {
  try {
    return new Store({ encryptionKey });
  } catch {
    return new Store({ cwd: process.cwd(), name: "f-land", encryptionKey });
  }
}

export async function initStore(): Promise<void> {
  if (store) return;
  const key = await deriveEncryptionKey();
  store = createStore(key);
}

export function getStore(): Store {
  if (!store) {
    store = createStore(
      crypto
        .createHash("sha256")
        .update("synchronous-fallback-key" + STORE_ENCRYPTION_SALT)
        .digest("hex")
    );
  }
  return store;
}
