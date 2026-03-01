import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const auth = {
    getSession: vi.fn(),
    signInAnonymously: vi.fn(),
    getUser: vi.fn(),
    getUserIdentities: vi.fn(),
    linkIdentity: vi.fn(),
    exchangeCodeForSession: vi.fn(),
  };

  return {
    auth,
    createClient: vi.fn(() => ({ auth })),
    activeProfile: {
      id: "default-server",
      name: "F-Land Online",
      url: "https://hosted.supabase.co",
      anonKey: "hosted-key",
      isDefault: true,
      isBuiltIn: true,
      createdAtIso: "2026-03-08T00:00:00.000Z",
      updatedAtIso: "2026-03-08T00:00:00.000Z",
    },
    machineIdQuery: vi.fn(),
  };
});

vi.mock("@supabase/supabase-js", () => ({
  createClient: mocks.createClient,
}));

vi.mock("../trpc", () => ({
  trpc: {
    machineId: {
      getMachineId: {
        query: mocks.machineIdQuery,
      },
    },
  },
}));

vi.mock("./serverProfiles", () => ({
  getActiveMultiplayerServerProfile: vi.fn(async () => mocks.activeProfile),
}));

import {
  clearMultiplayerClientCache,
  getMultiplayerAuthRedirectUrl,
  handleMultiplayerAuthCallback,
  resolveMultiplayerAuthStatus,
} from "./supabaseClient";

describe("multiplayer supabase client auth status", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearMultiplayerClientCache();
    mocks.machineIdQuery.mockResolvedValue("machine-1");
    mocks.auth.getSession.mockResolvedValue({
      data: { session: { user: { id: "session-user" } } },
      error: null,
    });
    mocks.auth.signInAnonymously.mockResolvedValue({
      data: { user: { id: "anon-user" } },
      error: null,
    });
    mocks.auth.getUser.mockResolvedValue({
      data: {
        user: {
          id: "user-1",
          email: null,
          app_metadata: { provider: "anonymous" },
          identities: [],
          is_anonymous: true,
        },
      },
      error: null,
    });
    mocks.auth.getUserIdentities.mockResolvedValue({
      data: { identities: [] },
      error: null,
    });
    mocks.auth.linkIdentity.mockResolvedValue({
      data: { provider: "discord", url: "https://discord.example/link" },
      error: null,
    });
    mocks.auth.exchangeCodeForSession.mockResolvedValue({
      data: { session: { access_token: "token" }, user: { id: "user-1" } },
      error: null,
    });
  });

  it("creates anonymous users, detects discord requirement, and returns needs_discord", async () => {
    mocks.auth.getSession.mockResolvedValueOnce({
      data: { session: null },
      error: null,
    });

    const result = await resolveMultiplayerAuthStatus();

    expect(mocks.auth.signInAnonymously).toHaveBeenCalled();
    expect(mocks.auth.linkIdentity).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "discord",
        options: expect.objectContaining({
          skipBrowserRedirect: true,
          scopes: "identify email",
        }),
      })
    );
    expect(result.status).toBe("needs_discord");
    expect(result.requirement).toBe("discord_required");
    expect(result.discordLinkUrl).toBe("https://discord.example/link");
  });

  it("falls back to anonymous-only when discord linking is unavailable", async () => {
    mocks.auth.linkIdentity.mockResolvedValue({
      data: { provider: "discord", url: null },
      error: { message: "Provider is not enabled" },
    });

    const result = await resolveMultiplayerAuthStatus();

    expect(result.status).toBe("ready");
    expect(result.requirement).toBe("anonymous_only");
    expect(result.message).toBe("This server allows anonymous multiplayer.");
  });

  it("returns ready when discord is linked and email exists", async () => {
    mocks.auth.getUser.mockResolvedValue({
      data: {
        user: {
          id: "user-1",
          email: "discord@example.com",
          app_metadata: { provider: "discord" },
          identities: [{ provider: "discord" }],
          is_anonymous: false,
        },
      },
      error: null,
    });
    mocks.auth.getUserIdentities.mockResolvedValue({
      data: { identities: [{ provider: "discord" }] },
      error: null,
    });

    const result = await resolveMultiplayerAuthStatus();

    expect(mocks.auth.linkIdentity).not.toHaveBeenCalled();
    expect(result.status).toBe("ready");
    expect(result.requirement).toBe("discord_required");
    expect(result.hasEmail).toBe(true);
  });

  it("returns needs_email when discord is linked without email", async () => {
    mocks.auth.getUser.mockResolvedValue({
      data: {
        user: {
          id: "user-1",
          email: null,
          app_metadata: { provider: "discord" },
          identities: [{ provider: "discord" }],
          is_anonymous: false,
        },
      },
      error: null,
    });
    mocks.auth.getUserIdentities.mockResolvedValue({
      data: { identities: [{ provider: "discord" }] },
      error: null,
    });

    const result = await resolveMultiplayerAuthStatus();

    expect(result.status).toBe("needs_email");
    expect(result.hasDiscordIdentity).toBe(true);
    expect(result.hasEmail).toBe(false);
  });

  it("surfaces anonymous sign-in failures clearly", async () => {
    mocks.auth.getSession.mockResolvedValueOnce({
      data: { session: null },
      error: null,
    });
    mocks.auth.signInAnonymously.mockResolvedValueOnce({
      data: { user: null },
      error: { message: "Anonymous sign-ins are disabled" },
    });

    await expect(resolveMultiplayerAuthStatus()).rejects.toThrow("Anonymous sign-ins are disabled");
  });

  it("exchanges oauth callback codes into sessions", async () => {
    await expect(
      handleMultiplayerAuthCallback("fland://auth/callback?code=pkce-code")
    ).resolves.toBe(true);

    expect(mocks.auth.exchangeCodeForSession).toHaveBeenCalledWith("pkce-code");
  });

  it("ignores unrelated callback urls", async () => {
    await expect(handleMultiplayerAuthCallback("fland://auth/callback")).resolves.toBe(false);
    await expect(handleMultiplayerAuthCallback("https://example.com")).resolves.toBe(false);
  });

  it("uses the browser redirect in jsdom/http contexts", () => {
    expect(getMultiplayerAuthRedirectUrl()).toBe("http://localhost:3000/multiplayer");
  });
});
