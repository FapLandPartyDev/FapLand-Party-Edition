import { z } from "zod";
import { ZGraphBoardConfig, ZPlaylistConfig, ZPlaylistMusic } from "../game/playlistSchema";

// Reuse field validation, but allow unfinished graphs just as the interactive editor does.
const settings = ZPlaylistConfig.out.shape;
export const ZLiveMapConfig = z
  .object({
    ...ZGraphBoardConfig.shape,
    startNodeId: z.string(),
    nodes: ZGraphBoardConfig.shape.nodes.min(0),
    perkSelection: settings.perkSelection,
    perkPool: settings.perkPool,
    intermediarySelection: settings.intermediarySelection,
    probabilityScaling: settings.probabilityScaling,
    resetIntermediaryProbabilityAfterTrigger: z.boolean(),
    resetAntiPerkProbabilityAfterTrigger: z.boolean(),
    economy: settings.economy.pick({ startingMoney: true, scorePerCumRoundSuccess: true }),
    dice: settings.dice,
    disableDiceAnimation: settings.disableDiceAnimation,
    disableInterjectionsDuringCumRounds: settings.disableInterjectionsDuringCumRounds,
    allowPausingDuringFinalCumRound: settings.allowPausingDuringFinalCumRound,
    saveMode: settings.saveMode,
    requiredLevel: settings.requiredLevel,
    style: ZGraphBoardConfig.shape.style.unwrap(),
    music: ZPlaylistMusic,
  })
  .strict();

export const ZMapEditorRequest = z
  .object({
    operation: z.enum(["inspect", "patch", "undo", "redo", "saveDraft", "publish"]),
    expectedRevision: z.string().optional(),
    patches: z
      .array(
        z
          .object({
            op: z.enum(["set", "remove"]),
            path: z.array(z.union([z.string(), z.number().int().nonnegative()])).min(1),
            value: z.unknown().optional(),
          })
          .strict()
      )
      .min(1)
      .max(1000)
      .optional(),
  })
  .strict();
export type MapEditorRequest = z.infer<typeof ZMapEditorRequest>;
