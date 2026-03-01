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
          createdAtIso: "2026-03-08T00:00:00.000Z",
          updatedAtIso: "2026-03-08T00:00:00.000Z",
        },
        {
          id: "default-server",
          name: "F-Land Online",
          url: "https://hosted.supabase.co",
          anonKey: "hosted-key",
          isDefault: true,
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

    expect(isLikelyConfiguredSupabaseServer({
      id: "default-server",
      name: "F-Land Online",
      url: "https://example.supabase.co",
      anonKey: "public-anon-key-placeholder",
      isDefault: true,
      createdAtIso: "2026-03-08T00:00:00.000Z",
      updatedAtIso: "2026-03-08T00:00:00.000Z",
    })).toBe(false);
  });
});
