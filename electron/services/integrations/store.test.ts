import { beforeEach, describe, expect, it } from "vitest";
import { getStore } from "../store";
import {
  createStashSource,
  normalizeBaseUrl,
  toStashInstallSourceKey,
  updateStashSource,
} from "./store";

describe("integration store helpers", () => {
  beforeEach(() => {
    getStore().clear();
  });

  it("normalizes stash base URLs", () => {
    expect(normalizeBaseUrl("https://stash.example.com/")).toBe("https://stash.example.com");
    expect(normalizeBaseUrl("https://stash.example.com/root/path/?a=1#x")).toBe(
      "https://stash.example.com/root/path"
    );
  });

  it("rejects unsupported protocols", () => {
    expect(() => normalizeBaseUrl("ftp://stash.example.com")).toThrow();
  });

  it("builds stash install source keys with normalized base URLs", () => {
    expect(toStashInstallSourceKey("https://stash.example.com/", "123")).toBe(
      "stash:https://stash.example.com:scene:123"
    );
  });

  it("allows creating no-auth stash sources without credentials", () => {
    const source = createStashSource({
      name: "Open Stash",
      baseUrl: "https://stash.example.com",
      authMode: "none",
    });

    expect(source.authMode).toBe("none");
    expect(source.apiKey).toBeNull();
    expect(source.username).toBeNull();
    expect(source.password).toBeNull();
  });

  it("preserves stored credentials when switching to no-auth mode", () => {
    const source = createStashSource({
      name: "Protected Stash",
      baseUrl: "https://stash.example.com",
      authMode: "login",
      username: "alice",
      password: "secret",
    });

    const updated = updateStashSource({
      sourceId: source.id,
      authMode: "none",
    });

    expect(updated.authMode).toBe("none");
    expect(updated.username).toBe("alice");
    expect(updated.password).toBe("secret");
  });
});
