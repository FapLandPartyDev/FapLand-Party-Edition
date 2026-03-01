import {
  AUTOMATION_ACTION_DESCRIPTORS,
  AUTOMATION_TRIGGER_DESCRIPTORS,
} from "../../game/automation/registry";
import { resolvePortableRoundRef } from "../../game/playlistRuntime";
import type { InstalledRound, InstalledRoundCatalogEntry } from "../../services/db";
import type { EditorGraphConfig, EditorNodeKind } from "./EditorState";

type ValidationSeverity = "error" | "warning";

export type GraphValidationMessage = {
  severity: ValidationSeverity;
  message: string;
  path: string;
  nodeId?: string;
  edgeId?: string;
};

export type GraphValidationResult = {
  errors: GraphValidationMessage[];
  warnings: GraphValidationMessage[];
  hardBlocked: boolean;
};

const toMessage = (
  message: string,
  path: string,
  severity: ValidationSeverity
): GraphValidationMessage => ({
  message,
  path,
  severity,
});

const isKnownKind = (kind: EditorNodeKind): boolean => {
  return (
    kind === "start" ||
    kind === "end" ||
    kind === "path" ||
    kind === "safePoint" ||
    kind === "campfire" ||
    kind === "round" ||
    kind === "randomRound" ||
    kind === "perk" ||
    kind === "event" ||
    kind === "catapult"
  );
};

export function validateGraphConfig(
  config: EditorGraphConfig,
  installedRounds: Array<InstalledRound | InstalledRoundCatalogEntry>,
  options: {
    allowSelfLoops?: boolean;
  } = {}
): GraphValidationResult {
  const errors: GraphValidationMessage[] = [];
  const warnings: GraphValidationMessage[] = [];
  const nodeById = new Map<string, (typeof config.nodes)[number]>();
  const nodeIds = new Set<string>();
  const nodeKindCounts = new Map<EditorNodeKind, number>();
  const edgeIds = new Set<string>();
  const installedRoundRefs = installedRounds.map((round) => round.id);
  const installedRoundRefSet = new Set(installedRoundRefs);
  const outgoingCountByNodeId = new Map<string, number>();
  const knownTriggerIds = new Set(AUTOMATION_TRIGGER_DESCRIPTORS.map((entry) => entry.kind));
  const knownActionIds = new Set(AUTOMATION_ACTION_DESCRIPTORS.map((entry) => entry.kind));
  const allRuleIds = new Set((config.automations ?? []).map((rule) => rule.id));

  const addError = (message: string, path: string, nodeId?: string, edgeId?: string) => {
    errors.push({ ...toMessage(message, path, "error"), nodeId, edgeId });
  };
  const addWarning = (message: string, path: string, nodeId?: string, edgeId?: string) => {
    warnings.push({ ...toMessage(message, path, "warning"), nodeId, edgeId });
  };

  if (!Array.isArray(config.nodes)) {
    addError("Graph must contain nodes array", "nodes");
    return {
      errors,
      warnings,
      hardBlocked: true,
    };
  }

  for (const node of config.nodes) {
    if (nodeById.has(node.id)) {
      addError(`Duplicate node id "${node.name}" (${node.id})`, "nodes");
    }
    if (!node.id || node.id.trim().length === 0) {
      addError("Node id must not be empty", "nodes");
    }
    if (!isKnownKind(node.kind)) {
      addWarning(`Unknown node kind "${node.kind}" treated as path`, `nodes.${node.id}`);
    }
    nodeById.set(node.id, node);
    nodeIds.add(node.id);
    nodeKindCounts.set(node.kind, (nodeKindCounts.get(node.kind) ?? 0) + 1);

    if (node.kind === "round") {
      if (!node.roundRef) {
        addError(`Round node "${node.name}" (${node.id}) requires a roundRef`, `nodes.${node.id}`);
      } else {
        const resolved = resolvePortableRoundRef(node.roundRef, installedRounds);
        if (!resolved) {
          addWarning(
            `Round node "${node.name}" (${node.id}) has unresolved round reference`,
            `nodes.${node.id}.roundRef`,
            node.id
          );
        }
      }
      node.roundPlaylistRefs?.forEach((roundRef, index) => {
        const resolved = resolvePortableRoundRef(roundRef, installedRounds);
        if (!resolved) {
          addWarning(
            `Round node "${node.name}" (${node.id}) video queue item #${index + 1} has unresolved round reference`,
            `nodes.${node.id}.roundPlaylistRefs.${index}`,
            node.id
          );
        }
      });
    } else if (node.roundPlaylistRefs) {
      addError(
        `Only round nodes may define a video queue`,
        `nodes.${node.id}.roundPlaylistRefs`,
        node.id
      );
    }

    if (node.kind !== "round" && node.kind !== "perk" && typeof node.forceStop === "boolean") {
      addError(
        `Only round and perk nodes may define force stop`,
        `nodes.${node.id}.forceStop`,
        node.id
      );
    }

    if (node.kind !== "round" && typeof node.skippable === "boolean") {
      addError(`Only round nodes may define skippable`, `nodes.${node.id}.skippable`, node.id);
    }

    if (
      node.kind !== "round" &&
      node.kind !== "randomRound" &&
      typeof node.autoAdvanceAfterCompletion === "boolean"
    ) {
      addError(
        `Only round and random round nodes may define auto-advance`,
        `nodes.${node.id}.autoAdvanceAfterCompletion`,
        node.id
      );
    }

    if (
      node.kind !== "round" &&
      node.kind !== "randomRound" &&
      typeof node.hiddenFromMap === "boolean"
    ) {
      addError(
        `Only round and random round nodes may define hidden-from-map`,
        `nodes.${node.id}.hiddenFromMap`,
        node.id
      );
    }

    if (node.hiddenFromMap && !node.autoAdvanceAfterCompletion) {
      addError(
        `Hidden technical nodes must also auto-advance`,
        `nodes.${node.id}.hiddenFromMap`,
        node.id
      );
    }

    if (node.kind === "end" && node.roundRef) {
      addError(
        `End node "${node.name}" (${node.id}) must not define roundRef`,
        `nodes.${node.id}.roundRef`,
        node.id
      );
    }

    if (node.kind === "end" && node.randomPoolId) {
      addError(
        `End node "${node.name}" (${node.id}) must not define randomPoolId`,
        `nodes.${node.id}.randomPoolId`,
        node.id
      );
    }

    if (node.kind !== "safePoint" && typeof node.checkpointRestMs === "number") {
      addError(
        `Only safe-point nodes may define additional rest`,
        `nodes.${node.id}.checkpointRestMs`,
        node.id
      );
    }

    if (
      typeof node.checkpointRestMs === "number" &&
      (!Number.isFinite(node.checkpointRestMs) || node.checkpointRestMs < 0)
    ) {
      addError(
        `Node "${node.name}" (${node.id}) additional rest must be a non-negative number`,
        `nodes.${node.id}.checkpointRestMs`,
        node.id
      );
    }

    if (node.kind !== "campfire" && typeof node.pauseBonusMs === "number") {
      addError(
        `Only campfire nodes may define pause bonus`,
        `nodes.${node.id}.pauseBonusMs`,
        node.id
      );
    }

    if (
      typeof node.pauseBonusMs === "number" &&
      (!Number.isFinite(node.pauseBonusMs) || node.pauseBonusMs < 0)
    ) {
      addError(
        `Node "${node.name}" (${node.id}) pause bonus must be a non-negative number`,
        `nodes.${node.id}.pauseBonusMs`,
        node.id
      );
    }

    if (node.kind !== "perk" && typeof node.giftGuaranteedPerk === "boolean") {
      addError(
        `Only perk nodes may define guaranteed perk gifting`,
        `nodes.${node.id}.giftGuaranteedPerk`,
        node.id
      );
    }

    if (node.kind !== "catapult" && typeof node.catapultForward === "number") {
      addError(
        `Only catapult nodes may define catapultForward`,
        `nodes.${node.id}.catapultForward`,
        node.id
      );
    }

    if (
      typeof node.catapultForward === "number" &&
      (!Number.isFinite(node.catapultForward) || node.catapultForward < 1)
    ) {
      addError(
        `Node "${node.name}" (${node.id}) catapultForward must be a positive integer`,
        `nodes.${node.id}.catapultForward`,
        node.id
      );
    }

    if (node.styleHint?.x !== undefined && !Number.isFinite(node.styleHint.x)) {
      addError(
        `Node "${node.name}" (${node.id}) styleHint.x must be numeric`,
        `nodes.${node.id}.styleHint.x`,
        node.id
      );
    }
    if (node.styleHint?.y !== undefined && !Number.isFinite(node.styleHint.y)) {
      addError(
        `Node "${node.name}" (${node.id}) styleHint.y must be numeric`,
        `nodes.${node.id}.styleHint.y`,
        node.id
      );
    }
  }

  const startNodes = config.nodes.filter((node) => node.kind === "start");
  if (startNodes.length === 0) {
    addError("Graph must contain a start node", "startNodeId");
  }

  if (startNodes.length > 1) {
    addError("Graph must contain exactly one start node", "nodes");
  } else if (startNodes[0] && startNodes[0].id !== config.startNodeId) {
    addError(
      `startNodeId must reference the start node (expected "${startNodes[0].id}")`,
      "startNodeId"
    );
  }

  if (!nodeById.has(config.startNodeId)) {
    addError(`startNodeId "${config.startNodeId}" does not exist`, "startNodeId");
  }

  const endNodes = config.nodes.filter((node) => node.kind === "end");
  if (endNodes.length === 0) {
    addError("Graph must contain at least one end node", "nodes");
  }

  if (!Array.isArray(config.edges)) {
    addError("Graph must contain edges array", "edges");
    return {
      errors,
      warnings,
      hardBlocked: true,
    };
  }

  for (const edge of config.edges) {
    if (edgeIds.has(edge.id)) {
      addError(`Duplicate edge id "${edge.id}"`, "edges");
    }
    edgeIds.add(edge.id);

    if (!edge.fromNodeId || !edge.toNodeId) {
      addError(`Edge "${edge.id}" must define fromNodeId and toNodeId`, `edges.${edge.id}`);
      continue;
    }

    if (!nodeById.has(edge.fromNodeId)) {
      addError(
        `Edge "${edge.id}" references unknown fromNodeId "${edge.fromNodeId}"`,
        `edges.${edge.id}.fromNodeId`,
        undefined,
        edge.id
      );
    }
    if (!nodeById.has(edge.toNodeId)) {
      addError(
        `Edge "${edge.id}" references unknown toNodeId "${edge.toNodeId}"`,
        `edges.${edge.id}.toNodeId`,
        undefined,
        edge.id
      );
    }
    outgoingCountByNodeId.set(
      edge.fromNodeId,
      (outgoingCountByNodeId.get(edge.fromNodeId) ?? 0) + 1
    );
    if (!options.allowSelfLoops && edge.fromNodeId === edge.toNodeId) {
      addError(`Self-loop edge "${edge.id}" is not allowed`, `edges.${edge.id}`);
    }

    if (edge.weight !== undefined && (typeof edge.weight !== "number" || edge.weight <= 0)) {
      addWarning(
        `Edge "${edge.id}" should have positive numeric weight`,
        `edges.${edge.id}.weight`,
        undefined,
        edge.id
      );
    }
  }

  if (nodeKindCounts.get("start") !== 1) {
    addError(`Start node count must be 1, found ${nodeKindCounts.get("start") ?? 0}`, "nodes");
  }

  for (const node of config.nodes) {
    const outgoingCount = outgoingCountByNodeId.get(node.id) ?? 0;
    if (node.kind === "end" && outgoingCount > 0) {
      addError(
        `End node "${node.name}" (${node.id}) must not have outgoing edges`,
        `nodes.${node.id}`,
        node.id
      );
    }
    if (node.kind !== "end" && outgoingCount === 0) {
      addError(
        `Node "${node.name}" (${node.id}) is a dead end; only end nodes may have zero outgoing edges`,
        `nodes.${node.id}`,
        node.id
      );
    }
    if ((node.autoAdvanceAfterCompletion || node.hiddenFromMap) && outgoingCount !== 1) {
      addError(
        `Technical transition nodes must have exactly one outgoing edge`,
        `nodes.${node.id}`,
        node.id
      );
    }
  }

  const usedPoolIds = new Set<string>();
  for (const pool of config.randomRoundPools) {
    if (!pool.id || pool.id.trim().length === 0) {
      addError("Random pool id is required", "randomRoundPools");
      continue;
    }
    if (usedPoolIds.has(pool.id)) {
      addError(`Duplicate random pool id "${pool.id}"`, "randomRoundPools");
      continue;
    }
    usedPoolIds.add(pool.id);

    if (!Array.isArray(pool.candidates) || pool.candidates.length === 0) {
      addWarning(`Random pool "${pool.id}" has no candidates`, `randomRoundPools.${pool.id}`);
      continue;
    }

    for (const [candidateIndex, candidate] of pool.candidates.entries()) {
      if (!candidate.roundRef) {
        addError(
          `Random pool "${pool.id}" candidate #${candidateIndex + 1} missing roundRef`,
          `randomRoundPools.${pool.id}.candidates.${candidateIndex}`
        );
        continue;
      }
      const candidateRoundId = candidate.roundRef.idHint ?? null;
      if (!candidateRoundId || candidateRoundId.trim().length === 0) {
        addWarning(
          `Random pool "${pool.id}" candidate #${candidateIndex + 1} missing idHint`,
          `randomRoundPools.${pool.id}.candidates.${candidateIndex}`
        );
      } else if (installedRoundRefSet.has(candidateRoundId)) {
        continue;
      } else {
        const resolved = resolvePortableRoundRef(candidate.roundRef, installedRounds);
        if (!resolved) {
          addWarning(
            `Random pool "${pool.id}" candidate #${candidateIndex + 1} has unresolved round`,
            `randomRoundPools.${pool.id}.candidates.${candidateIndex}`
          );
        }
      }
      if (typeof candidate.weight !== "number" || candidate.weight <= 0) {
        addWarning(
          `Random pool "${pool.id}" candidate #${candidateIndex + 1} has invalid weight`,
          `randomRoundPools.${pool.id}.candidates.${candidateIndex}`
        );
      }
    }
  }

  for (const edge of config.edges) {
    const fromNode = nodeById.get(edge.fromNodeId);
    if (fromNode?.autoAdvanceAfterCompletion && (edge.gateCost ?? 0) !== 0) {
      addError(
        `Auto-advance node "${fromNode.name}" (${fromNode.id}) must use a zero-cost outgoing edge`,
        `edges.${edge.id}.gateCost`,
        fromNode.id,
        edge.id
      );
    }
  }

  for (const [index, ref] of config.cumRoundRefs.entries()) {
    const resolved = resolvePortableRoundRef(ref, installedRounds);
    if (!resolved) {
      addWarning(`Cum round #${index + 1} has unresolved round reference`, `cumRoundRefs.${index}`);
    }
  }

  const trackIds = new Set(config.music.tracks.map((track) => track.id));
  const ruleIds = new Set<string>();
  for (const rule of config.automations ?? []) {
    if (ruleIds.has(rule.id)) {
      addError(`Duplicate automation rule id "${rule.id}"`, `automations.${rule.id}`);
    }
    ruleIds.add(rule.id);
    if (!knownTriggerIds.has(rule.trigger.kind)) {
      addError(
        `Unknown automation trigger "${rule.trigger.kind}"`,
        `automations.${rule.id}.trigger`
      );
    }
    if (rule.scope.kind === "node" && !nodeById.has(rule.scope.nodeId)) {
      addError(
        `Automation "${rule.name}" references missing node "${rule.scope.nodeId}"`,
        `automations.${rule.id}.scope`,
        rule.scope.nodeId
      );
    }
    if (
      (rule.trigger.kind === "node.enter" ||
        rule.trigger.kind === "node.leave" ||
        rule.trigger.kind === "node.stay") &&
      rule.trigger.nodeId &&
      !nodeById.has(rule.trigger.nodeId)
    ) {
      addError(
        `Automation "${rule.name}" trigger references missing node "${rule.trigger.nodeId}"`,
        `automations.${rule.id}.trigger`,
        rule.trigger.nodeId
      );
    }
    if (rule.actions.length === 0) {
      addError(
        `Automation "${rule.name}" requires at least one action`,
        `automations.${rule.id}.actions`
      );
    }
    for (const step of rule.actions) {
      if (!knownActionIds.has(step.action.kind)) {
        addError(
          `Unknown automation action "${step.action.kind}"`,
          `automations.${rule.id}.actions.${step.id}`
        );
      }
      if (step.action.kind === "music.playTrack" && !trackIds.has(step.action.trackId)) {
        addError(
          `Automation "${rule.name}" references missing music track "${step.action.trackId}"`,
          `automations.${rule.id}.actions.${step.id}`
        );
      }
      if (step.action.kind === "graph.removeNode" && !step.action.fallbackNodeId) {
        addWarning(
          `Automation "${rule.name}" removes node "${step.action.nodeId}" without fallbackNodeId`,
          `automations.${rule.id}.actions.${step.id}`
        );
      }
      if (
        step.action.kind === "graph.removeNode" &&
        step.action.fallbackNodeId &&
        !nodeById.has(step.action.fallbackNodeId)
      ) {
        addError(
          `Automation "${rule.name}" uses missing fallback node "${step.action.fallbackNodeId}"`,
          `automations.${rule.id}.actions.${step.id}`,
          step.action.fallbackNodeId
        );
      }
      if (step.action.kind === "graph.patchNode" && !nodeById.has(step.action.nodeId)) {
        addError(
          `Automation "${rule.name}" patches missing node "${step.action.nodeId}"`,
          `automations.${rule.id}.actions.${step.id}`
        );
      }
      if (step.action.kind === "graph.removeNode" && !nodeById.has(step.action.nodeId)) {
        addError(
          `Automation "${rule.name}" removes missing node "${step.action.nodeId}"`,
          `automations.${rule.id}.actions.${step.id}`
        );
      }
      if (step.action.kind === "graph.addEdge") {
        if (!nodeById.has(step.action.edge.fromNodeId)) {
          addError(
            `Automation "${rule.name}" adds edge from missing node "${step.action.edge.fromNodeId}"`,
            `automations.${rule.id}.actions.${step.id}`,
            step.action.edge.fromNodeId
          );
        }
        if (!nodeById.has(step.action.edge.toNodeId)) {
          addError(
            `Automation "${rule.name}" adds edge to missing node "${step.action.edge.toNodeId}"`,
            `automations.${rule.id}.actions.${step.id}`,
            step.action.edge.toNodeId
          );
        }
      }
      if (step.action.kind === "graph.removeEdge" && !edgeIds.has(step.action.edgeId)) {
        addError(
          `Automation "${rule.name}" removes missing edge "${step.action.edgeId}"`,
          `automations.${rule.id}.actions.${step.id}`,
          undefined,
          step.action.edgeId
        );
      }
      if (step.action.kind === "graph.patchEdge") {
        if (!edgeIds.has(step.action.edgeId)) {
          addError(
            `Automation "${rule.name}" patches missing edge "${step.action.edgeId}"`,
            `automations.${rule.id}.actions.${step.id}`,
            undefined,
            step.action.edgeId
          );
        }
        if (step.action.patch.fromNodeId && !nodeById.has(step.action.patch.fromNodeId)) {
          addError(
            `Automation "${rule.name}" patches edge from missing node "${step.action.patch.fromNodeId}"`,
            `automations.${rule.id}.actions.${step.id}`,
            step.action.patch.fromNodeId
          );
        }
        if (step.action.patch.toNodeId && !nodeById.has(step.action.patch.toNodeId)) {
          addError(
            `Automation "${rule.name}" patches edge to missing node "${step.action.patch.toNodeId}"`,
            `automations.${rule.id}.actions.${step.id}`,
            step.action.patch.toNodeId
          );
        }
      }
      if (step.action.kind === "graph.setStartNode" && !nodeById.has(step.action.nodeId)) {
        addError(
          `Automation "${rule.name}" sets missing start node "${step.action.nodeId}"`,
          `automations.${rule.id}.actions.${step.id}`
        );
      }
      if (
        (step.action.kind === "rule.enable" ||
          step.action.kind === "rule.disable" ||
          step.action.kind === "rule.setCooldownMs") &&
        !allRuleIds.has(step.action.ruleId)
      ) {
        addError(
          `Automation "${rule.name}" targets missing rule "${step.action.ruleId}"`,
          `automations.${rule.id}.actions.${step.id}`
        );
      }
      if (
        (step.action.kind === "rule.enable" ||
          step.action.kind === "rule.disable" ||
          step.action.kind === "rule.setCooldownMs") &&
        step.action.ruleId === rule.id
      ) {
        addWarning(
          `Automation "${rule.name}" targets itself; verify cooldowns carefully`,
          `automations.${rule.id}.actions.${step.id}`
        );
      }
    }
  }

  return {
    errors,
    warnings,
    hardBlocked: errors.length > 0,
  };
}
