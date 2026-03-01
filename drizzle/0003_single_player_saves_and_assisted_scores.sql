ALTER TABLE `GameProfile` ADD `highscoreAssisted` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `GameProfile` ADD `highscoreAssistedSaveMode` text;
--> statement-breakpoint
ALTER TABLE `SinglePlayerRunHistory` ADD `assistedActive` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `SinglePlayerRunHistory` ADD `assistedSaveMode` text;
--> statement-breakpoint
CREATE TABLE `SinglePlayerRunSave` (
	`id` text PRIMARY KEY NOT NULL,
	`playlistId` text NOT NULL,
	`playlistName` text NOT NULL,
	`playlistFormatVersion` integer,
	`saveMode` text NOT NULL,
	`snapshotJson` text NOT NULL,
	`savedAt` integer NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`playlistId`) REFERENCES `Playlist`(`id`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `SinglePlayerRunSave_playlistId_unique` ON `SinglePlayerRunSave` (`playlistId`);
