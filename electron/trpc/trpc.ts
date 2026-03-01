import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import { type IpcMainInvokeEvent } from "electron";

export type Context =
  | { event: IpcMainInvokeEvent; source?: "renderer" }
  | { source: "mcp"; event?: undefined };

const t = initTRPC.context<Context>().create({
  isServer: true,
  transformer: superjson,
});

export const router = t.router;

/**
 * Accept renderer IPC calls and the main process's local MCP control context.
 */
export const publicProcedure = t.procedure.use(({ ctx, next }) => {
  if (ctx.source !== "mcp" && (!ctx.event || !ctx.event.sender)) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "This procedure can only be called from a renderer process",
    });
  }

  return next();
});
