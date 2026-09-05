import { defineConfig, devices } from "@playwright/test";

/**
 * E2E 冒烟测试配置。
 * 后端不真启 —— 所有 /api/* 请求由 page.route 拦截 mock（见 e2e/smoke.spec.ts），
 * 前端用生产构建 (next build && next start) 跑真实渲染与路由。
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: "http://127.0.0.1:3100",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: {
    command: "npm run build && npx next start -p 3100",
    url: "http://127.0.0.1:3100/auth/login",
    reuseExistingServer: !process.env.CI,
    timeout: 420_000,
  },
});
