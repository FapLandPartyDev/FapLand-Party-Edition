import type {
  InstallFolderInspectionResult,
  InstalledRoundMediaResources,
  LegacyReviewedImportResult,
  LibraryPackageExportResult,
} from "@/services/db";
import type { RoundLibraryEntry } from "@/routes/roundRows";

export type GroupMode = "hero" | "playlist";
export type EditableRoundType = "Normal" | "Interjection" | "Cum";
export type EroScriptsDialogContext = "library" | "website-round" | "edit-round" | "edit-hero";
export type SectionId = "library" | "transfer";

export type RoundEditDraft = {
  id: string;
  name: string;
  author: string;
  description: string;
  tagsText: string;
  libraryLabel: string;
  bpm: string;
  difficulty: string;
  startTime: string;
  endTime: string;
  type: EditableRoundType;
  resourceId: string | null;
  funscriptUri: string | null;
  funscriptOffsetMs: string;
  invertFunscript: boolean;
  excludeFromRandom: boolean;
};

export type HeroEditDraft = {
  id: string;
  name: string;
  author: string;
  description: string;
  tagsText: string;
  funscriptUri: string | null;
  funscriptDirty: boolean;
  funscriptOffsetMs: string;
  funscriptOffsetDirty: boolean;
};

export type DeleteRoundDialogState = {
  id: string;
  name: string;
};

export type DeleteSelectedRoundsDialogState = {
  ids: string[];
  names: string[];
  filterContext: string[];
};

export type DeleteHeroDialogState = {
  id: string;
  name: string;
};

export type HeroGroupRoundConversionState = {
  groupKey: string;
  heroId: string | null;
  heroName: string;
  roundIds: string[];
  keepRoundId: string;
  keepRoundName: string;
  roundsToDeleteCount: number;
  confirmationText: string;
  error: string | null;
};

export type HeroHardModeConversionState = {
  groupKey: string;
  heroId: string;
  heroName: string;
  recalculateDifficulty: boolean;
};

export type RoundHardModeConversionState = {
  roundId: string;
  roundName: string;
  heroName: string | null;
  recalculateDifficulty: boolean;
};

export type WebsiteRoundVideoValidationState =
  | { state: "idle"; message: null }
  | { state: "checking"; message: string }
  | { state: "supported"; message: string }
  | { state: "unsupported"; message: string };

export type RoundTemplateRepairState = {
  roundId: string;
  roundName: string;
  installedRoundId: string;
};

export type HeroTemplateRepairAssignment = {
  roundId: string;
  roundName: string;
  installedRoundId: string;
};

export type HeroTemplateRepairState = {
  heroId: string;
  heroName: string;
  sourceHeroId: string;
  assignments: HeroTemplateRepairAssignment[];
};

export type LegacyImportedSlot = NonNullable<
  LegacyReviewedImportResult["legacyImport"]
>["orderedSlots"][number];
export type LegacyInspectionSlot = Extract<
  InstallFolderInspectionResult,
  { kind: "legacy" }
>["legacySlots"][number];
export type LegacyImportReviewSlot = LegacyInspectionSlot & {
  selectedAsCheckpoint: boolean;
  excludedFromImport: boolean;
};

export type LegacyPlaylistReviewState = {
  folderPath: string;
  slots: LegacyImportReviewSlot[];
  playlistName: string;
  createPlaylist: boolean;
  deferPhash: boolean;
  creating: boolean;
  error: string | null;
};

export type LibraryExportDialogState = {
  exportMode: "all" | "selected";
  includeMedia: boolean;
  asFpack: boolean;
  compressionMode: "copy" | "av1" | null;
  compressionStrength: number;
  audioBitrateKbps: 128 | 192 | 256;
  result: LibraryPackageExportResult | null;
  error: string | null;
};

export type BulkTagsDialogState = {
  mode: "add" | "remove" | "replace";
  tagsText: string;
};

export type PreviewSettings = {
  intermediaryLoadingPrompt: string;
  intermediaryLoadingDurationSec: number;
  intermediaryReturnPauseSec: number;
  roundProgressBarAlwaysVisible: boolean;
};

export type RoundMediaResources = InstalledRoundMediaResources;

export type { RoundLibraryEntry };
