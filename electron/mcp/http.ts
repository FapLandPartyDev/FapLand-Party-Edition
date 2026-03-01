import { createServer, type Server as HttpServer } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";

export async function listenMcp(options: {
  port: number;
  createServer: () => Server;
}): Promise<HttpServer> {
  const active = new Set<Server>();
  const http = createServer(async (request, response) => {
    // Loopback binding and Host/Origin checks prevent websites from driving the local app.
    const hosts = new Set([
      `127.0.0.1:${(http.address() as { port: number }).port}`,
      `localhost:${(http.address() as { port: number }).port}`,
    ]);
    if (!hosts.has(request.headers.host ?? "") || request.headers.origin) {
      response.writeHead(403).end("MCP accepts non-browser clients on loopback only.");
      return;
    }
    if (request.url !== "/mcp") {
      response.writeHead(404).end();
      return;
    }
    if (request.method !== "POST") {
      response.writeHead(405, { Allow: "POST" }).end();
      return;
    }
    try {
      const server = options.createServer();
      active.add(server);
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });
      response.on("close", () => {
        active.delete(server);
        void server.close();
      });
      await server.connect(transport);
      await transport.handleRequest(request, response);
    } catch {
      if (!response.headersSent) response.writeHead(500).end("MCP request failed.");
      else response.end();
    }
  });
  http.on("close", () => {
    for (const server of active) void server.close();
  });
  http.requestTimeout = 120_000;
  await new Promise<void>((resolve, reject) => {
    http.once("error", reject);
    http.listen(options.port, "127.0.0.1", () => {
      http.removeListener("error", reject);
      resolve();
    });
  });
  return http;
}
