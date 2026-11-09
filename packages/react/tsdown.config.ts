import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts"],
  format: "esm",
  dts: true,
  platform: "browser",
  banner: ({ fileName }) => (fileName.endsWith(".js") ? '"use client";' : undefined),
  deps: {
    neverBundle: ["react", "react-dom", "react/jsx-runtime", "@pierre/diffs", /^@pierre\/diffs\//],
  },
});
