import { describe, expect, it } from "vitest";
import { abbreviateNsfwText } from "./sfwText";

describe("abbreviateNsfwText", () => {
  it("leaves text unchanged when safe mode is disabled", () => {
    expect(abbreviateNsfwText("cum round", false)).toBe("cum round");
  });

  it("abbreviates obscene words to their first character", () => {
    expect(abbreviateNsfwText("cum round", true)).toBe("c round");
    expect(abbreviateNsfwText("Did you cum as instructed?", true)).toBe("Did you c as instructed?");
    expect(abbreviateNsfwText("Confirm your orgasm.", true)).toBe("Confirm your o.");
  });

  it("handles mixed casing and multiple matches", () => {
    expect(abbreviateNsfwText("CUM and Fap", true)).toBe("C and F");
    expect(abbreviateNsfwText("Cumming orgasms", true)).toBe("C o");
  });
});
