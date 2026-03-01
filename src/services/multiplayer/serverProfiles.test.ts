import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  storeGet: vi.fn(),
  storeSet: vi.fn(),
}));

vi.mock("../trpc", () => ({
  trpc: {
    store: {
      get: {
        query: mocks.storeGet,
      },
      set: {
        mutate: mocks.storeSet,
      },
    },
  },
}));

describe("multiplayer server preference resolution", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.storeSet.mockResolvedValue(null);
  });

  it("returns the active profile when it is configured", async () => {
    mocks.storeGet.mockResolvedValue({
      activeServerId: "custom-server",
      profiles: [
        {
          id: "custom-server",
          name: "Custom",
          url: "https://custom.supabase.co",
          anonKey: "custom-key",
          isDefault: false,
          isBuiltIn: false,
          createdAtIso: "2026-03-08T00:00:00.000Z",
          updatedAtIso: "2026-03-08T00:00:00.000Z",
        },
      ],
    });

    const { getPreferredMultiplayerServerProfile } = await import("./serverProfiles");
    const preferred = await getPreferredMultiplayerServerProfile();

    expect(preferred?.id).toBe("custom-server");
  });

  it("falls back to the hosted default when the active profile is not configured", async () => {
    mocks.storeGet.mockResolvedValue({
      activeServerId: "custom-server",
      profiles: [
        {
          id: "custom-server",
          name: "Custom",
          url: "https://example.supabase.co",
          anonKey: "public-anon-key-placeholder",
          isDefault: false,
          isBuiltIn: false,
          createdAtIso: "2026-03-08T00:00:00.000Z",
          updatedAtIso: "2026-03-08T00:00:00.000Z",
        },
        {
          id: "default-server",
          name: "F-Land Online",
          url: "https://hosted.supabase.co",
          anonKey: "hosted-key",
          isDefault: true,
          isBuiltIn: true,
          createdAtIso: "2026-03-08T00:00:00.000Z",
          updatedAtIso: "2026-03-08T00:00:00.000Z",
        },
      ],
    });

    const { getPreferredMultiplayerServerProfile } = await import("./serverProfiles");
    const preferred = await getPreferredMultiplayerServerProfile();

    expect(preferred?.id).toBe("default-server");
  });

  it("does not treat placeholder hosted defaults as configured", async () => {
    const { isLikelyConfiguredSupabaseServer } = await import("./defaults");

    expect(
      isLikelyConfiguredSupabaseServer({
        id: "default-server",
        name: "F-Land Online",
        url: "https://example.supabase.co",
        anonKey: "public-anon-key-placeholder",
        isDefault: true,
        isBuiltIn: true,
        createdAtIso: "2026-03-08T00:00:00.000Z",
        updatedAtIso: "2026-03-08T00:00:00.000Z",
      })
    ).toBe(false);
  });

  it("refreshes stale placeholder values for built-in profiles from the current bundle", async () => {
    mocks.storeGet.mockResolvedValue({
      activeServerId: "default-server",
      profiles: [
        {
          id: "default-server",
          name: "F-Land Online",
          url: "https://example.supabase.co",
          anonKey: "public-anon-key-placeholder",
          isDefault: true,
          isBuiltIn: true,
          createdAtIso: "2026-03-08T00:00:00.000Z",
          updatedAtIso: "2026-03-08T00:00:00.000Z",
        },
      ],
    });

    const { MULTIPLAYER_DEFAULT_SERVER_PROFILE } = await import("./defaults");
    const { getPreferredMultiplayerServerProfile } = await import("./serverProfiles");
    const preferred = await getPreferredMultiplayerServerProfile();

    expect(preferred).toMatchObject({
      id: "default-server",
      url: MULTIPLAYER_DEFAULT_SERVER_PROFILE.url,
      anonKey: MULTIPLAYER_DEFAULT_SERVER_PROFILE.anonKey,
    });
  });

  it("uses f-land online as the default active selection when it is configured", async () => {
    mocks.storeGet.mockResolvedValue({
      activeServerId: null,
      profiles: [
        {
          id: "development-server",
          name: "Development (Local Supabase)",
          url: "http://127.0.0.1:54321",
          anonKey: "public-anon-key-placeholder",
          isDefault: true,
          isBuiltIn: true,
          createdAtIso: "2026-03-08T00:00:00.000Z",
          updatedAtIso: "2026-03-08T00:00:00.000Z",
        },
        {
          id: "default-server",
          name: "F-Land Online",
          url: "https://hosted.supabase.co",
          anonKey: "hosted-key",
          isDefault: true,
          isBuiltIn: true,
          createdAtIso: "2026-03-08T00:00:00.000Z",
          updatedAtIso: "2026-03-08T00:00:00.000Z",
        },
      ],
    });

    const { getOptionalActiveMultiplayerServerProfile } = await import("./serverProfiles");
    const active = await getOptionalActiveMultiplayerServerProfile();

    expect(active?.id).toBe("default-server");
  });

  it("rejects edits to built-in server profiles", async () => {
    mocks.storeGet.mockResolvedValue({
      activeServerId: "default-server",
      profiles: [],
    });

    const { saveMultiplayerServerProfile } = await import("./serverProfiles");

    await expect(
      saveMultiplayerServerProfile({
        id: "default-server",
        name: "F-Land Online",
        url: "https://hosted.supabase.co",
        anonKey: "hosted-key",
      })
    ).rejects.toThrow("Built-in server profiles cannot be edited.");
  });
});
