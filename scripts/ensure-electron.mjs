import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const electronPackageDir = path.join(rootDir, "node_modules", "electron");
const electronInstallScript = path.join(electronPackageDir, "install.js");
const electronPathFile = path.join(electronPackageDir, "path.txt");
const requireElectronDependency = createRequire(electronInstallScript);

function getPlatformExecutablePath() {
  const platform =
    process.env.ELECTRON_INSTALL_PLATFORM ?? process.env.npm_config_platform ?? os.platform();

  switch (platform) {
    case "mas":
    case "darwin":
      return path.join("Electron.app", "Contents", "MacOS", "Electron");
    case "freebsd":
    case "openbsd":
    case "linux":
      return "electron";
    case "win32":
      return "electron.exe";
    default:
      throw new Error(`Electron builds are not available on platform: ${platform}`);
  }
}

function readInstalledExecutablePath() {
  try {
    return fs.readFileSync(electronPathFile, "utf8").trim();
  } catch {
    return null;
  }
}

function isElectronReady() {
  const executablePath = readInstalledExecutablePath();

  if (!executablePath) {
    return false;
  }

  const distRoot = process.env.ELECTRON_OVERRIDE_DIST_PATH ?? path.join(electronPackageDir, "dist");
  return fs.existsSync(path.join(distRoot, executablePath));
}

function installElectron() {
  if (!fs.existsSync(electronInstallScript)) {
    throw new Error(
      "Electron is not installed in node_modules. Run `npm install` before starting development."
    );
  }

  const expectedExecutablePath = getPlatformExecutablePath();
  console.log(`Preparing Electron binary (${expectedExecutablePath})...`);

  const result = spawnSync(process.execPath, [electronInstallScript], {
    cwd: rootDir,
    stdio: "inherit",
  });

  if (result.status !== 0) {
    throw new Error("Electron binary installation failed.");
  }
}

async function installElectronDirectly() {
  const expectedExecutablePath = getPlatformExecutablePath();
  const { downloadArtifact } = requireElectronDependency("@electron/get");
  const { version } = requireElectronDependency("./package.json");
  const checksums = requireElectronDependency("./checksums.json");
  const platform =
    process.env.ELECTRON_INSTALL_PLATFORM ?? process.env.npm_config_platform ?? process.platform;
  const arch = process.env.ELECTRON_INSTALL_ARCH ?? process.env.npm_config_arch ?? process.arch;
  const distPath = process.env.ELECTRON_OVERRIDE_DIST_PATH ?? path.join(electronPackageDir, "dist");

  console.log(`Extracting Electron ${version} for ${platform}-${arch}...`);

  const zipPath = await downloadArtifact({
    version,
    artifactName: "electron",
    force: process.env.force_no_cache === "true",
    cacheRoot: process.env.electron_config_cache,
    checksums:
      process.env.electron_use_remote_checksums || process.env.npm_config_electron_use_remote_checksums
        ? undefined
        : checksums,
    platform,
    arch,
  });

  fs.mkdirSync(distPath, { recursive: true });
  const extractResult = spawnSync("tar", ["-xf", zipPath, "-C", distPath], {
    cwd: rootDir,
    stdio: "inherit",
  });

  if (extractResult.status !== 0) {
    throw new Error("Electron archive extraction failed.");
  }

  const extractedTypeDefinitions = path.join(distPath, "electron.d.ts");
  if (fs.existsSync(extractedTypeDefinitions)) {
    fs.renameSync(extractedTypeDefinitions, path.join(electronPackageDir, "electron.d.ts"));
  }

  await fs.promises.writeFile(electronPathFile, expectedExecutablePath);
}

if (!isElectronReady()) {
  installElectron();
}

if (!isElectronReady()) {
  await installElectronDirectly();
}

if (!isElectronReady()) {
  throw new Error("Electron binary is still missing after direct installation.");
}
