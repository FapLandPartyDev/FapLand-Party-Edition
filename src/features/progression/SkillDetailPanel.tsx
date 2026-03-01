import { Trans, useLingui } from "@lingui/react/macro";
import {
  getRequiredBranchRanks,
  type SkillBranchId,
  type SkillDefinition,
  type SkillModifierKey,
} from "../../game/progression";
import {
  BRANCH_VISUALS,
  getBranchMaxRanks,
  getRequirementProgress,
  getSkillIcon,
} from "./skillTree";

const BRANCH_MAX_RANKS = getBranchMaxRanks();
const TIER_REQUIREMENTS = ([2, 3, 4] as const).map((tier) => getRequiredBranchRanks(tier));

const PERCENT_MODIFIER_KEYS = new Set<SkillModifierKey>([
  "perkTriggerChance",
  "initialIntermediaryProbability",
  "intermediaryIncreasePerRound",
  "initialAntiPerkProbability",
  "antiPerkIncreasePerRound",
  "pendingIntensityCap",
]);

function formatModifierAmount(key: SkillModifierKey, amount: number): string {
  if (PERCENT_MODIFIER_KEYS.has(key)) {
    return `${amount > 0 ? "+" : ""}${(amount * 100).toFixed(1).replace(/\.0$/u, "")}%`;
  }
  if (key === "pauseDurationMs") {
    return `${amount > 0 ? "+" : ""}${(amount / 1000).toFixed(1).replace(/\.0$/u, "")}s`;
  }
  return `${amount > 0 ? "+" : ""}${amount}`;
}

export type SkillDetailPanelProps = {
  skill: SkillDefinition;
  rank: number;
  isDisabled: boolean;
  branchRanks: Record<SkillBranchId, number>;
  spentSkillPoints: number;
  unspentSkillPoints: number;
  branchName: string;
  isBusy: boolean;
  onPurchase: (skillId: string) => void;
  onToggleEnabled: (skillId: string, enabled: boolean) => void;
};

export function SkillDetailPanel({
  skill,
  rank,
  isDisabled,
  branchRanks,
  spentSkillPoints,
  unspentSkillPoints,
  branchName,
  isBusy,
  onPurchase,
  onToggleEnabled,
}: SkillDetailPanelProps) {
  const { t } = useLingui();
  const visual = BRANCH_VISUALS[skill.branch];
  const { requirement, current, unlocked } = getRequirementProgress(skill, {
    branchRanks,
    spentSkillPoints,
  });
  const isMaxed = rank >= skill.maxRank;
  const canBuy = unlocked && !isMaxed && unspentSkillPoints > 0 && !isBusy;
  const nextTierRanks =
    TIER_REQUIREMENTS.find((ranks) => ranks > branchRanks[skill.branch]) ?? null;
  const nextRankAmount = skill.modifier ? skill.modifier.amountPerRank : null;
  const currentAmount = skill.modifier ? skill.modifier.amountPerRank * rank : null;

  return (
    <aside className="flex h-full flex-col gap-4 overflow-y-auto rounded-3xl border border-white/10 bg-zinc-950/80 p-5 backdrop-blur-xl">
      <div>
        <div className="flex items-start gap-3">
          <span
            className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border text-3xl"
            style={{ borderColor: `${visual.accent}66`, background: `${visual.accent}1a` }}
          >
            {getSkillIcon(skill)}
          </span>
          <div className="min-w-0">
            <h2 className="text-2xl font-black leading-tight">{skill.name}</h2>
            <p className="mt-1 flex flex-wrap items-center gap-2 font-mono text-[11px] uppercase tracking-[0.2em]">
              <span style={{ color: visual.accent }}>
                {visual.icon} {branchName}
              </span>
              <span className="text-zinc-500">·</span>
              <span className="text-zinc-400">{t`Tier ${skill.tier}`}</span>
            </p>
          </div>
        </div>

        <div className="mt-4 flex items-center gap-1.5" aria-hidden="true">
          {Array.from({ length: skill.maxRank }, (_, index) => (
            <span
              key={index}
              className="h-2.5 flex-1 rounded-full transition"
              style={{
                background:
                  index < rank
                    ? isDisabled
                      ? "rgba(251,113,133,0.8)"
                      : visual.accent
                    : "rgba(255,255,255,0.09)",
                boxShadow: index < rank && !isDisabled ? `0 0 10px ${visual.accent}` : undefined,
              }}
            />
          ))}
        </div>
        <p className="mt-2 font-mono text-xs text-zinc-400">
          <Trans>
            Rank {rank} / {skill.maxRank}
          </Trans>
          {isMaxed && <span className="ml-2 text-amber-200">★ {t`Mastered`}</span>}
        </p>
      </div>

      <p className="text-sm leading-relaxed text-zinc-300">{skill.description}</p>

      {skill.modifier && (
        <dl className="grid grid-cols-2 gap-2 text-center">
          <div className="rounded-2xl border border-white/10 bg-black/40 p-3">
            <dt className="font-mono text-[10px] uppercase tracking-widest text-zinc-500">
              <Trans>Active now</Trans>
            </dt>
            <dd className="mt-1 text-xl font-black" style={{ color: visual.accent }}>
              {rank > 0 && !isDisabled
                ? formatModifierAmount(skill.modifier.key, currentAmount ?? 0)
                : "—"}
            </dd>
          </div>
          <div className="rounded-2xl border border-white/10 bg-black/40 p-3">
            <dt className="font-mono text-[10px] uppercase tracking-widest text-zinc-500">
              <Trans>Per rank</Trans>
            </dt>
            <dd className="mt-1 text-xl font-black text-zinc-100">
              {formatModifierAmount(skill.modifier.key, nextRankAmount ?? 0)}
            </dd>
          </div>
        </dl>
      )}

      {skill.branch !== "arsenal" && (
        <div className="rounded-2xl border border-white/10 bg-black/30 p-3">
          <div className="flex items-baseline justify-between">
            <p className="font-mono text-[10px] uppercase tracking-widest text-zinc-500">
              <Trans>{branchName} investment</Trans>
            </p>
            <p className="font-mono text-xs text-zinc-300">
              {branchRanks[skill.branch]}/{BRANCH_MAX_RANKS[skill.branch]}
            </p>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full rounded-full"
              style={{
                width: `${(branchRanks[skill.branch] / BRANCH_MAX_RANKS[skill.branch]) * 100}%`,
                background: visual.accent,
              }}
            />
          </div>
          <p className="mt-2 text-xs text-zinc-400">
            {nextTierRanks === null ? (
              <Trans>Every tier of this branch is unlocked.</Trans>
            ) : (
              <Trans>
                {nextTierRanks - branchRanks[skill.branch]} more ranks unlock the next tier.
              </Trans>
            )}
          </p>
        </div>
      )}

      {!unlocked && (
        <div className="rounded-2xl border border-amber-300/30 bg-amber-500/10 p-3">
          <p className="text-xs font-bold uppercase tracking-widest text-amber-200">
            🔒 <Trans>Locked</Trans>
          </p>
          <p className="mt-1 text-sm text-amber-100">
            {requirement.kind === "total" ? (
              <Trans>
                Spend {requirement.ranks} skill points anywhere to unlock this slot ({current}{" "}
                spent).
              </Trans>
            ) : (
              <Trans>
                Invest {requirement.ranks} ranks in {branchName} to unlock this tier ({current}{" "}
                invested).
              </Trans>
            )}
          </p>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-black/50">
            <div
              className="h-full rounded-full bg-amber-300"
              style={{
                width: `${Math.min(100, (current / Math.max(1, requirement.ranks)) * 100)}%`,
              }}
            />
          </div>
        </div>
      )}

      <div className="mt-auto flex flex-col gap-2">
        <button
          type="button"
          disabled={!canBuy}
          onClick={() => onPurchase(skill.id)}
          className="skill-buy-button relative w-full overflow-hidden rounded-2xl border px-4 py-3 text-sm font-black uppercase tracking-widest transition disabled:cursor-not-allowed disabled:opacity-40"
          style={{
            borderColor: `${visual.accent}80`,
            background: canBuy ? `${visual.accent}26` : "rgba(255,255,255,0.04)",
            color: canBuy ? "#fff" : "#a1a1aa",
          }}
        >
          {isMaxed ? (
            <Trans>Fully ranked</Trans>
          ) : !unlocked ? (
            <Trans>Locked</Trans>
          ) : unspentSkillPoints < 1 ? (
            <Trans>No skill points</Trans>
          ) : (
            <Trans>Spend 1 point → Rank {rank + 1}</Trans>
          )}
        </button>

        {rank > 0 && (
          <button
            type="button"
            disabled={isBusy}
            onClick={() => onToggleEnabled(skill.id, isDisabled)}
            aria-pressed={!isDisabled}
            aria-label={isDisabled ? t`Activate ${skill.name}` : t`Deactivate ${skill.name}`}
            className={`w-full rounded-2xl border px-4 py-2.5 text-xs font-bold uppercase tracking-widest transition disabled:opacity-40 ${
              isDisabled
                ? "border-emerald-300/40 bg-emerald-500/10 text-emerald-100 hover:bg-emerald-500/20"
                : "border-rose-300/40 bg-rose-500/10 text-rose-100 hover:bg-rose-500/20"
            }`}
          >
            {isDisabled ? <Trans>Activate skill</Trans> : <Trans>Deactivate skill</Trans>}
          </button>
        )}
        <p className="text-center text-[11px] leading-relaxed text-zinc-500">
          <Trans>Deactivated ranks stay bought and grant bonus solo XP.</Trans>
        </p>
      </div>
    </aside>
  );
}
