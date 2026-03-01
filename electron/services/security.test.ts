import { beforeEach, describe, expect, it, vi } from "vitest";

const store = new Map<string, unknown>();

vi.mock("./store", () => ({
  getStore: () => ({
    get: (key: string) => store.get(key),
    set: (key: string, value: unknown) => store.set(key, value),
  }),
}));

vi.mock("./integrations/store", () => ({
  listExternalSources: () => [
    {
      id: "stash-1",
      kind: "stash",
      name: "Main Stash",
      enabled: true,
      baseUrl: "https://stash.example.com",
      authMode: "none",
      apiKey: null,
      username: null,
      password: null,
      tagSelections: [],
      createdAt: "",
      updatedAt: "",
    },
  ],
  normalizeBaseUrl: (value: string) => value,
}));

import {
  addTrustedSite,
  classifyTrustedUrl,
  collectUnknownRemoteSitesFromResources,
  getSecurityMode,
  listTrustedSites,
  normalizeTrustedBaseDomain,
  setSecurityMode,
} from "./security";

describe("security service", () => {
  beforeEach(() => {
    store.clear();
  });

  it("normalizes trusted base domains", () => {
    expect(normalizeTrustedBaseDomain("HTTPS://Sub.Example.CO.UK/path")).toBe("example.co.uk");
    expect(normalizeTrustedBaseDomain("LOCALHOST")).toBe("localhost");
    expect(normalizeTrustedBaseDomain("192.168.0.1")).toBe("192.168.0.1");
  });

  it("defaults security mode to block and persists paranoid mode", () => {
    expect(getSecurityMode()).toBe("block");
    expect(setSecurityMode("block")).toBe("block");
    expect(getSecurityMode()).toBe("block");
    expect(setSecurityMode("paranoid")).toBe("paranoid");
    expect(getSecurityMode()).toBe("paranoid");
  });

  it("trusts stash hosts, user trusted domains, and rejects lookalikes", () => {
    addTrustedSite("example.net");

    expect(classifyTrustedUrl("https://stash.example.com/scene/1")).toMatchObject({
      decision: "trusted",
      source: "built_in_stash",
    });
    expect(classifyTrustedUrl("https://cdn.example.net/video.mp4")).toMatchObject({
      decision: "trusted",
      source: "user",
    });
    expect(classifyTrustedUrl("https://example.net.evil.org/video.mp4")).toMatchObject({
      decision: "blocked",
    });
  });

  it("paranoid mode only trusts stash sources", () => {
    addTrustedSite("example.net");
    setSecurityMode("paranoid");

    expect(classifyTrustedUrl("https://stash.example.com/scene/1")).toMatchObject({
      decision: "trusted",
      source: "built_in_stash",
    });
    expect(classifyTrustedUrl("https://cdn.example.net/video.mp4")).toMatchObject({
      decision: "blocked",
      source: null,
    });
    expect(classifyTrustedUrl("https://01.cdn.vod.farm/video.mp4")).toMatchObject({
      decision: "blocked",
      source: null,
    });
    expect(classifyTrustedUrl("https://mega.nz/file/demo#key")).toMatchObject({
      decision: "blocked",
      source: null,
    });
  });

  it("trusts supplemental hosters by default outside paranoid mode", () => {
    const trusted = listTrustedSites();

    expect(trusted.builtInYtDlpDomains).toEqual(
      expect.arrayContaining(["api.gofile.io", "gofile.io", "mega.nz", "pixeldrain.com"])
    );
    expect(classifyTrustedUrl("https://mega.nz/file/demo#key")).toMatchObject({
      decision: "trusted",
      source: "built_in_ytdlp",
    });
    expect(classifyTrustedUrl("https://pixeldrain.com/u/demo")).toMatchObject({
      decision: "trusted",
      source: "built_in_ytdlp",
    });
    expect(classifyTrustedUrl("https://gofile.io/d/demo")).toMatchObject({
      decision: "trusted",
      source: "built_in_ytdlp",
    });
  });

  it("collects unknown remote sites from import resources", () => {
    const analysis = collectUnknownRemoteSitesFromResources("/tmp/example.hero", "Demo", [
      {
        videoUri: "https://blocked.example.org/video.mp4",
        funscriptUri: "https://scripts.blocked.example.org/demo.funscript",
      },
      {
        videoUri: "app://media/%2Ftmp%2Fsafe.mp4",
        funscriptUri: null,
      },
    ]);

    expect(analysis.unknownEntries).toHaveLength(1);
    expect(analysis.unknownEntries[0]).toMatchObject({
      baseDomain: "example.org",
      videoUrlCount: 1,
      funscriptUrlCount: 1,
    });
  });

  it("does not flag supplemental hosters as unknown remote sites", () => {
    const analysis = collectUnknownRemoteSitesFromResources("/tmp/example.hero", "Demo", [
      {
        videoUri: "https://mega.nz/file/demo#key",
        funscriptUri: "https://pixeldrain.com/u/funscript-demo",
      },
      {
        videoUri: "https://gofile.io/d/demo",
        funscriptUri: null,
      },
    ]);

    expect(analysis.unknownEntries).toEqual([]);
  });
});
