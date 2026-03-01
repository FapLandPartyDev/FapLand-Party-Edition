import { describe, expect, it } from "vitest";
import { ACTION_FIELDS, setNestedValue, type ActionKind } from "./registry";
import { ZAutomationActionStep } from "./schema";

function applyFieldEdits(
  action: Record<string, unknown>,
  kind: ActionKind
): Record<string, unknown> {
  let next = action;
  for (const field of ACTION_FIELDS[kind]) {
    switch (field.type) {
      case "text":
        next = setNestedValue(next, field.name, `${field.label} value`);
        break;
      case "number":
        next = setNestedValue(next, field.name, field.min ?? 1);
        break;
      case "toggle":
        next = setNestedValue(next, field.name, true);
        break;
      case "select":
        next = setNestedValue(next, field.name, field.options[0]?.value ?? "");
        break;
      case "nodeRef":
        next = setNestedValue(next, field.name, "node-a");
        break;
      case "edgeRef":
        next = setNestedValue(next, field.name, "edge-a");
        break;
      case "trackRef":
        next = setNestedValue(next, field.name, "track-a");
        break;
      case "ruleRef":
        next = setNestedValue(next, field.name, "rule-a");
        break;
      case "perkRef":
        next = setNestedValue(next, field.name, "perk-a");
        break;
    }
  }
  return next;
}

describe("automation registry", () => {
  it("writes graph add and patch action fields into schema-compatible containers", () => {
    const defaults: Record<ActionKind, Record<string, unknown>> = {
      "timer.pauseRest": { kind: "timer.pauseRest" },
      "timer.resumeRest": { kind: "timer.resumeRest" },
      "timer.setRestRemainingMs": { kind: "timer.setRestRemainingMs" },
      "player.grantPauseCharge": { kind: "player.grantPauseCharge" },
      "player.grantSkipCharge": { kind: "player.grantSkipCharge" },
      "player.adjustMoney": { kind: "player.adjustMoney" },
      "player.adjustScore": { kind: "player.adjustScore" },
      "player.applyPerk": { kind: "player.applyPerk" },
      "player.removePerk": { kind: "player.removePerk" },
      "player.applyAntiPerk": { kind: "player.applyAntiPerk" },
      "player.removeAntiPerk": { kind: "player.removeAntiPerk" },
      "music.playTrack": { kind: "music.playTrack" },
      "music.pause": { kind: "music.pause" },
      "music.resume": { kind: "music.resume" },
      "music.stop": { kind: "music.stop" },
      "music.nextTrack": { kind: "music.nextTrack" },
      "music.setPlaylistLoop": { kind: "music.setPlaylistLoop" },
      "background.setPreset": {
        kind: "background.setPreset",
        preset: { kind: "image", uri: "app://media/bg.png" },
      },
      "background.clearOverride": { kind: "background.clearOverride" },
      "ui.showToast": { kind: "ui.showToast" },
      "graph.addNode": { kind: "graph.addNode", node: {} },
      "graph.removeNode": { kind: "graph.removeNode" },
      "graph.patchNode": { kind: "graph.patchNode", patch: {} },
      "graph.addEdge": { kind: "graph.addEdge", edge: {} },
      "graph.removeEdge": { kind: "graph.removeEdge" },
      "graph.patchEdge": { kind: "graph.patchEdge", patch: {} },
      "graph.setStartNode": { kind: "graph.setStartNode" },
      "rule.enable": { kind: "rule.enable" },
      "rule.disable": { kind: "rule.disable" },
      "rule.setCooldownMs": { kind: "rule.setCooldownMs" },
    };

    for (const kind of [
      "graph.addNode",
      "graph.patchNode",
      "graph.addEdge",
      "graph.patchEdge",
    ] as const) {
      const action = applyFieldEdits(defaults[kind], kind);
      expect(ZAutomationActionStep.safeParse({ id: "step-a", action }).success).toBe(true);
    }
  });
});
