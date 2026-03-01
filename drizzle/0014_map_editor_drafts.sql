CREATE TABLE `MapEditorDraft` (
	`playlistId` text PRIMARY KEY NOT NULL,
	`snapshotJson` text NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`playlistId`) REFERENCES `Playlist`(`id`) ON UPDATE cascade ON DELETE cascade
);
