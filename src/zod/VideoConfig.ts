import { z } from 'zod';

export const ZRoundType = z.enum(['Normal', 'Interjection', 'Cum']);

export const ZResource = z.object({
    videoUri: z.string(),
    funscriptUri: z.string().optional().nullable(),
});

export const ZHero = z.object({
    name: z.string(),
    author: z.string().optional().nullable(),
    description: z.string().optional().nullable(),
    phash: z.string().optional().nullable(),
});

export const ZRound = z.object({
    name: z.string(),
    author: z.string().optional().nullable(),
    description: z.string().optional().nullable(),
    bpm: z.number().optional().nullable(),
    difficulty: z.number().int().optional().nullable(),
    phash: z.string().optional().nullable(),
    startTime: z.number().int().optional().nullable(),
    endTime: z.number().int().optional().nullable(),
    type: ZRoundType.default('Normal').optional().nullable(),
    resources: z.array(ZResource).default([]),
    hero: ZHero.optional().nullable(),
});

export const ZVideoDatabase = z.object({
    rounds: z.array(ZRound),
});

export type VideoDatabase = z.infer<typeof ZVideoDatabase>;
export type RoundConfig = z.infer<typeof ZRound>;
export type HeroConfig = z.infer<typeof ZHero>;
export type ResourceConfig = z.infer<typeof ZResource>;
