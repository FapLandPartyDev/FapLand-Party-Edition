import { eq, inArray } from "drizzle-orm";
import { getActionTrimRange, type DetectionAction } from "../../src/features/converter/detection";
import {
  normalizeRoundCutRanges,
  parseRoundCutRangesJson,
  stringifyRoundCutRanges,
} from "../../src/utils/roundCuts";
import { getDb } from "./db";
import { resource, round } from "./db/schema";
import { readFunscriptActions } from "./funscript";
import { createResourceUriResolver } from "./integrations";

export type MassTrimHeroesInput = {
  heroIds: string[];
  allowanceMs?: number;
};

export type MassTrimHeroesResult = {
  selectedHeroCount: number;
  sectionCount: number;
  trimmedSectionCount: number;
  unchangedSectionCount: number;
  skippedSectionCount: number;
};

type MassTrimUpdate = {
  roundId: string;
  startTimeMs: number;
  endTimeMs: number;
  cutRangesJson: string | null;
};

const MAX_MASS_TRIM_HEROES = 200;

function normalizeHeroIds(heroIds: string[]): string[] {
  return [...new Set(heroIds.map((id) => id.trim()).filter(Boolean))];
}

export async function massTrimHeroes(input: MassTrimHeroesInput): Promise<MassTrimHeroesResult> {
  const heroIds = normalizeHeroIds(input.heroIds);
  if (heroIds.length === 0) {
    throw new Error("Select at least one hero to trim.");
  }
  if (heroIds.length > MAX_MASS_TRIM_HEROES) {
    throw new Error(`Select no more than ${MAX_MASS_TRIM_HEROES} heroes at once.`);
  }

  const allowanceMs = Math.max(0, Math.floor(input.allowanceMs ?? 1_000));
  if (!Number.isFinite(allowanceMs)) {
    throw new Error("Trim allowance must be a valid number.");
  }

  const db = getDb();
  const sections = await db.query.round.findMany({
    where: inArray(round.heroId, heroIds),
    with: {
      resources: true,
    },
  });
  const resolveResourceUris = createResourceUriResolver();
  const actionCache = new Map<string, Promise<DetectionAction[] | null>>();
  const getActions = (funscriptUri: string): Promise<DetectionAction[] | null> => {
    const cached = actionCache.get(funscriptUri);
    if (cached) return cached;
    const pending = readFunscriptActions(funscriptUri).catch((error) => {
      console.warn(`Mass trim could not read funscript "${funscriptUri}"`, error);
      return null;
    });
    actionCache.set(funscriptUri, pending);
    return pending;
  };

  const planned = await Promise.all(
    sections.map(async (section): Promise<MassTrimUpdate | "unchanged" | "skipped"> => {
      if (
        section.startTime === null ||
        section.endTime === null ||
        section.endTime <= section.startTime
      ) {
        return "skipped";
      }

      const attachedResource =
        section.resources.find((entry) => !entry.disabled && entry.funscriptUri) ??
        section.resources.find((entry) => entry.funscriptUri);
      if (!attachedResource?.funscriptUri) return "skipped";

      const resolvedFunscriptUri = resolveResourceUris({
        videoUri: attachedResource.videoUri,
        funscriptUri: attachedResource.funscriptUri,
      }).funscriptUri;
      if (!resolvedFunscriptUri) return "skipped";

      const actions = await getActions(resolvedFunscriptUri);
      if (!actions || actions.length === 0) return "skipped";

      const range = getActionTrimRange({
        actions,
        startTimeMs: section.startTime,
        endTimeMs: section.endTime,
        allowanceMs,
      });
      if (!range) return "skipped";
      if (range.startTimeMs === section.startTime && range.endTimeMs === section.endTime) {
        return "unchanged";
      }

      const cutRanges = normalizeRoundCutRanges(
        parseRoundCutRangesJson(section.cutRangesJson, section.startTime, section.endTime).map(
          (cut) => ({
            startTimeMs: Math.max(range.startTimeMs, cut.startTimeMs),
            endTimeMs: Math.min(range.endTimeMs, cut.endTimeMs),
          })
        ),
        range.startTimeMs,
        range.endTimeMs
      );

      return {
        roundId: section.id,
        startTimeMs: range.startTimeMs,
        endTimeMs: range.endTimeMs,
        cutRangesJson: stringifyRoundCutRanges(cutRanges),
      };
    })
  );

  const updates = planned.filter((entry): entry is MassTrimUpdate => typeof entry === "object");
  if (updates.length > 0) {
    await db.transaction(async (tx) => {
      const updatedAt = new Date();
      for (const update of updates) {
        await tx
          .update(round)
          .set({
            startTime: update.startTimeMs,
            endTime: update.endTimeMs,
            cutRangesJson: update.cutRangesJson,
            phash: null,
            updatedAt,
          })
          .where(eq(round.id, update.roundId));
        await tx
          .update(resource)
          .set({ phash: null, updatedAt })
          .where(eq(resource.roundId, update.roundId));
      }
    });
  }

  return {
    selectedHeroCount: heroIds.length,
    sectionCount: sections.length,
    trimmedSectionCount: updates.length,
    unchangedSectionCount: planned.filter((entry) => entry === "unchanged").length,
    skippedSectionCount: planned.filter((entry) => entry === "skipped").length,
  };
}
