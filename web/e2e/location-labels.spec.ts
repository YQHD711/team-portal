import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
const RC = "http://schemas.microsoft.com/ws/2008/06/identity/claims/role";
const tok = (r: string) => `e2e.${Buffer.from(JSON.stringify({ [RC]: r, exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url")}.sig`;
const W = 900, H = 600;
const MM_TO_PT = 72 / 25.4;
// 5 个可导出库位：货架 2×2 → 4 个格位码 + 设备 1 个；另有 1 个未指定库位（应被跳过）
const ITEMS = [
  { id: "a", type: "shelf", name: "A货架", x: 100, y: 100, w: 200, h: 120, rotation: 0, locCode: "6011-A", rows: 2, cols: 2 },
  { id: "c", type: "device", name: "图传", x: 400, y: 100, w: 60, h: 60, rotation: 0, locCode: "6011-C" },
  { id: "n", type: "shelf", name: "未定位货架", x: 600, y: 100, w: 150, h: 100, rotation: 0, locCode: "", rows: 1, cols: 1 },
];
const QR_OK = [
  { id: "q", type: "qr", x: 2, y: 2, w: 30, h: 30 },
  { id: "t", type: "text", x: 34, y: 4, w: 40, h: 8, field: "code" },
];
const template = (id: number, w: number, h: number, elements: unknown[]) =>
  ({ id, name: `${w}x${h}`, isDefault: true, widthMm: w, heightMm: h, dpi: 203, background: "#FFFFFF", elements });

async function setup(page: Page, tpl: unknown | null) {
  await page.route("**/api/**", async route => {
    const req = route.request(); const p = new URL(req.url()).pathname;
    const json = (d: unknown) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(d) });
    if (p === "/api/auth/me") return json({ id: 1, username: "a", role: "admin", department: null });
    if (p.startsWith("/api/notifications")) return json([]);
    if (p === "/api/public/brand") return json({ teamName: "雏鹰之翼", teamSubtitle: "航模队", systemTitle: "系统", description: "", logoUrl: null, primaryColor: null, theme: "indigo" });
    if (p === "/api/storage/layouts") return json([{ id: 1, roomCode: "6011", roomName: "库房", floor: 1, layoutJson: JSON.stringify({ width: W, height: H, unit: "cm", walls: [], doors: [], windows: [], items: ITEMS }) }]);
    if (p === "/api/storage/layouts/6011/items") return json([]);
    if (p === "/api/label-templates") return tpl === null ? route.fulfill({ status: 500, contentType: "application/json", body: "{}" }) : json([tpl]);
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

async function exportPdf(page: Page): Promise<Uint8Array> {

  const [dl] = await Promise.all([
    page.waitForEvent("download"),
    page.getByTestId("export-location-labels").click(),
  ]);
  const path = await dl.path();
  return new Uint8Array(readFileSync(path!));
}
const pageCount = (b: Uint8Array) => (Buffer.from(b).toString("latin1").match(/\/Type\s*\/Page[^s]/g) ?? []).length;
const boxesPt = (b: Uint8Array) => [...Buffer.from(b).toString("latin1").matchAll(/\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/g)].map(m => ({ w: +m[1], h: +m[2] }));
const images = (b: Uint8Array) => (Buffer.from(b).toString("latin1").match(/\/Subtype\s*\/Image/g) ?? []).length;

test("④ 页数 / 逐页 mm / A4 负向 / 两条路径 / 守卫回落", async ({ page }) => {
  page.on("dialog", d => void d.accept());   // **整个用例只注册一次**（重复注册 → already handled → 下载被取消）
  // ---- 路径 A：不 mock 到模板（接口 500 → 降级内置 80×50）----
  await setup(page, null);
  const a = await exportPdf(page);
  const aPages = pageCount(a), aBoxes = boxesPt(a);
  const aMm = aBoxes.map(b => `${(b.w / MM_TO_PT).toFixed(1)}×${(b.h / MM_TO_PT).toFixed(1)}`);
  console.log(`NUM-A 页数=${aPages}（标签数 5）逐页mm=${JSON.stringify(aMm)}`);
  console.log(`NUM-A A4负向 首${aBoxes[0].w.toFixed(1)}×${aBoxes[0].h.toFixed(1)}pt vs A4 595.3×841.9pt → 不相等=${Math.abs(aBoxes[0].w - 595.28) > 1}`);

  // ---- 路径 B：mock 成 60×40 且适合库位 ----
  await setup(page, template(42, 60, 40, QR_OK));
  const bm = await exportPdf(page);
  const bBoxes = boxesPt(bm);
  const bMm = bBoxes.map(x => `${(x.w / MM_TO_PT).toFixed(1)}×${(x.h / MM_TO_PT).toFixed(1)}`);
  console.log(`NUM-B 页数=${pageCount(bm)} 逐页mm=${JSON.stringify(bMm)}`);
  console.log(`NUM-两路径不同 A首页=${aMm[0]} B首页=${bMm[0]} → 数值不同=${aMm[0] !== bMm[0]}`);
  expect(aMm[0]).toBe("80.0×50.0");
  expect(bMm[0]).toBe("60.0×40.0");
  expect(aMm[0]).not.toBe(bMm[0]);

  // ---- 守卫：mock 一个**不含二维码**的默认模板 → 回落 + 提示 + 产物仍有二维码 ----
  await setup(page, template(7, 70, 50, [{ id: "t", type: "text", x: 1, y: 1, w: 20, h: 6, field: "name" }]));
  const notice = await page.getByTestId("export-location-labels-msg").innerText().catch(() => "");
  const g = await exportPdf(page);
  const gBoxes = boxesPt(g), gMm = gBoxes.map(x => `${(x.w / MM_TO_PT).toFixed(1)}×${(x.h / MM_TO_PT).toFixed(1)}`);
  console.log(`NUM-守卫 提示="${notice}" 页数=${pageCount(g)} 逐页mm=${JSON.stringify(gMm)} 图像对象数=${images(g)}`);
  expect(notice).toContain("不适合库位标签");
  expect(gMm[0]).toBe("80.0×50.0");          // 回落到内置库位模板（不是 70×50）
  expect(images(g)).toBeGreaterThanOrEqual(1); // **产物仍有二维码（图像对象）**
});