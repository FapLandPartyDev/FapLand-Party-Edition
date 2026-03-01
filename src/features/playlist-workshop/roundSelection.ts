export type RoundSelectionEntry = {
  id: string;
  name: string;
  difficulty?: number | null;
};

export type DifficultySectionInput = {
  startIndex: number;
  endIndex: number;
  minDifficulty: number;
  maxDifficulty: number;
};

export type DifficultyBuildSectionResult = {
  sectionIndex: number;
  requested: number;
  matched: number;
  missing: number;
};

export type DifficultyBuildResult = {
  roundIds: string[];
  sections: DifficultyBuildSectionResult[];
  retainedQueueIds: string[];
  removedQueueIds: string[];
  addedLibraryIds: string[];
  uncoveredPositions: number[];
  validationErrors: string[];
};

function shuffled<T>(values: ReadonlyArray<T>, random: () => number): T[] {
  const next = [...values];
  for (let index = next.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1));
    [next[index], next[target]] = [next[target]!, next[index]!];
  }
  return next;
}

export function randomizeRoundOrder<T>(values: ReadonlyArray<T>, random = Math.random): T[] {
  if (values.length < 2) return [...values];

  const firstAttempt = shuffled(values, random);
  if (firstAttempt.some((value, index) => value !== values[index])) {
    return firstAttempt;
  }

  const secondAttempt = shuffled(values, random);
  if (secondAttempt.some((value, index) => value !== values[index])) {
    return secondAttempt;
  }

  return [...values.slice(1), values[0]!];
}

export function getProgressiveDifficultyBounds(
  roundIndex: number,
  totalRounds: number
): { minDifficulty: number; maxDifficulty: number } {
  const normalizedTotal = Math.max(1, Math.floor(totalRounds));
  const normalizedIndex = Math.max(0, Math.min(normalizedTotal - 1, Math.floor(roundIndex)));
  const minDifficulty = Math.min(4, Math.floor((normalizedIndex * 4) / normalizedTotal) + 1);
  return { minDifficulty, maxDifficulty: minDifficulty + 1 };
}

export function buildDifficultySectionRoundOrder<T extends RoundSelectionEntry>(input: {
  sections: ReadonlyArray<DifficultySectionInput>;
  rounds: ReadonlyArray<T>;
  shuffle?: boolean;
  random?: () => number;
  previousOrder?: readonly string[];
}): string[] {
  const usedIds = new Set<string>();
  const output: string[] = [];
  const collator = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });
  const sortedRounds = [...input.rounds].sort((a, b) => collator.compare(a.name, b.name));
  const random = input.random ?? Math.random;

  for (const section of input.sections) {
    const sectionOutputStart = output.length;
    const sectionShuffleKeys = new Map(
      sortedRounds.map((round) => [round.id, input.shuffle ? random() : 0] as const)
    );
    const slots = Math.max(0, section.endIndex - section.startIndex + 1);
    for (let slot = 0; slot < slots; slot += 1) {
      const candidates = sortedRounds
        .map((round) => {
          const difficulty = round.difficulty ?? 1;
          const inRange =
            difficulty >= section.minDifficulty && difficulty <= section.maxDifficulty;
          const distance = inRange
            ? 0
            : Math.min(
                Math.abs(difficulty - section.minDifficulty),
                Math.abs(difficulty - section.maxDifficulty)
              );
          return {
            round,
            distance,
            used: usedIds.has(round.id),
            shuffleKey: sectionShuffleKeys.get(round.id) ?? 0,
          };
        })
        .sort((a, b) => {
          if (a.used !== b.used) return a.used ? 1 : -1;
          if (a.distance !== b.distance) return a.distance - b.distance;
          if (input.shuffle && a.shuffleKey !== b.shuffleKey) return a.shuffleKey - b.shuffleKey;
          return collator.compare(a.round.name, b.round.name);
        });
      const picked = candidates[0]?.round;
      if (!picked) break;
      output.push(picked.id);
      usedIds.add(picked.id);
    }

    const previousSection = input.previousOrder?.slice(sectionOutputStart, output.length);
    const currentSection = output.slice(sectionOutputStart);
    if (
      input.shuffle &&
      previousSection &&
      currentSection.length > 1 &&
      currentSection.every((roundId, index) => roundId === previousSection[index])
    ) {
      output.splice(
        sectionOutputStart,
        currentSection.length,
        ...randomizeRoundOrder(currentSection, random)
      );
    }
  }

  return output;
}

export function buildProgressiveRoundOrder<T extends RoundSelectionEntry>(
  rounds: ReadonlyArray<T>,
  random = Math.random
): T[] {
  if (rounds.length <= 1) return [...rounds];

  const bandCount = 4;
  const bandCapacity = Array.from({ length: bandCount }, () => 0);
  for (let roundIndex = 0; roundIndex < rounds.length; roundIndex += 1) {
    const { minDifficulty } = getProgressiveDifficultyBounds(roundIndex, rounds.length);
    bandCapacity[minDifficulty - 1]! += 1;
  }
  const bands = Array.from({ length: bandCount }, () => [] as T[]);
  const buckets = Array.from({ length: 5 }, () => [] as T[]);

  for (const round of rounds) {
    const difficulty = round.difficulty;
    const normalizedDifficulty =
      typeof difficulty !== "number" ||
      !Number.isInteger(difficulty) ||
      difficulty < 1 ||
      difficulty > 5
        ? 1
        : difficulty;
    buckets[normalizedDifficulty - 1]!.push(round);
  }

  const unmatched: Array<{ round: T; difficulty: number }> = [];
  for (let difficulty = 1; difficulty <= 5; difficulty += 1) {
    const earliestBand = Math.max(0, difficulty - 2);
    const latestBand = Math.min(bandCount - 1, difficulty - 1);

    for (const round of shuffled(buckets[difficulty - 1]!, random)) {
      let targetBand = -1;
      for (let bandIndex = earliestBand; bandIndex <= latestBand; bandIndex += 1) {
        if (bands[bandIndex]!.length < bandCapacity[bandIndex]!) {
          targetBand = bandIndex;
          break;
        }
      }

      if (targetBand >= 0) bands[targetBand]!.push(round);
      else unmatched.push({ round, difficulty });
    }
  }

  // A strict bounded arrangement is not always possible (for example, a library
  // containing only difficulty 1 rounds). Keep unavoidable exceptions as close
  // to their intended band as possible instead of allowing them to drift randomly.
  for (const { round, difficulty } of unmatched) {
    const availableBands = bands
      .map((band, bandIndex) => ({ bandIndex, available: band.length < bandCapacity[bandIndex]! }))
      .filter((entry) => entry.available)
      .sort((left, right) => {
        const distanceFromBand = (bandIndex: number) =>
          difficulty < bandIndex + 1
            ? bandIndex + 1 - difficulty
            : difficulty > bandIndex + 2
              ? difficulty - (bandIndex + 2)
              : 0;
        return (
          distanceFromBand(left.bandIndex) - distanceFromBand(right.bandIndex) ||
          left.bandIndex - right.bandIndex
        );
      });
    const targetBand = availableBands[0]?.bandIndex;
    if (targetBand !== undefined) bands[targetBand]!.push(round);
  }

  return bands.flatMap((band) => shuffled(band, random));
}

export function fillRoundOrderRemainderRandomly<T extends RoundSelectionEntry>(input: {
  roundIds: ReadonlyArray<string>;
  candidates: ReadonlyArray<T>;
  targetCount: number;
  random?: () => number;
}): string[] {
  const targetCount = Math.max(0, Math.floor(input.targetCount));
  if (input.roundIds.length >= targetCount) {
    return [...input.roundIds.slice(0, targetCount)];
  }

  const usedIds = new Set(input.roundIds);
  const available = input.candidates.filter((round) => !usedIds.has(round.id));
  const picked = shuffled(available, input.random ?? Math.random).slice(
    0,
    targetCount - input.roundIds.length
  );
  return [...input.roundIds, ...picked.map((round) => round.id)];
}

export function buildDifficultySectionResult<T extends RoundSelectionEntry>(input: {
  sections: ReadonlyArray<DifficultySectionInput>;
  queuedRounds: ReadonlyArray<T>;
  libraryRounds?: ReadonlyArray<T>;
  allowLibraryFill?: boolean;
  shuffle?: boolean;
  random?: () => number;
  playableCapacity: number;
}): DifficultyBuildResult {
  const random = input.random ?? Math.random;
  const playableCapacity = Math.max(0, Math.floor(input.playableCapacity));
  const sortedSections = input.sections
    .map((section, sectionIndex) => ({ section, sectionIndex }))
    .sort(
      (left, right) =>
        left.section.startIndex - right.section.startIndex ||
        left.section.endIndex - right.section.endIndex ||
        left.sectionIndex - right.sectionIndex
    );
  const validationErrors: string[] = [];
  const coveredPositions = new Set<number>();

  for (const { section, sectionIndex } of sortedSections) {
    if (
      section.startIndex < 1 ||
      section.endIndex < section.startIndex ||
      section.endIndex > playableCapacity
    ) {
      validationErrors.push(`Section ${sectionIndex + 1} has an invalid queue range.`);
      continue;
    }
    if (
      section.minDifficulty < 1 ||
      section.maxDifficulty > 5 ||
      section.minDifficulty > section.maxDifficulty
    ) {
      validationErrors.push(`Section ${sectionIndex + 1} has an invalid difficulty range.`);
    }
    for (let position = section.startIndex; position <= section.endIndex; position += 1) {
      if (coveredPositions.has(position)) {
        validationErrors.push(`Section ${sectionIndex + 1} overlaps another section.`);
        break;
      }
      coveredPositions.add(position);
    }
  }

  const uncoveredPositions = Array.from(
    { length: playableCapacity },
    (_, index) => index + 1
  ).filter((position) => !coveredPositions.has(position));
  if (validationErrors.length > 0) {
    return {
      roundIds: [],
      sections: [],
      retainedQueueIds: [],
      removedQueueIds: input.queuedRounds.map((round) => round.id),
      addedLibraryIds: [],
      uncoveredPositions,
      validationErrors: [...new Set(validationErrors)],
    };
  }

  const queuedIds = new Set(input.queuedRounds.map((round) => round.id));
  const libraryCandidates = input.allowLibraryFill ? (input.libraryRounds ?? []) : [];
  const candidates = [
    ...input.queuedRounds,
    ...libraryCandidates.filter((round) => !queuedIds.has(round.id)),
  ];
  const usedIds = new Set<string>();
  const roundIds: string[] = [];
  const sectionResults: DifficultyBuildSectionResult[] = [];

  for (const { section, sectionIndex } of sortedSections) {
    const requested = section.endIndex - section.startIndex + 1;
    const eligible = candidates.filter((round) => {
      if (usedIds.has(round.id)) return false;
      const difficulty = round.difficulty;
      return (
        typeof difficulty === "number" &&
        difficulty >= section.minDifficulty &&
        difficulty <= section.maxDifficulty
      );
    });
    const orderedEligible = input.shuffle ? shuffled(eligible, random) : eligible;
    const picked = orderedEligible.slice(0, requested);
    for (const round of picked) {
      usedIds.add(round.id);
      roundIds.push(round.id);
    }
    sectionResults.push({
      sectionIndex,
      requested,
      matched: picked.length,
      missing: requested - picked.length,
    });
  }

  return {
    roundIds,
    sections: sectionResults,
    retainedQueueIds: roundIds.filter((id) => queuedIds.has(id)),
    removedQueueIds: input.queuedRounds.map((round) => round.id).filter((id) => !usedIds.has(id)),
    addedLibraryIds: roundIds.filter((id) => !queuedIds.has(id)),
    uncoveredPositions,
    validationErrors: [],
  };
}
