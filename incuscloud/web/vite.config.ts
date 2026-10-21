import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";

// Incendio's SCSS settings (breakpoints, indices), as packages/ui itself prepends them.
const incendio = fileURLToPath(new URL("../../packages/ui/src", import.meta.url));
const incendioSettings = readFileSync(new URL("../../packages/ui/src/sass/_settings.scss", import.meta.url), "utf8").trim();

// Development: `bun run watch` here and `scripts/dev.sh`, which serves build/
// at https://127.0.0.1:7443/ (sign-in redirects need the server's own origin).
export default defineConfig({
  base: "/",
  css: {
    preprocessorOptions: {
      scss: {
        silenceDeprecations: ["global-builtin", "import", "if-function"],
        // Fonts from /assets/vf/ (copies of assets.ubuntu.com/v1/), for air-gapped installs.
        additionalData: `${incendioSettings}\n$assets-path: "/assets/vf/";\n`,
      },
    },
  },
  resolve: {
    alias: [
      // Incendio itself (packages/ui): its components, and its pages over the federation facade.
      { find: "@incendio/ui", replacement: incendio },
      // Incendio's own imports are bare (its tsconfig paths): api/…, pages/…, util/….
      { find: /^(api|components|context|lib|pages|types|util)\/(.*)$/, replacement: `${incendio}/$1/$2` },
    ],
    // One copy of each library both use: packages/ui has its own node_modules.
    dedupe: ["react", "react-dom", "react-router", "react-router-dom", "@tanstack/react-query", "classnames", "@canonical/react-components"],
  },
  define: {
    __APP_VERSION__: JSON.stringify(JSON.parse(readFileSync(new URL("package.json", import.meta.url), "utf8")).version),
    __UI_GIT_HASH__: JSON.stringify("incuscloud"),
  },
  plugins: [react()],
  build: { outDir: "build", emptyOutDir: true },
});
