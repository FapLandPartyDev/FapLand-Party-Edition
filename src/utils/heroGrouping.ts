export interface HeroGroup<TRound> {
  heroId: string;
  heroName: string;
  heroAuthor: string | null;
  rounds: TRound[];
}

export function groupRoundsByHero<TRound extends { hero?: { id: string; name: string; author?: string | null } | null; heroId?: string | null }>(
  rounds: ReadonlyArray<TRound>,
): HeroGroup<TRound>[] {
  const groupMap = new Map<string, HeroGroup<TRound>>();

  for (const round of rounds) {
    const heroId = round.hero?.id ?? round.heroId;
    if (!heroId) continue;

    const heroName = round.hero?.name?.trim() || "Unknown Hero";
    const heroAuthor = round.hero?.author ?? null;

    const existing = groupMap.get(heroId);
    if (existing) {
      existing.rounds.push(round);
    } else {
      groupMap.set(heroId, {
        heroId,
        heroName,
        heroAuthor,
        rounds: [round],
      });
    }
  }

  return Array.from(groupMap.values()).sort((a, b) =>
    a.heroName.localeCompare(b.heroName, undefined, { sensitivity: "base" }),
  );
}
