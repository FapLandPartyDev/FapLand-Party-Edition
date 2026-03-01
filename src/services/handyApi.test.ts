import { describe, expect, it } from "vitest";
import { parseFirmwareMajorVersion } from "./handyApi";

describe("parseFirmwareMajorVersion", () => {
  it("extracts the major version from TheHandy firmware strings", () => {
    expect(parseFirmwareMajorVersion("4.0.16")).toBe(4);
    expect(parseFirmwareMajorVersion("v5.1.0")).toBe(5);
  });

  it("returns null for missing or invalid firmware values", () => {
    expect(parseFirmwareMajorVersion(undefined)).toBeNull();
    expect(parseFirmwareMajorVersion("")).toBeNull();
    expect(parseFirmwareMajorVersion("beta")).toBeNull();
  });
});
