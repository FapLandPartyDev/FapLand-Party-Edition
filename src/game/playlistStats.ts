import { MULTIPLAYER_MINIMUM_ROUNDS } from "../constants/experimentalFeatures";
import type { PlaylistConfig } from "./playlistSchema";

export type PlaylistBoardDescription = {
  modeLabel: string;
  nodeCount: number;
  edgeCount: number;
  safePointCount: number;
  roundNodeCount: number;
  catapultNodeCount: number;
};

export function describePlaylistBoard(config: PlaylistConfig): PlaylistBoardDescription {
  if (config.boardConfig.mode === "linear") {
    return {
      modeLabel: "Linear",
      nodeCount: config.boardConfig.totalIndices + 1,
      edgeCount: config.boardConfig.totalIndices,
      safePointCount: config.boardConfig.safePointIndices.length,
      roundNodeCount: config.boardConfig.totalIndices - config.boardConfig.safePointIndices.length,
      catapultNodeCount: 0,
    };
  }

  return {
    modeLabel: "Graph",
    nodeCount: config.boardConfig.nodes.length,
    edgeCount: config.boardConfig.edges.length,
    safePointCount: config.boardConfig.nodes.filter((node) => node.kind === "safePoint").length,
    roundNodeCount: config.boardConfig.nodes.filter(
      (node) => node.kind === "round" || node.kind === "randomRound"
    ).length,
    catapultNodeCount: config.boardConfig.nodes.filter((node) => node.kind === "catapult").length,
  };
}

export function getMultiplayerRequiredRounds(config: PlaylistConfig): number {
  return Math.max(MULTIPLAYER_MINIMUM_ROUNDS, describePlaylistBoard(config).roundNodeCount);
}
