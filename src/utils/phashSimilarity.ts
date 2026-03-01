export const DEFAULT_PHASH_MAX_DISTANCE = 10;

const PHASH_HEX_PATTERN = /^[0-9a-f]{1,16}$/;

export function normalizePhashForSimilarity(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (!PHASH_HEX_PATTERN.test(normalized)) return null;
  return normalized;
}

function popcount64(value: bigint): number {
  let count = 0;
  let remaining = value;

  while (remaining !== 0n) {
    remaining &= remaining - 1n;
    count += 1;
  }

  return count;
}

export function hammingDistance64Hex(a: string | null | undefined, b: string | null | undefined): number | null {
  const normalizedA = normalizePhashForSimilarity(a);
  const normalizedB = normalizePhashForSimilarity(b);
  if (!normalizedA || !normalizedB) return null;

  const left = BigInt(`0x${normalizedA}`);
  const right = BigInt(`0x${normalizedB}`);
  return popcount64(left ^ right);
}

export function isPhashSimilar(
  a: string | null | undefined,
  b: string | null | undefined,
  maxDistance = DEFAULT_PHASH_MAX_DISTANCE,
): boolean {
  const distance = hammingDistance64Hex(a, b);
  if (distance === null) return false;
  return distance <= maxDistance;
}

export function findBestSimilarPhashMatch<T>(
  targetHash: string | null | undefined,
  candidates: ReadonlyArray<T>,
  getHash: (candidate: T) => string | null | undefined,
  maxDistance = DEFAULT_PHASH_MAX_DISTANCE,
): { item: T; distance: number } | null {
  const normalizedTarget = normalizePhashForSimilarity(targetHash);
  if (!normalizedTarget) return null;

  let best: { item: T; distance: number } | null = null;

  for (const candidate of candidates) {
    const distance = hammingDistance64Hex(normalizedTarget, getHash(candidate));
    if (distance === null || distance > maxDistance) continue;
    if (!best || distance < best.distance) {
      best = { item: candidate, distance };
    }
  }

  return best;
}
