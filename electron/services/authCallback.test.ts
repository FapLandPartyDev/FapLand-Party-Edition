import { describe, expect, it } from "vitest";
import { normalizeMultiplayerAuthCallback } from "./authCallback";

describe("normalizeMultiplayerAuthCallback", () => {
  it("keeps valid multiplayer auth callbacks", () => {
    expect(normalizeMultiplayerAuthCallback("fland://auth/callback?code=abc123")).toBe(
      "fland://auth/callback?code=abc123"
    );
  });

  it("rejects unrelated schemes and paths", () => {
    expect(normalizeMultiplayerAuthCallback("https://example.com/callback?code=abc123")).toBeNull();
    expect(normalizeMultiplayerAuthCallback("fland://other/callback?code=abc123")).toBeNull();
    expect(normalizeMultiplayerAuthCallback("fland://auth/other?code=abc123")).toBeNull();
  });
});
