import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const SRC_DIR = path.join(ROOT, "src");
const FILE_EXTENSIONS = new Set([".ts", ".tsx"]);
const EXCLUDED_SUFFIXES = [".test.ts", ".test.tsx", ".spec.ts", ".spec.tsx"];
const EXCLUDED_DIRS = new Set(["locales", "routeTree.gen.ts"]);
const TARGET_PATTERNS = [
  /aria-label="[^"{][^"]*"/g,
  /placeholder="[^"{][^"]*"/g,
  /title="[^"{][^"]*"/g,
  /\b(label|description|subtitle|confirmLabel|mediaLabel):\s*"[^"]+"/g,
];

function walk(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    if (EXCLUDED_DIRS.has(entry.name)) continue;

    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walk(fullPath));
      continue;
    }

    const extension = path.extname(entry.name);
    if (!FILE_EXTENSIONS.has(extension)) continue;
    if (EXCLUDED_SUFFIXES.some((suffix) => entry.name.endsWith(suffix))) continue;
    files.push(fullPath);
  }

  return files;
}

function hasLinguiImport(source) {
  return source.includes("@lingui/react/macro") || source.includes("@lingui/core/macro");
}

function isEnforced(source) {
  return source.includes("@i18n-enforced");
}

const violations = [];

for (const filePath of walk(SRC_DIR)) {
  const source = fs.readFileSync(filePath, "utf8");
  if (!hasLinguiImport(source) || !isEnforced(source)) continue;

  for (const pattern of TARGET_PATTERNS) {
    const matches = source.match(pattern) ?? [];
    for (const match of matches) {
      violations.push({
        filePath: path.relative(ROOT, filePath),
        match,
      });
    }
  }
}

if (violations.length > 0) {
  console.error("Found hardcoded UI strings in Lingui-enabled production files:");
  for (const violation of violations) {
    console.error(`- ${violation.filePath}: ${violation.match}`);
  }
  process.exit(1);
}
