import { defineConfig } from "vite"
import { svelte } from "@sveltejs/vite-plugin-svelte"
import tailwindcss from "@tailwindcss/vite"
import pkg from "./package.json" with { type: "json" }

// The WebView loads the build from the app itself (Capacitor serves `dist/`), so a normal ES build with hashed assets is fine.
// `bun run dev` serves the same app at http://localhost:5173 for desktop testing.
export default defineConfig({
  plugins: [tailwindcss(), svelte()],
  // The one place the app's version is read from: package.json (shown in Settings, see src/lib/version.ts).
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  server: { host: "127.0.0.1", port: 5173, strictPort: true },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: false,
    target: "es2022",
  },
})
