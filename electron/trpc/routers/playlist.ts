import { TRPCError } from "@trpc/server";
import * as z from "zod";
import {
  analyzePlaylistImportFile,
  createPlaylist,
  deletePlaylist,
  duplicatePlaylist,
  ensureEndlessPlaylist,
  exportPlaylistToFile,
  getActivePlaylist,
  getDistinctPlayedByPool,
  getPlaylistById,
  getPlaylistPlayHistory,
  importPlaylistFromFile,
  listPlaylists,
  recordPlaylistTrackPlay,
  setActivePlaylist,
  updatePlaylist,
} from "../../services/playlists";
import { exportPlaylistPackage as exportPlaylistPackageBundle } from "../../services/playlistExportPackage";
import {
  analyzePlaylistExportPackage,
  getPlaylistExportPackageStatus,
  requestPlaylistExportPackageAbort,
} from "../../services/playlistExportPackage";
import { publicProcedure, router } from "../trpc";

export const playlistRouter = router({
  list: publicProcedure.query(() => {
    return listPlaylists();
  }),

  getById: publicProcedure
    .input(z.object({ playlistId: z.string().min(1) }))
    .query(async ({ input }) => {
      const playlist = await getPlaylistById(input.playlistId);
      if (!playlist) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Playlist not found." });
      }
      return playlist;
    }),

  create: publicProcedure
    .input(
      z.object({
        name: z.string().trim().min(1),
        description: z.string().optional().nullable(),
        config: z.unknown().optional(),
      })
    )
    .mutation(({ input }) => {
      return createPlaylist(input);
    }),

  update: publicProcedure
    .input(
      z.object({
        playlistId: z.string().min(1),
        name: z.string().optional(),
        description: z.string().optional().nullable(),
        config: z.unknown().optional(),
      })
    )
    .mutation(({ input }) => {
      return updatePlaylist(input);
    }),

  delete: publicProcedure
    .input(z.object({ playlistId: z.string().min(1) }))
    .mutation(({ input }) => {
      return deletePlaylist(input.playlistId);
    }),

  duplicate: publicProcedure
    .input(z.object({ playlistId: z.string().min(1) }))
    .mutation(({ input }) => {
      return duplicatePlaylist(input.playlistId);
    }),

  getActive: publicProcedure.query(() => {
    return getActivePlaylist();
  }),

  setActive: publicProcedure
    .input(z.object({ playlistId: z.string().min(1) }))
    .mutation(({ input }) => {
      return setActivePlaylist(input.playlistId);
    }),

  ensureEndless: publicProcedure.mutation(() => {
    return ensureEndlessPlaylist();
  }),

  importFromFile: publicProcedure
    .input(
      z.object({
        filePath: z.string().min(1),
        manualMappingByRefKey: z.record(z.string(), z.string().min(1).nullable()).optional(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        return await importPlaylistFromFile(input);
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: error instanceof Error ? error.message : "Failed to import playlist file.",
        });
      }
    }),

  analyzeImportFile: publicProcedure
    .input(z.object({ filePath: z.string().min(1) }))
    .mutation(async ({ input }) => {
      try {
        return await analyzePlaylistImportFile(input.filePath);
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: error instanceof Error ? error.message : "Failed to analyze playlist file.",
        });
      }
    }),

  exportToFile: publicProcedure
    .input(z.object({ playlistId: z.string().min(1), filePath: z.string().min(1) }))
    .mutation(async ({ input }) => {
      try {
        await exportPlaylistToFile(input);
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: error instanceof Error ? error.message : "Failed to export playlist file.",
        });
      }
    }),

  exportPackage: publicProcedure
    .input(
      z.object({
        playlistId: z.string().min(1),
        directoryPath: z.string().min(1),
        compressionMode: z.enum(["copy", "av1"]).optional(),
        compressionStrength: z.number().finite().min(0).max(100).optional(),
        asFpack: z.boolean().optional(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        return await exportPlaylistPackageBundle(input);
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: error instanceof Error ? error.message : "Failed to export playlist package.",
        });
      }
    }),

  analyzeExportPackage: publicProcedure
    .input(
      z.object({
        playlistId: z.string().min(1),
        compressionMode: z.enum(["copy", "av1"]).optional(),
        compressionStrength: z.number().finite().min(0).max(100).optional(),
      })
    )
    .query(async ({ input }) => {
      try {
        return await analyzePlaylistExportPackage(input);
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            error instanceof Error ? error.message : "Failed to analyze playlist export package.",
        });
      }
    }),

  getExportPackageStatus: publicProcedure.query(() => {
    return getPlaylistExportPackageStatus();
  }),

  abortExportPackage: publicProcedure.mutation(() => {
    return requestPlaylistExportPackageAbort();
  }),

  recordRoundPlay: publicProcedure
    .input(
      z.object({
        playlistId: z.string().min(1),
        roundId: z.string().min(1),
        nodeId: z.string().optional().nullable(),
        poolId: z.string().optional().nullable(),
      })
    )
    .mutation(({ input }) => {
      return recordPlaylistTrackPlay(input);
    }),

  getDistinctPlayedByPool: publicProcedure
    .input(z.object({ playlistId: z.string().min(1) }))
    .query(({ input }) => {
      return getDistinctPlayedByPool(input.playlistId);
    }),

  getPlayHistory: publicProcedure
    .input(z.object({ playlistId: z.string().min(1) }))
    .query(({ input }) => {
      return getPlaylistPlayHistory(input.playlistId);
    }),
});
