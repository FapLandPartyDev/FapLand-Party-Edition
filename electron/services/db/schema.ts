import { sqliteTable, text, integer, real, index, uniqueIndex } from "drizzle-orm/sqlite-core";
import { relations } from "drizzle-orm";
import { createId } from "@paralleldrive/cuid2";

export const resource = sqliteTable(
  "Resource",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),
    videoUri: text("videoUri").notNull(),
    funscriptUri: text("funscriptUri"),
    funscriptOffsetMs: integer("funscriptOffsetMs"),
    invertFunscript: integer("invertFunscript", { mode: "boolean" }).notNull().default(false),
    phash: text("phash"),
    durationMs: integer("durationMs"),
    disabled: integer("disabled", { mode: "boolean" }).notNull().default(false),
    roundId: text("roundId")
      .notNull()
      .references(() => round.id, { onDelete: "cascade" }),
    createdAt: integer("createdAt", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updatedAt", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => ({
    phashIdx: index("Resource_phash_idx").on(table.phash),
    roundIdIdx: index("Resource_roundId_idx").on(table.roundId),
  })
);

export const acquisitionSource = sqliteTable(
  "AcquisitionSource",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),
    kind: text("kind", { enum: ["torrent", "mega"] }).notNull(),
    name: text("name").notNull(),
    canonicalLocatorHash: text("canonicalLocatorHash").notNull(),
    locatorJson: text("locatorJson").notNull(),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    origin: text("origin", { enum: ["user", "imported"] })
      .notNull()
      .default("user"),
    lastCatalogedAt: integer("lastCatalogedAt", { mode: "timestamp" }),
    catalogError: text("catalogError"),
    createdAt: integer("createdAt", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updatedAt", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => ({
    locatorHashUnique: uniqueIndex("AcquisitionSource_locatorHash_unique").on(
      table.canonicalLocatorHash
    ),
  })
);

export const acquisitionFile = sqliteTable(
  "AcquisitionFile",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),
    sourceId: text("sourceId")
      .notNull()
      .references(() => acquisitionSource.id, { onDelete: "cascade" }),
    sourcePath: text("sourcePath").notNull(),
    displayName: text("displayName").notNull(),
    sizeBytes: integer("sizeBytes"),
    mediaKind: text("mediaKind", { enum: ["video", "other"] })
      .notNull()
      .default("other"),
    createdAt: integer("createdAt", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updatedAt", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => ({
    sourcePathUnique: uniqueIndex("AcquisitionFile_sourceId_sourcePath_unique").on(
      table.sourceId,
      table.sourcePath
    ),
    sourceIdIdx: index("AcquisitionFile_sourceId_idx").on(table.sourceId),
  })
);

export const roundAcquisitionCandidate = sqliteTable(
  "RoundAcquisitionCandidate",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),
    roundId: text("roundId")
      .notNull()
      .references(() => round.id, { onDelete: "cascade" }),
    sourceId: text("sourceId")
      .notNull()
      .references(() => acquisitionSource.id, { onDelete: "restrict" }),
    sourcePath: text("sourcePath").notNull(),
    matchKind: text("matchKind", { enum: ["explicit", "filename"] }).notNull(),
    matchScore: real("matchScore"),
    sortOrder: integer("sortOrder").notNull().default(0),
  },
  (table) => ({
    roundSourcePathUnique: uniqueIndex("RoundAcquisitionCandidate_round_source_path_unique").on(
      table.roundId,
      table.sourceId,
      table.sourcePath
    ),
    roundIdIdx: index("RoundAcquisitionCandidate_roundId_idx").on(table.roundId),
  })
);

export const acquisitionJob = sqliteTable(
  "AcquisitionJob",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),
    sourceId: text("sourceId")
      .notNull()
      .references(() => acquisitionSource.id, { onDelete: "restrict" }),
    kind: text("kind", { enum: ["torrent", "mega"] }).notNull(),
    state: text("state", {
      enum: [
        "queued",
        "fetching_metadata",
        "downloading",
        "paused",
        "seeding",
        "completed",
        "failed",
        "cancelled",
      ],
    })
      .notNull()
      .default("queued"),
    selectedPathsJson: text("selectedPathsJson").notNull().default("[]"),
    addCompletedToLibrary: integer("addCompletedToLibrary", { mode: "boolean" })
      .notNull()
      .default(true),
    downloadedBytes: integer("downloadedBytes").notNull().default(0),
    totalBytes: integer("totalBytes").notNull().default(0),
    uploadedBytes: integer("uploadedBytes").notNull().default(0),
    downloadSpeed: integer("downloadSpeed").notNull().default(0),
    uploadSpeed: integer("uploadSpeed").notNull().default(0),
    peerCount: integer("peerCount").notNull().default(0),
    ratio: real("ratio").notNull().default(0),
    activeSeedTimeMs: integer("activeSeedTimeMs").notNull().default(0),
    errorMessage: text("errorMessage"),
    createdAt: integer("createdAt", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    startedAt: integer("startedAt", { mode: "timestamp" }),
    completedAt: integer("completedAt", { mode: "timestamp" }),
    updatedAt: integer("updatedAt", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => ({ sourceIdIdx: index("AcquisitionJob_sourceId_idx").on(table.sourceId) })
);

export const hero = sqliteTable("Hero", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => createId()),
  name: text("name").notNull().unique(),
  author: text("author"),
  description: text("description"),
  tagsJson: text("tagsJson").notNull().default("[]"),
  phash: text("phash"),
  createdAt: integer("createdAt", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updatedAt", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const round = sqliteTable(
  "Round",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),
    name: text("name").notNull(),
    author: text("author"),
    description: text("description"),
    tagsJson: text("tagsJson").notNull().default("[]"),
    bpm: real("bpm"),
    difficulty: integer("difficulty"),
    phash: text("phash"),
    startTime: integer("startTime"),
    endTime: integer("endTime"),
    cutRangesJson: text("cutRangesJson"),
    type: text("type", { enum: ["Normal", "Interjection", "Cum"] })
      .notNull()
      .default("Normal"),
    installSourceKey: text("installSourceKey").unique(),
    libraryLabel: text("libraryLabel"),
    previewImage: text("previewImage"),
    heroId: text("heroId").references(() => hero.id, { onDelete: "set null" }),
    excludeFromRandom: integer("excludeFromRandom", { mode: "boolean" }).notNull().default(false),
    excludeFromNumbering: integer("excludeFromNumbering", { mode: "boolean" })
      .notNull()
      .default(false),
    createdAt: integer("createdAt", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updatedAt", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => ({
    createdAtIdx: index("Round_createdAt_idx").on(table.createdAt),
    heroIdIdx: index("Round_heroId_idx").on(table.heroId),
  })
);

export const playlist = sqliteTable("Playlist", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => createId()),
  name: text("name").notNull(),
  description: text("description"),
  formatVersion: integer("formatVersion").notNull().default(1),
  configJson: text("configJson").notNull(),
  installSourceKey: text("installSourceKey").unique(),
  createdAt: integer("createdAt", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updatedAt", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const mapEditorDraft = sqliteTable("MapEditorDraft", {
  playlistId: text("playlistId")
    .primaryKey()
    .references(() => playlist.id, { onDelete: "cascade", onUpdate: "cascade" }),
  snapshotJson: text("snapshotJson").notNull(),
  updatedAt: integer("updatedAt", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const playlistTrackPlay = sqliteTable(
  "PlaylistTrackPlay",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),
    playlistId: text("playlistId")
      .notNull()
      .references(() => playlist.id, { onDelete: "cascade", onUpdate: "cascade" }),
    roundId: text("roundId").notNull(),
    nodeId: text("nodeId"),
    poolId: text("poolId"),
    playedAt: integer("playedAt", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => ({
    playlistPlayedAtIdx: index("PlaylistTrackPlay_playlistId_playedAt_idx").on(
      table.playlistId,
      table.playedAt
    ),
    playlistPoolRoundIdx: index("PlaylistTrackPlay_playlistId_poolId_roundId_idx").on(
      table.playlistId,
      table.poolId,
      table.roundId
    ),
  })
);

export const gameProfile = sqliteTable("GameProfile", {
  id: text("id").primaryKey(),
  highscore: integer("highscore").notNull().default(0),
  highscoreCheatMode: integer("highscoreCheatMode", { mode: "boolean" }).notNull().default(false),
  highscoreAssisted: integer("highscoreAssisted", { mode: "boolean" }).notNull().default(false),
  highscoreAssistedSaveMode: text("highscoreAssistedSaveMode", {
    enum: ["checkpoint", "everywhere"],
  }),
  progressionXp: integer("progressionXp").notNull().default(0),
  equippedTitleId: text("equippedTitleId").notNull().default("fresh-face"),
  respecTokens: integer("respecTokens").notNull().default(0),
  createdAt: integer("createdAt", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updatedAt", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const progressionSkillRank = sqliteTable(
  "ProgressionSkillRank",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),
    profileId: text("profileId")
      .notNull()
      .references(() => gameProfile.id, { onDelete: "cascade", onUpdate: "cascade" }),
    skillId: text("skillId").notNull(),
    rank: integer("rank").notNull().default(1),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    createdAt: integer("createdAt", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updatedAt", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => ({
    profileSkillUnique: uniqueIndex("ProgressionSkillRank_profileId_skillId_unique").on(
      table.profileId,
      table.skillId
    ),
  })
);

export const progressionAward = sqliteTable(
  "ProgressionAward",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),
    profileId: text("profileId")
      .notNull()
      .references(() => gameProfile.id, { onDelete: "cascade", onUpdate: "cascade" }),
    sourceKind: text("sourceKind", { enum: ["single_player", "multiplayer"] }).notNull(),
    sourceId: text("sourceId").notNull(),
    outcome: text("outcome", { enum: ["success", "failure"] }).notNull(),
    completedRounds: integer("completedRounds").notNull().default(0),
    xpAwarded: integer("xpAwarded").notNull().default(0),
    blockReason: text("blockReason"),
    createdAt: integer("createdAt", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => ({
    sourceUnique: uniqueIndex("ProgressionAward_sourceKind_sourceId_unique").on(
      table.sourceKind,
      table.sourceId
    ),
    profileCreatedAtIdx: index("ProgressionAward_profileId_createdAt_idx").on(
      table.profileId,
      table.createdAt
    ),
  })
);

export const multiplayerMatchCache = sqliteTable("MultiplayerMatchCache", {
  lobbyId: text("lobbyId").primaryKey(),
  finishedAt: integer("finishedAt", { mode: "timestamp" }).notNull(),
  isFinal: integer("isFinal", { mode: "boolean" }).notNull().default(false),
  resultsJson: text("resultsJson", { mode: "json" }).notNull(),
  createdAt: integer("createdAt", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updatedAt", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const resultSyncQueue = sqliteTable("ResultSyncQueue", {
  lobbyId: text("lobbyId").primaryKey(),
  createdAt: integer("createdAt", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
  lastAttemptAt: integer("lastAttemptAt", { mode: "timestamp" }),
});

export const singlePlayerRunHistory = sqliteTable(
  "SinglePlayerRunHistory",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),
    finishedAt: integer("finishedAt", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    score: integer("score").notNull(),
    survivedDurationSec: integer("survivedDurationSec"),
    highscoreBefore: integer("highscoreBefore").notNull(),
    highscoreAfter: integer("highscoreAfter").notNull(),
    wasNewHighscore: integer("wasNewHighscore", { mode: "boolean" }).notNull().default(false),
    completionReason: text("completionReason").notNull(),
    playlistId: text("playlistId"),
    playlistName: text("playlistName").notNull(),
    playlistFormatVersion: integer("playlistFormatVersion"),
    endingPosition: integer("endingPosition").notNull(),
    turn: integer("turn").notNull(),
    cheatModeActive: integer("cheatModeActive", { mode: "boolean" }).notNull().default(false),
    assistedActive: integer("assistedActive", { mode: "boolean" }).notNull().default(false),
    assistedSaveMode: text("assistedSaveMode", { enum: ["checkpoint", "everywhere"] }),
    createdAt: integer("createdAt", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => ({
    historyFinishedAtIdx: index("SinglePlayerRunHistory_finishedAt_idx").on(table.finishedAt),
  })
);

export const gameplaySession = sqliteTable(
  "GameplaySession",
  {
    id: text("id").primaryKey(),
    mode: text("mode", { enum: ["single_player", "multiplayer"] }).notNull(),
    sourceId: text("sourceId").notNull().unique(),
    playlistId: text("playlistId"),
    playlistName: text("playlistName").notNull(),
    startedAt: integer("startedAt", { mode: "timestamp" }).notNull(),
    lastActiveAt: integer("lastActiveAt", { mode: "timestamp" }).notNull(),
    endedAt: integer("endedAt", { mode: "timestamp" }),
    activePlayMs: integer("activePlayMs").notNull().default(0),
    status: text("status", { enum: ["in_progress", "completed", "abandoned"] })
      .notNull()
      .default("in_progress"),
    completionReason: text("completionReason"),
    score: integer("score"),
    completedRounds: integer("completedRounds").notNull().default(0),
    cheatModeActive: integer("cheatModeActive", { mode: "boolean" }).notNull().default(false),
    assistedActive: integer("assistedActive", { mode: "boolean" }).notNull().default(false),
    assistedSaveMode: text("assistedSaveMode", { enum: ["checkpoint", "everywhere"] }),
    singlePlayerRunId: text("singlePlayerRunId"),
    isLegacy: integer("isLegacy", { mode: "boolean" }).notNull().default(false),
    createdAt: integer("createdAt", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updatedAt", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => ({
    sessionModeStartedIdx: index("GameplaySession_mode_startedAt_idx").on(
      table.mode,
      table.startedAt
    ),
    sessionRunIdx: index("GameplaySession_singlePlayerRunId_idx").on(table.singlePlayerRunId),
  })
);

export const gameplayRoundPlay = sqliteTable(
  "GameplayRoundPlay",
  {
    id: text("id").primaryKey(),
    sessionId: text("sessionId").references(() => gameplaySession.id, { onDelete: "cascade" }),
    mode: text("mode", { enum: ["single_player", "multiplayer"] }).notNull(),
    playlistId: text("playlistId"),
    playlistName: text("playlistName").notNull(),
    roundId: text("roundId").notNull(),
    roundName: text("roundName").notNull(),
    roundType: text("roundType", { enum: ["Normal", "Interjection", "Cum"] }).notNull(),
    phaseKind: text("phaseKind", { enum: ["normal", "cum", "cumPoint", "interjection"] }).notNull(),
    nodeId: text("nodeId"),
    poolId: text("poolId"),
    startedAt: integer("startedAt", { mode: "timestamp" }).notNull(),
    finishedAt: integer("finishedAt", { mode: "timestamp" }),
    scheduledDurationMs: integer("scheduledDurationMs"),
    watchedDurationMs: integer("watchedDurationMs").notNull().default(0),
    status: text("status", { enum: ["playing", "completed", "skipped", "abandoned"] })
      .notNull()
      .default("playing"),
    cumOutcome: text("cumOutcome", {
      enum: ["manual_loss", "failed_instruction", "came_as_told", "did_not_cum"],
    }),
    legacySourceId: text("legacySourceId").unique(),
    isLegacy: integer("isLegacy", { mode: "boolean" }).notNull().default(false),
    createdAt: integer("createdAt", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updatedAt", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => ({
    roundPlaySessionIdx: index("GameplayRoundPlay_sessionId_idx").on(table.sessionId),
    roundPlayRoundIdx: index("GameplayRoundPlay_roundId_idx").on(table.roundId),
    roundPlayModeStartedIdx: index("GameplayRoundPlay_mode_startedAt_idx").on(
      table.mode,
      table.startedAt
    ),
    roundPlayCumOutcomeIdx: index("GameplayRoundPlay_cumOutcome_idx").on(table.cumOutcome),
  })
);

export const singlePlayerRunSave = sqliteTable("SinglePlayerRunSave", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => createId()),
  playlistId: text("playlistId")
    .notNull()
    .references(() => playlist.id, { onDelete: "cascade", onUpdate: "cascade" })
    .unique(),
  playlistName: text("playlistName").notNull(),
  playlistFormatVersion: integer("playlistFormatVersion"),
  saveMode: text("saveMode", { enum: ["checkpoint", "everywhere"] }).notNull(),
  snapshotJson: text("snapshotJson", { mode: "json" }).notNull(),
  savedAt: integer("savedAt", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
  createdAt: integer("createdAt", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updatedAt", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const heroRelations = relations(hero, ({ many }) => ({
  rounds: many(round),
}));

export const roundRelations = relations(round, ({ one, many }) => ({
  hero: one(hero, {
    fields: [round.heroId],
    references: [hero.id],
  }),
  resources: many(resource),
  acquisitionCandidates: many(roundAcquisitionCandidate),
}));

export const resourceRelations = relations(resource, ({ one }) => ({
  round: one(round, {
    fields: [resource.roundId],
    references: [round.id],
  }),
}));

export const acquisitionSourceRelations = relations(acquisitionSource, ({ many }) => ({
  files: many(acquisitionFile),
  candidates: many(roundAcquisitionCandidate),
  jobs: many(acquisitionJob),
}));

export const acquisitionFileRelations = relations(acquisitionFile, ({ one }) => ({
  source: one(acquisitionSource, {
    fields: [acquisitionFile.sourceId],
    references: [acquisitionSource.id],
  }),
}));

export const roundAcquisitionCandidateRelations = relations(
  roundAcquisitionCandidate,
  ({ one }) => ({
    round: one(round, { fields: [roundAcquisitionCandidate.roundId], references: [round.id] }),
    source: one(acquisitionSource, {
      fields: [roundAcquisitionCandidate.sourceId],
      references: [acquisitionSource.id],
    }),
  })
);

export const acquisitionJobRelations = relations(acquisitionJob, ({ one }) => ({
  source: one(acquisitionSource, {
    fields: [acquisitionJob.sourceId],
    references: [acquisitionSource.id],
  }),
}));

export const playlistRelations = relations(playlist, ({ many, one }) => ({
  tracks: many(playlistTrackPlay),
  editorDraft: one(mapEditorDraft),
}));

export const mapEditorDraftRelations = relations(mapEditorDraft, ({ one }) => ({
  playlist: one(playlist, {
    fields: [mapEditorDraft.playlistId],
    references: [playlist.id],
  }),
}));

export const playlistTrackPlayRelations = relations(playlistTrackPlay, ({ one }) => ({
  playlist: one(playlist, {
    fields: [playlistTrackPlay.playlistId],
    references: [playlist.id],
  }),
}));
