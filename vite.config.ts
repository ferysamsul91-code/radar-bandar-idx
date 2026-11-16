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

// Entri tambahan (dibangun terpisah, satu file IIFE masing-masing, tanpa mengosongkan dist/):
//   vite build --mode background -> dist/background.js (service worker)
//   vite build --mode options    -> dist/options.js + dist/options.html (halaman pengaturan publikasi)
const EXTRA: Record<string, { entry: string; file: string; name: string; html?: string }> = {
  background: { entry: "src/background/index.ts", file: "background.js", name: "RadarBandarBG" },
  options: { entry: "src/options/index.ts", file: "options.js", name: "RadarBandarOptions", html: "src/options/options.html" },
};

function copyHtml(src: string): Plugin {
  return {
    name: "copy-html",
    apply: "build",
    closeBundle() {
      copyFileSync(resolve(import.meta.dirname, src), resolve(import.meta.dirname, "dist", "options.html"));
    },
  };
}

export default defineConfig(({ mode }) => {
  const extra = EXTRA[mode];
  if (extra) {
    return {
      publicDir: false,
      build: {
        outDir: "dist",
        emptyOutDir: false,
        minify: false,
        sourcemap: false,
        lib: { entry: resolve(import.meta.dirname, extra.entry), name: extra.name, formats: ["iife"], fileName: () => extra.file },
      },
      plugins: extra.html ? [copyHtml(extra.html)] : [],
    };
  }
  return {
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
  };
});
