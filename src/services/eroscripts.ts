import { trpc } from "./trpc";

export type EroScriptsSearchResult = Awaited<
  ReturnType<typeof trpc.eroscripts.search.query>
>[number];
export type EroScriptsTopicMedia = Awaited<ReturnType<typeof trpc.eroscripts.listTopicMedia.query>>;
export type EroScriptsFunscriptCandidate = EroScriptsTopicMedia["funscripts"][number];
export type EroScriptsVideoCandidate = EroScriptsTopicMedia["videos"][number];
export type EroScriptsFunscriptDownloadResult = Awaited<
  ReturnType<typeof trpc.eroscripts.downloadFunscript.mutate>
>;
export type EroScriptsLoginStatus = Awaited<
  ReturnType<typeof trpc.eroscripts.getLoginStatus.query>
>;
export type EroScriptsSearchInput = {
  query?: string;
  tags?: string[];
  limit?: number;
};

export const eroscripts = {
  getLoginStatus: () => trpc.eroscripts.getLoginStatus.query(),
  openLoginWindow: () => trpc.eroscripts.openLoginWindow.mutate(),
  clearLoginCookies: () => trpc.eroscripts.clearLoginCookies.mutate(),
  search: (input: EroScriptsSearchInput) => trpc.eroscripts.search.query(input),
  listTopicMedia: (topicId: number) => trpc.eroscripts.listTopicMedia.query({ topicId }),
  downloadFunscript: (candidate: EroScriptsFunscriptCandidate) =>
    trpc.eroscripts.downloadFunscript.mutate({
      topicId: candidate.topicId,
      postId: candidate.postId,
      url: candidate.url,
      filename: candidate.filename,
    }),
  downloadVideo: (candidate: EroScriptsVideoCandidate) =>
    trpc.eroscripts.downloadVideo.mutate({
      topicId: candidate.topicId,
      postId: candidate.postId,
      url: candidate.url,
    }),
};
