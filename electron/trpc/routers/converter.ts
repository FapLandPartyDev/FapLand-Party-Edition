import { TRPCError } from "@trpc/server";
import * as z from "zod";
import { saveConvertedRounds } from "../../services/converter";
import { publicProcedure, router } from "../trpc";

const ZRoundType = z.enum(["Normal", "Interjection", "Cum"]);
const ZRoundCutRange = z.object({
  startTimeMs: z.number().int().nonnegative(),
  endTimeMs: z.number().int().nonnegative(),
});

export const converterRouter = router({
  saveSegments: publicProcedure
    .input(
      z.object({
        hero: z.object({
          name: z.string().trim().min(1),
          author: z.string().optional().nullable(),
          description: z.string().optional().nullable(),
        }),
        source: z.object({
          videoUri: z.string().trim().min(1),
          funscriptUri: z.string().optional().nullable(),
          sourceRoundId: z.string().trim().min(1).optional().nullable(),
          sourceRoundIds: z.array(z.string().trim().min(1)).optional().nullable(),
          removeSourceRound: z.boolean().optional(),
        }),
        allowOverlaps: z.boolean().optional(),
        segments: z
          .array(
            z.object({
              startTimeMs: z.number().finite(),
              endTimeMs: z.number().finite(),
              type: ZRoundType,
              customName: z.string().optional().nullable(),
              bpm: z.number().finite().min(1).max(400).optional().nullable(),
              difficulty: z.number().int().min(1).max(5).optional().nullable(),
              cutRanges: z.array(ZRoundCutRange).optional().nullable(),
            }),
          )
          .min(1),
      }),
    )
    .mutation(async ({ input }) => {
      try {
        return await saveConvertedRounds(input);
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: error instanceof Error ? error.message : "Failed to save converted rounds.",
        });
      }
    }),
});
