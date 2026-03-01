import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import { type IpcMainInvokeEvent } from "electron";

export interface Context {
    event: IpcMainInvokeEvent;
}

const t = initTRPC.context<Context>().create({
    isServer: true,
    transformer: superjson,
});

export const router = t.router;

/**
 * A procedure that ensures the caller is the renderer process.
 */
export const publicProcedure = t.procedure.use(({ ctx, next }) => {
    if (!ctx.event || !ctx.event.sender) {
        throw new TRPCError({
            code: "UNAUTHORIZED",
            message: "This procedure can only be called from a renderer process",
        });
    }

    return next();
});
