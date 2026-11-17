import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const routerUrl = process.env.ROUTER_DEV_URL ?? "http://127.0.0.1:4500";

export default defineConfig(({ command }) => ({
  plugins: [react()],
  base: command === "build" ? "/dashboard/" : "/",
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      "/api": { target: routerUrl, changeOrigin: true },
      "/v1": { target: routerUrl, changeOrigin: true },
      "/healthz": { target: routerUrl, changeOrigin: true },
    },
  },
}));
