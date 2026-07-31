import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // Pinned so ctime's local-vs-UTC parsing tests are deterministic across
    // machines/CI, and so they exercise the real UTC+7 offset observed on
    // the operator's machine (see ctime.ts doc comment).
    env: {
      TZ: "Asia/Bangkok",
    },
  },
});
