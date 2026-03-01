import type { InstalledRound } from "../services/db";

export type RoundRenderRow =
  | { kind: "standalone"; round: InstalledRound }
  | { kind: "hero-group"; groupKey: string; heroName: string; rounds: InstalledRound[] };

function toHeroGroupKey(round: InstalledRound): string | null {
  if (!round.hero && !round.heroId) return null;
  const heroName = (round.hero?.name ?? "").trim();
  if (round.heroId) return `id:${round.heroId}`;
  if (heroName.length > 0) return `name:${heroName.toLowerCase()}`;
  return "name:unknown-hero";
}

function toHeroDisplayName(round: InstalledRound): string {
  const heroName = (round.hero?.name ?? "").trim();
  return heroName.length > 0 ? heroName : "Unknown Hero";
}

export function buildRoundRenderRows(visibleRounds: InstalledRound[]): RoundRenderRow[] {
  const rows: RoundRenderRow[] = [];
  const heroGroupByKey = new Map<string, Extract<RoundRenderRow, { kind: "hero-group" }>>();

  for (const round of visibleRounds) {
    const groupKey = toHeroGroupKey(round);
    if (!groupKey) {
      rows.push({ kind: "standalone", round });
      continue;
    }

    const existing = heroGroupByKey.get(groupKey);
    if (existing) {
      existing.rounds.push(round);
      continue;
    }

    const nextGroup: Extract<RoundRenderRow, { kind: "hero-group" }> = {
      kind: "hero-group",
      groupKey,
      heroName: toHeroDisplayName(round),
      rounds: [round],
    };
    heroGroupByKey.set(groupKey, nextGroup);
    rows.push(nextGroup);
  }

  return rows;
}
