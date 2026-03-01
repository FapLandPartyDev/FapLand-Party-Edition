import { z } from "zod";
import type { AppRouter } from "../trpc/router";
import { ZGraphBoardConfig, ZPlaylistConfig } from "../../src/game/playlistSchema";
import type { ControlTool } from "./protocol";

const ZRoundEdit = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1).optional(),
  author: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  tags: z.array(z.string()).optional(),
  bpm: z.number().min(1).max(400).nullable().optional(),
  difficulty: z.number().int().min(1).max(5).nullable().optional(),
  startTime: z.number().int().nonnegative().nullable().optional(),
  endTime: z.number().int().nonnegative().nullable().optional(),
  type: z.enum(["Normal", "Interjection", "Cum"]).optional(),
  excludeFromRandom: z.boolean().optional(),
  libraryLabel: z.string().nullable().optional(),
  funscriptUri: z.string().min(1).nullable().optional(),
  funscriptOffsetMs: z.number().int().nullable().optional(),
  invertFunscript: z.boolean().optional(),
});
const ZReorder = z.object({
  playlistId: z.string().min(1),
  pool: z.enum(["normalRoundOrder", "cumRoundRefs"]).default("normalRoundOrder"),
  order: z.array(z.number().int().nonnegative()),
});
const ZMapCreate = z.object({
  name: z.string().trim().min(1),
  description: z.string().nullable().optional(),
  board: ZGraphBoardConfig,
});

export function createLibraryTools(
  caller: ReturnType<AppRouter["createCaller"]>,
  changed: (procedure: string) => void
): ControlTool[] {
  return [
    {
      name: "fland_round_edit",
      description:
        "Rename or edit a round without clearing omitted fields. Supports trimming with startTime/endTime in milliseconds, tags, metadata and script settings. Prefer this for partial edits.",
      schema: ZRoundEdit,
      run: async (input: z.infer<typeof ZRoundEdit>) => {
        const existing = await caller.db.getInstalledRoundPlaybackEntry({
          roundId: input.id,
          includeDisabled: true,
        });
        if (!existing) throw new Error("Round not found.");
        const result = await caller.db.updateRound({
          name: existing.name,
          author: existing.author,
          description: existing.description,
          tags: existing.tags,
          bpm: existing.bpm,
          difficulty: existing.difficulty,
          startTime: existing.startTime,
          endTime: existing.endTime,
          type: existing.type,
          excludeFromRandom: existing.excludeFromRandom,
          libraryLabel: existing.libraryLabel,
          ...input,
        });
        changed("db.updateRound");
        return result;
      },
    },
    {
      name: "fland_playlist_reorder",
      description:
        "Reorder a linear playlist's normalRoundOrder or cumRoundRefs without altering other configuration. Supply a complete permutation of zero-based positions (e.g. [2,0,1]). Pinned normalRoundRefsByIndex remain pinned. For graph maps edit nodes/edges with playlist.update.",
      schema: ZReorder,
      run: async (input: z.infer<typeof ZReorder>) => {
        const playlist = await caller.playlist.getById({ playlistId: input.playlistId });
        const board = playlist.config.boardConfig;
        if (board.mode !== "linear")
          throw new Error("Reordering by position requires a linear playlist.");
        const entries = board[input.pool];
        if (
          input.order.length !== entries.length ||
          new Set(input.order).size !== entries.length ||
          input.order.some((position) => position >= entries.length)
        )
          throw new Error("Order must contain each existing zero-based position exactly once.");
        const result = await caller.playlist.update({
          playlistId: playlist.id,
          config: {
            ...playlist.config,
            boardConfig: {
              ...board,
              [input.pool]: input.order.map((position) => entries[position]),
            },
          },
        });
        changed("playlist.update");
        return result;
      },
    },
    {
      name: "fland_map_create",
      description:
        "Create a playable advanced graph map with validated nodes, branches, edges, round pools, backgrounds and automations. Game rules start at defaults; use playlist.update to customize them afterward.",
      schema: ZMapCreate,
      run: async (input: z.infer<typeof ZMapCreate>) => {
        const config = ZPlaylistConfig.parse({
          boardConfig: input.board,
          perkSelection: {},
          perkPool: {},
          probabilityScaling: {},
          economy: {},
        });
        const result = await caller.playlist.create({
          name: input.name,
          description: input.description,
          config,
        });
        changed("playlist.create");
        return result;
      },
    },
  ];
}
