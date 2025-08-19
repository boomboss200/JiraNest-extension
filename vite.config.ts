import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        popup: resolve(__dirname, "index.html"),
        background: resolve(__dirname, "src/background.ts"),
        provider_cb: resolve(__dirname, "public/provider_cb.html")
      },
      output: {
        entryFileNames: "[name].js"
      }
    }
  }
});
