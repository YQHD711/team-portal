import { test, expect, type Page } from "@playwright/test";

/**
 * 知识库删除入口（真浏览器）：
 * 改前——树里 `opacity: 0`（不 hover 看不到）、命中区 16×16、只有 title 没有 aria-label；
 * 编辑区头部是个没有名字的裸图标。改后——树里常态可见 + aria-label + 更大命中区，
 * 头部是带文字的「删除」按钮；两者都仍然先弹确认对话框。
 */

const ROLE_CLAIM = "http://schemas.microsoft.com/ws/2008/06/identity/claims/role";
const makeToken = () => {
  const payload = Buffer.from(JSON.stringify({ [ROLE_CLAIM]: "admin", exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url");
  return `e2e.${payload}.sig`;
};

const DOC = "公共/学习库/01-入门筑基/01-认识航模.md";
const tree = [{
  name: "公共知识库", type: "folder", path: "公共", children: [{
    name: "学习库", type: "folder", path: "公共/学习库", children: [
      { name: "01-认识航模", type: "file", path: DOC, extra: { ext: ".md" } },
    ],
  }],
}];

async function mockApi(page: Page) {
  await page.route("**/api/**", async route => {
    const url = new URL(route.request().url());
    const p = url.pathname;
    const json = (d: unknown) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(d) });
    if (p === "/api/auth/me") return json({ id: 1, username: "e2e-admin", role: "admin", department: null });
    if (p.startsWith("/api/notifications")) return json([]);
    if (p === "/api/public/brand") return json({ teamName: "雏鹰之翼", teamSubtitle: "航模队", systemTitle: "系统", description: "", logoUrl: null, primaryColor: null, theme: "indigo" });
    if (p === "/api/knowledge/tree") return json(tree);
    if (p === "/api/knowledge/content") return json({ content: "# 认识航模\n\n正文。" });
    if (p === "/api/admin/knowledge/delete") return json({});
    return json({});
  });
}

test("树里的删除入口不用 hover 就可见、有名字、命中区够大", async ({ page }) => {
  await mockApi(page);
  await page.addInitScript(t => localStorage.setItem("token", t), makeToken());
  await page.goto("/admin/knowledge");
  await page.getByRole("button", { name: "全部展开" }).click();

  const del = page.getByLabel("删除 01-认识航模");
  await expect(del).toBeVisible();

  const facts = await del.evaluate(el => {
    const r = el.getBoundingClientRect();
    return { opacity: getComputedStyle(el).opacity, w: Math.round(r.width), h: Math.round(r.height), title: el.getAttribute("title") };
  });
  console.log("AFTER 树里的删除入口:", JSON.stringify(facts));
  expect(facts.opacity).toBe("1");          // 改前是 "0"（只有 hover 才 1）
  expect(facts.w).toBeGreaterThanOrEqual(22); // 改前 16×16
  expect(facts.h).toBeGreaterThanOrEqual(22);
  expect(facts.title).toBeTruthy();
});

test("点删除弹确认；取消不会真的删", async ({ page }) => {
  let deleteCalls = 0;
  await mockApi(page);
  await page.route("**/api/admin/knowledge/delete**", async route => { deleteCalls++; await route.fulfill({ status: 200, contentType: "application/json", body: "{}" }); });
  await page.addInitScript(t => localStorage.setItem("token", t), makeToken());
  await page.goto("/admin/knowledge");
  await page.getByRole("button", { name: "全部展开" }).click();

  const dialogMsg = new Promise<string>(resolve => { page.once("dialog", d => { resolve(d.message()); void d.dismiss(); }); });
  await page.getByLabel("删除 01-认识航模").click();

  expect(await dialogMsg).toContain(DOC);
  await page.waitForTimeout(300);
  expect(deleteCalls).toBe(0);
});

test("编辑区头部的删除是带文字的按钮（不再是无名图标）", async ({ page }, testInfo) => {
  await mockApi(page);
  await page.addInitScript(t => localStorage.setItem("token", t), makeToken());
  await page.goto("/admin/knowledge");
  await page.getByRole("button", { name: "全部展开" }).click();
  await page.getByText("01-认识航模").click();

  const headerDel = page.getByLabel(`删除文档 ${DOC}`);
  await expect(headerDel).toBeVisible();
  await expect(headerDel).toHaveText(/删除/);
  await page.screenshot({ path: testInfo.outputPath("after.png") });
});
