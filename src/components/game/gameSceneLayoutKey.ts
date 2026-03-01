import type { GameState } from "../../game/types";

export function buildPixiLayoutKey(state: Pick<GameState, "config">): string {
  return [
    state.config.board.length,
    state.config.runtimeGraph.edges.length,
    state.config.endlessGeneration?.roundCounter ?? "fixed",
    state.config.mapTextAnnotations?.length ?? 0,
  ].join(":");
}
