// @vitest-environment node

import path from "node:path";
import { describe, expect, it } from "vitest";
import type { YtDlpBinary } from "./types";
import {
  __resetYtDlpBinaryCacheForTests,
  getBundledYtDlpCandidatePaths,
  resetYtDlpBinaryCache,
  selectYtDlpBinary,
} from "./binaries";

const bundled: YtDlpBinary = {
  ytDlpPath: "/bundled/yt-dlp",
  source: "bundled",
  version: "2025.12.08",
};

const system: YtDlpBinary = {
  ytDlpPath: "yt-dlp",
  source: "system",
  version: "2025.12.08",
};

describe("webVideo binaries", () => {
  it("includes the repo-local vendor binary as a dev candidate", () => {
    const candidates = getBundledYtDlpCandidatePaths(path.join("yt-dlp", "linux-x64", "yt-dlp"), {
      appPath: "/workspace/f-land",
      resourcesPath: "/tmp/resources",
      isPackaged: false,
    });

    expect(candidates).toContain(
      path.normalize("/workspace/f-land/build/vendor/yt-dlp/linux-x64/yt-dlp")
    );
  });

  it("prefers the bundled binary in auto mode when available", () => {
    expect(selectYtDlpBinary("auto", bundled, system)).toBe(bundled);
  });

  it("falls back to the system binary in auto mode when the bundled one is unavailable", () => {
    expect(selectYtDlpBinary("auto", null, system)).toBe(system);
  });

  it("falls back to the system binary in auto mode when the bundled binary is not runnable", () => {
    expect(
      selectYtDlpBinary(
        "auto",
        {
          ...bundled,
          version: null,
        },
        system
      )
    ).toBe(system);
  });

  it("forces bundled selection when requested", () => {
    expect(selectYtDlpBinary("bundled", bundled, system)).toBe(bundled);
  });

  it("forces system selection when requested", () => {
    expect(selectYtDlpBinary("system", bundled, system)).toBe(system);
  });

  it("throws when bundled selection is forced but unavailable", () => {
    expect(() => selectYtDlpBinary("bundled", null, system)).toThrow(/forced to bundled\/local/i);
  });

  it("throws when bundled selection is forced but the bundled binary is not runnable", () => {
    expect(() =>
      selectYtDlpBinary(
        "bundled",
        {
          ...bundled,
          version: null,
        },
        system
      )
    ).toThrow(/forced to bundled\/local/i);
  });

  it("throws when system selection is forced but unavailable", () => {
    expect(() => selectYtDlpBinary("system", bundled, null)).toThrow(/forced to system/i);
  });

  it("throws when no yt-dlp binary is available", () => {
    expect(() => selectYtDlpBinary("auto", null, null)).toThrow(/Unable to locate yt-dlp/i);
  });

  it("exposes cache reset helpers", () => {
    expect(() => resetYtDlpBinaryCache()).not.toThrow();
    expect(() => __resetYtDlpBinaryCacheForTests()).not.toThrow();
  });
});
