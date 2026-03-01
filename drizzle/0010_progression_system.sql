ALTER TABLE "GameProfile" ADD COLUMN "progressionXp" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "GameProfile" ADD COLUMN "equippedTitleId" text DEFAULT 'fresh-face' NOT NULL;
--> statement-breakpoint
ALTER TABLE "GameProfile" ADD COLUMN "respecTokens" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
CREATE TABLE "ProgressionSkillRank" (
  "id" text PRIMARY KEY NOT NULL,
  "profileId" text NOT NULL,
  "skillId" text NOT NULL,
  "rank" integer DEFAULT 1 NOT NULL,
  "createdAt" integer NOT NULL,
  "updatedAt" integer NOT NULL,
  FOREIGN KEY ("profileId") REFERENCES "GameProfile"("id") ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX "ProgressionSkillRank_profileId_skillId_unique" ON "ProgressionSkillRank" ("profileId","skillId");
--> statement-breakpoint
CREATE TABLE "ProgressionAward" (
  "id" text PRIMARY KEY NOT NULL,
  "profileId" text NOT NULL,
  "sourceKind" text NOT NULL,
  "sourceId" text NOT NULL,
  "outcome" text NOT NULL,
  "completedRounds" integer DEFAULT 0 NOT NULL,
  "xpAwarded" integer DEFAULT 0 NOT NULL,
  "blockReason" text,
  "createdAt" integer NOT NULL,
  FOREIGN KEY ("profileId") REFERENCES "GameProfile"("id") ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX "ProgressionAward_sourceKind_sourceId_unique" ON "ProgressionAward" ("sourceKind","sourceId");
--> statement-breakpoint
CREATE INDEX "ProgressionAward_profileId_createdAt_idx" ON "ProgressionAward" ("profileId","createdAt");
