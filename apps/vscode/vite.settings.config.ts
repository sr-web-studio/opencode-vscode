import { defineConfig } from "vite"
import { svelte } from "@sveltejs/vite-plugin-svelte"
import { resolve } from "node:path"

// The OpenCode Settings panel is a second webview with its own bundle. Rollup's IIFE output supports one input, so
// this build is separate from the chat's `vite.config.ts`. Fixed names let the extension host reference the files
// without a manifest: dist/settings/settings.js, settings.css and settings.ttf.
export default defineConfig({
  root: resolve(import.meta.dirname, "src/settings-webview"),
  base: "./",
  plugins: [svelte()],
  build: {
    outDir: resolve(import.meta.dirname, "dist/settings"),
    emptyOutDir: true,
    cssCodeSplit: false,
    sourcemap: true,
    target: "es2022",
    rollupOptions: {
      input: resolve(import.meta.dirname, "src/settings-webview/main.ts"),
      output: {
        format: "iife",
        entryFileNames: "settings.js",
        assetFileNames: "settings[extname]",
      },
    },
  },
})
