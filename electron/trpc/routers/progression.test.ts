// @vitest-environment node

import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CHEAT_MODE_ENABLED_KEY } from "../../../src/constants/experimentalFeatures";
import { getTotalXpForLevel } from "../../../src/game/progression";
import * as schema from "../../services/db/schema";

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  store: new Map<string, unknown>(),
}));

vi.mock("../../services/db", () => ({
  getDb: mocks.getDb,
}));

vi.mock("../../services/store", () => ({
  safeStoreGet: (key: string) => mocks.store.get(key),
  safeStoreSet: (key: string, value: unknown) => {
    mocks.store.set(key, value);
    return true;
  },
}));

import { progressionRouter } from "./progression";

describe("progression cheat profile", () => {
  let databasePath = "";
  let closeClient: (() => void) | null = null;

  beforeEach(async () => {
    mocks.store.clear();
    databasePath = path.join(tmpdir(), `f-land-progression-${crypto.randomUUID()}.db`);
    const client = createClient({ url: `file:${databasePath}` });
    closeClient = () => client.close();
    await client.execute(`
      CREATE TABLE "GameProfile" (
        "id" text PRIMARY KEY NOT NULL,
        "highscore" integer DEFAULT 0 NOT NULL,
        "highscoreCheatMode" integer DEFAULT 0 NOT NULL,
        "highscoreAssisted" integer DEFAULT 0 NOT NULL,
        "highscoreAssistedSaveMode" text,
        "progressionXp" integer DEFAULT 0 NOT NULL,
        "equippedTitleId" text DEFAULT 'fresh-face' NOT NULL,
        "respecTokens" integer DEFAULT 0 NOT NULL,
        "createdAt" integer NOT NULL,
        "updatedAt" integer NOT NULL
      )
    `);
    await client.execute(`
      CREATE TABLE "ProgressionSkillRank" (
        "id" text PRIMARY KEY NOT NULL,
        "profileId" text NOT NULL REFERENCES "GameProfile"("id") ON DELETE CASCADE,
        "skillId" text NOT NULL,
        "rank" integer DEFAULT 1 NOT NULL,
        "enabled" integer DEFAULT 1 NOT NULL,
        "createdAt" integer NOT NULL,
        "updatedAt" integer NOT NULL
      )
    `);
    await client.execute(
      `CREATE UNIQUE INDEX "ProgressionSkillRank_profileId_skillId_unique" ON "ProgressionSkillRank" ("profileId","skillId")`
    );
    await client.execute(`
      CREATE TABLE "ProgressionAward" (
        "id" text PRIMARY KEY NOT NULL,
        "profileId" text NOT NULL,
        "sourceKind" text NOT NULL,
        "sourceId" text NOT NULL,
        "outcome" text NOT NULL,
        "completedRounds" integer DEFAULT 0 NOT NULL,
        "xpAwarded" integer DEFAULT 0 NOT NULL,
        "blockReason" text,
        "createdAt" integer NOT NULL
      )
    `);
    await client.execute(
      `CREATE UNIQUE INDEX "ProgressionAward_sourceKind_sourceId_unique" ON "ProgressionAward" ("sourceKind","sourceId")`
    );
    mocks.getDb.mockReturnValue(drizzle(client, { schema }));
  });

  afterEach(async () => {
    closeClient?.();
    closeClient = null;
    await rm(databasePath, { force: true });
  });

  it("does not persist XP for runs shorter than two minutes", async () => {
    const caller = progressionRouter.createCaller({ event: { sender: {} } } as never);
    const result = await caller.awardRun({
      sourceKind: "single_player",
      sourceId: "short-run",
      outcome: "success",
      completedRounds: 100,
      playtimeSec: 119,
    });

    expect(result.award?.xpAwarded).toBe(0);
    expect(result.profile.totalXp).toBe(0);
    expect(result.breakdown.totalXp).toBe(0);
  });

  it("keeps the genuine profile isolated and restores it on reset and disable", async () => {
    const caller = progressionRouter.createCaller({ event: { sender: {} } } as never);
    await caller.setCheatModeEnabled({ enabled: true });
    const activated = await caller.activateCheatProfile();
    expect(activated.isCheated).toBe(true);

    const cheatedXp = getTotalXpForLevel(100);
    const changed = await caller.setCheatProgress({
      totalXp: cheatedXp,
      respecTokens: 99,
    });
    expect(changed.level).toBe(100);
    expect(changed.respecTokens).toBe(99);

    const genuine = await caller.getProfile({ mode: "genuine" });
    expect(genuine.level).toBe(1);
    expect(genuine.respecTokens).toBe(0);

    const reset = await caller.resetCheatProfile();
    expect(reset.isCheated).toBe(true);
    expect(reset.level).toBe(1);
    expect(reset.respecTokens).toBe(0);

    await caller.setCheatProgress({ totalXp: cheatedXp, respecTokens: 99 });
    await caller.setCheatModeEnabled({ enabled: false });
    expect(mocks.store.get(CHEAT_MODE_ENABLED_KEY)).toBe(false);
    const restored = await caller.getProfile({ mode: "effective" });
    expect(restored.isCheated).toBe(false);
    expect(restored.level).toBe(1);
  });
});
