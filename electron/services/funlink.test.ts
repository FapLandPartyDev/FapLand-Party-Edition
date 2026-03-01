// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { FunlinkAnnouncer, funlinkPorts } from "./funlink";
import { MultiFunPlayerBridge, startSavedBridge } from "./multifunplayer";

type Received = { path: string; body: Record<string, unknown>; host: string | undefined };

const servers: Server[] = [];
const announcers: FunlinkAnnouncer[] = [];
afterEach(async () => {
  await Promise.all(announcers.splice(0).map((announcer) => announcer.stop()));
  await Promise.all(
    servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve)))
  );
});

async function hub(state = "available", delayMs = 0) {
  const received: Received[] = [];
  const server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => (body += chunk));
    request.on("end", async () => {
      if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
      received.push({
        path: request.url ?? "",
        body: JSON.parse(body),
        host: request.headers.host,
      });
      if (request.url === "/funlink/v1/bye") {
        response.writeHead(204).end();
        return;
      }
      response.writeHead(200, { "Content-Type": "application/json" }).end(
        JSON.stringify({
          hub: { id: "hub", name: "MultiFunPlayer", version: "0.1.0" },
          supported: ["ofs-ws"],
          state,
        })
      );
    });
  });
  servers.push(server);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return { port: (server.address() as AddressInfo).port, received };
}

async function until(condition: () => boolean) {
  for (let attempt = 0; attempt < 100 && !condition(); attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  expect(condition()).toBe(true);
}

describe("Funlink announcer", () => {
  it("scans the reserved range unless FUNLINK_PORT selects one port", () => {
    expect(funlinkPorts({})).toEqual([
      37420, 37421, 37422, 37423, 37424, 37425, 37426, 37427, 37428, 37429,
    ]);
    expect(funlinkPorts({ FUNLINK_PORT: "40000" })).toEqual([40000]);
    expect(funlinkPorts({ FUNLINK_PORT: "nope" })).toHaveLength(10);
  });

  it("announces the complete record, remembers the hub and says bye on stop", async () => {
    const { port, received } = await hub("connected");
    const closed = await hub();
    await new Promise((resolve) => servers.pop()!.close(resolve));
    const announcer = new FunlinkAnnouncer([port, closed.port]);
    announcers.push(announcer);
    await announcer.start({
      id: "install",
      name: "FapLand",
      services: [{ protocol: "ofs-ws", endpoint: "ws://127.0.0.1:8080/ofs" }],
    });

    expect(received).toHaveLength(1);
    const [announce] = received;
    expect(announce.path).toBe("/funlink/v1/announce");
    expect(announce.host).toBe(`127.0.0.1:${port}`);
    expect(announce.body).toMatchObject({ id: "install", name: "FapLand" });
    expect(announce.body.session).toMatch(/^[0-9a-f]{16}$/);
    expect(announcer.hubs()).toEqual([
      { port, id: "hub", name: "MultiFunPlayer", version: "0.1.0", state: "connected" },
    ]);

    await announcer.stop();
    expect(received[1]).toMatchObject({
      path: "/funlink/v1/bye",
      body: { id: "install", session: announce.body.session },
    });
    expect(announcer.hubs()).toEqual([]);
  });

  it("says bye after an announcement still awaiting its reply", async () => {
    const { port, received } = await hub("available", 200);
    const announcer = new FunlinkAnnouncer([port]);
    announcers.push(announcer);
    void announcer.start({ id: "install", name: "FapLand", services: [] });
    await new Promise((resolve) => setTimeout(resolve, 50));
    await announcer.stop();
    expect(received.map(({ path }) => path)).toEqual(["/funlink/v1/announce", "/funlink/v1/bye"]);
  });

  it("repeats the announcement with the same session", async () => {
    const { port, received } = await hub();
    const announcer = new FunlinkAnnouncer([port], 20);
    announcers.push(announcer);
    await announcer.start({ id: "install", name: "FapLand", services: [] });
    await until(() => received.length >= 3);
    expect(new Set(received.map(({ body }) => body.session)).size).toBe(1);
  });

  it("is announced by the bridge with its actual port", async () => {
    const { port, received } = await hub();
    const bridge = new MultiFunPlayerBridge();
    (bridge as unknown as { announcer: FunlinkAnnouncer }).announcer = new FunlinkAnnouncer([port]);
    bridge.funlink = { id: "install" };
    bridge.version = "0.6.31";
    await bridge.start(0);
    await until(() => received.length > 0);
    const ofs = bridge.status().port;
    const address = (bridge as unknown as { server: { address(): AddressInfo } }).server.address();
    expect(ofs).toBe(address.port);
    expect(received[0].body).toMatchObject({
      id: "install",
      name: "FapLand (Funlink test)",
      version: "0.6.31",
      services: [
        {
          protocol: "ofs-ws",
          endpoint: `ws://127.0.0.1:${address.port}/ofs`,
          features: ["fapland-native"],
        },
      ],
    });
    await bridge.stop();
    expect(received.at(-1)?.path).toBe("/funlink/v1/bye");
  });
});

describe("Bridge startup", () => {
  const bridges: MultiFunPlayerBridge[] = [];
  afterEach(async () => {
    await Promise.all(bridges.splice(0).map((bridge) => bridge.stop()));
  });

  async function busyPort() {
    const server = createServer();
    servers.push(server);
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    return (server.address() as AddressInfo).port;
  }

  function bridge() {
    const created = new MultiFunPlayerBridge();
    (created as unknown as { announcer: FunlinkAnnouncer }).announcer = new FunlinkAnnouncer([]);
    bridges.push(created);
    return created;
  }

  it("runs on a fresh install, on a free port when the default is busy", async () => {
    const port = await busyPort();
    const fresh = bridge();
    await startSavedBridge(fresh, undefined, port);
    expect(fresh.status().running).toBe(true);
    expect(fresh.status().port).not.toBe(port);
  });

  it("keeps a bridge the user turned off stopped", async () => {
    const off = bridge();
    await startSavedBridge(off, false, 18081);
    expect(off.status().running).toBe(false);
  });

  it("reports a busy port the user chose", async () => {
    const port = await busyPort();
    await expect(startSavedBridge(bridge(), true, port)).rejects.toThrow();
  });
});
