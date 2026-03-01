import * as z from "zod";
import { router, publicProcedure } from "../trpc";
import { generateVideoPhash } from "../../services/phash";

export const phashRouter = router({
  generate: publicProcedure
    .input(
      z.object({
        path: z.string(),
        startTime: z.number().optional(),
        endTime: z.number().optional(),
      })
    )
    .query(({ input }) => {
      return generateVideoPhash(input.path, input.startTime, input.endTime);
    }),
});
