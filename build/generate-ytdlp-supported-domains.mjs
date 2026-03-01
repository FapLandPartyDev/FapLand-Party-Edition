import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const configPath = path.join(__dirname, "yt-dlp.config.json");
const outputPath = path.join(repoRoot, "src", "constants", "ytDlpSupportedDomains.generated.json");
const PUBLIC_SUFFIX_LIST_URL = "https://publicsuffix.org/list/public_suffix_list.dat";
const EXTRACTED_HOST_PATTERN = new RegExp(
  String.raw`(?:https?:\\/\\/)?(?:www\\\.)?([a-z0-9.-]+\.[a-z]{2,})(?![a-z0-9.-])`,
  "giu"
);
const REJECTED_SUFFIXES = new Set([
  "jpg",
  "jpeg",
  "png",
  "gif",
  "webp",
  "svg",
  "json",
  "html",
  "shtml",
  "xml",
  "mov",
  "mp4",
  "m4v",
  "m3u8",
  "ts",
  "wav",
  "mp3",
  "zip",
  "pdf",
]);

function buildPublicSuffixMatcher(rawList) {
  const exact = new Set();
  const wildcard = new Set();
  const exception = new Set();

  for (const line of rawList.split(/\r?\n/u)) {
    const trimmed = line.trim().toLowerCase();
    if (!trimmed || trimmed.startsWith("//")) continue;
    if (trimmed.startsWith("!")) {
      exception.add(trimmed.slice(1));
      continue;
    }
    if (trimmed.startsWith("*.")) {
      wildcard.add(trimmed.slice(2));
      continue;
    }
    exact.add(trimmed);
  }

  return (hostname) => {
    const labels = hostname.split(".").filter(Boolean);
    for (let index = 0; index < labels.length; index += 1) {
      const candidate = labels.slice(index).join(".");
      if (exception.has(candidate)) return true;
      if (exact.has(candidate)) return true;
      if (index > 0) {
        const wildcardCandidate = labels.slice(index + 1).join(".");
        if (wildcardCandidate && wildcard.has(wildcardCandidate)) {
          return true;
        }
      }
    }
    return false;
  };
}

function normalizeDomain(input, hasKnownPublicSuffix) {
  if (typeof input !== "string") return null;
  const trimmed = input.trim().toLowerCase().replace(/\.+$/u, "");
  if (!trimmed || trimmed.includes("*")) return null;
  if (!trimmed.includes(".")) return null;
  if (!/^[a-z0-9.-]+$/u.test(trimmed)) return null;
  const labels = trimmed.split(".");
  if (labels.length < 2) return null;
  if (
    labels.some(
      (label) =>
        label.length === 0 ||
        label.length > 63 ||
        !/^[a-z0-9-]+$/u.test(label) ||
        label.startsWith("-") ||
        label.endsWith("-")
    )
  ) {
    return null;
  }
  const tld = labels.at(-1);
  if (!tld || !/^[a-z]{2,24}$/u.test(tld)) return null;
  if (REJECTED_SUFFIXES.has(tld)) return null;
  if (labels.length === 2 && /^\d+$/u.test(labels[0] ?? "")) return null;
  if (!hasKnownPublicSuffix(trimmed)) return null;
  return trimmed;
}

function addCandidate(set, candidate, hasKnownPublicSuffix) {
  const normalized = normalizeDomain(candidate, hasKnownPublicSuffix);
  if (!normalized) return;
  set.add(normalized);
}

function extractDomainsFromRegexSource(source, output, hasKnownPublicSuffix) {
  const hostMatches = source.matchAll(EXTRACTED_HOST_PATTERN);
  for (const match of hostMatches) {
    addCandidate(output, match[1], hasKnownPublicSuffix);
  }
}

async function download(url) {
  const response = await fetch(url, {
    headers: {
      Accept: "application/octet-stream",
      "User-Agent": "f-land-ytdlp-domain-generator",
    },
  });
  if (!response.ok) {
    throw new Error(`Failed to download ${url}: ${response.status} ${response.statusText}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

function readTarEntrySize(header) {
  const raw = header.toString("utf8", 124, 136).replace(/\0.*$/u, "").trim();
  return raw ? Number.parseInt(raw, 8) : 0;
}

function readTarEntries(buffer) {
  const entries = [];
  let offset = 0;
  while (offset + 512 <= buffer.length) {
    const header = buffer.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const name = header.toString("utf8", 0, 100).replace(/\0.*$/u, "");
    const prefix = header.toString("utf8", 345, 500).replace(/\0.*$/u, "");
    const fullName = prefix ? `${prefix}/${name}` : name;
    const size = readTarEntrySize(header);
    const bodyStart = offset + 512;
    const bodyEnd = bodyStart + size;
    entries.push({
      name: fullName,
      body: buffer.subarray(bodyStart, bodyEnd),
    });
    offset = bodyStart + Math.ceil(size / 512) * 512;
  }
  return entries;
}

async function main() {
  const config = JSON.parse(await fs.readFile(configPath, "utf8"));
  const version = String(config.version ?? "").trim();
  if (!version) {
    throw new Error("yt-dlp config version is missing.");
  }

  const archiveUrl = `https://github.com/yt-dlp/yt-dlp/archive/refs/tags/${version}.tar.gz`;
  const tarGz = await download(archiveUrl);
  const publicSuffixList = await download(PUBLIC_SUFFIX_LIST_URL);
  const hasKnownPublicSuffix = buildPublicSuffixMatcher(publicSuffixList.toString("utf8"));
  const tar = zlib.gunzipSync(tarGz);
  const entries = readTarEntries(tar);
  const domains = new Set();

  for (const entry of entries) {
    if (!entry.name.includes("/yt_dlp/extractor/") || !entry.name.endsWith(".py")) continue;
    const source = entry.body.toString("utf8");
    extractDomainsFromRegexSource(source, domains, hasKnownPublicSuffix);
  }

  const payload = {
    generatedFromVersion: version,
    generatedAt: new Date().toISOString(),
    domains: Array.from(domains).sort((a, b) => a.localeCompare(b)),
  };

  await fs.writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log(
    `[yt-dlp] Wrote ${payload.domains.length} supported domains to ${path.relative(repoRoot, outputPath)}`
  );
}

await main();
