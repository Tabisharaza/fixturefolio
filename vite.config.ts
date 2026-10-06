import { defineConfig } from "vitest/config";

export default defineConfig({
  base: "./",
  test: {
    include: ["src/**/*.test.{ts,tsx}"],
    environment: "node",
    coverage: { include: ["src/core/**"] },
  },
  build: { target: "es2022" },
});
