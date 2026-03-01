import { createTRPCProxyClient } from "@trpc/client";
import { ipcLink } from "trpc-electron/renderer";
import superjson from "superjson";
import type { AppRouter } from "../../electron/trpc/router";

/**
 * The fully-typed tRPC client. Call procedures like:
 *   trpc.db.getHeroes.query()
 *   trpc.store.set.mutate({ key: 'foo', value: 'bar' })
 *   trpc.phash.generate.query({ path: '/video.mp4' })
 */
let trpcClient: ReturnType<typeof createTRPCProxyClient<AppRouter>> | null = null;

function getTrpcClient() {
  if (!trpcClient) {
    trpcClient = createTRPCProxyClient<AppRouter>({
      links: [ipcLink<AppRouter>({ transformer: superjson as never })],
    });
  }

  return trpcClient;
}

export const trpc = new Proxy({} as ReturnType<typeof createTRPCProxyClient<AppRouter>>, {
  get(_target, property, receiver) {
    return Reflect.get(getTrpcClient(), property, receiver);
  },
});
