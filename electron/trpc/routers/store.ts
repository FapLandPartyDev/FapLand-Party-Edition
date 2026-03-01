import * as z from "zod";
import { router, publicProcedure } from "../trpc";
import { safeStoreGet, safeStoreGetMany, safeStoreSet } from "../../services/store";
import { getPortableStorageDefault } from "../../services/storagePaths";
import { persistGraphicsCompatibilityStartupSetting } from "../../services/graphicsCompatibility";

export const storeRouter = router({
  get: publicProcedure.input(z.object({ key: z.string() })).query(({ input }) => {
    return safeStoreGet(input.key);
  }),

  getMany: publicProcedure.input(z.object({ keys: z.array(z.string()) })).query(({ input }) => {
    return safeStoreGetMany(input.keys);
  }),

  set: publicProcedure
    .input(z.object({ key: z.string(), value: z.unknown() }))
    .mutation(({ input }) => {
      const resolvedValue = (() => {
        if (input.value === null || input.value === undefined || input.value === "") {
          const portableDefault = getPortableStorageDefault(input.key);
          if (portableDefault) return portableDefault;
        }
        return input.value;
      })();
      if (!safeStoreSet(input.key, resolvedValue)) {
        throw new Error(`Failed to write setting "${input.key}".`);
      }
      persistGraphicsCompatibilityStartupSetting(input.key, resolvedValue);
    }),
});
