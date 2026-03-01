import {
  ZPlaylistConfig,
  type PlaylistConfig,
  type PortableRoundRef,
} from "./playlistSchema";
import { findBestSimilarPhashMatch } from "../utils/phashSimilarity";

type PlaylistRoundType = "Normal" | "Interjection" | "Cum";

export type PlaylistResolutionResourceLike = {
  phash: string | null;
};

export type PlaylistResolutionRoundLike = {
  id: string;
  name: string;
  author: string | null;
  type: string | null;
  difficulty: number | null;
  phash: string | null;
  installSourceKey: string | null;
  resources: PlaylistResolutionResourceLike[];
};

export type PlaylistRefEntry = {
  key: string;
  label: string;
  ref: PortableRoundRef;
};

export type PlaylistResolutionSuggestion = {
  roundId: string;
  name: string;
  author: string | null;
  type: string | null;
  difficulty: number | null;
  score: number;
};

export type PlaylistResolutionIssue = {
  key: string;
  label: string;
  kind: "suggested" | "missing";
  ref: PortableRoundRef;
  defaultRoundId: string | null;
  suggestions: PlaylistResolutionSuggestion[];
};

export type PlaylistResolutionAnalysis = {
  exactMapping: Record<string, string>;
  suggestedMapping: Record<string, string>;
  issues: PlaylistResolutionIssue[];
  counts: {
    exact: number;
    suggested: number;
    missing: number;
  };
};

type AnalyzePlaylistResolutionOptions = {
  difficultyHintsByRefKey?: Record<string, number | null>;
};

function normalizeText(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

function splitTokens(value: string): string[] {
  return value
    .split(/[^a-z0-9]+/i)
    .map((token) => token.trim().toLowerCase())
    .filter((token) => token.length > 0);
}

function jaccardSimilarity(a: string, b: string): number {
  const aTokens = new Set(splitTokens(a));
  const bTokens = new Set(splitTokens(b));

  if (aTokens.size === 0 && bTokens.size === 0) return 1;
  if (aTokens.size === 0 || bTokens.size === 0) return 0;

  let intersection = 0;
  for (const token of aTokens) {
    if (bTokens.has(token)) intersection += 1;
  }

  const union = aTokens.size + bTokens.size - intersection;
  return union > 0 ? intersection / union : 0;
}

function normalizeRoundType(value: string | null | undefined): PlaylistRoundType {
  if (value === "Interjection" || value === "Cum") return value;
  return "Normal";
}

export function resolveRoundPhash(round: {
  phash: string | null;
  resources: Array<{ phash: string | null }>;
}): string | null {
  const ownPhash = normalizeText(round.phash);
  if (ownPhash.length > 0) return ownPhash;

  for (const resource of round.resources) {
    const resourcePhash = normalizeText(resource.phash);
    if (resourcePhash.length > 0) return resourcePhash;
  }

  return null;
}

export function toPortableRoundRefFromRound(round: PlaylistResolutionRoundLike): PortableRoundRef {
  return {
    idHint: round.id,
    installSourceKeyHint: round.installSourceKey ?? undefined,
    phash: resolveRoundPhash(round) ?? undefined,
    name: round.name,
    author: round.author ?? undefined,
    type: normalizeRoundType(round.type),
  };
}

export function resolvePortableRoundRefExact<T extends PlaylistResolutionRoundLike>(
  ref: PortableRoundRef,
  installedRounds: ReadonlyArray<T>,
): T | null {
  const phash = normalizeText(ref.phash);
  if (phash.length > 0) {
    const phashMatch = installedRounds.find((round) => resolveRoundPhash(round) === phash);
    if (phashMatch) return phashMatch;

    const similarPhashMatch = findBestSimilarPhashMatch(
      phash,
      installedRounds,
      (round) => resolveRoundPhash(round),
    );
    if (similarPhashMatch) return similarPhashMatch.item;
  }

  const name = normalizeText(ref.name);
  const author = normalizeText(ref.author);
  const type = normalizeRoundType(ref.type);

  const metadataMatch = installedRounds.find((round) => {
    if (normalizeText(round.name) !== name) return false;
    if (normalizeRoundType(round.type) !== type) return false;
    if (author.length > 0 && normalizeText(round.author) !== author) return false;
    return true;
  });
  if (metadataMatch) return metadataMatch;

  if (ref.idHint) {
    const idMatch = installedRounds.find((round) => round.id === ref.idHint);
    if (idMatch) return idMatch;
  }

  return null;
}

function buildRefLabel(input: {
  mode: "linear" | "graph";
  kind: "normal-order" | "normal-index" | "cum" | "graph-node" | "graph-pool";
  index?: number;
  fieldIndex?: string;
  nodeName?: string;
  poolName?: string;
}): string {
  if (input.kind === "normal-order") {
    return `Normal round queue #${(input.index ?? 0) + 1}`;
  }
  if (input.kind === "normal-index") {
    return `Round field ${input.fieldIndex ?? "?"}`;
  }
  if (input.kind === "cum") {
    return `Cum round #${(input.index ?? 0) + 1}`;
  }
  if (input.kind === "graph-node") {
    return `Node "${input.nodeName ?? "Unknown"}"`;
  }
  return `Random pool "${input.poolName ?? "Unknown"}" option #${(input.index ?? 0) + 1}`;
}

export function collectPlaylistRefs(config: PlaylistConfig): PlaylistRefEntry[] {
  if (config.boardConfig.mode === "linear") {
    const normalOrder = config.boardConfig.normalRoundOrder.map((ref, index) => ({
      key: `linear.normalRoundOrder.${index}`,
      label: buildRefLabel({ mode: "linear", kind: "normal-order", index }),
      ref,
    }));

    const normalByIndex = Object.entries(config.boardConfig.normalRoundRefsByIndex)
      .sort((a, b) => Number(a[0]) - Number(b[0]))
      .map(([fieldIndex, ref]) => ({
        key: `linear.normalRoundRefsByIndex.${fieldIndex}`,
        label: buildRefLabel({ mode: "linear", kind: "normal-index", fieldIndex }),
        ref,
      }));

    const cumRefs = config.boardConfig.cumRoundRefs.map((ref, index) => ({
      key: `linear.cumRoundRefs.${index}`,
      label: buildRefLabel({ mode: "linear", kind: "cum", index }),
      ref,
    }));

    return [...normalOrder, ...normalByIndex, ...cumRefs];
  }

  const nodeRefs = config.boardConfig.nodes
    .filter((node) => Boolean(node.roundRef))
    .map((node) => ({
      key: `graph.node.${node.id}`,
      label: buildRefLabel({ mode: "graph", kind: "graph-node", nodeName: node.name }),
      ref: node.roundRef as PortableRoundRef,
    }));

  const poolRefs = config.boardConfig.randomRoundPools.flatMap((pool) =>
    pool.candidates.map((candidate, index) => ({
      key: `graph.randomPool.${pool.id}.${index}`,
      label: buildRefLabel({ mode: "graph", kind: "graph-pool", poolName: pool.name ?? pool.id, index }),
      ref: candidate.roundRef,
    })),
  );

  const cumRefs = config.boardConfig.cumRoundRefs.map((ref, index) => ({
    key: `graph.cumRoundRefs.${index}`,
    label: buildRefLabel({ mode: "graph", kind: "cum", index }),
    ref,
  }));

  return [...nodeRefs, ...poolRefs, ...cumRefs];
}

export function rankPlaylistResolutionSuggestions<T extends PlaylistResolutionRoundLike>(
  ref: PortableRoundRef,
  installedRounds: ReadonlyArray<T>,
  targetDifficulty: number | null = null,
): PlaylistResolutionSuggestion[] {
  const refType = ref.type ? normalizeRoundType(ref.type) : null;
  const refName = normalizeText(ref.name);
  const refAuthor = normalizeText(ref.author);

  return installedRounds
    .filter((round) => {
      if (!refType) return true;
      return normalizeRoundType(round.type) === refType;
    })
    .map((round) => {
      const nameScore = jaccardSimilarity(refName, normalizeText(round.name));
      const authorScore = refAuthor.length > 0
        ? jaccardSimilarity(refAuthor, normalizeText(round.author))
        : 0.5;
      const roundDifficulty = typeof round.difficulty === "number" ? round.difficulty : null;
      const difficultyScore =
        typeof targetDifficulty === "number" && typeof roundDifficulty === "number"
          ? 1 / (1 + Math.abs(targetDifficulty - roundDifficulty))
          : 0.5;
      const score = difficultyScore * 0.5 + nameScore * 0.4 + authorScore * 0.1;

      return {
        roundId: round.id,
        name: round.name,
        author: round.author,
        type: round.type,
        difficulty: roundDifficulty,
        score,
      };
    })
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      return left.name.localeCompare(right.name, undefined, { sensitivity: "base", numeric: true });
    })
    .slice(0, 5);
}

export function analyzePlaylistResolution<T extends PlaylistResolutionRoundLike>(
  config: PlaylistConfig,
  installedRounds: ReadonlyArray<T>,
  options: AnalyzePlaylistResolutionOptions = {},
): PlaylistResolutionAnalysis {
  const refs = collectPlaylistRefs(config);
  const exactMapping: Record<string, string> = {};
  const suggestedMapping: Record<string, string> = {};
  const issues: PlaylistResolutionIssue[] = [];

  for (const entry of refs) {
    const exact = resolvePortableRoundRefExact(entry.ref, installedRounds);
    if (exact) {
      exactMapping[entry.key] = exact.id;
      continue;
    }

    const suggestions = rankPlaylistResolutionSuggestions(
      entry.ref,
      installedRounds,
      typeof options.difficultyHintsByRefKey?.[entry.key] === "number"
        ? options.difficultyHintsByRefKey[entry.key] ?? null
        : null,
    );

    if (suggestions[0]) {
      suggestedMapping[entry.key] = suggestions[0].roundId;
    }

    issues.push({
      key: entry.key,
      label: entry.label,
      kind: suggestions.length > 0 ? "suggested" : "missing",
      ref: entry.ref,
      defaultRoundId: suggestions[0]?.roundId ?? null,
      suggestions,
    });
  }

  const suggested = issues.filter((issue) => issue.kind === "suggested").length;
  const missing = issues.length - suggested;

  return {
    exactMapping,
    suggestedMapping,
    issues,
    counts: {
      exact: Object.keys(exactMapping).length,
      suggested,
      missing,
    },
  };
}

export function applyPlaylistResolutionMapping<T extends PlaylistResolutionRoundLike>(
  config: PlaylistConfig,
  mapping: Record<string, string | null | undefined>,
  installedRounds: ReadonlyArray<T>,
): PlaylistConfig {
  const nextConfig = ZPlaylistConfig.parse(config);
  const roundById = new Map(installedRounds.map((round) => [round.id, round]));

  if (nextConfig.boardConfig.mode === "linear") {
    nextConfig.boardConfig.normalRoundOrder = nextConfig.boardConfig.normalRoundOrder.map((ref, index) => {
      const round = roundById.get(mapping[`linear.normalRoundOrder.${index}`] ?? "");
      return round ? toPortableRoundRefFromRound(round) : ref;
    });

    nextConfig.boardConfig.normalRoundRefsByIndex = Object.fromEntries(
      Object.entries(nextConfig.boardConfig.normalRoundRefsByIndex).map(([fieldIndex, ref]) => {
        const round = roundById.get(mapping[`linear.normalRoundRefsByIndex.${fieldIndex}`] ?? "");
        return [fieldIndex, round ? toPortableRoundRefFromRound(round) : ref];
      }),
    );

    nextConfig.boardConfig.cumRoundRefs = nextConfig.boardConfig.cumRoundRefs.map((ref, index) => {
      const round = roundById.get(mapping[`linear.cumRoundRefs.${index}`] ?? "");
      return round ? toPortableRoundRefFromRound(round) : ref;
    });

    return nextConfig;
  }

  nextConfig.boardConfig.nodes = nextConfig.boardConfig.nodes.map((node) => {
    if (!node.roundRef) return node;
    const round = roundById.get(mapping[`graph.node.${node.id}`] ?? "");
    if (!round) return node;
    return {
      ...node,
      roundRef: toPortableRoundRefFromRound(round),
    };
  });

  nextConfig.boardConfig.randomRoundPools = nextConfig.boardConfig.randomRoundPools.map((pool) => ({
    ...pool,
    candidates: pool.candidates.map((candidate, index) => {
      const round = roundById.get(mapping[`graph.randomPool.${pool.id}.${index}`] ?? "");
      if (!round) return candidate;
      return {
        ...candidate,
        roundRef: toPortableRoundRefFromRound(round),
      };
    }),
  }));

  nextConfig.boardConfig.cumRoundRefs = nextConfig.boardConfig.cumRoundRefs.map((ref, index) => {
    const round = roundById.get(mapping[`graph.cumRoundRefs.${index}`] ?? "");
    return round ? toPortableRoundRefFromRound(round) : ref;
  });

  return nextConfig;
}
