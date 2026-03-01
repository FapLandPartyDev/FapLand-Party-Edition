import { describe, expect, it } from "vitest";
import { ZAutomationRule } from "../../game/automation/schema";
import type { EditorGraphConfig } from "./EditorState";
import { AUTOMATION_TEMPLATE_OPTIONS, createAutomationTemplate } from "./automationTemplates";

function makeConfig(): EditorGraphConfig {
  return {
    mode: "graph",
    startNodeId: "start",
    nodes: [
      {
        id: "start",
        name: "Start",
        kind: "start",
        styleHint: { x: 100, y: 100, width: 190, height: 84 },
      },
      {
        id: "path-1",
        name: "Path",
        kind: "path",
        styleHint: { x: 360, y: 100, width: 190, height: 84 },
      },
    ],
    edges: [{ id: "edge-start-path", fromNodeId: "start", toNodeId: "path-1" }],
    textAnnotations: [],
    randomRoundPools: [],
    cumRoundRefs: [],
    pathChoiceTimeoutMs: 6000,
    perkSelection: { optionsPerPick: 3, triggerChancePerCompletedRound: 0.35 },
    perkPool: { enabledPerkIds: [], enabledAntiPerkIds: [] },
    probabilityScaling: {
      initialIntermediaryProbability: 0,
      initialAntiPerkProbability: 0,
      intermediaryIncreasePerRound: 0.02,
      antiPerkIncreasePerRound: 0.015,
      maxIntermediaryProbability: 1,
      maxAntiPerkProbability: 0.75,
    },
    economy: { startingMoney: 120, scorePerCumRoundSuccess: 420 },
    dice: { min: 1, max: 6 },
    disableDiceAnimation: false,
    allowPausingDuringFinalCumRound: false,
    saveMode: "none",
    style: {},
    music: {
      tracks: [{ id: "track-1", uri: "app://media/track.mp3", name: "Track 1" }],
      loop: true,
    },
    automations: [],
  };
}

function fingerprint(rule: ReturnType<typeof createAutomationTemplate>): string {
  return `${rule.name}|${rule.trigger.kind}|${rule.actions.map((step) => step.action.kind).join(",")}`;
}

describe("automation templates", () => {
  it("creates a distinct valid rule for every example option", () => {
    const config = makeConfig();
    const rules = AUTOMATION_TEMPLATE_OPTIONS.map((template) =>
      createAutomationTemplate(template.id, config, [{ id: "perk-speed" }])
    );

    expect(rules.map((rule) => ZAutomationRule.safeParse(rule).success)).toEqual(
      rules.map(() => true)
    );
    expect(new Set(rules.map(fingerprint)).size).toBe(AUTOMATION_TEMPLATE_OPTIONS.length);
    expect(rules.map((rule) => rule.name)).not.toContain("Automation rule");
  });

  it("keeps the start music template valid when no playlist tracks exist", () => {
    const config = makeConfig();
    config.music.tracks = [];

    const rule = createAutomationTemplate("node-enter-track", config, []);

    expect(rule.actions[0]?.action.kind).toBe("music.nextTrack");
    expect(ZAutomationRule.safeParse(rule).success).toBe(true);
  });
});
