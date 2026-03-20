import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { nodePolyfills } from "vite-plugin-node-polyfills";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    nodePolyfills({
      include: ["buffer", "events", "util", "stream", "crypto"],
      globals: { Buffer: true },
    }),
  ],
  optimizeDeps: {
    include: ["snarkjs", "circomlibjs"],
  },
});
