// @vitest-environment node

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const storeValues = new Map<string, unknown>();

vi.mock("electron", () => ({
  app: {
    getName: () => "Fap Land",
    getVersion: () => "1.2.3",
    getLocale: () => "en-US",
    getPath: (name: string) => `/home/tester/.config/f-land/${name}`,
    getAppPath: () => "/home/tester/app/f-land",
    getAppMetrics: () => [],
    isPackaged: false,
  },
}));

vi.mock("systeminformation", () => ({
  default: {
    cpu: vi.fn(async () => ({
      manufacturer: "ACME",
      brand: "Fast CPU",
      physicalCores: 4,
      cores: 8,
      speed: 3.2,
    })),
    mem: vi.fn(async () => ({ total: 16, free: 8, available: 10 })),
    osInfo: vi.fn(async () => ({ distro: "Linux", release: "1", build: "dev", kernel: "test" })),
    graphics: vi.fn(async () => ({ controllers: [], displays: [] })),
  },
}));

vi.mock("./appPaths", () => ({
  resolveAppStorageBaseDir: () => path.join(os.tmpdir(), "f-land-debug-test-storage"),
}));

vi.mock("./store", () => ({
  getStore: () => ({
    get: (key: string) => storeValues.get(key),
    set: (key: string, value: unknown) => storeValues.set(key, value),
  }),
}));

vi.mock("./portable", () => ({
  isPortableMode: () => false,
  normalizeUserDataSuffix: (value: string | undefined) => value ?? null,
}));

vi.mock("./rendererPerformance", () => ({
  getRendererPerformanceState: () => ({
    route: "settings",
    visible: true,
    activity: "idle",
    updatedAt: 1,
  }),
}));

vi.mock("./phashScanService", () => ({ getPhashScanStatus: () => ({ state: "idle" }) }));
vi.mock("./webVideoScanService", () => ({ getWebsiteVideoScanStatus: () => ({ state: "idle" }) }));
vi.mock("./installer", () => ({ getInstallScanStatus: () => ({ state: "idle" }) }));
vi.mock("./phash/binaries", () => ({
  getConfiguredVideoHashBinaryPreference: () => "auto",
  resetPhashBinariesCache: vi.fn(),
  resolvePhashBinaries: vi.fn(async () => ({
    source: "bundled",
    ffmpegPath: "/home/tester/bin/ffmpeg",
    ffmpegVersion: "ffmpeg 1",
    ffprobePath: "/home/tester/bin/ffprobe",
    ffprobeVersion: "ffprobe 1",
  })),
}));
vi.mock("./webVideo/binaries", () => ({
  getConfiguredYtDlpBinaryPreference: () => "auto",
  resetYtDlpBinaryCache: vi.fn(),
  resolveYtDlpBinary: vi.fn(async () => ({
    source: "bundled",
    ytDlpPath: "/home/tester/bin/yt-dlp",
    version: "yt-dlp 1",
  })),
}));

const execute = vi.fn(async (sql: string) => {
  if (sql.includes("__drizzle_migrations")) {
    return { rows: [{ hash: "abcdef1234567890", created_at: 123 }] };
  }
  if (sql.includes("sqlite_master")) return { rows: [{ name: "Round" }] };
  if (sql.includes("COUNT")) return { rows: [{ count: 2 }] };
  if (sql.includes("table_info")) return { rows: [{ name: "id", type: "text", notnull: 1 }] };
  if (sql.includes("index_list")) return { rows: [{ name: "Round_idx", unique: 0 }] };
  return { rows: [{ value: "ok" }] };
});

vi.mock("./db", () => ({
  getDb: () => ({ $client: { execute } }),
  resolveDatabaseUrl: () => "file:/home/tester/app/f-land/dev.db",
}));

vi.mock("./databaseBackupCore", () => ({
  parseFileDatabasePath: (url: string) => url.replace(/^file:/, ""),
}));

import {
  clearDebugLogFile,
  collectDebugDiagnostics,
  configureDebugLoggingForTests,
  createDebugBundle,
  debugLog,
  flushDebugLog,
  sanitizeForPublicDebug,
  setDebugLogLevel,
} from "./debugLogging";

describe("debugLogging", () => {
  let tmpDir: string;
  let logFilePath: string;

  beforeEach(async () => {
    storeValues.clear();
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "f-land-debug-"));
    logFilePath = path.join(tmpDir, "f-land.log");
    configureDebugLoggingForTests({ logFilePath, maxBytes: 120, rotatedFiles: 2 });
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("filters entries by level and writes JSON lines", async () => {
    setDebugLogLevel("warn");
    debugLog.info("test", "hidden");
    debugLog.warn("test", "shown", { path: "/home/tester/Videos/file.mp4" });
    await flushDebugLog();

    const lines = (await fs.readFile(logFilePath, "utf8")).trim().split("\n");
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0] ?? "{}");
    expect(parsed.level).toBe("warn");
    expect(parsed.message).toBe("shown");
    expect(JSON.stringify(parsed)).not.toContain("tester");
  });

  it("does not create a log file while off", async () => {
    setDebugLogLevel("off");
    debugLog.error("test", "hidden");
    await flushDebugLog();
    await expect(fs.stat(logFilePath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("prunes old entries when the log file exceeds max size", async () => {
    setDebugLogLevel("debug");
    for (let index = 0; index < 8; index += 1) {
      debugLog.debug("test", `entry ${index}`, { payload: "x".repeat(80) });
    }
    await flushDebugLog();

    await expect(fs.stat(logFilePath)).resolves.toBeTruthy();
    const content = await fs.readFile(logFilePath, "utf8");
    const lines = content.trim().split("\n");
    expect(lines.length).toBeLessThan(8);
    expect(lines.length).toBeGreaterThan(0);
    const lastEntry = JSON.parse(lines[lines.length - 1] ?? "{}");
    expect(lastEntry.message).toBe("entry 7");
  });

  it("sanitizes public debug output", () => {
    const sanitized = sanitizeForPublicDebug({
      path: "C:\\Users\\tester\\Videos\\clip.mp4",
      unix: "/home/tester/Videos/clip.mp4",
      mac: "/Users/tester/Videos/clip.mp4",
      url: "https://example.com/watch?token=secret#frag",
      privateUrl: "http://192.168.1.20/video?password=secret",
      apiKey: "secret-value",
      serialNumber: "ABC123",
    });

    const text = JSON.stringify(sanitized);
    expect(text).not.toContain("tester");
    expect(text).not.toContain("token=secret");
    expect(text).not.toContain("192.168.1.20");
    expect(text).not.toContain("secret-value");
    expect(text).not.toContain("ABC123");
    expect(text).toContain("<user>");
    expect(text).toContain("<private-ip>");
  });

  it("collects schema diagnostics without row contents", async () => {
    const diagnostics = await collectDebugDiagnostics();
    const text = JSON.stringify(diagnostics);
    expect(text).toContain("Round");
    expect(text).toContain("rowCount");
    expect(text).not.toContain("tester");
  });

  it("creates a sanitized debug bundle with recent logs", async () => {
    setDebugLogLevel("debug");
    debugLog.error("test", "failure", { url: "https://example.com?a=secret" });
    await flushDebugLog();

    const bundle = await createDebugBundle();
    expect(bundle.filename).toMatch(/^f-land-debug-/);
    expect(bundle.content).toContain("Fap Land Debug Bundle");
    expect(bundle.content).toContain("failure");
    expect(bundle.content).not.toContain("a=secret");
  });

  it("clears a missing or existing log file", async () => {
    await clearDebugLogFile();
    setDebugLogLevel("error");
    debugLog.error("test", "failure");
    await flushDebugLog();
    await clearDebugLogFile();
    expect(await fs.readFile(logFilePath, "utf8")).toBe("");
  });
});
