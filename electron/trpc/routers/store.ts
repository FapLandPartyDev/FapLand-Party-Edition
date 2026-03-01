import * as z from "zod";
import { router, publicProcedure } from "../trpc";
import { getStore } from "../../services/store";

export const storeRouter = router({
    get: publicProcedure
        .input(z.object({ key: z.string() }))
        .query(({ input }) => {
            try {
                return getStore().get(input.key);
            } catch (err) {
                console.error("Failed to getStore().get:", err);
                throw err;
            }
        }),

    set: publicProcedure
        .input(z.object({ key: z.string(), value: z.unknown() }))
        .mutation(({ input }) => {
            getStore().set(input.key, input.value);
        }),
});
