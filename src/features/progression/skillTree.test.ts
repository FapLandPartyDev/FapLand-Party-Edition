import { describe, expect, it } from "vitest";
import { SKILL_LIBRARY } from "../../game/progression";
import {
  ARSENAL_RANKS_PER_SLOT,
  NODE_RADIUS,
  SKILL_BRANCH_ORDER,
  buildSkillTreeLayout,
  getBranchMaxRanks,
  getBranchRanks,
  getDefaultSelectedSkillId,
  getRequirementProgress,
  getSkillIcon,
  getSkillNodeState,
  getSkillRequirement,
  wrapSkillName,
} from "./skillTree";

const layout = buildSkillTreeLayout();

describe("skill tree layout", () => {
  it("places every authored skill exactly once", () => {
    expect(layout.nodes).toHaveLength(SKILL_LIBRARY.length);
    expect(new Set(layout.nodes.map((node) => node.id)).size).toBe(SKILL_LIBRARY.length);
  });

  it("keeps nodes of different branches from overlapping", () => {
    for (let i = 0; i < layout.nodes.length; i += 1) {
      for (let j = i + 1; j < layout.nodes.length; j += 1) {
        const a = layout.nodes[i]!;
        const b = layout.nodes[j]!;
        expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(NODE_RADIUS * 2 + 4);
      }
    }
  });

  it("connects tier one to the core and every other tier to its predecessors", () => {
    const controlEdges = layout.edges.filter((edge) => edge.branch === "control");
    expect(controlEdges.filter((edge) => edge.fromId === null)).toHaveLength(2);
    const tierTwoIds = layout.nodes
      .filter((node) => node.branch === "control" && node.tier === 2)
      .map((node) => node.id);
    for (const id of tierTwoIds) {
      expect(controlEdges.filter((edge) => edge.toId === id)).toHaveLength(2);
    }
  });

  it("gives every branch a gate for each gated tier", () => {
    for (const branch of SKILL_BRANCH_ORDER) {
      const gates = layout.gates.filter((gate) => gate.branch === branch);
      expect(gates).toHaveLength(branch === "arsenal" ? 4 : 3);
    }
  });

  it("gives every skill an icon", () => {
    for (const skill of SKILL_LIBRARY) expect(getSkillIcon(skill)).toBeTruthy();
  });
});

describe("skill requirements", () => {
  it("gates arsenal slots on total spent points", () => {
    const firstArsenal = SKILL_LIBRARY.find((skill) => skill.id === "arsenal-loaded-dice")!;
    expect(getSkillRequirement(firstArsenal)).toEqual({
      kind: "total",
      ranks: ARSENAL_RANKS_PER_SLOT,
    });
  });

  it("gates regular branches on ranks inside the branch", () => {
    const tierThree = SKILL_LIBRARY.find((skill) => skill.id === "hot-streak")!;
    expect(getSkillRequirement(tierThree)).toEqual({ kind: "branch", ranks: 10 });
  });

  it("unlocks once the requirement is met", () => {
    const tierTwo = SKILL_LIBRARY.find((skill) => skill.id === "advantage")!;
    const branchRanks = { ...getBranchRanks({}), dicecraft: 4 };
    expect(getRequirementProgress(tierTwo, { branchRanks, spentSkillPoints: 4 }).unlocked).toBe(
      true
    );
    expect(
      getRequirementProgress(tierTwo, { branchRanks: getBranchRanks({}), spentSkillPoints: 0 })
        .unlocked
    ).toBe(false);
  });
});

describe("node state", () => {
  const skill = SKILL_LIBRARY.find((entry) => entry.id === "pocket-pauses")!;

  it("reports locked, available, ranked, maxed and muted", () => {
    expect(getSkillNodeState(skill, { rank: 0, isDisabled: false, unlocked: false })).toBe(
      "locked"
    );
    expect(getSkillNodeState(skill, { rank: 0, isDisabled: false, unlocked: true })).toBe(
      "available"
    );
    expect(getSkillNodeState(skill, { rank: 1, isDisabled: false, unlocked: true })).toBe("ranked");
    expect(
      getSkillNodeState(skill, { rank: skill.maxRank, isDisabled: false, unlocked: true })
    ).toBe("maxed");
    expect(getSkillNodeState(skill, { rank: 2, isDisabled: true, unlocked: true })).toBe("muted");
  });
});

describe("helpers", () => {
  it("sums ranks per branch and caps", () => {
    expect(getBranchRanks({ "pocket-pauses": 2, "nest-egg": 3 }).control).toBe(2);
    expect(getBranchMaxRanks().control).toBe(
      SKILL_LIBRARY.filter((skill) => skill.branch === "control").reduce(
        (total, skill) => total + skill.maxRank,
        0
      )
    );
  });

  it("wraps long skill names onto at most two lines", () => {
    expect(wrapSkillName("Bad-Luck Protection")).toHaveLength(2);
    expect(wrapSkillName("Momentum")).toEqual(["Momentum"]);
    expect(wrapSkillName("First One's Free Forever Now").length).toBeLessThanOrEqual(2);
  });

  it("opens on the first ranked skill, else the first available one", () => {
    const context = { branchRanks: getBranchRanks({}), spentSkillPoints: 0 };
    expect(getDefaultSelectedSkillId({ "hot-streak": 1 }, context)).toBe("hot-streak");
    expect(getDefaultSelectedSkillId({}, context)).toBe(SKILL_LIBRARY[0]!.id);
  });
});
