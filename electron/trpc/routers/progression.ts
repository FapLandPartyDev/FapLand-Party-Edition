import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import * as z from "zod";
import {
  calculateProgressionAward,
  CHEAT_PROFILE_ID,
  getLevelFromXp,
  getRequiredBranchRanks,
  getRespecTokensEarnedThroughLevel,
  getSkillDeactivationXpBonusPercent,
  getTitleById,
  getTitleForLevel,
  getTitlesForLevel,
  getTotalXpForLevel,
  LOCAL_PROFILE_ID,
  MAX_CHEAT_XP,
  SKILL_LIBRARY,
  type SkillBranchId,
} from "../../../src/game/progression";
import {
  CHEAT_MODE_ENABLED_KEY,
  normalizeCheatModeEnabled,
} from "../../../src/constants/experimentalFeatures";
import { getDb } from "../../services/db";
import { gameProfile, progressionAward, progressionSkillRank } from "../../services/db/schema";
import { safeStoreGet, safeStoreSet } from "../../services/store";
import { publicProcedure, router } from "../trpc";

const ZAwardInput = z.object({
  sourceKind: z.enum(["single_player", "multiplayer"]),
  sourceId: z.string().trim().min(1),
  outcome: z.enum(["success", "failure"]),
  completedRounds: z.number().int().min(0),
  playtimeSec: z.number().int().min(0),
  disabledSkillRanks: z.number().int().min(0).optional(),
  blockReason: z.enum(["cheat_mode", "level_bypass", "map_editor_test"]).nullable().optional(),
});

const ZSkillBranch = z.enum([
  "control",
  "dicecraft",
  "economy",
  "fortune",
  "defense",
  "endurance",
  "scoring",
  "arsenal",
]);

function isCheatModeEnabled(): boolean {
  return normalizeCheatModeEnabled(safeStoreGet(CHEAT_MODE_ENABLED_KEY));
}

async function ensureLocalProfile(): Promise<void> {
  await getDb()
    .insert(gameProfile)
    .values({ id: LOCAL_PROFILE_ID })
    .onConflictDoNothing({ target: gameProfile.id });
}

async function profileExists(profileId: string): Promise<boolean> {
  const profile = await getDb().query.gameProfile.findFirst({
    where: eq(gameProfile.id, profileId),
  });
  return Boolean(profile);
}

async function getEffectiveProfileId(): Promise<string> {
  if (!isCheatModeEnabled()) return LOCAL_PROFILE_ID;
  return (await profileExists(CHEAT_PROFILE_ID)) ? CHEAT_PROFILE_ID : LOCAL_PROFILE_ID;
}

async function readProfile(profileId: string) {
  await ensureLocalProfile();
  const db = getDb();
  const profile = await db.query.gameProfile.findFirst({
    where: eq(gameProfile.id, profileId),
  });
  if (!profile) throw new Error("Local progression profile could not be read.");
  const rankRows = await db.query.progressionSkillRank.findMany({
    where: eq(progressionSkillRank.profileId, profileId),
  });
  const skillRanks = Object.fromEntries(rankRows.map((row) => [row.skillId, row.rank]));
  const disabledSkillIds = rankRows.filter((row) => !row.enabled).map((row) => row.skillId);
  const disabledSkillRanks = rankRows.reduce(
    (total, row) => total + (row.enabled ? 0 : row.rank),
    0
  );
  const level = getLevelFromXp(profile.progressionXp);
  const spentSkillPoints = rankRows.reduce((total, row) => total + row.rank, 0);
  const genuineProfile =
    profileId === CHEAT_PROFILE_ID
      ? await db.query.gameProfile.findFirst({ where: eq(gameProfile.id, LOCAL_PROFILE_ID) })
      : null;
  return {
    totalXp: profile.progressionXp,
    level,
    unspentSkillPoints: Math.max(0, level - 1 - spentSkillPoints),
    spentSkillPoints,
    respecTokens: profile.respecTokens,
    equippedTitle: getTitleById(profile.equippedTitleId),
    unlockedTitles: getTitlesForLevel(level),
    skillRanks,
    disabledSkillIds,
    disabledSkillRanks,
    skillDeactivationXpBonusPercent: getSkillDeactivationXpBonusPercent(disabledSkillRanks),
    isCheated: profileId === CHEAT_PROFILE_ID,
    genuineLevel: genuineProfile ? getLevelFromXp(genuineProfile.progressionXp) : level,
    genuineTotalXp: genuineProfile?.progressionXp ?? profile.progressionXp,
  };
}

async function readEffectiveProfile() {
  return readProfile(await getEffectiveProfileId());
}

async function discardCheatProfile(): Promise<void> {
  const db = getDb();
  await db.transaction(async (transaction) => {
    await transaction
      .delete(progressionSkillRank)
      .where(eq(progressionSkillRank.profileId, CHEAT_PROFILE_ID));
    await transaction.delete(gameProfile).where(eq(gameProfile.id, CHEAT_PROFILE_ID));
  });
}

async function cloneGenuineProfile(): Promise<void> {
  await ensureLocalProfile();
  const db = getDb();
  const genuine = await db.query.gameProfile.findFirst({
    where: eq(gameProfile.id, LOCAL_PROFILE_ID),
  });
  if (!genuine) throw new Error("Genuine progression profile could not be read.");
  const ranks = await db.query.progressionSkillRank.findMany({
    where: eq(progressionSkillRank.profileId, LOCAL_PROFILE_ID),
  });
  await db.transaction(async (transaction) => {
    await transaction
      .delete(progressionSkillRank)
      .where(eq(progressionSkillRank.profileId, CHEAT_PROFILE_ID));
    await transaction.delete(gameProfile).where(eq(gameProfile.id, CHEAT_PROFILE_ID));
    await transaction.insert(gameProfile).values({
      id: CHEAT_PROFILE_ID,
      progressionXp: genuine.progressionXp,
      equippedTitleId: genuine.equippedTitleId,
      respecTokens: genuine.respecTokens,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    if (ranks.length === 0) return;
    await transaction.insert(progressionSkillRank).values(
      ranks.map((rank) => ({
        profileId: CHEAT_PROFILE_ID,
        skillId: rank.skillId,
        rank: rank.rank,
        enabled: rank.enabled,
        createdAt: new Date(),
        updatedAt: new Date(),
      }))
    );
  });
}

async function requireCheatProfile(): Promise<void> {
  if (!isCheatModeEnabled()) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Cheat Mode is not enabled." });
  }
  if (!(await profileExists(CHEAT_PROFILE_ID))) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Enter the secret code first." });
  }
}

async function getMutationProfileId(): Promise<string> {
  return getEffectiveProfileId();
}

async function setSkillRanks(mode: "max" | "clear", branch?: SkillBranchId): Promise<void> {
  await requireCheatProfile();
  const definitions = branch
    ? SKILL_LIBRARY.filter((skill) => skill.branch === branch)
    : SKILL_LIBRARY;
  const definitionIds = new Set(definitions.map((skill) => skill.id));
  const db = getDb();
  const existing = await db.query.progressionSkillRank.findMany({
    where: eq(progressionSkillRank.profileId, CHEAT_PROFILE_ID),
  });
  await db.transaction(async (transaction) => {
    for (const row of existing) {
      if (!definitionIds.has(row.skillId)) continue;
      await transaction.delete(progressionSkillRank).where(eq(progressionSkillRank.id, row.id));
    }
    if (mode === "clear" || definitions.length === 0) return;
    await transaction.insert(progressionSkillRank).values(
      definitions.map((definition) => ({
        profileId: CHEAT_PROFILE_ID,
        skillId: definition.id,
        rank: definition.maxRank,
        enabled: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      }))
    );
  });
}

export const progressionRouter = router({
  getProfile: publicProcedure
    .input(z.object({ mode: z.enum(["effective", "genuine"]) }).optional())
    .query(async ({ input }) =>
      input?.mode === "genuine" ? readProfile(LOCAL_PROFILE_ID) : readEffectiveProfile()
    ),

  setCheatModeEnabled: publicProcedure
    .input(z.object({ enabled: z.boolean() }))
    .mutation(async ({ input }) => {
      const wasEnabled = isCheatModeEnabled();
      if (input.enabled && !wasEnabled) await discardCheatProfile();
      if (!safeStoreSet(CHEAT_MODE_ENABLED_KEY, input.enabled)) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to save Cheat Mode.",
        });
      }
      if (!input.enabled) await discardCheatProfile();
      return { enabled: input.enabled };
    }),

  activateCheatProfile: publicProcedure.mutation(async () => {
    if (!isCheatModeEnabled()) {
      throw new TRPCError({ code: "FORBIDDEN", message: "Cheat Mode is not enabled." });
    }
    if (!(await profileExists(CHEAT_PROFILE_ID))) await cloneGenuineProfile();
    return readProfile(CHEAT_PROFILE_ID);
  }),

  resetCheatProfile: publicProcedure.mutation(async () => {
    await requireCheatProfile();
    await cloneGenuineProfile();
    return readProfile(CHEAT_PROFILE_ID);
  }),

  discardCheatProfile: publicProcedure.mutation(async () => {
    await discardCheatProfile();
    return readProfile(LOCAL_PROFILE_ID);
  }),

  setCheatProgress: publicProcedure
    .input(
      z.object({
        totalXp: z.number().int().min(0).max(MAX_CHEAT_XP),
        respecTokens: z.number().int().min(0).max(999),
        titleId: z.string().trim().min(1).optional(),
      })
    )
    .mutation(async ({ input }) => {
      await requireCheatProfile();
      const level = getLevelFromXp(input.totalXp);
      const current = await readProfile(CHEAT_PROFILE_ID);
      const title = getTitleById(input.titleId ?? current.equippedTitle.id);
      const equippedTitleId = title.requiredLevel <= level ? title.id : getTitleForLevel(level).id;
      await getDb()
        .update(gameProfile)
        .set({
          progressionXp: input.totalXp,
          respecTokens: input.respecTokens,
          equippedTitleId,
          updatedAt: new Date(),
        })
        .where(eq(gameProfile.id, CHEAT_PROFILE_ID));
      return readProfile(CHEAT_PROFILE_ID);
    }),

  setCheatSkillRanks: publicProcedure
    .input(z.object({ mode: z.enum(["max", "clear"]), branch: ZSkillBranch.optional() }))
    .mutation(async ({ input }) => {
      await setSkillRanks(input.mode, input.branch);
      return readProfile(CHEAT_PROFILE_ID);
    }),

  applyCheatCompletionistPreset: publicProcedure.mutation(async () => {
    await requireCheatProfile();
    await setSkillRanks("max");
    const title = getTitleForLevel(1000);
    await getDb()
      .update(gameProfile)
      .set({
        progressionXp: getTotalXpForLevel(1000),
        respecTokens: 99,
        equippedTitleId: title.id,
        updatedAt: new Date(),
      })
      .where(eq(gameProfile.id, CHEAT_PROFILE_ID));
    return readProfile(CHEAT_PROFILE_ID);
  }),

  awardRun: publicProcedure.input(ZAwardInput).mutation(async ({ input }) => {
    await ensureLocalProfile();
    const db = getDb();
    const existing = await db.query.progressionAward.findFirst({
      where: and(
        eq(progressionAward.sourceKind, input.sourceKind),
        eq(progressionAward.sourceId, input.sourceId)
      ),
    });
    if (existing) {
      return {
        duplicate: true,
        award: existing,
        profile:
          input.blockReason === "cheat_mode"
            ? await readEffectiveProfile()
            : await readProfile(LOCAL_PROFILE_ID),
        levelsGained: 0,
      };
    }

    const breakdown = calculateProgressionAward({
      ...input,
      disabledSkillRanks: input.sourceKind === "single_player" ? input.disabledSkillRanks : 0,
    });
    const before = await readProfile(LOCAL_PROFILE_ID);
    await db.transaction(async (transaction) => {
      await transaction.insert(progressionAward).values({
        profileId: LOCAL_PROFILE_ID,
        sourceKind: input.sourceKind,
        sourceId: input.sourceId,
        outcome: input.outcome,
        completedRounds: input.completedRounds,
        xpAwarded: breakdown.totalXp,
        blockReason: input.blockReason ?? null,
      });
      const nextXp = before.totalXp + breakdown.totalXp;
      const nextLevel = getLevelFromXp(nextXp);
      const earnedTokens =
        getRespecTokensEarnedThroughLevel(nextLevel) -
        getRespecTokensEarnedThroughLevel(before.level);
      await transaction
        .update(gameProfile)
        .set({
          progressionXp: nextXp,
          respecTokens: before.respecTokens + Math.max(0, earnedTokens),
          updatedAt: new Date(),
        })
        .where(eq(gameProfile.id, LOCAL_PROFILE_ID));
    });
    const profile =
      input.blockReason === "cheat_mode"
        ? await readEffectiveProfile()
        : await readProfile(LOCAL_PROFILE_ID);
    const award = await db.query.progressionAward.findFirst({
      where: and(
        eq(progressionAward.sourceKind, input.sourceKind),
        eq(progressionAward.sourceId, input.sourceId)
      ),
    });
    return {
      duplicate: false,
      award,
      breakdown,
      profile,
      levelsGained: input.blockReason === "cheat_mode" ? 0 : profile.level - before.level,
    };
  }),

  purchaseSkill: publicProcedure
    .input(z.object({ skillId: z.string().trim().min(1) }))
    .mutation(async ({ input }) => {
      const definition = SKILL_LIBRARY.find((candidate) => candidate.id === input.skillId);
      if (!definition) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Skill not found." });
      }
      const profileId = await getMutationProfileId();
      const profile = await readProfile(profileId);
      if (profile.unspentSkillPoints < 1) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "No skill points available." });
      }
      const currentRank = profile.skillRanks[input.skillId] ?? 0;
      if (currentRank >= definition.maxRank) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Skill is already at maximum rank." });
      }
      const branchRanks = SKILL_LIBRARY.filter(
        (candidate) => candidate.branch === definition.branch
      ).reduce((total, candidate) => total + (profile.skillRanks[candidate.id] ?? 0), 0);
      if (
        definition.branch !== "arsenal" &&
        branchRanks < getRequiredBranchRanks(definition.tier)
      ) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Spend more points in this branch to unlock the skill.",
        });
      }
      if (definition.branch === "arsenal") {
        const arsenalIndex = SKILL_LIBRARY.filter(
          (candidate) => candidate.branch === "arsenal"
        ).findIndex((candidate) => candidate.id === definition.id);
        const requiredTotal = (arsenalIndex + 1) * 5;
        if (profile.spentSkillPoints < requiredTotal) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Spend ${requiredTotal} total skill points to unlock this skill.`,
          });
        }
      }

      await getDb()
        .insert(progressionSkillRank)
        .values({
          profileId,
          skillId: definition.id,
          rank: currentRank + 1,
          enabled: true,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [progressionSkillRank.profileId, progressionSkillRank.skillId],
          set: { rank: currentRank + 1, updatedAt: new Date() },
        });
      return readProfile(profileId);
    }),

  setSkillEnabled: publicProcedure
    .input(z.object({ skillId: z.string().trim().min(1), enabled: z.boolean() }))
    .mutation(async ({ input }) => {
      const definition = SKILL_LIBRARY.find((candidate) => candidate.id === input.skillId);
      if (!definition) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Skill not found." });
      }
      const profileId = await getMutationProfileId();
      const profile = await readProfile(profileId);
      if (!(input.skillId in profile.skillRanks)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Only purchased skills can be activated or deactivated.",
        });
      }
      await getDb()
        .update(progressionSkillRank)
        .set({ enabled: input.enabled, updatedAt: new Date() })
        .where(
          and(
            eq(progressionSkillRank.profileId, profileId),
            eq(progressionSkillRank.skillId, input.skillId)
          )
        );
      return readProfile(profileId);
    }),

  setAllSkillsEnabled: publicProcedure
    .input(z.object({ enabled: z.boolean() }))
    .mutation(async ({ input }) => {
      const profileId = await getMutationProfileId();
      await getDb()
        .update(progressionSkillRank)
        .set({ enabled: input.enabled, updatedAt: new Date() })
        .where(eq(progressionSkillRank.profileId, profileId));
      return readProfile(profileId);
    }),

  respec: publicProcedure.mutation(async () => {
    const profileId = await getMutationProfileId();
    const profile = await readProfile(profileId);
    if (profile.respecTokens < 1) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "No respec tokens available." });
    }
    const db = getDb();
    await db.transaction(async (transaction) => {
      await transaction
        .delete(progressionSkillRank)
        .where(eq(progressionSkillRank.profileId, profileId));
      await transaction
        .update(gameProfile)
        .set({ respecTokens: profile.respecTokens - 1, updatedAt: new Date() })
        .where(eq(gameProfile.id, profileId));
    });
    return readProfile(profileId);
  }),

  equipTitle: publicProcedure
    .input(z.object({ titleId: z.string().trim().min(1) }))
    .mutation(async ({ input }) => {
      const profileId = await getMutationProfileId();
      const profile = await readProfile(profileId);
      const title = getTitleById(input.titleId);
      if (title.id !== input.titleId || title.requiredLevel > profile.level) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Title is not unlocked." });
      }
      await getDb()
        .update(gameProfile)
        .set({ equippedTitleId: title.id, updatedAt: new Date() })
        .where(eq(gameProfile.id, profileId));
      return readProfile(profileId);
    }),
});
