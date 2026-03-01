import { version } from "./package.json";
import { createObfuscationPlugin } from "./build/obfuscation";
import tailwindcss from "@tailwindcss/vite";
import { devtools } from "@tanstack/devtools-vite";
import { TanStackRouterVite } from "@tanstack/router-plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";
import electron from "vite-plugin-electron/simple";
import viteTsConfigPaths from "vite-tsconfig-paths";

function readFlag(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) {
    return fallback;
  }

  return value === "1" || value.toLowerCase() === "true";
}

function createManualChunks(id: string): string | undefined {
  const normalizedId = id.replaceAll("\\", "/");

  if (!normalizedId.includes("node_modules")) {
    return undefined;
  }

  if (normalizedId.includes("/react/") || normalizedId.includes("/react-dom/")) {
    return "react-vendor";
  }

  if (normalizedId.includes("/@tanstack/")) {
    return "router-query-vendor";
  }

  if (normalizedId.includes("/pixi.js/") || normalizedId.includes("/@pixi/")) {
    return "pixi-vendor";
  }

  if (normalizedId.includes("/@supabase/")) {
    return "supabase-vendor";
  }

  if (normalizedId.includes("/framer-motion/")) {
    return "motion-vendor";
  }

  return undefined;
}

const releaseTerserOptions = {
  compress: {
    drop_console: true,
    drop_debugger: true,
    passes: 2,
    pure_getters: true,
    unsafe_arrows: false,
    unsafe_methods: false,
  },
  format: {
    comments: false,
  },
  mangle: true,
};

// See: https://vite.dev/config/
export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const buildProfile = env.FLAND_BUILD_PROFILE ?? process.env.FLAND_BUILD_PROFILE ?? "default";
  const isReleaseBuild = buildProfile === "release";
  const isAnalyzeBuild = readFlag(
    env.FLAND_BUILD_ANALYZE ?? process.env.FLAND_BUILD_ANALYZE,
    false
  );
  const obfuscateRenderer = readFlag(
    env.FLAND_OBFUSCATE_RENDERER ?? process.env.FLAND_OBFUSCATE_RENDERER,
    isReleaseBuild
  );
  const obfuscatePreload = readFlag(
    env.FLAND_OBFUSCATE_PRELOAD ?? process.env.FLAND_OBFUSCATE_PRELOAD,
    isReleaseBuild
  );
  const obfuscateMain = readFlag(
    env.FLAND_OBFUSCATE_MAIN ?? process.env.FLAND_OBFUSCATE_MAIN,
    isReleaseBuild
  );
  const rendererObfuscationPlugin = createObfuscationPlugin("renderer", obfuscateRenderer);
  const preloadObfuscationPlugin = createObfuscationPlugin("preload", obfuscatePreload);
  const mainObfuscationPlugin = createObfuscationPlugin("main", obfuscateMain);

  return {
    define: {
      "import.meta.env.VITE_APP_VERSION": JSON.stringify(version),
      "import.meta.env.FLAND_UPDATE_REPOSITORY": JSON.stringify(
        env.FLAND_UPDATE_REPOSITORY ?? process.env.FLAND_UPDATE_REPOSITORY ?? ""
      ),
    },
    plugins: [
      ...(command === "serve" ? [devtools()] : []),
      viteTsConfigPaths({
        projects: ["./tsconfig.json"],
      }),
      tailwindcss(),
      TanStackRouterVite({
        routeFileIgnorePattern: "\\.(test|spec)\\.(ts|tsx)$",
      }),
      viteReact(),
      electron({
        main: {
          entry: "electron/main.ts",
          vite: {
            build: {
              minify: isReleaseBuild ? "terser" : "esbuild",
              sourcemap: false,
              target: "node20",
              terserOptions: isReleaseBuild ? releaseTerserOptions : undefined,
              rollupOptions: {
                external: ["@libsql/client"],
                plugins: mainObfuscationPlugin ? [mainObfuscationPlugin] : [],
              },
            },
          },
        },
        preload: {
          input: "electron/preload.ts",
          vite: {
            build: {
              minify: isReleaseBuild ? "terser" : "esbuild",
              sourcemap: false,
              target: "node20",
              terserOptions: isReleaseBuild ? releaseTerserOptions : undefined,
              rollupOptions: {
                plugins: preloadObfuscationPlugin ? [preloadObfuscationPlugin] : [],
                output: {
                  format: "cjs",
                  entryFileNames: "[name].cjs",
                },
              },
            },
          },
        },
      }),
    ],

    clearScreen: false,

    server: {
      port: 3000,
      strictPort: true,
    },

    build: {
      cssMinify: true,
      minify: isReleaseBuild ? "terser" : "esbuild",
      outDir: "dist",
      emptyOutDir: true,
      reportCompressedSize: isReleaseBuild || isAnalyzeBuild,
      sourcemap: false,
      target: "es2022",
      terserOptions: isReleaseBuild ? releaseTerserOptions : undefined,
      rollupOptions: {
        output: {
          manualChunks: createManualChunks,
        },
        plugins: rendererObfuscationPlugin ? [rendererObfuscationPlugin] : [],
      },
    },
  };
});
