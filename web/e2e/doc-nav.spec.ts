import { test, expect, type Page } from "@playwright/test";

/**
 * 真浏览器验证：
 * A. 从目录点文档进去落在**开头**（不再被钳到文末）；链接带 #锚点要滚到那一节
 * B. 搜索结果带关键词进来：命中处高亮 + 滚到第一处命中
 * 所有 /api/* 走 route mock，不依赖后端。
 */

const ROLE_CLAIM = "http://schemas.microsoft.com/ws/2008/06/identity/claims/role";
const makeToken = (role: string) => {
  const payload = Buffer.from(JSON.stringify({ [ROLE_CLAIM]: role, exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url");
  return `e2e.${payload}.sig`;
};

const LONG = "飞训部/学习库/01-入门筑基/01-长文档.md";
const MID = "飞训部/学习库/01-入门筑基/02-中档文档.md";

const paras = (from: number, to: number, tag: string) =>
  Array.from({ length: to - from + 1 }, (_, i) => `第 ${from + i} 段：${tag}正文，撑出一屏以上的高度。`).join("\n\n");

/** 长文档：小节在中间（跨文档锚点的目标） */
const longDoc = `# 长文档\n\n${paras(1, 25, "很长")}\n\n## 小节标题\n\n小节正文在长文档中间。\n\n${paras(26, 50, "后半")}`;
/** 中档文档：比一屏长、比长文档短；"中等"出现 21 次（代码块里那次不算） */
const midDoc = [
  "# 中档文档（关键词：中等）", "",
  "[跳到小节](01-长文档.md#小节标题)", "",
  paras(1, 10, "中等"), "",
  "## 小节标题", "", "这里是小节正文。", "",
  paras(11, 20, "中等"), "",
  "行内代码 `中等` 不该被高亮。", "",
  "```bash", "echo 中等", "```",
].join("\n\n");

const scope = {
  scope: "飞训部", label: "飞训部学习库", libraryPath: "飞训部/学习库", canEdit: true,
  overviewPath: null, overview: null, completedCount: 0, lessonCount: 2,
  stages: [{
    title: "入门筑基", path: "飞训部/学习库/01-入门筑基", canEdit: true, descriptionPath: null,
    lessons: [
      { title: "长文档", path: LONG, canEdit: true, completed: false },
      { title: "中档文档", path: MID, canEdit: true, completed: false },
    ],
  }],
};

async function mockApi(page: Page, opts: { search?: boolean } = {}) {
  await page.route("**/api/**", async route => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    const json = (d: unknown) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(d) });
    if (path === "/api/auth/me") return json({ id: 1, username: "e2e-admin", role: "admin", department: null });
    if (path.startsWith("/api/notifications")) return json([]);
    if (path === "/api/public/brand") return json({ teamName: "雏鹰之翼", teamSubtitle: "航模队", systemTitle: "系统", description: "", logoUrl: null, primaryColor: null, theme: "indigo" });
    if (path === "/api/study/library") return json({ scopes: [scope] });
    if (opts.search && path === "/api/search") {
      return json({
        knowledge: [{ type: "study", title: "02-中档文档.md", snippet: "…中等…", path: `/study?lesson=${encodeURIComponent(MID)}` }],
        inventory: [], wiki: [], files: [],
      });
    }
    if (path === "/api/knowledge/content") {
      const p = url.searchParams.get("path") ?? "";
      return json({ content: p === LONG ? longDoc : p === MID ? midDoc : "" });
    }
    if (path === "/api/knowledge/tree") {
      return json([{ name: "飞训部", path: "飞训部", type: "folder", children: [{ name: "01-入门筑基", path: "飞训部/学习库/01-入门筑基", type: "folder", children: [
        { name: "01-长文档.md", path: LONG, type: "file" }, { name: "02-中档文档.md", path: MID, type: "file" }] }] }]);
    }
    return json({});
  });
}

/** 知识库默认（编辑）视图：正文 textarea 的滚动状态 */
const textareaState = (page: Page) => page.evaluate(() => {
  const ta = document.querySelector("textarea");
  if (!ta) return null;
  return { scrollTop: Math.round(ta.scrollTop), max: Math.round(ta.scrollHeight - ta.clientHeight) };
});

/** 预览容器 + 锚点目标相对容器顶部的位置 */
const anchorState = (page: Page, id: string) => page.evaluate((anchorId) => {
  const box = [...document.querySelectorAll<HTMLElement>("div.overflow-y-auto")].find(b => b.querySelector("p"));
  const el = [...document.querySelectorAll<HTMLElement>("[id]")].find(n => n.id === anchorId);
  if (!box || !el) return null;
  return {
    scrollTop: Math.round(box.scrollTop), max: Math.round(box.scrollHeight - box.clientHeight),
    offset: Math.round(el.getBoundingClientRect().top - box.getBoundingClientRect().top),
  };
}, id);

test.describe("A：文档跳转的滚动落点", () => {
  test("知识库从目录切到更短的文档：落在开头，不再被钳到文末", async ({ page }) => {
    await mockApi(page);
    await page.addInitScript(t => localStorage.setItem("token", t), makeToken("admin"));
    await page.goto(`/admin/knowledge?path=${encodeURIComponent(LONG)}`);
    await expect(page.getByText("第 50 段", { exact: false })).toBeVisible({ timeout: 15_000 });

    // 先把长文档滚到文末，再切到中档文档
    await page.evaluate(() => { const ta = document.querySelector("textarea"); if (ta) ta.scrollTop = ta.scrollHeight; });
    const before = await textareaState(page);
    expect(before!.scrollTop).toBe(before!.max); // 已到文末

    await page.getByText("02-中档文档.md").click();
    await expect(page.getByText("第 20 段", { exact: false })).toBeVisible({ timeout: 15_000 });

    const after = await textareaState(page);
    expect(after!.max).toBeGreaterThan(100); // 新文档自己也超过一屏，才区分得了"开头/文末"
    expect(after!.scrollTop).toBe(0);        // 修复前这里等于 after.max（被钳到文末）
  });

  test("跨文档锚点 [x.md#小节]：切过去并滚到那一节", async ({ page }) => {
    await mockApi(page);
    await page.addInitScript(t => localStorage.setItem("token", t), makeToken("admin"));
    await page.goto(`/admin/knowledge?path=${encodeURIComponent(MID)}`);
    await expect(page.getByText("这里是小节正文。", { exact: false })).toBeVisible({ timeout: 15_000 });
    await page.getByTitle("预览").click();

    await page.getByRole("link", { name: "跳到小节" }).click();

    await expect(page.getByText("第 50 段", { exact: false })).toBeVisible({ timeout: 15_000 }); // 已切到长文档
    await expect.poll(async () => (await anchorState(page, "小节标题"))?.offset ?? -999, { message: "小节应滚到容器顶部附近" })
      .toBeGreaterThanOrEqual(-5);
    const st = await anchorState(page, "小节标题");
    expect(st!.offset).toBeLessThan(140);       // 标题有 scroll-mt-24（96px）
    expect(st!.scrollTop).toBeGreaterThan(0);   // 真的滚了
    expect(st!.scrollTop).toBeLessThan(st!.max);
  });

  test("学习库课时之间切换：回到正文开头", async ({ page }) => {
    await mockApi(page);
    await page.addInitScript(t => localStorage.setItem("token", t), makeToken("admin"));
    await page.goto(`/study?lesson=${encodeURIComponent(LONG)}`);
    await expect(page.getByText("第 50 段", { exact: false })).toBeVisible({ timeout: 15_000 });
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));

    await page.locator("nav button").filter({ hasText: "中档文档" }).first().click();
    await expect(page.getByText("第 20 段", { exact: false })).toBeVisible({ timeout: 15_000 });

    await expect.poll(() => page.evaluate(() => Math.round(document.querySelector("article")!.getBoundingClientRect().top)))
      .toBeLessThan(200); // 正文开头在视口上部，而不是文末
  });
});

test.describe("B：搜索结果跳转 + 关键词高亮", () => {
  /**
   * 中档文档里"中等"出现 21 次：h1 标题 1 处 + 两段正文各 10 处；
   * 代码块里的 `echo 中等` **不算**（高亮只作用在渲染后的正文文本上）。
   */
  test("?lesson=&q=：正文命中高亮并滚到第一处命中；代码块里的不算", async ({ page }) => {
    await mockApi(page);
    await page.addInitScript(t => localStorage.setItem("token", t), makeToken("admin"));
    await page.goto(`/study?lesson=${encodeURIComponent(MID)}&q=${encodeURIComponent("中等")}`);

    const marks = page.getByTestId("md-highlight");
    await expect(marks.first()).toBeVisible({ timeout: 15_000 });
    await expect(marks).toHaveCount(21);

    const inCode = await page.evaluate(() =>
      [...document.querySelectorAll("pre, code")].reduce((n, el) => n + el.querySelectorAll('[data-testid="md-highlight"]').length, 0));
    expect(inCode).toBe(0);

    await expect.poll(() => page.evaluate(() =>
      Math.round(document.querySelector('[data-testid="md-highlight"]')!.getBoundingClientRect().top)))
      .toBeLessThan(200);
  });

  test("不带 q 就不高亮（不传新 prop 行为不变）", async ({ page }) => {
    await mockApi(page);
    await page.addInitScript(t => localStorage.setItem("token", t), makeToken("admin"));
    await page.goto(`/study?lesson=${encodeURIComponent(MID)}`);

    await expect(page.getByText("第 20 段", { exact: false })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("md-highlight")).toHaveCount(0);
  });

  test("从全局搜索点学习库结果：跳转带上关键词并高亮", async ({ page }) => {
    await mockApi(page, { search: true });
    await page.addInitScript(t => localStorage.setItem("token", t), makeToken("admin"));
    // 从学习库页打开全局搜索（顶栏在所有受保护页都有，省得再 mock 仪表盘）
    await page.goto(`/study?lesson=${encodeURIComponent(LONG)}`);
    await expect(page.getByText("第 50 段", { exact: false })).toBeVisible({ timeout: 15_000 });
    await page.getByRole("button", { name: /搜索/ }).first().click();
    await page.getByPlaceholder("搜索知识库、库存、Wiki、文件...").fill("中等");

    const result = page.getByRole("button", { name: /02-中档文档\.md/ });
    await expect(result).toBeVisible({ timeout: 10_000 });
    await result.click();

    await expect(page).toHaveURL(/\/study\?lesson=.*q=/);
    await expect(page.getByTestId("md-highlight").first()).toBeVisible({ timeout: 15_000 });
  });
});
