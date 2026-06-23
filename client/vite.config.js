import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// In dev, proxy /api to the backend so the client and server feel like one origin.
// Port 5174 + target :4001 keep Michi clear of Tsumiki (5173 / :4000) on the same box.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
    proxy: { "/api": { target: process.env.API_TARGET || "http://localhost:4001" } },
  },
  build: { outDir: "dist" },
});
