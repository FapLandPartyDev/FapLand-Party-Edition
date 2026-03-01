import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const configPath = path.join(__dirname, "yt-dlp.config.json");
const rawArgs = new Set(process.argv.slice(2));
const shouldRefreshLatest = rawArgs.has("--latest");
const config = JSON.parse(await fs.readFile(configPath, "utf8"));

const targetKey =
  process.platform === "win32" ? "win32-x64" : process.platform === "linux" ? "linux-x64" : null;
if (!targetKey) {
  console.log(`[yt-dlp] Skipping unsupported packaging platform: ${process.platform}`);
  process.exit(0);
}

const TARGETS = {
  "linux-x64": {
    assetName: "yt-dlp_linux",
    binaryName: "yt-dlp",
  },
  "win32-x64": {
    assetName: "yt-dlp.exe",
    binaryName: "yt-dlp.exe",
  },
};

function normalizeDigest(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.replace(/^sha256:/i, "");
}

async function fetchLatestReleaseConfig() {
  const response = await fetch("https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest", {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "f-land-build-fetch-ytdlp",
    },
  });
  if (!response.ok) {
    throw new Error(
      `Failed to fetch latest yt-dlp release metadata: ${response.status} ${response.statusText}`
    );
  }

  const release = await response.json();
  const assets = new Map(
    (Array.isArray(release.assets) ? release.assets : []).map((asset) => [asset.name, asset])
  );

  const nextTargets = {};
  for (const [key, target] of Object.entries(TARGETS)) {
    const asset = assets.get(target.assetName);
    const sha256 = normalizeDigest(asset?.digest);
    if (!asset || !sha256) {
      throw new Error(`Latest yt-dlp release is missing asset or digest for ${target.assetName}.`);
    }
    nextTargets[key] = {
      assetName: target.assetName,
      binaryName: target.binaryName,
      sha256,
    };
  }

  return {
    version: String(release.tag_name ?? "").trim(),
    targets: nextTargets,
  };
}

async function saveConfig(nextConfig) {
  await fs.writeFile(configPath, `${JSON.stringify(nextConfig, null, 2)}\n`, "utf8");
}

const effectiveConfig = shouldRefreshLatest ? await fetchLatestReleaseConfig() : config;
if (shouldRefreshLatest) {
  await saveConfig(effectiveConfig);
  console.log(`[yt-dlp] Refreshed config to latest release ${effectiveConfig.version}`);
}

const target = effectiveConfig.targets?.[targetKey];
if (!target) {
  throw new Error(`No yt-dlp target config found for ${targetKey}.`);
}

const outputDir = path.join(repoRoot, "build", "vendor", "yt-dlp", targetKey);
const outputPath = path.join(outputDir, target.binaryName);
const downloadUrl = `https://github.com/yt-dlp/yt-dlp/releases/download/${effectiveConfig.version}/${target.assetName}`;

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function sha256File(filePath) {
  const content = await fs.readFile(filePath);
  return crypto.createHash("sha256").update(content).digest("hex");
}

async function ensureExecutable(filePath) {
  if (process.platform !== "win32") {
    await fs.chmod(filePath, 0o755);
  }
}

async function downloadFile(url, outputFile) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download ${url}: ${response.status} ${response.statusText}`);
  }

  const body = Buffer.from(await response.arrayBuffer());
  const digest = crypto.createHash("sha256").update(body).digest("hex");
  if (digest !== target.sha256) {
    throw new Error(
      `Checksum mismatch for ${target.assetName}: expected ${target.sha256}, got ${digest}`
    );
  }

  const tempPath = `${outputFile}.tmp`;
  await fs.writeFile(tempPath, body);
  await fs.rename(tempPath, outputFile);
}

await fs.mkdir(outputDir, { recursive: true });

if (await fileExists(outputPath)) {
  const existingDigest = await sha256File(outputPath);
  if (existingDigest === target.sha256) {
    await ensureExecutable(outputPath);
    console.log(`[yt-dlp] Using cached ${target.assetName} (${effectiveConfig.version})`);
    process.exit(0);
  }
}

console.log(`[yt-dlp] Downloading ${target.assetName} (${effectiveConfig.version})`);
await downloadFile(downloadUrl, outputPath);
await ensureExecutable(outputPath);
console.log(`[yt-dlp] Ready at ${path.relative(repoRoot, outputPath)}`);
