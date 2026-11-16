import { defineConfig } from "vitest/config";
import type { Plugin } from "vite";
import { copyFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

// Salin manifest.json (dan config JSON untuk referensi) ke dist/ setelah build.
function copyManifest(): Plugin {
  return {
    name: "copy-manifest",
    apply: "build",
    closeBundle() {
      const out = resolve(import.meta.dirname, "dist");
      mkdirSync(resolve(out, "config"), { recursive: true });
      copyFileSync(resolve(import.meta.dirname, "src/manifest.json"), resolve(out, "manifest.json"));
      for (const f of ["thresholds.json", "brokers.json", "selectors.json"]) {
        copyFileSync(resolve(import.meta.dirname, "src/config", f), resolve(out, "config", f));
      }
    },
  };
}

export default defineConfig({
  publicDir: false,
  build: {
    outDir: "dist",
    emptyOutDir: true,
    minify: false,
    sourcemap: false,
    // Content script MV3 harus classic script (bukan ES module) -> format IIFE.
    lib: {
      entry: resolve(import.meta.dirname, "src/content/index.ts"),
      name: "RadarBandarIDX",
      formats: ["iife"],
      fileName: () => "content.js",
    },
  },
  plugins: [copyManifest()],
  test: {
    globals: true,
    environment: "node",
    include: ["tests/unit/**/*.test.ts"],
  },
});
