import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    api: "src/api/index.ts",
    node: "src/node.ts",
    types: "src/types.ts",
  },
  format: ["esm", "cjs"],
  dts: true,
  clean: true,
  sourcemap: true,
  target: "es2022",
  external: ["axios", "ws"],
});
