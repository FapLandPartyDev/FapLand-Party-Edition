import JavaScriptObfuscator from "javascript-obfuscator";
import type { OutputChunk, Plugin } from "vite";

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
    "trpc-electron",
    "updates:state",
    "app-open:files",
    "app-open:consumePendingFiles",
    "app-open:renderer-ready",
    "auth:callback",
    "auth:consumePendingCallback",
    "dialog:selectFolders",
    "dialog:selectInstallImportFile",
    "dialog:selectPlaylistImportFile",
    "dialog:selectPlaylistExportPath",
    "dialog:selectPlaylistExportDirectory",
    "dialog:selectFpackExtractionDirectory",
    "dialog:selectWebsiteVideoCacheDirectory",
    "dialog:selectMusicCacheDirectory",
    "dialog:selectConverterVideoFile",
    "dialog:selectMusicFiles",
    "dialog:selectConverterFunscriptFile",
    "music:addFromUrl",
    "music:addPlaylistFromUrl",
    "window:isFullscreen",
    "window:setFullscreen",
    "window:toggleFullscreen",
    "window:close",
  ],
  main: [
    "app",
    "app-open:files",
    "app-open:consumePendingFiles",
    "app-open:renderer-ready",
    "auth:callback",
    "auth:consumePendingCallback",
    "updates:state",
    "trpc-electron",
    "file",
    "open-file",
    "second-instance",
    "VITE_DEV_SERVER_URL",
    "FLAND_UPDATE_REPOSITORY",
    "DATABASE_URL",
    "APP_ROOT",
    "app://media",
    "dialog:selectFolders",
    "dialog:selectInstallImportFile",
    "dialog:selectPlaylistImportFile",
    "dialog:selectPlaylistExportPath",
    "dialog:selectPlaylistExportDirectory",
    "dialog:selectFpackExtractionDirectory",
    "dialog:selectWebsiteVideoCacheDirectory",
    "dialog:selectMusicCacheDirectory",
    "dialog:selectConverterVideoFile",
    "dialog:selectMusicFiles",
    "dialog:selectConverterFunscriptFile",
    "music:addFromUrl",
    "music:addPlaylistFromUrl",
    "window:isFullscreen",
    "window:setFullscreen",
    "window:toggleFullscreen",
    "window:close",
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

function isJavaScriptChunk(fileName: string) {
  return fileName.endsWith(".js") || fileName.endsWith(".cjs");
}

function isPureVendorChunk(chunk: OutputChunk) {
  const moduleIds = Object.keys(chunk.modules);
  return moduleIds.length > 0 && moduleIds.every((moduleId) => moduleId.includes("node_modules"));
}

export function shouldObfuscateChunk(target: BuildTarget, chunk: OutputChunk) {
  if (!isJavaScriptChunk(chunk.fileName)) {
    return false;
  }

  if (target === "renderer") {
    return chunk.fileName.startsWith("assets/") && !isPureVendorChunk(chunk);
  }

  if (target === "preload") {
    return chunk.fileName === "preload.cjs";
  }

  return chunk.fileName === "main.js";
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
        if (chunk.type !== "chunk" || !shouldObfuscateChunk(target, chunk)) {
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
