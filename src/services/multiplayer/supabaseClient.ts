import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import { trpc } from "../trpc";
import { getActiveMultiplayerServerProfile } from "./serverProfiles";
import type {
  MultiplayerAuthRequirement,
  MultiplayerAuthStatus,
  MultiplayerServerProfile,
} from "./types";

type SupabaseClientCacheEntry = {
  cacheKey: string;
  client: SupabaseClient;
};

const clientCache = new Map<string, SupabaseClientCacheEntry>();
const authRefreshListeners = new Set<() => void>();
let machineIdPromise: Promise<string> | null = null;

function toCacheKey(profile: MultiplayerServerProfile): string {
  return `${profile.id}:${profile.url}:${profile.anonKey.slice(0, 12)}`;
}

function toErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  if (
    error &&
    typeof error === "object" &&
    "message" in error &&
    typeof (error as { message?: unknown }).message === "string"
  ) {
    return (error as { message: string }).message;
  }

  return fallback;
}

function isDiscordLinkUnavailableError(error: unknown): boolean {
  const message = toErrorMessage(error, "").toLowerCase();
  return (
    message.includes("unsupported provider") ||
    message.includes("unrecognized oauth provider") ||
    message.includes("provider is not enabled") ||
    message.includes("manual linking is disabled") ||
    message.includes("identity linking is disabled")
  );
}

function isAnonymousUser(user: User): boolean {
  if ("is_anonymous" in user && typeof user.is_anonymous === "boolean") {
    return user.is_anonymous;
  }

  const provider =
    typeof user.app_metadata?.provider === "string" ? user.app_metadata.provider : "";
  return provider === "anonymous";
}

function hasDiscordIdentity(user: User): boolean {
  return (user.identities ?? []).some((identity) => identity.provider === "discord");
}

function hasUsableEmail(user: User): boolean {
  return typeof user.email === "string" && user.email.trim().length > 0;
}

function notifyAuthRefreshListeners(): void {
  for (const listener of authRefreshListeners) {
    listener();
  }
}

function buildAuthStatus(input: {
  profile: MultiplayerServerProfile;
  client: SupabaseClient;
  user: User;
  requirement: MultiplayerAuthRequirement;
  discordLinkUrl?: string | null;
}): MultiplayerAuthStatus {
  const hasDiscord = hasDiscordIdentity(input.user);
  const hasEmail = hasUsableEmail(input.user);
  const isAnonymous = isAnonymousUser(input.user);

  if (input.requirement === "anonymous_only") {
    return {
      profile: input.profile,
      client: input.client,
      user: input.user,
      requirement: input.requirement,
      isAnonymous,
      hasDiscordIdentity: hasDiscord,
      hasEmail,
      discordLinkUrl: input.discordLinkUrl ?? null,
      status: "ready",
      message: "This server allows anonymous multiplayer.",
    };
  }

  if (!hasDiscord) {
    return {
      profile: input.profile,
      client: input.client,
      user: input.user,
      requirement: input.requirement,
      isAnonymous,
      hasDiscordIdentity: hasDiscord,
      hasEmail,
      discordLinkUrl: input.discordLinkUrl ?? null,
      status: "needs_discord",
      message: isAnonymous
        ? "Link a Discord account with email to upgrade this anonymous multiplayer account."
        : "Link your Discord account with email before entering multiplayer.",
    };
  }

  if (!hasEmail) {
    return {
      profile: input.profile,
      client: input.client,
      user: input.user,
      requirement: input.requirement,
      isAnonymous,
      hasDiscordIdentity: hasDiscord,
      hasEmail,
      discordLinkUrl: input.discordLinkUrl ?? null,
      status: "needs_email",
      message:
        "This Discord-linked account has no email attached. Add an email in Discord and recheck.",
    };
  }

  return {
    profile: input.profile,
    client: input.client,
    user: input.user,
    requirement: input.requirement,
    isAnonymous,
    hasDiscordIdentity: hasDiscord,
    hasEmail,
    discordLinkUrl: input.discordLinkUrl ?? null,
    status: "ready",
    message: "Discord is linked and ready for multiplayer.",
  };
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

export async function getSupabaseClientForProfile(
  profile?: MultiplayerServerProfile
): Promise<{ profile: MultiplayerServerProfile; client: SupabaseClient }> {
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

export async function ensureMultiplayerAuth(
  profile?: MultiplayerServerProfile
): Promise<{ profile: MultiplayerServerProfile; client: SupabaseClient; user: User }> {
  const { profile: resolvedProfile, client } = await getSupabaseClientForProfile(profile);
  const { data, error } = await client.auth.getSession();
  if (error) {
    throw new Error(`Failed to read Supabase session: ${error.message}`);
  }

  const session = data.session;
  if (session?.user) {
    return { profile: resolvedProfile, client, user: session.user };
  }

  const authRequirement = resolvedProfile.authRequirement ?? "anonymous_only";
  if (authRequirement === "email_password_required") {
    // If we require email login, we don't auto-sign in anonymously.
    // Instead, we throw or return what we have (null user), allowing resolveMultiplayerAuthStatus to handle it.
    if (session?.user) {
      return { profile: resolvedProfile, client, user: session.user };
    }
    throw new Error("Authentication required.");
  }

  const signInResult = await client.auth.signInAnonymously();
  if (signInResult.error || !signInResult.data.user) {
    throw new Error(signInResult.error?.message ?? "Failed to sign in anonymously.");
  }

  return { profile: resolvedProfile, client, user: signInResult.data.user };
}

export function getMultiplayerAuthRedirectUrl(): string {
  if (
    typeof window !== "undefined" &&
    window.location.protocol !== "http:" &&
    window.location.protocol !== "https:"
  ) {
    return "fland://auth/callback";
  }

  if (typeof window !== "undefined") {
    return new URL("/multiplayer", window.location.origin).toString();
  }

  return "fland://auth/callback";
}

export async function resolveMultiplayerAuthStatus(
  profile?: MultiplayerServerProfile
): Promise<MultiplayerAuthStatus> {
  const { profile: resolvedProfile, client } = await getSupabaseClientForProfile(profile);

  const requirement = resolvedProfile.authRequirement ?? "anonymous_only";

  try {
    await ensureMultiplayerAuth(resolvedProfile);
  } catch (error) {
    if (requirement === "email_password_required") {
      // If we failed ensureMultiplayerAuth because of requirement, we just proceed to resolve status
    } else {
      throw error;
    }
  }

  const userResult = await client.auth.getUser();
  if (userResult.error || !userResult.data.user) {
    throw new Error(userResult.error?.message ?? "Failed to load multiplayer account.");
  }

  let user = userResult.data.user;
  const identitiesResult = await client.auth.getUserIdentities();
  if (!identitiesResult.error && identitiesResult.data?.identities) {
    user = {
      ...user,
      identities: identitiesResult.data.identities,
    };
  }

  if (requirement === "email_password_required" && (isAnonymousUser(user) || !user.email)) {
    return {
      profile: resolvedProfile,
      client,
      user,
      requirement: "email_password_required",
      isAnonymous: isAnonymousUser(user),
      hasDiscordIdentity: hasDiscordIdentity(user),
      hasEmail: hasUsableEmail(user),
      discordLinkUrl: null,
      status: "needs_login",
      message: "This server requires email and password authentication.",
    };
  }

  if (hasDiscordIdentity(user)) {
    return buildAuthStatus({
      profile: resolvedProfile,
      client,
      user,
      requirement: "discord_required",
    });
  }

  const linkProbe = await client.auth.linkIdentity({
    provider: "discord",
    options: {
      redirectTo: getMultiplayerAuthRedirectUrl(),
      skipBrowserRedirect: true,
      scopes: "identify email",
    },
  });

  if (linkProbe.error) {
    if (isDiscordLinkUnavailableError(linkProbe.error)) {
      return buildAuthStatus({
        profile: resolvedProfile,
        client,
        user,
        requirement: "anonymous_only",
      });
    }

    throw new Error(linkProbe.error.message);
  }

  const discordLinkUrl = linkProbe.data?.url ?? null;
  if (!discordLinkUrl) {
    return {
      profile: resolvedProfile,
      client,
      user,
      requirement: "discord_required",
      isAnonymous: isAnonymousUser(user),
      hasDiscordIdentity: false,
      hasEmail: hasUsableEmail(user),
      discordLinkUrl: null,
      status: "oauth_unavailable",
      message:
        "Discord auth is configured on this server, but the OAuth link could not be prepared.",
    };
  }

  return buildAuthStatus({
    profile: resolvedProfile,
    client,
    user,
    requirement: "discord_required",
    discordLinkUrl,
  });
}

export async function startDiscordMultiplayerLink(
  profile?: MultiplayerServerProfile
): Promise<void> {
  const { profile: resolvedProfile, client } = await getSupabaseClientForProfile(profile);
  await ensureMultiplayerAuth(resolvedProfile);

  const result = await client.auth.linkIdentity({
    provider: "discord",
    options: {
      redirectTo: getMultiplayerAuthRedirectUrl(),
      scopes: "identify email",
    },
  });

  if (result.error) {
    throw new Error(result.error.message);
  }
}

export async function signInWithMultiplayerEmail(
  email: string,
  password: string,
  profile?: MultiplayerServerProfile
): Promise<void> {
  const { client } = await getSupabaseClientForProfile(profile);
  const result = await client.auth.signInWithPassword({
    email,
    password,
  });

  if (result.error) {
    throw new Error(result.error.message);
  }

  notifyAuthRefreshListeners();
}

export async function signUpWithMultiplayerEmail(
  email: string,
  password: string,
  profile?: MultiplayerServerProfile
): Promise<void> {
  const { client } = await getSupabaseClientForProfile(profile);
  const result = await client.auth.signUp({
    email,
    password,
  });

  if (result.error) {
    throw new Error(result.error.message);
  }

  notifyAuthRefreshListeners();
}

export async function handleMultiplayerAuthCallback(
  callbackUrl: string,
  profile?: MultiplayerServerProfile
): Promise<boolean> {
  let parsed: URL;
  try {
    parsed = new URL(callbackUrl);
  } catch {
    return false;
  }

  if (parsed.protocol !== "fland:" && parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return false;
  }

  const code = parsed.searchParams.get("code");
  if (!code) return false;

  const { client } = await getSupabaseClientForProfile(profile);
  const result = await client.auth.exchangeCodeForSession(code);
  if (result.error) {
    throw new Error(result.error.message);
  }

  notifyAuthRefreshListeners();
  return true;
}

export function subscribeToMultiplayerAuthRefresh(callback: () => void): () => void {
  authRefreshListeners.add(callback);
  return () => {
    authRefreshListeners.delete(callback);
  };
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
