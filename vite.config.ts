import { defineConfig } from "vite"
import { svelte } from "@sveltejs/vite-plugin-svelte"
import tailwindcss from "@tailwindcss/vite"
import { resolve } from "node:path"

// Webview bundle: one classic script + one stylesheet with fixed names, so the
// extension host can reference them without a manifest.
export default defineConfig({
  root: resolve(import.meta.dirname, "src/webview"),
  base: "./",
  plugins: [tailwindcss(), svelte()],
  resolve: { alias: { $core: resolve(import.meta.dirname, "src/core"), $ui: resolve(import.meta.dirname, "src/ui") } },
  build: {
    outDir: resolve(import.meta.dirname, "dist/webview"),
    emptyOutDir: true,
    cssCodeSplit: false,
    sourcemap: true,
    target: "es2022",
    rollupOptions: {
      input: resolve(import.meta.dirname, "src/webview/main.ts"),
      output: {
        format: "iife",
        entryFileNames: "main.js",
        assetFileNames: "main[extname]",
        
      },
    },
  },
})
