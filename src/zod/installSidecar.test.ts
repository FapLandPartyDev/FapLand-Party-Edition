import { describe, expect, it } from "vitest";
import { ZHeroSidecar, ZRoundSidecar } from "./installSidecar";

describe("install sidecar schemas", () => {
  it("parses a valid .round sidecar", () => {
    const parsed = ZRoundSidecar.parse({
      name: "Test Round",
      author: "Tester",
      excludeFromRandom: true,
      resources: [
        {
          videoUri: "https://cdn.example.com/video.mp4",
          funscriptUri: "https://cdn.example.com/video.funscript",
        },
      ],
      hero: {
        name: "Alpha Hero",
      },
    });

    expect(parsed.name).toBe("Test Round");
    expect(parsed.excludeFromRandom).toBe(true);
    expect(parsed.resources).toHaveLength(1);
    expect(parsed.hero?.name).toBe("Alpha Hero");
  });

  it("parses a valid .hero sidecar with rounds", () => {
    const parsed = ZHeroSidecar.parse({
      name: "Hero Prime",
      rounds: [
        {
          name: "Hero Prime Round 1",
          type: "Normal",
          excludeFromRandom: true,
          resources: [
            {
              videoUri: "https://cdn.example.com/hero-round-1.mp4",
            },
          ],
        },
        {
          name: "Hero Prime Round 2",
          type: "Normal",
          resources: [],
        },
      ],
    });

    expect(parsed.name).toBe("Hero Prime");
    expect(parsed.rounds).toHaveLength(2);
    expect(parsed.rounds[0]?.excludeFromRandom).toBe(true);
    expect(parsed.rounds[1]?.excludeFromRandom).toBeUndefined();
    expect(parsed.rounds[0]?.resources[0]?.videoUri).toContain("hero-round-1.mp4");
  });

  it("parses older .round sidecars without random exclusion", () => {
    const parsed = ZRoundSidecar.parse({
      name: "Legacy Round",
      resources: [],
    });

    expect(parsed.excludeFromRandom).toBeUndefined();
  });

  it("rejects non-boolean random exclusion values", () => {
    const stringResult = ZRoundSidecar.safeParse({
      name: "Invalid String Exclusion",
      excludeFromRandom: "true",
      resources: [],
    });
    const numberResult = ZHeroSidecar.safeParse({
      name: "Invalid Number Exclusion",
      rounds: [
        {
          name: "Round 1",
          excludeFromRandom: 1,
          resources: [],
        },
      ],
    });

    expect(stringResult.success).toBe(false);
    expect(numberResult.success).toBe(false);
  });

  it("parses webpage URLs intended for yt-dlp resolution", () => {
    const parsed = ZRoundSidecar.parse({
      name: "Website Round",
      resources: [
        {
          videoUri: "https://www.pornhub.com/view_video.php?viewkey=test123",
        },
      ],
    });

    expect(parsed.resources[0]?.videoUri).toBe(
      "https://www.pornhub.com/view_video.php?viewkey=test123"
    );
  });

  it("parses package-relative resource paths", () => {
    const parsed = ZRoundSidecar.parse({
      name: "Portable Round",
      resources: [
        {
          videoUri: "./media/portable.mp4",
          funscriptUri: "../shared/portable.funscript",
        },
      ],
    });

    expect(parsed.resources[0]?.videoUri).toBe("./media/portable.mp4");
    expect(parsed.resources[0]?.funscriptUri).toBe("../shared/portable.funscript");
  });

  it("rejects unknown keys (strict mode)", () => {
    const result = ZRoundSidecar.safeParse({
      name: "Broken",
      resources: [],
      unknownField: true,
    });

    expect(result.success).toBe(false);
  });

  it("rejects invalid URI protocols", () => {
    const result = ZRoundSidecar.safeParse({
      name: "Invalid URI",
      resources: [
        {
          videoUri: "ftp://example.com/video.mp4",
        },
      ],
    });

    expect(result.success).toBe(false);
  });

  it("rejects relative paths without ./ or ../ prefix", () => {
    const result = ZRoundSidecar.safeParse({
      name: "Invalid Relative",
      resources: [
        {
          videoUri: "media/video.mp4",
        },
      ],
    });

    expect(result.success).toBe(false);
  });
});
