import { z } from "zod";
import {
  ZGraphEdge,
  ZGraphNode,
  ZGraphTextAnnotation,
  ZRoundPool,
} from "../../game/playlistSchema";
import type { EditorGraphConfig, ViewportState } from "./EditorState";

export type MapEditorSidebarTab = "tiles" | "rounds" | "heroes";
export type RoundTypeFilter = "all" | "Normal" | "Interjection" | "Cum";
export type RoundLibrarySort = "name" | "difficulty" | "duration";
export type HeroLibrarySort = "name" | "roundCount";
export type MapEditorSaveStatus = "saved" | "dirty" | "saving" | "error";

export interface MapEditorDraftSnapshot {
  version: 1;
  name: string;
  config: EditorGraphConfig;
  viewport: ViewportState;
  showGrid: boolean;
  snapToGrid: boolean;
  sidebar: {
    activeTab: MapEditorSidebarTab;
    activeCategory: string;
    tileSearch: string;
    roundSearch: string;
    roundTypeFilter: RoundTypeFilter;
    roundSort: RoundLibrarySort;
    heroSearch: string;
    heroSort: HeroLibrarySort;
  };
}

export interface MapEditorDraftRecord {
  playlistId: string;
  snapshot: MapEditorDraftSnapshot;
  updatedAt: Date;
}

const ZViewport = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
  zoom: z.number().finite().positive(),
});

const ZDraftConfig = z.custom<EditorGraphConfig>((value) => {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<EditorGraphConfig>;
  return (
    candidate.mode === "graph" &&
    typeof candidate.startNodeId === "string" &&
    Array.isArray(candidate.nodes) &&
    candidate.nodes.every((node) => ZGraphNode.safeParse(node).success) &&
    Array.isArray(candidate.edges) &&
    candidate.edges.every((edge) => ZGraphEdge.safeParse(edge).success) &&
    Array.isArray(candidate.textAnnotations) &&
    candidate.textAnnotations.every(
      (annotation) => ZGraphTextAnnotation.safeParse(annotation).success
    ) &&
    Array.isArray(candidate.randomRoundPools) &&
    candidate.randomRoundPools.every((pool) => ZRoundPool.safeParse(pool).success) &&
    Array.isArray(candidate.cumRoundRefs) &&
    typeof candidate.pathChoiceTimeoutMs === "number"
  );
}, "Invalid map editor draft config");

export const ZMapEditorDraftSnapshot = z.object({
  version: z.literal(1),
  name: z.string(),
  config: ZDraftConfig,
  viewport: ZViewport,
  showGrid: z.boolean(),
  snapToGrid: z.boolean(),
  sidebar: z.object({
    activeTab: z.enum(["tiles", "rounds", "heroes"]),
    activeCategory: z.string(),
    tileSearch: z.string(),
    roundSearch: z.string(),
    roundTypeFilter: z.enum(["all", "Normal", "Interjection", "Cum"]),
    roundSort: z.enum(["name", "difficulty", "duration"]),
    heroSearch: z.string(),
    heroSort: z.enum(["name", "roundCount"]),
  }),
});
