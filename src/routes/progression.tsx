import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Trans, useLingui } from "@lingui/react/macro";
import { AnimatedBackground } from "../components/AnimatedBackground";
import {
  CHEAT_MODE_ENABLED_EVENT,
  CHEAT_MODE_ENABLED_KEY,
  normalizeCheatModeEnabled,
} from "../constants/experimentalFeatures";
import {
  getLevelProgress,
  getProgressionTitleDisplayName,
  getRequiredBranchRanks,
  getTotalXpForLevel,
  MAX_CHEAT_LEVEL,
  MAX_CHEAT_XP,
  SKILL_LIBRARY,
  type SkillBranchId,
} from "../game/progression";
import { useSfwMode } from "../hooks/useSfwMode";
import { progression, type ProgressionProfile } from "../services/progression";
import { trpc } from "../services/trpc";

const BRANCHES: ReadonlyArray<{ id: SkillBranchId; name: string; icon: string }> = [
  { id: "control", name: "Control", icon: "⏸" },
  { id: "dicecraft", name: "Dicecraft", icon: "🎲" },
  { id: "economy", name: "Economy", icon: "💰" },
  { id: "fortune", name: "Fortune", icon: "✨" },
  { id: "defense", name: "Defense", icon: "🛡" },
  { id: "endurance", name: "Endurance", icon: "🔥" },
  { id: "scoring", name: "Scoring", icon: "🏆" },
  { id: "arsenal", name: "Starter Arsenal", icon: "🎒" },
];

export const Route = createFileRoute("/progression")({
  loader: () => progression.getProfile(),
  component: ProgressionRoute,
});

export function ProgressionRoute() {
  const navigate = useNavigate();
  const { t } = useLingui();
  const safeMode = useSfwMode();
  const initialProfile = Route.useLoaderData() as ProgressionProfile;
  const [profile, setProfile] = useState(initialProfile);
  const [pendingSkillId, setPendingSkillId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cheatModeEnabled, setCheatModeEnabled] = useState(false);
  const [isCheatConsoleOpen, setIsCheatConsoleOpen] = useState(false);
  const levelProgress = getLevelProgress(profile.totalXp);
  const disabledSkillIds = useMemo(
    () => new Set(profile.disabledSkillIds),
    [profile.disabledSkillIds]
  );
  const rankByBranch = useMemo(
    () =>
      Object.fromEntries(
        BRANCHES.map((branch) => [
          branch.id,
          SKILL_LIBRARY.filter((skill) => skill.branch === branch.id).reduce(
            (total, skill) => total + (profile.skillRanks[skill.id] ?? 0),
            0
          ),
        ])
      ) as Record<SkillBranchId, number>,
    [profile.skillRanks]
  );

  useEffect(() => {
    let mounted = true;
    void trpc.store.get
      .query({ key: CHEAT_MODE_ENABLED_KEY })
      .then((value) => {
        if (mounted) setCheatModeEnabled(normalizeCheatModeEnabled(value));
      })
      .catch((readError: unknown) => {
        console.warn("Failed to read Cheat Mode for progression.", readError);
      });
    const handleCheatModeChange = (event: Event): void => {
      const enabled = (event as CustomEvent<boolean>).detail;
      setCheatModeEnabled(enabled);
      if (enabled) return;
      setIsCheatConsoleOpen(false);
      void progression
        .getProfile()
        .then(setProfile)
        .catch((profileError: unknown) => {
          console.warn("Failed to restore genuine progression profile.", profileError);
        });
    };
    window.addEventListener(CHEAT_MODE_ENABLED_EVENT, handleCheatModeChange);
    return () => {
      mounted = false;
      window.removeEventListener(CHEAT_MODE_ENABLED_EVENT, handleCheatModeChange);
    };
  }, []);

  const openCheatConsole = () => {
    setError(null);
    void progression
      .activateCheatProfile()
      .then((nextProfile) => {
        setProfile(nextProfile);
        setIsCheatConsoleOpen(true);
      })
      .catch((activationError: unknown) => {
        setError(
          activationError instanceof Error
            ? activationError.message
            : t`Failed to activate the cheat profile.`
        );
      });
  };

  const purchaseSkill = async (skillId: string) => {
    setPendingSkillId(skillId);
    setError(null);
    try {
      setProfile(await progression.purchaseSkill(skillId));
    } catch (purchaseError) {
      setError(
        purchaseError instanceof Error ? purchaseError.message : t`Failed to purchase skill.`
      );
    } finally {
      setPendingSkillId(null);
    }
  };

  const respec = async () => {
    if (!window.confirm(t`Spend one respec token and refund every skill point?`)) return;
    setError(null);
    try {
      setProfile(await progression.respec());
    } catch (respecError) {
      setError(respecError instanceof Error ? respecError.message : t`Failed to respec skills.`);
    }
  };

  const setSkillEnabled = async (skillId: string, enabled: boolean) => {
    setPendingSkillId(skillId);
    setError(null);
    try {
      setProfile(await progression.setSkillEnabled(skillId, enabled));
    } catch (activationError) {
      setError(
        activationError instanceof Error
          ? activationError.message
          : t`Failed to update skill activation.`
      );
    } finally {
      setPendingSkillId(null);
    }
  };

  const setAllSkillsEnabled = async (enabled: boolean) => {
    setPendingSkillId("__all__");
    setError(null);
    try {
      setProfile(await progression.setAllSkillsEnabled(enabled));
    } catch (activationError) {
      setError(
        activationError instanceof Error
          ? activationError.message
          : t`Failed to update skill activation.`
      );
    } finally {
      setPendingSkillId(null);
    }
  };

  return (
    <div className="relative min-h-screen overflow-hidden text-zinc-100">
      <AnimatedBackground />
      <main className="relative z-10 h-screen overflow-y-auto px-4 py-8 sm:px-8">
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 pb-16">
          <header className="rounded-3xl border border-violet-300/30 bg-zinc-950/75 p-6 backdrop-blur-xl">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <div className="mb-4 flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="rounded-xl border border-white/15 bg-white/5 px-4 py-2 text-sm hover:bg-white/10"
                    onClick={() => void navigate({ to: "/" })}
                  >
                    ← <Trans>Main Menu</Trans>
                  </button>
                  {cheatModeEnabled && (
                    <button
                      type="button"
                      className="rounded-xl border border-amber-300/40 bg-amber-500/15 px-4 py-2 text-sm font-bold text-amber-100 hover:bg-amber-500/25"
                      onClick={openCheatConsole}
                    >
                      🎭 <Trans>Cheat console</Trans>
                    </button>
                  )}
                </div>
                <p className="font-mono text-xs uppercase tracking-[0.35em] text-violet-300">
                  <Trans>Infinite Progression</Trans>
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-3">
                  <h1 className="text-4xl font-black sm:text-6xl">
                    <Trans>Level {profile.level}</Trans>
                  </h1>
                  {profile.isCheated && (
                    <span
                      className="rounded-full border border-amber-300/50 bg-amber-500/15 px-3 py-1 font-mono text-xs font-black uppercase tracking-[0.2em] text-amber-100"
                      title={t`This is a temporary cheated progression level.`}
                    >
                      🎭 <Trans>Cheated</Trans>
                    </span>
                  )}
                </div>
                <p className="mt-2 text-zinc-300">
                  {getProgressionTitleDisplayName(profile.equippedTitle, safeMode)} ·{" "}
                  {profile.unspentSkillPoints} <Trans>skill points available</Trans>
                </p>
                {profile.isCheated && (
                  <p className="mt-2 text-sm text-amber-200">
                    <Trans>
                      Genuine profile: Level {profile.genuineLevel} · {profile.genuineTotalXp} XP
                    </Trans>
                  </p>
                )}
              </div>
              <div className="min-w-72 rounded-2xl border border-violet-300/25 bg-black/35 p-4">
                <div className="flex justify-between text-sm">
                  <span>
                    {levelProgress.currentLevelXp} / {levelProgress.xpToNextLevel} XP
                  </span>
                  <span>{profile.totalXp} total</span>
                </div>
                <div className="mt-3 h-3 overflow-hidden rounded-full bg-zinc-800">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-400"
                    style={{
                      width: `${Math.min(
                        100,
                        (levelProgress.currentLevelXp / levelProgress.xpToNextLevel) * 100
                      )}%`,
                    }}
                  />
                </div>
                <label className="mt-4 block text-xs uppercase tracking-wider text-zinc-400">
                  <Trans>Equipped title</Trans>
                  <select
                    className="mt-2 w-full rounded-xl border border-white/15 bg-zinc-950 px-3 py-2 text-zinc-100"
                    value={profile.equippedTitle.id}
                    onChange={(event) => {
                      void progression
                        .equipTitle(event.target.value)
                        .then(setProfile)
                        .catch((equipError: unknown) => {
                          setError(
                            equipError instanceof Error
                              ? equipError.message
                              : t`Failed to equip title.`
                          );
                        });
                    }}
                  >
                    {profile.unlockedTitles.map((title) => (
                      <option key={title.id} value={title.id}>
                        {getProgressionTitleDisplayName(title, safeMode)} · Lv.{" "}
                        {title.requiredLevel}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  className="mt-3 w-full rounded-xl border border-amber-300/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-100 disabled:opacity-40"
                  disabled={profile.respecTokens < 1 || profile.spentSkillPoints === 0}
                  onClick={() => void respec()}
                >
                  <Trans>Respec ({profile.respecTokens} tokens)</Trans>
                </button>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    className="rounded-xl border border-rose-300/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-100 disabled:opacity-40"
                    disabled={profile.spentSkillPoints === 0 || pendingSkillId !== null}
                    onClick={() => void setAllSkillsEnabled(false)}
                  >
                    <Trans>Deactivate all</Trans>
                  </button>
                  <button
                    type="button"
                    className="rounded-xl border border-emerald-300/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-100 disabled:opacity-40"
                    disabled={profile.disabledSkillRanks === 0 || pendingSkillId !== null}
                    onClick={() => void setAllSkillsEnabled(true)}
                  >
                    <Trans>Activate all</Trans>
                  </button>
                </div>
                <p className="mt-3 text-center font-mono text-xs uppercase tracking-wider text-fuchsia-200">
                  <Trans>
                    +{profile.skillDeactivationXpBonusPercent}% solo XP ·{" "}
                    {profile.disabledSkillRanks} disabled ranks
                  </Trans>
                </p>
              </div>
            </div>
            {error && (
              <p className="mt-4 rounded-xl border border-rose-300/30 bg-rose-500/10 px-4 py-3 text-rose-100">
                {error}
              </p>
            )}
          </header>

          <section className="grid gap-5 lg:grid-cols-2">
            {BRANCHES.map((branch) => (
              <article
                key={branch.id}
                className="rounded-3xl border border-white/10 bg-zinc-950/70 p-5 backdrop-blur-xl"
              >
                <div className="mb-4 flex items-center justify-between">
                  <h2 className="text-2xl font-black">
                    {branch.icon} {branch.name}
                  </h2>
                  <span className="rounded-full bg-white/5 px-3 py-1 font-mono text-xs">
                    {rankByBranch[branch.id]} ranks
                  </span>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  {SKILL_LIBRARY.filter((skill) => skill.branch === branch.id).map((skill) => {
                    const rank = profile.skillRanks[skill.id] ?? 0;
                    const isPurchased = rank > 0;
                    const isDisabled = disabledSkillIds.has(skill.id);
                    const requiredBranchRanks =
                      branch.id === "arsenal"
                        ? (SKILL_LIBRARY.filter((entry) => entry.branch === "arsenal").findIndex(
                            (entry) => entry.id === skill.id
                          ) +
                            1) *
                          5
                        : getRequiredBranchRanks(skill.tier);
                    const unlocked =
                      branch.id === "arsenal"
                        ? profile.spentSkillPoints >= requiredBranchRanks
                        : rankByBranch[branch.id] >= requiredBranchRanks;
                    const canBuy =
                      unlocked &&
                      rank < skill.maxRank &&
                      profile.unspentSkillPoints > 0 &&
                      pendingSkillId === null;
                    return (
                      <div
                        key={skill.id}
                        className={`relative overflow-hidden rounded-2xl border transition ${
                          isDisabled
                            ? "border-rose-300/30 bg-rose-500/8 opacity-70"
                            : rank >= skill.maxRank
                              ? "border-emerald-300/35 bg-emerald-500/10"
                              : unlocked
                                ? "border-violet-300/25 bg-violet-500/8 hover:bg-violet-500/15"
                                : "border-white/5 bg-black/25 opacity-55"
                        }`}
                      >
                        <button
                          type="button"
                          disabled={!canBuy}
                          onClick={() => void purchaseSkill(skill.id)}
                          className="w-full p-4 pb-12 text-left disabled:cursor-not-allowed"
                          aria-label={`${skill.name}: purchase rank`}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <span className="font-bold">{skill.name}</span>
                            <span className="font-mono text-xs">
                              {rank}/{skill.maxRank}
                            </span>
                          </div>
                          <p className="mt-2 text-sm text-zinc-400">{skill.description}</p>
                          {!unlocked && (
                            <p className="mt-2 text-xs text-amber-200">
                              {branch.id === "arsenal"
                                ? `${requiredBranchRanks} total ranks required`
                                : `${requiredBranchRanks} branch ranks required`}
                            </p>
                          )}
                        </button>
                        {isPurchased && (
                          <button
                            type="button"
                            className={`absolute inset-x-3 bottom-3 rounded-lg border px-2 py-1 text-xs font-bold ${
                              isDisabled
                                ? "border-emerald-300/30 bg-emerald-500/10 text-emerald-100"
                                : "border-rose-300/30 bg-rose-500/10 text-rose-100"
                            } disabled:opacity-40`}
                            disabled={pendingSkillId !== null}
                            onClick={() => void setSkillEnabled(skill.id, isDisabled)}
                            aria-pressed={!isDisabled}
                            aria-label={
                              isDisabled ? t`Activate ${skill.name}` : t`Deactivate ${skill.name}`
                            }
                          >
                            {isDisabled ? (
                              <Trans>Activate skill</Trans>
                            ) : (
                              <Trans>Deactivate skill</Trans>
                            )}
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </article>
            ))}
          </section>
        </div>
      </main>
      {isCheatConsoleOpen && (
        <ProgressionCheatConsole
          profile={profile}
          onProfileChange={setProfile}
          onClose={() => setIsCheatConsoleOpen(false)}
        />
      )}
    </div>
  );
}

function ProgressionCheatConsole({
  profile,
  onProfileChange,
  onClose,
}: {
  profile: ProgressionProfile;
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
              {BRANCHES.map((branch) => (
                <div
                  key={branch.id}
                  className="flex items-center justify-between gap-3 rounded-xl border border-white/8 bg-black/25 p-3"
                >
                  <span className="text-sm font-semibold">
                    {branch.icon} {branch.name}
                  </span>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={isPending}
                      className="rounded-lg border border-emerald-300/25 bg-emerald-500/10 px-3 py-1 text-xs text-emerald-100"
                      onClick={() => setBranchRanks(branch.id, "max")}
                    >
                      <Trans>Max</Trans>
                    </button>
                    <button
                      type="button"
                      disabled={isPending}
                      className="rounded-lg border border-rose-300/25 bg-rose-500/10 px-3 py-1 text-xs text-rose-100"
                      onClick={() => setBranchRanks(branch.id, "clear")}
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
