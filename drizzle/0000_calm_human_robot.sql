CREATE TABLE `GameProfile` (
	`id` text PRIMARY KEY NOT NULL,
	`highscore` integer DEFAULT 0 NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `Hero` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`author` text,
	`description` text,
	`phash` text,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `Hero_name_unique` ON `Hero` (`name`);--> statement-breakpoint
CREATE TABLE `MultiplayerMatchCache` (
	`lobbyId` text PRIMARY KEY NOT NULL,
	`finishedAt` integer NOT NULL,
	`isFinal` integer DEFAULT false NOT NULL,
	`resultsJson` text NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `Playlist` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`formatVersion` integer DEFAULT 1 NOT NULL,
	`configJson` text NOT NULL,
	`installSourceKey` text,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `Playlist_installSourceKey_unique` ON `Playlist` (`installSourceKey`);--> statement-breakpoint
CREATE TABLE `PlaylistTrackPlay` (
	`id` text PRIMARY KEY NOT NULL,
	`playlistId` text NOT NULL,
	`roundId` text NOT NULL,
	`nodeId` text,
	`poolId` text,
	`playedAt` integer NOT NULL,
	FOREIGN KEY (`playlistId`) REFERENCES `Playlist`(`id`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `PlaylistTrackPlay_playlistId_playedAt_idx` ON `PlaylistTrackPlay` (`playlistId`,`playedAt`);--> statement-breakpoint
CREATE INDEX `PlaylistTrackPlay_playlistId_poolId_roundId_idx` ON `PlaylistTrackPlay` (`playlistId`,`poolId`,`roundId`);--> statement-breakpoint
CREATE TABLE `Resource` (
	`id` text PRIMARY KEY NOT NULL,
	`videoUri` text NOT NULL,
	`funscriptUri` text,
	`phash` text,
	`disabled` integer DEFAULT false NOT NULL,
	`roundId` text NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`roundId`) REFERENCES `Round`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `Resource_phash_idx` ON `Resource` (`phash`);--> statement-breakpoint
CREATE TABLE `ResultSyncQueue` (
	`lobbyId` text PRIMARY KEY NOT NULL,
	`createdAt` integer NOT NULL,
	`lastAttemptAt` integer
);
--> statement-breakpoint
CREATE TABLE `Round` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`author` text,
	`description` text,
	`bpm` real,
	`difficulty` integer,
	`phash` text,
	`startTime` integer,
	`endTime` integer,
	`type` text DEFAULT 'Normal' NOT NULL,
	`installSourceKey` text,
	`previewImage` text,
	`heroId` text,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`heroId`) REFERENCES `Hero`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `Round_installSourceKey_unique` ON `Round` (`installSourceKey`);--> statement-breakpoint
CREATE TABLE `SinglePlayerRunHistory` (
	`id` text PRIMARY KEY NOT NULL,
	`finishedAt` integer NOT NULL,
	`score` integer NOT NULL,
	`highscoreBefore` integer NOT NULL,
	`highscoreAfter` integer NOT NULL,
	`wasNewHighscore` integer DEFAULT false NOT NULL,
	`completionReason` text NOT NULL,
	`playlistId` text,
	`playlistName` text NOT NULL,
	`playlistFormatVersion` integer,
	`endingPosition` integer NOT NULL,
	`turn` integer NOT NULL,
	`createdAt` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `SinglePlayerRunHistory_finishedAt_idx` ON `SinglePlayerRunHistory` (`finishedAt`);
