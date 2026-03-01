// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

let isPackaged = false;
let appPath = "/workspace/f-land";
let userDataPath = "/portable/data";

vi.mock("electron", () => ({
  app: {
    getAppPath: vi.fn(() => appPath),
    getPath: vi.fn(() => userDataPath),
    get isPackaged() {
      return isPackaged;
    },
  },
}));

import { resolveAppStorageBaseDir, resolveInstallExportBaseDir } from "./appPaths";

describe("appPaths", () => {
  it("uses appPath for unpackaged builds", () => {
    isPackaged = false;
    expect(resolveAppStorageBaseDir()).toBe("/workspace/f-land");
    expect(resolveInstallExportBaseDir()).toBe("/workspace/f-land/export");
  });

  it("uses userData for packaged builds", () => {
    isPackaged = true;
    expect(resolveAppStorageBaseDir()).toBe("/portable/data");
    expect(resolveInstallExportBaseDir()).toBe("/portable/data/export");
  });
});
