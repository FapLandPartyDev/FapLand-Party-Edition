import * as z from "zod";
import { router, publicProcedure } from "../trpc";
import {
  migratePathsToTarget,
  detectPortableInstallation,
  migrateToPortable,
} from "../../services/migration";
import {
  assertApprovedDialogPath,
  approveDialogPath,
} from "../../services/dialogPathApproval";

export const migrationRouter = router({
  migratePaths: publicProcedure
    .input(
      z.object({
        targetDirectory: z.string(),
        deleteOriginals: z.boolean(),
      })
    )
    .mutation(async ({ input }) => {
      const approvedPath = assertApprovedDialogPath(
        "migrationTargetDirectory",
        input.targetDirectory
      );
      return migratePathsToTarget(approvedPath, input.deleteOriginals);
    }),

  detectPortableInstallation: publicProcedure
    .input(
      z.object({
        directory: z.string(),
      })
    )
    .query(({ input }) => {
      approveDialogPath("portableInstallation", input.directory);
      return detectPortableInstallation(input.directory);
    }),

  migrateToPortable: publicProcedure
    .input(
      z.object({
        portableDirectory: z.string(),
      })
    )
    .mutation(async ({ input }) => {
      const approvedPath = assertApprovedDialogPath(
        "portableInstallation",
        input.portableDirectory,
        { consume: false }
      );
      return migrateToPortable(approvedPath);
    }),
});
