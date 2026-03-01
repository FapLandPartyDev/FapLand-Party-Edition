import { z } from "zod";
import { ZMapEditorRequest } from "./mapEditorSchema";

export const ZMcpUiRequest = z.object({
  action: z.enum(["inspect", "navigate", "click", "set", "key", "media", "mapEditor"]),
  editor: ZMapEditorRequest.optional(),
  targetId: z.string().optional(),
  path: z.string().startsWith("/").optional(),
  value: z.union([z.string(), z.number(), z.boolean()]).optional(),
  key: z.string().optional(),
  mediaAction: z.enum(["play", "pause", "seek", "volume", "mute"]).optional(),
});
export type McpUiRequest = z.infer<typeof ZMcpUiRequest>;
export type McpChange = { procedure: string; setting?: { key: string; value: unknown } };
export type McpStatus = {
  enabled: boolean;
  running: boolean;
  port: number;
  url: string;
  error: string | null;
};
export const MCP_CHANGED_EVENT = "fland:mcp-changed";
