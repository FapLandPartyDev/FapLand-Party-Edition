CREATE TABLE `AcquisitionSource` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`canonicalLocatorHash` text NOT NULL,
	`locatorJson` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`origin` text DEFAULT 'user' NOT NULL,
	`lastCatalogedAt` integer,
	`catalogError` text,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `AcquisitionSource_locatorHash_unique` ON `AcquisitionSource` (`canonicalLocatorHash`);
--> statement-breakpoint
CREATE TABLE `AcquisitionFile` (
	`id` text PRIMARY KEY NOT NULL,
	`sourceId` text NOT NULL,
	`sourcePath` text NOT NULL,
	`displayName` text NOT NULL,
	`sizeBytes` integer,
	`mediaKind` text DEFAULT 'other' NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`sourceId`) REFERENCES `AcquisitionSource`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `AcquisitionFile_sourceId_sourcePath_unique` ON `AcquisitionFile` (`sourceId`,`sourcePath`);
--> statement-breakpoint
CREATE INDEX `AcquisitionFile_sourceId_idx` ON `AcquisitionFile` (`sourceId`);
--> statement-breakpoint
CREATE TABLE `RoundAcquisitionCandidate` (
	`id` text PRIMARY KEY NOT NULL,
	`roundId` text NOT NULL,
	`sourceId` text NOT NULL,
	`sourcePath` text NOT NULL,
	`matchKind` text NOT NULL,
	`matchScore` real,
	`sortOrder` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`roundId`) REFERENCES `Round`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`sourceId`) REFERENCES `AcquisitionSource`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `RoundAcquisitionCandidate_round_source_path_unique` ON `RoundAcquisitionCandidate` (`roundId`,`sourceId`,`sourcePath`);
--> statement-breakpoint
CREATE INDEX `RoundAcquisitionCandidate_roundId_idx` ON `RoundAcquisitionCandidate` (`roundId`);
--> statement-breakpoint
CREATE TABLE `AcquisitionJob` (
	`id` text PRIMARY KEY NOT NULL,
	`sourceId` text NOT NULL,
	`kind` text NOT NULL,
	`state` text DEFAULT 'queued' NOT NULL,
	`selectedPathsJson` text DEFAULT '[]' NOT NULL,
	`downloadedBytes` integer DEFAULT 0 NOT NULL,
	`totalBytes` integer DEFAULT 0 NOT NULL,
	`uploadedBytes` integer DEFAULT 0 NOT NULL,
	`downloadSpeed` integer DEFAULT 0 NOT NULL,
	`uploadSpeed` integer DEFAULT 0 NOT NULL,
	`peerCount` integer DEFAULT 0 NOT NULL,
	`ratio` real DEFAULT 0 NOT NULL,
	`activeSeedTimeMs` integer DEFAULT 0 NOT NULL,
	`errorMessage` text,
	`createdAt` integer NOT NULL,
	`startedAt` integer,
	`completedAt` integer,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`sourceId`) REFERENCES `AcquisitionSource`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `AcquisitionJob_sourceId_idx` ON `AcquisitionJob` (`sourceId`);
