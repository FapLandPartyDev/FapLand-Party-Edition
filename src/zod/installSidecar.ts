import * as z from "zod";

const ALLOWED_URI_PROTOCOLS = ["http:", "https:", "app:", "file:"] as const;

const ZAbsoluteInstallUri = z
  .string()
  .url("Invalid URI format.")
  .refine(
    (uri) => {
      try {
        return ALLOWED_URI_PROTOCOLS.includes(
          new URL(uri).protocol as (typeof ALLOWED_URI_PROTOCOLS)[number]
        );
      } catch {
        return false;
      }
    },
    `Unsupported URI protocol. Allowed: ${ALLOWED_URI_PROTOCOLS.join(", ")}`
  );

const ZRelativeInstallPath = z
  .string()
  .trim()
  .min(2, "Relative resource path is required.")
  .refine(
    (value) => value.startsWith("./") || value.startsWith("../"),
    "Relative resource path must start with ./ or ../"
  );

const ZInstallUri = z.union([ZAbsoluteInstallUri, ZRelativeInstallPath]);

const ZAcquisitionPath = z
  .string()
  .trim()
  .min(1)
  .max(1024)
  .refine(
    (value) =>
      !value.includes("\0") &&
      !value.startsWith("/") &&
      !/^[a-z]:[\\/]/iu.test(value) &&
      !value.replaceAll("\\", "/").split("/").includes(".."),
    "Acquisition file path must be a safe relative path."
  );

export const ZExportedAcquisitionSource = z.discriminatedUnion("kind", [
  z
    .object({
      id: z.string().trim().min(1).max(128),
      kind: z.literal("torrent"),
      name: z.string().trim().min(1).max(240),
      magnetUri: z.string().trim().startsWith("magnet:?").max(16_384),
      infoHash: z
        .string()
        .trim()
        .regex(/^(?:[a-f0-9]{40}|[a-z2-7]{32})$/iu),
    })
    .strict(),
  z
    .object({
      id: z.string().trim().min(1).max(128),
      kind: z.literal("mega"),
      name: z.string().trim().min(1).max(240),
      publicUrl: z
        .string()
        .url()
        .max(16_384)
        .refine((value) => {
          const host = new URL(value).hostname.toLowerCase();
          return host === "mega.nz" || host === "www.mega.nz" || host === "mega.co.nz";
        }, "MEGA source must use a public mega.nz URL."),
    })
    .strict(),
]);

export const ZAcquisitionCandidate = z
  .object({
    sourceId: z.string().trim().min(1).max(128),
    filePath: ZAcquisitionPath,
    sizeBytes: z.number().int().nonnegative().optional(),
  })
  .strict();

const ZHeroAcquisition = z
  .object({
    version: z.literal(1),
    sources: z.array(ZExportedAcquisitionSource).max(100),
  })
  .strict();

const ZRoundAcquisition = ZHeroAcquisition.extend({
  candidates: z.array(ZAcquisitionCandidate).max(100),
}).strict();

const ZNullableString = z.string().trim().min(1).nullish();

const ZRoundCutRange = z
  .object({
    startTimeMs: z.number().int().nonnegative(),
    endTimeMs: z.number().int().nonnegative(),
  })
  .strict();

export const ZInstallResource = z
  .object({
    videoUri: ZInstallUri,
    funscriptUri: ZInstallUri.nullish(),
    funscriptOffsetMs: z.number().int().min(-2000).max(2000).nullish(),
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
    cutRanges: z.array(ZRoundCutRange).optional(),
    type: z.enum(["Normal", "Interjection", "Cum"]).nullish(),
    excludeFromRandom: z.boolean().optional(),
    resources: z.array(ZInstallResource).default([]),
    acquisitionCandidates: z.array(ZAcquisitionCandidate).max(100).optional(),
    acquisition: ZRoundAcquisition.optional(),
    hero: ZInstallHeroInfo.nullish(),
  })
  .strict();

export const ZInstallHero = z
  .object({
    name: z.string().trim().min(1),
    author: ZNullableString,
    description: ZNullableString,
    phash: ZNullableString,
    acquisition: ZHeroAcquisition.optional(),
    rounds: z.array(ZInstallRound.omit({ hero: true })).min(1),
  })
  .strict();

export const ZRoundSidecar = ZInstallRound;
export const ZHeroSidecar = ZInstallHero;

export type InstallResource = z.infer<typeof ZInstallResource>;
export type InstallRound = z.infer<typeof ZInstallRound>;
export type InstallHero = z.infer<typeof ZInstallHero>;
export type ExportedAcquisitionSource = z.infer<typeof ZExportedAcquisitionSource>;
export type AcquisitionCandidate = z.infer<typeof ZAcquisitionCandidate>;
