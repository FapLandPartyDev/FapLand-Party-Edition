import { useEffect, useState } from "react";
import { Trans, useLingui } from "@lingui/react/macro";
import {
  MAX_CHEAT_LEVEL,
  MAX_CHEAT_XP,
  getLevelProgress,
  getTotalXpForLevel,
  type SkillBranchId,
} from "../../game/progression";
import { progression, type ProgressionProfile } from "../../services/progression";
import { BRANCH_VISUALS, SKILL_BRANCH_ORDER } from "./skillTree";

export function ProgressionCheatConsole({
  profile,
  branchNames,
  onProfileChange,
  onClose,
}: {
  profile: ProgressionProfile;
  branchNames: Record<SkillBranchId, string>;
  onProfileChange: (profile: ProgressionProfile) => void;
  onClose: () => void;
}) {
  const { t } = useLingui();
  const [totalXp, setTotalXp] = useState(profile.totalXp);
  const [respecTokens, setRespecTokens] = useState(profile.respecTokens);
  const [titleId, setTitleId] = useState(profile.equippedTitle.id);
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const levelProgress = getLevelProgress(totalXp);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  const runAction = async (action: () => Promise<ProgressionProfile>): Promise<void> => {
    setIsPending(true);
    setError(null);
    try {
      const nextProfile = await action();
      onProfileChange(nextProfile);
      setTotalXp(nextProfile.totalXp);
      setRespecTokens(nextProfile.respecTokens);
      setTitleId(nextProfile.equippedTitle.id);
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : t`Cheat command failed.`);
    } finally {
      setIsPending(false);
    }
  };

  const setLevel = (level: number): void => {
    const finiteLevel = Number.isFinite(level) ? level : 1;
    const normalizedLevel = Math.min(MAX_CHEAT_LEVEL, Math.max(1, Math.floor(finiteLevel)));
    setTotalXp(getTotalXpForLevel(normalizedLevel));
  };

  const setBranchRanks = (branch: SkillBranchId, mode: "max" | "clear"): void => {
    void runAction(() => progression.setCheatSkillRanks(mode, branch));
  };

  return (
    <div
      className="fixed inset-0 z-50 overflow-y-auto bg-black/85 px-4 py-8 backdrop-blur-md"
      role="dialog"
      aria-modal="true"
      aria-label={t`Secret progression cheat console`}
    >
      <div className="mx-auto w-full max-w-4xl overflow-hidden rounded-3xl border border-amber-300/40 bg-zinc-950 shadow-[0_0_100px_rgba(245,158,11,0.2)]">
        <header className="border-b border-amber-300/20 bg-gradient-to-r from-amber-500/15 via-fuchsia-500/10 to-violet-500/15 p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="font-mono text-xs uppercase tracking-[0.35em] text-amber-200">
                🎭 <Trans>Unauthorized progression console</Trans>
              </p>
              <h2 className="mt-2 text-3xl font-black text-white">
                <Trans>Reality Override</Trans>
              </h2>
              <p className="mt-2 text-sm text-zinc-300">
                <Trans>
                  Changes are temporary, solo-only, and earn no XP. Multiplayer always uses your
                  genuine profile.
                </Trans>
              </p>
            </div>
            <button
              type="button"
              className="rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-sm hover:bg-white/10"
              onClick={onClose}
            >
              <Trans>Close</Trans>
            </button>
          </div>
        </header>

        <div className="grid gap-5 p-6 lg:grid-cols-2">
          <section className="rounded-2xl border border-white/10 bg-white/5 p-5">
            <h3 className="text-xl font-black">
              <Trans>Level forge</Trans>
            </h3>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <label className="text-sm text-zinc-300">
                <Trans>Level</Trans>
                <input
                  type="number"
                  min={1}
                  max={MAX_CHEAT_LEVEL}
                  value={levelProgress.level}
                  onChange={(event) => setLevel(Number(event.target.value))}
                  className="mt-1 w-full rounded-xl border border-white/15 bg-black/40 px-3 py-2 text-white"
                />
              </label>
              <label className="text-sm text-zinc-300">
                <Trans>Total XP</Trans>
                <input
                  type="number"
                  min={0}
                  max={MAX_CHEAT_XP}
                  value={totalXp}
                  onChange={(event) => {
                    const parsedXp = Number(event.target.value);
                    const finiteXp = Number.isFinite(parsedXp) ? parsedXp : 0;
                    setTotalXp(Math.min(MAX_CHEAT_XP, Math.max(0, Math.floor(finiteXp))));
                  }}
                  className="mt-1 w-full rounded-xl border border-white/15 bg-black/40 px-3 py-2 text-white"
                />
              </label>
              <label className="text-sm text-zinc-300">
                <Trans>Respec tokens</Trans>
                <input
                  type="number"
                  min={0}
                  max={999}
                  value={respecTokens}
                  onChange={(event) =>
                    setRespecTokens(
                      Math.min(999, Math.max(0, Math.floor(Number(event.target.value))))
                    )
                  }
                  className="mt-1 w-full rounded-xl border border-white/15 bg-black/40 px-3 py-2 text-white"
                />
              </label>
              <label className="text-sm text-zinc-300">
                <Trans>Title</Trans>
                <select
                  value={titleId}
                  onChange={(event) => setTitleId(event.target.value)}
                  className="mt-1 w-full rounded-xl border border-white/15 bg-zinc-950 px-3 py-2 text-white"
                >
                  {profile.unlockedTitles.map((title) => (
                    <option key={title.id} value={title.id}>
                      {title.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="mt-4 grid grid-cols-5 gap-2">
              {[1, 10, 100, 500, 1000].map((preset) => (
                <button
                  key={preset}
                  type="button"
                  className="rounded-lg border border-violet-300/25 bg-violet-500/10 px-2 py-2 text-xs text-violet-100 hover:bg-violet-500/20"
                  onClick={() =>
                    setLevel(preset === 1 || preset === 10 ? levelProgress.level + preset : preset)
                  }
                >
                  {preset === 1 || preset === 10 ? `+${preset}` : preset}
                </button>
              ))}
            </div>
            <button
              type="button"
              disabled={isPending}
              className="mt-4 w-full rounded-xl border border-amber-300/40 bg-amber-500/15 px-4 py-3 font-bold text-amber-100 disabled:opacity-40"
              onClick={() =>
                void runAction(() =>
                  progression.setCheatProgress({ totalXp, respecTokens, titleId })
                )
              }
            >
              <Trans>Apply progression override</Trans>
            </button>
          </section>

          <section className="rounded-2xl border border-white/10 bg-white/5 p-5">
            <h3 className="text-xl font-black">
              <Trans>Skill laboratory</Trans>
            </h3>
            <div className="mt-4 space-y-2">
              {SKILL_BRANCH_ORDER.map((branch) => (
                <div
                  key={branch}
                  className="flex items-center justify-between gap-3 rounded-xl border border-white/8 bg-black/25 p-3"
                >
                  <span className="text-sm font-semibold">
                    {BRANCH_VISUALS[branch].icon} {branchNames[branch]}
                  </span>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={isPending}
                      className="rounded-lg border border-emerald-300/25 bg-emerald-500/10 px-3 py-1 text-xs text-emerald-100"
                      onClick={() => setBranchRanks(branch, "max")}
                    >
                      <Trans>Max</Trans>
                    </button>
                    <button
                      type="button"
                      disabled={isPending}
                      className="rounded-lg border border-rose-300/25 bg-rose-500/10 px-3 py-1 text-xs text-rose-100"
                      onClick={() => setBranchRanks(branch, "clear")}
                    >
                      <Trans>Clear</Trans>
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <button
                type="button"
                disabled={isPending}
                className="rounded-xl border border-emerald-300/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-100"
                onClick={() => void runAction(() => progression.setCheatSkillRanks("max"))}
              >
                <Trans>Max all skills</Trans>
              </button>
              <button
                type="button"
                disabled={isPending}
                className="rounded-xl border border-rose-300/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-100"
                onClick={() => void runAction(() => progression.setCheatSkillRanks("clear"))}
              >
                <Trans>Clear all skills</Trans>
              </button>
              <button
                type="button"
                disabled={isPending}
                className="rounded-xl border border-emerald-300/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-100"
                onClick={() => void runAction(() => progression.setAllSkillsEnabled(true))}
              >
                <Trans>Activate all</Trans>
              </button>
              <button
                type="button"
                disabled={isPending}
                className="rounded-xl border border-rose-300/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-100"
                onClick={() => void runAction(() => progression.setAllSkillsEnabled(false))}
              >
                <Trans>Deactivate all</Trans>
              </button>
            </div>
          </section>

          <section className="rounded-2xl border border-fuchsia-300/25 bg-fuchsia-500/8 p-5 lg:col-span-2">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <h3 className="text-xl font-black">
                  <Trans>One-click mayhem</Trans>
                </h3>
                <p className="mt-1 text-sm text-zinc-300">
                  <Trans>
                    Level 1000, every authored skill and title, 99 respec tokens, everything active.
                  </Trans>
                </p>
              </div>
              <button
                type="button"
                disabled={isPending}
                className="rounded-xl border border-fuchsia-300/40 bg-fuchsia-500/15 px-5 py-3 font-black text-fuchsia-100"
                onClick={() => void runAction(progression.applyCheatCompletionistPreset)}
              >
                <Trans>Become completionist</Trans>
              </button>
            </div>
          </section>

          <section className="rounded-2xl border border-amber-300/20 bg-amber-500/8 p-5 lg:col-span-2">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <p className="text-sm text-amber-100">
                <Trans>
                  Genuine state: Level {profile.genuineLevel} · {profile.genuineTotalXp} XP. Reset
                  discards every temporary change but keeps this console open.
                </Trans>
              </p>
              <button
                type="button"
                disabled={isPending}
                className="rounded-xl border border-amber-300/40 bg-amber-500/15 px-4 py-2 font-bold text-amber-100"
                onClick={() => void runAction(progression.resetCheatProfile)}
              >
                <Trans>Reset to genuine profile</Trans>
              </button>
            </div>
          </section>
          {error && (
            <p className="rounded-xl border border-rose-300/30 bg-rose-500/10 p-3 text-rose-100 lg:col-span-2">
              {error}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
