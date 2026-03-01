// @vitest-environment node
import { afterEach, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createServer } from "node:net";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { McpRuntime } from "./runtime";

const directories: string[] = [];
const runtimes: McpRuntime[] = [];
afterEach(async () => {
  await Promise.all(runtimes.splice(0).map((runtime) => runtime.stop()));
  for (const directory of directories.splice(0))
    fs.rmSync(directory, { recursive: true, force: true });
});
function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "fland-mcp-test-"));
  directories.push(directory);
  const configPath = path.join(directory, "mcp-server.json");
  const runtime = new McpRuntime(configPath, () => new Server({ name: "test", version: "1" }));
  runtimes.push(runtime);
  return { runtime, configPath };
}
async function freePort() {
  const socket = createServer();
  await new Promise<void>((resolve) => socket.listen(0, "127.0.0.1", resolve));
  const port = (socket.address() as { port: number }).port;
  await new Promise<void>((resolve) => socket.close(() => resolve()));
  return port;
}
it("persists enable/disable settings and stops accepting connections when disabled", async () => {
  const { runtime, configPath } = fixture();
  const original = await runtime.configure({ enabled: true, port: await freePort() });
  expect(original.running).toBe(true);
  expect((await fetch(original.url)).status).toBe(405);
  const reloaded = new McpRuntime(configPath, () => new Server({ name: "test", version: "1" }));
  expect(reloaded.status().enabled).toBe(true);
  expect(reloaded.status().port).toBe(original.port);
  expect((await runtime.configure({ enabled: false, port: original.port })).running).toBe(false);
  await expect(fetch(original.url)).rejects.toThrow();
});
it("reports port conflicts without crashing and can recover", async () => {
  const first = fixture().runtime;
  const second = fixture().runtime;
  const port = await freePort();
  await first.configure({ enabled: true, port });
  const failed = await second.configure({ enabled: true, port });
  expect(failed.running).toBe(false);
  expect(failed.error).toContain("EADDRINUSE");
  await first.stop();
  await second.start();
  expect(second.status().running).toBe(true);
});
it("rejects invalid ports and serializes concurrent configuration requests", async () => {
  const { runtime } = fixture();
  await expect(runtime.configure({ enabled: true, port: 0 })).rejects.toThrow("Port");
  await Promise.all([
    runtime.configure({ enabled: true, port: await freePort() }),
    runtime.configure({ enabled: false, port: 32123 }),
  ]);
  expect(runtime.status().enabled).toBe(false);
  expect(runtime.status().running).toBe(false);
});
