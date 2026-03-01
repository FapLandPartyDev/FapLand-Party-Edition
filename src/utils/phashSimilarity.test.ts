import { describe, expect, it } from "vitest";
import {
  DEFAULT_PHASH_MAX_DISTANCE,
  findBestSimilarPhashMatch,
  hammingDistance64Hex,
  isPhashSimilar,
  normalizePhashForSimilarity,
} from "./phashSimilarity";

describe("phashSimilarity", () => {
  it("normalizes valid hex hashes and rejects non-hex values", () => {
    expect(normalizePhashForSimilarity("  AbCd  ")).toBe("abcd");
    expect(normalizePhashForSimilarity("sha256:abc")).toBeNull();
    expect(normalizePhashForSimilarity("zzzz")).toBeNull();
    expect(normalizePhashForSimilarity("")).toBeNull();
  });

  it("computes hamming distance for 64-bit hex hashes", () => {
    expect(hammingDistance64Hex("0", "1")).toBe(1);
    expect(hammingDistance64Hex("ff", "0")).toBe(8);
    expect(hammingDistance64Hex("000f", "f")).toBe(0);
    expect(hammingDistance64Hex("aBc", "ABC")).toBe(0);
    expect(hammingDistance64Hex("sha256:abc", "sha256:abd")).toBeNull();
  });

  it("applies similarity threshold", () => {
    expect(isPhashSimilar("0", "3ff", DEFAULT_PHASH_MAX_DISTANCE)).toBe(true);
    expect(isPhashSimilar("0", "7ff", DEFAULT_PHASH_MAX_DISTANCE)).toBe(false);
    expect(isPhashSimilar("sha256:abc", "sha256:abd", DEFAULT_PHASH_MAX_DISTANCE)).toBe(false);
  });

  it("returns best similar match with deterministic tie behavior", () => {
    const candidates = [
      { id: "first", phash: "1" },
      { id: "second", phash: "2" },
      { id: "third", phash: "f0" },
    ];

    const best = findBestSimilarPhashMatch("0", candidates, (entry) => entry.phash, 1);
    expect(best?.item.id).toBe("first");
    expect(best?.distance).toBe(1);
  });
});
