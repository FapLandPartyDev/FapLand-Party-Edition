// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { z } from "zod";
import { createControlServer, jsonSchema } from "./protocol";
import { listenMcp } from "./http";
import { publicProcedure, router } from "../trpc/trpc";
import { ZGraphBoardConfig, ZPlaylistConfig } from "../../src/game/playlistSchema";
import { request, type Server } from "node:http";

const servers: Server[] = [];
const clients: Client[] = [];
afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close()));
  await Promise.all(
    servers.splice(0).map(
      (http) =>
        new Promise<void>((resolve) => {
          http.close(() => resolve());
          http.closeAllConnections();
        })
    )
  );
});

async function fixture() {
  const state = { name: "Original", deleted: false };
  const changed = vi.fn();
  const testRouter = router({
    library: router({
      read: publicProcedure.query(() => state),
      nullValue: publicProcedure.query(() => null),
      rename: publicProcedure.input(z.object({ name: z.string().min(1) })).mutation(({ input }) => {
        state.name = input.name;
        return state;
      }),
      delete: publicProcedure.mutation(() => {
        state.deleted = true;
      }),
      optional: publicProcedure
        .input(z.object({ limit: z.number().int().positive().default(10) }).optional())
        .query(({ input }) => input),
    }),
  });
  const http = await listenMcp({
    port: 0,
    createServer: () =>
      createControlServer({
        router: testRouter,
        context: () => ({ source: "mcp" }),
        afterMutation: changed,
        resources: {
          "fland://schemas/graph": {
            description: "Graph schema",
            value: jsonSchema(ZGraphBoardConfig),
          },
        },
        tools: [
          {
            name: "fland_extra",
            schema: z.object({ value: z.number() }),
            description: "Extra",
            run: ({ value }: { value: number }) => value * 2,
          },
        ],
      }),
  });
  servers.push(http);
  const url = new URL(`http://127.0.0.1:${(http.address() as { port: number }).port}/mcp`);
  const client = new Client({ name: "integration-test", version: "1" });
  clients.push(client);
  await client.connect(new StreamableHTTPClientTransport(url, {}));
  return { client, url, state, changed, testRouter };
}

describe("MCP protocol and HTTP integration", () => {
  it("discovers every backend procedure with usable schemas and annotations", async () => {
    const { client } = await fixture();
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name)).toEqual(
      expect.arrayContaining([
        "fland_library_read",
        "fland_library_rename",
        "fland_library_delete",
        "fland_library_optional",
        "fland_extra",
      ])
    );
    expect(
      tools.find((tool) => tool.name === "fland_library_rename")?.inputSchema.required
    ).toEqual(["name"]);
    expect(
      tools.find((tool) => tool.name === "fland_library_read")?.annotations?.readOnlyHint
    ).toBe(true);
    expect(
      tools.find((tool) => tool.name === "fland_library_delete")?.annotations?.destructiveHint
    ).toBe(true);
  });
  it("executes actual tRPC mutations, enforces validation, and notifies only on success", async () => {
    const { client, state, changed } = await fixture();
    const invalid = await client.callTool({
      name: "fland_library_rename",
      arguments: { name: "" },
    });
    expect(invalid.isError).toBe(true);
    expect(state.name).toBe("Original");
    expect(changed).not.toHaveBeenCalled();
    expect(
      (await client.callTool({ name: "fland_library_rename", arguments: { name: "Renamed" } }))
        .isError
    ).toBeUndefined();
    expect(state.name).toBe("Renamed");
    expect(changed).toHaveBeenCalledWith("library.rename", { name: "Renamed" });
    await client.callTool({ name: "fland_library_delete" });
    expect(state.deleted).toBe(true);
    expect((await client.callTool({ name: "missing" })).isError).toBe(true);
    expect((await client.callTool({ name: "fland_library_nullValue" })).content).toEqual([
      { type: "text", text: "null" },
    ]);
    expect(
      (await client.callTool({ name: "fland_extra", arguments: { value: "wrong" } })).isError
    ).toBe(true);
  });
  it("retains renderer checks while permitting a local MCP context", async () => {
    const { testRouter } = await fixture();
    await expect(testRouter.createCaller({} as never).library.read()).rejects.toThrow(
      "renderer process"
    );
  });
  it("serves the full advanced map and playlist schema, including preprocessed config", async () => {
    const { client } = await fixture();
    expect((await client.listResources()).resources).toHaveLength(1);
    const { contents } = await client.readResource({ uri: "fland://schemas/graph" });
    expect(JSON.parse((contents[0] as { text: string }).text).properties.nodes).toBeDefined();
    const playlist = jsonSchema(ZPlaylistConfig, "output");
    expect(playlist.properties?.boardConfig).toBeDefined();
    expect(playlist.properties?.probabilityScaling).toBeDefined();
  });
  it("needs no authentication and rejects browser origins, foreign hosts and unsupported methods", async () => {
    const { url } = await fixture();
    expect((await fetch(url, { headers: { Origin: "https://evil.example" } })).status).toBe(403);
    const foreignHostStatus = await new Promise<number | undefined>((resolve, reject) => {
      request(url, { headers: { Host: "evil.example" } }, (response) => {
        response.resume();
        resolve(response.statusCode);
      })
        .on("error", reject)
        .end();
    });
    expect(foreignHostStatus).toBe(403);
    expect((await fetch(url)).status).toBe(405);
    expect((await fetch(new URL("/other", url))).status).toBe(404);
  });
  it("supports simultaneous clients without sharing transports", async () => {
    const { client, url } = await fixture();
    const second = new Client({ name: "second", version: "1" });
    clients.push(second);
    await second.connect(new StreamableHTTPClientTransport(url, {}));
    const results = await Promise.all([
      client.listTools(),
      second.listTools(),
      client.callTool({ name: "fland_library_optional", arguments: {} }),
    ]);
    expect(results[0].tools).toEqual(results[1].tools);
    expect(results[2].isError).toBeUndefined();
  });
  it("connects a real stdio MCP client through the shipped bridge", async () => {
    const { url, state } = await fixture();
    const client = new Client({ name: "stdio-test", version: "1" });
    clients.push(client);
    await client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: ["scripts/mcp-stdio.mjs"],
        env: {
          ...(process.env as Record<string, string>),
          FLAND_MCP_URL: url.href,
        },
      })
    );
    expect((await client.listTools()).tools.length).toBeGreaterThan(0);
    await client.callTool({ name: "fland_library_rename", arguments: { name: "From stdio" } });
    expect(state.name).toBe("From stdio");
  });
});
