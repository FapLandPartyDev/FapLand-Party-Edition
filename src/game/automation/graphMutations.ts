import type { AutomationActionStep } from "./schema";
import type { BoardField, GameState, RuntimeGraphConfig, RuntimeGraphEdge } from "../types";

type MutationResult =
  | { ok: true; state: GameState }
  | { ok: false; error: string; state: GameState };

function rebuildRuntimeGraph(
  board: BoardField[],
  startNodeId: string,
  edges: RuntimeGraphEdge[],
  previous: RuntimeGraphConfig
): RuntimeGraphConfig {
  const edgesById: Record<string, RuntimeGraphEdge> = {};
  const outgoingEdgeIdsByNodeId: Record<string, string[]> = {};
  for (const edge of edges) {
    edgesById[edge.id] = edge;
    outgoingEdgeIdsByNodeId[edge.fromNodeId] = [
      ...(outgoingEdgeIdsByNodeId[edge.fromNodeId] ?? []),
      edge.id,
    ];
  }
  const nodeIndexById = board.reduce<Record<string, number>>((acc, node, index) => {
    acc[node.id] = index;
    return acc;
  }, {});
  return {
    ...previous,
    startNodeId,
    edges,
    edgesById,
    outgoingEdgeIdsByNodeId,
    nodeIndexById,
  };
}

function withConfig(state: GameState, board: BoardField[], edges: RuntimeGraphEdge[], startNodeId: string): GameState {
  return {
    ...state,
    config: {
      ...state.config,
      board,
      runtimeGraph: rebuildRuntimeGraph(board, startNodeId, edges, state.config.runtimeGraph),
    },
  };
}

function requireNodeIds(board: BoardField[]): Set<string> {
  return new Set(board.map((node) => node.id));
}

export function applyGraphMutationAction(
  state: GameState,
  step: AutomationActionStep["action"]
): MutationResult {
  const board = [...state.config.board];
  const edges = [...state.config.runtimeGraph.edges];

  switch (step.kind) {
    case "graph.addNode": {
      if (board.some((node) => node.id === step.node.id)) {
        return { ok: false, error: `Node ${step.node.id} already exists.`, state };
      }
      return {
        ok: true,
        state: withConfig(
          state,
          [
            ...board,
            {
              ...step.node,
              randomSelectionMode: step.node.selectionMode,
              randomFilter: step.node.filter,
            },
          ],
          edges,
          state.config.runtimeGraph.startNodeId
        ),
      };
    }
    case "graph.removeNode": {
      const existing = board.find((node) => node.id === step.nodeId);
      if (!existing) return { ok: false, error: `Node ${step.nodeId} does not exist.`, state };
      const currentPlayer = state.players[state.currentPlayerIndex];
      if (currentPlayer?.currentNodeId === step.nodeId && !step.fallbackNodeId) {
        return { ok: false, error: `Removing active node ${step.nodeId} requires fallbackNodeId.`, state };
      }
      const fallbackNodeId = step.fallbackNodeId ?? currentPlayer?.currentNodeId ?? state.config.runtimeGraph.startNodeId;
      const nextBoard = board.filter((node) => node.id !== step.nodeId);
      if (!nextBoard.some((node) => node.id === fallbackNodeId)) {
        return { ok: false, error: `Fallback node ${fallbackNodeId} does not exist.`, state };
      }
      const nextEdges = edges.filter((edge) => edge.fromNodeId !== step.nodeId && edge.toNodeId !== step.nodeId);
      const nextStartNodeId =
        state.config.runtimeGraph.startNodeId === step.nodeId ? fallbackNodeId : state.config.runtimeGraph.startNodeId;
      const nextState = withConfig(state, nextBoard, nextEdges, nextStartNodeId);
      return {
        ok: true,
        state: {
          ...nextState,
          players: nextState.players.map((player) =>
            player.currentNodeId === step.nodeId ? { ...player, currentNodeId: fallbackNodeId } : player
          ),
          pendingPathChoice:
            nextState.pendingPathChoice &&
            (nextState.pendingPathChoice.fromNodeId === step.nodeId ||
              nextState.pendingPathChoice.options.some((option) => option.toNodeId === step.nodeId))
              ? null
              : nextState.pendingPathChoice,
        },
      };
    }
    case "graph.patchNode": {
      const index = board.findIndex((node) => node.id === step.nodeId);
      if (index < 0) return { ok: false, error: `Node ${step.nodeId} does not exist.`, state };
      const existing = board[index]!;
      board[index] = {
        ...existing,
        ...step.patch,
        randomSelectionMode: step.patch.selectionMode ?? existing.randomSelectionMode,
        randomFilter: step.patch.filter ?? existing.randomFilter,
      };
      return {
        ok: true,
        state: withConfig(state, board, edges, state.config.runtimeGraph.startNodeId),
      };
    }
    case "graph.addEdge": {
      const nodeIds = requireNodeIds(board);
      if (!nodeIds.has(step.edge.fromNodeId) || !nodeIds.has(step.edge.toNodeId)) {
        return { ok: false, error: "Edge endpoints must exist.", state };
      }
      if (edges.some((edge) => edge.id === step.edge.id)) {
        return { ok: false, error: `Edge ${step.edge.id} already exists.`, state };
      }
      return {
        ok: true,
        state: withConfig(
          state,
          board,
          [...edges, { ...step.edge, gateCost: step.edge.gateCost ?? 0, weight: step.edge.weight ?? 1 }],
          state.config.runtimeGraph.startNodeId
        ),
      };
    }
    case "graph.removeEdge": {
      if (!edges.some((edge) => edge.id === step.edgeId)) {
        return { ok: false, error: `Edge ${step.edgeId} does not exist.`, state };
      }
      return {
        ok: true,
        state: withConfig(
          state,
          board,
          edges.filter((edge) => edge.id !== step.edgeId),
          state.config.runtimeGraph.startNodeId
        ),
      };
    }
    case "graph.patchEdge": {
      const index = edges.findIndex((edge) => edge.id === step.edgeId);
      if (index < 0) return { ok: false, error: `Edge ${step.edgeId} does not exist.`, state };
      const patchedEdge = { ...edges[index]!, ...step.patch };
      const nodeIds = requireNodeIds(board);
      if (!nodeIds.has(patchedEdge.fromNodeId) || !nodeIds.has(patchedEdge.toNodeId)) {
        return { ok: false, error: "Edge endpoints must exist.", state };
      }
      edges[index] = patchedEdge;
      return {
        ok: true,
        state: withConfig(state, board, edges, state.config.runtimeGraph.startNodeId),
      };
    }
    case "graph.setStartNode": {
      if (!board.some((node) => node.id === step.nodeId)) {
        return { ok: false, error: `Start node ${step.nodeId} does not exist.`, state };
      }
      return {
        ok: true,
        state: withConfig(state, board, edges, step.nodeId),
      };
    }
    default:
      return { ok: false, error: `Unsupported graph action ${step.kind}.`, state };
  }
}
