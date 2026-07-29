import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The web app talks only to our proxy server (never to Algolia directly).
// Proxy /api/* to the Node server so there are no CORS surprises in dev.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:8787",
    },
  },
});
