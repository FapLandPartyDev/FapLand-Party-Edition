// @vitest-environment node

import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  assertPublicTracker,
  buildLibraryLinkTargets,
  damerauLevenshteinDistance,
  hasReachedSeedLimit,
  normalizeAcquisitionPath,
  parseDefaultAcquisitionSources,
  resolveTorrentDescriptorUrl,
  scoreAcquisitionFileName,
} from "./index";

describe("acquisition safety and matching", () => {
  it("normalizes safe relative catalog paths and rejects traversal", () => {
    expect(normalizeAcquisitionPath("folder\\video.mp4")).toBe("folder/video.mp4");
    expect(() => normalizeAcquisitionPath("../escape.mp4")).toThrow(/unsafe/u);
    expect(() => normalizeAcquisitionPath("C:\\escape.mp4")).toThrow(/unsafe/u);
    expect(() => normalizeAcquisitionPath("/absolute.mp4")).toThrow(/unsafe/u);
  });

  it("rejects authenticated and passkey-like tracker locators", () => {
    expect(() => assertPublicTracker("https://tracker.example/announce")).not.toThrow();
    expect(() => assertPublicTracker("https://user:secret@tracker.example/announce")).toThrow();
    expect(() => assertPublicTracker("https://tracker.example/announce?passkey=secret")).toThrow();
    expect(() =>
      assertPublicTracker("https://tracker.example/0123456789abcdef0123456789abcdef/announce")
    ).toThrow();
  });

  it("resolves Nyaa detail pages to their public torrent descriptors", () => {
    expect(resolveTorrentDescriptorUrl("https://sukebei.nyaa.si/view/4178776").toString()).toBe(
      "https://sukebei.nyaa.si/download/4178776.torrent"
    );
    expect(
      resolveTorrentDescriptorUrl("https://example.com/releases/example.torrent").toString()
    ).toBe("https://example.com/releases/example.torrent");
  });

  it("parses the editable default source list", () => {
    expect(
      parseDefaultAcquisitionSources(`
        # comment
        torrent | Collection | magnet:?xt=urn:btih:0123456789012345678901234567890123456789 | https://sukebei.nyaa.si/view/1
        mega | Archive | https://mega.nz/folder/example#key
      `)
    ).toEqual([
      {
        kind: "torrent",
        name: "Collection",
        locator: "magnet:?xt=urn:btih:0123456789012345678901234567890123456789",
        catalogUrl: "https://sukebei.nyaa.si/view/1",
      },
      {
        kind: "mega",
        name: "Archive",
        locator: "https://mega.nz/folder/example#key",
      },
    ]);
    expect(() =>
      parseDefaultAcquisitionSources("website | Unsupported | https://example.com")
    ).toThrow(/line 1/u);
  });

  it("ships all supported sources from the default Fap Hero list", async () => {
    const manifest = await fs.readFile(
      path.resolve(process.cwd(), "acquisition-sources.txt"),
      "utf8"
    );
    const sources = parseDefaultAcquisitionSources(manifest);
    expect(sources).toHaveLength(9);
    expect(sources.filter((source) => source.kind === "torrent")).toHaveLength(1);
    expect(sources.filter((source) => source.kind === "mega")).toHaveLength(8);
  });

  it("ignores common release noise while scoring filenames", () => {
    expect(
      scoreAcquisitionFileName("Example Hero", "vault/example.hero.2160p.x265.hevc.mp4")
    ).toBeGreaterThanOrEqual(1);
    expect(scoreAcquisitionFileName("Different Name", "vault/example.hero.1080p.mp4")).toBeLessThan(
      0.5
    );
  });

  it("uses normalized Damerau-Levenshtein distance for typo-tolerant matching", () => {
    expect(damerauLevenshteinDistance("hero", "hreo")).toBe(1);
    expect(
      scoreAcquisitionFileName("Héro Match", "archive/Fap.Hero - Hero Match 2160p x265.mp4")
    ).toBe(1);
    expect(scoreAcquisitionFileName("Midngiht Era", "vault/Midnight Era.mp4")).toBeGreaterThan(0.9);
    expect(
      scoreAcquisitionFileName("Completely Different", "vault/Midnight Hero.mp4")
    ).toBeLessThan(0.6);
  });

  it("matches only the basename and removes generic Fap Hero branding", () => {
    expect(scoreAcquisitionFileName("FapHero FH Era", "archive/FH - Era 1080p.mp4")).toBe(1);
    expect(scoreAcquisitionFileName("Era", "Era Collection/Completely Different.mp4")).toBeLessThan(
      0.6
    );
    expect(scoreAcquisitionFileName("Fap Hero FH PMV", "archive/FapHero Compilation.mp4")).toBe(0);
    expect(scoreAcquisitionFileName("Era", "archive\\FH_Era.mp4")).toBe(1);
  });

  it("stops seeding when either configured limit is reached", () => {
    expect(
      hasReachedSeedLimit({ ratio: 1, activeSeedTimeMs: 1, seedRatio: 1, seedTimeMs: 86_400_000 })
    ).toBe(true);
    expect(
      hasReachedSeedLimit({
        ratio: 0.2,
        activeSeedTimeMs: 86_400_000,
        seedRatio: 1,
        seedTimeMs: 86_400_000,
      })
    ).toBe(true);
    expect(
      hasReachedSeedLimit({
        ratio: 50,
        activeSeedTimeMs: 999_999_999,
        seedRatio: null,
        seedTimeMs: null,
      })
    ).toBe(false);
  });

  it("expands a selected hero round into one target for the complete hero", () => {
    const hero = { id: "hero-1", name: "Complete Hero", author: "Author" };
    const rows = [
      {
        id: "hero-round-1",
        name: "Part One",
        author: null,
        heroId: hero.id,
        hero,
        acquisitionCandidates: [],
      },
      {
        id: "hero-round-2",
        name: "Part Two",
        author: null,
        heroId: hero.id,
        hero,
        acquisitionCandidates: [],
      },
      {
        id: "standalone-round",
        name: "Standalone",
        author: null,
        heroId: null,
        hero: null,
        acquisitionCandidates: [],
      },
    ];

    const targets = buildLibraryLinkTargets(
      rows as never,
      { roundIds: ["hero-round-1"] },
      new Map()
    );

    expect(targets).toHaveLength(1);
    expect(targets[0]).toMatchObject({
      targetKind: "hero",
      targetId: "hero-1",
      name: "Complete Hero",
      roundIds: ["hero-round-1", "hero-round-2"],
    });
  });
});
