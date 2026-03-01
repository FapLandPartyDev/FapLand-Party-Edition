import { resolvePortableRoundRef } from "../../game/playlistRuntime";
import type { InstalledRound } from "../../services/db";
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

const toMessage = (message: string, path: string, severity: ValidationSeverity): GraphValidationMessage => ({
  message,
  path,
  severity,
});

const isKnownKind = (kind: EditorNodeKind): boolean => {
  return kind === "start" || kind === "end" || kind === "path" || kind === "safePoint" || kind === "round" || kind === "randomRound" || kind === "perk";
};

export function validateGraphConfig(
  config: EditorGraphConfig,
  installedRounds: InstalledRound[],
  options: {
    allowSelfLoops?: boolean;
  } = {},
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
      addError(`Duplicate node id "${node.id}"`, "nodes");
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
        addError(`Round node "${node.id}" requires a roundRef`, `nodes.${node.id}`);
      } else {
        const resolved = resolvePortableRoundRef(node.roundRef, installedRounds);
        if (!resolved) {
          addWarning(`Round node "${node.id}" has unresolved round reference`, `nodes.${node.id}.roundRef`, node.id);
        }
      }
    }

    if (node.kind !== "round" && node.kind !== "perk" && typeof node.forceStop === "boolean") {
      addError(`Only round and perk nodes may define force stop`, `nodes.${node.id}.forceStop`, node.id);
    }

    if (node.kind !== "round" && typeof node.skippable === "boolean") {
      addError(`Only round nodes may define skippable`, `nodes.${node.id}.skippable`, node.id);
    }

    if (node.kind === "end" && node.roundRef) {
      addError(`End node "${node.id}" must not define roundRef`, `nodes.${node.id}.roundRef`, node.id);
    }

    if (node.kind === "end" && node.randomPoolId) {
      addError(`End node "${node.id}" must not define randomPoolId`, `nodes.${node.id}.randomPoolId`, node.id);
    }

    if (node.kind !== "safePoint" && typeof node.checkpointRestMs === "number") {
      addError(`Only safe-point nodes may define checkpoint rest`, `nodes.${node.id}.checkpointRestMs`, node.id);
    }

    if (typeof node.checkpointRestMs === "number" && (!Number.isFinite(node.checkpointRestMs) || node.checkpointRestMs < 0)) {
      addError(`Node "${node.id}" checkpoint rest must be a non-negative number`, `nodes.${node.id}.checkpointRestMs`, node.id);
    }

    if (node.kind !== "perk" && typeof node.giftGuaranteedPerk === "boolean") {
      addError(`Only perk nodes may define guaranteed perk gifting`, `nodes.${node.id}.giftGuaranteedPerk`, node.id);
    }

    if (node.styleHint?.x !== undefined && !Number.isFinite(node.styleHint.x)) {
      addError(`Node "${node.id}" styleHint.x must be numeric`, `nodes.${node.id}.styleHint.x`, node.id);
    }
    if (node.styleHint?.y !== undefined && !Number.isFinite(node.styleHint.y)) {
      addError(`Node "${node.id}" styleHint.y must be numeric`, `nodes.${node.id}.styleHint.y`, node.id);
    }
  }

  const startNodes = config.nodes.filter((node) => node.kind === "start");
  if (startNodes.length === 0) {
    addError("Graph must contain a start node", "startNodeId");
  }

  if (startNodes.length > 1) {
    addError("Graph must contain exactly one start node", "nodes");
  } else if (startNodes[0] && startNodes[0].id !== config.startNodeId) {
    addError(`startNodeId must reference the start node (expected "${startNodes[0].id}")`, "startNodeId");
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
      addError(`Edge "${edge.id}" references unknown fromNodeId "${edge.fromNodeId}"`, `edges.${edge.id}.fromNodeId`, undefined, edge.id);
    }
    if (!nodeById.has(edge.toNodeId)) {
      addError(`Edge "${edge.id}" references unknown toNodeId "${edge.toNodeId}"`, `edges.${edge.id}.toNodeId`, undefined, edge.id);
    }
    outgoingCountByNodeId.set(edge.fromNodeId, (outgoingCountByNodeId.get(edge.fromNodeId) ?? 0) + 1);
    if (!options.allowSelfLoops && edge.fromNodeId === edge.toNodeId) {
      addError(`Self-loop edge "${edge.id}" is not allowed`, `edges.${edge.id}`);
    }

    if (edge.weight !== undefined && (typeof edge.weight !== "number" || edge.weight <= 0)) {
      addWarning(`Edge "${edge.id}" should have positive numeric weight`, `edges.${edge.id}.weight`, undefined, edge.id);
    }
  }

  if (nodeKindCounts.get("start") !== 1) {
    addError(`Start node count must be 1, found ${nodeKindCounts.get("start") ?? 0}`, "nodes");
  }

  for (const node of config.nodes) {
    const outgoingCount = outgoingCountByNodeId.get(node.id) ?? 0;
    if (node.kind === "end" && outgoingCount > 0) {
      addError(`End node "${node.id}" must not have outgoing edges`, `nodes.${node.id}`, node.id);
    }
    if (node.kind !== "end" && outgoingCount === 0) {
      addError(`Node "${node.id}" is a dead end; only end nodes may have zero outgoing edges`, `nodes.${node.id}`, node.id);
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
        addError(`Random pool "${pool.id}" candidate #${candidateIndex + 1} missing roundRef`, `randomRoundPools.${pool.id}.candidates.${candidateIndex}`);
        continue;
      }
      const candidateRoundId = candidate.roundRef.idHint ?? null;
      if (!candidateRoundId || candidateRoundId.trim().length === 0) {
        addWarning(`Random pool "${pool.id}" candidate #${candidateIndex + 1} missing idHint`, `randomRoundPools.${pool.id}.candidates.${candidateIndex}`);
      } else if (installedRoundRefSet.has(candidateRoundId)) {
        continue;
      } else {
        const resolved = resolvePortableRoundRef(candidate.roundRef, installedRounds);
        if (!resolved) {
          addWarning(`Random pool "${pool.id}" candidate #${candidateIndex + 1} has unresolved round`, `randomRoundPools.${pool.id}.candidates.${candidateIndex}`);
        }
      }
      if (typeof candidate.weight !== "number" || candidate.weight <= 0) {
        addWarning(`Random pool "${pool.id}" candidate #${candidateIndex + 1} has invalid weight`, `randomRoundPools.${pool.id}.candidates.${candidateIndex}`);
      }
    }
  }

  for (const [index, ref] of config.cumRoundRefs.entries()) {
    const resolved = resolvePortableRoundRef(ref, installedRounds);
    if (!resolved) {
      addWarning(`Cum round #${index + 1} has unresolved round reference`, `cumRoundRefs.${index}`);
    }
  }

  return {
    errors,
    warnings,
    hardBlocked: errors.length > 0,
  };
}
