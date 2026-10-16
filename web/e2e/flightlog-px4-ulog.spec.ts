import { test, expect, type Page } from "@playwright/test";
import { existsSync } from "node:fs";
import { join } from "node:path";

/**
 * PX4 `.ulg` 的**真浏览器端到端**验证（Lead 明确要求，补上一直欠的验证）。
 *
 * 门控两层，都不静默：
 *  ① `FLIGHTLOG_ULOG_DIR`（仓库里不出现真实路径）；没有 → `test.skip` 并打印原因；
 *  ② PX4 规则需要在 `rules/index.ts` 注册（归 Lead）；没注册 → `test.skip` 并打印原因，
 *     免得 CI 里出现"功能没接线"的假红。
 *
 * 断言的就是这次修的两个 bug：
 *  - 图表「实际」必须是**欧拉角（度）**，标签不能再写"四元数 q0"（否则两条线量纲不同）；
 *  - 绝对量判据的卡片里**不得出现 errRatio**（曾经展示 −1 哨兵）。
 */

const ROLE_CLAIM = "http://schemas.microsoft.com/ws/2008/06/identity/claims/role";
const makeToken = () => {
  const payload = Buffer.from(
    JSON.stringify({ [ROLE_CLAIM]: "admin", exp: Math.floor(Date.now() / 1000) + 3600 }),
  ).toString("base64url");
  return `e2e.${payload}.sig`;
};

const DIR = process.env.FLIGHTLOG_ULOG_DIR ?? "";
const ULOG = DIR.length > 0 ? join(DIR, "log_11_2026-6-8-10-36-28.ulg") : "";
const SCREENSHOT = process.env.PX4_SHOT_PATH ?? join(process.env.TEMP ?? ".", "px4-angle-loop.png");

async function mockApi(page: Page) {
  await page.route("**/api/**", async route => {
    const p = new URL(route.request().url()).pathname;
    const json = (d: unknown) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(d) });
    if (p === "/api/auth/me") return json({ id: 1, username: "e2e-admin", role: "admin", department: null });
    if (p.startsWith("/api/notifications")) return json([]);
    if (p === "/api/public/brand")
      return json({
        teamName: "雏鹰之翼", teamSubtitle: "航模队", systemTitle: "系统",
        description: "", logoUrl: null, primaryColor: null, theme: "indigo",
      });
    return json({});
  });
}

test("真 .ulg：PX4 角度环图表两条线同为「度」（不是四元数 q0），且无 errRatio 哨兵", async ({ page }) => {
  test.skip(!existsSync(ULOG), `未提供真实 .ulg（FLIGHTLOG_ULOG_DIR=${DIR}），跳过端到端验证`);
  const consoleErrors: string[] = [];
  page.on("console", m => { if (m.type() === "error") consoleErrors.push(m.text()); });

  await mockApi(page);
  await page.addInitScript(t => localStorage.setItem("token", t), makeToken());
  // dev 模式首次访问该路由要现编译 + 水合；生产构建下这些等待是瞬时的。
  // 关键：**必须等水合完成再点 tab**，否则点击会丢（服务端 HTML 里 tab 已经可见）。
  await page.goto("/flightlog");
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("tab", { name: "诊断" })).toBeVisible({ timeout: 60_000 });
  const dropzone = page.getByTestId("diagnosis-dropzone");
  for (let attempt = 0; attempt < 3 && !(await dropzone.isVisible().catch(() => false)); attempt += 1) {
    await page.waitForTimeout(2_500);
    await page.getByRole("tab", { name: "诊断" }).click({ force: true });
    await page.waitForTimeout(1_500);
  }
  await expect(dropzone).toBeVisible({ timeout: 60_000 });

  await page.getByTestId("diagnosis-file-input").setInputFiles(ULOG);
  await expect(page.getByTestId("diagnosis-report")).toBeVisible({ timeout: 60_000 });

  const cards = page.locator('[data-rule-id="px4_attitude_tracking"]');
  test.skip((await cards.count()) === 0, "PX4 规则尚未注册到 rules/index.ts（归 Lead），跳过端到端验证");

  // 找 Roll 角度环那张卡片（标题里带 Roll）
  const roll = cards.filter({ hasText: "Roll" }).first();
  await expect(roll).toBeVisible();
  await roll.getByTestId("finding-toggle").click();

  // ① 图表标签：必须是「度」+ 欧拉角，不能再有"四元数 q0"当成实际姿态
  const chart = roll.getByTestId("diagnosis-chart").first();
  const legendLabels = await chart.locator(".u-legend .u-series, .u-legend th").allInnerTexts();
  const legendText = legendLabels.join(" | ");
  expect(legendText, `图例应标明单位为度：${legendText}`).toContain("度");
  expect(legendText).toContain("欧拉角");
  expect(legendText).not.toContain("q0");

  // ② 卡片里不得再出现 errRatio（−1 哨兵），且必须有 errRms
  const cardText = (await roll.innerText()).replace(/\s+/g, " ");
  expect(cardText).not.toContain("errRatio");
  expect(cardText).toContain("errRms");

  // ③ 悬停读图例数值：实际值必须是"度"的量级（不是 q0≈0.7），且与指令同量级
  await chart.getByTestId("diagnosis-chart-canvas").hover({ position: { x: 200, y: 60 } });
  const values = (await chart.locator(".u-legend .u-value").allInnerTexts())
    .map(v => Number(v.replace(/[^\d.+-]/g, "")))
    .filter(v => Number.isFinite(v));
  console.log(`[e2e-px4] 图例标签：${legendText}`);
  console.log(`[e2e-px4] 悬停读到的数值：${JSON.stringify(values)}`);
  expect(values.length).toBeGreaterThanOrEqual(2);
  const plausibleDegrees = values.filter(v => Math.abs(v) > 1);
  expect(plausibleDegrees.length, `图例数值应出现"度"量级（>1）：${JSON.stringify(values)}`).toBeGreaterThanOrEqual(1);

  await roll.screenshot({ path: SCREENSHOT });
  console.log(`[e2e-px4] 截图已保存：${SCREENSHOT}`);
  expect(consoleErrors.filter(e => !e.includes("favicon"))).toEqual([]);
});
