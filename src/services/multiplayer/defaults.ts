import type { MultiplayerServerProfile } from "./types";

const nowIso = () => new Date().toISOString();
const isDevelopmentMode = import.meta.env.DEV;

const DEFAULT_SUPABASE_URL =
  typeof import.meta.env.VITE_MULTIPLAYER_DEFAULT_SUPABASE_URL === "string" &&
  import.meta.env.VITE_MULTIPLAYER_DEFAULT_SUPABASE_URL.trim().length > 0
    ? import.meta.env.VITE_MULTIPLAYER_DEFAULT_SUPABASE_URL.trim()
    : "https://example.supabase.co";

const DEFAULT_SUPABASE_ANON_KEY =
  typeof import.meta.env.VITE_MULTIPLAYER_DEFAULT_SUPABASE_ANON_KEY === "string" &&
  import.meta.env.VITE_MULTIPLAYER_DEFAULT_SUPABASE_ANON_KEY.trim().length > 0
    ? import.meta.env.VITE_MULTIPLAYER_DEFAULT_SUPABASE_ANON_KEY.trim()
    : "public-anon-key-placeholder";

const DEV_SUPABASE_URL =
  typeof import.meta.env.VITE_MULTIPLAYER_DEVELOPMENT_SUPABASE_URL === "string" &&
  import.meta.env.VITE_MULTIPLAYER_DEVELOPMENT_SUPABASE_URL.trim().length > 0
    ? import.meta.env.VITE_MULTIPLAYER_DEVELOPMENT_SUPABASE_URL.trim()
    : "http://127.0.0.1:54321";

const DEV_SUPABASE_ANON_KEY =
  typeof import.meta.env.VITE_MULTIPLAYER_DEVELOPMENT_SUPABASE_ANON_KEY === "string" &&
  import.meta.env.VITE_MULTIPLAYER_DEVELOPMENT_SUPABASE_ANON_KEY.trim().length > 0
    ? import.meta.env.VITE_MULTIPLAYER_DEVELOPMENT_SUPABASE_ANON_KEY.trim()
    : "public-anon-key-placeholder";

export const MULTIPLAYER_DEFAULT_SERVER_ID = "default-server";
export const MULTIPLAYER_DEVELOPMENT_SERVER_ID = "development-server";

export const MULTIPLAYER_DEFAULT_SERVER_PROFILE: MultiplayerServerProfile = {
  id: MULTIPLAYER_DEFAULT_SERVER_ID,
  name: "F-Land Online",
  url: DEFAULT_SUPABASE_URL,
  anonKey: DEFAULT_SUPABASE_ANON_KEY,
  isDefault: true,
  createdAtIso: nowIso(),
  updatedAtIso: nowIso(),
};

export const MULTIPLAYER_DEVELOPMENT_SERVER_PROFILE: MultiplayerServerProfile = {
  id: MULTIPLAYER_DEVELOPMENT_SERVER_ID,
  name: "Development (Local Supabase)",
  url: DEV_SUPABASE_URL,
  anonKey: DEV_SUPABASE_ANON_KEY,
  isDefault: true,
  createdAtIso: nowIso(),
  updatedAtIso: nowIso(),
};

export const MULTIPLAYER_BUILTIN_SERVER_PROFILES: MultiplayerServerProfile[] = isDevelopmentMode
  ? [MULTIPLAYER_DEFAULT_SERVER_PROFILE, MULTIPLAYER_DEVELOPMENT_SERVER_PROFILE]
  : [MULTIPLAYER_DEFAULT_SERVER_PROFILE];

export function isLikelyConfiguredSupabaseServer(profile: MultiplayerServerProfile): boolean {
  if (profile.url.includes("example.supabase.co")) return false;
  if (profile.anonKey.includes("placeholder")) return false;
  return profile.url.length > 0 && profile.anonKey.length > 0;
}
