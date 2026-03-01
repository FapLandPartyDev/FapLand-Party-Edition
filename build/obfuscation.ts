import JavaScriptObfuscator from "javascript-obfuscator";
import type { Plugin } from "vite";

const PRELOAD_RESERVED_NAMES = [
  "electronAPI",
  "electronTRPC",
  "sendMessage",
  "onMessage",
  "subscribe",
  "consumePendingFiles",
  "convertFileSrc",
] as const;

const RESERVED_STRINGS = {
  preload: [
    "electron-trpc",
    "updates:state",
    "app-open:files",
    "app-open:consumePendingFiles",
    "dialog:selectFolders",
    "dialog:selectInstallImportFile",
    "dialog:selectPlaylistImportFile",
    "dialog:selectPlaylistExportPath",
    "dialog:selectConverterVideoFile",
    "dialog:selectConverterFunscriptFile",
    "window:isFullscreen",
    "window:setFullscreen",
    "window:toggleFullscreen",
  ],
  main: [
    "app",
    "app-open:files",
    "app-open:consumePendingFiles",
    "updates:state",
    "electron-trpc",
    "file",
    "open-file",
    "second-instance",
    "VITE_DEV_SERVER_URL",
    "FLAND_UPDATE_REPOSITORY",
    "DATABASE_URL",
    "APP_ROOT",
    "app://media",
  ],
} as const;

type BuildTarget = "renderer" | "preload" | "main";

function getBaseOptions() {
  return {
    compact: true,
    controlFlowFlattening: false,
    deadCodeInjection: false,
    debugProtection: false,
    identifierNamesGenerator: "hexadecimal" as const,
    renameGlobals: false,
    selfDefending: false,
    stringArray: true,
    transformObjectKeys: false,
    unicodeEscapeSequence: false,
  };
}

function getTargetOptions(target: BuildTarget) {
  if (target === "renderer") {
    return {
      ...getBaseOptions(),
      rotateStringArray: true,
      shuffleStringArray: true,
      splitStrings: true,
      splitStringsChunkLength: 8,
      stringArrayEncoding: ["base64"] as const,
      stringArrayThreshold: 0.75,
    };
  }

  if (target === "preload") {
    return {
      ...getBaseOptions(),
      reservedNames: [...PRELOAD_RESERVED_NAMES],
      reservedStrings: [...RESERVED_STRINGS.preload],
      rotateStringArray: true,
      shuffleStringArray: true,
      splitStrings: false,
      stringArrayEncoding: ["base64"] as const,
      stringArrayThreshold: 0.35,
    };
  }

  return {
    ...getBaseOptions(),
    reservedStrings: [...RESERVED_STRINGS.main],
    rotateStringArray: true,
    shuffleStringArray: true,
    splitStrings: false,
    stringArrayEncoding: ["base64"] as const,
    stringArrayThreshold: 0.2,
  };
}

function shouldObfuscateChunk(target: BuildTarget, fileName: string) {
  if (!fileName.endsWith(".js") && !fileName.endsWith(".cjs")) {
    return false;
  }

  if (target === "renderer") {
    return fileName.startsWith("assets/");
  }

  if (target === "preload") {
    return fileName === "preload.cjs";
  }

  return fileName === "main.js";
}

export function createObfuscationPlugin(target: BuildTarget, enabled: boolean): Plugin | null {
  if (!enabled) {
    return null;
  }

  return {
    name: `f-land-obfuscate-${target}`,
    apply: "build",
    enforce: "post",
    generateBundle(_options, bundle) {
      const obfuscatorOptions = getTargetOptions(target);

      for (const chunk of Object.values(bundle)) {
        if (chunk.type !== "chunk" || !shouldObfuscateChunk(target, chunk.fileName)) {
          continue;
        }

        const result = JavaScriptObfuscator.obfuscate(chunk.code, obfuscatorOptions);
        chunk.code = result.getObfuscatedCode();
        if ("map" in chunk) {
          chunk.map = null;
        }
      }
    },
  };
}
