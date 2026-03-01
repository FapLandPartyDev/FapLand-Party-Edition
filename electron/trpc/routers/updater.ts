import * as z from "zod";
import { checkForAppUpdates, getUpdateState, openLatestDownload, shouldRefreshUpdateState } from "../../services/updater";
import { publicProcedure, router } from "../trpc";

export const updaterRouter = router({
    getState: publicProcedure.query(() => {
        return getUpdateState();
    }),

    check: publicProcedure
        .input(z.object({ force: z.boolean().optional() }).optional())
        .mutation(({ input }) => {
            return checkForAppUpdates(Boolean(input?.force));
        }),

    ensureFresh: publicProcedure.mutation(() => {
        const state = getUpdateState();
        if (shouldRefreshUpdateState(state) || state.status === "idle") {
            return checkForAppUpdates(false);
        }
        return state;
    }),

    openLatestDownload: publicProcedure.mutation(() => {
        return openLatestDownload();
    }),
});
