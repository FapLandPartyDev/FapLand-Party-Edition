import { z } from "zod";
import { router, publicProcedure } from "../trpc";
import { multifunplayerBridge } from "../../services/multifunplayer";
import { safeStoreSet } from "../../services/store";

export const multifunplayerRouter = router({
  status: publicProcedure.query(() => multifunplayerBridge.status()),
  configure: publicProcedure
    .input(z.object({ enabled: z.boolean(), port: z.number().int().min(1024).max(65535) }))
    .mutation(async ({ input }) => {
      if (input.enabled) await multifunplayerBridge.start(input.port);
      else await multifunplayerBridge.stop();
      safeStoreSet("multifunplayer.enabled", input.enabled);
      safeStoreSet("multifunplayer.port", input.port);
      return multifunplayerBridge.status();
    }),
  setMedia: publicProcedure
    .input(
      z.object({
        key: z.string(),
        videoUri: z.string(),
        scriptUri: z.string().nullable(),
        actions: z.array(
          z.object({ at: z.number().finite().min(0), pos: z.number().finite().min(0).max(100) })
        ),
      })
    )
    .mutation(({ input }) => multifunplayerBridge.setMedia(input)),
  update: publicProcedure
    .input(
      z.object({
        key: z.string(),
        time: z.number().finite().min(0),
        duration: z.number().finite().min(0),
        speed: z.number().finite().positive(),
        playing: z.boolean(),
        offsetMs: z.number().finite().optional(),
      })
    )
    .mutation(({ input }) => multifunplayerBridge.update(input)),
  setRange: publicProcedure
    .input(
      z
        .object({
          output: z.string().min(1).max(100),
          axis: z.string().regex(/^[A-Z][0-9]$/),
          minimum: z.number().finite().min(0).max(1),
          maximum: z.number().finite().min(0).max(1),
        })
        .refine(({ minimum, maximum }) => maximum - minimum >= 0.01 - 1e-9, {
          message: "The range must span at least 1%.",
        })
    )
    .mutation(({ input }) =>
      multifunplayerBridge.setRange(input.output, input.axis, input.minimum, input.maximum)
    ),
  clear: publicProcedure
    .input(z.object({ key: z.string() }))
    .mutation(({ input }) => multifunplayerBridge.clear(input.key)),
});
