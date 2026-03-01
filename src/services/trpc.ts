import { createTRPCProxyClient } from "@trpc/client";
import { createTRPCReact } from "@trpc/react-query";
import { ipcLink } from "electron-trpc/renderer";
import superjson from "superjson";
import type { AppRouter } from "../../electron/trpc/router";

/**
 * The fully-typed tRPC client. Call procedures like:
 *   trpc.db.getHeroes.query()
 *   trpc.store.set.mutate({ key: 'foo', value: 'bar' })
 *   trpc.phash.generate.query({ path: '/video.mp4' })
 */
export const trpc = createTRPCProxyClient<AppRouter>({
  links: [ipcLink()],
  transformer: superjson
});

export const trpcReact = createTRPCReact<AppRouter>();
