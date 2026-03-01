import {
  SKILL_LIBRARY,
  getRequiredBranchRanks,
  type SkillBranchId,
  type SkillDefinition,
} from "../../game/progression";

export const SKILL_BRANCH_ORDER = [
  "control",
  "dicecraft",
  "economy",
  "fortune",
  "defense",
  "endurance",
  "scoring",
  "arsenal",
] as const satisfies readonly SkillBranchId[];

export type BranchVisual = {
  icon: string;
  /** Base hue used for edges, node rims and glows. */
  accent: string;
  /** Tailwind classes for the branch rail button when focused. */
  railActive: string;
  railText: string;
};

export const BRANCH_VISUALS: Record<SkillBranchId, BranchVisual> = {
  control: {
    icon: "⏸",
    accent: "#22d3ee",
    railActive: "border-cyan-300/60 bg-cyan-500/15",
    railText: "text-cyan-100",
  },
  dicecraft: {
    icon: "🎲",
    accent: "#a78bfa",
    railActive: "border-violet-300/60 bg-violet-500/15",
    railText: "text-violet-100",
  },
  economy: {
    icon: "💰",
    accent: "#fbbf24",
    railActive: "border-amber-300/60 bg-amber-500/15",
    railText: "text-amber-100",
  },
  fortune: {
    icon: "✨",
    accent: "#e879f9",
    railActive: "border-fuchsia-300/60 bg-fuchsia-500/15",
    railText: "text-fuchsia-100",
  },
  defense: {
    icon: "🛡",
    accent: "#60a5fa",
    railActive: "border-blue-300/60 bg-blue-500/15",
    railText: "text-blue-100",
  },
  endurance: {
    icon: "🔥",
    accent: "#fb923c",
    railActive: "border-orange-300/60 bg-orange-500/15",
    railText: "text-orange-100",
  },
  scoring: {
    icon: "🏆",
    accent: "#34d399",
    railActive: "border-emerald-300/60 bg-emerald-500/15",
    railText: "text-emerald-100",
  },
  arsenal: {
    icon: "🎒",
    accent: "#fb7185",
    railActive: "border-rose-300/60 bg-rose-500/15",
    railText: "text-rose-100",
  },
};

export const SKILL_ICONS: Readonly<Record<string, string>> = {
  "pocket-pauses": "⏸",
  "long-timeout": "⏳",
  "quick-recovery": "♻️",
  "skip-ticket": "🎫",
  "recycled-ticket": "🔁",
  "camp-refill": "🏕️",
  "emergency-stop": "🛑",
  "master-of-time": "⌛",

  "reinforced-dice": "🎲",
  "steady-hand": "✋",
  advantage: "⚖️",
  momentum: "🌀",
  "hot-streak": "🔥",
  "bounce-back": "🏓",
  "pocket-doubler": "✖️",
  "dice-sovereign": "👑",

  "nest-egg": "🥚",
  payday: "💵",
  "coupon-book": "🎟️",
  "toll-pass": "🛣️",
  "compound-interest": "📈",
  "treasure-tile": "💎",
  salvager: "🔧",
  "first-ones-free": "🎁",

  "open-hand": "🖐️",
  "treasure-sense": "🔮",
  "rare-taste": "🌟",
  mulligan: "🔄",
  "lucky-pocket": "🍀",
  serendipity: "✨",
  "bad-luck-protection": "🧿",
  "fortunes-favorite": "🌠",

  "pocket-shield": "🛡️",
  "reinforced-shield": "🧱",
  "low-profile": "🥷",
  "slow-escalation": "🐢",
  "thick-skin": "🦏",
  "camp-cleanse": "🧼",
  "hazard-pay": "💰",
  "guardian-angel": "😇",

  "slow-burn": "🕯️",
  "camp-regular": "🏕️",
  "gentle-opening": "🌱",
  "safety-valve": "🧯",
  "calm-mind": "🧘",
  "steady-pulse": "💓",
  "deep-recovery": "💤",
  unshakable: "🗿",

  "head-start": "🚀",
  finisher: "🏁",
  "interjection-hunter": "🎯",
  "living-dangerously": "☠️",
  "clutch-finish": "💥",
  "combo-artist": "🎼",
  "perfect-landing": "🎳",
  "score-sovereign": "👑",

  "arsenal-loaded-dice": "🎲",
  "arsenal-pause": "⏸",
  "arsenal-skip": "⏭️",
  "arsenal-shield": "🛡️",
  "arsenal-cleaner": "🧹",
  "arsenal-heal": "❤️",
  "arsenal-doubler": "✖️",
  "arsenal-mystery": "❓",
};

export function getSkillIcon(skill: SkillDefinition): string {
  return SKILL_ICONS[skill.id] ?? BRANCH_VISUALS[skill.branch].icon;
}

/** Every arsenal slot demands this many additional spent ranks anywhere in the tree. */
export const ARSENAL_RANKS_PER_SLOT = 5;

export const ARSENAL_SKILLS = SKILL_LIBRARY.filter((entry) => entry.branch === "arsenal");

export type SkillRequirement = {
  /** `branch` counts ranks inside the same branch, `total` counts every spent point. */
  kind: "branch" | "total";
  ranks: number;
};

export function getSkillRequirement(skill: SkillDefinition): SkillRequirement {
  if (skill.branch === "arsenal") {
    const slotIndex = ARSENAL_SKILLS.findIndex((entry) => entry.id === skill.id);
    return { kind: "total", ranks: (slotIndex + 1) * ARSENAL_RANKS_PER_SLOT };
  }
  return { kind: "branch", ranks: getRequiredBranchRanks(skill.tier) };
}

export function getBranchRanks(
  skillRanks: Readonly<Record<string, number>>
): Record<SkillBranchId, number> {
  const totals = Object.fromEntries(SKILL_BRANCH_ORDER.map((branch) => [branch, 0])) as Record<
    SkillBranchId,
    number
  >;
  for (const definition of SKILL_LIBRARY) {
    totals[definition.branch] += Math.max(0, Math.floor(skillRanks[definition.id] ?? 0));
  }
  return totals;
}

export function getBranchMaxRanks(): Record<SkillBranchId, number> {
  const totals = Object.fromEntries(SKILL_BRANCH_ORDER.map((branch) => [branch, 0])) as Record<
    SkillBranchId,
    number
  >;
  for (const definition of SKILL_LIBRARY) totals[definition.branch] += definition.maxRank;
  return totals;
}

export type SkillProgressContext = {
  branchRanks: Record<SkillBranchId, number>;
  spentSkillPoints: number;
};

export function getRequirementProgress(
  skill: SkillDefinition,
  context: SkillProgressContext
): { requirement: SkillRequirement; current: number; unlocked: boolean } {
  const requirement = getSkillRequirement(skill);
  const current =
    requirement.kind === "total" ? context.spentSkillPoints : context.branchRanks[skill.branch];
  return { requirement, current, unlocked: current >= requirement.ranks };
}

export type SkillNodeState = "locked" | "available" | "ranked" | "maxed" | "muted";

export function getSkillNodeState(
  skill: SkillDefinition,
  options: {
    rank: number;
    isDisabled: boolean;
    unlocked: boolean;
  }
): SkillNodeState {
  if (options.rank > 0 && options.isDisabled) return "muted";
  if (options.rank >= skill.maxRank) return "maxed";
  if (options.rank > 0) return "ranked";
  return options.unlocked ? "available" : "locked";
}

/* ─── Radial layout ──────────────────────────────────────────────── */

export const TREE_VIEWBOX = { minX: -950, minY: -950, size: 1900 } as const;
export const CORE_RADIUS = 104;
export const TIER_RADII = [300, 445, 590, 735] as const;
export const LANE_ANGLE_DEG = 12;
export const NODE_RADIUS = 34;
export const BRANCH_LABEL_RADIUS = 850;

const DEG_TO_RAD = Math.PI / 180;

function polar(radius: number, angleDeg: number): { x: number; y: number } {
  return {
    x: radius * Math.cos(angleDeg * DEG_TO_RAD),
    y: radius * Math.sin(angleDeg * DEG_TO_RAD),
  };
}

export type SkillNodeLayout = {
  id: string;
  skill: SkillDefinition;
  branch: SkillBranchId;
  tier: 1 | 2 | 3 | 4;
  lane: -1 | 1;
  x: number;
  y: number;
  icon: string;
};

export type SkillEdgeLayout = {
  id: string;
  branch: SkillBranchId;
  fromId: string | null;
  toId: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
};

export type BranchGateLayout = {
  id: string;
  branch: SkillBranchId;
  tier: 1 | 2 | 3 | 4;
  requirement: SkillRequirement;
  x: number;
  y: number;
};

export type BranchLayout = {
  id: SkillBranchId;
  angleDeg: number;
  labelX: number;
  labelY: number;
  focusX: number;
  focusY: number;
};

export type SkillTreeLayout = {
  nodes: SkillNodeLayout[];
  edges: SkillEdgeLayout[];
  gates: BranchGateLayout[];
  branches: BranchLayout[];
  nodeById: Map<string, SkillNodeLayout>;
};

export function buildSkillTreeLayout(): SkillTreeLayout {
  const nodes: SkillNodeLayout[] = [];
  const edges: SkillEdgeLayout[] = [];
  const gates: BranchGateLayout[] = [];
  const branches: BranchLayout[] = [];

  SKILL_BRANCH_ORDER.forEach((branch, branchIndex) => {
    const angleDeg = -90 + branchIndex * (360 / SKILL_BRANCH_ORDER.length);
    const label = polar(BRANCH_LABEL_RADIUS, angleDeg);
    const focus = polar((TIER_RADII[0] + TIER_RADII[3]) / 2, angleDeg);
    branches.push({
      id: branch,
      angleDeg,
      labelX: label.x,
      labelY: label.y,
      focusX: focus.x,
      focusY: focus.y,
    });

    const branchSkills = SKILL_LIBRARY.filter((entry) => entry.branch === branch);
    const byTier = new Map<number, SkillNodeLayout[]>();

    for (const skill of branchSkills) {
      const tierNodes = byTier.get(skill.tier) ?? [];
      const lane: -1 | 1 = tierNodes.length === 0 ? -1 : 1;
      const position = polar(TIER_RADII[skill.tier - 1], angleDeg + lane * LANE_ANGLE_DEG);
      const node: SkillNodeLayout = {
        id: skill.id,
        skill,
        branch,
        tier: skill.tier,
        lane,
        x: position.x,
        y: position.y,
        icon: getSkillIcon(skill),
      };
      tierNodes.push(node);
      byTier.set(skill.tier, tierNodes);
      nodes.push(node);
    }

    for (const tier of [1, 2, 3, 4] as const) {
      const tierNodes = byTier.get(tier) ?? [];
      const previousNodes = tier === 1 ? null : (byTier.get(tier - 1) ?? []);

      for (const node of tierNodes) {
        if (!previousNodes) {
          const start = polar(CORE_RADIUS, angleDeg);
          edges.push({
            id: `core-${node.id}`,
            branch,
            fromId: null,
            toId: node.id,
            x1: start.x,
            y1: start.y,
            x2: node.x,
            y2: node.y,
          });
          continue;
        }
        for (const previous of previousNodes) {
          edges.push({
            id: `${previous.id}-${node.id}`,
            branch,
            fromId: previous.id,
            toId: node.id,
            x1: previous.x,
            y1: previous.y,
            x2: node.x,
            y2: node.y,
          });
        }
      }

      const gateSkill = tierNodes[0]?.skill;
      if (!gateSkill) continue;
      const requirement = getSkillRequirement(gateSkill);
      if (requirement.ranks <= 0) continue;
      const innerRadius = tier === 1 ? CORE_RADIUS : TIER_RADII[tier - 2];
      const gatePosition = polar((innerRadius + TIER_RADII[tier - 1]) / 2, angleDeg);
      gates.push({
        id: `${branch}-gate-${tier}`,
        branch,
        tier,
        requirement,
        x: gatePosition.x,
        y: gatePosition.y,
      });
    }
  });

  return {
    nodes,
    edges,
    gates,
    branches,
    nodeById: new Map(nodes.map((node) => [node.id, node])),
  };
}

export function hexagonPoints(radius: number): string {
  return Array.from({ length: 6 }, (_, index) => {
    const angle = (60 * index - 90) * DEG_TO_RAD;
    return `${(radius * Math.cos(angle)).toFixed(2)},${(radius * Math.sin(angle)).toFixed(2)}`;
  }).join(" ");
}

/** Splits a skill name into at most two balanced label lines for the canvas. */
export function wrapSkillName(name: string, maxChars = 13): string[] {
  const words = name.split(" ").filter(Boolean);
  if (words.length <= 1) return [name];
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length > maxChars && current) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  if (lines.length <= 2) return lines;
  return [lines[0]!, lines.slice(1).join(" ")];
}

/** The node the tree should open on: the first ranked skill, else the first buyable one. */
export function getDefaultSelectedSkillId(
  skillRanks: Readonly<Record<string, number>>,
  context: SkillProgressContext
): string {
  const ranked = SKILL_LIBRARY.find((entry) => (skillRanks[entry.id] ?? 0) > 0);
  if (ranked) return ranked.id;
  const available = SKILL_LIBRARY.find((entry) => getRequirementProgress(entry, context).unlocked);
  return (available ?? SKILL_LIBRARY[0]!).id;
}
