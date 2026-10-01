import { test, expect, type Page } from "@playwright/test";

/**
 * 真浏览器验证：模型名下拉「点箭头有反应」。
 * 背景：原来是原生 <datalist>，弹层是浏览器自己的 UI —— 实测在真 Edge/Chromium 里连一个最小
 * 可用的 datalist 都点不开，既定位不了也验证不了。现已换成 ModelInput 自己画的受控下拉。
 * 所有 /api/* 走 route mock，不依赖后端。
 */

const ROLE_CLAIM = "http://schemas.microsoft.com/ws/2008/06/identity/claims/role";
const makeToken = (role: string) => {
  const payload = Buffer.from(JSON.stringify({ [ROLE_CLAIM]: role, exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url");
  return `e2e.${payload}.sig`;
};

/** 模型名那一行刻意放在卡片中间：卡片有 overflow-hidden，弹层被裁掉的话这里会露馅 */
const settings = {
  "AI 服务": [
    { key: "AI:SystemPrompt", value: "", category: "AI 服务", description: "AI 助手系统提示词" },
    { key: "AI:ModelName", value: "deepseek-v4-pro", category: "AI 服务", description: "对话/分析模型名称" },
    { key: "AI:ApiKey", value: "sk-secret", category: "AI 服务", description: "API Key" },
    { key: "AI:Temperature", value: "1.0", category: "AI 服务", description: "温度" },
  ],
};

const fetchedModels = [{ id: "deepseek-v4-pro" }, { id: "deepseek-v4-flash" }, { id: "deepseek-v4-lite" }];

async function mockApi(page: Page, opts: { wiki?: boolean } = {}) {
  await page.route("**/api/**", async route => {
    const path = new URL(route.request().url()).pathname;
    const json = (d: unknown) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(d) });
    if (path === "/api/auth/me") return json({ id: 1, username: "e2e-admin", role: "admin", department: null });
    if (path.startsWith("/api/notifications")) return json([]);
    if (path === "/api/public/brand") return json({ teamName: "雏鹰之翼", teamSubtitle: "航模队", systemTitle: "系统", description: "", logoUrl: null, primaryColor: null, theme: "indigo" });
    if (path === "/api/admin/settings") return json(settings);
    if (path === "/api/admin/ai/default-prompt") return json({ prompt: "你是助手" });
    if (path === "/api/admin/ai/models") return json({ ok: true, error: null, baseUrl: "https://api.deepseek.com", models: fetchedModels });
    if (opts.wiki && path === "/api/wiki/settings") {
      return json({ catalogModel: "deepseek-v4-pro", contentModel: "deepseek-v4-pro", maxOutputTokens: 32768, parallelCount: 3, maxRetryAttempts: 2, retryDelayMs: 2000, directoryTreeMaxDepth: -1, readmeMaxLength: 10000, documentGenerationTimeoutMinutes: 120, temperature: 1, topP: 1, thinkingMode: "thinking", documentLanguage: "zh-CN" });
    }
    return json({});
  });
}

test.describe("模型名下拉（真浏览器）", () => {
  test("设置页点箭头就展开候选，选中写回输入框，仍可手输任意值；弹层不被卡片裁掉", async ({ page }) => {
    await mockApi(page);
    await page.addInitScript(t => localStorage.setItem("token", t), makeToken("admin"));
    await page.goto("/admin/settings");

    const input = page.locator('input[aria-label="AI:ModelName"]');
    await expect(input).toHaveValue("deepseek-v4-pro");
    const toggle = page.getByTestId("model-input-toggle").first();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");

    await toggle.click();

    // 展开：4 条内置候选（只数弹层里的，页面上原生 select 的 option 也是 role=option）
    const options = page.locator('[data-testid="model-input-options"] [role="option"]');
    await expect(options).toHaveCount(4);
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    const hitLast = await page.evaluate(() => {
      const list = document.querySelector('[data-testid="model-input-options"]');
      const last = list?.lastElementChild as HTMLElement | undefined;
      if (!list || !last) return "no-list";
      const r = last.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return hit && list.contains(hit) ? "hit" : `miss:${hit?.tagName ?? "null"}`;
    });
    expect(hitLast).toBe("hit");

    // 选中候选 → 写回输入框并收起
    await page.getByTestId("model-option-deepseek-reasoner").click();
    await expect(input).toHaveValue("deepseek-reasoner");
    await expect(page.getByTestId("model-input-options")).toHaveCount(0);

    // 仍可自由输入（不是只能选的 select）
    await input.fill("my-self-hosted-qwen3-32b");
    await expect(input).toHaveValue("my-self-hosted-qwen3-32b");
  });

  test("点「获取可用模型」后，候选换成服务商返回的现行列表", async ({ page }) => {
    await mockApi(page);
    await page.addInitScript(t => localStorage.setItem("token", t), makeToken("admin"));
    await page.goto("/admin/settings");

    await page.getByRole("button", { name: "获取可用模型" }).click();
    await expect(page.getByText(/获取到 3 个模型/)).toBeVisible();

    await page.getByTestId("model-input-toggle").first().click();
    await expect(page.locator('[data-testid="model-input-options"] [role="option"]')).toHaveCount(3);
    await expect(page.getByTestId("model-option-deepseek-v4-lite")).toBeVisible();
  });

  test("Wiki 设置页复用的两个 ModelInput 各弹各的、写回互不串台", async ({ page }) => {
    await mockApi(page, { wiki: true });
    await page.addInitScript(t => localStorage.setItem("token", t), makeToken("admin"));
    await page.goto("/admin/wiki-settings");

    const toggles = page.getByTestId("model-input-toggle");
    await expect(toggles).toHaveCount(2);

    await toggles.nth(1).click(); // 「文档生成模型」
    await expect(page.locator('[data-testid="model-input-options"] [role="option"]')).toHaveCount(4);
    await page.getByTestId("model-option-deepseek-chat").click();

    await expect(page.locator('input[aria-label="文档生成模型"]')).toHaveValue("deepseek-chat");
    await expect(page.locator('input[aria-label="目录生成模型"]')).toHaveValue("deepseek-v4-pro");
    await expect(page.getByTestId("model-input-options")).toHaveCount(0);
  });
});

test.describe("模型名下拉（手机 390×844）", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("手机上点箭头同样能展开、最后一条也点得到（不被卡片裁掉）", async ({ page }) => {
    await mockApi(page);
    await page.addInitScript(t => localStorage.setItem("token", t), makeToken("admin"));
    await page.goto("/admin/settings");

    const input = page.locator('input[aria-label="AI:ModelName"]');
    await input.scrollIntoViewIfNeeded();
    await page.getByTestId("model-input-toggle").first().click();

    const options = page.locator('[data-testid="model-input-options"] [role="option"]');
    await expect(options).toHaveCount(4);
    const hitLast = await page.evaluate(() => {
      const list = document.querySelector('[data-testid="model-input-options"]');
      const last = list?.lastElementChild as HTMLElement | undefined;
      if (!list || !last) return "no-list";
      const r = last.getBoundingClientRect();
      if (r.bottom > window.innerHeight || r.top < 0) return "offscreen";
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return hit && list.contains(hit) ? "hit" : `miss:${hit?.tagName ?? "null"}`;
    });
    expect(hitLast).toBe("hit");

    await page.getByTestId("model-option-deepseek-chat").click();
    await expect(input).toHaveValue("deepseek-chat");
  });
});
