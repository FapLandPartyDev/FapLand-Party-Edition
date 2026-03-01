import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";

const cwd = process.cwd();
const requireFromRoot = createRequire(path.join(cwd, "package.json"));
const outputPath = path.join(cwd, "src/generated/licenses.generated.json");
const rootPackagePath = path.join(cwd, "package.json");
const rootLicensePath = path.join(cwd, "LICENSE");
const licenseFilePattern = /^(licen[cs]e|copying|notice|unlicense)(\..+)?$/i;

function getNpmCommand() {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

function formatLicenseField(license) {
  if (!license) {
    return "UNKNOWN";
  }

  if (typeof license === "string") {
    return license;
  }

  if (Array.isArray(license)) {
    return license.map(formatLicenseField).join(", ");
  }

  if (typeof license === "object" && license !== null) {
    if (typeof license.type === "string" && license.type.length > 0) {
      return license.type;
    }

    return JSON.stringify(license);
  }

  return String(license);
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function readTextIfExists(filePath) {
  if (!existsSync(filePath)) {
    return null;
  }

  return readFile(filePath, "utf8");
}

async function findLicenseFiles(packageDir) {
  const entries = await readdir(packageDir, { withFileTypes: true });
  const licenseFiles = [];

  for (const entry of entries) {
    if (!entry.isFile() || !licenseFilePattern.test(entry.name)) {
      continue;
    }

    const filePath = path.join(packageDir, entry.name);
    const content = await readTextIfExists(filePath);

    if (!content) {
      continue;
    }

    licenseFiles.push({
      fileName: entry.name,
      content: content.trim(),
    });
  }

  licenseFiles.sort((left, right) => left.fileName.localeCompare(right.fileName));
  return licenseFiles;
}

async function createEntryFromPackage(packageDir) {
  const packageJson = await readJson(path.join(packageDir, "package.json"));
  const repository =
    typeof packageJson.repository === "string"
      ? packageJson.repository
      : typeof packageJson.repository?.url === "string"
        ? packageJson.repository.url
        : null;
  const homepage = typeof packageJson.homepage === "string" ? packageJson.homepage : null;

  return {
    id: `${packageJson.name}@${packageJson.version}`,
    name: packageJson.name,
    version: packageJson.version,
    license: formatLicenseField(packageJson.license),
    repository,
    homepage,
    licenseFiles: await findLicenseFiles(packageDir),
  };
}

function collectTreeEntries(node, entries, visitedPaths) {
  if (!node || typeof node !== "object") {
    return;
  }

  if (
    typeof node.name === "string" &&
    typeof node.version === "string" &&
    typeof node.path === "string" &&
    !visitedPaths.has(node.path)
  ) {
    visitedPaths.add(node.path);
    entries.push({
      name: node.name,
      version: node.version,
      packageDir: node.path,
    });
  }

  const dependencies = node.dependencies;
  if (!dependencies || typeof dependencies !== "object") {
    return;
  }

  for (const dependency of Object.values(dependencies)) {
    collectTreeEntries(dependency, entries, visitedPaths);
  }
}

function getProductionTreeFromNpm() {
  try {
    const command = getNpmCommand();
    const output = execFileSync(
      command,
      ["ls", "--omit=dev", "--all", "--json", "--long"],
      {
        cwd,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }
    );

    return JSON.parse(output);
  } catch (error) {
    console.warn("[licenses] Falling back to manual dependency discovery.", error);
    return null;
  }
}

async function collectEntriesFromNpmTree() {
  const tree = getProductionTreeFromNpm();
  if (!tree) {
    return null;
  }

  const entries = [];
  collectTreeEntries(tree, entries, new Set());
  return entries;
}

async function collectEntriesFromResolutionFallback() {
  const rootPackage = await readJson(rootPackagePath);
  const queue = Object.keys(rootPackage.dependencies ?? {}).map((name) => ({
    name,
    basedir: cwd,
  }));
  const visitedDirs = new Set();
  const entries = [];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) {
      continue;
    }

    let packageJsonPath;
    try {
      packageJsonPath = requireFromRoot.resolve(`${current.name}/package.json`, {
        paths: [current.basedir],
      });
    } catch {
      continue;
    }

    const packageDir = path.dirname(packageJsonPath);
    if (visitedDirs.has(packageDir)) {
      continue;
    }

    visitedDirs.add(packageDir);

    const packageJson = await readJson(packageJsonPath);
    entries.push({
      name: packageJson.name,
      version: packageJson.version,
      packageDir,
    });

    const nextDependencies = {
      ...(packageJson.dependencies ?? {}),
      ...(packageJson.optionalDependencies ?? {}),
    };

    for (const dependencyName of Object.keys(nextDependencies)) {
      queue.push({
        name: dependencyName,
        basedir: packageDir,
      });
    }
  }

  return entries;
}

async function buildDependencyEntries() {
  const discoveredEntries =
    (await collectEntriesFromNpmTree()) ?? (await collectEntriesFromResolutionFallback());
  const manifestEntries = [];
  const dedupeIds = new Set();

  for (const entry of discoveredEntries) {
    const id = `${entry.name}@${entry.version}`;
    if (dedupeIds.has(id)) {
      continue;
    }

    dedupeIds.add(id);
    manifestEntries.push(await createEntryFromPackage(entry.packageDir));
  }

  manifestEntries.sort((left, right) => {
    const byName = left.name.localeCompare(right.name);
    if (byName !== 0) {
      return byName;
    }

    return left.version.localeCompare(right.version);
  });

  return manifestEntries;
}

async function buildManifest() {
  const projectPackage = await readJson(rootPackagePath);
  const projectLicense = (await readTextIfExists(rootLicensePath))?.trim() ?? "";

  return {
    generatedAt: new Date().toISOString(),
    project: {
      name: projectPackage.name,
      version: projectPackage.version,
      license: formatLicenseField(projectPackage.license),
      repository:
        typeof projectPackage.repository === "string"
          ? projectPackage.repository
          : typeof projectPackage.repository?.url === "string"
            ? projectPackage.repository.url
            : null,
      licenseText: projectLicense,
    },
    dependencies: await buildDependencyEntries(),
  };
}

async function main() {
  const manifest = await buildManifest();

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(
    `[licenses] Wrote ${manifest.dependencies.length} production dependency licenses to ${path.relative(
      cwd,
      outputPath
    )}.`
  );
}

await main();
