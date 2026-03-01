// @vitest-environment node

import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  assertPublicTracker,
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
});
