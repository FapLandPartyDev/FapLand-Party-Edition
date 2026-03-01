import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveAssetUrl } from "./audio";

describe("resolveAssetUrl", () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it("resolves sound assets relative to a file-based renderer build", () => {
        vi.stubGlobal("document", {
            baseURI: "file:///opt/Fap%20Land/resources/app/dist/index.html",
        });

        expect(resolveAssetUrl("/sounds/ui-hover.wav")).toBe(
            "file:///opt/Fap%20Land/resources/app/dist/sounds/ui-hover.wav",
        );
    });

    it("resolves sound assets relative to the dev server", () => {
        vi.stubGlobal("document", {
            baseURI: "http://localhost:3000/",
        });

        expect(resolveAssetUrl("/sounds/ui-hover.wav")).toBe(
            "http://localhost:3000/sounds/ui-hover.wav",
        );
    });
});
