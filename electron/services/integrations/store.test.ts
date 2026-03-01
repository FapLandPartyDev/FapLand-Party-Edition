import { describe, expect, it } from "vitest";
import { normalizeBaseUrl, toStashInstallSourceKey } from "./store";

describe("integration store helpers", () => {
  it("normalizes stash base URLs", () => {
    expect(normalizeBaseUrl("https://stash.example.com/"))
      .toBe("https://stash.example.com");
    expect(normalizeBaseUrl("https://stash.example.com/root/path/?a=1#x"))
      .toBe("https://stash.example.com/root/path");
  });

  it("rejects unsupported protocols", () => {
    expect(() => normalizeBaseUrl("ftp://stash.example.com")).toThrow();
  });

  it("builds stash install source keys with normalized base URLs", () => {
    expect(toStashInstallSourceKey("https://stash.example.com/", "123"))
      .toBe("stash:https://stash.example.com:scene:123");
  });
});
