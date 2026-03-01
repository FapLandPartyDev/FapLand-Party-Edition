import si from "systeminformation";
import crypto from "crypto";
import { getStore } from "./store";

const MACHINE_ID_KEY = "machine-id";
// A static salt to ensure the ID is unique to this application
const APP_SALT = "f-land-multiplayer-v1-salt-juicy-tactile";

export async function getMachineId(): Promise<string> {
    const store = getStore();
    const cachedId = store.get(MACHINE_ID_KEY);

    if (typeof cachedId === "string") {
        return cachedId;
    }

    const [cpu, baseboard, bios, net] = await Promise.all([
        si.cpu(),
        si.baseboard(),
        si.bios(),
        si.networkInterfaces(),
    ]);

    // Gather stable hardware characteristics.
    // We prioritize manufacturers, models, and serial numbers.
    // system.uuid was empty in testing on this specific hardware, 
    // so we rely on these combined components.
    const cpuPart = `${cpu.brand}|${cpu.model}|${cpu.cores}`;
    const boardPart = `${baseboard.manufacturer}|${baseboard.model}|${baseboard.serial}`;
    const biosPart = `${bios.vendor}|${bios.version}|${bios.releaseDate}`;

    // Sort MAC addresses to ensure stability if order changes. 
    // Filter virtual interfaces.
    const macs = Array.isArray(net)
        ? net
            .filter((n) => !n.virtual && n.mac && n.mac !== "00:00:00:00:00:00")
            .map((n) => n.mac)
            .sort()
        : [];

    const macPart = macs.join(",");

    const seed = [cpuPart, boardPart, biosPart, macPart].join("::");

    // Create a secure hash that doesn't reveal raw hardware details
    const machineId = crypto
        .createHash("sha256")
        .update(seed + APP_SALT)
        .digest("hex");

    store.set(MACHINE_ID_KEY, machineId);
    return machineId;
}
