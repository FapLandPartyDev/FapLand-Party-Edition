import { randomBytes } from "node:crypto";

// Funlink lets local hubs such as MultiFunPlayer offer a one-click connection.
// The announcement is repeated so a hub started later still finds F-Land, and
// a hub forgets it on its own when the announcements stop.
const FIRST_PORT = 37420;
const PORT_COUNT = 10;
const INTERVAL_MS = 5000;
const TIMEOUT_MS = 1000;

export type FunlinkService = { protocol: string; endpoint: string; features?: string[] };
export type FunlinkRecord = {
  id: string;
  name: string;
  version?: string;
  icon?: string;
  services: FunlinkService[];
};
export type FunlinkHub = {
  port: number;
  id: string;
  name: string;
  version: string | null;
  state: string;
};

/** Every port a hub may listen on, or only `FUNLINK_PORT` when it is set. */
export function funlinkPorts(env: NodeJS.ProcessEnv = process.env): number[] {
  const override = Number(env.FUNLINK_PORT);
  if (Number.isInteger(override) && override > 0 && override <= 65535) return [override];
  return Array.from({ length: PORT_COUNT }, (_, index) => FIRST_PORT + index);
}

export function funlinkSession() {
  return randomBytes(8).toString("hex");
}

export class FunlinkAnnouncer {
  private timer: ReturnType<typeof setInterval> | null = null;
  private body: string | null = null;
  private record: (FunlinkRecord & { session: string }) | null = null;
  private known = new Map<number, FunlinkHub>();
  private rounds = new Set<Promise<void>>();

  constructor(
    private readonly ports = funlinkPorts(),
    private readonly intervalMs = INTERVAL_MS
  ) {}

  /** Starts or replaces the announcement. The session lasts until stop. */
  start(record: FunlinkRecord) {
    this.record = { ...record, session: this.record?.session ?? funlinkSession() };
    this.body = JSON.stringify(this.record);
    if (!this.timer) {
      this.timer = setInterval(() => void this.announce(), this.intervalMs);
      this.timer.unref();
    }
    return this.announce();
  }

  /**
   * Tells every hub that F-Land is gone, so its prompt disappears at once. A
   * hub may have accepted an announcement whose reply has not arrived yet, so
   * the goodbye goes to every port, after the announcements in flight so it
   * cannot arrive first; closed ports refuse at once.
   */
  async stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    const record = this.record;
    this.record = null;
    this.body = null;
    await Promise.all(this.rounds);
    this.known.clear();
    if (!record) return;
    const bye = JSON.stringify({ id: record.id, session: record.session });
    await Promise.all(this.ports.map((port) => post(port, "bye", bye).catch(() => null)));
  }

  hubs(): FunlinkHub[] {
    return [...this.known.values()];
  }

  private announce() {
    const body = this.body;
    if (!body) return Promise.resolve();
    const round = this.round(body);
    this.rounds.add(round);
    return round.finally(() => this.rounds.delete(round));
  }

  private async round(body: string) {
    await Promise.all(
      this.ports.map(async (port) => {
        try {
          const response = await post(port, "announce", body);
          if (body !== this.body) return;
          const hub = response.ok ? parseHub(port, await response.json()) : null;
          if (hub) this.known.set(port, hub);
          else this.known.delete(port);
        } catch {
          // Nothing listens on this port.
          this.known.delete(port);
        }
      })
    );
  }
}

function post(port: number, path: "announce" | "bye", body: string) {
  return fetch(`http://127.0.0.1:${port}/funlink/v1/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
}

function parseHub(port: number, value: unknown): FunlinkHub | null {
  const response = value as {
    hub?: { id?: unknown; name?: unknown; version?: unknown };
    state?: unknown;
  };
  const hub = response?.hub;
  if (typeof hub?.id !== "string" || typeof hub.name !== "string") return null;
  return {
    port,
    id: hub.id,
    name: hub.name,
    version: typeof hub.version === "string" ? hub.version : null,
    state: typeof response.state === "string" ? response.state : "available",
  };
}
