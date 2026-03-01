// @vitest-environment node
import { describe, expect, it } from "vitest";
import { generateSpritePhashHex } from "./phash";
import type { DecodedFrame } from "./types";

describe("phash algorithm logic", () => {
  it("generates a consistent hash for a dummy frame", () => {
    const frame: DecodedFrame = {
      width: 10,
      height: 10,
      data: new Uint8ClampedArray(10 * 10 * 4).fill(128),
    };
    // Add some "image" data
    for (let i = 0; i < 20; i++) {
      frame.data[i * 4] = 255;
    }

    const hash1 = generateSpritePhashHex(frame);
    const hash2 = generateSpritePhashHex(frame);

    expect(hash1).toBe(hash2);
    expect(hash1).toMatch(/^[0-9a-f]+$/);
  });

  it("different frames produce different hashes", () => {
    const frame1: DecodedFrame = {
      width: 8,
      height: 8,
      data: new Uint8ClampedArray(8 * 8 * 4).fill(0),
    };
    const frame2: DecodedFrame = {
      width: 8,
      height: 8,
      data: new Uint8ClampedArray(8 * 8 * 4).fill(255),
    };

    const hash1 = generateSpritePhashHex(frame1);
    const hash2 = generateSpritePhashHex(frame2);

    expect(hash1).not.toBe(hash2);
  });
});
