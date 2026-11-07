import { defineConfig } from "vite"
import { svelte } from "@sveltejs/vite-plugin-svelte"
import tailwindcss from "@tailwindcss/vite"

// The WebView loads the build from the app itself (Capacitor serves `dist/`), so a normal ES build with hashed assets is fine.
// `bun run dev` serves the same app at http://localhost:5173 for desktop testing.
export default defineConfig({
  plugins: [tailwindcss(), svelte()],
  server: { host: "127.0.0.1", port: 5173, strictPort: true },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: false,
    target: "es2022",
  },
})
