#!/usr/bin/env node
// A dependency-free stdio -> Streamable HTTP bridge for the running app.
// stdout is exclusively JSON-RPC. The app server binds only to loopback.
import { createInterface } from "node:readline";

const endpoint = process.env.FLAND_MCP_URL ?? "http://127.0.0.1:32123/mcp";
const url = new URL(endpoint);
if (
  !["http:", "https:"].includes(url.protocol) ||
  (url.protocol === "http:" && !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname))
) {
  console.error("MCP URL must use HTTPS or loopback HTTP.");
  process.exit(1);
}
let protocolVersion;
const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);
const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
const pending = new Set();
async function forward(line) {
  let message;
  try {
    message = JSON.parse(line);
    const response = await fetch(url, {
      method: "POST",
      redirect: "error",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        ...(protocolVersion ? { "MCP-Protocol-Version": protocolVersion } : {}),
      },
      body: JSON.stringify(message),
    });
    if (!response.ok)
      throw new Error(
        `MCP HTTP ${response.status}. Ensure the app is running, MCP is enabled, and the URL matches its settings.`
      );
    if (response.status === 202 || response.status === 204) return;
    const result = await response.json();
    if (message.method === "initialize" && result.result?.protocolVersion)
      protocolVersion = result.result.protocolVersion;
    send(result);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    if (message && "id" in message)
      send({ jsonrpc: "2.0", id: message.id, error: { code: -32603, message: detail } });
    else console.error(detail);
  }
}
lines.on("line", (line) => {
  if (!line.trim()) return;
  const task = forward(line).finally(() => pending.delete(task));
  pending.add(task);
});
lines.on("close", () => {
  // Let Node finish closing its stdio handles naturally after outstanding fetches.
  void Promise.allSettled([...pending]);
});
