import { ZPlaylistConfig, type PlaylistConfig } from "../../game/playlistSchema";
import { resolvePortableRoundRef } from "../../game/playlistRuntime";
import type { InstalledRound, InstalledRoundCatalogEntry } from "../../services/db";
import { toGraphBoardConfig, type EditorGraphConfig } from "./EditorState";
import { validateGraphConfig } from "./validateGraphConfig";

export interface MapEditorTestRepair {
  omittedNodeCount: number;
  omittedEdgeCount: number;
  removedInvalidEdgeCount: number;
  temporaryExitCount: number;
  omittedAutomationCount: number;
}

export type MapEditorTestBuildResult =
  | { ok: true; config: PlaylistConfig; repair: MapEditorTestRepair }
  | { ok: false; blockingIssues: string[]; repair: MapEditorTestRepair };

const emptyRepair = (): MapEditorTestRepair => ({
  omittedNodeCount: 0,
  omittedEdgeCount: 0,
  removedInvalidEdgeCount: 0,
  temporaryExitCount: 0,
  omittedAutomationCount: 0,
});

function valueReferencesRemovedId(value: unknown, removedIds: ReadonlySet<string>): boolean {
  if (typeof value === "string") return removedIds.has(value);
  if (Array.isArray(value))
    return value.some((entry) => valueReferencesRemovedId(entry, removedIds));
  if (!value || typeof value !== "object") return false;
  return Object.values(value).some((entry) => valueReferencesRemovedId(entry, removedIds));
}

export function buildMapEditorTestConfig(
  editorConfig: EditorGraphConfig,
  candidatePlaylistConfig: PlaylistConfig,
  installedRounds: Array<InstalledRound | InstalledRoundCatalogEntry>,
  testStartNodeId: string = editorConfig.startNodeId
): MapEditorTestBuildResult {
  const repair = emptyRepair();
  const starts = editorConfig.nodes.filter((node) => node.kind === "start");
  const start = starts.length === 1 ? starts[0] : null;
  if (!start || start.id !== editorConfig.startNodeId) {
    return {
      ok: false,
      blockingIssues: ["Testing requires exactly one Start node selected as the map start."],
      repair,
    };
  }

  const testStart = editorConfig.nodes.find((node) => node.id === testStartNodeId);
  if (!testStart) {
    return {
      ok: false,
      blockingIssues: ["The selected test start node no longer exists."],
      repair,
    };
  }

  const nodeById = new Map(editorConfig.nodes.map((node) => [node.id, node]));
  const validEdges = editorConfig.edges.filter((edge) => {
    const valid =
      edge.fromNodeId !== edge.toNodeId &&
      nodeById.has(edge.fromNodeId) &&
      nodeById.has(edge.toNodeId) &&
      nodeById.get(edge.fromNodeId)?.kind !== "end";
    if (!valid) repair.removedInvalidEdgeCount += 1;
    return valid;
  });

  // Preserve the normal playable graph and additionally retain the selected node's branch. The
  // player's position is overridden at runtime; the transient board itself keeps its real start.
  const reachable = new Set<string>([start.id, testStart.id]);
  const queue = start.id === testStart.id ? [start.id] : [start.id, testStart.id];
  while (queue.length > 0) {
    const nodeId = queue.shift()!;
    for (const edge of validEdges) {
      if (edge.fromNodeId !== nodeId || reachable.has(edge.toNodeId)) continue;
      reachable.add(edge.toNodeId);
      queue.push(edge.toNodeId);
    }
  }

  const retainedNodeIds = reachable;
  const removedIds = new Set(
    editorConfig.nodes.filter((node) => !retainedNodeIds.has(node.id)).map((node) => node.id)
  );
  repair.omittedNodeCount = removedIds.size;
  const reachableEdges = validEdges.filter(
    (edge) => retainedNodeIds.has(edge.fromNodeId) && retainedNodeIds.has(edge.toNodeId)
  );
  repair.omittedEdgeCount = editorConfig.edges.length - reachableEdges.length;

  const blockingIssues: string[] = [];
  for (const node of editorConfig.nodes) {
    if (!retainedNodeIds.has(node.id)) continue;
    if (
      node.kind === "round" &&
      node.roundRef &&
      !resolvePortableRoundRef(node.roundRef, installedRounds)
    ) {
      blockingIssues.push(`Round node "${node.name}" does not resolve to installed media.`);
    }
    if (node.kind === "randomRound") {
      const pool = editorConfig.randomRoundPools.find((entry) => entry.id === node.randomPoolId);
      if (!pool || pool.candidates.length === 0) {
        blockingIssues.push(`Random round node "${node.name}" needs a non-empty pool.`);
      } else if (
        pool.candidates.some(
          (candidate) => !resolvePortableRoundRef(candidate.roundRef, installedRounds)
        )
      ) {
        blockingIssues.push(`Random round node "${node.name}" contains unresolved media.`);
      }
    }
  }
  if (blockingIssues.length > 0) return { ok: false, blockingIssues, repair };

  const retainedNodes = editorConfig.nodes.filter((node) => retainedNodeIds.has(node.id));
  const outgoing = new Set(reachableEdges.map((edge) => edge.fromNodeId));
  const deadEnds = retainedNodes.filter((node) => node.kind !== "end" && !outgoing.has(node.id));
  let repairedNodes = retainedNodes;
  let repairedEdges = reachableEdges;
  if (deadEnds.length > 0) {
    let temporaryEndId = "__map-editor-test-end";
    let suffix = 1;
    while (nodeById.has(temporaryEndId)) {
      temporaryEndId = `__map-editor-test-end-${suffix}`;
      suffix += 1;
    }
    const maxX = Math.max(0, ...retainedNodes.map((node) => Number(node.styleHint?.x ?? 0)));
    repairedNodes = [
      ...retainedNodes,
      {
        id: temporaryEndId,
        name: "Temporary Test Exit",
        kind: "end",
        styleHint: { x: maxX + 280, y: 120, width: 190, height: 84 },
      },
    ];
    repairedEdges = [
      ...reachableEdges,
      ...deadEnds.map((node, index) => ({
        id: `__map-editor-test-edge-${index + 1}`,
        fromNodeId: node.id,
        toNodeId: temporaryEndId,
        gateCost: 0,
        weight: 1,
      })),
    ];
    repair.temporaryExitCount = deadEnds.length;
  }

  const retainedEdgeIds = new Set(repairedEdges.map((edge) => edge.id));
  const allRemovedIds = new Set([
    ...removedIds,
    ...editorConfig.edges.filter((edge) => !retainedEdgeIds.has(edge.id)).map((edge) => edge.id),
  ]);
  const automations = (editorConfig.automations ?? []).filter((rule) => {
    const keep = !valueReferencesRemovedId(rule, allRemovedIds);
    if (!keep) repair.omittedAutomationCount += 1;
    return keep;
  });
  const repairedEditor: EditorGraphConfig = {
    ...editorConfig,
    nodes: repairedNodes,
    edges: repairedEdges,
    automations,
  };

  const validation = validateGraphConfig(repairedEditor, installedRounds);
  if (validation.errors.length > 0) {
    return {
      ok: false,
      blockingIssues: validation.errors.map((entry) => entry.message),
      repair,
    };
  }

  const parsed = ZPlaylistConfig.safeParse({
    ...candidatePlaylistConfig,
    boardConfig: toGraphBoardConfig(repairedEditor),
  });
  if (!parsed.success) {
    return {
      ok: false,
      blockingIssues: parsed.error.issues.map((issue) => issue.message),
      repair,
    };
  }
  return { ok: true, config: parsed.data, repair };
}
