ALTER TABLE "Hero" ADD COLUMN "tagsJson" text NOT NULL DEFAULT '[]';
--> statement-breakpoint
ALTER TABLE "Round" ADD COLUMN "tagsJson" text NOT NULL DEFAULT '[]';
--> statement-breakpoint
ALTER TABLE "Round" ADD COLUMN "libraryLabel" text;
