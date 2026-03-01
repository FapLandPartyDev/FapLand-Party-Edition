import { sqliteTable, text, integer, real, index } from "drizzle-orm/sqlite-core";
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

export const hero = sqliteTable("Hero", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => createId()),
  name: text("name").notNull().unique(),
  author: text("author"),
  description: text("description"),
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
    previewImage: text("previewImage"),
    heroId: text("heroId").references(() => hero.id, { onDelete: "set null" }),
    excludeFromRandom: integer("excludeFromRandom", { mode: "boolean" }).notNull().default(false),
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
  createdAt: integer("createdAt", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updatedAt", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

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
}));

export const resourceRelations = relations(resource, ({ one }) => ({
  round: one(round, {
    fields: [resource.roundId],
    references: [round.id],
  }),
}));

export const playlistRelations = relations(playlist, ({ many }) => ({
  tracks: many(playlistTrackPlay),
}));

export const playlistTrackPlayRelations = relations(playlistTrackPlay, ({ one }) => ({
  playlist: one(playlist, {
    fields: [playlistTrackPlay.playlistId],
    references: [playlist.id],
  }),
}));
