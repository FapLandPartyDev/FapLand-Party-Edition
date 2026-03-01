import { normalizeBaseUrl } from "./store";
import type { ExternalSource, StashTagSelection } from "./types";

type GraphQLResult<T> = {
  data?: T;
  errors?: Array<{ message?: string }>;
};

type SessionCacheEntry = {
  scopeKey: string;
  cookieHeader: string;
  createdAtMs: number;
};

const stashSessionCache = new Map<string, SessionCacheEntry>();
const SESSION_TTL_MS = 30 * 60 * 1000;

function extractCookieHeader(response: Response): string | null {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  const fromMethod = typeof headers.getSetCookie === "function" ? headers.getSetCookie() : [];

  const rawList =
    fromMethod.length > 0
      ? fromMethod
      : (() => {
          const header = response.headers.get("set-cookie");
          if (!header) return [] as string[];
          return header.split(/,(?=[^;]+?=)/g);
        })();

  const values = rawList
    .map((value) => value.split(";")[0]?.trim())
    .filter((value): value is string => Boolean(value));

  if (values.length === 0) return null;
  return values.join("; ");
}

function normalizeNullableText(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function buildSessionScopeKey(source: ExternalSource): string {
  return [
    normalizeBaseUrl(source.baseUrl),
    source.authMode,
    normalizeNullableText(source.username) ?? "",
  ].join("|");
}

function stripApiKeyFromUri(input: string | null | undefined, baseUrl?: string): string | null {
  if (typeof input !== "string" || input.trim().length === 0) return null;

  let parsed: URL;
  try {
    parsed = baseUrl ? new URL(input.trim(), normalizeBaseUrl(baseUrl)) : new URL(input.trim());
  } catch {
    return null;
  }

  if (!(parsed.protocol === "http:" || parsed.protocol === "https:")) {
    return null;
  }

  parsed.searchParams.delete("apikey");
  return parsed.toString();
}

function ensureApiKeyQueryParam(source: ExternalSource, targetUrl: string): string {
  if (source.authMode !== "apiKey") {
    return targetUrl;
  }

  const apiKey = normalizeNullableText(source.apiKey);
  if (!apiKey) {
    throw new Error("Missing API key for Stash source.");
  }

  let parsed: URL;
  try {
    parsed = new URL(targetUrl);
  } catch {
    throw new Error("Invalid target URL.");
  }

  if (!parsed.searchParams.has("apikey")) {
    parsed.searchParams.set("apikey", apiKey);
  }

  return parsed.toString();
}

async function ensureLoginSessionCookie(
  source: ExternalSource,
  forceRefresh = false
): Promise<string | null> {
  if (source.authMode !== "login") return null;

  const scopeKey = buildSessionScopeKey(source);
  const cached = stashSessionCache.get(source.id);
  if (
    !forceRefresh &&
    cached &&
    cached.scopeKey === scopeKey &&
    Date.now() - cached.createdAtMs < SESSION_TTL_MS
  ) {
    return cached.cookieHeader;
  }

  const username = normalizeNullableText(source.username);
  const password = normalizeNullableText(source.password);
  if (!username || !password) {
    throw new Error("Missing Stash login credentials.");
  }

  const loginUrl = `${normalizeBaseUrl(source.baseUrl)}/login`;
  const body = new URLSearchParams({ username, password });

  const response = await fetch(loginUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "*/*",
    },
    body: body.toString(),
  });

  if (!response.ok) {
    throw new Error(`Stash login failed with status ${response.status}.`);
  }

  const cookieHeader = extractCookieHeader(response);
  if (!cookieHeader) {
    throw new Error("Stash login did not return session cookies.");
  }

  stashSessionCache.set(source.id, {
    scopeKey,
    cookieHeader,
    createdAtMs: Date.now(),
  });

  return cookieHeader;
}

export async function buildAuthHeaders(
  source: ExternalSource,
  forceRefreshLogin = false
): Promise<Record<string, string>> {
  if (source.authMode === "none") {
    return {};
  }

  if (source.authMode === "apiKey") {
    const apiKey = normalizeNullableText(source.apiKey);
    if (!apiKey) {
      throw new Error("Missing API key for Stash source.");
    }

    return {
      ApiKey: apiKey,
    };
  }

  const cookieHeader = await ensureLoginSessionCookie(source, forceRefreshLogin);
  if (!cookieHeader) {
    throw new Error("Missing Stash session cookie.");
  }

  return {
    Cookie: cookieHeader,
  };
}

export async function executeStashGraphQL<T>(
  source: ExternalSource,
  query: string,
  variables: Record<string, unknown> = {}
): Promise<T> {
  const endpoint = `${normalizeBaseUrl(source.baseUrl)}/graphql`;

  const perform = async (forceRefreshLogin: boolean): Promise<T> => {
    const authHeaders = await buildAuthHeaders(source, forceRefreshLogin);

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        ...authHeaders,
      },
      body: JSON.stringify({ query, variables }),
    });

    if (
      (response.status === 401 || response.status === 403) &&
      source.authMode === "login" &&
      !forceRefreshLogin
    ) {
      return perform(true);
    }

    if (!response.ok) {
      throw new Error(`Stash GraphQL request failed with status ${response.status}.`);
    }

    const json = (await response.json()) as GraphQLResult<T>;
    if (Array.isArray(json.errors) && json.errors.length > 0) {
      const message = json.errors
        .map((error) => error.message)
        .filter((value): value is string => Boolean(value))
        .join("; ");
      throw new Error(message || "Stash GraphQL request failed.");
    }

    if (!json.data) {
      throw new Error("Stash GraphQL returned no data.");
    }

    return json.data;
  };

  return perform(false);
}

type FindTagsData = {
  findTags: {
    count: number;
    tags: Array<{
      id: string;
      name: string;
    }>;
  };
};

export async function searchStashTags(
  source: ExternalSource,
  input: { query: string; page: number; perPage: number }
): Promise<FindTagsData["findTags"]> {
  const data = await executeStashGraphQL<FindTagsData>(
    source,
    `
      query SearchTags($q: String!, $page: Int!, $perPage: Int!) {
        findTags(
          filter: {
            q: $q
            page: $page
            per_page: $perPage
            sort: "name"
            direction: ASC
          }
        ) {
          count
          tags {
            id
            name
          }
        }
      }
    `,
    {
      q: input.query,
      page: input.page,
      perPage: input.perPage,
    }
  );

  return data.findTags;
}

export type StashSceneStreamEndpoint = {
  url: string;
  mime_type: string | null;
  label: string | null;
};

type FindScenesData = {
  findScenes: {
    count: number;
    scenes: Array<{
      id: string;
      title: string | null;
      details: string | null;
      date: string | null;
      studio: { name: string | null } | null;
      performers: Array<{ name: string | null }>;
      paths: {
        screenshot: string | null;
        stream: string | null;
        funscript: string | null;
      };
      sceneStreams: Array<StashSceneStreamEndpoint>;
      files: Array<{
        duration: number | null;
        fingerprint: string | null;
        basename: string | null;
      }>;
      tags: Array<{ id: string; name: string }>;
    }>;
  };
};

export type StashScene = FindScenesData["findScenes"]["scenes"][number];

export async function fetchScenesForTag(
  source: ExternalSource,
  selection: StashTagSelection
): Promise<StashScene[]> {
  const perPage = 100;
  const maxPages = 50;
  const scenes: StashScene[] = [];

  for (let page = 1; page <= maxPages; page += 1) {
    const data = await executeStashGraphQL<FindScenesData>(
      source,
      `
        query FindScenesByTag($tagId: ID!, $page: Int!, $perPage: Int!) {
          findScenes(
            scene_filter: {
              tags: { value: [$tagId], modifier: INCLUDES }
            }
            filter: {
              page: $page
              per_page: $perPage
              sort: "date"
              direction: DESC
            }
          ) {
            count
            scenes {
              id
              title
              details
              date
              studio {
                name
              }
              performers {
                name
              }
              tags {
                id
                name
              }
              paths {
                screenshot
                stream
                funscript
              }
              sceneStreams {
                url
                mime_type
                label
              }
              files {
                duration
                fingerprint(type: "phash")
                basename
              }
            }
          }
        }
      `,
      {
        tagId: selection.id,
        page,
        perPage,
      }
    );

    scenes.push(...data.findScenes.scenes);

    if (data.findScenes.scenes.length < perPage) {
      break;
    }

    if (page * perPage >= data.findScenes.count) {
      break;
    }
  }

  return scenes;
}

export async function testStashConnection(source: ExternalSource): Promise<{ ok: true }> {
  await executeStashGraphQL<{ findTags: { count: number } }>(
    source,
    `
      query TestConnection {
        findTags(filter: { page: 1, per_page: 1 }) {
          count
        }
      }
    `
  );

  return { ok: true };
}

export function sanitizeStashMediaUri(
  uri: string | null | undefined,
  baseUrl?: string
): string | null {
  const stripped = stripApiKeyFromUri(uri, baseUrl);
  return stripped;
}

export function toStashDisplayAuthor(scene: StashScene): string | null {
  const studioName = normalizeNullableText(scene.studio?.name ?? null);
  if (studioName) return studioName;

  const performerName = scene.performers
    .map((performer) => normalizeNullableText(performer.name))
    .find((value): value is string => Boolean(value));
  if (performerName) return performerName;

  return null;
}

export function toNormalizedPhash(value: string | null | undefined): string | null {
  const normalized = normalizeNullableText(value);
  if (!normalized) return null;
  return normalized.toLowerCase();
}

export function selectBrowserCompatibleStreamUrl(
  sceneStreams: Array<StashSceneStreamEndpoint> | null | undefined,
  fallbackStreamUrl: string | null
): string | null {
  if (Array.isArray(sceneStreams) && sceneStreams.length > 0) {
    const mp4Stream = sceneStreams.find(
      (stream) => stream.mime_type && stream.mime_type.toLowerCase().includes("mp4")
    );
    if (mp4Stream) {
      return mp4Stream.url;
    }
  }

  return fallbackStreamUrl ?? null;
}

export function clearStashSessionCache(sourceId?: string): void {
  if (sourceId) {
    stashSessionCache.delete(sourceId);
    return;
  }

  stashSessionCache.clear();
}

const FORWARDED_MEDIA_HEADERS = ["accept", "if-modified-since", "if-none-match", "range"] as const;

function isAllowedMediaProxyMethod(method: string): boolean {
  return method === "GET" || method === "HEAD";
}

function buildForwardHeaders(request: Request): Headers {
  const forwarded = new Headers();

  for (const headerName of FORWARDED_MEDIA_HEADERS) {
    const value = request.headers.get(headerName);
    if (value) {
      forwarded.set(headerName, value);
    }
  }

  return forwarded;
}

export async function fetchStashMediaWithAuth(
  source: ExternalSource,
  targetUrl: string,
  request: Request
): Promise<Response> {
  if (!isAllowedMediaProxyMethod(request.method)) {
    throw new Error("Unsupported proxy method.");
  }

  const run = async (forceRefreshLogin: boolean): Promise<Response> => {
    const authHeaders = await buildAuthHeaders(source, forceRefreshLogin);
    const headers = buildForwardHeaders(request);
    const upstreamTargetUrl = ensureApiKeyQueryParam(source, targetUrl);

    for (const [key, value] of Object.entries(authHeaders)) {
      headers.set(key, value);
    }

    const response = await fetch(upstreamTargetUrl, {
      method: request.method,
      headers,
    });

    if (
      (response.status === 401 || response.status === 403) &&
      source.authMode === "login" &&
      !forceRefreshLogin
    ) {
      return run(true);
    }

    return response;
  };

  return run(false);
}
