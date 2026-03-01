import { trpc } from "../trpc";
import {
  isLikelyConfiguredSupabaseServer,
  MULTIPLAYER_BUILTIN_SERVER_PROFILES,
  MULTIPLAYER_DEFAULT_SERVER_ID,
  MULTIPLAYER_DEVELOPMENT_SERVER_ID,
} from "./defaults";
import type { MultiplayerServerProfile } from "./types";

const SERVER_PROFILES_STORE_KEY = "multiplayer.serverProfiles.v1";

type PersistedMultiplayerServers = {
  activeServerId: string | null;
  profiles: MultiplayerServerProfile[];
};

function nowIso(): string {
  return new Date().toISOString();
}

function asNonEmptyTrimmedString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  return trimmed;
}

function normalizeProfile(input: unknown): MultiplayerServerProfile | null {
  if (!input || typeof input !== "object") return null;
  const raw = input as Partial<MultiplayerServerProfile>;

  const id = asNonEmptyTrimmedString(raw.id);
  const name = asNonEmptyTrimmedString(raw.name);
  const url = asNonEmptyTrimmedString(raw.url);
  const anonKey = asNonEmptyTrimmedString(raw.anonKey);

  if (!id || !name || !url || !anonKey) return null;

  return {
    id,
    name,
    url,
    anonKey,
    isDefault: raw.isDefault === true,
    createdAtIso: asNonEmptyTrimmedString(raw.createdAtIso) ?? nowIso(),
    updatedAtIso: asNonEmptyTrimmedString(raw.updatedAtIso) ?? nowIso(),
  };
}

function normalizePersisted(value: unknown): PersistedMultiplayerServers {
  if (!value || typeof value !== "object") {
    return {
      activeServerId: MULTIPLAYER_BUILTIN_SERVER_PROFILES[0]?.id ?? null,
      profiles: [...MULTIPLAYER_BUILTIN_SERVER_PROFILES],
    };
  }

  const raw = value as Partial<PersistedMultiplayerServers>;
  const normalizedProfiles = Array.isArray(raw.profiles)
    ? raw.profiles
      .map((profile) => normalizeProfile(profile))
      .filter((profile): profile is MultiplayerServerProfile => Boolean(profile))
    : [];

  const builtInProfileById = new Map(
    MULTIPLAYER_BUILTIN_SERVER_PROFILES.map((profile) => [profile.id, profile] as const),
  );
  const withBuiltIns = normalizedProfiles.map((profile) => {
    const builtIn = builtInProfileById.get(profile.id);
    if (!builtIn) return profile;
    return {
      ...profile,
      name: builtIn.name,
      isDefault: true,
    };
  });

  const missingBuiltIns = MULTIPLAYER_BUILTIN_SERVER_PROFILES.filter(
    (profile) => !withBuiltIns.some((existing) => existing.id === profile.id),
  );

  const profiles = [...missingBuiltIns, ...withBuiltIns];

  const requestedActiveServerId = asNonEmptyTrimmedString(raw.activeServerId);
  const activeServerId =
    requestedActiveServerId &&
    profiles.some((profile) => profile.id === requestedActiveServerId)
      ? requestedActiveServerId
      : profiles[0]?.id ?? null;

  return {
    activeServerId,
    profiles,
  };
}

async function readPersistedState(): Promise<PersistedMultiplayerServers> {
  const raw = await trpc.store.get.query({ key: SERVER_PROFILES_STORE_KEY });
  return normalizePersisted(raw);
}

async function writePersistedState(state: PersistedMultiplayerServers): Promise<void> {
  await trpc.store.set.mutate({
    key: SERVER_PROFILES_STORE_KEY,
    value: state,
  });
}

export async function listMultiplayerServerProfiles(): Promise<MultiplayerServerProfile[]> {
  const state = await readPersistedState();
  const ordered = [...state.profiles].sort((a, b) => {
    if (a.isDefault && !b.isDefault) return -1;
    if (!a.isDefault && b.isDefault) return 1;
    return a.name.localeCompare(b.name);
  });
  return ordered;
}

export async function getActiveMultiplayerServerProfile(): Promise<MultiplayerServerProfile> {
  const state = await readPersistedState();
  if (state.activeServerId === null) {
    throw new Error("No multiplayer server profile configured.");
  }
  const active = state.profiles.find((profile) => profile.id === state.activeServerId);
  if (active) return active;
  throw new Error("Active multiplayer server profile not found.");
}

export async function getOptionalActiveMultiplayerServerProfile(): Promise<MultiplayerServerProfile | null> {
  const state = await readPersistedState();
  if (state.activeServerId === null) return null;
  return state.profiles.find((profile) => profile.id === state.activeServerId) ?? null;
}

export async function getPreferredMultiplayerServerProfile(): Promise<MultiplayerServerProfile | null> {
  const state = await readPersistedState();
  const active = state.activeServerId
    ? state.profiles.find((profile) => profile.id === state.activeServerId) ?? null
    : null;

  if (active && isLikelyConfiguredSupabaseServer(active)) {
    return active;
  }

  const hostedDefault = state.profiles.find((profile) => profile.id === MULTIPLAYER_DEFAULT_SERVER_ID) ?? null;
  if (hostedDefault && isLikelyConfiguredSupabaseServer(hostedDefault)) {
    return hostedDefault;
  }

  if (import.meta.env.DEV) {
    const developmentServer = state.profiles.find((profile) => profile.id === MULTIPLAYER_DEVELOPMENT_SERVER_ID) ?? null;
    if (developmentServer && isLikelyConfiguredSupabaseServer(developmentServer)) {
      return developmentServer;
    }
  }

  return active ?? state.profiles[0] ?? null;
}

export async function setActiveMultiplayerServerProfile(serverId: string): Promise<MultiplayerServerProfile> {
  const state = await readPersistedState();
  const nextId = asNonEmptyTrimmedString(serverId);
  if (!nextId) {
    throw new Error("Invalid server id");
  }

  const exists = state.profiles.some((profile) => profile.id === nextId);
  if (!exists) {
    throw new Error("Server profile not found");
  }

  const nextState: PersistedMultiplayerServers = {
    ...state,
    activeServerId: nextId,
  };
  await writePersistedState(nextState);

  const active = nextState.profiles.find((profile) => profile.id === nextId);
  if (!active) throw new Error("Server profile not found");
  return active;
}

export async function saveMultiplayerServerProfile(input: {
  id?: string;
  name: string;
  url: string;
  anonKey: string;
}): Promise<MultiplayerServerProfile> {
  const name = asNonEmptyTrimmedString(input.name);
  const url = asNonEmptyTrimmedString(input.url);
  const anonKey = asNonEmptyTrimmedString(input.anonKey);

  if (!name || !url || !anonKey) {
    throw new Error("Server name, URL and anon key are required.");
  }

  const state = await readPersistedState();
  const now = nowIso();
  const profileId = asNonEmptyTrimmedString(input.id) ?? crypto.randomUUID();

  const builtIn = MULTIPLAYER_BUILTIN_SERVER_PROFILES.find((profile) => profile.id === profileId);
  if (builtIn) {
    const updatedBuiltIn: MultiplayerServerProfile = {
      ...builtIn,
      url,
      anonKey,
      updatedAtIso: now,
    };

    const nextProfiles = state.profiles.map((profile) =>
      profile.id === profileId ? updatedBuiltIn : profile,
    );
    const nextState: PersistedMultiplayerServers = {
      ...state,
      profiles: nextProfiles,
      activeServerId: state.activeServerId,
    };

    await writePersistedState(nextState);
    return updatedBuiltIn;
  }

  const existing = state.profiles.find((profile) => profile.id === profileId);
  const nextProfile: MultiplayerServerProfile = {
    id: profileId,
    name,
    url,
    anonKey,
    isDefault: false,
    createdAtIso: existing?.createdAtIso ?? now,
    updatedAtIso: now,
  };

  const nextProfiles = existing
    ? state.profiles.map((profile) => (profile.id === profileId ? nextProfile : profile))
    : [...state.profiles, nextProfile];

  const nextState: PersistedMultiplayerServers = {
    profiles: nextProfiles,
    activeServerId: state.activeServerId ?? profileId,
  };

  await writePersistedState(nextState);
  return nextProfile;
}

export async function removeMultiplayerServerProfile(serverId: string): Promise<void> {
  if (MULTIPLAYER_BUILTIN_SERVER_PROFILES.some((profile) => profile.id === serverId)) {
    throw new Error("Default server profile cannot be removed.");
  }

  const state = await readPersistedState();
  const nextProfiles = state.profiles.filter((profile) => profile.id !== serverId);

  const nextState: PersistedMultiplayerServers = {
    profiles: nextProfiles.length > 0 ? nextProfiles : [...MULTIPLAYER_BUILTIN_SERVER_PROFILES],
    activeServerId:
      state.activeServerId === serverId
        ? (nextProfiles[0]?.id ?? MULTIPLAYER_BUILTIN_SERVER_PROFILES[0]?.id ?? null)
        : state.activeServerId,
  };

  await writePersistedState(nextState);
}
