import { test, expect, type Page } from "@playwright/test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

/**
 * **产物判据（真浏览器 canvas）**：含中文的库位标签必须把中文**光栅化**成图像，
 * 而不能交给 jsPDF 标准字体（后者无 CJK 字形 → 乱码）。
 *
 * 判据（不数绘制次数、不依赖明文 `Do`——内容流是压缩的）：
 *  - 存在一个 `/Width` ≈ **文字块宽度** 的图像 XObject（40mm@300dpi ≈ 472px）
 *  - 且二维码那个（自适应后短编码 ≈ 162px）**仍在**
 *
 * 这也修掉了上一轮的错误断言形状：jsdom 只有 canvas 桩、且图像对象会被复用，
 * 所以产物判据必须放在真浏览器里。
 */

const RC = "http://schemas.microsoft.com/ws/2008/06/identity/claims/role";
const tok = (r: string) => `e2e.${Buffer.from(JSON.stringify({ [RC]: r, exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url")}.sig`;
const TPL = {
  id: 1, name: "含中文标签", isDefault: true, kind: "location", widthMm: 80, heightMm: 50, dpi: 600, background: "#FFFFFF",
  elements: [
    { id: "q", type: "qr", x: 3, y: 10, w: 30, h: 30 },
    // 必须有一处引用 code 的文本，否则这个模板对库位标签**不适用** → 会回落到内置库位模板（无二维码），
    // 这条用例要验的是"中文光栅化 + 二维码仍在"，所以模板本身必须被采用。
    { id: "c", type: "text", x: 36, y: 12, w: 40, h: 8, fontSizePt: 10, field: "code" },
    { id: "t", type: "text", x: 36, y: 34, w: 40, h: 12, fontSizePt: 9, field: "name" },   // 元素名（中文）
  ],
};

async function setup(page: Page) {
  await page.route("**/api/**", async route => {
    const p = new URL(route.request().url()).pathname;
    const json = (d: unknown) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(d) });
    if (p === "/api/auth/me") return json({ id: 1, username: "a", role: "admin", department: null });
    if (p.startsWith("/api/notifications")) return json([]);
    if (p === "/api/public/brand") return json({ teamName: "x", teamSubtitle: "y", systemTitle: "z", description: "", logoUrl: null, primaryColor: null, theme: "indigo" });
    if (p === "/api/storage/layouts") return json([{ id: 1, roomCode: "6011", roomName: "库房", floor: 1, layoutJson: JSON.stringify({ width: 900, height: 600, unit: "cm", walls: [], doors: [], windows: [], items: [
      { id: "s1", type: "device", name: "图传A柜", x: 100, y: 100, w: 60, h: 60, rotation: 0, locCode: "6011-A-1-01" },
    ] }) }]);
    if (p === "/api/label-templates") return json([TPL]);
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

test("含中文标签：中文被光栅化（图像 XObject 宽度可辨），二维码仍在", async ({ page }) => {
  page.on("dialog", d => void d.accept());
  await setup(page);
  const [dl] = await Promise.all([page.waitForEvent("download"), page.getByTestId("export-location-labels").click()]);
  const path = await dl.path();
  const bytes = (await import("node:fs")).readFileSync(path!);
  const text = bytes.toString("latin1");

  const widths = [...new Set([...text.matchAll(/\/Width\s+(\d+)/g)].map(m => Number(m[1])))].sort((a, b) => a - b);
  const fonts = [...new Set([...text.matchAll(/\/BaseFont\s*\/([A-Za-z0-9+\-]+)/g)].map(m => m[1]))];
  const hasFontFile = /\/FontFile\d?/.test(text);
  const textBlock = widths.filter(w => w > 400 && w < 600);       // 40mm@300dpi ≈ 472px
  const qr = widths.filter(w => w > 100 && w < 300);              // 短编码自适应 ≈162px

  // 把单页中文 PDF 落到**仓库外**，供人工肉眼确认
  const out = join(tmpdir(), "t40-chinese-label.pdf");
  writeFileSync(out, bytes);
  console.log(`CONTENT 图像/Width=${JSON.stringify(widths)} 字体=${JSON.stringify(fonts)} FontFile=${hasFontFile}`);
  console.log(`CONTENT 文字块候选=${JSON.stringify(textBlock)} 二维码候选=${JSON.stringify(qr)}`);
  console.log(`CONTENT 单页中文 PDF（仓库外，供人工肉眼确认）=${out} 字节=${bytes.length}`);

  expect(textBlock.length).toBeGreaterThan(0);   // 中文被光栅化 → 文字块图像存在
  expect(qr.length).toBeGreaterThan(0);          // 修中文没把二维码弄坏
});
