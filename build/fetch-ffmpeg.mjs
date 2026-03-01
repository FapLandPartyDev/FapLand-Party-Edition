import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

const targetKey =
  process.platform === "win32" ? "win32-x64" : process.platform === "linux" ? "linux-x64" : null;
if (!targetKey) {
  console.log(`[ffmpeg] Skipping unsupported packaging platform: ${process.platform}`);
  process.exit(0);
}

const TARGETS = {
  "linux-x64": {
    assetPattern: /^ffmpeg-master-latest-linux64-gpl\.tar\.xz$/,
    archiveType: "tar.xz",
    ffmpegBinaryName: "ffmpeg",
    ffprobeBinaryName: "ffprobe",
  },
  "win32-x64": {
    assetPattern: /^ffmpeg-master-latest-win64-gpl\.zip$/,
    archiveType: "zip",
    ffmpegBinaryName: "ffmpeg.exe",
    ffprobeBinaryName: "ffprobe.exe",
  },
};

const RELEASE_API_URL = "https://api.github.com/repos/BtbN/FFmpeg-Builds/releases/latest";
const FETCH_ATTEMPTS = 6;
const FETCH_RETRY_DELAY_MS = 10_000;

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function normalizeDigest(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.replace(/^sha256:/i, "");
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "f-land-build-fetch-ffmpeg",
    },
  });
  if (!response.ok) {
    throw new Error(
      `Failed to fetch latest FFmpeg release metadata: ${response.status} ${response.statusText}`
    );
  }
  return response.json();
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "f-land-build-fetch-ffmpeg",
    },
  });
  if (!response.ok) {
    throw new Error(`Failed to download ${url}: ${response.status} ${response.statusText}`);
  }
  return response.text();
}

function parseChecksumsSha256(content) {
  const checksums = new Map();
  for (const line of content.split(/\r?\n/)) {
    const match = /^([a-f0-9]{64})\s+\*?(.+?)\s*$/i.exec(line);
    if (match) {
      checksums.set(match[2], match[1].toLowerCase());
    }
  }
  return checksums;
}

async function fetchChecksumFromAsset(release, assetName) {
  const checksumAsset = (Array.isArray(release.assets) ? release.assets : []).find(
    (entry) => entry?.name === "checksums.sha256"
  );
  const checksumUrl = String(checksumAsset?.browser_download_url ?? "").trim();
  if (!checksumUrl) return null;

  const checksums = parseChecksumsSha256(await fetchText(checksumUrl));
  return checksums.get(assetName) ?? null;
}

async function fetchLatestTargetOnce() {
  const release = await fetchJson(RELEASE_API_URL);
  const target = TARGETS[targetKey];
  const asset = (Array.isArray(release.assets) ? release.assets : []).find(
    (entry) => entry?.name && target.assetPattern.test(entry.name)
  );
  const sha256 =
    normalizeDigest(asset?.digest) ??
    (asset?.name ? await fetchChecksumFromAsset(release, asset.name) : null);

  if (!asset || !sha256) {
    throw new Error(
      `Latest FFmpeg release is missing asset matching ${target.assetPattern} or its digest.`
    );
  }

  return {
    releaseName: String(release.name ?? "latest").trim() || "latest",
    publishedAt: String(release.published_at ?? "").trim() || null,
    assetName: asset.name,
    archiveType: target.archiveType,
    ffmpegBinaryName: target.ffmpegBinaryName,
    ffprobeBinaryName: target.ffprobeBinaryName,
    sha256,
    downloadUrl: String(asset.browser_download_url ?? "").trim(),
  };
}

async function fetchLatestTarget() {
  let lastError = null;
  for (let attempt = 1; attempt <= FETCH_ATTEMPTS; attempt += 1) {
    try {
      return await fetchLatestTargetOnce();
    } catch (error) {
      lastError = error;
      if (attempt === FETCH_ATTEMPTS) break;
      console.warn(
        `[ffmpeg] Latest release metadata is not ready yet (${error.message}); retrying in ${
          FETCH_RETRY_DELAY_MS / 1000
        }s (${attempt}/${FETCH_ATTEMPTS})`
      );
      await sleep(FETCH_RETRY_DELAY_MS);
    }
  }
  throw lastError;
}

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

async function loadManifest(manifestPath) {
  try {
    return JSON.parse(await fs.readFile(manifestPath, "utf8"));
  } catch {
    return null;
  }
}

function runCommand(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: repoRoot,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} exited with code ${code}: ${stderr.trim()}`.trim()));
    });
  });
}

async function downloadFile(url, outputFile, expectedSha256) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download ${url}: ${response.status} ${response.statusText}`);
  }

  const body = Buffer.from(await response.arrayBuffer());
  const digest = crypto.createHash("sha256").update(body).digest("hex");
  if (digest !== expectedSha256) {
    throw new Error(
      `Checksum mismatch for ${path.basename(outputFile)}: expected ${expectedSha256}, got ${digest}`
    );
  }

  const tempPath = `${outputFile}.tmp`;
  await fs.writeFile(tempPath, body);
  await fs.rename(tempPath, outputFile);
}

async function extractArchive(archivePath, archiveType, destinationDir) {
  if (archiveType === "zip") {
    await runCommand("unzip", ["-qq", archivePath, "-d", destinationDir]);
    return;
  }

  if (archiveType === "tar.xz") {
    await runCommand("tar", ["-xJf", archivePath, "-C", destinationDir]);
    return;
  }

  throw new Error(`Unsupported archive type: ${archiveType}`);
}

async function findFileByBasename(rootDir, fileName) {
  const entries = await fs.readdir(rootDir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(rootDir, entry.name);
    if (entry.isFile() && entry.name === fileName) {
      return fullPath;
    }
    if (entry.isDirectory()) {
      const nested = await findFileByBasename(fullPath, fileName);
      if (nested) return nested;
    }
  }
  return null;
}

const latestTarget = await fetchLatestTarget();
const outputDir = path.join(repoRoot, "build", "vendor", "ffmpeg", targetKey);
const ffmpegOutputPath = path.join(outputDir, latestTarget.ffmpegBinaryName);
const ffprobeOutputPath = path.join(outputDir, latestTarget.ffprobeBinaryName);
const manifestPath = path.join(outputDir, "manifest.json");

await fs.mkdir(outputDir, { recursive: true });

const existingManifest = await loadManifest(manifestPath);
if (
  existingManifest?.sha256 === latestTarget.sha256 &&
  (await fileExists(ffmpegOutputPath)) &&
  (await fileExists(ffprobeOutputPath))
) {
  await ensureExecutable(ffmpegOutputPath);
  await ensureExecutable(ffprobeOutputPath);
  console.log(`[ffmpeg] Using cached ${latestTarget.releaseName}`);
  process.exit(0);
}

const tempRoot = await fs.mkdtemp(path.join(tmpdir(), "f-land-ffmpeg-"));
const archivePath = path.join(tempRoot, latestTarget.assetName);
const extractDir = path.join(tempRoot, "extract");

try {
  await fs.mkdir(extractDir, { recursive: true });
  console.log(
    `[ffmpeg] Downloading ${latestTarget.assetName} from ${latestTarget.releaseName}${latestTarget.publishedAt ? ` (${latestTarget.publishedAt})` : ""}`
  );
  await downloadFile(latestTarget.downloadUrl, archivePath, latestTarget.sha256);

  const archiveDigest = await sha256File(archivePath);
  if (archiveDigest !== latestTarget.sha256) {
    throw new Error(
      `Archive checksum mismatch after download: expected ${latestTarget.sha256}, got ${archiveDigest}`
    );
  }

  await extractArchive(archivePath, latestTarget.archiveType, extractDir);

  const extractedFfmpegPath = await findFileByBasename(extractDir, latestTarget.ffmpegBinaryName);
  const extractedFfprobePath = await findFileByBasename(extractDir, latestTarget.ffprobeBinaryName);

  if (!extractedFfmpegPath || !extractedFfprobePath) {
    throw new Error(
      `Unable to locate ${latestTarget.ffmpegBinaryName} and ${latestTarget.ffprobeBinaryName} in extracted archive.`
    );
  }

  await fs.copyFile(extractedFfmpegPath, ffmpegOutputPath);
  await fs.copyFile(extractedFfprobePath, ffprobeOutputPath);
  await ensureExecutable(ffmpegOutputPath);
  await ensureExecutable(ffprobeOutputPath);

  await fs.writeFile(
    manifestPath,
    `${JSON.stringify(
      {
        releaseName: latestTarget.releaseName,
        publishedAt: latestTarget.publishedAt,
        assetName: latestTarget.assetName,
        sha256: latestTarget.sha256,
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  console.log(`[ffmpeg] Ready at ${path.relative(repoRoot, outputDir)}`);
} finally {
  await fs.rm(tempRoot, { recursive: true, force: true });
}
