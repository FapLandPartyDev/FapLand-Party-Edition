CREATE TABLE `GameplaySession` (
	`id` text PRIMARY KEY NOT NULL,
	`mode` text NOT NULL,
	`sourceId` text NOT NULL,
	`playlistId` text,
	`playlistName` text NOT NULL,
	`startedAt` integer NOT NULL,
	`lastActiveAt` integer NOT NULL,
	`endedAt` integer,
	`activePlayMs` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'in_progress' NOT NULL,
	`completionReason` text,
	`score` integer,
	`completedRounds` integer DEFAULT 0 NOT NULL,
	`cheatModeActive` integer DEFAULT false NOT NULL,
	`assistedActive` integer DEFAULT false NOT NULL,
	`assistedSaveMode` text,
	`singlePlayerRunId` text,
	`isLegacy` integer DEFAULT false NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `GameplaySession_sourceId_unique` ON `GameplaySession` (`sourceId`);
--> statement-breakpoint
CREATE INDEX `GameplaySession_mode_startedAt_idx` ON `GameplaySession` (`mode`,`startedAt`);
--> statement-breakpoint
CREATE INDEX `GameplaySession_singlePlayerRunId_idx` ON `GameplaySession` (`singlePlayerRunId`);
--> statement-breakpoint
CREATE TABLE `GameplayRoundPlay` (
	`id` text PRIMARY KEY NOT NULL,
	`sessionId` text,
	`mode` text NOT NULL,
	`playlistId` text,
	`playlistName` text NOT NULL,
	`roundId` text NOT NULL,
	`roundName` text NOT NULL,
	`roundType` text NOT NULL,
	`phaseKind` text NOT NULL,
	`nodeId` text,
	`poolId` text,
	`startedAt` integer NOT NULL,
	`finishedAt` integer,
	`scheduledDurationMs` integer,
	`watchedDurationMs` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'playing' NOT NULL,
	`cumOutcome` text,
	`legacySourceId` text,
	`isLegacy` integer DEFAULT false NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`sessionId`) REFERENCES `GameplaySession`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `GameplayRoundPlay_legacySourceId_unique` ON `GameplayRoundPlay` (`legacySourceId`);
--> statement-breakpoint
CREATE INDEX `GameplayRoundPlay_sessionId_idx` ON `GameplayRoundPlay` (`sessionId`);
--> statement-breakpoint
CREATE INDEX `GameplayRoundPlay_roundId_idx` ON `GameplayRoundPlay` (`roundId`);
--> statement-breakpoint
CREATE INDEX `GameplayRoundPlay_mode_startedAt_idx` ON `GameplayRoundPlay` (`mode`,`startedAt`);
--> statement-breakpoint
CREATE INDEX `GameplayRoundPlay_cumOutcome_idx` ON `GameplayRoundPlay` (`cumOutcome`);
--> statement-breakpoint
INSERT OR IGNORE INTO `GameplaySession` (
	`id`, `mode`, `sourceId`, `playlistId`, `playlistName`, `startedAt`, `lastActiveAt`,
	`endedAt`, `activePlayMs`, `status`, `completionReason`, `score`, `completedRounds`,
	`cheatModeActive`, `assistedActive`, `assistedSaveMode`, `singlePlayerRunId`, `isLegacy`,
	`createdAt`, `updatedAt`
)
SELECT
	'legacy-single-' || `id`, 'single_player', 'legacy-single:' || `id`, `playlistId`,
	`playlistName`, `finishedAt` - COALESCE(`survivedDurationSec`, 0) * 1000, `finishedAt`,
	`finishedAt`, COALESCE(`survivedDurationSec`, 0) * 1000, 'completed', `completionReason`,
	`score`, 0, false, `assistedActive`, `assistedSaveMode`, `id`, true,
	`createdAt`, `createdAt`
FROM `SinglePlayerRunHistory`;
--> statement-breakpoint
INSERT OR IGNORE INTO `GameplayRoundPlay` (
	`id`, `sessionId`, `mode`, `playlistId`, `playlistName`, `roundId`, `roundName`,
	`roundType`, `phaseKind`, `nodeId`, `poolId`, `startedAt`, `finishedAt`,
	`scheduledDurationMs`, `watchedDurationMs`, `status`, `cumOutcome`, `legacySourceId`,
	`isLegacy`, `createdAt`, `updatedAt`
)
SELECT
	'legacy-play-' || p.`id`, NULL, 'single_player', p.`playlistId`,
	COALESCE(pl.`name`, p.`playlistId`), p.`roundId`, COALESCE(r.`name`, p.`roundId`),
	COALESCE(r.`type`, 'Normal'), CASE WHEN COALESCE(r.`type`, 'Normal') = 'Interjection'
	THEN 'interjection' WHEN COALESCE(r.`type`, 'Normal') = 'Cum' THEN 'cum' ELSE 'normal' END,
	p.`nodeId`, p.`poolId`, p.`playedAt`, p.`playedAt`, NULL, 0, 'completed', NULL,
	'playlist-track-play:' || p.`id`, true, p.`playedAt`, p.`playedAt`
FROM `PlaylistTrackPlay` p
LEFT JOIN `Playlist` pl ON pl.`id` = p.`playlistId`
LEFT JOIN `Round` r ON r.`id` = p.`roundId`;
