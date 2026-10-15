import { test, expect, type Page } from "@playwright/test";
import { join } from "node:path";

/**
 * 诊断标签页的**真浏览器全链路**验证：
 * 真 .bin 切片 → 数据解析（Web Worker）→ 确定性规则引擎 → 首屏报告 → uPlot 渲染。
 *
 * 后端的 /api/* 全部 mock（本功能不访问后端，解析与规则都在本地），
 * 所以这里验证的正是"没有服务端也能诊断"这个前提。
 *
 * 切片 `quad_20260617_head200k.bin` 是真实日志的**字节精确前 200 KB**，
 * 含全部 FMT/PARM 与约 3.7 s 数据（VIBE/PID 各 37 条）。
 * 37 条低于规则的最小样本门槛 → 结论应落在"无法判断"一侧，
 * 这同时验证了"数据不足时绝不判通过"的纪律。
 */

const ROLE_CLAIM = "http://schemas.microsoft.com/ws/2008/06/identity/claims/role";
const makeToken = () => {
  const payload = Buffer.from(
    JSON.stringify({ [ROLE_CLAIM]: "admin", exp: Math.floor(Date.now() / 1000) + 3600 }),
  ).toString("base64url");
  return `e2e.${payload}.sig`;
};

const SLICE = join(process.cwd(), "tests", "fixtures", "flightlog", "quad_20260617_head200k.bin");

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
    if (p === "/api/flightlogs") return json({ logs: [] });
    return json({});
  });
}

async function openDiagnosisTab(page: Page) {
  await mockApi(page);
  await page.addInitScript(t => localStorage.setItem("token", t), makeToken());
  await page.goto("/flightlog");
  await page.getByRole("tab", { name: "诊断" }).click();
  await expect(page.getByTestId("diagnosis-dropzone")).toBeVisible();
}

test("真 .bin 切片：全链路跑通并出首屏报告（不是「尚未接线」）", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", m => { if (m.type() === "error") consoleErrors.push(m.text()); });
  await openDiagnosisTab(page);

  await page.getByTestId("diagnosis-file-input").setInputFiles(SLICE);

  // 解析 + 规则（真 Worker / 主线程兜底）应在数秒内完成
  await expect(page.getByTestId("diagnosis-report")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("diagnosis-error")).toHaveCount(0);

  // 报告头必须解析出真实固件信息（证明解析器真的读到了 MSG/VER 与 PARM）
  await expect(page.getByText(/ArduCopter/).first()).toBeVisible();
  await expect(page.getByText(/4\.6\.2/).first()).toBeVisible();

  // 三条规则都必须出结论
  await expect(page.getByText("振动超标").first()).toBeVisible();
  await expect(page.getByText("速率环跟踪质量").first()).toBeVisible();
  await expect(page.getByText("滤波有效性").first()).toBeVisible();

  console.log(`[e2e] 首屏报告渲染完成；console.error=${consoleErrors.length} 条`);
});

test("负向对照：未通过的结论一条都不许显示「通过」，且必须给出原因", async ({ page }) => {
  await openDiagnosisTab(page);
  await page.getByTestId("diagnosis-file-input").setInputFiles(SLICE);
  await expect(page.getByTestId("diagnosis-report")).toBeVisible({ timeout: 30_000 });

  const cards = page.locator('[data-testid="finding-card"]');
  const cardCount = await cards.count();
  expect(cardCount).toBeGreaterThan(0);

  for (let i = 0; i < cardCount; i++) {
    const card = cards.nth(i);
    const status = await card.getAttribute("data-status");
    const severity = (
      await card.locator('[data-testid="finding-severity"]').innerText()
    ).trim();
    if (status !== "passed") {
      // 未通过的一律不能带"通过"等级徽标
      expect(severity).not.toBe("通过");
      // 而且必须给出原因，不能只丢一个"未知"
      await expect(card.getByTestId("finding-note")).toBeVisible();
    }
  }

  // 切片只有约 3.7 s 数据（VIBE/PID 各 37 条，低于最小样本门槛）→ 必须真的存在"数据不足"的结论。
  // 注意：**不能**再断言"一条通过都没有** —— 参数类规则（如导航器参数）在短切片上照样可以判通过，
  // 那是正确行为。本用例守的是"未通过的不得显示为通过"，不是"不许有通过"。
  const insufficient = page.locator('[data-testid="finding-card"][data-status="insufficient_data"]');
  expect(await insufficient.count()).toBeGreaterThan(0);
  await expect(insufficient.first().getByTestId("finding-note")).toBeVisible();

  await expect(page.getByText(/原因[：:]/).first()).toBeVisible();

  // 回归防线（线上缺口）：**任何**结论里，note 与建议都必须默认可见 ——
  // 以前 note 只在 unknown 一侧渲染、建议藏在折叠里，于是 fired 结论上的
  // "起点值声明 / 降落段排除依据"与参数建议整块看不见，恰恰是最需要它们的时候。
  const statuses: Record<string, number> = {};
  for (let i = 0; i < cardCount; i++) {
    const card = cards.nth(i);
    const status = (await card.getAttribute("data-status")) ?? "unknown";
    statuses[status] = (statuses[status] ?? 0) + 1;

    const note = card.getByTestId("finding-note");
    if ((await note.count()) > 0) await expect(note.first()).toBeVisible();

    const suggestions = card.getByTestId("finding-suggestions");
    if ((await suggestions.count()) > 0) {
      await expect(suggestions.first()).toBeVisible();
      const to = suggestions.first().getByTestId("suggestion-param-to");
      if ((await to.count()) > 0) await expect(to.first()).not.toBeEmpty();
    }
  }
  console.log(`[e2e] 卡片状态分布：${JSON.stringify(statuses)}`);
});

test("不支持的格式：给出可读原因，而不是晦涩的解析错误", async ({ page }) => {
  await openDiagnosisTab(page);
  // 注意：`.ulg`（PX4 ULog）**现在是支持格式**（runDiagnosis 已路由到 ulog 解析器），
  // 所以这里改用仍然不支持的 `.tlog` 来守"给可读原因"这条线。
  await page.getByTestId("diagnosis-file-input").setInputFiles({
    name: "flight.tlog",
    mimeType: "application/octet-stream",
    buffer: Buffer.from("tlog-not-dataflash"),
  });
  await expect(page.getByTestId("diagnosis-error")).toBeVisible();
  await expect(page.getByText(/遥测日志|tlog/)).toBeVisible();
});

test("垃圾字节的 .bin：不崩、不静默，仍给出结论（无法判断）", async ({ page }) => {
  await openDiagnosisTab(page);
  await page.getByTestId("diagnosis-file-input").setInputFiles({
    name: "garbage.bin",
    mimeType: "application/octet-stream",
    buffer: Buffer.from(Array.from({ length: 4096 }, (_, i) => (i * 37) % 251)),
  });
  // 要么出报告（结论全为无法判断/不适用），要么给出可读错误；绝不能白屏或静默
  await expect(
    page.getByTestId("diagnosis-report").or(page.getByTestId("diagnosis-error")),
  ).toBeVisible({ timeout: 30_000 });
});
