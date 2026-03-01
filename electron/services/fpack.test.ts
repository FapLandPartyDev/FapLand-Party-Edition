// @vitest-environment node

import path from "node:path";
import { describe, expect, it, vi } from "vitest";

let userDataPath = "/tmp/f-land-user-data";
const storeValues = new Map<string, unknown>();

vi.mock("electron", () => ({
  app: {
    getPath: vi.fn((name: string) => {
      if (name === "temp") return "/tmp";
      return userDataPath;
    }),
  },
}));

vi.mock("./store", () => ({
  getStore: () => ({
    get: (key: string) => storeValues.get(key),
  }),
}));

import { getFpackExtractionRoot } from "./fpack";

describe("fpack.getFpackExtractionRoot", () => {
  it("uses userData for the default extraction root", async () => {
    storeValues.clear();
    await expect(getFpackExtractionRoot()).resolves.toBe(path.join(userDataPath, "fpacks"));
  });

  it("uses the configured extraction root when present", async () => {
    storeValues.set("fpack.extractionPath", "/custom/fpacks");
    await expect(getFpackExtractionRoot()).resolves.toBe(path.resolve("/custom/fpacks"));
  });
});
