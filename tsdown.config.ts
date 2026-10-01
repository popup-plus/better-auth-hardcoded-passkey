import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts", "src/client.ts"],
  dts: true,
  loader: { ".html": "text" },
  publint: true,
  attw: { profile: "esm-only", level: "error" },
});
