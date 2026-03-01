import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  type Tool,
  type CallToolResult,
} from "@modelcontextprotocol/sdk/types.js";
import type { AnyRouter } from "@trpc/server";
import { z } from "zod";

export type ControlTool = {
  name: string;
  description: string;
  schema: z.ZodType;
  readOnly?: boolean;
  run: (input: never) => unknown;
};
type Procedure = {
  _def: { type: string; inputs: unknown[]; meta?: Record<string, unknown> };
};

export function jsonSchema(
  schema: z.ZodType,
  io: "input" | "output" = "input"
): Tool["inputSchema"] {
  return z.toJSONSchema(schema, {
    io,
    unrepresentable: "any",
    target: "draft-7",
  }) as Tool["inputSchema"];
}

const help: Record<string, string> = {
  "eroscripts.getLoginStatus":
    "Check the app's integrated EroScripts browser login. Search and script downloads reuse that session automatically; credentials/cookies are never returned.",
  "eroscripts.search":
    "Search EroScripts using the integrated signed-in session. Supply query/tags and inspect topicId results with listTopicMedia.",
  "eroscripts.listTopicMedia":
    "List script attachments and supported video links for an EroScripts topic using the existing session. Preserve candidate topicId/postId/url/filename for download tools. Unsupported archives/hosts are reported explicitly.",
  "eroscripts.startDownload":
    "Start a background funscript or supported video download using the integrated EroScripts session and app downloader. Supply kind, topicId, optional postId, url, and filename for scripts from listTopicMedia. Returns a job ID immediately; poll getDownload until completed or failed. Completed jobs return local URIs for inspection, cutting, importing or db.replaceRoundMedia. No round changes until a separate replacement/import call.",
  "eroscripts.getDownload":
    "Poll a background EroScripts download by jobId. Completed results contain funscriptUri/videoUri and filePath. Failed jobs contain an error. Jobs are scoped to the current app process.",
  "eroscripts.listDownloads":
    "List EroScripts background download jobs and their results/status in this app process.",
  "eroscripts.downloadFunscript":
    "Download a direct .funscript using the integrated EroScripts session. Returns a cached local funscriptUri/filePath. Prefer startDownload for a workflow with status polling.",
  "eroscripts.downloadVideo":
    "Download an EroScripts video attachment with the integrated session, or a supported trusted external video link through the app downloader. Prefer startDownload for long downloads so the MCP call returns immediately. The EroScripts login is not an account login for external video hosts.",
  "db.replaceRoundMedia":
    "Replace an installed round's video and/or funscript using downloaded local paths or app/file URIs; null detaches a script. Copies replacements into durable app storage independent of download caches. Preserves round IDs, metadata, script offset/inversion and trims unless resetTrim is true. Optional resourceId targets a specific resource. Returns previous media so it can be restored. Originals are not deleted. Rejects trims outside a shorter replacement video.",
  "db.updateRound":
    "Rename or edit a round, its trim boundaries (milliseconds), tags, type, difficulty or script. Read the round first and preserve existing fields: omitted optional fields can be reset by this operation.",
  "converter.saveSegments":
    "Cut a source video into named rounds, including internal cut ranges in milliseconds. Optionally remove source rounds after conversion.",
  "converter.inspectFrames":
    "See actual video frames before cutting. Choose startTimeMs/endTimeMs and frameCount (1..16), or exact timestampsMs. Returns timestamped images and video duration. Source times are milliseconds. Local paths/file/app URIs and already cached videos are supported; no edits are made.",
  "converter.inspectFunscript":
    "See the funscript's motion plot, metadata and exact action data. Select a source time range, paginate actions with offset/limit, or set normalized=false for raw positions. Plot covers the complete selected range independently of pagination. No edits are made.",
  "converter.autoDetect":
    "Preview round cuts using the editor's standard, adaptive or targetCount funscript auto-detection, including trim allowance and BPM/difficulty. Requires full source durationMs; inspectFrames can discover it. Returns proposals only, never saves. Inspect frames around boundaries, adjust segments, then save with converter.saveSegments.",
  "playlist.create":
    "Create a playlist or advanced graph map. Omit config for defaults, or read fland://schemas/playlist for the complete config schema.",
  "playlist.update":
    "Update playlist metadata or replace its complete config. Reorder linear rounds using boardConfig.normalRoundOrder; author advanced maps using graph nodes, edges, round pools, style and automations. Read fland://schemas/playlist and preserve unchanged config fields. For collaborative changes in the OPEN advanced map editor, use fland_map_editor instead so edits update the unsaved visible draft and its Undo history.",
  "store.set":
    "Set any persistent app setting by its exact key. Use fland_settings_catalog for available keys/defaults. Graphics and startup settings may require restarting the app.",
};

export function createControlServer(options: {
  router: AnyRouter;
  context: () => unknown;
  tools?: ControlTool[];
  resources?: Record<string, { description: string; value: unknown }>;
  afterMutation?: (path: string, input: unknown) => void | Promise<void>;
  runProcedure?: (callback: () => Promise<unknown>) => Promise<unknown>;
  formatResult?: (name: string, result: unknown) => CallToolResult | undefined;
}) {
  const server = new Server(
    { name: "f-land", version: "1.0.0" },
    {
      capabilities: { tools: {}, resources: {} },
      instructions:
        "Control the running local F-Land app. Use fland_screenshot to see the actual app; drive it with fland_ui_input using screenshotId and image-pixel coordinates. Actions return a fresh screenshot by default. fland_ui provides semantic DOM controls. Inspect before editing and preserve unrelated fields. Times are milliseconds unless stated otherwise. Mutations affect real local content. Poll status tools for background jobs. File paths need no authorization. Read fland://guide with fland_read_resource for workflows.",
    }
  );
  const procedures = options.router._def.procedures as Record<string, Procedure>;
  const routes = new Map<string, string>();
  const tools: Tool[] = [];
  for (const [path, procedure] of Object.entries(procedures)) {
    if (procedure._def.type === "subscription") continue;
    const name = `fland_${path.replaceAll(".", "_")}`;
    if (routes.has(name)) throw new Error(`Duplicate MCP tool: ${name}`);
    routes.set(name, path);
    const schemas = procedure._def.inputs as z.ZodType[];
    const schema =
      schemas.length === 0
        ? z.object({})
        : schemas.reduce((left, right) => z.intersection(left, right));
    tools.push({
      name,
      description:
        help[path] ??
        `${procedure._def.type === "query" ? "Read" : "Execute"} ${path} using the app's validated backend.`,
      inputSchema: jsonSchema(schema),
      annotations: {
        readOnlyHint: procedure._def.type === "query",
        destructiveHint: procedure._def.type !== "query",
        openWorldHint: true,
      },
    });
  }
  const resourceTool: ControlTool = {
    name: "fland_read_resource",
    description:
      "Read F-Land's workflow guide or complete playlist/map JSON schema. Use fland://guide, fland://schemas/playlist, or fland://schemas/graph. This also works in clients that do not expose MCP resources directly.",
    schema: z.object({ uri: z.string().min(1) }),
    readOnly: true,
    run: (input: { uri: string }) => {
      const resource = options.resources?.[input.uri];
      if (!resource) throw new Error(`Unknown resource: ${input.uri}`);
      return resource.value;
    },
  };
  const extras = new Map([resourceTool, ...(options.tools ?? [])].map((tool) => [tool.name, tool]));
  for (const tool of extras.values()) {
    if (routes.has(tool.name)) throw new Error(`Duplicate MCP tool: ${tool.name}`);
    tools.push({
      name: tool.name,
      description: tool.description,
      inputSchema: jsonSchema(tool.schema),
      annotations: {
        readOnlyHint: tool.readOnly ?? false,
        destructiveHint: !tool.readOnly,
        openWorldHint: true,
      },
    });
  }
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));
  server.setRequestHandler(CallToolRequestSchema, async ({ params }) => {
    try {
      const extra = extras.get(params.name);
      let result: unknown;
      if (extra) {
        result = await extra.run(extra.schema.parse(params.arguments ?? {}) as never);
      } else {
        const path = routes.get(params.name);
        if (!path) throw new Error(`Unknown tool: ${params.name}`);
        const procedure = procedures[path];
        const input = procedure._def.inputs.length ? (params.arguments ?? {}) : undefined;
        const caller = options.router.createCaller(options.context() as never);
        // tRPC's caller accepts dotted paths and still runs middleware and validators.
        const invoke = () => (caller[path] as (input: unknown) => Promise<unknown>)(input);
        result = await (options.runProcedure ? options.runProcedure(invoke) : invoke());
        if (procedure._def.type === "mutation") await options.afterMutation?.(path, input);
      }
      const formatted = options.formatResult?.(params.name, result);
      if (formatted) return formatted;
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(result === undefined ? { success: true } : result, (_, value) =>
              typeof value === "bigint" ? String(value) : value
            ),
          },
        ],
      };
    } catch (error) {
      return {
        isError: true,
        content: [
          { type: "text" as const, text: error instanceof Error ? error.message : String(error) },
        ],
      };
    }
  });
  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: Object.entries(options.resources ?? {}).map(([uri, resource]) => ({
      uri,
      name: uri.split("/").at(-1)!,
      description: resource.description,
      mimeType: "application/json",
    })),
  }));
  server.setRequestHandler(ReadResourceRequestSchema, async ({ params }) => {
    const resource = options.resources?.[params.uri];
    if (!resource) throw new Error(`Unknown resource: ${params.uri}`);
    return {
      contents: [
        { uri: params.uri, mimeType: "application/json", text: JSON.stringify(resource.value) },
      ],
    };
  });
  return server;
}
