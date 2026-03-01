import { trpc } from "./trpc";

export type ProgressionProfile = Awaited<ReturnType<typeof trpc.progression.getProfile.query>>;

export const progression = {
  getProfile: (mode: "effective" | "genuine" = "effective") =>
    trpc.progression.getProfile.query({ mode }),
  purchaseSkill: (skillId: string) => trpc.progression.purchaseSkill.mutate({ skillId }),
  setSkillEnabled: (skillId: string, enabled: boolean) =>
    trpc.progression.setSkillEnabled.mutate({ skillId, enabled }),
  setAllSkillsEnabled: (enabled: boolean) =>
    trpc.progression.setAllSkillsEnabled.mutate({ enabled }),
  respec: () => trpc.progression.respec.mutate(),
  equipTitle: (titleId: string) => trpc.progression.equipTitle.mutate({ titleId }),
  activateCheatProfile: () => trpc.progression.activateCheatProfile.mutate(),
  setCheatProgress: (input: { totalXp: number; respecTokens: number; titleId?: string }) =>
    trpc.progression.setCheatProgress.mutate(input),
  setCheatSkillRanks: (
    mode: "max" | "clear",
    branch?: Parameters<typeof trpc.progression.setCheatSkillRanks.mutate>[0]["branch"]
  ) => trpc.progression.setCheatSkillRanks.mutate({ mode, branch }),
  applyCheatCompletionistPreset: () => trpc.progression.applyCheatCompletionistPreset.mutate(),
  resetCheatProfile: () => trpc.progression.resetCheatProfile.mutate(),
  discardCheatProfile: () => trpc.progression.discardCheatProfile.mutate(),
  setCheatModeEnabled: (enabled: boolean) =>
    trpc.progression.setCheatModeEnabled.mutate({ enabled }),
  awardRun: (input: Parameters<typeof trpc.progression.awardRun.mutate>[0]) =>
    trpc.progression.awardRun.mutate(input),
} as const;
