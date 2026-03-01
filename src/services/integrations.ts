import { trpc } from "./trpc";

export type ExternalSource = Awaited<ReturnType<typeof trpc.integration.listSources.query>>[number];
export type IntegrationSyncStatus = Awaited<ReturnType<typeof trpc.integration.getSyncStatus.query>>;
export type StashTagResult = Awaited<ReturnType<typeof trpc.integration.searchStashTags.query>>;

export const integrations = {
  listSources: () => trpc.integration.listSources.query(),
  createStashSource: (input: {
    name: string;
    enabled?: boolean;
    baseUrl: string;
    authMode: "apiKey" | "login";
    apiKey?: string | null;
    username?: string | null;
    password?: string | null;
    tagSelections?: Array<{ id: string; name: string; roundTypeFallback: "Normal" | "Interjection" | "Cum" }>;
  }) => trpc.integration.createStashSource.mutate(input),
  updateStashSource: (input: {
    sourceId: string;
    name?: string;
    enabled?: boolean;
    baseUrl?: string;
    authMode?: "apiKey" | "login";
    apiKey?: string | null;
    username?: string | null;
    password?: string | null;
    tagSelections?: Array<{ id: string; name: string; roundTypeFallback: "Normal" | "Interjection" | "Cum" }>;
  }) => trpc.integration.updateStashSource.mutate(input),
  deleteSource: (sourceId: string) => trpc.integration.deleteSource.mutate({ sourceId }),
  setSourceEnabled: (sourceId: string, enabled: boolean) =>
    trpc.integration.setSourceEnabled.mutate({ sourceId, enabled }),
  testStashConnection: (sourceId: string) => trpc.integration.testStashConnection.mutate({ sourceId }),
  searchStashTags: (input: { sourceId: string; query: string; page?: number; perPage?: number }) =>
    trpc.integration.searchStashTags.query({
      sourceId: input.sourceId,
      query: input.query,
      page: input.page,
      perPage: input.perPage,
    }),
  syncNow: () => trpc.integration.syncNow.mutate(),
  getSyncStatus: () => trpc.integration.getSyncStatus.query(),
};
