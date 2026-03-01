// @vitest-environment node

import path from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  app: {
    isPackaged: false,
  },
}));

import { getPortableDataRoot, getPortableExecutableDir, isPortableMode } from "./portable";

describe("portable", () => {
  it("returns false outside packaged Windows portable builds", () => {
    expect(
      isPortableMode({
        platform: "linux",
        isPackaged: true,
        env: { PORTABLE_EXECUTABLE_DIR: "/portable" },
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

  it("detects packaged Windows portable builds from the runtime env", () => {
    expect(
      isPortableMode({
        platform: "win32",
        isPackaged: true,
        env: { PORTABLE_EXECUTABLE_DIR: "/portable" },
      })
    ).toBe(true);
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
});
