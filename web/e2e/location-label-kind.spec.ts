import { test, expect, type Page } from "@playwright/test";

/**
 * **导出候选来源的端到端**（task-40 ③b 步骤 7 的产物判据，全 mock，绝不打生产线）：
 * - 列表里有一个 `kind=location` 且 `isDefault` 的模板 → 房间级导出**必须用它**（用独特尺寸 60×40mm 区分）
 * - 列表里只有 `kind=material`（或缺 kind）→ **回落原逻辑**（用默认模板 80×50mm）
 */
const RC = "http://schemas.microsoft.com/ws/2008/06/identity/claims/role";
const tok = (r: string) => `e2e.${Buffer.from(JSON.stringify({ [RC]: r, exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url")}.sig`;
const MM = 72 / 25.4;
const QR = { id: "q", type: "qr", x: 2, y: 2, w: 30, h: 30 };
const CODE_TEXT = { id: "t", type: "text", x: 34, y: 4, w: 40, h: 8, field: "code" };
const tpl = (id: number, kind: string, w: number, h: number, isDefault = true) => ({
  id, name: `${kind}-${w}x${h}`, kind, isDefault, widthMm: w, heightMm: h, dpi: 203, background: "#FFFFFF", elements: [QR, CODE_TEXT],
});
const ITEMS = [{ id: "a", type: "device", name: "图传", x: 100, y: 100, w: 60, h: 60, rotation: 0, locCode: "6011-A-1-01" }];

async function setup(page: Page, templates: unknown[]) {
  await page.route("**/api/**", async route => {
    const p = new URL(route.request().url()).pathname;
    const json = (d: unknown) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(d) });
    if (p === "/api/auth/me") return json({ id: 1, username: "a", role: "admin", department: null });
    if (p.startsWith("/api/notifications")) return json([]);
    if (p === "/api/public/brand") return json({ teamName: "x", teamSubtitle: "y", systemTitle: "z", description: "", logoUrl: null, primaryColor: null, theme: "indigo" });
    if (p === "/api/storage/layouts") return json([{ id: 1, roomCode: "6011", roomName: "库房", floor: 1, layoutJson: JSON.stringify({ width: 900, height: 600, unit: "cm", walls: [], doors: [], windows: [], items: ITEMS }) }]);
    if (p === "/api/label-templates") return json(templates);
    if (p === "/api/storage/layouts/6011/items") return json([]);
    if (p === "/api/inventory/meta") return json({ lowStockThreshold: 8, lowStockGrade: "C" });
    if (p === "/api/inventory") return json([]);
    return json({});
  });
  await page.addInitScript(t => localStorage.setItem("token", t), tok("admin"));
  await page.goto("/inventory/layout");
  await page.getByRole("button", { name: /库房/ }).click();
  await page.getByRole("button", { name: /编辑平面图/ }).click();
  await expect(page.locator("canvas").first()).toBeVisible();
}
async function exportMm(page: Page): Promise<string> {
  page.on("dialog", d => void d.accept());
  const [dl] = await Promise.all([page.waitForEvent("download"), page.getByTestId("export-location-labels").click()]);
  const path = await dl.path();
  const text = (await import("node:fs")).readFileSync(path!).toString("latin1");
  const m = /\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/.exec(text);
  expect(m).not.toBeNull();
  return `${(Number(m![1]) / MM).toFixed(1)}×${(Number(m![2]) / MM).toFixed(1)}`;
}

test("候选来源：有 kind=location 的默认模板 → 用它（60×40）", async ({ page }) => {
  await setup(page, [tpl(1, "material", 80, 50), tpl(2, "location", 60, 40)]);
  const mm = await exportMm(page);
  console.log(`KIND location-默认: 导出页面=${mm}mm（期望 60.0×40.0）`);
  expect(mm).toBe("60.0×40.0");
});

test("候选来源：只有 material → **不用物料模板**，回落内置库位模板（60×40、无二维码）", async ({ page }) => {
  await setup(page, [tpl(1, "material", 80, 50)]);
  const mm = await exportMm(page);
  console.log(`KIND 只有-material: 导出页面=${mm}mm（期望 60.0×40.0 —— 用户要求「库位标签不用二维码」，物料模板带 qr 且是 80×50）`);
  expect(mm).toBe("60.0×40.0");
});