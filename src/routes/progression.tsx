import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { Trans, useLingui } from "@lingui/react/macro";
import { AnimatedBackground } from "../components/AnimatedBackground";
import {
  CHEAT_MODE_ENABLED_EVENT,
  CHEAT_MODE_ENABLED_KEY,
  normalizeCheatModeEnabled,
} from "../constants/experimentalFeatures";
import {
  SKILL_LIBRARY,
  getLevelProgress,
  getProgressionTitleDisplayName,
  type SkillBranchId,
} from "../game/progression";
import { useSfwMode } from "../hooks/useSfwMode";
import { progression, type ProgressionProfile } from "../services/progression";
import { trpc } from "../services/trpc";
import { ProgressionCheatConsole } from "../features/progression/ProgressionCheatConsole";
import { SkillDetailPanel } from "../features/progression/SkillDetailPanel";
import { SkillTreeCanvas, type CameraRequest } from "../features/progression/SkillTreeCanvas";
import {
  BRANCH_VISUALS,
  SKILL_BRANCH_ORDER,
  buildSkillTreeLayout,
  getBranchMaxRanks,
  getBranchRanks,
  getDefaultSelectedSkillId,
} from "../features/progression/skillTree";

const TREE_LAYOUT = buildSkillTreeLayout();
const BRANCH_MAX_RANKS = getBranchMaxRanks();
const OVERVIEW_CAMERA = { x: 0, y: 0, scale: 1 };
// scale 0 asks the canvas for its container-aware default framing.
const DEFAULT_CAMERA = { x: 0, y: 0, scale: 0 };

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
  const [hoveredBranch, setHoveredBranch] = useState<SkillBranchId | null>(null);
  const [burstSkillId, setBurstSkillId] = useState<string | null>(null);
  const [cameraRequest, setCameraRequest] = useState<CameraRequest>({
    ...DEFAULT_CAMERA,
    nonce: 0,
  });
  const cameraNonce = useRef(0);

  const branchNames = useBranchNames();
  const levelProgress = getLevelProgress(profile.totalXp);
  const levelRatio = levelProgress.currentLevelXp / Math.max(1, levelProgress.xpToNextLevel);
  const disabledSkillIds = useMemo(
    () => new Set(profile.disabledSkillIds),
    [profile.disabledSkillIds]
  );
  const branchRanks = useMemo(() => getBranchRanks(profile.skillRanks), [profile.skillRanks]);
  const [selectedSkillId, setSelectedSkillId] = useState(() =>
    getDefaultSelectedSkillId(initialProfile.skillRanks, {
      branchRanks: getBranchRanks(initialProfile.skillRanks),
      spentSkillPoints: initialProfile.spentSkillPoints,
    })
  );
  const selectedSkill =
    SKILL_LIBRARY.find((entry) => entry.id === selectedSkillId) ?? SKILL_LIBRARY[0]!;

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

  useEffect(() => {
    if (!burstSkillId) return;
    const timeout = window.setTimeout(() => setBurstSkillId(null), 700);
    return () => window.clearTimeout(timeout);
  }, [burstSkillId]);

  const moveCamera = (target: { x: number; y: number; scale: number }): void => {
    cameraNonce.current += 1;
    setCameraRequest({ ...target, nonce: cameraNonce.current });
  };

  const focusBranch = (branch: SkillBranchId): void => {
    const layout = TREE_LAYOUT.branches.find((entry) => entry.id === branch);
    if (!layout) return;
    moveCamera({ x: layout.focusX, y: layout.focusY, scale: 1.55 });
  };

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
      setBurstSkillId(skillId);
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
    <div className="relative h-screen overflow-hidden text-zinc-100">
      <AnimatedBackground />
      <main className="relative z-10 flex h-screen flex-col gap-3 p-3 sm:p-4">
        <header className="flex flex-wrap items-center gap-3 rounded-3xl border border-violet-300/25 bg-zinc-950/80 px-4 py-3 backdrop-blur-xl">
          <button
            type="button"
            className="rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-sm hover:bg-white/10"
            onClick={() => void navigate({ to: "/" })}
          >
            ← <Trans>Main Menu</Trans>
          </button>

          <div className="flex items-center gap-3">
            <LevelSigil level={profile.level} ratio={levelRatio} cheated={profile.isCheated} />
            <div className="min-w-0">
              <p className="font-mono text-[10px] uppercase tracking-[0.35em] text-violet-300">
                <Trans>Skill Tree</Trans>
              </p>
              <select
                className="mt-1 max-w-[15rem] rounded-lg border border-white/15 bg-zinc-950 px-2 py-1 text-sm font-bold text-zinc-100"
                aria-label={t`Equipped title`}
                value={profile.equippedTitle.id}
                onChange={(event) => {
                  void progression
                    .equipTitle(event.target.value)
                    .then(setProfile)
                    .catch((equipError: unknown) => {
                      setError(
                        equipError instanceof Error ? equipError.message : t`Failed to equip title.`
                      );
                    });
                }}
              >
                {profile.unlockedTitles.map((title) => (
                  <option key={title.id} value={title.id}>
                    {getProgressionTitleDisplayName(title, safeMode)} · Lv. {title.requiredLevel}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="min-w-[14rem] flex-1">
            <div className="flex justify-between font-mono text-[11px] text-zinc-400">
              <span>
                {levelProgress.currentLevelXp} / {levelProgress.xpToNextLevel} XP
              </span>
              <span className="text-zinc-500">
                <Trans>{profile.totalXp} total</Trans>
              </span>
              <span className="text-violet-300">
                <Trans>→ Lv. {profile.level + 1}</Trans>
              </span>
            </div>
            <div className="mt-1.5 h-2.5 overflow-hidden rounded-full border border-white/10 bg-black/60">
              <div
                className="skill-xp-fill h-full rounded-full bg-gradient-to-r from-violet-500 via-fuchsia-400 to-violet-300"
                style={{ width: `${Math.min(100, levelRatio * 100)}%` }}
              />
            </div>
          </div>

          <div
            className={`rounded-2xl border px-4 py-2 text-center ${
              profile.unspentSkillPoints > 0
                ? "skill-points-ready border-amber-300/60 bg-amber-500/15 text-amber-100"
                : "border-white/10 bg-white/5 text-zinc-400"
            }`}
          >
            <p className="text-2xl font-black leading-none">{profile.unspentSkillPoints}</p>
            <p className="mt-1 font-mono text-[9px] uppercase tracking-[0.2em]">
              <Trans>points</Trans>
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="rounded-xl border border-amber-300/30 bg-amber-500/10 px-3 py-2 text-xs font-bold text-amber-100 disabled:opacity-40"
              disabled={profile.respecTokens < 1 || profile.spentSkillPoints === 0}
              onClick={() => void respec()}
            >
              ♻ <Trans>Respec ({profile.respecTokens})</Trans>
            </button>
            <button
              type="button"
              className="rounded-xl border border-rose-300/30 bg-rose-500/10 px-3 py-2 text-xs font-bold text-rose-100 disabled:opacity-40"
              disabled={profile.spentSkillPoints === 0 || pendingSkillId !== null}
              onClick={() => void setAllSkillsEnabled(false)}
            >
              <Trans>Deactivate all</Trans>
            </button>
            <button
              type="button"
              className="rounded-xl border border-emerald-300/30 bg-emerald-500/10 px-3 py-2 text-xs font-bold text-emerald-100 disabled:opacity-40"
              disabled={profile.disabledSkillRanks === 0 || pendingSkillId !== null}
              onClick={() => void setAllSkillsEnabled(true)}
            >
              <Trans>Activate all</Trans>
            </button>
            {cheatModeEnabled && (
              <button
                type="button"
                className="rounded-xl border border-amber-300/40 bg-amber-500/15 px-3 py-2 text-xs font-bold text-amber-100 hover:bg-amber-500/25"
                onClick={openCheatConsole}
              >
                🎭 <Trans>Cheat console</Trans>
              </button>
            )}
          </div>
        </header>

        {error && (
          <p className="rounded-2xl border border-rose-300/30 bg-rose-500/10 px-4 py-2 text-sm text-rose-100">
            {error}
          </p>
        )}

        <div className="flex min-h-0 flex-1 flex-col gap-3 lg:flex-row">
          <nav className="hidden w-52 shrink-0 flex-col gap-1.5 overflow-y-auto rounded-3xl border border-white/10 bg-zinc-950/70 p-2.5 backdrop-blur-xl lg:flex">
            <button
              type="button"
              className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-bold uppercase tracking-widest text-zinc-300 hover:bg-white/10"
              onClick={() => moveCamera(OVERVIEW_CAMERA)}
            >
              🜲 <Trans>Full tree</Trans>
            </button>
            {SKILL_BRANCH_ORDER.map((branch) => {
              const visual = BRANCH_VISUALS[branch];
              const ranks = branchRanks[branch];
              const maxRanks = BRANCH_MAX_RANKS[branch];
              const isActive = hoveredBranch === branch;
              return (
                <button
                  key={branch}
                  type="button"
                  onClick={() => focusBranch(branch)}
                  onPointerEnter={() => setHoveredBranch(branch)}
                  onPointerLeave={() => setHoveredBranch(null)}
                  onFocus={() => setHoveredBranch(branch)}
                  onBlur={() => setHoveredBranch(null)}
                  className={`rounded-xl border px-3 py-2 text-left transition ${
                    isActive ? visual.railActive : "border-white/10 bg-black/30 hover:bg-white/10"
                  }`}
                >
                  <span className="flex items-center justify-between gap-2 text-sm font-bold">
                    <span className={isActive ? visual.railText : "text-zinc-200"}>
                      {visual.icon} {branchNames[branch]}
                    </span>
                    <span className="font-mono text-[10px] text-zinc-400">
                      {ranks}/{maxRanks}
                    </span>
                  </span>
                  <span className="mt-1.5 block h-1.5 overflow-hidden rounded-full bg-white/10">
                    <span
                      className="block h-full rounded-full"
                      style={{
                        width: `${(ranks / maxRanks) * 100}%`,
                        background: visual.accent,
                        boxShadow: ranks > 0 ? `0 0 8px ${visual.accent}` : undefined,
                      }}
                    />
                  </span>
                </button>
              );
            })}
            <div className="mt-auto rounded-xl border border-white/10 bg-black/40 p-3 text-[11px] text-zinc-400">
              <p>
                <Trans>Spent: {profile.spentSkillPoints}</Trans>
              </p>
              <p className="mt-1 text-fuchsia-200">
                <Trans>
                  +{profile.skillDeactivationXpBonusPercent}% solo XP from{" "}
                  {profile.disabledSkillRanks} muted ranks
                </Trans>
              </p>
            </div>
          </nav>

          <div className="min-w-0 flex-1">
            <SkillTreeCanvas
              layout={TREE_LAYOUT}
              skillRanks={profile.skillRanks}
              disabledSkillIds={disabledSkillIds}
              branchRanks={branchRanks}
              spentSkillPoints={profile.spentSkillPoints}
              unspentSkillPoints={profile.unspentSkillPoints}
              branchNames={branchNames}
              level={profile.level}
              levelRatio={levelRatio}
              selectedSkillId={selectedSkillId}
              hoveredBranch={hoveredBranch}
              burstSkillId={burstSkillId}
              cameraRequest={cameraRequest}
              onSelectSkill={setSelectedSkillId}
              onPurchaseSkill={(skillId) => void purchaseSkill(skillId)}
              onRecenter={() => moveCamera(DEFAULT_CAMERA)}
            />
          </div>

          <div className="max-h-[42vh] w-full shrink-0 lg:max-h-none lg:w-[20rem] xl:w-[22rem]">
            <SkillDetailPanel
              skill={selectedSkill}
              rank={profile.skillRanks[selectedSkill.id] ?? 0}
              isDisabled={disabledSkillIds.has(selectedSkill.id)}
              branchRanks={branchRanks}
              spentSkillPoints={profile.spentSkillPoints}
              unspentSkillPoints={profile.unspentSkillPoints}
              branchName={branchNames[selectedSkill.branch]}
              isBusy={pendingSkillId !== null}
              onPurchase={(skillId) => void purchaseSkill(skillId)}
              onToggleEnabled={(skillId, enabled) => void setSkillEnabled(skillId, enabled)}
            />
          </div>
        </div>
      </main>
      {isCheatConsoleOpen && (
        <ProgressionCheatConsole
          profile={profile}
          branchNames={branchNames}
          onProfileChange={setProfile}
          onClose={() => setIsCheatConsoleOpen(false)}
        />
      )}
    </div>
  );
}

function useBranchNames(): Record<SkillBranchId, string> {
  const { t } = useLingui();
  return {
    control: t`Control`,
    dicecraft: t`Dicecraft`,
    economy: t`Economy`,
    fortune: t`Fortune`,
    defense: t`Defense`,
    endurance: t`Endurance`,
    scoring: t`Scoring`,
    arsenal: t`Starter Arsenal`,
  };
}

function LevelSigil({ level, ratio, cheated }: { level: number; ratio: number; cheated: boolean }) {
  const { t } = useLingui();
  const radius = 20;
  const circumference = 2 * Math.PI * radius;
  return (
    <div
      className="relative h-14 w-14 shrink-0"
      title={cheated ? t`This is a temporary cheated progression level.` : undefined}
    >
      <svg viewBox="-28 -28 56 56" className="h-full w-full -rotate-90">
        <circle r={radius} fill="rgba(6,4,16,0.9)" stroke="rgba(255,255,255,0.1)" strokeWidth={4} />
        <circle
          r={radius}
          fill="none"
          stroke={cheated ? "#fbbf24" : "#a78bfa"}
          strokeWidth={4}
          strokeLinecap="round"
          strokeDasharray={`${Math.min(1, Math.max(0, ratio)) * circumference} ${circumference}`}
        />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-lg font-black">
        {level}
      </span>
      {cheated && <span className="absolute -right-1 -top-1 text-xs">🎭</span>}
    </div>
  );
}
