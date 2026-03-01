// @vitest-environment node

import path from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  app: {
    isPackaged: false,
  },
}));

import {
  getInstalledMarkerPath,
  getPortableDataRoot,
  getPortableDatabasePath,
  getPortableExecutableDir,
  isPortableMode,
  normalizeUserDataSuffix,
} from "./portable";

describe("portable", () => {
  it("returns false outside packaged Windows portable builds", () => {
    expect(
      isPortableMode({
        platform: "linux",
        isPackaged: true,
        execPath: "/tmp/Fap Land.AppImage",
        markerExists: () => false,
      })
    ).toBe(false);
    expect(
      isPortableMode({
        platform: "win32",
        isPackaged: false,
        env: { PORTABLE_EXECUTABLE_DIR: "/portable" },
      })
    ).toBe(false);
  });

  it("does not treat AppImage runtime env as portable mode", () => {
    expect(
      isPortableMode({
        platform: "linux",
        isPackaged: true,
        env: { APPIMAGE: "/tmp/Fap Land.AppImage" },
        execPath: "/tmp/Fap Land.AppImage",
        markerExists: () => false,
      })
    ).toBe(false);
  });

  it("detects packaged Windows portable builds from the runtime env", () => {
    expect(
      isPortableMode({
        platform: "win32",
        isPackaged: true,
        env: { PORTABLE_EXECUTABLE_DIR: "/portable" },
      })
    ).toBe(true);
  });

  it("detects packaged Windows zip builds without an installed marker as portable", () => {
    expect(
      isPortableMode({
        platform: "win32",
        isPackaged: true,
        execPath: "C:\\Games\\Fap Land\\Fap Land.exe",
        markerExists: () => false,
      })
    ).toBe(true);
  });

  it("does not treat Windows setup installs with an installed marker as portable", () => {
    expect(
      isPortableMode({
        platform: "win32",
        isPackaged: true,
        execPath: "C:\\Program Files\\Fap Land\\Fap Land.exe",
        markerExists: (markerPath) =>
          markerPath === getInstalledMarkerPath("C:\\Program Files\\Fap Land"),
      })
    ).toBe(false);
  });

  it("resolves the portable executable directory", () => {
    const env = { PORTABLE_EXECUTABLE_DIR: "/portable/app" };
    expect(
      getPortableExecutableDir({
        platform: "win32",
        isPackaged: true,
        env,
      })
    ).toBe(path.resolve("/portable/app"));
  });

  it("resolves the portable executable directory for zip builds", () => {
    expect(
      getPortableExecutableDir({
        platform: "win32",
        isPackaged: true,
        execPath: "C:\\Games\\Fap Land\\Fap Land.exe",
        markerExists: () => false,
      })
    ).toBe("C:\\Games\\Fap Land");
  });

  it("resolves the portable data root next to the executable", () => {
    expect(
      getPortableDataRoot(undefined, {
        platform: "win32",
        isPackaged: true,
        env: { PORTABLE_EXECUTABLE_DIR: "/portable/app" },
      })
    ).toBe(path.join(path.resolve("/portable/app"), "data"));
  });

  it("nests suffixed user-data roots under the portable data directory", () => {
    expect(
      getPortableDataRoot("mp1", {
        platform: "win32",
        isPackaged: true,
        env: { PORTABLE_EXECUTABLE_DIR: "/portable/app" },
      })
    ).toBe(path.join(path.resolve("/portable/app"), "data", "mp1"));
  });

  it("resolves portable data and database paths for Windows zip builds", () => {
    const context = {
      platform: "win32" as const,
      isPackaged: true,
      execPath: "C:\\Games\\Fap Land\\Fap Land.exe",
      markerExists: () => false,
    };

    expect(getPortableDataRoot(undefined, context)).toBe("C:\\Games\\Fap Land\\data");
    expect(getPortableDataRoot("mp1", context)).toBe("C:\\Games\\Fap Land\\data\\mp1");
    expect(getPortableDatabasePath(undefined, context)).toBe("C:\\Games\\Fap Land\\dev.db");
    expect(getPortableDatabasePath("mp1", context)).toBe("C:\\Games\\Fap Land\\dev-mp1.db");
  });

  it("does not resolve portable data or database paths for Linux builds", () => {
    const context = {
      platform: "linux" as const,
      isPackaged: true,
      execPath: "/tmp/Fap Land.AppImage",
      markerExists: () => false,
    };

    expect(getPortableDataRoot(undefined, context)).toBeNull();
    expect(getPortableDatabasePath(undefined, context)).toBeNull();
  });

  it("normalizes user data suffixes", () => {
    expect(normalizeUserDataSuffix(" MP 1 ")).toBe("mp-1");
    expect(normalizeUserDataSuffix("mp_1")).toBe("mp_1");
    expect(normalizeUserDataSuffix("---")).toBeNull();
    expect(normalizeUserDataSuffix(undefined)).toBeNull();
  });
});
