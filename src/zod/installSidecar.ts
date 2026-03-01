import * as z from "zod";

const ALLOWED_URI_PROTOCOLS = ["http:", "https:", "app:", "file:"] as const;

const ZInstallUri = z
  .string()
  .url("Invalid URI format.")
  .refine((uri) => {
    try {
      return ALLOWED_URI_PROTOCOLS.includes(new URL(uri).protocol as (typeof ALLOWED_URI_PROTOCOLS)[number]);
    } catch {
      return false;
    }
  }, `Unsupported URI protocol. Allowed: ${ALLOWED_URI_PROTOCOLS.join(", ")}`);

const ZNullableString = z.string().trim().min(1).nullish();

export const ZInstallResource = z
  .object({
    videoUri: ZInstallUri,
    funscriptUri: ZInstallUri.nullish(),
  })
  .strict();

export const ZInstallHeroInfo = z
  .object({
    name: z.string().trim().min(1),
    author: ZNullableString,
    description: ZNullableString,
    phash: ZNullableString,
  })
  .strict();

export const ZInstallRound = z
  .object({
    name: z.string().trim().min(1),
    author: ZNullableString,
    description: ZNullableString,
    bpm: z.number().finite().nullish(),
    difficulty: z.number().int().nullish(),
    phash: ZNullableString,
    startTime: z.number().int().nullish(),
    endTime: z.number().int().nullish(),
    type: z.enum(["Normal", "Interjection", "Cum"]).nullish(),
    resources: z.array(ZInstallResource).default([]),
    hero: ZInstallHeroInfo.nullish(),
  })
  .strict();

export const ZInstallHero = z
  .object({
    name: z.string().trim().min(1),
    author: ZNullableString,
    description: ZNullableString,
    phash: ZNullableString,
    rounds: z.array(ZInstallRound.omit({ hero: true })).min(1),
  })
  .strict();

export const ZRoundSidecar = ZInstallRound;
export const ZHeroSidecar = ZInstallHero;

export type InstallResource = z.infer<typeof ZInstallResource>;
export type InstallRound = z.infer<typeof ZInstallRound>;
export type InstallHero = z.infer<typeof ZInstallHero>;
