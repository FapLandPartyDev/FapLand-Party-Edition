import * as z from "zod";
import { publicProcedure, router } from "../trpc";
import {
  addTrustedSite,
  listTrustedSites,
  removeTrustedSite,
  setSecurityMode,
} from "../../services/security";
import { openExternalSafe } from "../../services/shell";

export const securityRouter = router({
  listTrustedSites: publicProcedure.query(() => listTrustedSites()),

  openExternal: publicProcedure
    .input(z.object({ url: z.string().trim().min(1) }))
    .mutation(({ input }) => ({
      opened: openExternalSafe(input.url),
    })),

  setSecurityMode: publicProcedure
    .input(z.object({ mode: z.enum(["prompt", "block", "paranoid"]) }))
    .mutation(({ input }) => ({
      securityMode: setSecurityMode(input.mode),
    })),

  addTrustedSite: publicProcedure
    .input(z.object({ baseDomain: z.string().trim().min(1) }))
    .mutation(({ input }) => ({
      userTrustedBaseDomains: addTrustedSite(input.baseDomain),
    })),

  removeTrustedSite: publicProcedure
    .input(z.object({ baseDomain: z.string().trim().min(1) }))
    .mutation(({ input }) => ({
      userTrustedBaseDomains: removeTrustedSite(input.baseDomain),
    })),
});
