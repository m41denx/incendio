import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Development: `bun run watch` here and `scripts/dev.sh`, which serves build/
// at https://127.0.0.1:7443/ (sign-in redirects need the server's own origin).
export default defineConfig({
  base: "/",
  css: {
    preprocessorOptions: {
      scss: {
        silenceDeprecations: ["global-builtin", "import", "if-function"],
        // Fonts from /assets/vf/ (copies of assets.ubuntu.com/v1/), for air-gapped installs.
        additionalData: `$font-use-subset-latin: true;\n$breakpoint-large: 1090px;\n$assets-path: "/assets/vf/";\n`,
      },
    },
  },
  plugins: [react()],
  build: { outDir: "build", emptyOutDir: true },
});
