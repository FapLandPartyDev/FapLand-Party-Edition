import { describe, expect, it } from "vitest";
import { ZHeroSidecar, ZRoundSidecar } from "./installSidecar";

const torrent = {
  id: "source-1",
  kind: "torrent" as const,
  name: "Public collection",
  magnetUri: "magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567",
  infoHash: "0123456789abcdef0123456789abcdef01234567",
};

describe("install sidecar acquisition metadata", () => {
  it("keeps legacy resource-less rounds compatible", () => {
    expect(ZRoundSidecar.parse({ name: "Legacy", resources: [] })).toMatchObject({
      name: "Legacy",
      resources: [],
    });
  });

  it("parses a standalone round with shareable source mappings", () => {
    const parsed = ZRoundSidecar.parse({
      name: "Example",
      resources: [],
      acquisition: {
        version: 1,
        sources: [torrent],
        candidates: [{ sourceId: torrent.id, filePath: "collection/example.mp4", sizeBytes: 42 }],
      },
    });
    expect(parsed.acquisition?.sources).toEqual([torrent]);
    expect(parsed.acquisition?.candidates[0]?.filePath).toBe("collection/example.mp4");
  });

  it("shares hero sources while mapping each round", () => {
    const parsed = ZHeroSidecar.parse({
      name: "Hero",
      acquisition: { version: 1, sources: [torrent] },
      rounds: [
        {
          name: "Round 1",
          resources: [],
          acquisitionCandidates: [{ sourceId: torrent.id, filePath: "Hero.mp4" }],
        },
      ],
    });
    expect(parsed.rounds[0]?.acquisitionCandidates).toHaveLength(1);
  });

  it.each(["../escape.mp4", "/absolute.mp4", "C:\\escape.mp4", "safe/../escape.mp4"])(
    "rejects unsafe acquisition path %s",
    (filePath) => {
      expect(() =>
        ZRoundSidecar.parse({
          name: "Unsafe",
          resources: [],
          acquisition: {
            version: 1,
            sources: [torrent],
            candidates: [{ sourceId: torrent.id, filePath }],
          },
        })
      ).toThrow();
    }
  );
});
