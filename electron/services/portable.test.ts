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
  getPortableDataRelativePath,
  getPortableDatabasePath,
  getPortableExecutableDir,
  isPathInsidePortableDataRoot,
  isPortableMode,
  normalizeUserDataSuffix,
  resolvePortableLinkedPath,
  resolvePortableAwareStoragePath,
  resolvePortableDataRelativePath,
  resolvePortableMovedDataPath,
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

  it("resolves default storage paths relative to the current Windows zip folder", () => {
    const context = {
      platform: "win32" as const,
      isPackaged: true,
      execPath: "D:\\Games\\Fap Land\\Fap Land.exe",
      markerExists: () => false,
    };

    expect(resolvePortableDataRelativePath("web-video-cache", undefined, context)).toBe(
      "D:\\Games\\Fap Land\\data\\web-video-cache"
    );
    expect(resolvePortableAwareStoragePath(null, "web-video-cache", undefined, context)).toBe(
      "D:\\Games\\Fap Land\\data\\web-video-cache"
    );
  });

  it("rebases legacy absolute default storage paths after moving a Windows zip folder", () => {
    const context = {
      platform: "win32" as const,
      isPackaged: true,
      execPath: "D:\\Games\\Fap Land\\Fap Land.exe",
      markerExists: () => false,
    };

    expect(
      resolvePortableAwareStoragePath(
        "C:\\Old\\Fap Land\\data\\web-video-cache",
        "web-video-cache",
        undefined,
        context
      )
    ).toBe("D:\\Games\\Fap Land\\data\\web-video-cache");
  });

  it("rebases arbitrary paths inside the old portable data root after moving a Windows zip folder", () => {
    const context = {
      platform: "win32" as const,
      isPackaged: true,
      execPath: "D:\\Games\\Fap Land\\Fap Land.exe",
      markerExists: () => false,
    };

    expect(
      getPortableDataRelativePath(
        "C:\\Old\\Fap Land\\data\\music-cache\\abc\\audio.mp3",
        undefined,
        context
      )
    ).toBe("music-cache/abc/audio.mp3");
    expect(
      resolvePortableMovedDataPath(
        "C:\\Old\\Fap Land\\data\\music-cache\\abc\\audio.mp3",
        undefined,
        context
      )
    ).toBe("D:\\Games\\Fap Land\\data\\music-cache\\abc\\audio.mp3");
  });

  it("rebases suffixed portable data paths after moving a Windows zip folder", () => {
    const context = {
      platform: "win32" as const,
      isPackaged: true,
      execPath: "D:\\Games\\Fap Land\\Fap Land.exe",
      markerExists: () => false,
    };

    expect(
      resolvePortableMovedDataPath(
        "C:\\Old\\Fap Land\\data\\mp1\\music-cache\\abc\\audio.mp3",
        "mp1",
        context
      )
    ).toBe("D:\\Games\\Fap Land\\data\\mp1\\music-cache\\abc\\audio.mp3");
  });

  it("keeps external absolute paths on another drive unchanged in portable mode", () => {
    const context = {
      platform: "win32" as const,
      isPackaged: true,
      execPath: "D:\\Games\\Fap Land\\Fap Land.exe",
      markerExists: () => false,
      pathExists: (filePath: string) => filePath === "E:\\Videos\\scene.mp4",
    };

    expect(resolvePortableLinkedPath("E:\\Videos\\scene.mp4", undefined, context)).toBe(
      "E:\\Videos\\scene.mp4"
    );
  });

  it("keeps UNC network paths unchanged in portable mode", () => {
    const context = {
      platform: "win32" as const,
      isPackaged: true,
      execPath: "D:\\Games\\Fap Land\\Fap Land.exe",
      markerExists: () => false,
      pathExists: (filePath: string) => filePath === "\\\\server\\share\\scene.mp4",
    };

    expect(resolvePortableLinkedPath("\\\\server\\share\\scene.mp4", undefined, context)).toBe(
      "\\\\server\\share\\scene.mp4"
    );
  });

  it("keeps existing external paths containing a data segment unchanged", () => {
    const context = {
      platform: "win32" as const,
      isPackaged: true,
      execPath: "D:\\Games\\Fap Land\\Fap Land.exe",
      markerExists: () => false,
      pathExists: (filePath: string) => filePath === "E:\\Archive\\data\\clip.mp4",
    };

    expect(resolvePortableLinkedPath("E:\\Archive\\data\\clip.mp4", undefined, context)).toBe(
      "E:\\Archive\\data\\clip.mp4"
    );
  });

  it("rebases stale moved portable paths only when the rebased target exists", () => {
    const context = {
      platform: "win32" as const,
      isPackaged: true,
      execPath: "D:\\Games\\Fap Land\\Fap Land.exe",
      markerExists: () => false,
      pathExists: (filePath: string) =>
        filePath === "D:\\Games\\Fap Land\\data\\music-cache\\abc\\audio.mp3",
    };

    expect(
      resolvePortableLinkedPath(
        "C:\\Old\\Fap Land\\data\\music-cache\\abc\\audio.mp3",
        undefined,
        context
      )
    ).toBe("D:\\Games\\Fap Land\\data\\music-cache\\abc\\audio.mp3");
  });

  it("resolves relative portable-linked paths inside the portable data root", () => {
    const context = {
      platform: "win32" as const,
      isPackaged: true,
      execPath: "D:\\Games\\Fap Land\\Fap Land.exe",
      markerExists: () => false,
    };

    expect(resolvePortableLinkedPath("media\\portable.mp4", undefined, context)).toBe(
      "D:\\Games\\Fap Land\\data\\media\\portable.mp4"
    );
  });

  it("preserves custom absolute paths for Windows zip portable storage", () => {
    const context = {
      platform: "win32" as const,
      isPackaged: true,
      execPath: "D:\\Games\\Fap Land\\Fap Land.exe",
      markerExists: () => false,
    };

    expect(
      resolvePortableAwareStoragePath(
        "E:\\Media Cache\\web-video-cache",
        "web-video-cache",
        undefined,
        context
      )
    ).toBe("E:\\Media Cache\\web-video-cache");
  });

  it("resolves relative configured portable paths inside the portable data root", () => {
    const context = {
      platform: "win32" as const,
      isPackaged: true,
      execPath: "D:\\Games\\Fap Land\\Fap Land.exe",
      markerExists: () => false,
    };

    expect(
      resolvePortableAwareStoragePath("custom-cache", "web-video-cache", undefined, context)
    ).toBe("D:\\Games\\Fap Land\\data\\custom-cache");
  });

  it("matches suffixed legacy default storage paths", () => {
    const context = {
      platform: "win32" as const,
      isPackaged: true,
      execPath: "D:\\Games\\Fap Land\\Fap Land.exe",
      markerExists: () => false,
    };

    expect(
      resolvePortableAwareStoragePath(
        "C:\\Old\\Fap Land\\data\\mp1\\music-cache",
        "music-cache",
        "mp1",
        context
      )
    ).toBe("D:\\Games\\Fap Land\\data\\mp1\\music-cache");
  });

  it("checks whether paths are inside the portable data root", () => {
    const context = {
      platform: "win32" as const,
      isPackaged: true,
      execPath: "D:\\Games\\Fap Land\\Fap Land.exe",
      markerExists: () => false,
    };

    expect(
      isPathInsidePortableDataRoot("D:\\Games\\Fap Land\\data\\web-video-cache", undefined, context)
    ).toBe(true);
    expect(
      isPathInsidePortableDataRoot("E:\\Media Cache\\web-video-cache", undefined, context)
    ).toBe(false);
  });

  it("does not resolve portable storage paths for Linux or installed Windows builds", () => {
    expect(
      resolvePortableAwareStoragePath(null, "web-video-cache", undefined, {
        platform: "linux",
        isPackaged: true,
        execPath: "/tmp/Fap Land.AppImage",
        markerExists: () => false,
      })
    ).toBeNull();

    expect(
      resolvePortableAwareStoragePath(null, "web-video-cache", undefined, {
        platform: "win32",
        isPackaged: true,
        execPath: "C:\\Program Files\\Fap Land\\Fap Land.exe",
        markerExists: () => true,
      })
    ).toBeNull();
  });

  it("normalizes user data suffixes", () => {
    expect(normalizeUserDataSuffix(" MP 1 ")).toBe("mp-1");
    expect(normalizeUserDataSuffix("mp_1")).toBe("mp_1");
    expect(normalizeUserDataSuffix("---")).toBeNull();
    expect(normalizeUserDataSuffix(undefined)).toBeNull();
  });
});
