import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // The backend is HTTPS-only (self-signed cert, generated on first
      // boot) — secure: false tells this dev-server-to-backend proxy hop
      // (localhost to localhost, not exposed externally) to accept it
      // without cert validation, same as accepting the browser warning
      // when hitting the backend directly.
      "/api": { target: "https://localhost:7431", secure: false },
      "/ws": { target: "wss://localhost:7431", ws: true, secure: false },
    },
  },
  build: {
    outDir: "../backend/public",
    emptyOutDir: true,
  },
});
