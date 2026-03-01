import type { InstalledRound, InstalledRoundCatalogEntry } from "../services/db";

export type RoundLibraryEntry = InstalledRound | InstalledRoundCatalogEntry;

export type RoundRenderRow<TRound extends RoundLibraryEntry = RoundLibraryEntry> =
  | { kind: "standalone"; round: TRound }
  | { kind: "hero-group"; groupKey: string; heroName: string; rounds: TRound[] }
  | {
      kind: "playlist-group";
      groupKey: string;
      playlistId: string;
      playlistName: string;
      rounds: TRound[];
    };

type BuildRoundRenderRowsOptions =
  | { mode?: "hero" }
  | {
      mode: "playlist";
      playlistsByRoundId: Map<string, Array<{ playlistId: string; playlistName: string }>>;
    };

function toHeroGroupKey(round: RoundLibraryEntry): string | null {
  if (!round.hero && !round.heroId) return null;
  const heroName = (round.hero?.name ?? "").trim();
  if (round.heroId) return `id:${round.heroId}`;
  if (heroName.length > 0) return `name:${heroName.toLowerCase()}`;
  return "name:unknown-hero";
}

function toHeroDisplayName(round: RoundLibraryEntry): string {
  const heroName = (round.hero?.name ?? "").trim();
  return heroName.length > 0 ? heroName : "Unknown Hero";
}

export function buildRoundRenderRows<TRound extends RoundLibraryEntry>(
  visibleRounds: TRound[]
): RoundRenderRow<TRound>[] {
  return buildRoundRenderRowsWithOptions(visibleRounds, { mode: "hero" });
}

export function buildRoundRenderRowsWithOptions<TRound extends RoundLibraryEntry>(
  visibleRounds: TRound[],
  options: BuildRoundRenderRowsOptions
): RoundRenderRow<TRound>[] {
  if (options.mode === "playlist") {
    const rows: RoundRenderRow<TRound>[] = [];
    const playlistGroupByKey = new Map<
      string,
      Extract<RoundRenderRow<TRound>, { kind: "playlist-group" }>
    >();

    for (const round of visibleRounds) {
      const memberships = options.playlistsByRoundId.get(round.id) ?? [];
      if (memberships.length === 0) {
        rows.push({ kind: "standalone", round });
        continue;
      }

      for (const membership of memberships) {
        const groupKey = `playlist:${membership.playlistId}`;
        const existing = playlistGroupByKey.get(groupKey);
        if (existing) {
          existing.rounds.push(round);
          continue;
        }

        const nextGroup: Extract<RoundRenderRow<TRound>, { kind: "playlist-group" }> = {
          kind: "playlist-group",
          groupKey,
          playlistId: membership.playlistId,
          playlistName: membership.playlistName,
          rounds: [round],
        };
        playlistGroupByKey.set(groupKey, nextGroup);
        rows.push(nextGroup);
      }
    }

    return rows;
  }

  const rows: RoundRenderRow<TRound>[] = [];
  const heroGroupByKey = new Map<string, Extract<RoundRenderRow<TRound>, { kind: "hero-group" }>>();

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

    const nextGroup: Extract<RoundRenderRow<TRound>, { kind: "hero-group" }> = {
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
