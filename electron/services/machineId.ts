import si from "systeminformation";
import crypto from "crypto";
import { getStore } from "./store";

const MACHINE_ID_KEY = "machine-id";
// A static salt to ensure the ID is unique to this application
const APP_SALT = "f-land-multiplayer-v1-salt-juicy-tactile";
const HARDWARE_PROBE_TIMEOUT_MS = 2000;

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

export async function getMachineId(): Promise<string> {
  const store = getStore();
  const cachedId = store.get(MACHINE_ID_KEY);

  if (typeof cachedId === "string" && cachedId.length > 0) {
    return cachedId;
  }

  const [cpu, baseboard, bios, net] = await Promise.all([
    withTimeout(si.cpu(), HARDWARE_PROBE_TIMEOUT_MS).catch(() => null),
    withTimeout(si.baseboard(), HARDWARE_PROBE_TIMEOUT_MS).catch(() => null),
    withTimeout(si.bios(), HARDWARE_PROBE_TIMEOUT_MS).catch(() => null),
    withTimeout(si.networkInterfaces(), HARDWARE_PROBE_TIMEOUT_MS).catch(() => null),
  ]);

  const seedParts: string[] = [];
  if (cpu) {
    seedParts.push(`cpu:${cpu.brand}|${cpu.model}|${cpu.cores}`);
  }
  if (baseboard) {
    seedParts.push(`board:${baseboard.manufacturer}|${baseboard.model}|${baseboard.serial}`);
  }
  if (bios) {
    seedParts.push(`bios:${bios.vendor}|${bios.version}|${bios.releaseDate}`);
  }
  if (Array.isArray(net)) {
    const macs = net
      .filter((n) => !n.virtual && n.mac && n.mac !== "00:00:00:00:00:00")
      .map((n) => n.mac)
      .sort();
    if (macs.length > 0) {
      seedParts.push(`mac:${macs.join(",")}`);
    }
  }

  const machineId =
    seedParts.length > 0
      ? crypto
          .createHash("sha256")
          .update(seedParts.join("::") + APP_SALT)
          .digest("hex")
      : crypto.randomUUID();

  store.set(MACHINE_ID_KEY, machineId);
  return machineId;
}
