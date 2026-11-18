import { resolve } from "node:path";
import { defineConfig } from "vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [viteReact(), tailwindcss()],
  resolve: { alias: { "@": resolve(__dirname, "src") } },
  base: "./",
  publicDir: "public",
  build: {
    outDir: "dist-android",
    emptyOutDir: true,
    rollupOptions: { input: resolve(__dirname, "android.html") },
  },
});
