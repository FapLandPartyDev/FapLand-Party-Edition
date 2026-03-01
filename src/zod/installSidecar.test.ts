import { describe, expect, it } from "vitest";
import { ZHeroSidecar, ZRoundSidecar } from "./installSidecar";

describe("install sidecar schemas", () => {
  it("parses a valid .round sidecar", () => {
    const parsed = ZRoundSidecar.parse({
      name: "Test Round",
      author: "Tester",
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
          resources: [
            {
              videoUri: "https://cdn.example.com/hero-round-1.mp4",
            },
          ],
        },
      ],
    });

    expect(parsed.name).toBe("Hero Prime");
    expect(parsed.rounds).toHaveLength(1);
    expect(parsed.rounds[0]?.resources[0]?.videoUri).toContain("hero-round-1.mp4");
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
});
