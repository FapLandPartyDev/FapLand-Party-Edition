import { trpc } from "./trpc";

export type SaveConverterSegmentsInput = {
  hero: {
    name: string;
    author?: string | null;
    description?: string | null;
  };
  source: {
    videoUri: string;
    funscriptUri?: string | null;
    sourceRoundId?: string | null;
    removeSourceRound?: boolean;
  };
  segments: Array<{
    startTimeMs: number;
    endTimeMs: number;
    type: "Normal" | "Interjection" | "Cum";
    customName?: string | null;
    bpm?: number | null;
    difficulty?: number | null;
  }>;
};

export const converter = {
  saveSegments: (input: SaveConverterSegmentsInput) => trpc.converter.saveSegments.mutate(input),
};
