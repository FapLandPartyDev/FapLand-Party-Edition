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
  const buckets = new Map<number, T[]>();
  const unknown: T[] = [];

  for (const round of rounds) {
    const difficulty = round.difficulty;
    if (
      typeof difficulty !== "number" ||
      !Number.isInteger(difficulty) ||
      difficulty < 1 ||
      difficulty > 5
    ) {
      unknown.push(round);
      continue;
    }
    const bucket = buckets.get(difficulty);
    if (bucket) bucket.push(round);
    else buckets.set(difficulty, [round]);
  }

  const output: T[] = [];
  for (let difficulty = 1; difficulty <= 5; difficulty += 1) {
    output.push(...shuffled(buckets.get(difficulty) ?? [], random));
  }
  output.push(...shuffled(unknown, random));
  return output;
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
