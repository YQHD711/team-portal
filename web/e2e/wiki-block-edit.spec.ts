import { test, expect, type Page } from "@playwright/test";

/**
 * Wiki 文档块级就地编辑（真浏览器），按 task-11 定稿的契约：
 * - `PUT /api/wiki/tasks/{id}/doc {path,lang,content}`（StaffOnly）
 * - 「检查修正」先 `GET /edits` → 有标记弹确认 → 确认才 `POST /update?force=true`
 */

const ROLE_CLAIM = "http://schemas.microsoft.com/ws/2008/06/identity/claims/role";
const makeToken = (role: string) => {
  const payload = Buffer.from(JSON.stringify({ [ROLE_CLAIM]: role, exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url");
  return `e2e.${payload}.sig`;
};

const DOC_PATH = "getting-started/intro";
const DOC = [
  "# 介绍",
  "",
  "第一段说明文字。",
  "",
  "```bash",
  "npm install",
  "```",
  "",
  "| 项 | 说明 |",
  "| --- | --- |",
  "| A | 甲 |",
].join("\n");
const NEW_PARA = "第一段说明文字改过了。";

const task = { id: "t1", projectName: "ardupilot", status: "completed", targetFolder: "公共", visibility: "public", type: "git" };
const catalog = [{ path: DOC_PATH, title: "介绍" }];

async function mockApi(page: Page, opts: { role?: string; editCount?: number; onPut?: (b: Record<string, unknown>) => void; onUpdate?: (url: string) => void }) {
  await page.route("**/api/**", async route => {
    const url = new URL(route.request().url());
    const p = url.pathname;
    const method = route.request().method();
    const json = (d: unknown) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(d) });
    if (p === "/api/auth/me") return json({ id: 1, username: "e2e-user", role: opts.role ?? "admin", department: null });
    if (p.startsWith("/api/notifications")) return json([]);
    if (p === "/api/public/brand") return json({ teamName: "雏鹰之翼", teamSubtitle: "航模队", systemTitle: "系统", description: "", logoUrl: null, primaryColor: null, theme: "indigo" });
    if (p === "/api/wiki/tasks/t1") return json(task);
    if (p === "/api/wiki/tasks/t1/catalog") return json(catalog);
    if (p === "/api/wiki/tasks/t1/doc" && method === "PUT") {
      opts.onPut?.(JSON.parse(route.request().postData() ?? "{}") as Record<string, unknown>);
      return json({ ok: true, savedAt: "2026-10-02T03:21:00.000Z", path: DOC_PATH, lang: "zh", marked: true });
    }
    if (p === "/api/wiki/tasks/t1/doc") return json({ content: DOC });
    if (p === "/api/wiki/tasks/t1/edits") return json({ count: opts.editCount ?? 0, paths: opts.editCount ? ["a", "b"] : [], edits: [] });
    if (p === "/api/wiki/tasks/t1/update") { opts.onUpdate?.(url.pathname + url.search); return json({ success: true }); }
    return json({});
  });
}

async function openDoc(page: Page) {
  await page.goto("/wiki/t1");
  await expect(page.getByText("第一段说明文字。")).toBeVisible({ timeout: 15_000 });
}

test("Wiki：改一段保存 → PUT /doc，请求体里其它内容逐字符不变", async ({ page }) => {
  const saved: { body: Record<string, unknown> | null } = { body: null };
  await mockApi(page, { onPut: b => { saved.body = b; } });
  await page.addInitScript(t => localStorage.setItem("token", t), makeToken("admin"));
  await openDoc(page);

  // AI 生成提示 + 块级编辑入口
  await expect(page.getByTestId("wiki-manual-edit-notice")).toContainText("AI 生成的文档");
  const para = page.getByTestId("md-block").filter({ hasText: "第一段说明文字" }).first();
  await para.hover();
  await para.getByTestId("md-block-edit").click();
  await page.getByTestId("md-block-editor").fill(NEW_PARA);
  await page.getByTestId("md-block-save").click();

  await expect.poll(() => saved.body).not.toBeNull();
  expect(saved.body!.path).toBe(DOC_PATH);
  expect(saved.body!.lang).toBe("zh");
  const content = String(saved.body!.content);
  const head = DOC.indexOf("第一段说明文字");
  expect(content.slice(0, head)).toBe(DOC.slice(0, head));
  expect(content.slice(content.indexOf("```bash"))).toBe(DOC.slice(DOC.indexOf("```bash")));
  expect(content).toContain("| A | 甲 |");
  await expect(page.getByText(NEW_PARA)).toBeVisible();
});

test("Wiki：普通成员没有编辑入口与提示", async ({ page }) => {
  await mockApi(page, { role: "member" });
  await page.addInitScript(t => localStorage.setItem("token", t), makeToken("member"));
  await openDoc(page);

  await expect(page.getByTestId("wiki-manual-edit-notice")).toHaveCount(0);
  await expect(page.getByTestId("md-block-edit")).toHaveCount(0);
});

test("检查修正：有 2 处人工修改先弹确认，取消不发请求", async ({ page }) => {
  const updates: string[] = [];
  await mockApi(page, { editCount: 2, onUpdate: u => updates.push(u) });
  await page.addInitScript(t => localStorage.setItem("token", t), makeToken("admin"));
  await openDoc(page);

  let msg = "";
  page.once("dialog", d => { msg = d.message(); void d.dismiss(); });
  await page.getByRole("button", { name: /检查修正/ }).click();

  await expect.poll(() => msg).toContain("2 处文档已被人工修改");
  await page.waitForTimeout(300);
  expect(updates).toEqual([]);   // 取消 → 一个请求都不发（不会覆盖）
});

test("检查修正：确认后带 force=true 重新生成", async ({ page }) => {
  const updates: string[] = [];
  await mockApi(page, { editCount: 2, onUpdate: u => updates.push(u) });
  await page.addInitScript(t => localStorage.setItem("token", t), makeToken("admin"));
  await openDoc(page);

  page.once("dialog", d => void d.accept());
  await page.getByRole("button", { name: /检查修正/ }).click();

  await expect.poll(() => updates.length).toBe(1);
  expect(updates[0]).toContain("/api/wiki/tasks/t1/update");
  expect(updates[0]).toContain("force=true");
});
