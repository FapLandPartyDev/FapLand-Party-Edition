import { describe, expect, it } from "vitest";
import { extractOpenedFileArguments } from "./openedFileArguments";

describe("extractOpenedFileArguments", () => {
  it("normalizes initial and second-instance argv without flags or duplicates", () => {
    expect(
      extractOpenedFileArguments([
        "Fap Land.exe",
        "C:\\Library\\One.hero",
        "--some-electron-flag",
        "C:\\Library\\Two.hero",
        "C:\\Library\\One.hero",
        "fland://auth/callback",
      ])
    ).toEqual(["C:\\Library\\One.hero", "C:\\Library\\Two.hero"]);
  });

  it("skips the development app entrypoint", () => {
    expect(
      extractOpenedFileArguments(["electron", ".", "/tmp/One.hero"], { packaged: false })
    ).toEqual(["/tmp/One.hero"]);
  });
});
