import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";

// Incendio's SCSS settings (breakpoints, indices), as packages/ui itself prepends them.
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
    // Incendio's own components (packages/ui), shared rather than copied.
    alias: { "@incendio/ui": fileURLToPath(new URL("../../packages/ui/src", import.meta.url)) },
    // One React (and component library) for both: packages/ui has its own node_modules.
    dedupe: ["react", "react-dom", "classnames", "@canonical/react-components"],
  },
  define: { __APP_VERSION__: JSON.stringify(JSON.parse(readFileSync(new URL("package.json", import.meta.url), "utf8")).version) },
  plugins: [react()],
  build: { outDir: "build", emptyOutDir: true },
});
