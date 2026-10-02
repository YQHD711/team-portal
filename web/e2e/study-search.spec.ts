import { test, expect, type Page } from "@playwright/test";

/**
 * 搜索学习库结果 → 落点是否对。
 *
 * 后端 `KnowledgeTarget()`（SearchEndpoints.cs:147）对学习库分两种：
 * - 课时 → `/study?lesson=<知识库路径>`
 * - 说明类（`_学习路径.md` / `_阶段说明.md`）→ **`/study`（不带参数，正文由总览页展示）**
 * 所以搜索命中说明类文档时，前端拿到的 path 就是 `/study`；GlobalSearch 再追加 `?q=` 就是
 * 用户看到的那条 `/study?q=cuadc` —— 页面渲染总览、没有任何定位/高亮。
 */

const ROLE_CLAIM = "http://schemas.microsoft.com/ws/2008/06/identity/claims/role";
const makeToken = (role: string) => {
  const payload = Buffer.from(JSON.stringify({ [ROLE_CLAIM]: role, exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url");
  return `e2e.${payload}.sig`;
};

const TERM = "cuadc";
const OVERVIEW = "飞训部/学习库/_学习路径.md";
const A1 = "飞训部/学习库/01-入门筑基/01-认识航模.md";
const B1 = "电子部/学习库/01-焊接基础/01-认识烙铁.md";

const overviewDoc = `# 新人学习总览（全队导航）\n\n先看安全规范，再看 ${TERM} 相关章节。\n\n${Array.from({ length: 30 }, (_, i) => `第 ${i + 1} 段：把总览撑长一点。`).join("\n\n")}`;
const a1Doc = "# 认识航模\n\n飞训部第一课。";
const b1Doc = `# 认识烙铁\n\n${TERM} 的用法在电子部这一课里。`;

/** 「飞训部专属文本」不含搜索词：用来证明最终落在哪个库 */
const A_ONLY = "飞训部专属文本";

const makeScope = (scope: string, libraryPath: string, lessonPath: string, lessonTitle: string, stage: string, overview: string, description: string) => ({
  scope, label: `${scope}学习库`, libraryPath, canEdit: true,
  overviewPath: `${libraryPath}/_学习路径.md`, overview, completedCount: 0, lessonCount: 1,
  stages: [{
    title: stage, path: `${libraryPath}/${stage}`, canEdit: true,
    descriptionPath: `${libraryPath}/${stage}/_阶段说明.md`, description,
    lessons: [{ title: lessonTitle, path: lessonPath, canEdit: true, completed: false }],
  }],
});

const termScope = (scope: string, libraryPath: string, lessonPath: string, lessonTitle: string, stage: string, only: string) =>
  makeScope(scope, libraryPath, lessonPath, lessonTitle, stage,
    // 命中放在开头、后面垫长正文：这样"滚到命中"才有可滚的空间，断言才有意义
    `${only}\n\n总览里提到 ${TERM} 的用法。\n\n${Array.from({ length: 30 }, (_, i) => `第 ${i + 1} 段：把总览撑长一点。`).join("\n\n")}`,
    `阶段说明里也提到 ${TERM}。`);

const scopes = [
  termScope("飞训部", "飞训部/学习库", A1, "认识航模", "01-入门筑基", "飞训部总览"),
  termScope("电子部", "电子部/学习库", B1, "认识烙铁", "01-焊接基础", "电子部总览"),
];

/** 只有电子部的正文含搜索词：说明类命中落在别的部门库里 */
const scopesBOnly = [
  makeScope("飞训部", "飞训部/学习库", A1, "认识航模", "01-入门筑基", A_ONLY, `${A_ONLY}的阶段说明`),
  termScope("电子部", "电子部/学习库", B1, "认识烙铁", "01-焊接基础", "电子部总览"),
];

/** 模拟后端：说明类 → /study；课时 → /study?lesson= */
async function mockApi(page: Page, hit: "overview" | "overview-b" | "lesson-b") {
  const path = hit === "lesson-b" ? `/study?lesson=${encodeURIComponent(B1)}` : "/study";
  const payload = hit === "overview-b" ? scopesBOnly : scopes;
  await page.route("**/api/**", async route => {
    const url = new URL(route.request().url());
    const p = url.pathname;
    const json = (d: unknown) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(d) });
    if (p === "/api/auth/me") return json({ id: 1, username: "e2e-member", role: "member", department: null });
    if (p.startsWith("/api/notifications")) return json([]);
    if (p === "/api/public/brand") return json({ teamName: "雏鹰之翼", teamSubtitle: "航模队", systemTitle: "系统", description: "", logoUrl: null, primaryColor: null, theme: "indigo" });
    if (p === "/api/study/library") return json({ scopes: payload });
    if (p === "/api/search") {
      return json({
        knowledge: [{ type: "study", title: hit === "lesson-b" ? "01-认识烙铁.md" : "_学习路径.md", snippet: `…${TERM}…`, path }],
        inventory: [], wiki: [], files: [],
      });
    }
    if (p === "/api/knowledge/content") {
      const want = url.searchParams.get("path") ?? "";
      return json({ content: want === A1 ? a1Doc : want === B1 ? b1Doc : want === OVERVIEW ? overviewDoc : "" });
    }
    return json({});
  });
}

async function openSearchAndClick(page: Page, title: RegExp) {
  await page.getByRole("button", { name: /搜索/ }).first().click();
  await page.getByPlaceholder("搜索知识库、库存、Wiki、文件...").fill(TERM);
  const result = page.getByRole("button", { name: title });
  await expect(result).toBeVisible({ timeout: 10_000 });
  await result.click();
}

test.describe("搜索学习库：说明类结果（后端给 /study）", () => {
  test("点说明类结果：落点带上 q、正文里命中处高亮并滚过去（不是停在总览）", async ({ page }) => {
    await mockApi(page, "overview");
    await page.addInitScript(t => localStorage.setItem("token", t), makeToken("member"));
    await page.goto("/study");
    await openSearchAndClick(page, /_学习路径\.md/);

    console.log("OVERVIEW-HIT URL:", page.url());
    expect(page.url()).toContain("q=cuadc");
    expect(page.url()).not.toContain("lesson=");

    // 总览正文（或阶段说明）里的命中要被高亮，并且滚到它
    await expect(page.getByTestId("md-highlight").first()).toBeVisible({ timeout: 15_000 });
    const scrollY = await page.evaluate(() => Math.round(window.scrollY));
    expect(scrollY).toBeGreaterThan(100); // 真的滚下去了（不是停在页首）
    await expect.poll(() => page.evaluate(() =>
      Math.round(document.querySelector('[data-testid="md-highlight"]')!.getBoundingClientRect().top)))
      .toBeLessThan(200);
  });
  test("说明类命中在别的部门的库里：自动切到那个库并高亮（后端只给了 /study）", async ({ page }) => {
    await mockApi(page, "overview-b");
    await page.addInitScript(t => localStorage.setItem("token", t), makeToken("member"));
    await page.goto("/study");
    await openSearchAndClick(page, /_学习路径\.md/);

    expect(page.url()).not.toContain("lesson=");
    // 只有电子部的正文含搜索词：出现高亮就说明切到了电子部；飞训部的文本不该在页面上
    await expect(page.getByTestId("md-highlight").first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(A_ONLY)).toHaveCount(0);
  });
});

test.describe("搜索学习库：跨 scope 的课时结果", () => {
  test("点别的部门的课时结果：lesson 保留、切到那个 scope 并高亮", async ({ page }) => {
    await mockApi(page, "lesson-b");
    await page.addInitScript(t => localStorage.setItem("token", t), makeToken("member"));
    await page.goto("/study");
    await openSearchAndClick(page, /01-认识烙铁\.md/);

    console.log("CROSS-SCOPE URL:", page.url());
    expect(page.url()).toContain("lesson=");
    expect(page.url()).toContain("q=cuadc");

    // 落在电子部那一课（不是总览、也不是飞训部的课）
    await expect(page.getByText("认识烙铁", { exact: false }).first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("md-highlight").first()).toBeVisible({ timeout: 15_000 });
  });
});
