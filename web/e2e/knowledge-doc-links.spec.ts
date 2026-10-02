import { test, expect, type Page } from "@playwright/test";

/**
 * 真浏览器验证：知识库正文里的相对 `.md` 引用点得动 —— 切到那篇文档，而不是浏览器跳走（404）。
 * 所有 /api/* 走 route mock，不依赖后端。
 */

const ROLE_CLAIM = "http://schemas.microsoft.com/ws/2008/06/identity/claims/role";
const makeToken = (role: string) => {
  const payload = Buffer.from(JSON.stringify({ [ROLE_CLAIM]: role, exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url");
  return `e2e.${payload}.sig`;
};

const ROOT_DOC = "飞训部/学习库/01-入门筑基/01-认识航模.md";
const TARGET = "飞训部/学习库/章程.md";
const TARGET_TEXT = "章程正文（被 ../章程.md 引用过来）。";

const contents: Record<string, string> = {
  [ROOT_DOC]: `## 认识航模\n\n先看 [章程](../章程.md#总则)，外链 [ArduPilot](https://ardupilot.org/plane/docs/)。`,
  [TARGET]: `# 章程\n\n${TARGET_TEXT}`,
};

const tree = [{
  name: "飞训部", path: "飞训部", type: "folder", children: [
    { name: "章程.md", path: TARGET, type: "file" },
    {
      name: "学习库", path: "飞训部/学习库", type: "folder", children: [{
        name: "01-入门筑基", path: "飞训部/学习库/01-入门筑基", type: "folder", children: [
          { name: "01-认识航模.md", path: ROOT_DOC, type: "file" },
        ],
      }],
    },
  ],
}];

async function mockApi(page: Page) {
  await page.route("**/api/**", async route => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    const json = (d: unknown) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(d) });
    if (path === "/api/auth/me") return json({ id: 1, username: "e2e-admin", role: "admin", department: null });
    if (path.startsWith("/api/notifications")) return json([]);
    if (path === "/api/public/brand") return json({ teamName: "雏鹰之翼", teamSubtitle: "航模队", systemTitle: "系统", description: "", logoUrl: null, primaryColor: null, theme: "indigo" });
    if (path === "/api/knowledge/tree") return json(tree);
    if (path === "/api/knowledge/content") return json({ content: contents[url.searchParams.get("path") ?? ""] ?? "" });
    return json({});
  });
}

test.describe("知识库文档互链（真浏览器）", () => {
  test("点相对 .md 引用 → 切到那篇文档、浏览器不跳转；外链不受影响", async ({ page }) => {
    await mockApi(page);
    await page.addInitScript(t => localStorage.setItem("token", t), makeToken("admin"));
    await page.goto(`/admin/knowledge?path=${encodeURIComponent(ROOT_DOC)}`);

    // ?path= 直接打开这篇文档（左侧树只是附带）
    await expect(page.getByText(ROOT_DOC).first()).toBeVisible({ timeout: 15_000 });
    await page.getByTitle("预览").click();

    const link = page.getByRole("link", { name: "章程" });
    await expect(link).toBeVisible();
    // 外链仍是新窗口打开，不受拦截影响
    await expect(page.getByRole("link", { name: "ArduPilot" })).toHaveAttribute("target", "_blank");

    const urlBefore = page.url();
    await link.click();

    // 正文换成被引用那篇（标题里也显示了新路径）
    await expect(page.getByText(TARGET_TEXT)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(TARGET).first()).toBeVisible();
    // 关键：不是浏览器导航（否则 URL 会变成 /章程.md 并 404）
    expect(page.url()).toBe(urlBefore);
    expect(page.url()).toContain(encodeURIComponent(ROOT_DOC));
  });
});
