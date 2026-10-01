import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";

/**
 * 物料标签导出 PDF：真浏览器里点按钮 → 真下载一个 .pdf。
 * 断言物理尺寸（MediaBox 80×50mm）、嵌入的整页位图分辨率与文件名。
 * 所有 /api/* 走 route mock，不依赖后端。
 */

const ROLE_CLAIM = "http://schemas.microsoft.com/ws/2008/06/identity/claims/role";

const makeToken = (role: string) => {
  const payload = Buffer.from(
    JSON.stringify({ [ROLE_CLAIM]: role, exp: Math.floor(Date.now() / 1000) + 3600 })
  ).toString("base64url");
  return `e2e.${payload}.sig`;
};

/** 标签短链的对外地址（后端下发），与用户线上环境一致 */
const PUBLIC_BASE = "http://8.137.161.160:3000";
const CODE = "BAT-LIPO-6S3300MAH-2026-0007";

const items = [{
  id: 1, name: "6S 3300mAh 锂电池", category: "电池电源", quantity: 3, code: CODE,
  locationCode: "1012-A-1-01", status: "available", grade: "A", unitPrice: 320,
  updatedAt: "2026-09-01T10:00:00Z",
}];

async function mockApi(page: Page) {
  await page.route("**/api/**", async route => {
    const path = new URL(route.request().url()).pathname;
    const json = (data: unknown) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(data) });
    if (path === "/api/auth/me") return json({ id: 1, username: "e2e-member", role: "member", department: null });
    if (path.startsWith("/api/notifications")) return json([]);
    if (path === "/api/public/brand") return json({ teamName: "雏鹰之翼", teamSubtitle: "航模队", systemTitle: "雏鹰之翼 · 航模队管理系统", description: "", logoUrl: null, primaryColor: null, theme: "indigo" });
    if (path === "/api/inventory/meta") return json({ lowStockThreshold: 8, lowStockGrade: "C", publicBaseUrl: PUBLIC_BASE, publicBaseLooksLocal: false });
    if (path === "/api/inventory") return json(items);
    if (path === "/api/storage/layouts") return json([]);
    if (path === "/api/admin/departments") return json([]);
    return json({});
  });
}

test.describe("物料标签：导出 PDF", () => {
  test("点「导出 PDF」下载 {code}.pdf，页面 80×50mm 且整页位图为 600 DPI", async ({ page }) => {
    await mockApi(page);
    await page.addInitScript(token => localStorage.setItem("token", token), makeToken("member"));

    await page.goto("/inventory");
    // 表格行与移动端卡片各有一个标签入口，取当前视口里可见的那个
    await page.getByTitle("物料标签（二维码）").locator("visible=true").first().click();
    await expect(page.getByText("物料标签")).toBeVisible();
    // 原有打印按钮与新的导出按钮并存
    await expect(page.getByRole("button", { name: /打印/ })).toBeVisible();

    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByTestId("export-label-pdf").click(),
    ]);

    expect(download.suggestedFilename()).toBe(`${CODE}.pdf`);
    const path = await download.path();
    expect(path).toBeTruthy();
    const pdf = readFileSync(path!);
    const text = pdf.toString("latin1");
    expect(text.startsWith("%PDF-")).toBe(true);
    console.log(`[label-pdf] ${download.suggestedFilename()} = ${pdf.byteLength} bytes`);
    expect(pdf.byteLength).toBeGreaterThan(5_000); // 空白页会明显更小

    // MediaBox 单位是 pt：80mm = 226.7717pt，50mm = 141.7323pt
    const box = /\/MediaBox\s*\[0 0 ([\d.]+) ([\d.]+)\]/.exec(text);
    expect(box).not.toBeNull();
    expect(Number(box![1])).toBeCloseTo((80 * 72) / 25.4, 1);
    expect(Number(box![2])).toBeCloseTo((50 * 72) / 25.4, 1);

    // 满版嵌入的整页位图 = 80mm×50mm @600 DPI（1890×1181），说明不是空白 PDF
    expect(text).toMatch(/\/Subtype\s*\/Image/);
    expect(text).toMatch(/\/Width 1890\b/);
    expect(text).toMatch(/\/Height 1181\b/);
  });
});
