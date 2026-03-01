import type { EditorAutomationRule, EditorGraphConfig } from "./EditorState";
import { createEditorId } from "./EditorState";

export const AUTOMATION_TEMPLATE_OPTIONS = [
  { id: "node-enter-pause", label: "On enter -> pause timer" },
  { id: "node-enter-track", label: "On enter -> start music" },
  { id: "node-stay-background", label: "On stay 10s -> swap background" },
  { id: "round-end-node", label: "On round end -> add perk node" },
  { id: "path-choice-background", label: "On path choice -> dim background" },
  { id: "pause-control-track", label: "On pause control -> resume music" },
] as const;

export type AutomationTemplateId = (typeof AUTOMATION_TEMPLATE_OPTIONS)[number]["id"];

type PerkOption = {
  id: string;
};

function createBaseAutomationRule(
  scope: EditorAutomationRule["scope"] = { kind: "global" }
): EditorAutomationRule {
  return {
    id: createEditorId("automation"),
    name: scope.kind === "node" ? "Node automation" : "Automation rule",
    enabled: true,
    scope,
    trigger:
      scope.kind === "node"
        ? { kind: "node.enter", nodeId: scope.nodeId }
        : { kind: "session.timer", timer: "restPauseStarted" },
    conditions: {
      operator: "all",
      conditions: [],
    },
    actions: [
      {
        id: createEditorId("action"),
        action: { kind: "timer.pauseRest" },
      },
    ],
    cooldownMs: 0,
    stopAfterMatch: false,
  };
}

function getRightmostNodeX(config: EditorGraphConfig): number {
  return Math.max(0, ...config.nodes.map((node) => node.styleHint?.x ?? 0));
}

export function createAutomationRule(
  scope: EditorAutomationRule["scope"] = { kind: "global" }
): EditorAutomationRule {
  return createBaseAutomationRule(scope);
}

export function createAutomationTemplate(
  templateId: AutomationTemplateId | string,
  config: EditorGraphConfig,
  perkOptions: ReadonlyArray<PerkOption>,
  scope: EditorAutomationRule["scope"] = { kind: "global" }
): EditorAutomationRule {
  const base = createBaseAutomationRule(scope);
  const background = config.style.background;
  const firstTrack = config.music.tracks[0];

  switch (templateId) {
    case "node-enter-pause":
      return {
        ...base,
        name: "Pause rest timer on enter",
        trigger:
          scope.kind === "node"
            ? { kind: "node.enter", nodeId: scope.nodeId }
            : { kind: "node.enter" },
        conditions: {
          operator: "all",
          conditions: [
            {
              id: createEditorId("condition"),
              kind: "restState",
              state: "running",
            },
          ],
        },
        actions: [
          {
            id: createEditorId("action"),
            action: { kind: "timer.pauseRest" },
          },
        ],
      };
    case "node-enter-track":
      return {
        ...base,
        name: firstTrack ? "Play first track on enter" : "Start music on enter",
        trigger:
          scope.kind === "node"
            ? { kind: "node.enter", nodeId: scope.nodeId }
            : { kind: "node.enter" },
        actions: [
          {
            id: createEditorId("action"),
            action: firstTrack
              ? {
                  kind: "music.playTrack",
                  trackId: firstTrack.id,
                }
              : { kind: "music.nextTrack" },
          },
        ],
      };
    case "node-stay-background":
      return {
        ...base,
        name: "Swap background on stay",
        trigger:
          scope.kind === "node"
            ? { kind: "node.stay", nodeId: scope.nodeId, elapsedMs: 10000, repeatMode: "once" }
            : { kind: "node.stay", elapsedMs: 10000, repeatMode: "once" },
        actions: [
          {
            id: createEditorId("action"),
            action: {
              kind: "background.setPreset",
              preset: {
                kind: background?.kind ?? "image",
                uri: background?.uri ?? "app://media/automation-background.png",
                name: background?.name ?? "Automation Background",
                fit: background?.fit ?? "cover",
                position: background?.position ?? "center",
                opacity: background?.opacity ?? 0.55,
                blur: background?.blur ?? 0,
                dim: background?.dim ?? 0.35,
                scale: background?.scale ?? 1,
                offsetX: background?.offsetX ?? 0,
                offsetY: background?.offsetY ?? 0,
                motion: background?.motion ?? "fixed",
                parallaxStrength: background?.parallaxStrength ?? 0.18,
              },
            },
          },
        ],
      };
    case "round-end-node":
      return {
        ...base,
        name: "Add perk node after round",
        trigger: { kind: "round.lifecycle", phase: "ended" },
        actions: [
          {
            id: createEditorId("action"),
            action: {
              kind: "graph.addNode",
              node: {
                id: createEditorId("perk-node"),
                name: "Automation Perk",
                kind: "perk",
                visualId: perkOptions[0]?.id,
                giftGuaranteedPerk: true,
                styleHint: {
                  x: getRightmostNodeX(config) + 260,
                  y: 220,
                  width: 190,
                  height: 84,
                },
              },
            },
          },
        ],
      };
    case "path-choice-background":
      return {
        ...base,
        name: "Dim background during path choice",
        trigger: { kind: "board.pathChoiceStarted" },
        actions: [
          {
            id: createEditorId("action"),
            action: {
              kind: "background.setPreset",
              preset: {
                kind: background?.kind ?? "image",
                uri: background?.uri ?? "app://media/path-choice-background.png",
                name: background?.name ?? "Path Choice Background",
                fit: background?.fit ?? "cover",
                position: background?.position ?? "center",
                opacity: 0.35,
                blur: background?.blur ?? 0,
                dim: 0.65,
                scale: background?.scale ?? 1,
                offsetX: background?.offsetX ?? 0,
                offsetY: background?.offsetY ?? 0,
                motion: background?.motion ?? "fixed",
                parallaxStrength: background?.parallaxStrength ?? 0.18,
              },
            },
          },
        ],
      };
    case "pause-control-track":
      return {
        ...base,
        name: "Resume music after pause control",
        trigger: { kind: "player.controlUsed", control: "pause" },
        actions: [
          {
            id: createEditorId("action"),
            delayMs: 3000,
            action: { kind: "music.resume" },
          },
        ],
      };
    default:
      return base;
  }
}
