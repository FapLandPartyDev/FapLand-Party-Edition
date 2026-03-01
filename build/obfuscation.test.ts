import { describe, expect, it } from "vitest";
import type { OutputChunk } from "rollup";
import { shouldObfuscateChunk } from "./obfuscation";

function createChunk(fileName: string, moduleIds: string[]): OutputChunk {
  return {
    type: "chunk",
    fileName,
    name: fileName,
    code: "",
    dynamicImports: [],
    exports: [],
    facadeModuleId: null,
    implicitlyLoadedBefore: [],
    importedBindings: {},
    imports: [],
    isDynamicEntry: false,
    isEntry: false,
    isImplicitEntry: false,
    map: null,
    moduleIds,
    modules: Object.fromEntries(
      moduleIds.map((moduleId) => [
        moduleId,
        {
          code: null,
          originalLength: 0,
          removedExports: [],
          renderedExports: [],
          renderedLength: 0,
        },
      ])
    ),
    preliminaryFileName: fileName,
    referencedFiles: [],
    sourcemapFileName: null,
  };
}

describe("shouldObfuscateChunk", () => {
  it("skips pure vendor renderer chunks", () => {
    const chunk = createChunk("assets/pixi-vendor-abc123.js", [
      "/repo/node_modules/pixi.js/lib/index.js",
      "/repo/node_modules/@pixi/core/lib/index.js",
    ]);

    expect(shouldObfuscateChunk("renderer", chunk)).toBe(false);
  });

  it("keeps obfuscating renderer chunks with app modules", () => {
    const chunk = createChunk("assets/index-abc123.js", [
      "/repo/src/main.tsx",
      "/repo/node_modules/react/index.js",
    ]);

    expect(shouldObfuscateChunk("renderer", chunk)).toBe(true);
  });
});
