import { trpc } from "./trpc";

export type ResolvePlayableVideoUriResult = Awaited<
  ReturnType<typeof trpc.media.resolvePlayableVideoUri.query>
>;

export async function resolvePlayableVideoUri(videoUri: string): Promise<ResolvePlayableVideoUriResult> {
  return trpc.media.resolvePlayableVideoUri.query({ videoUri });
}
