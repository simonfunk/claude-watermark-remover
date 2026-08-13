import { defineConfig } from "@playwright/test";

const PORT = Number(process.env.E2E_PORT ?? 4310);

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 30_000,
  fullyParallel: true,
  reporter: [["list"]],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
  },
  webServer: {
    command: "node scripts/serve.mjs",
    port: PORT,
    env: { PORT: String(PORT) },
    reuseExistingServer: false,
    timeout: 15_000,
  },
});
