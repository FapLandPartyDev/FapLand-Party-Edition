import { TRPCError } from "@trpc/server";
import * as z from "zod";
import { resolvePlayableVideoUri } from "../../services/playableVideo";
import { publicProcedure, router } from "../trpc";

export const mediaRouter = router({
  resolvePlayableVideoUri: publicProcedure
    .input(
      z.object({
        videoUri: z.string().trim().min(1),
      }),
    )
    .query(async ({ input }) => {
      try {
        return await resolvePlayableVideoUri(input.videoUri);
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: error instanceof Error ? error.message : "Failed to resolve a playable video URI.",
        });
      }
    }),
});
