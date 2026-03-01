import { TRPCError } from "@trpc/server";
import * as z from "zod";
import {
  createSource,
  deleteSource,
  getExternalSyncStatus,
  listSources,
  resolveMediaUri,
  searchSourceTags,
  setSourceEnabled,
  syncExternalSources,
  testSourceConnection,
  updateSource,
} from "../../services/integrations";
import { publicProcedure, router } from "../trpc";

const ZRoundType = z.enum(["Normal", "Interjection", "Cum"]);

const ZTagSelection = z.object({
  id: z.string().trim().min(1),
  name: z.string().trim().min(1),
  roundTypeFallback: ZRoundType,
});

const ZCreateStashSourceInput = z.object({
  name: z.string().trim().min(1),
  enabled: z.boolean().optional(),
  baseUrl: z.string().trim().min(1),
  authMode: z.enum(["apiKey", "login"]),
  apiKey: z.string().optional().nullable(),
  username: z.string().optional().nullable(),
  password: z.string().optional().nullable(),
  tagSelections: z.array(ZTagSelection).default([]),
});

const ZUpdateStashSourceInput = z.object({
  sourceId: z.string().trim().min(1),
  name: z.string().trim().optional(),
  enabled: z.boolean().optional(),
  baseUrl: z.string().trim().optional(),
  authMode: z.enum(["apiKey", "login"]).optional(),
  apiKey: z.string().optional().nullable(),
  username: z.string().optional().nullable(),
  password: z.string().optional().nullable(),
  tagSelections: z.array(ZTagSelection).optional(),
});

export const integrationRouter = router({
  listSources: publicProcedure.query(() => {
    return listSources();
  }),

  createStashSource: publicProcedure.input(ZCreateStashSourceInput).mutation(({ input }) => {
    try {
      return createSource(input);
    } catch (error) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: error instanceof Error ? error.message : "Failed to create source.",
      });
    }
  }),

  updateStashSource: publicProcedure.input(ZUpdateStashSourceInput).mutation(({ input }) => {
    try {
      return updateSource(input);
    } catch (error) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: error instanceof Error ? error.message : "Failed to update source.",
      });
    }
  }),

  deleteSource: publicProcedure
    .input(z.object({ sourceId: z.string().trim().min(1) }))
    .mutation(({ input }) => {
      deleteSource(input.sourceId);
    }),

  setSourceEnabled: publicProcedure
    .input(z.object({ sourceId: z.string().trim().min(1), enabled: z.boolean() }))
    .mutation(({ input }) => {
      try {
        return setSourceEnabled(input);
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: error instanceof Error ? error.message : "Failed to toggle source.",
        });
      }
    }),

  testStashConnection: publicProcedure
    .input(z.object({ sourceId: z.string().trim().min(1) }))
    .mutation(async ({ input }) => {
      try {
        return await testSourceConnection(input.sourceId);
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: error instanceof Error ? error.message : "Stash connection test failed.",
        });
      }
    }),

  searchStashTags: publicProcedure
    .input(
      z.object({
        sourceId: z.string().trim().min(1),
        query: z.string().max(120).default(""),
        page: z.number().int().min(1).default(1),
        perPage: z.number().int().min(1).max(100).default(30),
      }),
    )
    .query(async ({ input }) => {
      try {
        return await searchSourceTags(input);
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: error instanceof Error ? error.message : "Failed to fetch tags.",
        });
      }
    }),

  syncNow: publicProcedure.mutation(async () => {
    return syncExternalSources("manual");
  }),

  getSyncStatus: publicProcedure.query(() => {
    return getExternalSyncStatus();
  }),

  resolveMediaUri: publicProcedure
    .input(z.object({ uri: z.string().min(1), purpose: z.enum(["video", "funscript"]) }))
    .query(({ input }) => {
      return { resolvedUri: resolveMediaUri(input.uri, input.purpose) };
    }),
});
