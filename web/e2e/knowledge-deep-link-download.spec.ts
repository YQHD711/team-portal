import { test, expect, type Page } from "@playwright/test";

/**
 * `?path=<pdf>` 深链接（全局搜索跳知识库的入口）：必须真的下载下来，
 * 而且请求**带 Authorization 头** —— 旧实现走 window.open/当文本读，结果毫无反应（线上实测）。
 */

const ROLE_CLAIM = "http://schemas.microsoft.com/ws/2008/06/identity/claims/role";
const makeToken = () => {
  const payload = Buffer.from(JSON.stringify({ [ROLE_CLAIM]: "admin", exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url");
  return `e2e.${payload}.sig`;
};

const PDF = "公共/Pixhawk标准/DS-009 Pixhawk Connector Standard.pdf";
const tree = [{
  name: "公共", type: "folder", path: "公共", children: [{
    name: "Pixhawk标准", type: "folder", path: "公共/Pixhawk标准", children: [
      { name: "DS-009 Pixhawk Connector Standard", type: "file", path: PDF, extra: { ext: ".pdf" } },
    ],
  }],
}];

async function mockApi(page: Page, seen: { downloadAuth: string | null; contentCalls: number }) {
  await page.route("**/api/**", async route => {
    const url = new URL(route.request().url());
    const p = url.pathname;
    const json = (d: unknown) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(d) });
    if (p === "/api/auth/me") return json({ id: 1, username: "e2e-admin", role: "admin", department: null });
    if (p.startsWith("/api/notifications")) return json([]);
    if (p === "/api/public/brand") return json({ teamName: "雏鹰之翼", teamSubtitle: "航模队", systemTitle: "系统", description: "", logoUrl: null, primaryColor: null, theme: "indigo" });
    if (p === "/api/knowledge/tree") return json(tree);
    if (p === "/api/knowledge/content") { seen.contentCalls++; return json({ content: "# 文档" }); }
    if (p === "/api/knowledge/download") {
      seen.downloadAuth = route.request().headers()["authorization"] ?? null;
      return route.fulfill({ status: 200, contentType: "application/pdf", body: Buffer.from("%PDF-1.4\n%%EOF\n") });
    }
    return json({});
  });
}

test("?path=<pdf> 深链接：真的下载、文件名正确、请求带 Authorization", async ({ page }) => {
  const seen: { downloadAuth: string | null; contentCalls: number } = { downloadAuth: null, contentCalls: 0 };
  await mockApi(page, seen);
  await page.addInitScript(t => localStorage.setItem("token", t), makeToken());

  const downloadPromise = page.waitForEvent("download");
  await page.goto(`/admin/knowledge?path=${encodeURIComponent(PDF)}`);

  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("DS-009 Pixhawk Connector Standard.pdf");
  console.log("DEEP-LINK DOWNLOAD:", download.suggestedFilename(), "auth=", seen.downloadAuth?.slice(0, 12));

  // 关键：带了 Bearer token（旧实现 window.open 根本发不出这个头 → 401）
  expect(seen.downloadAuth).toMatch(/^Bearer /);
  // 没把 PDF 当文本读
  expect(seen.contentCalls).toBe(0);
  // 页面没有报错提示
  await expect(page.getByText(/下载失败/)).toHaveCount(0);
});

test("?path=<不存在的 pdf>：给可读提示，不静默", async ({ page }) => {
  const seen: { downloadAuth: string | null; contentCalls: number } = { downloadAuth: null, contentCalls: 0 };
  await mockApi(page, seen);
  await page.addInitScript(t => localStorage.setItem("token", t), makeToken());

  await page.goto(`/admin/knowledge?path=${encodeURIComponent("公共/Pixhawk标准/没有的文档.pdf")}`);

  await expect(page.getByText(/没找到/)).toBeVisible();
  expect(seen.downloadAuth).toBeNull();
});
