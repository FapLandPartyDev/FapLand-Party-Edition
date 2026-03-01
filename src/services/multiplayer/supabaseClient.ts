import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import { trpc } from "../trpc";
import {
  getActiveMultiplayerServerProfile,
} from "./serverProfiles";
import type { MultiplayerServerProfile } from "./types";

type SupabaseClientCacheEntry = {
  cacheKey: string;
  client: SupabaseClient;
};

const clientCache = new Map<string, SupabaseClientCacheEntry>();
let machineIdPromise: Promise<string> | null = null;

function toCacheKey(profile: MultiplayerServerProfile): string {
  return `${profile.id}:${profile.url}:${profile.anonKey.slice(0, 12)}`;
}

export function buildSupabaseClient(profile: MultiplayerServerProfile): SupabaseClient {
  return createClient(profile.url, profile.anonKey, {
    auth: {
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
      storageKey: `f-land.multiplayer.supabase.${profile.id}`,
    },
  });
}

export async function getSupabaseClientForProfile(profile?: MultiplayerServerProfile): Promise<{ profile: MultiplayerServerProfile; client: SupabaseClient }> {
  const resolvedProfile = profile ?? (await getActiveMultiplayerServerProfile());
  const cacheKey = toCacheKey(resolvedProfile);
  const cached = clientCache.get(resolvedProfile.id);
  if (cached && cached.cacheKey === cacheKey) {
    return { profile: resolvedProfile, client: cached.client };
  }

  const nextClient = buildSupabaseClient(resolvedProfile);
  clientCache.set(resolvedProfile.id, { cacheKey, client: nextClient });
  return { profile: resolvedProfile, client: nextClient };
}

export async function ensureMultiplayerAuth(profile?: MultiplayerServerProfile): Promise<{ profile: MultiplayerServerProfile; client: SupabaseClient; user: User }> {
  const { profile: resolvedProfile, client } = await getSupabaseClientForProfile(profile);
  const { data, error } = await client.auth.getSession();
  if (error) {
    throw new Error(`Failed to read Supabase session: ${error.message}`);
  }

  const session = data.session;
  if (session?.user) {
    return { profile: resolvedProfile, client, user: session.user };
  }

  const signInResult = await client.auth.signInAnonymously();
  if (signInResult.error || !signInResult.data.user) {
    throw new Error(signInResult.error?.message ?? "Failed to sign in anonymously.");
  }

  return { profile: resolvedProfile, client, user: signInResult.data.user };
}

export async function getMachineIdHash(): Promise<string> {
  if (!machineIdPromise) {
    machineIdPromise = trpc.machineId.getMachineId.query();
  }
  return machineIdPromise;
}

export async function getMultiplayerContext(profile?: MultiplayerServerProfile): Promise<{
  profile: MultiplayerServerProfile;
  client: SupabaseClient;
  user: User;
  machineIdHash: string;
}> {
  const [{ profile: resolvedProfile, client, user }, machineIdHash] = await Promise.all([
    ensureMultiplayerAuth(profile),
    getMachineIdHash(),
  ]);

  return {
    profile: resolvedProfile,
    client,
    user,
    machineIdHash,
  };
}

export function clearMultiplayerClientCache(serverId?: string): void {
  if (!serverId) {
    clientCache.clear();
    return;
  }

  clientCache.delete(serverId);
}
