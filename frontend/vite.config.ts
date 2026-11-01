import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// The page calls /api, the paths CloudFront will forward to the backend
// (ADR-0003). Locally, Vite forwards them to the backend on :3000.
const proxy = { "/api": "http://localhost:3000" };

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { proxy },
  preview: { proxy },
  // AG Charts is about 1.3 MB minified, 390 KB gzipped, so Vite's 500 KB
  // warning would fire on every build. It loads on its own, after the first
  // question (ADR-0012).
  build: { chunkSizeWarningLimit: 1400 },
  test: {
    environment: "jsdom",
    setupFiles: ["test/setup.ts"],
    // West of UTC, where a day labeled in local time shows as the day before.
    env: { TZ: "America/Los_Angeles" },
  },
});
