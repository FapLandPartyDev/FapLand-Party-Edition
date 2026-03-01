import { TRPCError } from "@trpc/server";
import * as z from "zod";
import {
  clearEroScriptsCache,
  clearEroScriptsLoginCookies,
  downloadEroScriptsFunscript,
  downloadEroScriptsVideo,
  getEroScriptsLoginStatus,
  listEroScriptsTopicMedia,
  openEroScriptsLoginWindow,
  searchEroScripts,
} from "../../services/eroscripts";
import { publicProcedure, router } from "../trpc";
import { eroscriptsDownloads, ZEroScriptsDownload } from "../../services/eroscriptsDownloads";

export const eroscriptsRouter = router({
  startDownload: publicProcedure
    .input(ZEroScriptsDownload)
    .mutation(({ input }) => eroscriptsDownloads.start(input)),
  getDownload: publicProcedure
    .input(z.object({ jobId: z.string().min(1) }))
    .query(({ input }) => eroscriptsDownloads.get(input.jobId)),
  listDownloads: publicProcedure.query(() => eroscriptsDownloads.list()),
  getLoginStatus: publicProcedure.query(() => getEroScriptsLoginStatus()),

  openLoginWindow: publicProcedure.mutation(() => openEroScriptsLoginWindow()),

  clearLoginCookies: publicProcedure.mutation(() => clearEroScriptsLoginCookies()),

  search: publicProcedure
    .input(
      z.object({
        query: z.string().optional(),
        tags: z.array(z.string()).optional(),
        limit: z.number().int().min(1).max(50).optional(),
      })
    )
    .query(async ({ input }) => {
      try {
        return await searchEroScripts(input);
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: error instanceof Error ? error.message : "EroScripts search failed.",
        });
      }
    }),

  listTopicMedia: publicProcedure
    .input(z.object({ topicId: z.number().int().positive() }))
    .query(async ({ input }) => {
      try {
        return await listEroScriptsTopicMedia(input.topicId);
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: error instanceof Error ? error.message : "Failed to load EroScripts topic.",
        });
      }
    }),

  downloadFunscript: publicProcedure
    .input(
      z.object({
        topicId: z.number().int().positive(),
        postId: z.number().int().positive().optional().nullable(),
        url: z.string().trim().min(1),
        filename: z.string().trim().min(1),
      })
    )
    .mutation(async ({ input }) => {
      try {
        return await downloadEroScriptsFunscript(input);
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: error instanceof Error ? error.message : "Failed to download funscript.",
        });
      }
    }),

  downloadVideo: publicProcedure
    .input(
      z.object({
        topicId: z.number().int().positive(),
        postId: z.number().int().positive().optional().nullable(),
        url: z.string().trim().min(1),
      })
    )
    .mutation(async ({ input }) => {
      try {
        return await downloadEroScriptsVideo(input);
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: error instanceof Error ? error.message : "Failed to download video.",
        });
      }
    }),

  clearCache: publicProcedure.mutation(async () => {
    await clearEroScriptsCache();
    return { cleared: true };
  }),
});
