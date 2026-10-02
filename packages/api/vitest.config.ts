import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    testTimeout: 60000,
    hookTimeout: 60000,
    globalSetup: "./test/global-setup.ts",
    env: {
      NODE_ENV: "test",
      DATABASE_URL:
        "postgresql://curvelo:curvelo_dev@localhost:5432/curvelo_test",
      JWT_ACCESS_SECRET: "test-access-secret",
      JWT_REFRESH_SECRET: "test-refresh-secret",
    },
  },
});
