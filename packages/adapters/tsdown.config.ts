import { defineConfig } from "tsdown";

export default defineConfig({
  entry: [
    "src/index.ts",
    "src/ai-sdk.ts",
    "src/claude-code.ts",
    "src/opencode.ts",
    "src/codex.ts",
    "src/pi.ts",
  ],
  format: "esm",
  dts: true,
  platform: "neutral",
});
