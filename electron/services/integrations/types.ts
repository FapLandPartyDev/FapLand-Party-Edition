export type RoundType = "Normal" | "Interjection" | "Cum";

export const INTEGRATIONS_SOURCES_KEY = "integrations.sources";
export const INTEGRATIONS_SYNC_STATUS_KEY = "integrations.sync.status";
export const INTEGRATIONS_DISABLED_ROUND_IDS_KEY = "integrations.disabledRoundIds";

export type ExternalSourceKind = "stash";
export type StashAuthMode = "none" | "apiKey" | "login";
export type MediaPurpose = "video" | "funscript" | "image";

export type StashTagSelection = {
  id: string;
  name: string;
  roundTypeFallback: RoundType;
};

export type ExternalSource = {
  id: string;
  kind: "stash";
  name: string;
  enabled: boolean;
  baseUrl: string;
  authMode: StashAuthMode;
  apiKey: string | null;
  username: string | null;
  password: string | null;
  tagSelections: StashTagSelection[];
  createdAt: string;
  updatedAt: string;
};

export type IntegrationSyncStats = {
  sourcesSeen: number;
  sourcesSynced: number;
  scenesSeen: number;
  roundsCreated: number;
  roundsUpdated: number;
  roundsLinked: number;
  resourcesAdded: number;
  disabledRounds: number;
  failed: number;
};

export type IntegrationSyncError = {
  sourceId: string;
  message: string;
};

export type IntegrationSyncStatus = {
  state: "idle" | "running" | "done" | "error";
  triggeredBy: "startup" | "manual";
  startedAt: string | null;
  finishedAt: string | null;
  stats: IntegrationSyncStats;
  lastMessage: string | null;
  lastErrors: IntegrationSyncError[];
};

export type NormalizedSceneImportItem = {
  sceneId: string;
  installSourceKey: string;
  roundTypeFallback: RoundType;
  name: string;
  author: string | null;
  description: string | null;
  phash: string | null;
  previewImageUri: string | null;
  videoUri: string;
  funscriptUri: string | null;
  durationMs: number | null;
};

export type SceneIngestResult = {
  created: number;
  updated: number;
  linked: number;
  resourcesAdded: number;
  managedRoundId: string | null;
};

export type ExternalSyncContext = {
  ingestScene: (item: NormalizedSceneImportItem) => Promise<SceneIngestResult>;
  onSceneSeen: () => void;
};

export interface ExternalProvider {
  kind: ExternalSourceKind;
  canHandleUri: (uri: string, source: ExternalSource) => boolean;
  resolvePlayableUri: (uri: string, source: ExternalSource, purpose: MediaPurpose) => string;
  syncSource: (source: ExternalSource, context: ExternalSyncContext) => Promise<void>;
}
