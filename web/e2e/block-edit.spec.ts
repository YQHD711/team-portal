import { test, expect, type Page } from "@playwright/test";

/**
 * 块级就地编辑（真浏览器）：改一个段落 → 发出去的整篇 markdown 里
 * **只有这一块变了，其它部分逐字符与原文相同**（含 mermaid / 代码块 / 表格 / 中英文）。
 */

const ROLE_CLAIM = "http://schemas.microsoft.com/ws/2008/06/identity/claims/role";
const makeToken = (role: string) => {
  const payload = Buffer.from(JSON.stringify({ [ROLE_CLAIM]: role, exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url");
  return `e2e.${payload}.sig`;
};

const LESSON = "飞训部/学习库/01-入门筑基/01-认识航模.md";
const DOC = [
  "# 认识航模",
  "",
  "第一段正文：机翼产生升力。",
  "",
  "```mermaid",
  "graph TD;",
  "  A[起飞] --> B[降落];",
  "```",
  "",
  "| 参数 | 值 |",
  "| --- | --- |",
  "| 翼展 | 1200mm |",
  "",
  "最后一段 mixed text 结尾。",
].join("\n");
const NEW_PARA = "第一段正文：升力来自上下压力差。";

const scope = {
  scope: "飞训部", label: "飞训部学习库", libraryPath: "飞训部/学习库", canEdit: true,
  overviewPath: null, completedCount: 0, lessonCount: 1,
  stages: [{
    title: "入门筑基", path: "飞训部/学习库/01-入门筑基", canEdit: true, descriptionPath: null,
    lessons: [{ title: "认识航模", path: LESSON, canEdit: true, completed: false }],
  }],
};

async function mockApi(page: Page, saved: { body: Record<string, unknown> | null }) {
  await page.route("**/api/**", async route => {
    const url = new URL(route.request().url());
    const p = url.pathname;
    const json = (d: unknown) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(d) });
    if (p === "/api/auth/me") return json({ id: 3, username: "e2e-leader", role: "部长", department: "飞训部", departmentId: 1 });
    if (p.startsWith("/api/notifications")) return json([]);
    if (p === "/api/public/brand") return json({ teamName: "雏鹰之翼", teamSubtitle: "航模队", systemTitle: "系统", description: "", logoUrl: null, primaryColor: null, theme: "indigo" });
    if (p === "/api/study/library") return json({ scopes: [scope] });
    if (p === "/api/knowledge/content") return json({ content: DOC });
    if (p === "/api/admin/knowledge/write") {
      saved.body = JSON.parse(route.request().postData() ?? "{}") as Record<string, unknown>;
      return json({ ok: true });
    }
    return json({});
  });
}

test("改一段保存：请求体里其它内容逐字符不变", async ({ page }) => {
  const saved: { body: Record<string, unknown> | null } = { body: null };
  await mockApi(page, saved);
  await page.addInitScript(t => localStorage.setItem("token", t), makeToken("部长"));
  await page.goto(`/study?lesson=${encodeURIComponent(LESSON)}`);

  const blocks = page.getByTestId("md-block");
  await expect(blocks.first()).toBeVisible({ timeout: 15_000 });

  // 悬停段落块 → 点「编辑」→ 改内容 → 保存
  const para = blocks.filter({ hasText: "机翼产生升力" }).first();
  await para.hover();
  await para.getByTestId("md-block-edit").click();
  const editor = page.getByTestId("md-block-editor");
  await expect(editor).toHaveValue("第一段正文：机翼产生升力。");
  await editor.fill(NEW_PARA);
  await page.getByTestId("md-block-save").click();

  await expect.poll(() => saved.body).not.toBeNull();
  expect(saved.body!.path).toBe(LESSON);
  const content = String(saved.body!.content);
  console.log("SAVED-LEN", content.length, "ORIG-LEN", DOC.length);

  // 逐字符：改动点之前、之后都与原文完全一致（只替换了那一段）
  const head = DOC.indexOf("第一段正文");
  expect(content.slice(0, head)).toBe(DOC.slice(0, head));
  expect(content.slice(content.indexOf("```mermaid"))).toBe(DOC.slice(DOC.indexOf("```mermaid")));
  expect(content).toContain(NEW_PARA);
  expect(content).toContain("| 翼展 | 1200mm |");

  // 保存后立即重新渲染出新内容
  await expect(page.getByText(/升力来自上下压力差/)).toBeVisible();
});
