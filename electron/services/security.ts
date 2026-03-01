import ytDlpSupportedDomains from "../../src/constants/ytDlpSupportedDomains.generated.json";
import { DEFAULT_TRUSTED_REMOTE_SITES } from "../../src/constants/defaultTrustedRemoteSites";
import { getStore } from "./store";
import { listExternalSources, normalizeBaseUrl } from "./integrations/store";

const SECURITY_TRUSTED_BASE_DOMAINS_KEY = "security.trustedBaseDomains";
const SECURITY_MODE_KEY = "security.mode";

export type TrustedSiteDecision = "trusted" | "blocked";
export type EffectiveTrustedSiteSource = "built_in_stash" | "built_in_ytdlp" | "user";
type SecurityMode = "prompt" | "block" | "paranoid";

export type ImportRemoteSiteMatch = {
  baseDomain: string;
  host: string;
  source: EffectiveTrustedSiteSource | null;
  decision: TrustedSiteDecision;
  sampleUrls: string[];
  videoUrlCount: number;
  funscriptUrlCount: number;
};

export type InstallSidecarSecurityAnalysis = {
  filePath: string;
  contentName: string;
  entries: ImportRemoteSiteMatch[];
  unknownEntries: ImportRemoteSiteMatch[];
};

export type ImportSecurityWarning = {
  baseDomain: string;
  host: string;
  message: string;
  videoUrlCount: number;
  funscriptUrlCount: number;
};

type CollectedRemoteSite = {
  host: string;
  sampleUrls: Set<string>;
  videoUrlCount: number;
  funscriptUrlCount: number;
};

function sortUnique(values: Iterable<string>): string[] {
  return [
    ...new Set(
      Array.from(values)
        .map((value) => value.trim())
        .filter(Boolean)
    ),
  ].sort((a, b) => a.localeCompare(b));
}

function normalizeHostLike(value: string): string | null {
  const trimmed = value.trim().toLowerCase().replace(/\.+$/u, "");
  if (!trimmed) return null;
  return trimmed;
}

function getStoredTrustedBaseDomains(): string[] {
  const raw = getStore().get(SECURITY_TRUSTED_BASE_DOMAINS_KEY);
  if (!Array.isArray(raw)) {
    getStore().set(SECURITY_TRUSTED_BASE_DOMAINS_KEY, []);
    return [];
  }
  const normalized = sortUnique(
    raw.flatMap((entry) => {
      if (typeof entry !== "string") return [];
      const parsed = normalizeTrustedBaseDomain(entry);
      return parsed ? [parsed] : [];
    })
  );
  getStore().set(SECURITY_TRUSTED_BASE_DOMAINS_KEY, normalized);
  return normalized;
}

export function getSecurityMode(): SecurityMode {
  const raw = getStore().get(SECURITY_MODE_KEY);
  if (raw === "prompt" || raw === "block" || raw === "paranoid") {
    return raw;
  }
  getStore().set(SECURITY_MODE_KEY, "block");
  return "block";
}

export function setSecurityMode(mode: SecurityMode): SecurityMode {
  getStore().set(SECURITY_MODE_KEY, mode);
  return mode;
}

function isIpHost(hostname: string): boolean {
  return /^\d{1,3}(?:\.\d{1,3}){3}$/u.test(hostname) || hostname.includes(":");
}

const COMMON_SECOND_LEVEL_SUFFIXES = new Set([
  "co.uk",
  "org.uk",
  "gov.uk",
  "ac.uk",
  "com.au",
  "net.au",
  "org.au",
  "co.nz",
  "com.br",
  "com.mx",
  "co.jp",
]);

function toRegistrableDomain(hostname: string): string {
  const labels = hostname.split(".").filter(Boolean);
  if (labels.length <= 2) return hostname;
  const suffix = labels.slice(-2).join(".");
  if (COMMON_SECOND_LEVEL_SUFFIXES.has(suffix) && labels.length >= 3) {
    return labels.slice(-3).join(".");
  }
  return labels.slice(-2).join(".");
}

export function normalizeTrustedBaseDomain(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  let hostname = trimmed;
  try {
    hostname = new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`).hostname;
  } catch {
    return null;
  }

  const normalizedHost = normalizeHostLike(hostname);
  if (!normalizedHost) return null;
  if (normalizedHost === "localhost" || isIpHost(normalizedHost)) return normalizedHost;
  return toRegistrableDomain(normalizedHost);
}

function isRemoteHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value.trim());
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function getHostForRemoteUrl(url: string): string | null {
  try {
    return normalizeHostLike(new URL(url).hostname);
  } catch {
    return null;
  }
}

function isHostWithinScope(host: string, allowedHostOrDomain: string): boolean {
  return host === allowedHostOrDomain || host.endsWith(`.${allowedHostOrDomain}`);
}

export function listTrustedSites(): {
  securityMode: SecurityMode;
  builtInStashHosts: string[];
  builtInYtDlpDomains: string[];
  userTrustedBaseDomains: string[];
} {
  const builtInStashHosts = sortUnique(
    listExternalSources().flatMap((source) => {
      try {
        return [new URL(normalizeBaseUrl(source.baseUrl)).hostname.toLowerCase()];
      } catch {
        return [];
      }
    })
  );

  const builtInYtDlpDomains = sortUnique([
    ...(Array.isArray(ytDlpSupportedDomains.domains) ? ytDlpSupportedDomains.domains : []),
    ...DEFAULT_TRUSTED_REMOTE_SITES,
  ]);

  const userTrustedBaseDomains = getStoredTrustedBaseDomains();
  return {
    securityMode: getSecurityMode(),
    builtInStashHosts,
    builtInYtDlpDomains,
    userTrustedBaseDomains,
  };
}

export function addTrustedSite(baseDomain: string): string[] {
  const normalized = normalizeTrustedBaseDomain(baseDomain);
  if (!normalized) {
    throw new Error("Trusted site must be a valid domain, hostname, localhost, or IP address.");
  }
  const next = sortUnique([...getStoredTrustedBaseDomains(), normalized]);
  getStore().set(SECURITY_TRUSTED_BASE_DOMAINS_KEY, next);
  return next;
}

export function removeTrustedSite(baseDomain: string): string[] {
  const normalized = normalizeTrustedBaseDomain(baseDomain);
  if (!normalized) return getStoredTrustedBaseDomains();
  const next = getStoredTrustedBaseDomains().filter((entry) => entry !== normalized);
  getStore().set(SECURITY_TRUSTED_BASE_DOMAINS_KEY, next);
  return next;
}

export function classifyTrustedUrl(
  url: string,
  allowedBaseDomains: Iterable<string> = [],
  securityMode = getSecurityMode()
): {
  baseDomain: string;
  host: string;
  source: EffectiveTrustedSiteSource | null;
  decision: TrustedSiteDecision;
} | null {
  if (!isRemoteHttpUrl(url)) return null;
  const host = getHostForRemoteUrl(url);
  if (!host) return null;
  const baseDomain = normalizeTrustedBaseDomain(host) ?? host;

  const { builtInStashHosts, builtInYtDlpDomains, userTrustedBaseDomains } = listTrustedSites();
  const allowedNow = sortUnique([...userTrustedBaseDomains, ...Array.from(allowedBaseDomains)]);

  if (builtInStashHosts.some((entry) => isHostWithinScope(host, entry))) {
    return { baseDomain, host, source: "built_in_stash", decision: "trusted" };
  }
  if (securityMode === "paranoid") {
    return { baseDomain, host, source: null, decision: "blocked" };
  }
  if (builtInYtDlpDomains.some((entry) => isHostWithinScope(host, entry))) {
    return { baseDomain, host, source: "built_in_ytdlp", decision: "trusted" };
  }
  if (allowedNow.some((entry) => isHostWithinScope(host, entry))) {
    return { baseDomain, host, source: "user", decision: "trusted" };
  }

  return { baseDomain, host, source: null, decision: "blocked" };
}

export function collectUnknownRemoteSitesFromResources(
  filePath: string,
  contentName: string,
  resources: Iterable<{ videoUri: string; funscriptUri?: string | null }>,
  allowedBaseDomains: Iterable<string> = [],
  securityMode = getSecurityMode()
): InstallSidecarSecurityAnalysis {
  const collected = new Map<string, CollectedRemoteSite>();

  const remember = (url: string, kind: "video" | "funscript") => {
    const classified = classifyTrustedUrl(url, allowedBaseDomains, securityMode);
    if (!classified || classified.decision === "trusted") return;
    const existing = collected.get(classified.baseDomain) ?? {
      host: classified.host,
      sampleUrls: new Set(),
      videoUrlCount: 0,
      funscriptUrlCount: 0,
    };
    existing.sampleUrls.add(url);
    if (kind === "video") existing.videoUrlCount += 1;
    else existing.funscriptUrlCount += 1;
    collected.set(classified.baseDomain, existing);
  };

  for (const resource of resources) {
    remember(resource.videoUri, "video");
    if (resource.funscriptUri) {
      remember(resource.funscriptUri, "funscript");
    }
  }

  const entries = Array.from(collected.entries())
    .map(([baseDomain, entry]) => ({
      baseDomain,
      host: entry.host,
      source: null,
      decision: "blocked" as const,
      sampleUrls: Array.from(entry.sampleUrls)
        .sort((a, b) => a.localeCompare(b))
        .slice(0, 3),
      videoUrlCount: entry.videoUrlCount,
      funscriptUrlCount: entry.funscriptUrlCount,
    }))
    .sort((a, b) => a.baseDomain.localeCompare(b.baseDomain));

  return {
    filePath,
    contentName,
    entries,
    unknownEntries: entries,
  };
}
