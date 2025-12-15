import { defineConfig } from "vite";

export default defineConfig({
  server: {
    host: true,
    strictPort: true,
    proxy: {
      "/api": {
        target: "http://localhost:3001",
        changeOrigin: true,
    secure: false,
      },
    },
  },
});
